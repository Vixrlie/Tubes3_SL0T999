import type { DetectionContext, DetectionEngine, KeywordMatch } from '../types';
import { loadKeywords, normalizeKeyword, nowMs } from './shared';

interface TrieNode {
	children: Map<string, TrieNode>;
	fail: TrieNode | null;
	outputs: string[];
}

function createNode(): TrieNode {
	return {
		children: new Map(),
		fail: null,
		outputs: []
	};
}

function buildTrie(keywords: string[]): TrieNode {
	const root = createNode();
	for (const keyword of keywords) {
		if (!keyword) {
			continue;
		}
		let node = root;
		for (const ch of keyword) {
			let next = node.children.get(ch);
			if (!next) {
				next = createNode();
				node.children.set(ch, next);
			}
			node = next;
		}
		node.outputs.push(keyword);
	}
	return root;
}

function buildFailureLinks(root: TrieNode): void {
	const queue: TrieNode[] = [];
	root.fail = root;
	root.children.forEach((child) => {
		child.fail = root;
		queue.push(child);
	});

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) {
			continue;
		}

		current.children.forEach((child, ch) => {
			let fallback = current.fail;
			// Walk fail links until we find a node that has this edge.
			while (fallback && fallback !== root && !fallback.children.has(ch)) {
				fallback = fallback.fail;
			}

			if (fallback && fallback.children.has(ch)) {
				child.fail = fallback.children.get(ch) ?? root;
			} else {
				child.fail = root;
			}

			if (child.fail && child.fail.outputs.length > 0) {
				child.outputs = child.outputs.concat(child.fail.outputs);
			}

			queue.push(child);
		});
	}
}

export function createAhoCorasickEngine(): DetectionEngine {
	return {
		name: 'AhoCorasick',
		detect: async (context: DetectionContext): Promise<KeywordMatch[]> => {
			const rawKeywords = await loadKeywords();
			const keywords = rawKeywords
				.map((keyword) => normalizeKeyword(keyword))
				.filter((keyword) => keyword.length > 0);
			const root = buildTrie(keywords);
			buildFailureLinks(root);

			const matches: KeywordMatch[] = [];
			const startTime = nowMs();

			for (const target of context.targets) {
				const text = target.text;
				if (text.length === 0) {
					continue;
				}

				const lowerText = text.toLowerCase();
				const perKeyword = new Map<string, number[]>();
				let node = root;
				let comparisons = 0;

				for (let index = 0; index < lowerText.length; index += 1) {
					const ch = lowerText[index];
					while (node !== root && !node.children.has(ch)) {
						comparisons += 1;
						node = node.fail ?? root;
					}
					comparisons += 1;
					const next = node.children.get(ch);
					if (next) {
						node = next;
					} else {
						node = root;
					}

					if (node.outputs.length > 0) {
						for (const keyword of node.outputs) {
							const endIndex = index + 1;
							const startIndex = endIndex - keyword.length;
							const occurrences = perKeyword.get(keyword);
							if (occurrences) {
								occurrences.push(startIndex);
							} else {
								perKeyword.set(keyword, [startIndex]);
							}
						}
					}
				}

				perKeyword.forEach((occurrences, keyword) => {
					for (const startIndex of occurrences) {
						const endIndex = startIndex + keyword.length;
						matches.push({
							keyword,
							matchedText: text.slice(startIndex, endIndex),
							algorithm: 'AhoCorasick',
							source: 'exact',
							startIndex,
							endIndex,
							occurrenceCount: occurrences.length,
							targetIndex: target.index,
							comparisonCount: comparisons
						});
					}
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
