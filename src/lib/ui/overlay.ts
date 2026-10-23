/**
 * Whether something drawn above the page is open: a modal dialog or a popover (menu,
 * picker, rail panel). Escape then belongs to it, and a panel that also listens on the
 * window must leave the key alone. A modal closes through `oncancel`, which does not
 * mark the keydown as handled.
 */
export const overlayOpen = (root: Pick<ParentNode, 'querySelector'> = document): boolean =>
	root.querySelector('dialog[open], :popover-open') !== null;
