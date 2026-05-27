import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { loadKeywords, normalizeKeyword, nowMs } from './shared';

const HASH_BASE = 256;
const HASH_MOD = 1000000007;

function mod(value: number): number {
	const result = value % HASH_MOD;
	return result < 0 ? result + HASH_MOD : result;
}

function computeHash(text: string, length: number): number {
	let hash = 0;
	for (let i = 0; i < length; i += 1) {
		hash = mod(hash * HASH_BASE + text.charCodeAt(i));
	}
	return hash;
}

function rabinKarpSearch(text: string, pattern: string): { matches: number[]; comparisons: number } {
	const matches: number[] = [];
	let comparisons = 0;
	const textLength = text.length;
	const patternLength = pattern.length;

	if (patternLength === 0 || textLength === 0 || patternLength > textLength) {
		return { matches, comparisons };
	}

	let highestPow = 1;
	for (let i = 0; i < patternLength - 1; i += 1) {
		highestPow = mod(highestPow * HASH_BASE);
	}

	const patternHash = computeHash(pattern, patternLength);
	let windowHash = computeHash(text, patternLength);

	for (let i = 0; i <= textLength - patternLength; i += 1) {
		if (windowHash === patternHash) {
			let matched = true;
			for (let j = 0; j < patternLength; j += 1) {
				comparisons += 1;
				if (text[i + j] !== pattern[j]) {
					matched = false;
					break;
				}
			}
			if (matched) {
				matches.push(i);
			}
		}

		if (i < textLength - patternLength) {
			const leading = text.charCodeAt(i);
			const trailing = text.charCodeAt(i + patternLength);
			const removed = mod(windowHash - leading * highestPow);
			windowHash = mod(removed * HASH_BASE + trailing);
		}
	}

	return { matches, comparisons };
}

export function createRabinKarpEngine(): DetectionEngine {
	return {
		name: 'RabinKarp',
		detect: async (context: DetectionContext): Promise<KeywordMatch[]> => {
			const keywords = await loadKeywords();
			const matches: KeywordMatch[] = [];
			const startTime = nowMs();

			for (const keyword of keywords) {
				const normalizedKeyword = normalizeKeyword(keyword);
				if (normalizedKeyword.length === 0) {
					continue;
				}

				for (const target of context.targets) {
					const text = target.text;
					if (text.length === 0 || normalizedKeyword.length > text.length) {
						continue;
					}

					const searchText = text.toLowerCase();
					const { matches: positions, comparisons } = rabinKarpSearch(searchText, normalizedKeyword);
					if (positions.length === 0) {
						continue;
					}

					for (const startIndex of positions) {
						const endIndex = startIndex + normalizedKeyword.length;
						matches.push({
							keyword: normalizedKeyword,
							matchedText: text.slice(startIndex, endIndex),
							algorithm: 'RabinKarp',
							source: 'exact',
							startIndex,
							endIndex,
							occurrenceCount: positions.length,
							targetIndex: target.index,
							comparisonCount: comparisons
						});
					}
				}
			}

			const executionTimeMs = nowMs() - startTime;
			return matches.map((match) => ({
				...match,
				executionTimeMs
			}));
		}
	};
}
