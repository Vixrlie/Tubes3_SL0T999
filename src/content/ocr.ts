import type { KeywordMatch, ScanTarget } from '../types';
import { loadKeywords, normalizeKeyword, normalizeWhitespace, nowMs } from '../algorithms/shared';
import { weightedLevenshtein } from '../algorithms/weightedLevenshtein';

type OcrWorker = {
	recognize: (image: string) => Promise<{ data?: { text?: string; confidence?: number; words?: Array<{ text?: string; confidence?: number }> } }>;
	terminate?: () => Promise<void> | void;
};

let workerPromise: Promise<OcrWorker> | null = null;
const recognizedTextCache = new Map<string, string>();
const MAX_OCR_TARGETS = 8;
const OCR_CROP_PADDING = 8; // px
const OCR_SCALES = [1, 1.5, 2];
const OCR_PER_CROP_TIMEOUT_MS = 2500;
const OCR_CONFIDENCE_THRESHOLD = 45;
const OCR_FUZZY_THRESHOLD = 0.35;
const OCR_MIN_CROP_WIDTH = 32;
const OCR_MIN_CROP_HEIGHT = 24;
const OCR_PREPROCESS_MIN_SCALE = 4;
const OCR_PREPROCESS_MAX_DIMENSION = 1600;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeOcrText(text: string): string[] {
	return normalizeWhitespace(text)
		.split(/[^\p{L}\p{N}]+/u)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3)
		.filter((token) => /[\p{L}\p{N}]/u.test(token));
}

function extractConfidence(result: { data?: { confidence?: number; words?: Array<{ confidence?: number }> } }): number {
	const rawConfidence = result.data?.confidence;
	if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
		return rawConfidence;
	}

	const wordConfidences = result.data?.words
		?.map((word) => word.confidence)
		.filter((confidence): confidence is number => typeof confidence === 'number' && Number.isFinite(confidence)) ?? [];

	if (wordConfidences.length > 0) {
		return wordConfidences.reduce((sum, confidence) => sum + confidence, 0) / wordConfidences.length;
	}

	return 0;
}

function isBetterFuzzyCandidate(token: string, keyword: string): boolean {
	const distance = weightedLevenshtein(token.toLowerCase(), keyword);
	const score = distance / Math.max(token.length, keyword.length);
	return score <= OCR_FUZZY_THRESHOLD;
}

function expandBoxToMinimumSize(
	box: { x: number; y: number; w: number; h: number },
	imageWidth: number,
	imageHeight: number,
): { x: number; y: number; w: number; h: number } {
	const centerX = box.x + box.w / 2;
	const centerY = box.y + box.h / 2;
	const nextWidth = Math.max(box.w, OCR_MIN_CROP_WIDTH);
	const nextHeight = Math.max(box.h, OCR_MIN_CROP_HEIGHT);

	let x = Math.round(centerX - nextWidth / 2);
	let y = Math.round(centerY - nextHeight / 2);

	x = Math.max(0, Math.min(imageWidth - nextWidth, x));
	y = Math.max(0, Math.min(imageHeight - nextHeight, y));

	const width = Math.max(1, Math.min(imageWidth - x, nextWidth));
	const height = Math.max(1, Math.min(imageHeight - y, nextHeight));

	return { x, y, w: width, h: height };
}

function upscaleCanvasForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
	const width = canvas.width;
	const height = canvas.height;
	const minDimension = Math.min(width, height);
	const scaleBySize = minDimension > 0 ? Math.max(1, OCR_PREPROCESS_MIN_SCALE / minDimension) : OCR_PREPROCESS_MIN_SCALE;
	const scaleByWidth = width > 0 ? Math.max(1, OCR_PREPROCESS_MIN_SCALE / width) : OCR_PREPROCESS_MIN_SCALE;
	const scaleByHeight = height > 0 ? Math.max(1, OCR_PREPROCESS_MIN_SCALE / height) : OCR_PREPROCESS_MIN_SCALE;
	const scale = Math.min(
		OCR_PREPROCESS_MAX_DIMENSION / Math.max(1, width),
		OCR_PREPROCESS_MAX_DIMENSION / Math.max(1, height),
		Math.max(scaleBySize, scaleByWidth, scaleByHeight, 1),
	);

	if (scale <= 1) {
		return canvas;
	}

	const resized = document.createElement('canvas');
	resized.width = Math.max(1, Math.round(width * scale));
	resized.height = Math.max(1, Math.round(height * scale));
	const ctx = resized.getContext('2d');
	if (!ctx) {
		return canvas;
	}

	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
	return resized;
}

async function createWorkerInstance(): Promise<OcrWorker> {
	const tesseractModule = await import('tesseract.js');
	const worker = await tesseractModule.createWorker('eng+ind');
	return worker as unknown as OcrWorker;
}

async function getWorker(): Promise<OcrWorker> {
	if (!workerPromise) {
		workerPromise = createWorkerInstance();
	}

	return workerPromise;
}

export function warmupOcrWorker(): Promise<OcrWorker> {
	return getWorker();
}

function toImageSource(target: ScanTarget): string {
	return target.sourceUrl ?? (target.element instanceof HTMLImageElement ? (target.element.currentSrc || target.element.src) : '');
}

function imageElementToDataUrl(image: HTMLImageElement): string {
	if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
		return '';
	}

	const width = Math.max(1, Math.round(image.naturalWidth * Math.min(4, 1600 / Math.max(1, image.naturalWidth))));
	const height = Math.max(1, Math.round(image.naturalHeight * Math.min(4, 1600 / Math.max(1, image.naturalWidth))));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) {
		return '';
	}

	context.imageSmoothingEnabled = true;
	context.drawImage(image, 0, 0, width, height);

	// Mild normalization for OCR stability without heavy multi-pass processing.
	const imageData = context.getImageData(0, 0, width, height);
	const { data } = imageData;
	for (let index = 0; index < data.length; index += 4) {
		const red = data[index] ?? 0;
		const green = data[index + 1] ?? 0;
		const blue = data[index + 2] ?? 0;
		const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
		const normalized = gray > 180 ? 255 : gray < 75 ? 0 : gray;
		data[index] = normalized;
		data[index + 1] = normalized;
		data[index + 2] = normalized;
	}
	context.putImageData(imageData, 0, 0);

	return canvas.toDataURL('image/png');
}

// New: preprocess a canvas (single crop) for OCR and return dataURL
function preprocessCanvasForOcr(canvas: HTMLCanvasElement): string {
	const inputCanvas = upscaleCanvasForOcr(canvas);
	const width = inputCanvas.width;
	const height = inputCanvas.height;
	const ctx = inputCanvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return canvas.toDataURL('image/png');

	// convert to grayscale
	const img = ctx.getImageData(0, 0, width, height);
	const data = img.data;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
		data[i] = data[i + 1] = data[i + 2] = gray;
	}

	// simple contrast stretch
	let min = 255, max = 0;
	for (let i = 0; i < data.length; i += 4) {
		const v = data[i];
		if (v < min) min = v;
		if (v > max) max = v;
	}
	const range = Math.max(1, max - min);
	const scale = 255 / range;
	for (let i = 0; i < data.length; i += 4) {
		let v = Math.round((data[i] - min) * scale);
		v = v < 0 ? 0 : v > 255 ? 255 : v;
		data[i] = data[i + 1] = data[i + 2] = v;
	}

	// simple adaptive-ish threshold: compute local mean using integral image approximation
	const integral = new Uint32Array((width + 1) * (height + 1));
	for (let y = 0; y < height; y++) {
		let rowSum = 0;
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			rowSum += data[idx];
			integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
		}
	}

	const blockSize = Math.max(15, Math.floor(Math.min(width, height) / 20));
	const half = Math.floor(blockSize / 2);
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const y1 = Math.max(0, y - half);
		const y2 = Math.min(height - 1, y + half);
		for (let x = 0; x < width; x++) {
			const x1 = Math.max(0, x - half);
			const x2 = Math.min(width - 1, x + half);
			const count = (x2 - x1 + 1) * (y2 - y1 + 1);
			const sum = integral[(y2 + 1) * (width + 1) + (x2 + 1)] - integral[(y1) * (width + 1) + (x2 + 1)] - integral[(y2 + 1) * (width + 1) + (x1)] + integral[(y1) * (width + 1) + (x1)];
			const mean = Math.round(sum / count);
			const idx = (y * width + x) * 4;
			const v = data[idx];
			const t = mean - 10; // bias to prefer foreground
			const val = v <= t ? 0 : 255;
			out[idx] = out[idx + 1] = out[idx + 2] = val;
			out[idx + 3] = 255;
		}
	}

	const outImage = new ImageData(out, width, height);
	ctx.putImageData(outImage, 0, 0);
	return inputCanvas.toDataURL('image/png');
}

// Crop an image element to a rect and return a small canvas
function cropImageToCanvas(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, scale = 1): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(sw * scale));
	canvas.height = Math.max(1, Math.round(sh * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) return canvas;
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
	return canvas;
}

// Very lightweight text region detection: threshold whole image and find horizontal bands
function detectTextBBoxes(image: HTMLImageElement): { x: number; y: number; w: number; h: number }[] {
	const w = Math.max(1, image.naturalWidth);
	const h = Math.max(1, image.naturalHeight);
	const tmp = document.createElement('canvas');
	tmp.width = Math.min(1200, w);
	tmp.height = Math.min(1200, Math.round((tmp.width * h) / w));
	const ctx = tmp.getContext('2d', { willReadFrequently: true });
	if (!ctx) return [];
	ctx.drawImage(image, 0, 0, tmp.width, tmp.height);
	const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
	const rowSums = new Uint32Array(tmp.height);
	for (let y = 0; y < tmp.height; y++) {
		let sum = 0;
		for (let x = 0; x < tmp.width; x++) {
			const idx = (y * tmp.width + x) * 4;
			const r = data[idx];
			const g = data[idx + 1];
			const b = data[idx + 2];
			const gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
			if (gray < 200) sum += 1; // dark pixels
		}
		rowSums[y] = sum;
	}

	// find bands where rowSum exceeds threshold
	const threshold = Math.max(5, Math.floor(tmp.width * 0.02));
	const bands: { start: number; end: number }[] = [];
	let inBand = false;
	let start = 0;
	for (let y = 0; y < tmp.height; y++) {
		if (!inBand && rowSums[y] > threshold) { inBand = true; start = y; }
		if (inBand && rowSums[y] <= threshold) { inBand = false; bands.push({ start, end: y }); }
	}
	if (inBand) bands.push({ start, end: tmp.height - 1 });

	const boxes: { x: number; y: number; w: number; h: number }[] = [];
	for (const band of bands) {
		// compute left/right bounds within this band
		let left = tmp.width, right = 0;
		for (let y = band.start; y <= band.end; y++) {
			for (let x = 0; x < tmp.width; x++) {
				const idx = (y * tmp.width + x) * 4;
				const r = data[idx];
				const g = data[idx + 1];
				const b = data[idx + 2];
				const gray = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
				if (gray < 200) {
					if (x < left) left = x;
					if (x > right) right = x;
				}
			}
		}
		if (right - left > 8) {
			// map back to original image coords
			const scaleX = w / tmp.width;
			const scaleY = h / tmp.height;
			const x = Math.max(0, Math.floor(left * scaleX) - OCR_CROP_PADDING);
			const y = Math.max(0, Math.floor(band.start * scaleY) - OCR_CROP_PADDING);
			const boxW = Math.min(w - x, Math.ceil((right - left) * scaleX) + OCR_CROP_PADDING * 2);
			const boxH = Math.min(h - y, Math.ceil((band.end - band.start) * scaleY) + OCR_CROP_PADDING * 2);
			const expanded = expandBoxToMinimumSize({ x, y, w: boxW, h: boxH }, w, h);
			if (expanded.w >= OCR_MIN_CROP_WIDTH || expanded.h >= OCR_MIN_CROP_HEIGHT) {
				boxes.push(expanded);
			} else {
				console.debug('[JudolDetector][ocr] skip tiny box', {
					original: { x, y, w: boxW, h: boxH },
					expanded,
					sourceSize: { w, h },
				});
			}
		}
	}

	// fallback: if no boxes found, return whole image as one box
	if (boxes.length === 0) return [{ x: 0, y: 0, w, h }];
	return boxes;
}

async function prepareImageForOcr(target: ScanTarget): Promise<string> {
	const sourceUrl = toImageSource(target);
	if (!sourceUrl) {
		return '';
	}

	if (target.element instanceof HTMLImageElement) {
		if (target.element.naturalWidth === 0 || target.element.naturalHeight === 0) {
			await target.element.decode().catch(() => undefined);
		}

		const dataUrl = imageElementToDataUrl(target.element);
		if (dataUrl) {
			return dataUrl;
		}
	}

	return sourceUrl;
}

async function recognizeImage(target: ScanTarget): Promise<string> {
	const sourceUrl = toImageSource(target);
	if (!sourceUrl) {
		console.debug('[JudolDetector][ocr] skip target: empty sourceUrl', { targetIndex: target.index });
		return '';
	}

	const cachedText = recognizedTextCache.get(sourceUrl);
	if (cachedText !== undefined) {
		return cachedText;
	}

	try {
		const worker = await getWorker();
		const imageInput = await prepareImageForOcr(target);
		if (!imageInput) {
			console.debug('[JudolDetector][ocr] skip target: unable to prepare image', {
				sourceUrl,
				targetIndex: target.index,
			});
			recognizedTextCache.set(sourceUrl, '');
			return '';
		}

		console.debug('[JudolDetector][ocr] recognize start', {
			sourceUrl,
			targetIndex: target.index,
			kind: target.kind,
			isImageElement: target.element instanceof HTMLImageElement,
			inputType: imageInput.startsWith('data:') ? 'data-url' : 'url',
		});

		// If imageInput is data URL, pass directly. But we also run multi-scale crops to improve recognition.
		let aggregateText = '';
		let aggregateConfidence = 0;
		let confidenceSamples = 0;

		function appendRecognitionText(text: string, confidence: number): void {
			const normalizedText = normalizeWhitespace(text);
			if (normalizedText.length === 0) {
				return;
			}

			if (confidence >= OCR_CONFIDENCE_THRESHOLD) {
				aggregateText += (aggregateText ? '\n' : '') + normalizedText;
				aggregateConfidence += confidence;
				confidenceSamples += 1;
			}
		}

		// If the target contains an element, attempt region detection and multi-scale OCR
		if (target.element instanceof HTMLImageElement) {
			const imgEl = target.element as HTMLImageElement;
			const boxes = detectTextBBoxes(imgEl).slice(0, MAX_OCR_TARGETS);
			console.debug('[JudolDetector][ocr] detected boxes', {
				sourceUrl,
				targetIndex: target.index,
				boxCount: boxes.length,
				boxes,
			});
			// process each box at multiple scales
			for (const box of boxes) {
				let recognized = '';
				let recognizedConfidence = 0;
				for (const scale of OCR_SCALES) {
					try {
						const cropCanvas = cropImageToCanvas(imgEl, box.x, box.y, box.w, box.h, scale);
						const dataUrl = preprocessCanvasForOcr(cropCanvas);
						// timeout wrapper
						const recogPromise = worker.recognize(dataUrl);
						const result = await Promise.race([
							recogPromise,
							new Promise<{ data?: { text?: string; confidence?: number; words?: Array<{ text?: string; confidence?: number }> } }>((res) => setTimeout(() => res({ data: { text: '', confidence: 0 } }), OCR_PER_CROP_TIMEOUT_MS))
						]);
						const textPart = normalizeWhitespace(result.data?.text ?? '');
						const confidence = extractConfidence(result);
						console.debug('[JudolDetector][ocr] crop result', {
							sourceUrl,
							targetIndex: target.index,
							box,
							scale,
							confidence,
							textPreview: textPart.slice(0, 120),
						});
						if (textPart.length > 0 && confidence >= OCR_CONFIDENCE_THRESHOLD) {
							recognized = textPart.trim();
							recognizedConfidence = confidence;
							break; // use the first non-empty scale result
						}
						if (textPart.length > 0 && confidence < OCR_CONFIDENCE_THRESHOLD) {
							console.debug('[JudolDetector][ocr] crop rejected by confidence threshold', {
								sourceUrl,
								targetIndex: target.index,
								confidence,
								threshold: OCR_CONFIDENCE_THRESHOLD,
								textPreview: textPart.slice(0, 120),
							});
						}
					} catch {
						console.debug('[JudolDetector][ocr] crop recognition error', {
							sourceUrl,
							targetIndex: target.index,
							box,
							scale,
						});
						// ignore and continue
					}
				}
				if (recognized) {
					console.debug('[JudolDetector][ocr] crop accepted', {
						sourceUrl,
						targetIndex: target.index,
						confidence: recognizedConfidence,
						textPreview: recognized.slice(0, 120),
					});
					appendRecognitionText(recognized, recognizedConfidence);
				}
			}
		}

		// Fallback to whole-image recognition if no region yielded text
		if (!aggregateText) {
			const result = await worker.recognize(imageInput);
			const confidence = extractConfidence(result);
			const text = normalizeWhitespace(result.data?.text ?? '');
			console.debug('[JudolDetector][ocr] whole-image fallback result', {
				sourceUrl,
				targetIndex: target.index,
				confidence,
				textPreview: text.slice(0, 120),
			});
			if (text.length > 0 && confidence >= OCR_CONFIDENCE_THRESHOLD) {
				aggregateText = text;
				aggregateConfidence = confidence;
				confidenceSamples = 1;
			}
		}

		const text = aggregateText;
		console.debug('[JudolDetector][ocr] recognize done', {
			sourceUrl,
			targetIndex: target.index,
			finalTextLength: text.length,
			avgConfidence: confidenceSamples > 0 ? aggregateConfidence / confidenceSamples : 0,
		});
		recognizedTextCache.set(sourceUrl, text);
		return text;
	} catch {
		console.debug('[JudolDetector][ocr] recognize failed', { sourceUrl, targetIndex: target.index });
		recognizedTextCache.set(sourceUrl, '');
		return '';
	}
}

function countKeywordOccurrences(text: string, keyword: string): { count: number; firstIndex: number } {
	const pattern = new RegExp(escapeRegExp(keyword), 'g');
	let match: RegExpExecArray | null;
	let count = 0;
	let firstIndex = -1;

	while ((match = pattern.exec(text)) !== null) {
		count += 1;
		if (firstIndex < 0) {
			firstIndex = match.index;
		}

		if (match.index === pattern.lastIndex) {
			pattern.lastIndex += 1;
		}
	}

	return { count, firstIndex };
}

function findExactKeywordMatch(text: string, keywords: string[]): KeywordMatch | null {
	let bestMatch: KeywordMatch | null = null;

	for (const keyword of keywords) {
		if (keyword.length === 0 || keyword.length > text.length) {
			continue;
		}

		const { count, firstIndex } = countKeywordOccurrences(text, keyword);
		if (count === 0 || firstIndex < 0) {
			continue;
		}

		const candidate: KeywordMatch = {
			keyword,
			matchedText: text.slice(firstIndex, firstIndex + keyword.length),
			algorithm: 'OCR',
			source: 'exact',
			startIndex: firstIndex,
			endIndex: firstIndex + keyword.length,
			occurrenceCount: count,
			executionTimeMs: 0
		};

		if (!bestMatch || candidate.occurrenceCount > bestMatch.occurrenceCount) {
			bestMatch = candidate;
		}
	}

	return bestMatch;
}

function findFuzzyKeywordMatch(tokens: string[], keywords: string[]): KeywordMatch | null {
	let bestMatch: KeywordMatch | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const token of tokens) {
		const tokenLower = token.toLowerCase();
		for (const keyword of keywords) {
			if (keyword.length === 0) {
				continue;
			}

			const distance = weightedLevenshtein(tokenLower, keyword);
			const score = distance / Math.max(tokenLower.length, keyword.length);
			if (score > OCR_FUZZY_THRESHOLD) {
				continue;
			}

			if (score < bestScore || (score === bestScore && isBetterFuzzyCandidate(tokenLower, keyword))) {
				bestScore = score;
				bestMatch = {
					keyword,
					matchedText: token,
					algorithm: 'OCR',
					source: 'fuzzy',
					startIndex: 0,
					endIndex: token.length,
					occurrenceCount: 1,
					score
				};
			}
		}
	}

	return bestMatch;
}

export async function runOcrDetection(targets: ScanTarget[]): Promise<{ matches: KeywordMatch[]; executionTimeMs: number }> {
	const startTime = nowMs();
	const rawKeywords = await loadKeywords();
	const keywords = rawKeywords.map((keyword) => normalizeKeyword(keyword)).filter((keyword) => keyword.length > 0);
	const matches: KeywordMatch[] = [];

	const imageTargets = targets.filter((target) => target.kind === 'image').slice(0, MAX_OCR_TARGETS);
	console.debug('[JudolDetector][ocr] run start', {
		imageTargets: imageTargets.length,
		keywords: keywords.length,
		maxTargets: MAX_OCR_TARGETS,
	});

	for (const target of imageTargets) {
		const recognizedText = await recognizeImage(target);
		if (!recognizedText) {
			console.debug('[JudolDetector][ocr] no recognized text after OCR', {
				targetIndex: target.index,
				sourceUrl: toImageSource(target),
			});
			continue;
		}

		const searchText = normalizeKeyword(recognizedText);
		const tokens = tokenizeOcrText(searchText);
		console.debug('[JudolDetector][ocr] post-process', {
			targetIndex: target.index,
			sourceUrl: toImageSource(target),
			searchTextPreview: searchText.slice(0, 160),
			tokenCount: tokens.length,
			tokens: tokens.slice(0, 20),
		});
		const exactMatch = findExactKeywordMatch(searchText, keywords);
		if (exactMatch) {
			console.debug('[JudolDetector][ocr] exact OCR match', {
				targetIndex: target.index,
				keyword: exactMatch.keyword,
				matchedText: exactMatch.matchedText,
				occurrenceCount: exactMatch.occurrenceCount,
			});
			matches.push({
				...exactMatch,
				targetIndex: target.index
			});
			continue;
		}

		if (tokens.length === 0) {
			continue;
		}

		const fuzzyMatch = findFuzzyKeywordMatch(tokens, keywords);
		if (fuzzyMatch) {
			console.debug('[JudolDetector][ocr] fuzzy OCR match', {
				targetIndex: target.index,
				keyword: fuzzyMatch.keyword,
				matchedText: fuzzyMatch.matchedText,
				score: fuzzyMatch.score,
			});
			matches.push({
				...fuzzyMatch,
				targetIndex: target.index
			});
		} else {
			console.debug('[JudolDetector][ocr] no keyword matched after OCR post-process', {
				targetIndex: target.index,
				sourceUrl: toImageSource(target),
			});
		}
	}

	const executionTimeMs = nowMs() - startTime;
	return {
		matches: matches.map((match) => ({
			...match,
			executionTimeMs
		})),
		executionTimeMs
	};
}
