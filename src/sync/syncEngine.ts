import { type App, type TFile, TFile as TFileCtor } from 'obsidian';
import { ConfluenceApi, ConfluenceApiError } from '../confluence/api';
import { parsePageIdFromUrl } from '../confluence/urlParser';
import { MarkdownConverter, ConvertContext, ExtractedReferences, DiagramBlock } from '../confluence/markdownConverter';
import { AttachmentUploader } from '../confluence/attachmentUploader';
import { IMermaidRenderer, KrokiMermaidRenderer, ObsidianMermaidRenderer } from '../confluence/mermaidRenderer';
import { PlantUmlRenderer } from '../confluence/plantUmlRenderer';
import { readBindingFromCache, writeBinding, TargetBindingPatch } from '../frontmatter/handler';
import { scanBoundNotes } from './noteScanner';
import { Logger } from '../utils/logger';
import { SyncConfluenceSettings } from '../settings';
import { AttachmentRecord, BatchSyncResult, FileSyncResult, NoteBinding, SyncTarget } from '../types';

export interface SyncEngineDeps {
	app: App;
	settings: SyncConfluenceSettings;
	logger: Logger;
	api: ConfluenceApi;
}

type RenderedDiagram = { block: DiagramBlock; png: ArrayBuffer };

interface TargetSyncSuccess {
	index: number;
	parentUrl?: string;
	pageId: string;
	url: string;
	success: true;
	skipped: boolean;
	uploadedAttachments: number;
	skippedAttachments: number;
	failedAttachments: number;
	attachments?: Record<string, AttachmentRecord>;
}

interface TargetSyncFailureResult {
	index: number;
	parentUrl?: string;
	pageId: string;
	url: string;
	success: false;
	error: string;
}

class TargetSyncFailure extends Error {
	constructor(
		message: string,
		public index: number,
		public target: SyncTarget,
		public pageId: string,
		public url: string,
	) {
		super(message);
		this.name = 'TargetSyncFailure';
	}
}

/**
 * 同步引擎。承担:扫描 → 编排单文件流水(附件上传 / 图表渲染 / Markdown 转换 / 推送 / 回写 frontmatter)
 *
 * 防重入:isSyncing 标志位。SyncAll 与 SyncOne 共享同一把锁,避免定时器与手动触发互踩。
 */
export class SyncEngine {
	private converter: MarkdownConverter;
	private uploader: AttachmentUploader;
	private mermaid: IMermaidRenderer | null = null;
	private plantUml: PlantUmlRenderer | null = null;
	private busy = false;

	constructor(private deps: SyncEngineDeps) {
		this.converter = new MarkdownConverter(deps.app);
		this.uploader = new AttachmentUploader(deps.app, deps.api, deps.logger, {
			maxSizeBytes: Math.max(1, deps.settings.maxAttachmentSizeMB) * 1024 * 1024,
		});
		if (deps.settings.renderMermaidToPng) {
			this.mermaid = deps.settings.mermaidRenderer === 'obsidian'
				? new ObsidianMermaidRenderer(deps.app, deps.logger)
				: new KrokiMermaidRenderer(deps.settings.mermaidRenderUrl, deps.logger);
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
			// Pass 1: 给批次内所有尚未拥有 pageId 的目标页提前创建占位页,
			// 这样 Pass 2 转 markdown 时 `[[wikilink]]` 才能解析出对方的 confluence_url。
			await this.ensurePageIdsForBatch(files);

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

			const markdown = await this.deps.app.vault.cachedRead(file);
			const resolveWikilink = this.makeWikilinkResolver();
			const resolveMention = this.makeMentionResolver();
			const contentHash = await this.converter.computeContentHash(markdown, path, {
				resolveWikilink,
				resolveMention,
				stripSupplementaryChars: this.deps.settings.stripSupplementaryChars,
			});
			const refs = await this.converter.extractReferences(markdown, path, {
				mermaidExt: this.mermaid?.extension(),
			});
			const mermaidRendered = await this.renderMermaidOnce(refs);
			const plantUmlRendered = await this.renderPlantUmlOnce(refs);
			const mermaidFilenameByHash = new Map<string, string>();
			for (const r of mermaidRendered) mermaidFilenameByHash.set(r.block.hash, r.block.filename);
			const plantUmlFilenameByHash = new Map<string, string>();
			for (const r of plantUmlRendered) plantUmlFilenameByHash.set(r.block.hash, r.block.filename);
			const allAttachedFilenames = new Set<string>();
			if (this.deps.settings.uploadAttachments) {
				for (const ref of refs.attachments) {
					if (ref.tfile) allAttachedFilenames.add(ref.filename);
				}
			}
			for (const r of mermaidRendered) allAttachedFilenames.add(r.block.filename);
			for (const r of plantUmlRendered) allAttachedFilenames.add(r.block.filename);
			const ctx: ConvertContext = {
				attachedFilenames: allAttachedFilenames,
				mermaidFilenameByHash,
				plantUmlFilenameByHash,
				renderMermaidToPng: this.deps.settings.renderMermaidToPng,
				renderPlantUmlToPng: this.deps.settings.renderPlantUmlToPng,
				stripSupplementaryChars: this.deps.settings.stripSupplementaryChars,
				resolveWikilink,
				resolveMention,
			};
			const storageXhtml = await this.converter.convert(markdown, path, ctx);

			const settled = await Promise.allSettled(binding.targets.map((target, index) =>
				this.syncTarget(file, binding, target, index, contentHash, refs, mermaidRendered, plantUmlRendered, storageXhtml),
			));

			const successful: TargetSyncSuccess[] = [];
			const perTarget: FileSyncResult['perTarget'] = [];
			settled.forEach((result, index) => {
				if (result.status === 'fulfilled') {
					successful.push(result.value);
					perTarget.push({
						parentUrl: result.value.parentUrl,
						pageId: result.value.pageId,
						url: result.value.url,
						success: true,
					});
					return;
				}
				const failed = this.toTargetFailureResult(result.reason, binding.targets[index]!, index);
				perTarget.push(failed);
			});

			const failures = perTarget.filter((target) => !target.success);
			if (successful.length > 0) {
				const targetUpdates = binding.targets.map(() => ({}));
				const mergedAttachments: Record<string, Record<string, AttachmentRecord>> = { ...(binding.attachments ?? {}) };
				let attachmentChanged = false;
				for (const target of successful) {
					targetUpdates[target.index] = {
						parentUrl: target.parentUrl ?? '',
						url: target.url,
						pageId: target.pageId,
					};
					if (target.attachments) {
						mergedAttachments[target.pageId] = target.attachments;
						attachmentChanged = true;
					}
				}
				const patch: Parameters<typeof writeBinding>[2] = { targetUpdates };
				patch._formats = binding._formats;
				const allTargetsSucceeded = failures.length === 0;
				const anyUpdated = successful.some((target) => !target.skipped);
				if (allTargetsSucceeded && anyUpdated) {
					patch.lastSynced = new Date().toISOString();
					patch.lastHash = contentHash;
				}
				if (attachmentChanged) patch.attachments = mergedAttachments;
				await writeBinding(this.deps.app, file, patch, this.deps.settings.frontmatterKey);
			}

			const uploadedAttachments = successful.reduce((sum, target) => sum + target.uploadedAttachments, 0);
			const skippedAttachments = successful.reduce((sum, target) => sum + target.skippedAttachments, 0);
			const failedAttachments = successful.reduce((sum, target) => sum + target.failedAttachments, 0);
			const skipped = failures.length === 0 && successful.every((target) => target.skipped);
			if (failures.length === 0) {
				this.deps.logger.info(`已同步: ${path}`, `目标 ${successful.length},附件 上传 ${uploadedAttachments} / 复用 ${skippedAttachments} / 失败 ${failedAttachments}`);
			} else {
				this.deps.logger.warn(`部分目标同步失败: ${path}`, failures.map((target) => target.error ?? '').join('\n'));
			}
			return {
				path,
				skipped,
				success: failures.length === 0,
				error: failures.length > 0 ? failures.map((target) => target.error ?? '').join('; ') : undefined,
				uploadedAttachments,
				skippedAttachments,
				perTarget,
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.deps.logger.error(`同步失败: ${path}`, msg);
			return { path, skipped: false, success: false, error: msg };
		}
	}

	/**
	 * 构造 wikilink / 标准 markdown 链接 → Confluence URL 解析器。
	 *
	 * 解析顺序(任一命中即返回):
	 *   1. getFirstLinkpathDest 原样查(适用 wikilink 形式 `[[note]]`、Obsidian shortest-path)
	 *   2. 剥 `.md` 后缀再查(适用标准链接 `[t](note.md)`,Obsidian 解析对带后缀的命中不稳定)
	 *   3. 按相对路径解析(适用 `../docs/foo.md` 这种跨目录路径)
	 *
	 * 命中后再从目标的 frontmatter 拿 targets[0].url;没有 binding / URL 空都返回 null,降级纯文本。
	 */
	/**
	 * @[[Name]] mention 解析(issue #3 Phase 1):目标笔记 frontmatter 的 confluence_username。
	 * 有意不做 Confluence API 搜人 —— 同步是定时/批量后台任务,中途发网络请求或弹交互框
	 * 都会拖垮批量流程;用户在人员笔记里维护一次 confluence_username 即可长期复用。
	 */
	private makeMentionResolver(): (linkpath: string, sourcePath: string) => string | null {
		const { app } = this.deps;
		return (linkpath, sourcePath) => {
			const target = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			if (!target) return null;
			const fm = app.metadataCache.getFileCache(target)?.frontmatter as Record<string, unknown> | undefined;
			const username = fm?.['confluence_username'];
			return typeof username === 'string' && username.trim().length > 0 ? username.trim() : null;
		};
	}

	private makeWikilinkResolver(): (linkpath: string, sourcePath: string) => string | null {
		const { app, settings } = this.deps;
		const findTarget = (linkpath: string, sourcePath: string): TFile | null => {
			const direct = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			if (direct) return direct;
			const stripped = linkpath.replace(/\.md$/i, '');
			if (stripped !== linkpath) {
				const t = app.metadataCache.getFirstLinkpathDest(stripped, sourcePath);
				if (t) return t;
			}
			// 相对路径解析(./ 或 ../ 开头,或本身包含 /)
			if (linkpath.includes('/') || linkpath.startsWith('.')) {
				const sourceDir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
				const joined = normalizeVaultPath(sourceDir, linkpath);
				const tryPaths = joined.endsWith('.md') ? [joined] : [joined + '.md', joined];
				for (const p of tryPaths) {
					const af = app.vault.getAbstractFileByPath(p);
					if (af instanceof TFileCtor) return af;
				}
			}
			return null;
		};
		return (linkpath, sourcePath) => {
			const target = findTarget(linkpath, sourcePath);
			if (!target) return null;
			const binding = readBindingFromCache(app, target, settings.frontmatterKey);
			if (!binding) return null;
			const url = binding.targets[0]?.url?.trim();
			return url && url.length > 0 ? url : null;
		};
	}

	/**
	 * 批量同步前置:对每个还没拿到 pageId 的目标提前创建占位页,
	 * 并把 confluence_url / confluence_page_id 写回 frontmatter,
	 * 这样后续真正同步时 wikilink resolver 才能查到 peer 的 URL。
	 *
	 * 仅创建,不更新内容(占位 "(syncing…)" 会在后续 Pass 2 被真正内容覆盖)。
	 */
	private async ensurePageIdsForBatch(files: TFile[]): Promise<void> {
		const { app, api, settings, logger } = this.deps;
		for (const file of files) {
			const binding = readBindingFromCache(app, file, settings.frontmatterKey);
			if (!binding) continue;

			const targetUpdates: TargetBindingPatch[] = [];
			let changed = false;
			for (const target of binding.targets) {
				let pageId = target.pageId || (target.url ? parsePageIdFromUrl(target.url) ?? '' : '');
				if (pageId === '0') pageId = '';
				if (pageId) {
					targetUpdates.push({});
					continue;
				}
				if (!target.parentUrl) {
					targetUpdates.push({});
					continue;
				}
				const parentId = parsePageIdFromUrl(target.parentUrl);
				if (!parentId) {
					targetUpdates.push({});
					continue;
				}
				try {
					const parent = await api.getPage(parentId);
					if (!parent.spaceKey) {
						targetUpdates.push({});
						continue;
					}
					logger.info(`预创建子页面: ${file.basename} (parent=${parentId}, space=${parent.spaceKey})`);
					const created = await api.createPage({
						spaceKey: parent.spaceKey,
						parentId,
						title: file.basename,
						storageXhtml: '<p>(syncing…)</p>',
					});
					targetUpdates.push({
						parentUrl: target.parentUrl,
						pageId: created.id,
						url: created.webUrl,
					});
					changed = true;
				} catch (e) {
					// 单个目标预创建失败不阻塞批次,正式 Pass 时 syncTarget 会再次尝试并把错误归到该目标
					logger.warn(`预创建子页面失败: ${file.path}`, e instanceof Error ? e.message : String(e));
					targetUpdates.push({});
				}
			}
			if (changed) {
				await writeBinding(app, file, { targetUpdates, _formats: binding._formats }, settings.frontmatterKey);
			}
		}
	}

	private async renderMermaidOnce(refs: ExtractedReferences): Promise<RenderedDiagram[]> {
		if (!this.mermaid || refs.mermaid.length === 0) return [];
		const rendered = await this.mermaid.renderAll(refs.mermaid);
		return rendered.filter((r): r is RenderedDiagram => r !== null);
	}

	private async renderPlantUmlOnce(refs: ExtractedReferences): Promise<RenderedDiagram[]> {
		if (!this.plantUml || refs.plantUml.length === 0) return [];
		const rendered = await this.plantUml.renderAll(refs.plantUml);
		return rendered.filter((r): r is RenderedDiagram => r !== null);
	}

	private async syncTarget(
		file: TFile,
		binding: NoteBinding,
		target: SyncTarget,
		index: number,
		contentHash: string,
		refs: ExtractedReferences,
		mermaidRendered: RenderedDiagram[],
		plantUmlRendered: RenderedDiagram[],
		storageXhtml: string,
	): Promise<TargetSyncSuccess> {
		let pageId = target.pageId || (target.url ? parsePageIdFromUrl(target.url) ?? '' : '');
		if (pageId === '0') pageId = '';
		let url = target.url;
		let createdNewPage = false;
		try {
			if (!pageId) {
				if (!target.parentUrl) {
					throw new Error(`无法从 URL 解析 pageId: ${target.url}`);
				}
				const parentId = parsePageIdFromUrl(target.parentUrl);
				if (!parentId) {
					throw new Error(`无法从 parent URL 解析 pageId: ${target.parentUrl}`);
				}
				const parent = await this.deps.api.getPage(parentId);
				if (!parent.spaceKey) {
					throw new Error(`父页面缺少 spaceKey: ${target.parentUrl}`);
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
				url = created.webUrl;
				createdNewPage = true;
				this.deps.logger.info(`已创建子页面 ${created.id}: ${created.webUrl}`);
			}

			if (!createdNewPage && binding.lastHash === contentHash && target.pageId === pageId && target.url.trim().length > 0) {
				return {
					index,
					parentUrl: target.parentUrl,
					pageId,
					url,
					success: true,
					skipped: true,
					uploadedAttachments: 0,
					skippedAttachments: 0,
					failedAttachments: 0,
				};
			}

			const previousAttachments = binding.attachments?.[pageId] ?? {};
			const attachmentResult = this.deps.settings.uploadAttachments
				? await this.uploader.syncAttachments(pageId, refs.attachments, previousAttachments)
				: { map: {} as Record<string, AttachmentRecord>, uploaded: 0, skipped: 0, failed: 0 };

			const mermaidRecords: Record<string, AttachmentRecord> = {};
			for (const r of mermaidRendered) {
				const rec = await this.uploader.uploadBytes(pageId, r.block.filename, r.png, previousAttachments);
				if (rec) mermaidRecords[r.block.filename] = rec;
			}

			const plantUmlRecords: Record<string, AttachmentRecord> = {};
			for (const r of plantUmlRendered) {
				const rec = await this.uploader.uploadBytes(pageId, r.block.filename, r.png, previousAttachments);
				if (rec) plantUmlRecords[r.block.filename] = rec;
			}

			const page = await this.deps.api.getPage(pageId);
			await this.updatePageWithRetry(pageId, file.basename, storageXhtml, page.version, file.path);

			const mergedAttachments: Record<string, AttachmentRecord> = {
				...previousAttachments,
				...attachmentResult.map,
				...mermaidRecords,
				...plantUmlRecords,
			};
			const stillReferenced = new Set<string>([
				...Object.keys(attachmentResult.map),
				...Object.keys(mermaidRecords),
				...Object.keys(plantUmlRecords),
			]);
			for (const k of Object.keys(mergedAttachments)) {
				if (!stillReferenced.has(k)) delete mergedAttachments[k];
			}

			return {
				index,
				parentUrl: target.parentUrl,
				pageId,
				url,
				success: true,
				skipped: false,
				uploadedAttachments: attachmentResult.uploaded,
				skippedAttachments: attachmentResult.skipped,
				failedAttachments: attachmentResult.failed,
				attachments: mergedAttachments,
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new TargetSyncFailure(msg, index, target, pageId, url);
		}
	}

	private async updatePageWithRetry(
		pageId: string,
		title: string,
		storageXhtml: string,
		currentVersion: number,
		path: string,
	): Promise<void> {
		try {
			await this.deps.api.updatePage(pageId, {
				title,
				storageXhtml,
				newVersion: currentVersion + 1,
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
				return;
			}
			throw e;
		}
	}

	private toTargetFailureResult(reason: unknown, target: SyncTarget, index: number): TargetSyncFailureResult {
		if (reason instanceof TargetSyncFailure) {
			return {
				index: reason.index,
				parentUrl: reason.target.parentUrl,
				pageId: reason.pageId,
				url: reason.url,
				success: false,
				error: reason.message,
			};
		}
		return {
			index,
			parentUrl: target.parentUrl,
			pageId: target.pageId,
			url: target.url,
			success: false,
			error: reason instanceof Error ? reason.message : String(reason),
		};
	}

	/** 重新读取 settings 后调用,重建 renderer 实例 */
	rebuildRenderers(): void {
		if (this.deps.settings.renderMermaidToPng) {
			this.mermaid = this.deps.settings.mermaidRenderer === 'obsidian'
				? new ObsidianMermaidRenderer(this.deps.app, this.deps.logger)
				: new KrokiMermaidRenderer(this.deps.settings.mermaidRenderUrl, this.deps.logger);
		} else {
			this.mermaid = null;
		}
		this.plantUml = this.deps.settings.renderPlantUmlToPng
			? new PlantUmlRenderer(this.deps.settings.plantUmlServerUrl, this.deps.logger)
			: null;
		this.uploader = new AttachmentUploader(this.deps.app, this.deps.api, this.deps.logger, {
			maxSizeBytes: Math.max(1, this.deps.settings.maxAttachmentSizeMB) * 1024 * 1024,
		});
	}
}

/** 把 base 目录(可能空串)与相对/绝对 linkpath 合并为 vault 内规范化路径,处理 ./ 与 ../ */
function normalizeVaultPath(baseDir: string, linkpath: string): string {
	const parts: string[] = [];
	const push = (segs: string[]) => {
		for (const seg of segs) {
			if (!seg || seg === '.') continue;
			if (seg === '..') {
				if (parts.length > 0) parts.pop();
				continue;
			}
			parts.push(seg);
		}
	};
	push(baseDir.split('/'));
	push(linkpath.split('/'));
	return parts.join('/');
}

// 让 eslint 不抱怨 NoteBinding 未使用 (类型 re-export 给上层方便引用)
export type { NoteBinding };
