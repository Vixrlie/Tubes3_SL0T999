import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { loadKeywords, normalizeKeyword, nowMs } from './shared';

export function buildFailureFunction(pattern: string): number[] {
	const failure = new Array(pattern.length).fill(0);
	let length = 0;
	let index = 1;

	while (index < pattern.length) {
		if (pattern[index] === pattern[length]) {
			length += 1;
			failure[index] = length;
			index += 1;
			continue;
		}

		if (length !== 0) {
			length = failure[length - 1];
			continue;
		}

		failure[index] = 0;
		index += 1;
	}

	return failure;
}

export function kmpSearch(text: string, pattern: string): { matches: number[]; comparisons: number } {
	const matches: number[] = [];
	let comparisons = 0;

	if (pattern.length === 0 || text.length === 0 || pattern.length > text.length) {
		return { matches, comparisons };
	}

	const failure = buildFailureFunction(pattern);
	let textIndex = 0;
	let patternIndex = 0;

	while (textIndex < text.length) {
		comparisons += 1;
		if (text[textIndex] === pattern[patternIndex]) {
			textIndex += 1;
			patternIndex += 1;
			if (patternIndex === pattern.length) {
				matches.push(textIndex - patternIndex);
				patternIndex = failure[patternIndex - 1];
			}
			continue;
		}

		if (patternIndex !== 0) {
			patternIndex = failure[patternIndex - 1];
			continue;
		}

		textIndex += 1;
	}

	return { matches, comparisons };
}

export function createKmpEngine(): DetectionEngine {
	return {
		name: 'KMP',
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
					const { matches: positions, comparisons } = kmpSearch(searchText, normalizedKeyword);
					if (positions.length === 0) {
						continue;
					}

					const startIndex = positions[0];
					const endIndex = startIndex + normalizedKeyword.length;

					matches.push({
						keyword: normalizedKeyword,
						matchedText: text.slice(startIndex, endIndex),
						algorithm: 'KMP',
						source: 'exact',
						startIndex,
						endIndex,
						occurrenceCount: positions.length,
						targetIndex: target.index,
						comparisonCount: comparisons
					});
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