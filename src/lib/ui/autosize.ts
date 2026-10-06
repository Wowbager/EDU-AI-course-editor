/**
 * A multiline field grows with its wrapped text, from three rows up to fourteen.
 * Browsers with `field-sizing: content` do it in CSS; for the rest the box is measured
 * here. Layout only: nothing about the course.
 */
export const sizesItself = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

export function fitToText(area: HTMLTextAreaElement) {
	area.style.height = 'auto';
	const line = parseFloat(getComputedStyle(area).lineHeight) || 20;
	const pad = area.offsetHeight - area.clientHeight + 12;
	area.style.height = `${Math.min(Math.max(area.scrollHeight + 2, 3 * line + pad), 14 * line + pad)}px`;
}
