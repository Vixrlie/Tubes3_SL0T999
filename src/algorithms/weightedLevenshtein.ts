import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';

export function createFuzzyEngine(): DetectionEngine {
	return {
		name: 'Fuzzy',
		detect: (_context: DetectionContext): KeywordMatch[] => []
	};
}