import type { DetectionContext, KeywordMatch } from '../types';
import { createBoyerMooreEngine } from './boyerMoore';
import { createFuzzyEngine } from './weightedLevenshtein';
import { createKmpEngine } from './kmp';
import { createRegexEngine } from './regex';
import { normalizeKeyword } from './shared';

export async function runDetectionEngines(context: DetectionContext): Promise<KeywordMatch[]> {
	const matches: KeywordMatch[] = [];

	const kmpEngine = createKmpEngine();
	const boyerMooreEngine = createBoyerMooreEngine();
	const regexEngine = createRegexEngine();
	const fuzzyEngine = createFuzzyEngine();

	const kmpMatches = await kmpEngine.detect(context);
	const bmMatches = await boyerMooreEngine.detect(context);
	const exactKeywords = new Set<string>();

	for (const match of [...kmpMatches, ...bmMatches]) {
		exactKeywords.add(normalizeKeyword(match.keyword));
	}

	const regexMatches = await regexEngine.detect(context);
	const fuzzyMatches = await fuzzyEngine.detect({
		...context,
		exactMatchedKeywords: exactKeywords
	});

	[kmpMatches, bmMatches, regexMatches, fuzzyMatches].forEach((engineMatches) => {
		matches.push(...engineMatches.map((match) => ({
			...match,
			algorithm: match.algorithm
		})));
	});

	return matches;
}