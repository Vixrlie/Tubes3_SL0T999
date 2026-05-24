import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';

export function createKmpEngine(): DetectionEngine {
	return {
		name: 'KMP',
		detect: (_context: DetectionContext): KeywordMatch[] => []
	};
}