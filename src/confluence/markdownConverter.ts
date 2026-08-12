import type { App } from 'obsidian';
import MarkdownIt from 'markdown-it';
import { AttachmentRef } from '../types';
import { sha1Hex } from '../utils/hash';
import { resolveAttachmentFile } from './attachmentUploader';
import { replaceMarkdownTocCallouts, replaceTocMarkersWithMacros } from './tocConverter';

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

/** markdown-it env 类型上是 `any`,我们只塞一个 callout 状态位 */
interface CalloutEnv { __calloutOpen?: boolean }

export interface ResolvedWikilink {
	url: string;
	/** Confluence 页面标题;跨页锚点需要用它生成 ri:page */
	title?: string;
}

export type WikilinkResolution = string | ResolvedWikilink;

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
	/** 普通附件图片的 Confluence 显示宽度(px);0=原始大小 */
	defaultImageWidthPx: number;
	/**
	 * 兼容老 Confluence Server(MySQL utf8 3-byte):把 codePoint > 0xFFFF 的字符
	 * (emoji 等)替换为 [U+XXXX] 占位。默认关闭,emoji 原样保留(issue #5)。
	 */
	stripSupplementaryChars: boolean;
	/**
	 * 把 Obsidian 的 [[wikilink]] 解析成目标 Confluence 页面 URL / 标题。
	 * 返回 null/undefined → 维持原行为(降级为纯文本)。
	 */
	resolveWikilink?: (linkpath: string, sourcePath: string) => WikilinkResolution | null;
	/**
	 * 把 @[[Name]] mention 解析成 Confluence 用户名(issue #3,Server/DC 的 ri:username)。
	 * 返回 null/undefined → 降级为纯文本 `@Name`。
	 */
	resolveMention?: (linkpath: string, sourcePath: string) => string | null;
}

interface PreprocessOptions {
	resolveWikilink?: (linkpath: string, sourcePath: string) => WikilinkResolution | null;
	resolveMention?: (linkpath: string, sourcePath: string) => string | null;
	sourcePath?: string;
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

	async extractReferences(
		markdown: string,
		sourcePath: string,
		opts?: { mermaidExt?: 'svg' | 'png'; plantUmlExt?: 'svg' | 'png' },
	): Promise<ExtractedReferences> {
		const body = stripFrontmatter(markdown);
		const preprocessed = preprocessObsidianSyntax(body);

		const attachments = this.collectAttachments(preprocessed, sourcePath);
		const mermaid = await this.collectDiagrams(preprocessed, 'mermaid', opts?.mermaidExt ?? 'png');
		const plantUml = await this.collectDiagrams(preprocessed, 'plantuml', opts?.plantUmlExt ?? 'png');

		return { attachments, mermaid, plantUml };
	}

	async convert(markdown: string, sourcePath: string, ctx: ConvertContext): Promise<string> {
		const body = stripFrontmatter(markdown);
		const preprocessed = preprocessObsidianSyntax(body, {
			resolveWikilink: ctx.resolveWikilink,
			resolveMention: ctx.resolveMention,
			sourcePath,
		});

		// 预计算每个 fence 块的 hash,渲染器同步查表
		const fenceHashMap = await this.buildFenceHashMap(preprocessed);

		const md = this.buildRenderer(ctx, fenceHashMap);
		const html = md.render(preprocessed);

		return postProcessHtml(html, ctx);
	}

	/**
	 * 计算 markdown 内容的稳定哈希,用于 last_hash 去重。
	 * 把 resolver 一并纳入哈希:peer 页面 URL 变化时也会触发重新上传。
	 */
	async computeContentHash(
		markdown: string,
		sourcePath: string,
		opts?: {
			resolveWikilink?: (linkpath: string, sourcePath: string) => WikilinkResolution | null;
			resolveMention?: (linkpath: string, sourcePath: string) => string | null;
			stripSupplementaryChars?: boolean;
			defaultImageWidthPx?: number;
		},
	): Promise<string> {
		const body = stripFrontmatter(markdown);
		const preprocessed = preprocessObsidianSyntax(body, {
			resolveWikilink: opts?.resolveWikilink,
			resolveMention: opts?.resolveMention,
			sourcePath,
		});
		// 含增补字符(emoji 等)的笔记,strip 开关会改变最终输出,但哈希算的是
		// markdown 而非输出——不加盐的话,历史上以占位符形式同步过的页面会因
		// hash 命中被永远 skip,开关形同虚设。仅对受影响笔记加盐:开关切换时
		// 只有含 emoji 的笔记重推,其余仍正常跳过。strip=true 时不加盐,与
		// 旧版本(无条件 strip)产出的存量 hash 保持兼容。
		const hasSupplementary = /[\u{10000}-\u{10FFFF}]/u.test(preprocessed);
		const supplementarySalt = !opts?.stripSupplementaryChars && hasSupplementary ? '\0keep-supplementary' : '';
		// 显示宽度会改变最终 storage XHTML,必须纳入哈希;否则只改设置时会命中
		// last_hash 而跳过同步。仅含本地图片的笔记加盐,避免无图页面无谓重推。
		const hasLocalImages = this.collectAttachments(preprocessed, sourcePath).length > 0;
		const width = normalizeImageWidth(opts?.defaultImageWidthPx);
		const imageWidthSalt = hasLocalImages ? `\0image-width:${width}` : '';
		return sha1Hex(preprocessed + supplementarySalt + imageWidthSalt);
	}

	private collectAttachments(markdown: string, sourcePath: string): AttachmentRef[] {
		// 屏蔽 fenced / inline code 区域,避免把代码示例里的 ![[...]] / ![](...) 误当成真实附件引用
		const { masked } = maskCodeRegions(markdown);
		const refs: AttachmentRef[] = [];
		const seen = new Set<string>();

		// Obsidian embed:![[file.png|alt]] / ![[folder/file.png]]
		// `\\?\|` 兼容 markdown 表格内的 escape pipe(`\|`),否则 `\` 会被吞进 linkpath
		const embedRe = /!\[\[([^\]\n|\\]+)(?:\\?\|([^\]\n]*))?\]\]/g;
		let m: RegExpExecArray | null;
		while ((m = embedRe.exec(masked)) !== null) {
			const linkpath = m[1]!.trim();
			// note/heading/block 嵌入(![[note#section]] / ![[note#^id]])不是附件,跳过
			if (linkpath.includes('#')) continue;
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
		while ((m = imgRe.exec(masked)) !== null) {
			const alt = m[1] ?? '';
			const path = m[2]!;
			if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(path) || path.startsWith('data:')) continue;
			if (path.includes('#')) continue;
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

	private async collectDiagrams(
		markdown: string,
		lang: 'mermaid' | 'plantuml',
		ext: 'svg' | 'png',
	): Promise<DiagramBlock[]> {
		const blocks = extractFenceBlocks(markdown).filter((b) => b.lang === lang);
		const seen = new Set<string>();
		const out: DiagramBlock[] = [];
		for (const b of blocks) {
			const hash = await sha1Hex(b.content);
			if (seen.has(hash)) continue;
			seen.add(hash);
			out.push({ hash, source: b.content, filename: `${lang}-${hash}.${ext}` });
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

	private buildRenderer(ctx: ConvertContext, fenceHashes: Map<string, string>): MarkdownIt {
		// xhtmlOut: true — Confluence storage 是严格 XHTML,空元素必须自闭合(<hr /> 而非 <hr>)
		const md = new MarkdownIt({ html: false, xhtmlOut: true, breaks: false, linkify: true });

		// fence: 代码块 + 图表
		md.renderer.rules.fence = (tokens, idx) => {
			const token = tokens[idx]!;
			// `token.info` 整段可能是 `plantuml id=foo` 这类带 attribute 的形式,
			// 跟 extractFenceBlocks / markdown-it 标准对齐:只取第一个 token 当 lang。
			const lang = (token.info || '').trim().split(/\s+/)[0]!.toLowerCase();
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
				return renderAcImage(filename, alt, ctx.defaultImageWidthPx);
			}
			return `<!-- 未上传的附件: ${escapeAttr(filename)} -->`;
		};

		// callout: 通过自定义 blockquote 包装实现
		const originalBlockquoteOpen = md.renderer.rules.blockquote_open;
		const originalBlockquoteClose = md.renderer.rules.blockquote_close;
		md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
			const calloutType = detectCalloutType(tokens, idx);
			if (calloutType) {
				(env as CalloutEnv).__calloutOpen = true;
				return `<ac:structured-macro ac:name="${calloutType.macro}"><ac:rich-text-body>`;
			}
			return originalBlockquoteOpen
				? originalBlockquoteOpen(tokens, idx, options, env, self)
				: self.renderToken(tokens, idx, options);
		};
		md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
			const e = env as CalloutEnv;
			if (e.__calloutOpen) {
				e.__calloutOpen = false;
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
function preprocessObsidianSyntax(md: string, opts?: PreprocessOptions): string {
	// 先把代码区(fenced + inline)替换成占位符,避免代码示例里的 ![[...]] / [[...]] 被改写
	const { masked, restore } = maskCodeRegions(md);
	// `[!summary]+ 目录` 在 Obsidian 里继续显示手写目录,同步时改用 Confluence
	// 官方 TOC 宏。必须在代码区屏蔽后执行,避免转换文档中的语法示例。
	let s = replaceMarkdownTocCallouts(masked);

	// 0. @[[Name]] / @[[Name|alias]] mention → PUA 哨兵(postProcessHtml 里替换为 <ac:link><ri:user>)。
	//    必须先于规则 1/2 跑,否则内层 [[Name]] 会被通用 wikilink 规则消化掉。
	//    解析不到 confluence_username → 降级为纯文本 `@Name`,与 issue #3 的 graceful degradation 一致。
	{
		const resolveMention = opts?.resolveMention;
		const sourcePath = opts?.sourcePath;
		s = s.replace(/@\[\[([^\]\n|\\]+)(?:\\?\|([^\]\n]*))?\]\]/g, (_full, link: string, alias: string) => {
			const linkpath = link.trim().split('#')[0]!.trim();
			const text = (alias ?? '').trim() || link.trim().split('/').pop() || link.trim();
			if (resolveMention && sourcePath && linkpath) {
				const username = resolveMention(linkpath, sourcePath);
				if (username) return `MENTION:${username}`;
			}
			return `@${text}`;
		});
	}

	// 1. ![[...]] embed → ![alt](path)
	//    - `[^|\\]+` + `\\?\|` 兼容 markdown 表格内 escaped pipe(`\|`)
	//    - 带 `#section` / `#^block` 的是笔记片段嵌入,不是图片附件,降级为纯文本
	//    - 路径用 encodeURI:Obsidian 的 "Pasted image YYYYMMDDHHMMSS.png" 之类含空格,
	//      不编码会导致 markdown-it 把 `![alt](path with space)` 解析失败,原文吐回。
	s = s.replace(/!\[\[([^\]\n|\\]+)(?:\\?\|([^\]\n]*))?\]\]/g, (_full, link: string, alias: string) => {
		const text = (alias ?? '').trim();
		const linkpath = link.trim();
		if (linkpath.includes('#')) {
			return text || linkpath.split('/').pop() || linkpath;
		}
		return `![${text}](${encodeURI(linkpath)})`;
	});

	// 2. 同页锚点 [[#Heading|alias]] → PUA 哨兵;postProcessHtml 再转成
	//    Confluence 原生 <ac:link ac:anchor="...">。必须先于通用 wikilink 处理。
	s = s.replace(/\[\[#([^\]\n|\\]+)(?:\\?\|([^\]\n]*))?\]\]/g, (_full, anchor: string, alias: string) => {
		const cleanAnchor = anchor.trim();
		const text = (alias ?? '').trim() || cleanAnchor;
		// #^block-id 是 Obsidian 块引用,Confluence 标题锚点无法承载;维持旧的纯文本降级。
		if (cleanAnchor.startsWith('^')) return (alias ?? '').trim() || `#${cleanAnchor}`;
		return makeAnchorLinkMarker(cleanAnchor, text);
	});

	// 标准 Markdown 同页锚点 [text](#heading) 同样转成 Confluence 原生锚点链接。
	// 同时兼容带空格的 angle destination(`<#heading name>`)和可选 title。
	s = s.replace(
		/(?<!!)\[([^\]\n]+)\]\((?:<#([^>\n]+)>|#([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g,
		(full, text: string, angleAnchor: string, bareAnchor: string) => {
			const anchor = tryDecode((angleAnchor || bareAnchor).trim());
			return anchor.startsWith('^') ? full : makeAnchorLinkMarker(anchor, text);
		},
	);

	// 2b. [[link|alias]] / [[link]] → 解析为 CF 链接;带 #heading 时保留为跨页锚点。
	s = s.replace(/\[\[([^\]\n|\\]+)(?:\\?\|([^\]\n]*))?\]\]/g, (_full, link: string, alias: string) => {
		const cleanLink = link.trim();
		const text = (alias ?? '').trim() || cleanLink.split('/').pop() || cleanLink;
		const resolver = opts?.resolveWikilink;
		const sourcePath = opts?.sourcePath;
		if (resolver && sourcePath) {
			const hashIndex = cleanLink.indexOf('#');
			const linkpath = (hashIndex >= 0 ? cleanLink.slice(0, hashIndex) : cleanLink).trim();
			const anchor = hashIndex >= 0 ? cleanLink.slice(hashIndex + 1).trim() : '';
			if (linkpath) {
				const resolved = normalizeWikilinkResolution(resolver(linkpath, sourcePath));
				if (resolved) {
					if (anchor && !anchor.startsWith('^')) {
						const title = resolved.title ?? inferPageTitle(linkpath);
						return makeAnchorLinkMarker(anchor, text, title);
					}
					return `[${escapeMarkdownLinkText(text)}](${resolved.url})`;
				}
			}
		}
		return text;
	});

	// 2c. 标准 markdown 链接 [text](relative.md[#anchor]) → 解析为 CF 链接;解析不到降级纯文本。
	//     `(?<!!)` 排除 ![image](...);排除 http(s)/mailto/tel/锚点 等绝对/特殊形式。
	const resolver = opts?.resolveWikilink;
	const sourcePath = opts?.sourcePath;
	if (resolver && sourcePath) {
		s = s.replace(
			/(?<!!)\[([^\]\n]+)\]\((?!https?:|mailto:|tel:|#)([^)\s]+\.md(?:#[^)\s]*)?)\)/g,
			(_full, text: string, href: string) => {
				const hashIndex = href.indexOf('#');
				const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
				const anchor = hashIndex >= 0 ? tryDecode(href.slice(hashIndex + 1)) : '';
				let linkpath: string;
				try {
					linkpath = decodeURIComponent(pathPart);
				} catch {
					linkpath = pathPart;
				}
				if (!linkpath) return text;
				const resolved = normalizeWikilinkResolution(resolver(linkpath, sourcePath));
				if (resolved) {
					if (anchor && !anchor.startsWith('^')) {
						const title = resolved.title ?? inferPageTitle(linkpath);
						return makeAnchorLinkMarker(anchor, text, title);
					}
					return `[${escapeMarkdownLinkText(text)}](${resolved.url})`;
				}
				// 解析不到:降级纯文本,避免 CF 把相对 .md 路径渲染成无效链接
				return text;
			},
		);
	}

	// 3. callout 头部:`> [!info] Title` → 私有区字符包裹的标记 `> CALLOUT:INFO Title`
	//    用 PUA(U+E000/U+E001)而不是 `__CALLOUT_X__`,避免被 markdown-it 当成 strong(`__bold__`)消化掉前后下划线
	s = s.replace(/^(> )\[!([a-zA-Z]+)\](.*)$/gm, (_full, prefix: string, type: string, rest: string) => {
		return `${prefix}CALLOUT:${type.toUpperCase()}${rest}`;
	});

	return restore(s);
}

/** markdown inline link 文本中的 `]` 与反斜杠需要转义,避免破坏 `[text](url)` 结构 */
function escapeMarkdownLinkText(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

const ANCHOR_LINK_OPEN = '';
const ANCHOR_LINK_CLOSE = '';
const ANCHOR_LINK_RE = /ANCHOR:([^|]*)\|([^|]*)\|([^]*)/g;

function makeAnchorLinkMarker(anchor: string, text: string, pageTitle = ''): string {
	return `${ANCHOR_LINK_OPEN}ANCHOR:${encodeURIComponent(anchor)}|${encodeURIComponent(text)}|${encodeURIComponent(pageTitle)}${ANCHOR_LINK_CLOSE}`;
}

function normalizeWikilinkResolution(value: WikilinkResolution | null): ResolvedWikilink | null {
	if (!value) return null;
	if (typeof value === 'string') return value.trim() ? { url: value.trim() } : null;
	const url = value.url.trim();
	return url ? { url, title: value.title?.trim() || undefined } : null;
}

function inferPageTitle(linkpath: string): string {
	const filename = linkpath.split('/').pop() ?? linkpath;
	return filename.replace(/\.md$/i, '');
}

const CODE_MASK_OPEN = '';
const CODE_MASK_CLOSE = '';
const CODE_MASK_RE = /(\d+)/g;

/**
 * 用占位符屏蔽 markdown 里的代码区(fenced ```/~~~ 和 inline `…`),
 * 避免后续 Obsidian 语法预处理 / 附件提取 regex 误伤代码示例。
 * 返回 masked 串和 restore 函数(把占位符还原回原文)。
 */
function maskCodeRegions(md: string): { masked: string; restore: (s: string) => string } {
	const buf: string[] = [];
	const stash = (text: string): string => {
		const idx = buf.length;
		buf.push(text);
		return `${CODE_MASK_OPEN}${idx}${CODE_MASK_CLOSE}`;
	};

	// 1. fenced code(``` 或 ~~~,允许同级缩进闭合)
	let masked = md.replace(
		/(^|\n)([ \t]*)(`{3,}|~{3,})([^\n]*\n[\s\S]*?\n)\2\3[ \t]*(?=\n|$)/g,
		(_full, lead: string, indent: string, fence: string, body: string) => {
			return `${lead}${stash(`${indent}${fence}${body}${indent}${fence}`)}`;
		},
	);

	// 2. inline code:`...` / ``...``(平衡的反引号对,内容不含换行)
	masked = masked.replace(/(`+)([^`\n]+?)\1(?!`)/g, (full) => stash(full));

	const restore = (s: string): string =>
		s.replace(CODE_MASK_RE, (_, idxStr: string) => buf[parseInt(idxStr, 10)] ?? '');

	return { masked, restore };
}

interface FenceBlock { lang: string; content: string; }

/** 从原始 markdown 中提取所有 ``` fence 块。简化实现,与 markdown-it 规则可能略有偏差但够用 */
function extractFenceBlocks(markdown: string): FenceBlock[] {
	const out: FenceBlock[] = [];
	// markdown-it 入口会把 \r\n / \r 归一成 \n(NEWLINES_RE),这里必须做同样的归一,
	// 否则 CRLF 笔记的 fence content 带着 \r,hash 与渲染侧 token.content 永远对不上。
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		// 容器前缀:连续的空格 / tab / `>`(blockquote 标记),fence 行允许 list / blockquote 缩进。
		// lang 段:第一个 token(`[\w-]+`)即可,后面可以带 info 字符串(attribute / metadata)。
		const m = line.match(/^([\s>]*)(`{3,}|~{3,})\s*([\w-]+)?(?:\s.*?)?\s*$/);
		if (!m) { i += 1; continue; }
		const containerPrefix = m[1]!;
		const indent = containerPrefix.length;
		const fence = m[2]!;
		const lang = (m[3] ?? '').toLowerCase();
		const start = i + 1;
		i = start;
		while (i < lines.length) {
			const closing = lines[i]!.match(/^([\s>]*)(`{3,}|~{3,})\s*$/);
			if (closing && closing[2]!.startsWith(fence[0]!) && closing[2]!.length >= fence.length) {
				// 关闭 fence 的容器前缀长度应跟开头一致(或被 markdown-it 视为 lazy continuation,这里宽松些)
				break;
			}
			i += 1;
		}
		// 按 CommonMark / markdown-it 规则,fence 体内每行的容器前缀(`>`/缩进)按开头剥掉,
		// 这样 extractFenceBlocks 的 content 与 markdown-it 的 token.content 一致,fence hash 才能命中。
		// 涵盖:list-indent(空格)、tab-indent、blockquote(`> `)、嵌套混合。
		const stripped = indent > 0
			? lines.slice(start, i).map((l) => {
				const lm = l.match(/^([\s>]*)/);
				const lineLen = lm?.[1]?.length ?? 0;
				return l.slice(Math.min(indent, lineLen));
			})
			: lines.slice(start, i);
		// 末尾空行必须剥掉:渲染侧对 markdown-it 的 token.content 也做了同样的 `\n+$` normalize,
		// 不然「闭合 fence 前带空行」的块 hash 对不上,图表会退回成代码块。
		const content = stripped.join('\n').replace(/\n+$/, '');
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
		// PUA(U+E000/U+E001)包裹的 callout 标记 — 与 preprocessObsidianSyntax 保持一致
		const m = text.match(/^CALLOUT:([A-Z]+)/);
		if (!m) return null;
		// 把前缀从首个 text token 移除,留下标题
		const stripRe = /^CALLOUT:[A-Z]+\s*/;
		if (tk.children?.[0]) {
			tk.children[0].content = tk.children[0].content.replace(stripRe, '');
		} else {
			tk.content = tk.content?.replace(stripRe, '') ?? '';
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

function renderAcImage(filename: string, alt: string, widthPx = 0): string {
	const altPart = alt ? ` ac:alt="${escapeAttr(alt)}"` : '';
	const width = normalizeImageWidth(widthPx);
	const widthPart = width > 0 ? ` ac:width="${width}"` : '';
	return `<ac:image${widthPart}${altPart}><ri:attachment ri:filename="${escapeAttr(filename)}" /></ac:image>`;
}

function normalizeImageWidth(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined || value <= 0) return 0;
	return Math.floor(value);
}

function postProcessHtml(html: string, ctx: ConvertContext): string {
	// markdown-it xhtmlOut=true 已经处理 br/hr/img,但兜底:HTML 里所有 void element
	// 在 Confluence storage(严格 XHTML)里都必须自闭合,否则 1 个未闭合会让解析器把
	// 后续所有标签都当子元素,直到撞到匹配不上的关闭标签就 400 报错。
	const voidElements = ['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'embed', 'source', 'track', 'wbr'];
	let out = html;
	for (const tag of voidElements) {
		const re = new RegExp(`<${tag}\\b([^>]*?)(?<!/)>`, 'gi');
		out = out.replace(re, `<${tag}$1 />`);
	}
	// `[!summary]+ 目录` 的整块手写链接列表 → Confluence 官方 TOC(H2-H3)。
	out = replaceTocMarkersWithMacros(out);
	// @[[Name]] mention 哨兵 → Confluence 用户链接(preprocess 阶段埋入,穿透 markdown-it 的 HTML 转义)
	out = out.replace(/MENTION:([^]*)/g, (_full, username: string) => {
		return `<ac:link><ri:user ri:username="${escapeAttr(username)}" /></ac:link>`;
	});
	// [[#Heading]] / [[note#Heading]] 哨兵 → Confluence 原生锚点链接。
	// Confluence 的 heading anchor 会移除空白,但保留大小写和标点。
	out = out.replace(ANCHOR_LINK_RE, (_full, anchorPart: string, textPart: string, titlePart: string) => {
		const anchor = tryDecode(anchorPart).replace(/\s+/g, '');
		const text = tryDecode(textPart);
		const pageTitle = tryDecode(titlePart);
		const pagePart = pageTitle ? `<ri:page ri:content-title="${escapeAttr(pageTitle)}" />` : '';
		return `<ac:link ac:anchor="${escapeAttr(anchor)}">${pagePart}<ac:plain-text-link-body><![CDATA[${cdataSafe(text)}]]></ac:plain-text-link-body></ac:link>`;
	});
	if (ctx.stripSupplementaryChars) {
		out = stripSupplementaryChars(out);
	}
	return out.trim();
}

/**
 * Confluence Server 默认 MySQL 用 utf8 (3-byte),装不下 codePoint > 0xFFFF 的字符
 * (emoji 🆕、汉字扩展区 𠮷 等),触发 400 "Unsupported character found in content"。
 *
 * 策略:替换为 `[U+XXXX]` 文本占位,既保留信息也是纯 ASCII,绕过数据库 charset 限制。
 * Cloud / utf8mb4 站点原生支持这些字符,因此该行为由设置项按需开启(issue #5)。
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
