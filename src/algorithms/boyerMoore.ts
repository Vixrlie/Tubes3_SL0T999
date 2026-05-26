import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { loadKeywords, normalizeKeyword, nowMs } from './shared';

export function buildLastOccurrenceTable(pattern: string): Map<string, number> {
	const table = new Map<string, number>();
	for (let index = 0; index < pattern.length; index += 1) {
		table.set(pattern[index], index);
	}
	return table;
}

function buildGoodSuffixTable(pattern: string): number[] {
	const length = pattern.length;
	const shift = new Array(length + 1).fill(0);
	const borderPos = new Array(length + 1).fill(0);

	let i = length;
	let j = length + 1;
	borderPos[i] = j;

	while (i > 0) {
		while (j <= length && pattern[i - 1] !== pattern[j - 1]) {
			if (shift[j] === 0) {
				shift[j] = j - i;
			}
			j = borderPos[j];
		}
		i -= 1;
		j -= 1;
		borderPos[i] = j;
	}

	j = borderPos[0];
	for (i = 0; i <= length; i += 1) {
		if (shift[i] === 0) {
			shift[i] = j;
		}
		if (i === j) {
			j = borderPos[j];
		}
	}

	return shift;
}

export function boyerMooreSearch(text: string, pattern: string): { matches: number[]; comparisons: number } {
	const matches: number[] = [];
	let comparisons = 0;

	if (pattern.length === 0 || text.length === 0 || pattern.length > text.length) {
		return { matches, comparisons };
	}

	const lastOccurrence = buildLastOccurrenceTable(pattern);
	const goodSuffix = buildGoodSuffixTable(pattern);
	const textLength = text.length;
	const patternLength = pattern.length;
	let shift = 0;

	while (shift <= textLength - patternLength) {
		let index = patternLength - 1;

		while (index >= 0) {
			comparisons += 1;
			if (pattern[index] === text[shift + index]) {
				index -= 1;
				continue;
			}
			break;
		}

		if (index < 0) {
			matches.push(shift);
			shift += goodSuffix[0];
			continue;
		}

		const lastIndex = lastOccurrence.get(text[shift + index]);
		const badCharShift = index - (lastIndex ?? -1);
		const goodSuffixShift = goodSuffix[index + 1];
		shift += Math.max(badCharShift, goodSuffixShift);
	}

	return { matches, comparisons };
}

export function createBoyerMooreEngine(): DetectionEngine {
	return {
		name: 'BM',
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
					const { matches: positions, comparisons } = boyerMooreSearch(searchText, normalizedKeyword);
					if (positions.length === 0) {
						continue;
					}

					const startIndex = positions[0];
					const endIndex = startIndex + normalizedKeyword.length;

					matches.push({
						keyword: normalizedKeyword,
						matchedText: text.slice(startIndex, endIndex),
						algorithm: 'BM',
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