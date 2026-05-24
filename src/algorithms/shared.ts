import type { DetectionEngine } from '../types';

export function createNoopEngine(name: DetectionEngine['name']): DetectionEngine {
	return {
		name,
		detect: () => []
	};
}