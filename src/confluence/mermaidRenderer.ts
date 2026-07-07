import { App, Component, MarkdownRenderer, requestUrl } from 'obsidian';
import { DiagramBlock } from './markdownConverter';
import { Logger } from '../utils/logger';

export type RenderedMermaid = { block: DiagramBlock; png: ArrayBuffer };

export interface IMermaidRenderer {
	renderAll(blocks: DiagramBlock[]): Promise<Array<RenderedMermaid | null>>;
	/** 上传时使用的扩展名 — kroki 走 png,Obsidian native 走 svg。 */
	extension(): 'svg' | 'png';
}

/**
 * Mermaid 源码 → PNG(走 kroki HTTP 服务)。
 *
 * 默认使用 https://kroki.io 公共实例(内部 mermaid-cli + headless Chrome,
 * 字体齐全、中文 / emoji 都能渲染),用户也可改自建实例。
 *
 * 优:字体兜底完整、对老版 Confluence 兼容性最好(PNG raster 一定能渲染)、跨平台一致。
 * 劣:依赖网络(企业内网需自建)、时间轴类(gantt / timeline)输出尺寸偏小,日期会挤。
 */
export class KrokiMermaidRenderer implements IMermaidRenderer {
	constructor(
		private serverUrl: string,
		private logger: Logger,
	) {}

	extension(): 'svg' | 'png' {
		return /\/svg(\b|\/?$)/i.test(this.serverUrl) ? 'svg' : 'png';
	}

	async renderAll(blocks: DiagramBlock[]): Promise<Array<RenderedMermaid | null>> {
		const results: Array<RenderedMermaid | null> = [];
		for (const b of blocks) {
			try {
				const png = await this.renderWithRetry(b.source);
				results.push({ block: b, png });
				// kroki 公共实例对连发有节流,块之间留点间隔,避免触发限流
				await delay(200);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				this.logger.warn(`Mermaid 渲染失败,将退回为代码块: ${b.filename}`, msg);
				results.push(null);
			}
		}
		return results;
	}

	private async renderWithRetry(source: string): Promise<ArrayBuffer> {
		let lastErr: unknown = null;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await this.renderOne(source);
			} catch (e) {
				lastErr = e;
				const msg = e instanceof Error ? e.message : String(e);
				// 429 限流 / 5xx 服务暂时不可用 → 退避后重试;其它错(语法错等)直接抛
				if (!/\b(429|5\d{2})\b/.test(msg)) throw e;
				const backoff = 500 * Math.pow(2, attempt); // 500ms / 1s / 2s
				this.logger.warn(`kroki 暂时不可用,${backoff}ms 后重试 (${attempt + 1}/3)`, msg);
				await delay(backoff);
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	private async renderOne(source: string): Promise<ArrayBuffer> {
		const res = await requestUrl({
			method: 'POST',
			url: this.serverUrl,
			contentType: 'text/plain; charset=utf-8',
			body: source,
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`kroki 返回 ${res.status}: ${(res.text ?? '').slice(0, 200)}`);
		}
		return res.arrayBuffer;
	}
}

/**
 * Mermaid 源码 → SVG(用 Obsidian 内置 mermaid 引擎 + MarkdownRenderer 渲染)。
 *
 * 优:跟笔记预览像素级一致、无网络依赖、mermaid 版本跟 Obsidian 走能持续更新、
 *     时间轴类图表宽度由内容自然撑开,不会挤。
 * 劣:产物是 SVG(老版 Confluence 5.x 及以下可能不 inline 渲染、改下载链接)、
 *     字体跟 Obsidian 主题走(导出图引用本机字体,Confluence 服务端用户看到时会回退到系统默认),
 *     某些 mermaid 高级特性(如 wikilink in node)在 Confluence 端不可点。
 */
export class ObsidianMermaidRenderer implements IMermaidRenderer {
	constructor(
		private app: App,
		private logger: Logger,
	) {}

	extension(): 'svg' | 'png' { return 'svg'; }

	async renderAll(blocks: DiagramBlock[]): Promise<Array<RenderedMermaid | null>> {
		const results: Array<RenderedMermaid | null> = [];
		for (const b of blocks) {
			try {
				const svgText = await this.renderOne(b.source);
				const bytes = new TextEncoder().encode(svgText).buffer;
				results.push({ block: b, png: bytes });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				this.logger.warn(`Mermaid 渲染失败,将退回为代码块: ${b.filename}`, msg);
				results.push(null);
			}
		}
		return results;
	}

	private async renderOne(source: string): Promise<string> {
		// 隐藏挂载点。宽度给得宽,让 mermaid useMaxWidth=true 时 SVG 能用足容器宽度,
		// 算出贴合内容的自然布局(尤其甘特图横轴密度由容器宽决定)。
		const host = activeDocument.createElement('div');
		host.setCssStyles({
			position: 'absolute',
			left: '-99999px',
			top: '0',
			width: '2000px',
			visibility: 'hidden',
			pointerEvents: 'none',
		});
		activeDocument.body.appendChild(host);
		const comp = new Component();
		comp.load();
		try {
			await MarkdownRenderer.render(this.app, '```mermaid\n' + source + '\n```', host, '', comp);
			// mermaid 渲染是异步的(promise 返回时 DOM 占位已就绪,真正 SVG 由 mermaid 在 microtask 后插入)
			let svg: SVGSVGElement | null = null;
			for (let i = 0; i < 200; i++) {
				const el = host.querySelector('svg');
				if (el) {
					// mermaid 偶尔会先插一个空 SVG 占位,等内部渲染完成再替换。
					// 校验 viewBox / 子节点都齐了再认。
					if (el.querySelector('g, path, rect, text')) {
						svg = el;
						break;
					}
				}
				await delay(25);
			}
			if (!svg) throw new Error('SVG 未在 5s 内渲染出来');

			// 自包含化:把 viewBox 推算出的内联尺寸固化到 width / height,
			// 避免 Confluence 服务端解析时因为 width="100%" 拿不到尺寸。
			const vb = svg.viewBox?.baseVal;
			if (vb && vb.width > 0) {
				const widthAttr = svg.getAttribute('width') ?? '';
				if (!widthAttr || widthAttr.includes('%') || widthAttr === 'auto') {
					svg.setAttribute('width', String(Math.ceil(vb.width)));
				}
				const heightAttr = svg.getAttribute('height') ?? '';
				if (!heightAttr || heightAttr.includes('%') || heightAttr === 'auto') {
					svg.setAttribute('height', String(Math.ceil(vb.height)));
				}
			}
			// 默认 xmlns 缺失时补上,否则有些 XML 解析器不认 SVG。
			if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
			if (!svg.getAttribute('xmlns:xlink')) svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

			return new XMLSerializer().serializeToString(svg);
		} finally {
			comp.unload();
			host.remove();
		}
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
