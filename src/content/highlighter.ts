import type { DetectionResult, ElementHighlight, KeywordMatch, ScanTarget, TooltipData } from '../types';
import { bindTooltipToElement, unbindTooltipFromElement } from './tooltip';

const HIGHLIGHT_ATTRIBUTE = 'data-judol-highlight';
const HIGHLIGHT_CLASS = 'judol-highlight';

function storeOriginalOutline(element: HTMLElement): void {
	if (!element.dataset.originalOutline) {
		element.dataset.originalOutline = element.style.outline;
	}
}

function clearElementState(element: HTMLElement): void {
	const originalOutline = element.dataset.originalOutline ?? '';
	element.style.outline = originalOutline;
	element.classList.remove(HIGHLIGHT_CLASS);
	element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
	delete element.dataset.originalOutline;
	delete element.dataset.judolKeyword;
	delete element.dataset.judolAlgorithm;
	delete element.dataset.judolSource;
	unbindTooltipFromElement(element);
}

export function clearHighlights(root: ParentNode = document): void {
	const highlightedElements = root.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTRIBUTE}="true"]`);
	highlightedElements.forEach((element) => {
		clearElementState(element);
	});
}

export function applyDetectionResult(result: DetectionResult, targets: ScanTarget[]): ElementHighlight[] {
	const highlights: ElementHighlight[] = [];
	const targetByIndex = new Map<number, ScanTarget>();

	targets.forEach((target) => {
		targetByIndex.set(target.index, target);
	});

	result.matches.forEach((match) => {
		const target = typeof match.targetIndex === 'number' ? targetByIndex.get(match.targetIndex) : undefined;
		if (!target) {
			return;
		}

		const element = target.element;
		const tooltipData: TooltipData = {
			keyword: match.keyword,
			algorithm: match.algorithm,
			occurrenceCount: match.occurrenceCount,
			executionTimeMs: match.executionTimeMs ?? 0
		};

		storeOriginalOutline(element);
		element.style.outline = '2px solid #f97316';
		element.classList.add(HIGHLIGHT_CLASS);
		element.setAttribute(HIGHLIGHT_ATTRIBUTE, 'true');
		element.dataset.judolKeyword = match.keyword;
		element.dataset.judolAlgorithm = match.algorithm;
		element.dataset.judolSource = match.source;
		bindTooltipToElement(element, tooltipData);
		highlights.push({ element, match, originalOutline: element.dataset.originalOutline });
	});

	return highlights;
}
