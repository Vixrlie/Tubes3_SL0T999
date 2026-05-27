import type { KeywordMatch, ScanTarget } from '../types';
import { loadKeywords, normalizeKeyword, normalizeWhitespace, nowMs } from '../algorithms/shared';

type OcrWorker = {
	recognize: (image: string) => Promise<{ data?: { text?: string } }>;
	terminate?: () => Promise<void> | void;
};

let workerPromise: Promise<OcrWorker> | null = null;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createWorkerInstance(): Promise<OcrWorker> {
	const tesseractModule = await import('tesseract.js');
	const worker = await tesseractModule.createWorker('eng');
	return worker as unknown as OcrWorker;
}

async function getWorker(): Promise<OcrWorker> {
	if (!workerPromise) {
		workerPromise = createWorkerInstance();
	}

	return workerPromise;
}

async function recognizeImage(sourceUrl: string): Promise<string> {
	if (!sourceUrl) {
		return '';
	}

	const worker = await getWorker();
	const result = await worker.recognize(sourceUrl);
	return normalizeWhitespace(result.data?.text ?? '');
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

	for (const target of targets) {
		const sourceUrl = target.sourceUrl ?? (target.element instanceof HTMLImageElement ? (target.element.currentSrc || target.element.src) : '');
		const recognizedText = await recognizeImage(sourceUrl);
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
