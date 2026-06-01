import { requestUrl } from 'obsidian';
import { DiagramBlock } from './markdownConverter';
import { Logger } from '../utils/logger';

/**
 * PlantUML 文本编码 + 远程 PNG 拉取。
 *
 * 编码算法(PlantUML 官方):
 *   utf-8 bytes → raw deflate → 自定义 base64 字母表
 *
 * 字母表(注意与标准 base64 不同):
 *   0-9A-Za-z 加 '-' '_',按 PlantUML 官方顺序。
 *
 * raw deflate 用浏览器原生 CompressionStream('deflate-raw');
 * Electron / Chrome ≥ 80 均支持,Obsidian 桌面端开箱即用。
 */
export class PlantUmlRenderer {
	constructor(
		private serverUrl: string,
		private logger: Logger,
	) {}

	async renderAll(blocks: DiagramBlock[]): Promise<Array<{ block: DiagramBlock; png: ArrayBuffer } | null>> {
		const out: Array<{ block: DiagramBlock; png: ArrayBuffer } | null> = [];
		for (const b of blocks) {
			try {
				const png = await this.renderOne(b.source);
				out.push({ block: b, png });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				this.logger.warn(`PlantUML 渲染失败,将退回为代码块: ${b.filename}`, msg);
				out.push(null);
			}
		}
		return out;
	}

	private async renderOne(source: string): Promise<ArrayBuffer> {
		const encoded = await encodePlantUml(source);
		const base = this.serverUrl.replace(/\/+$/, '');
		const url = `${base}/png/${encoded}`;
		const res = await requestUrl({ url, method: 'GET', throw: false });
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`PlantUML server 返回 ${res.status}`);
		}
		return res.arrayBuffer;
	}
}

const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

async function encodePlantUml(source: string): Promise<string> {
	const utf8 = new TextEncoder().encode(source);
	const deflated = await deflateRaw(utf8);
	return encode64(deflated);
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
	if (!CS) throw new Error('CompressionStream 不可用,无法编码 PlantUML');
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate-raw'));
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}

function encode64(data: Uint8Array): string {
	let r = '';
	for (let i = 0; i < data.length; i += 3) {
		const a = data[i]!;
		const b = i + 1 < data.length ? data[i + 1]! : 0;
		const c = i + 2 < data.length ? data[i + 2]! : 0;
		r += PLANTUML_ALPHABET[a >> 2];
		r += PLANTUML_ALPHABET[((a & 0x3) << 4) | (b >> 4)];
		r += PLANTUML_ALPHABET[((b & 0xF) << 2) | (c >> 6)];
		r += PLANTUML_ALPHABET[c & 0x3F];
	}
	return r;
}
