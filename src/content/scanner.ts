import type { ScanTarget } from '../types';

const SKIPPABLE_TAG_NAMES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK']);
const TEXT_CONTAINER_TAG_NAMES = new Set([
	'P',
	'LI',
	'DT',
	'DD',
	'ARTICLE',
	'SECTION',
	'MAIN',
	'ASIDE',
	'NAV',
	'BLOCKQUOTE',
	'PRE',
	'TD',
	'TH',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'BUTTON',
	'A',
	'LABEL',
	'SUMMARY',
	'FIGCAPTION'
]);

function isSkippableElement(element: Element): boolean {
	return SKIPPABLE_TAG_NAMES.has(element.tagName);
}

function isInsideJudolUi(node: Node | null): boolean {
	if (!node) return false;
	if (node instanceof Element) return node.closest('[data-judol-ui]') !== null;
	return node.parentElement?.closest('[data-judol-ui]') !== undefined && node.parentElement?.closest('[data-judol-ui]') !== null;
}

function isVisibleElement(element: HTMLElement): boolean {
	const computedStyle = window.getComputedStyle(element);
	return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden' && computedStyle.opacity !== '0';
}

function isMeaningfulTextParent(element: Element): element is HTMLElement {
	if (!(element instanceof HTMLElement)) {
		return false;
	}

    if (isSkippableElement(element)) {
		return false;
	}

	if (!isVisibleElement(element)) {
		return false;
	}

	// Skip any elements that are part of the extension's UI (tooltip etc.)
	if (isInsideJudolUi(element)) {
		return false;
	}

	return normalizeText(element.textContent ?? '').length > 0;
}

function selectTextContainer(node: Text): HTMLElement | null {
	let currentElement: HTMLElement | null = node.parentElement;

	while (currentElement) {
		if (isSkippableElement(currentElement) || !isVisibleElement(currentElement)) {
			return null;
		}

		// Don't select containers that are part of our UI
		if (isInsideJudolUi(currentElement)) return null;

		const text = normalizeText(currentElement.textContent ?? '');
		if (text.length === 0) {
			return null;
		}

		const hasPreferredRole = TEXT_CONTAINER_TAG_NAMES.has(currentElement.tagName);
		const hasOnlyTextOrInlineChildren = currentElement.childElementCount === 0 || currentElement.childElementCount === 1;

		if (hasPreferredRole || hasOnlyTextOrInlineChildren) {
			return currentElement;
		}

		currentElement = currentElement.parentElement;
	}

	return null;
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function collectScanTargets(root: ParentNode = document): ScanTarget[] {
	const targets: ScanTarget[] = [];
	const seenElements = new Set<HTMLElement>();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
	let currentNode: Node | null = walker.currentNode;
	let index = 0;

	while (currentNode !== null) {
		if (currentNode instanceof Text) {
			const text = normalizeText(currentNode.nodeValue ?? '');
			const parentElement = selectTextContainer(currentNode);

			// skip text nodes that are inside extension UI
			if (isInsideJudolUi(currentNode)) {
				currentNode = walker.nextNode();
				continue;
			}

			if (text.length > 0 && parentElement && isMeaningfulTextParent(parentElement) && !seenElements.has(parentElement)) {
				seenElements.add(parentElement);
				targets.push({
					element: parentElement,
					text,
					index,
					tagName: parentElement.tagName.toLowerCase()
				});
				index += 1;
			}
		}

		currentNode = walker.nextNode();
	}

	return targets;
}

function isElementVisible(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width < 16 || rect.height < 16) {
		return false;
	}

	return isVisibleElement(element);
}

function isValidImageSource(sourceUrl: string): boolean {
	if (!sourceUrl) {
		return false;
	}

	return !sourceUrl.startsWith('data:image/gif;base64,R0lGOD') && !sourceUrl.startsWith('data:image/svg+xml');
}

export function collectImageTargets(root: ParentNode = document, startIndex = 0): ScanTarget[] {
	const targets: ScanTarget[] = [];
	const seenSources = new Set<string>();
	const images = root.querySelectorAll<HTMLImageElement>('img');
	let index = startIndex;

	images.forEach((image) => {
		if (isInsideJudolUi(image) || !isElementVisible(image)) {
			return;
		}

		const sourceUrl = image.currentSrc || image.src;
		if (!isValidImageSource(sourceUrl) || seenSources.has(sourceUrl)) {
			return;
		}

		seenSources.add(sourceUrl);
		targets.push({
			element: image,
			text: normalizeText(image.alt || image.title || ''),
			index,
			tagName: 'img',
			kind: 'image',
			sourceUrl
		});
		index += 1;
	});

	return targets;
}

export function readDocumentText(root: ParentNode = document.body ?? document): string {
	return normalizeText(root.textContent ?? '');
}
