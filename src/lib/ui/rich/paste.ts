/**
 * What arrives on the clipboard, made into what the app can show.
 *
 * The editor's schema is the final whitelist: whatever it has no node or mark for is
 * dropped. This file only undoes the ways Word, Google Docs and web pages *encode*
 * formatting the schema does have — bold as a styled span, a list as paragraphs with a
 * drawn bullet — so it is kept rather than lost, and strips the rest (fonts, colours,
 * sizes) before the schema has to guess.
 */
import { looksLikeMarkdown } from '$lib/domain/markdown';

const BOLD = /font-weight\s*:\s*(bold|[6-9]00)/i;
const NOT_BOLD = /font-weight\s*:\s*(normal|[1-5]00)/i;
const ITALIC = /font-style\s*:\s*italic/i;
const STRIKE = /text-decoration[^;]*line-through/i;

/** An address the app can load an image from. */
export const isImageAddress = (url: string) => /^https:\/\/\S+$/i.test(url.trim());

/** A pasted line that is only an image's address. */
export const IMAGE_URL = /^https:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i;

export function cleanPastedHtml(html: string): string {
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	const body = parsed.body;

	// Word's conditional comments, its <o:p> paragraph marks, and anything that is not
	// content.
	const walker = parsed.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
	const comments: Node[] = [];
	while (walker.nextNode()) comments.push(walker.currentNode);
	comments.forEach((c) => c.parentNode?.removeChild(c));
	body
		.querySelectorAll('style, meta, link, script, title, xml, o\\:p')
		.forEach((el) => el.remove());

	// Google Docs wraps the whole selection in <b style="font-weight:normal">.
	body.querySelectorAll('b[id^="docs-internal-guid"]').forEach(unwrap);
	body.querySelectorAll('b, strong').forEach((el) => {
		if (NOT_BOLD.test(el.getAttribute('style') ?? '')) unwrap(el);
	});

	// Formatting written as style: Google Docs and many web editors.
	body.querySelectorAll<HTMLElement>('span, font').forEach((el) => {
		const style = el.getAttribute('style') ?? '';
		let inner: Node = el;
		const wrap = (tag: string) => {
			const wrapper = parsed.createElement(tag);
			while (inner.firstChild) wrapper.appendChild(inner.firstChild);
			inner.appendChild(wrapper);
			inner = wrapper;
		};
		if (BOLD.test(style)) wrap('strong');
		if (ITALIC.test(style)) wrap('em');
		if (STRIKE.test(style)) wrap('s');
	});

	wordLists(parsed);

	// The app styles three heading levels. A heading copied from another field keeps
	// its own (`data-level`).
	body.querySelectorAll('h4, h5, h6').forEach((el) => {
		if (!el.hasAttribute('data-level')) rename(el, 'h3');
	});

	// Images the app cannot load: a local file, a data: URL, an http:// address.
	body.querySelectorAll('img').forEach((img) => {
		if (!isImageAddress(img.getAttribute('src') ?? '')) img.remove();
	});

	// What remains of looks: style, class, fonts.
	body.querySelectorAll('*').forEach((el) => {
		for (const attr of [...el.attributes]) {
			if (
				![
					'href',
					'src',
					'alt',
					'title',
					'colspan',
					'rowspan',
					'data-math',
					'data-latex',
					'data-display',
					'data-level'
				].includes(attr.name)
			)
				el.removeAttribute(attr.name);
		}
	});
	body.querySelectorAll('font, span:not([data-math])').forEach(unwrap);

	return body.innerHTML;
}

/**
 * Word writes a list as paragraphs, `class="MsoListParagraph…"`, each opening with a
 * drawn bullet or number in `mso-list:Ignore`. Back into a real list.
 */
function wordLists(parsed: Document): void {
	const items = [
		...parsed.body.querySelectorAll<HTMLElement>('p[class^="MsoList"], p[style*="mso-list"]')
	];
	let list: HTMLElement | null = null;
	let previous: Element | null = null;
	for (const p of items) {
		const marker = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
		const ordered = /^\s*[\da-z]+[.)]/i.test(marker?.textContent ?? '');
		marker?.remove();
		if (!list || previous !== p.previousElementSibling || (list.tagName === 'OL') !== ordered) {
			list = parsed.createElement(ordered ? 'ol' : 'ul');
			p.before(list);
		}
		const li = parsed.createElement('li');
		while (p.firstChild) li.appendChild(p.firstChild);
		list.appendChild(li);
		p.remove();
		previous = list;
	}
}

function unwrap(el: Element): void {
	el.replaceWith(...el.childNodes);
}

function rename(el: Element, tag: string): void {
	const next = el.ownerDocument.createElement(tag);
	next.append(...el.childNodes);
	el.replaceWith(next);
}

/**
 * Plain text that is meant as Markdown: copied from another field, a chat, a text
 * editor. The app's own test, plus the line starts any Markdown writer uses.
 */
export function pastedTextIsMarkdown(text: string): boolean {
	return looksLikeMarkdown(text) || /^(#{1,3} |[-*+] |\d+\. |> |\|.*\|\s*$)/m.test(text);
}
