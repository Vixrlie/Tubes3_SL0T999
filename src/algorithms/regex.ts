import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { nowMs } from './shared';

const patternRegex = /[\p{L}][\p{L}\p{M}\p{N}'’._-]*\d{2,3}/giu;

function isWordChar(value: string): boolean {
	return /[\p{L}\p{N}]/u.test(value);
}

function findPatternMatches(text: string): { count: number; firstIndex: number; firstText: string } | null {
	let match = patternRegex.exec(text);
	let count = 0;
	let firstIndex = -1;
	let firstText = '';

	while (match) {
		const startIndex = match.index;
		const endIndex = startIndex + match[0].length;
		const hasLeftBoundary = startIndex === 0 || !isWordChar(text[startIndex - 1]);
		const hasRightBoundary = endIndex >= text.length || !isWordChar(text[endIndex]);

		if (hasLeftBoundary && hasRightBoundary) {
			count += 1;
			if (firstIndex === -1) {
				firstIndex = startIndex;
				firstText = match[0];
			}
		}

		match = patternRegex.exec(text);
	}

	patternRegex.lastIndex = 0;
	if (count === 0) {
		return null;
	}

	return { count, firstIndex, firstText };
}

export function createRegexEngine(): DetectionEngine {
	return {
		name: 'Regex',
		detect: async (context: DetectionContext): Promise<KeywordMatch[]> => {
			const matches: KeywordMatch[] = [];
			const startTime = nowMs();

			for (const target of context.targets) {
				const text = target.text;
				if (text.length === 0) {
					continue;
				}

				const found = findPatternMatches(text);
				if (!found) {
					continue;
				}

				const startIndex = found.firstIndex;
				const endIndex = startIndex + found.firstText.length;
				matches.push({
					keyword: found.firstText,
					matchedText: found.firstText,
					algorithm: 'Regex',
					source: 'regex',
					startIndex,
					endIndex,
					occurrenceCount: found.count,
					targetIndex: target.index
				});
			}

			const executionTimeMs = nowMs() - startTime;
			return matches.map((match) => ({
				...match,
				executionTimeMs
			}));
		}
	};
}