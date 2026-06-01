import { requestUrl } from 'obsidian';
import { DiagramBlock } from './markdownConverter';
import { Logger } from '../utils/logger';

/**
 * Mermaid 源码 → PNG。
 *
 * 走远程 kroki 服务(开源 + 公共实例 https://kroki.io,内部用真 mermaid-cli + headless Chrome,
 * 字体完整、中文/emoji 都能正常渲染)。POST 源码,直接返回 PNG。
 *
 * 为什么不本地渲染:
 *   - mermaid npm + canvas → 含 foreignObject 的 SVG 把 canvas 标记为 tainted,toBlob 失败
 *   - mermaid npm + resvg-wasm → resvg 不支持 foreignObject;即便预处理转 text,
 *     resvg 不自带字体,中文/英文均不显示
 *   - 嵌入字体 → CJK 字库 10MB+,plugin 体积爆炸
 *
 * 用户可配置 mermaidRenderUrl 改自建 kroki 实例(企业内网部署很简单,一个 docker 即可)。
 */
export class MermaidRenderer {
	constructor(
		private serverUrl: string,
		private logger: Logger,
	) {}

	async renderAll(blocks: DiagramBlock[]): Promise<Array<{ block: DiagramBlock; png: ArrayBuffer } | null>> {
		const results: Array<{ block: DiagramBlock; png: ArrayBuffer } | null> = [];
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

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
