export { parseMarkdown, type Parsed } from './parse';
export { serializeMarkdown } from './serialize';
export { canEditVisually, sameDoc } from './lossless';
export { looksLikeMarkdown, looksLikeHtml } from './app-dialect';
export {
	SNIFFED,
	ALWAYS_MARKDOWN,
	INLINE,
	type DocNode,
	type Mark,
	type MarkdownDialect
} from './doc';
