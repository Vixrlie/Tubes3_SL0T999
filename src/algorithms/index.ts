import type { DetectionContext, KeywordMatch } from '../types';
import { createBoyerMooreEngine } from './boyerMoore';
import { createFuzzyEngine } from './weightedLevenshtein';
import { createKmpEngine } from './kmp';
import { createRegexEngine } from './regex';

const detectionEngines = [
	createKmpEngine(),
	createBoyerMooreEngine(),
	createRegexEngine(),
	createFuzzyEngine()
];

export async function runDetectionEngines(context: DetectionContext): Promise<KeywordMatch[]> {
	const matches: KeywordMatch[] = [];

	for (const engine of detectionEngines) {
		const engineMatches = await engine.detect(context);
		matches.push(...engineMatches.map((match) => ({
			...match,
			algorithm: match.algorithm ?? engine.name
		})));
	}

	return matches;
}