import type { ScanTarget } from '../types';

function isSkippableElement(element: Element): boolean {
	return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK'].includes(element.tagName);
}

function isMeaningfulTextParent(element: Element): element is HTMLElement {
	if (!(element instanceof HTMLElement)) {
		return false;
	}

	if (isSkippableElement(element)) {
		return false;
	}

	return normalizeText(element.textContent ?? '').length > 0;
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function collectScanTargets(root: ParentNode = document): ScanTarget[] {
	const targets: ScanTarget[] = [];
	const seenElements = new Set<HTMLElement>();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
	let currentNode: Node | null = walker.currentNode;

	while (currentNode !== null) {
		if (currentNode instanceof Text) {
			const text = normalizeText(currentNode.nodeValue ?? '');
			const parentElement = currentNode.parentElement;

			if (text.length > 0 && parentElement && isMeaningfulTextParent(parentElement) && !seenElements.has(parentElement)) {
				seenElements.add(parentElement);
				targets.push({ element: parentElement, text });
			}
		}

		currentNode = walker.nextNode();
	}

	return targets;
}

export function readDocumentText(root: ParentNode = document.body ?? document): string {
	return normalizeText(root.textContent ?? '');
}
