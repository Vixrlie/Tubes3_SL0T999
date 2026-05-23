import type { TooltipData } from '../types';

const TOOLTIP_ID = 'judol-tooltip';

function getTooltipElement(): HTMLDivElement {
	let tooltip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;

	if (!tooltip) {
		tooltip = document.createElement('div');
		tooltip.id = TOOLTIP_ID;
		tooltip.style.position = 'fixed';
		tooltip.style.zIndex = '2147483647';
		tooltip.style.pointerEvents = 'none';
		tooltip.style.display = 'none';
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

export function renderTooltip(data: TooltipData): void {
	const tooltip = getTooltipElement();
	tooltip.innerHTML = `
		<strong>${data.keyword}</strong><br>
		Algoritma: ${data.algorithm}<br>
		Kemunculan: ${data.occurrenceCount}<br>
		Waktu: ${data.executionTimeMs.toFixed(2)} ms
	`;
	tooltip.style.display = 'block';
}

export function moveTooltip(x: number, y: number): void {
	const tooltip = document.getElementById(TOOLTIP_ID);
	if (!tooltip) {
		return;
	}

	tooltip.style.left = `${x + 12}px`;
	tooltip.style.top = `${y + 12}px`;
}

export function hideTooltip(): void {
	const tooltip = document.getElementById(TOOLTIP_ID);
	if (!tooltip) {
		return;
	}

	tooltip.style.display = 'none';
}
