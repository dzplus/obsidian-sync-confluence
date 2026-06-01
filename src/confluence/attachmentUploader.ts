import type { App, TFile } from 'obsidian';
import { ConfluenceApi } from './api';
import { AttachmentRecord, AttachmentRef } from '../types';
import { sha1Hex } from '../utils/hash';
import { Logger } from '../utils/logger';

export interface AttachmentUploadOptions {
	maxSizeBytes: number;
}

export interface AttachmentUploadResult {
	/** filename -> 已存在 Confluence 的最终记录 */
	map: Record<string, AttachmentRecord>;
	uploaded: number;
	skipped: number;
	failed: number;
}

/** 已知扩展名 → MIME。Confluence 接受任何 MIME,但显式声明可避免猜错。 */
const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	bmp: 'image/bmp',
	pdf: 'application/pdf',
	zip: 'application/zip',
	json: 'application/json',
	txt: 'text/plain',
	md: 'text/markdown',
};

export class AttachmentUploader {
	constructor(
		private app: App,
		private api: ConfluenceApi,
		private logger: Logger,
		private opts: AttachmentUploadOptions,
	) {}

	/**
	 * 同步一组附件到指定页面。
	 *
	 * 流程:对每个 ref →
	 *  1. 读 binary → sha1
	 *  2. 与 previous[filename] 比对,hash 同 → 复用,跳过上传
	 *  3. 不同 → 查 Confluence 是否已存在同名附件 → 决定 create vs updateData
	 *  4. 累加新 map,失败的不进 map(下次仍会重试)
	 *
	 * Confluence 附件按 filename 寻址,因此 filename 必须唯一。
	 */
	async syncAttachments(
		pageId: string,
		refs: AttachmentRef[],
		previous: Record<string, AttachmentRecord> = {},
	): Promise<AttachmentUploadResult> {
		const result: AttachmentUploadResult = { map: {}, uploaded: 0, skipped: 0, failed: 0 };
		const seen = new Set<string>();

		for (const ref of refs) {
			if (!ref.tfile) {
				this.logger.warn(`附件引用无法解析: ${ref.linkpath}`);
				result.failed += 1;
				continue;
			}
			const filename = ref.filename;
			if (seen.has(filename)) continue;
			seen.add(filename);

			try {
				const bytes = await this.app.vault.readBinary(ref.tfile);
				if (bytes.byteLength > this.opts.maxSizeBytes) {
					this.logger.warn(
						`跳过过大附件: ${filename}`,
						`${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB > ${(this.opts.maxSizeBytes / 1024 / 1024).toFixed(2)} MB`,
					);
					result.skipped += 1;
					continue;
				}

				const hash = await sha1Hex(bytes);
				const prev = previous[filename];
				if (prev && prev.hash === hash) {
					result.map[filename] = prev;
					result.skipped += 1;
					continue;
				}

				const mime = guessMime(filename);
				const record = await this.upload(pageId, filename, bytes, mime, prev?.id);
				result.map[filename] = { hash, id: record.id };
				result.uploaded += 1;
				this.logger.info(`附件已上传: ${filename}`, `${(bytes.byteLength / 1024).toFixed(1)} KB`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				this.logger.error(`附件上传失败: ${filename}`, msg);
				result.failed += 1;
			}
		}

		return result;
	}

	/**
	 * 同步任意二进制附件(供 mermaid/plantuml renderer 调用,数据在内存中无 TFile)。
	 */
	async uploadBytes(
		pageId: string,
		filename: string,
		data: ArrayBuffer,
		previous: Record<string, AttachmentRecord> = {},
	): Promise<AttachmentRecord | null> {
		try {
			const hash = await sha1Hex(data);
			const prev = previous[filename];
			if (prev && prev.hash === hash) return prev;
			const mime = guessMime(filename);
			const record = await this.upload(pageId, filename, data, mime, prev?.id);
			return { hash, id: record.id };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logger.error(`图表附件上传失败: ${filename}`, msg);
			return null;
		}
	}

	private async upload(
		pageId: string,
		filename: string,
		data: ArrayBuffer,
		mime: string,
		knownAttachmentId: string | undefined,
	): Promise<{ id: string }> {
		// 优先用缓存里的 attachmentId 走 updateData;若 404 再回退到 find + create。
		if (knownAttachmentId) {
			try {
				const r = await this.api.updateAttachment(pageId, knownAttachmentId, filename, data, mime);
				return { id: r.id };
			} catch {
				// 附件可能在 Confluence 端被删了,继续走查找/新建路径
			}
		}
		const existing = await this.api.findAttachmentByFilename(pageId, filename);
		if (existing) {
			const r = await this.api.updateAttachment(pageId, existing.id, filename, data, mime);
			return { id: r.id };
		}
		const r = await this.api.createAttachment(pageId, filename, data, mime);
		return { id: r.id };
	}
}

function guessMime(filename: string): string {
	const idx = filename.lastIndexOf('.');
	if (idx < 0) return 'application/octet-stream';
	const ext = filename.slice(idx + 1).toLowerCase();
	return MIME[ext] ?? 'application/octet-stream';
}

/** 辅助:Obsidian metadataCache 解析 link → TFile,失败 fallback 到全 vault filename 搜索 */
export function resolveAttachmentFile(app: App, linkpath: string, sourcePath: string): TFile | null {
	const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
	if (dest) return dest;
	const base = linkpath.split('/').pop() ?? linkpath;
	const all = app.vault.getFiles();
	return all.find((f) => f.name === base) ?? null;
}
