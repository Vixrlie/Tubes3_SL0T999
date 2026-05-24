import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';

export function createBoyerMooreEngine(): DetectionEngine {
	return {
		name: 'BM',
		detect: (_context: DetectionContext): KeywordMatch[] => []
	};
}