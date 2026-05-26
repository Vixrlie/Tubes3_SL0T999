import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { loadKeywords, normalizeKeyword, nowMs } from './shared';

const substitutionWeights = new Map<string, number>([
	['o:0', 0.2],
	['0:o', 0.2],
	['i:1', 0.2],
	['1:i', 0.2],
	['a:4', 0.2],
	['4:a', 0.2],
	['e:3', 0.3],
	['3:e', 0.3],
	['s:5', 0.3],
	['5:s', 0.3],
	['g:9', 0.4],
	['9:g', 0.4],
	['b:8', 0.3],
	['8:b', 0.3],
	[`a:\u03b1`, 0.1],
	[`\u03b1:a`, 0.1]
]);

const DEFAULT_THRESHOLD = 0.35;

function substitutionCost(a: string, b: string): number {
	if (a === b) {
		return 0;
	}

	const key = `${a}:${b}`;
	const weight = substitutionWeights.get(key);
	if (weight !== undefined) {
		return weight;
	}

	return 1;
}

export function weightedLevenshtein(a: string, b: string): number {
	const aLength = a.length;
	const bLength = b.length;
	const prevRow = new Array(bLength + 1).fill(0);
	const currentRow = new Array(bLength + 1).fill(0);

	for (let j = 0; j <= bLength; j += 1) {
		prevRow[j] = j;
	}

	for (let i = 1; i <= aLength; i += 1) {
		currentRow[0] = i;
		const aChar = a[i - 1];

		for (let j = 1; j <= bLength; j += 1) {
			const bChar = b[j - 1];
			const deletion = prevRow[j] + 1;
			const insertion = currentRow[j - 1] + 1;
			const substitution = prevRow[j - 1] + substitutionCost(aChar, bChar);
			currentRow[j] = Math.min(deletion, insertion, substitution);
		}

		for (let j = 0; j <= bLength; j += 1) {
			prevRow[j] = currentRow[j];
		}
	}

	return prevRow[bLength];
}

export function createFuzzyEngine(): DetectionEngine {
	return {
		name: 'Fuzzy',
		detect: async (context: DetectionContext): Promise<KeywordMatch[]> => {
			const keywords = await loadKeywords();
			const matches: KeywordMatch[] = [];
			const startTime = nowMs();
			const exactMatched = context.exactMatchedKeywords;
			const tokenRegex = /[\p{L}\p{N}]+/gu;

			for (const keyword of keywords) {
				const normalizedKeyword = normalizeKeyword(keyword);
				if (normalizedKeyword.length === 0) {
					continue;
				}
				if (exactMatched && exactMatched.has(normalizedKeyword)) {
					continue;
				}

				for (const target of context.targets) {
					const text = target.text;
					if (text.length === 0) {
						continue;
					}

					let match = tokenRegex.exec(text);
					let occurrences = 0;
					let firstIndex = -1;
					let firstText = '';
					let bestScore = Number.POSITIVE_INFINITY;

					while (match) {
						const token = match[0];
						const tokenLower = token.toLowerCase();
						const distance = weightedLevenshtein(tokenLower, normalizedKeyword);
						const score = distance / Math.max(tokenLower.length, normalizedKeyword.length);

						if (score <= DEFAULT_THRESHOLD) {
							occurrences += 1;
							if (firstIndex === -1) {
								firstIndex = match.index;
								firstText = token;
							}
							if (score < bestScore) {
								bestScore = score;
							}
						}

						match = tokenRegex.exec(text);
					}

					tokenRegex.lastIndex = 0;

					if (occurrences > 0) {
						const endIndex = firstIndex + firstText.length;
						matches.push({
							keyword: normalizedKeyword,
							matchedText: firstText,
							algorithm: 'Fuzzy',
							source: 'fuzzy',
							startIndex: firstIndex,
							endIndex,
							occurrenceCount: occurrences,
							targetIndex: target.index,
							score: bestScore
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