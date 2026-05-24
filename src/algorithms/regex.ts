import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';

export function createRegexEngine(): DetectionEngine {
	return {
		name: 'Regex',
		detect: (_context: DetectionContext): KeywordMatch[] => []
	};
}