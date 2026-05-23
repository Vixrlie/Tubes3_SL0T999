import type { ElementHighlight, KeywordMatch } from '../types';

const HIGHLIGHT_ATTRIBUTE = 'data-judol-highlight';

function storeOriginalOutline(element: HTMLElement): void {
	if (!element.dataset.originalOutline) {
		element.dataset.originalOutline = element.style.outline;
	}
}

export function clearHighlights(root: ParentNode = document): void {
	const highlightedElements = root.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTRIBUTE}="true"]`);
	highlightedElements.forEach((element) => {
		element.style.outline = element.dataset.originalOutline ?? '';
		element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
		delete element.dataset.originalOutline;
	});
}

export function applyHighlights(matches: KeywordMatch[]): ElementHighlight[] {
	const highlights: ElementHighlight[] = [];

	matches.forEach((match) => {
		const selector = `[data-judol-anchor="${CSS.escape(match.keyword)}"]`;
		const element = document.querySelector<HTMLElement>(selector);

		if (!element) {
			return;
		}

		storeOriginalOutline(element);
		element.style.outline = '2px solid #f97316';
		element.setAttribute(HIGHLIGHT_ATTRIBUTE, 'true');
		highlights.push({ element, match, originalOutline: element.dataset.originalOutline });
	});

	return highlights;
}
