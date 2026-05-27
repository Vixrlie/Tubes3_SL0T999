export type AlgorithmName = 'KMP' | 'BM' | 'Regex' | 'Fuzzy' | 'AhoCorasick' | 'RabinKarp';

export interface DetectionContext {
	url: string;
	text: string;
	timestamp: number;
	targets: ScanTarget[];
	exactMatchedKeywords?: Set<string>;
}

export interface DetectionEngine {
	name: AlgorithmName;
	detect(context: DetectionContext): Promise<KeywordMatch[]> | KeywordMatch[];
}

export type MatchSource = 'exact' | 'regex' | 'fuzzy';

export type MatchKind = 'keyword' | 'pattern' | 'image' | 'tooltip';

export interface KeywordMatch {
	keyword: string;
	matchedText: string;
	algorithm: AlgorithmName;
	source: MatchSource;
	startIndex: number;
	endIndex: number;
	occurrenceCount: number;
	targetIndex?: number;
	comparisonCount?: number;
	score?: number;
	executionTimeMs?: number;
}

export interface DetectionResult {
	matches: KeywordMatch[];
	totalMatches: number;
	exactMatches: number;
	regexMatches: number;
	fuzzyMatches: number;
	scannedTextLength: number;
	executionTimeMs: number;
}

export interface ElementHighlight {
	element: HTMLElement;
	match: KeywordMatch;
	originalOutline?: string;
	originalDataset?: string;
}

export interface PopupStats {
	totalKeywords: number;
	exactMatches: number;
	regexMatches: number;
	fuzzyMatches: number;
	kmpMatches: number;
	bmMatches: number;
	ahoCorasickMatches: number;
	rabinKarpMatches: number;
	executionTimeMsKmp: number;
	executionTimeMsBm: number;
	executionTimeMsAhoCorasick: number;
	executionTimeMsRabinKarp: number;
	executionTimeMsRegex: number;
	executionTimeMsFuzzy: number;
	lastScanMs: number;
}

export interface TooltipData {
	keyword: string;
	algorithm: AlgorithmName;
	occurrenceCount: number;
	executionTimeMs: number;
}

export interface ScanRequest {
	url: string;
	text: string;
	timestamp: number;
}

export interface ScanResponse {
	ok: boolean;
	result?: DetectionResult;
	error?: string;
}

export interface ScanTarget {
	element: HTMLElement;
	text: string;
	index: number;
	tagName: string;
}

export interface ContentPipelineState {
	request: ScanRequest;
	targets: ScanTarget[];
}
