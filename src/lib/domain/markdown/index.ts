export { parseMarkdown, type Parsed } from './parse';
export { serializeMarkdown, typedText } from './serialize';
export { canEditVisually, sameDoc } from './lossless';
export {
	looksLikeMarkdown,
	looksLikeHtml,
	escapePlainLines,
	unescapePlainLines
} from './app-dialect';
export {
	SNIFFED,
	ALWAYS_MARKDOWN,
	INLINE,
	toOneLine,
	type DocNode,
	type Mark,
	type MarkdownDialect
} from './doc';
