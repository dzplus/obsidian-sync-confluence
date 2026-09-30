const TOC_MARKER = 'CONFLUENCE_TOC';

/** Longest-first so "Contents" does not match inside "Table of Contents". */
const TOC_CALLOUT_TITLES = [
	'Table of Contents',
	'Contents',
	'TOC',
	'目录',
] as const;

const TOC_TITLE_ALT = TOC_CALLOUT_TITLES
	.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	.join('|');

const TOC_CALLOUT_RE = new RegExp(
	`^>[ \\t]*\\[!summary\\][+-]?[ \\t]+(?:${TOC_TITLE_ALT})[ \\t]*(?:\\r?\\n|$)(?:^>[^\\r\\n]*(?:\\r?\\n|$))*`,
	'gim',
);

const WIKILINK_HEADING_RE = /\[\[#(?!\^)[^\]\r\n]+\]\]/;
const MARKDOWN_HEADING_RE = /\[[^\]\r\n]+\]\((?:<#[^>\r\n]+>|#[^\s)\r\n]+)\)/;
const TOC_PARAGRAPH_RE = new RegExp(`<p>\\s*${TOC_MARKER}\\s*</p>`, 'g');

const CONFLUENCE_TOC_MACRO =
	'<ac:structured-macro ac:name="toc">' +
	'<ac:parameter ac:name="minLevel">2</ac:parameter>' +
	'<ac:parameter ac:name="maxLevel">3</ac:parameter>' +
	'</ac:structured-macro>';

/**
 * Replace a hand-written Obsidian TOC callout with a private marker.
 *
 * Matches only summary callouts titled 目录, Contents, Table of Contents,
 * or TOC, and only when the body contains same-page heading links — so
 * ordinary summary callouts are not misclassified. Callers should mask
 * code regions first so callout syntax in examples is not converted.
 */
export function replaceMarkdownTocCallouts(markdown: string): string {
	return markdown.replace(TOC_CALLOUT_RE, (block) => {
		if (!WIKILINK_HEADING_RE.test(block) && !MARKDOWN_HEADING_RE.test(block)) {
			return block;
		}
		const trailingNewline = block.endsWith('\r\n') ? '\r\n' : block.endsWith('\n') ? '\n' : '';
		return TOC_MARKER + trailingNewline;
	});
}

/** 把经 markdown-it 渲染后的目录标记替换成 Confluence 官方 TOC 宏。 */
export function replaceTocMarkersWithMacros(html: string): string {
	return html.replace(TOC_PARAGRAPH_RE, CONFLUENCE_TOC_MACRO);
}
