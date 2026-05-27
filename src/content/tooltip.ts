import type { TooltipData } from '../types';

const TOOLTIP_ID = 'judol-tooltip';
const bindings = new WeakMap<HTMLElement, () => void>();

function getTooltipElement(): HTMLDivElement {
	let tooltip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;

	if (!tooltip) {
		tooltip = document.createElement('div');
		tooltip.id = TOOLTIP_ID;
		tooltip.style.position = 'fixed';
		tooltip.style.zIndex = '2147483647';
		tooltip.style.pointerEvents = 'none';
		tooltip.style.display = 'none';
		tooltip.setAttribute('role', 'status');
		tooltip.setAttribute('aria-live', 'polite');
		tooltip.setAttribute('aria-hidden', 'true');
		// Mark tooltip as internal UI so observers/scanners can ignore it
		tooltip.setAttribute('data-judol-ui', 'true');
		// Ensure it doesn't interfere with pointer events or keyboard
		tooltip.style.pointerEvents = 'none';
		tooltip.style.padding = '8px 10px';
		tooltip.style.borderRadius = '8px';
		tooltip.style.background = 'rgba(15, 23, 42, 0.96)';
		tooltip.style.color = '#e2e8f0';
		tooltip.style.fontSize = '12px';
		tooltip.style.lineHeight = '1.4';
		document.body.appendChild(tooltip);
	}

	return tooltip;
}

function setTooltipContent(data: TooltipData): void {
	const tooltip = getTooltipElement();
	tooltip.innerHTML = `
		<strong>${data.keyword}</strong><br>
		Algoritma: ${data.algorithm}<br>
		Kemunculan: ${data.occurrenceCount}<br>
		Waktu: ${data.executionTimeMs.toFixed(2)} ms
	`;
}

function positionTooltip(x: number, y: number): void {
	const tooltip = getTooltipElement();
	const padding = 12;
	const width = tooltip.offsetWidth || 240;
	const height = tooltip.offsetHeight || 80;
	const left = Math.min(x + padding, Math.max(padding, window.innerWidth - width - padding));
	const top = Math.min(y + padding, Math.max(padding, window.innerHeight - height - padding));

	tooltip.style.left = `${left}px`;
	tooltip.style.top = `${top}px`;
}

export function showTooltip(data: TooltipData, x: number, y: number): void {
	const tooltip = getTooltipElement();
	setTooltipContent(data);
	positionTooltip(x, y);
	tooltip.style.display = 'block';
	tooltip.setAttribute('aria-hidden', 'false');
}

export function moveTooltip(x: number, y: number): void {
	positionTooltip(x, y);
	const tooltip = getTooltipElement();
	tooltip.style.display = 'block';
}

export function hideTooltip(): void {
	const tooltip = getTooltipElement();
	tooltip.style.display = 'none';
	tooltip.setAttribute('aria-hidden', 'true');
}

export function isTooltipVisible(): boolean {
    const tooltip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
    return !!(tooltip && tooltip.style.display && tooltip.style.display !== 'none');
}

function handleTooltipMove(event: MouseEvent): void {
	moveTooltip(event.clientX, event.clientY);
}

function handleTooltipEnter(data: TooltipData, event: MouseEvent): void {
	showTooltip(data, event.clientX, event.clientY);
}

function handleTooltipLeave(): void {
	hideTooltip();
}

export function bindTooltipToElement(element: HTMLElement, data: TooltipData): void {
	unbindTooltipFromElement(element);

	const onEnter = (event: MouseEvent): void => handleTooltipEnter(data, event);
	const onMove = (event: MouseEvent): void => handleTooltipMove(event);
	const onLeave = (): void => handleTooltipLeave();

	element.addEventListener('mouseenter', onEnter);
	element.addEventListener('mousemove', onMove);
	element.addEventListener('mouseleave', onLeave);

	bindings.set(element, () => {
		element.removeEventListener('mouseenter', onEnter);
		element.removeEventListener('mousemove', onMove);
		element.removeEventListener('mouseleave', onLeave);
	});
}

export function unbindTooltipFromElement(element: HTMLElement): void {
	const cleanup = bindings.get(element);
	if (!cleanup) {
		return;
	}

	cleanup();
	bindings.delete(element);
}
