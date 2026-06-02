import type { App, TFile } from 'obsidian';
import { ConfluenceApi, ConfluenceApiError } from '../confluence/api';
import { parsePageIdFromUrl } from '../confluence/urlParser';
import { MarkdownConverter, ConvertContext } from '../confluence/markdownConverter';
import { AttachmentUploader } from '../confluence/attachmentUploader';
import { MermaidRenderer } from '../confluence/mermaidRenderer';
import { PlantUmlRenderer } from '../confluence/plantUmlRenderer';
import { readBindingFromCache, writeBinding } from '../frontmatter/handler';
import { scanBoundNotes } from './noteScanner';
import { Logger } from '../utils/logger';
import { SyncConfluenceSettings } from '../settings';
import { AttachmentRecord, BatchSyncResult, FileSyncResult, NoteBinding } from '../types';

export interface SyncEngineDeps {
	app: App;
	settings: SyncConfluenceSettings;
	logger: Logger;
	api: ConfluenceApi;
}

/**
 * 同步引擎。承担:扫描 → 编排单文件流水(附件上传 / 图表渲染 / Markdown 转换 / 推送 / 回写 frontmatter)
 *
 * 防重入:isSyncing 标志位。SyncAll 与 SyncOne 共享同一把锁,避免定时器与手动触发互踩。
 */
export class SyncEngine {
	private converter: MarkdownConverter;
	private uploader: AttachmentUploader;
	private mermaid: MermaidRenderer | null = null;
	private plantUml: PlantUmlRenderer | null = null;
	private busy = false;

	constructor(private deps: SyncEngineDeps) {
		this.converter = new MarkdownConverter(deps.app);
		this.uploader = new AttachmentUploader(deps.app, deps.api, deps.logger, {
			maxSizeBytes: Math.max(1, deps.settings.maxAttachmentSizeMB) * 1024 * 1024,
		});
		if (deps.settings.renderMermaidToPng) {
			this.mermaid = new MermaidRenderer(deps.settings.mermaidRenderUrl, deps.logger);
		}
		if (deps.settings.renderPlantUmlToPng) {
			this.plantUml = new PlantUmlRenderer(deps.settings.plantUmlServerUrl, deps.logger);
		}
	}

	isBusy(): boolean { return this.busy; }

	/** 扫描整个 vault,同步所有绑定笔记 */
	async syncAll(): Promise<BatchSyncResult | null> {
		const files = scanBoundNotes(this.deps.app, {
			frontmatterKey: this.deps.settings.frontmatterKey,
			scanFolders: this.deps.settings.scanFolders,
			ignorePatterns: this.deps.settings.ignorePatterns,
		});
		this.deps.logger.info(`扫描到 ${files.length} 个绑定笔记`);
		return this.syncFiles(files);
	}

	/** 同步给定的一组文件(供 syncAll / syncFolder / 未来 selection 同步等场景复用) */
	async syncFiles(files: TFile[]): Promise<BatchSyncResult | null> {
		if (this.busy) {
			this.deps.logger.warn('已有同步任务进行中,跳过本次');
			return null;
		}
		this.busy = true;
		try {
			const result: BatchSyncResult = { total: files.length, updated: 0, skipped: 0, failed: 0, files: [] };
			for (const file of files) {
				const r = await this.syncFileInternal(file);
				result.files.push(r);
				if (r.skipped) result.skipped += 1;
				else if (r.success) result.updated += 1;
				else result.failed += 1;
			}
			this.deps.logger.info(
				`同步完成: 更新 ${result.updated} / 跳过 ${result.skipped} / 失败 ${result.failed}`,
			);
			this.deps.logger.recordSyncTime();
			return result;
		} finally {
			this.busy = false;
		}
	}

	/** 同步单个文件 */
	async syncOne(file: TFile): Promise<FileSyncResult | null> {
		if (this.busy) {
			this.deps.logger.warn('已有同步任务进行中,跳过本次');
			return null;
		}
		this.busy = true;
		try {
			const r = await this.syncFileInternal(file);
			this.deps.logger.recordSyncTime();
			return r;
		} finally {
			this.busy = false;
		}
	}

	private async syncFileInternal(file: TFile): Promise<FileSyncResult> {
		const path = file.path;
		try {
			const binding = readBindingFromCache(this.deps.app, file, this.deps.settings.frontmatterKey);
			if (!binding) return { path, skipped: true, success: false, error: '无 confluence_url / confluence_parent_url frontmatter' };

			// 解析 pageId:优先用 binding.url;若 url 为空但有 parentUrl,先 create 一个占位子页拿 pageId
			let pageId = binding.pageId || (binding.url ? parsePageIdFromUrl(binding.url) ?? '' : '');
			// "0" 是模板占位 URL 解析结果(pages/0/Page-Title),视为无效
			if (pageId === '0') pageId = '';
			let createdNewPage = false;

			if (!pageId) {
				if (!binding.parentUrl) {
					return { path, skipped: false, success: false, error: `无法从 URL 解析 pageId: ${binding.url}` };
				}
				const parentId = parsePageIdFromUrl(binding.parentUrl);
				if (!parentId) {
					return { path, skipped: false, success: false, error: `无法从 parent URL 解析 pageId: ${binding.parentUrl}` };
				}
				// 拿父页面的 spaceKey,创建占位子页(后续 update 会覆盖为真实内容)
				const parent = await this.deps.api.getPage(parentId);
				if (!parent.spaceKey) {
					return { path, skipped: false, success: false, error: `父页面缺少 spaceKey: ${binding.parentUrl}` };
				}
				const title = file.basename;
				this.deps.logger.info(`创建子页面: ${title} (parent=${parentId}, space=${parent.spaceKey})`);
				const created = await this.deps.api.createPage({
					spaceKey: parent.spaceKey,
					parentId,
					title,
					storageXhtml: '<p>(syncing…)</p>',
				});
				pageId = created.id;
				createdNewPage = true;
				// 立即回写 url + pageId,即便后续步骤失败,下次同步走 update 路径而不会重复 create
				await writeBinding(this.deps.app, file, { url: created.webUrl, pageId });
				this.deps.logger.info(`已创建子页面 ${created.id}: ${created.webUrl}`);
			}

			const markdown = await this.deps.app.vault.cachedRead(file);
			const contentHash = await this.converter.computeContentHash(markdown);

			// 内容哈希命中 → 跳过(附件/图表的变化也会影响 markdown 文本,故仅 hash 即可判断)
			// 但刚 create 的页面占位内容必须被覆盖一次,所以 createdNewPage=true 时不能跳过
			if (!createdNewPage && binding.lastHash === contentHash && binding.pageId === pageId) {
				return { path, skipped: true, success: true };
			}

			const refs = await this.converter.extractReferences(markdown, path);

			// 1. 上传普通附件
			const attachmentResult = this.deps.settings.uploadAttachments
				? await this.uploader.syncAttachments(pageId, refs.attachments, binding.attachments ?? {})
				: { map: {} as Record<string, AttachmentRecord>, uploaded: 0, skipped: 0, failed: 0 };

			// 2. 渲染 + 上传 mermaid
			const mermaidFilenameByHash = new Map<string, string>();
			const mermaidRecords: Record<string, AttachmentRecord> = {};
			if (this.mermaid && refs.mermaid.length > 0) {
				const rendered = await this.mermaid.renderAll(refs.mermaid);
				for (const r of rendered) {
					if (!r) continue;
					const rec = await this.uploader.uploadBytes(pageId, r.block.filename, r.png, binding.attachments ?? {});
					if (rec) {
						mermaidFilenameByHash.set(r.block.hash, r.block.filename);
						mermaidRecords[r.block.filename] = rec;
					}
				}
			}

			// 3. 渲染 + 上传 plantuml
			const plantUmlFilenameByHash = new Map<string, string>();
			const plantUmlRecords: Record<string, AttachmentRecord> = {};
			if (this.plantUml && refs.plantUml.length > 0) {
				const rendered = await this.plantUml.renderAll(refs.plantUml);
				for (const r of rendered) {
					if (!r) continue;
					const rec = await this.uploader.uploadBytes(pageId, r.block.filename, r.png, binding.attachments ?? {});
					if (rec) {
						plantUmlFilenameByHash.set(r.block.hash, r.block.filename);
						plantUmlRecords[r.block.filename] = rec;
					}
				}
			}

			// 4. 拉取当前页面 (拿 version + title)
			const page = await this.deps.api.getPage(pageId);

			// 5. 转换 markdown → storage xhtml
			const allAttachedFilenames = new Set<string>([
				...Object.keys(attachmentResult.map),
				...Object.keys(mermaidRecords),
				...Object.keys(plantUmlRecords),
			]);
			const ctx: ConvertContext = {
				attachedFilenames: allAttachedFilenames,
				mermaidFilenameByHash,
				plantUmlFilenameByHash,
				renderMermaidToPng: this.deps.settings.renderMermaidToPng,
				renderPlantUmlToPng: this.deps.settings.renderPlantUmlToPng,
			};
			const storageXhtml = await this.converter.convert(markdown, path, ctx);

			// 6. 推送 (含一次版本冲突重试)。标题始终用 OB 文件名 — 单向同步,OB 是真相源,
			//    用户改文件名后下次同步会同步改 Confluence 页面标题。
			const title = file.basename;
			try {
				await this.deps.api.updatePage(pageId, {
					title,
					storageXhtml,
					newVersion: page.version + 1,
				});
			} catch (e) {
				if (e instanceof ConfluenceApiError && e.code === 'version_conflict') {
					this.deps.logger.warn(`版本冲突,重新拉取后重试: ${path}`);
					const refreshed = await this.deps.api.getPage(pageId);
					await this.deps.api.updatePage(pageId, {
						title,
						storageXhtml,
						newVersion: refreshed.version + 1,
					});
				} else {
					throw e;
				}
			}

			// 7. 写回 frontmatter (合并所有附件记录)
			const mergedAttachments: Record<string, AttachmentRecord> = {
				...(binding.attachments ?? {}),
				...attachmentResult.map,
				...mermaidRecords,
				...plantUmlRecords,
			};
			// 清理掉本次已不再被引用的旧附件记录(避免无限膨胀)
			const stillReferenced = new Set<string>(allAttachedFilenames);
			for (const k of Object.keys(mergedAttachments)) {
				if (!stillReferenced.has(k)) delete mergedAttachments[k];
			}

			await writeBinding(this.deps.app, file, {
				pageId,
				lastSynced: new Date().toISOString(),
				lastHash: contentHash,
				attachments: mergedAttachments,
			});

			this.deps.logger.info(`已同步: ${path}`, `附件 上传 ${attachmentResult.uploaded} / 复用 ${attachmentResult.skipped} / 失败 ${attachmentResult.failed}`);
			return {
				path,
				skipped: false,
				success: true,
				uploadedAttachments: attachmentResult.uploaded,
				skippedAttachments: attachmentResult.skipped,
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.deps.logger.error(`同步失败: ${path}`, msg);
			return { path, skipped: false, success: false, error: msg };
		}
	}

	/** 重新读取 settings 后调用,重建 renderer 实例 */
	rebuildRenderers(): void {
		this.mermaid = this.deps.settings.renderMermaidToPng ? new MermaidRenderer(this.deps.settings.mermaidRenderUrl, this.deps.logger) : null;
		this.plantUml = this.deps.settings.renderPlantUmlToPng
			? new PlantUmlRenderer(this.deps.settings.plantUmlServerUrl, this.deps.logger)
			: null;
		this.uploader = new AttachmentUploader(this.deps.app, this.deps.api, this.deps.logger, {
			maxSizeBytes: Math.max(1, this.deps.settings.maxAttachmentSizeMB) * 1024 * 1024,
		});
	}
}

// 让 eslint 不抱怨 NoteBinding 未使用 (类型 re-export 给上层方便引用)
export type { NoteBinding };
