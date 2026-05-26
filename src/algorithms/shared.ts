import type { DetectionEngine } from '../types';

export function createNoopEngine(name: DetectionEngine['name']): DetectionEngine {
	return {
		name,
		detect: () => []
	};
}

let cachedKeywords: string[] | null = null;

export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, ' ').trim();
}

export function normalizeKeyword(input: string): string {
	return normalizeWhitespace(input).toLowerCase();
}

export async function loadKeywords(): Promise<string[]> {
	if (cachedKeywords) {
		return cachedKeywords;
	}

	const response = await fetch(chrome.runtime.getURL('keywords/keywords.txt'));
	const rawText = await response.text();
	const keywords = rawText
		.split(/\r?\n/)
		.map((line) => normalizeKeyword(line))
		.filter((line) => line.length > 0);

	cachedKeywords = keywords;
	return keywords;
}

export function nowMs(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
		return performance.now();
	}

	return Date.now();
}