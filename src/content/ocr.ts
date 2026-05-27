import type { KeywordMatch, ScanTarget } from '../types';
import { loadKeywords, normalizeKeyword, normalizeWhitespace, nowMs } from '../algorithms/shared';

type OcrWorker = {
	recognize: (image: string) => Promise<{ data?: { text?: string } }>;
	terminate?: () => Promise<void> | void;
};

let workerPromise: Promise<OcrWorker> | null = null;
const recognizedTextCache = new Map<string, string>();
const MAX_OCR_TARGETS = 8;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

	const width = Math.max(1, Math.round(image.naturalWidth * Math.min(2, 1280 / Math.max(1, image.naturalWidth))));
	const height = Math.max(1, Math.round(image.naturalHeight * Math.min(2, 1280 / Math.max(1, image.naturalWidth))));
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
			recognizedTextCache.set(sourceUrl, '');
			return '';
		}

		const result = await worker.recognize(imageInput);
		const text = normalizeWhitespace(result.data?.text ?? '');
		recognizedTextCache.set(sourceUrl, text);
		return text;
	} catch {
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

export async function runOcrDetection(targets: ScanTarget[]): Promise<{ matches: KeywordMatch[]; executionTimeMs: number }> {
	const startTime = nowMs();
	const rawKeywords = await loadKeywords();
	const keywords = rawKeywords.map((keyword) => normalizeKeyword(keyword)).filter((keyword) => keyword.length > 0);
	const matches: KeywordMatch[] = [];

	const imageTargets = targets.filter((target) => target.kind === 'image').slice(0, MAX_OCR_TARGETS);

	for (const target of imageTargets) {
		const recognizedText = await recognizeImage(target);
		if (!recognizedText) {
			continue;
		}

		const searchText = normalizeKeyword(recognizedText);
		for (const keyword of keywords) {
			if (keyword.length === 0 || keyword.length > searchText.length) {
				continue;
			}

			const { count, firstIndex } = countKeywordOccurrences(searchText, keyword);
			if (count === 0 || firstIndex < 0) {
				continue;
			}

			matches.push({
				keyword,
				matchedText: recognizedText.slice(firstIndex, firstIndex + keyword.length),
				algorithm: 'OCR',
				source: 'exact',
				startIndex: firstIndex,
				endIndex: firstIndex + keyword.length,
				occurrenceCount: count,
				targetIndex: target.index,
				executionTimeMs: 0
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
