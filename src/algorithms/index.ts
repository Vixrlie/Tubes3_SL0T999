import type { DetectionContext, KeywordMatch } from '../types';
import { createAhoCorasickEngine } from './ahoCorasick';
import { createBoyerMooreEngine } from './boyerMoore';
import { createFuzzyEngine } from './weightedLevenshtein';
import { createKmpEngine } from './kmp';
import { createRabinKarpEngine } from './rabinKarp';
import { createRegexEngine } from './regex';
import { normalizeKeyword, nowMs } from './shared';

export interface DetectionTimings {
	kmp: number;
	bm: number;
	ahoCorasick: number;
	rabinKarp: number;
	regex: number;
	fuzzy: number;
}

export async function runDetectionEngines(context: DetectionContext): Promise<KeywordMatch[]> {
	const { matches } = await runDetectionEnginesDetailed(context);
	return matches;
}

export async function runDetectionEnginesDetailed(context: DetectionContext): Promise<{ matches: KeywordMatch[]; timings: DetectionTimings }> {
	const kmpEngine = createKmpEngine();
	const boyerMooreEngine = createBoyerMooreEngine();
	const ahoCorasickEngine = createAhoCorasickEngine();
	const rabinKarpEngine = createRabinKarpEngine();
	const regexEngine = createRegexEngine();
	const fuzzyEngine = createFuzzyEngine();

	const kmpStart = nowMs();
	const kmpMatches = await kmpEngine.detect(context);
	const kmpTime = nowMs() - kmpStart;

	const bmStart = nowMs();
	const bmMatches = await boyerMooreEngine.detect(context);
	const bmTime = nowMs() - bmStart;

	const ahoStart = nowMs();
	const ahoMatches = await ahoCorasickEngine.detect(context);
	const ahoTime = nowMs() - ahoStart;

	const rkStart = nowMs();
	const rkMatches = await rabinKarpEngine.detect(context);
	const rkTime = nowMs() - rkStart;

	const exactKeywords = new Set<string>();
	for (const match of [...kmpMatches, ...bmMatches, ...ahoMatches, ...rkMatches]) {
		exactKeywords.add(normalizeKeyword(match.keyword));
	}

	const regexStart = nowMs();
	const regexMatches = await regexEngine.detect(context);
	const regexTime = nowMs() - regexStart;

	const fuzzyStart = nowMs();
	const fuzzyMatches = await fuzzyEngine.detect({
		...context,
		exactMatchedKeywords: exactKeywords
	});
	const fuzzyTime = nowMs() - fuzzyStart;

	const matches: KeywordMatch[] = [];
	[kmpMatches, bmMatches, ahoMatches, rkMatches, regexMatches, fuzzyMatches].forEach((engineMatches) => {
		matches.push(...engineMatches.map((match) => ({ ...match })));
	});

	return {
		matches,
		timings: {
			kmp: kmpTime,
			bm: bmTime,
			ahoCorasick: ahoTime,
			rabinKarp: rkTime,
			regex: regexTime,
			fuzzy: fuzzyTime
		}
	};
}