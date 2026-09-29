/**
 * Where a menu goes, as a pure function so the edge cases can be tested without a
 * browser. The menu is `position: fixed` in the top layer, so everything here is in
 * viewport coordinates, the same ones `getBoundingClientRect()` returns.
 */
export type Rect = { top: number; left: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type Placement = 'bottom-start' | 'bottom-end' | 'right-start';

/** The menu never touches the window edge. */
export const VIEWPORT_MARGIN = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * `bottom-*` opens below the anchor and flips above it when it would not fit below;
 * `right-start` opens beside it and flips to its left. After the flip the result is
 * clamped into the viewport, so a menu taller or wider than the window still starts
 * on screen rather than being cut off at the top or left.
 */
export function placeMenu(
	anchor: Rect,
	menu: Size,
	viewport: Size,
	placement: Placement,
	gap = 4
): { top: number; left: number } {
	let top: number;
	let left: number;

	if (placement === 'right-start') {
		top = anchor.top;
		left = anchor.right + gap;
		if (left + menu.width + VIEWPORT_MARGIN > viewport.width) {
			left = anchor.left - gap - menu.width;
		}
	} else {
		left = placement === 'bottom-end' ? anchor.right - menu.width : anchor.left;
		top = anchor.bottom + gap;
		if (top + menu.height + VIEWPORT_MARGIN > viewport.height) {
			top = anchor.top - gap - menu.height;
		}
	}

	return {
		top: clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - menu.height - VIEWPORT_MARGIN)),
		left: clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - menu.width - VIEWPORT_MARGIN))
	};
}
