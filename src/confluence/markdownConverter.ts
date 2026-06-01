import type { App } from 'obsidian';
import MarkdownIt from 'markdown-it';
import { AttachmentRef } from '../types';
import { sha1Hex } from '../utils/hash';
import { resolveAttachmentFile } from './attachmentUploader';

export interface DiagramBlock {
	/** 源码 sha1 hex,作为缓存键与 filename 前缀 */
	hash: string;
	source: string;
	filename: string;
}

export interface ExtractedReferences {
	attachments: AttachmentRef[];
	mermaid: DiagramBlock[];
	plantUml: DiagramBlock[];
}

export interface ConvertContext {
	/** filename -> 已上传的附件记录(供 convert 阶段决定 img 是否替换为 ac:image) */
	attachedFilenames: Set<string>;
	/** hash -> 已成功上传的 mermaid PNG filename */
	mermaidFilenameByHash: Map<string, string>;
	/** hash -> 已成功上传的 plantuml PNG filename */
	plantUmlFilenameByHash: Map<string, string>;
	/** 配置开关 */
	renderMermaidToPng: boolean;
	renderPlantUmlToPng: boolean;
}

/**
 * markdown → Confluence storage XHTML 转换器。
 *
 * 用法:
 *   1. await extractReferences(markdown, sourcePath) — 拿到附件 + mermaid/plantuml 列表
 *   2. 上层调 AttachmentUploader / MermaidRenderer / PlantUmlRenderer 上传/渲染
 *   3. await convert(markdown, sourcePath, ctx) — 渲染最终 storage xhtml
 *
 * 拆两步是因为渲染图表/上传附件是 async + 网络,而 markdown-it 自身是同步的,
 * 上层先把网络密集型工作做完,convert 阶段只查表。
 */
export class MarkdownConverter {
	constructor(private app: App) {}

	async extractReferences(markdown: string, sourcePath: string): Promise<ExtractedReferences> {
		const body = stripFrontmatter(markdown);
		const preprocessed = preprocessObsidianSyntax(body);

		const attachments = this.collectAttachments(preprocessed, sourcePath);
		const mermaid = await this.collectDiagrams(preprocessed, 'mermaid');
		const plantUml = await this.collectDiagrams(preprocessed, 'plantuml');

		return { attachments, mermaid, plantUml };
	}

	async convert(markdown: string, sourcePath: string, ctx: ConvertContext): Promise<string> {
		const body = stripFrontmatter(markdown);
		const preprocessed = preprocessObsidianSyntax(body);

		// 预计算每个 fence 块的 hash,渲染器同步查表
		const fenceHashMap = await this.buildFenceHashMap(preprocessed);

		const md = this.buildRenderer(sourcePath, ctx, fenceHashMap);
		const html = md.render(preprocessed);

		return postProcessHtml(html, ctx);
	}

	/** 计算 markdown 内容(剥 frontmatter 后)的稳定哈希,用于 last_hash 去重 */
	async computeContentHash(markdown: string): Promise<string> {
		return sha1Hex(stripFrontmatter(markdown));
	}

	private collectAttachments(markdown: string, sourcePath: string): AttachmentRef[] {
		const refs: AttachmentRef[] = [];
		const seen = new Set<string>();

		// Obsidian embed:![[file.png|alt]] / ![[folder/file.png]]
		const embedRe = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = embedRe.exec(markdown)) !== null) {
			const linkpath = m[1]!.trim();
			const alt = (m[2] ?? '').trim();
			const tfile = resolveAttachmentFile(this.app, linkpath, sourcePath);
			const filename = tfile?.name ?? linkpath.split('/').pop() ?? linkpath;
			const key = `embed:${filename}`;
			if (seen.has(key)) continue;
			seen.add(key);
			refs.push({ rawMatch: m[0], linkpath, alt, tfile, filename });
		}

		// 标准 markdown 图片:![alt](path "title")
		// 仅相对路径或不带 scheme 的 URL 视为本地附件
		const imgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
		while ((m = imgRe.exec(markdown)) !== null) {
			const alt = m[1] ?? '';
			const path = m[2]!;
			if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(path) || path.startsWith('data:')) continue;
			const decoded = tryDecode(path);
			const tfile = resolveAttachmentFile(this.app, decoded, sourcePath);
			const filename = tfile?.name ?? decoded.split('/').pop() ?? decoded;
			const key = `img:${filename}`;
			if (seen.has(key)) continue;
			seen.add(key);
			refs.push({ rawMatch: m[0], linkpath: decoded, alt, tfile, filename });
		}

		return refs;
	}

	private async collectDiagrams(markdown: string, lang: 'mermaid' | 'plantuml'): Promise<DiagramBlock[]> {
		const blocks = extractFenceBlocks(markdown).filter((b) => b.lang === lang);
		const seen = new Set<string>();
		const out: DiagramBlock[] = [];
		for (const b of blocks) {
			const hash = await sha1Hex(b.content);
			if (seen.has(hash)) continue;
			seen.add(hash);
			out.push({ hash, source: b.content, filename: `${lang}-${hash}.png` });
		}
		return out;
	}

	private async buildFenceHashMap(markdown: string): Promise<Map<string, string>> {
		// key: "lang|content" → hash
		const map = new Map<string, string>();
		const blocks = extractFenceBlocks(markdown);
		for (const b of blocks) {
			if (b.lang !== 'mermaid' && b.lang !== 'plantuml') continue;
			const key = `${b.lang}|${b.content}`;
			if (map.has(key)) continue;
			map.set(key, await sha1Hex(b.content));
		}
		return map;
	}

	private buildRenderer(sourcePath: string, ctx: ConvertContext, fenceHashes: Map<string, string>): MarkdownIt {
		// xhtmlOut: true — Confluence storage 是严格 XHTML,空元素必须自闭合(<hr /> 而非 <hr>)
		const md = new MarkdownIt({ html: false, xhtmlOut: true, breaks: false, linkify: true });

		// fence: 代码块 + 图表
		md.renderer.rules.fence = (tokens, idx) => {
			const token = tokens[idx]!;
			const lang = (token.info || '').trim().toLowerCase();
			// markdown-it fence token 的 content 末尾会带 \n,
			// 而我们 extractFenceBlocks 输出不含,统一 normalize 后再查 map。
			const content = token.content.replace(/\n+$/, '');

			if (lang === 'mermaid' && ctx.renderMermaidToPng) {
				const hash = fenceHashes.get(`mermaid|${content}`);
				const filename = hash ? ctx.mermaidFilenameByHash.get(hash) : undefined;
				if (filename) return renderAcImage(filename, '');
			}
			if (lang === 'plantuml' && ctx.renderPlantUmlToPng) {
				const hash = fenceHashes.get(`plantuml|${content}`);
				const filename = hash ? ctx.plantUmlFilenameByHash.get(hash) : undefined;
				if (filename) return renderAcImage(filename, '');
			}
			return renderAcCode(lang, content);
		};

		md.renderer.rules.code_block = (tokens, idx) => {
			return renderAcCode('', tokens[idx]!.content);
		};

		// image: 替换为 ac:image(对存在的附件) 或 原 src 外链
		md.renderer.rules.image = (tokens, idx) => {
			const token = tokens[idx]!;
			const src = token.attrGet('src') ?? '';
			const alt = token.content || '';
			if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(src) || src.startsWith('data:')) {
				return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;
			}
			const decoded = tryDecode(src);
			const filename = decoded.split('/').pop() ?? decoded;
			if (ctx.attachedFilenames.has(filename)) {
				return renderAcImage(filename, alt);
			}
			return `<!-- 未上传的附件: ${escapeAttr(filename)} -->`;
		};

		// callout: 通过自定义 blockquote 包装实现
		const originalBlockquoteOpen = md.renderer.rules.blockquote_open;
		const originalBlockquoteClose = md.renderer.rules.blockquote_close;
		md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
			const calloutType = detectCalloutType(tokens, idx);
			if (calloutType) {
				env.__calloutOpen = true;
				return `<ac:structured-macro ac:name="${calloutType.macro}"><ac:rich-text-body>`;
			}
			return originalBlockquoteOpen
				? originalBlockquoteOpen(tokens, idx, options, env, self)
				: self.renderToken(tokens, idx, options);
		};
		md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
			if (env.__calloutOpen) {
				env.__calloutOpen = false;
				return `</ac:rich-text-body></ac:structured-macro>`;
			}
			return originalBlockquoteClose
				? originalBlockquoteClose(tokens, idx, options, env, self)
				: self.renderToken(tokens, idx, options);
		};

		// inline html(原本 html:false 已禁,这里兜底)
		md.renderer.rules.html_block = () => '';
		md.renderer.rules.html_inline = () => '';

		return md;
	}
}

// ============ 辅助:文本处理 ============

function stripFrontmatter(md: string): string {
	if (!md.startsWith('---')) return md;
	const m = md.match(/^---\n[\s\S]*?\n---\n?/);
	if (!m) return md;
	return md.slice(m[0].length);
}

/**
 * 对 Obsidian 专属语法做最小预处理,让 markdown-it 能合理解析。
 * - ![[file]] 转换为 ![alt](file) 标准图片(具体替换 ac:image 由 image renderer 完成)
 * - [[link|alias]] 转换为纯文本 alias(或 link)
 * - callout `> [!type] Title\n> body` 在第一行替换为 `> **TYPE: Title**\n> body`,
 *   随后 blockquote_open 渲染器根据这个特征转 ac:structured-macro
 */
function preprocessObsidianSyntax(md: string): string {
	// 1. ![[...]] embed → ![alt](path)
	md = md.replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_full, link: string, alias: string) => {
		const text = (alias ?? '').trim();
		return `![${text}](${link.trim()})`;
	});

	// 2. [[link|alias]] / [[link]] → alias(纯文本)
	md = md.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_full, link: string, alias: string) => {
		const text = (alias ?? '').trim() || link.trim().split('/').pop() || link;
		return text;
	});

	// 3. callout 头部:`> [!info] Title` → 标记式 `> __CALLOUT_INFO__ Title`
	md = md.replace(/^(> )\[!([a-zA-Z]+)\](.*)$/gm, (_full, prefix: string, type: string, rest: string) => {
		return `${prefix}__CALLOUT_${type.toUpperCase()}__${rest}`;
	});

	return md;
}

interface FenceBlock { lang: string; content: string; }

/** 从原始 markdown 中提取所有 ``` fence 块。简化实现,与 markdown-it 规则可能略有偏差但够用 */
function extractFenceBlocks(markdown: string): FenceBlock[] {
	const out: FenceBlock[] = [];
	const lines = markdown.split('\n');
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w-]*)\s*$/);
		if (!m) { i += 1; continue; }
		const indent = m[1]!.length;
		const fence = m[2]!;
		const lang = (m[3] ?? '').toLowerCase();
		const start = i + 1;
		i = start;
		while (i < lines.length) {
			const closing = lines[i]!.match(/^(\s*)(`{3,}|~{3,})\s*$/);
			if (closing && closing[2]!.startsWith(fence[0]!) && closing[2]!.length >= fence.length && closing[1]!.length === indent) {
				break;
			}
			i += 1;
		}
		const content = lines.slice(start, i).join('\n');
		out.push({ lang, content });
		i += 1;
	}
	return out;
}

interface CalloutType { type: string; macro: string; }

/** 检测 blockquote_open 之后的第一段是否是 callout 前缀 */
function detectCalloutType(tokens: ReadonlyArray<{ type: string; content?: string; children?: Array<{ content: string }> | null }>, openIdx: number): CalloutType | null {
	for (let i = openIdx + 1; i < tokens.length; i++) {
		const tk = tokens[i]!;
		if (tk.type === 'blockquote_close') return null;
		if (tk.type !== 'inline') continue;
		const text = (tk.children?.[0]?.content ?? tk.content ?? '');
		const m = text.match(/^__CALLOUT_([A-Z]+)__/);
		if (!m) return null;
		// 把前缀从首个 text token 移除,留下标题
		if (tk.children?.[0]) {
			tk.children[0].content = tk.children[0].content.replace(/^__CALLOUT_[A-Z]+__\s*/, '');
		} else {
			tk.content = tk.content?.replace(/^__CALLOUT_[A-Z]+__\s*/, '') ?? '';
		}
		const type = m[1]!;
		return { type, macro: mapCalloutMacro(type) };
	}
	return null;
}

function mapCalloutMacro(type: string): string {
	switch (type) {
		case 'NOTE':
		case 'INFO':
		case 'TIP':
		case 'HINT': return 'info';
		case 'WARNING':
		case 'CAUTION':
		case 'ATTENTION': return 'warning';
		case 'DANGER':
		case 'ERROR':
		case 'FAILURE':
		case 'BUG': return 'note'; // Confluence 没有 danger,用红色 note
		case 'SUCCESS':
		case 'CHECK':
		case 'DONE': return 'tip';
		case 'QUOTE': return 'expand';
		default: return 'info';
	}
}

function renderAcCode(language: string, code: string): string {
	const langPart = language ? `<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>` : '';
	return `<ac:structured-macro ac:name="code">${langPart}<ac:plain-text-body><![CDATA[${cdataSafe(code)}]]></ac:plain-text-body></ac:structured-macro>`;
}

function renderAcImage(filename: string, alt: string): string {
	const altPart = alt ? ` ac:alt="${escapeAttr(alt)}"` : '';
	return `<ac:image${altPart}><ri:attachment ri:filename="${escapeAttr(filename)}" /></ac:image>`;
}

function postProcessHtml(html: string, _ctx: ConvertContext): string {
	// markdown-it xhtmlOut=true 已经处理 br/hr/img,但兜底:HTML 里所有 void element
	// 在 Confluence storage(严格 XHTML)里都必须自闭合,否则 1 个未闭合会让解析器把
	// 后续所有标签都当子元素,直到撞到匹配不上的关闭标签就 400 报错。
	const voidElements = ['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr'];
	let out = html;
	for (const tag of voidElements) {
		const re = new RegExp(`<${tag}\\b([^>]*?)(?<!/)>`, 'gi');
		out = out.replace(re, `<${tag}$1 />`);
	}
	return stripSupplementaryChars(out).trim();
}

/**
 * Confluence Server 默认 MySQL 用 utf8 (3-byte),装不下 codePoint > 0xFFFF 的字符
 * (emoji 🆕、汉字扩展区 𠮷 等),触发 400 "Unsupported character found in content"。
 *
 * 策略:替换为 `[U+XXXX]` 文本占位,既保留信息也是纯 ASCII,绕过数据库 charset 限制。
 * 如果用户站点是 utf8mb4 (Cloud 都是),这一步是无害的。
 */
function stripSupplementaryChars(s: string): string {
	let out = '';
	for (const ch of s) {
		const cp = ch.codePointAt(0)!;
		if (cp > 0xFFFF) {
			out += `[U+${cp.toString(16).toUpperCase()}]`;
		} else {
			out += ch;
		}
	}
	return out;
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
	return escapeXml(s).replace(/"/g, '&quot;');
}

function cdataSafe(s: string): string {
	// 不允许 "]]>" 出现在 CDATA 中,拆开
	return s.replace(/]]>/g, ']]]]><![CDATA[>');
}

function tryDecode(s: string): string {
	try { return decodeURIComponent(s); } catch { return s; }
}
