import type { App, TFile } from 'obsidian';
import { NoteBinding, AttachmentRecord } from '../types';

const FIELD = {
	URL: 'confluence_url',
	PARENT_URL: 'confluence_parent_url',
	PAGE_ID: 'confluence_page_id',
	LAST_SYNCED: 'confluence_last_synced',
	LAST_HASH: 'confluence_last_hash',
	ATTACHMENTS: 'confluence_attachments',
} as const;

export interface BindingPatch {
	url?: string;
	pageId?: string;
	lastSynced?: string;
	lastHash?: string;
	attachments?: Record<string, AttachmentRecord>;
}

/**
 * 从 frontmatter 读取 Confluence 绑定信息。
 * 仅在存在 confluence_url 时返回非 null。
 */
export function readBindingFromCache(app: App, file: TFile, urlKey: string = FIELD.URL): NoteBinding | null {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm) return null;
	const rawUrl = fm[urlKey];
	const rawParent = fm[FIELD.PARENT_URL];
	const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
	const parentUrl = typeof rawParent === 'string' ? rawParent.trim() : '';
	// url 或 parent_url 至少一个有值,才是被本插件管理的笔记
	if (!url && !parentUrl) return null;

	const attachments = isAttachmentMap(fm[FIELD.ATTACHMENTS]) ? fm[FIELD.ATTACHMENTS] : undefined;

	return {
		url,
		parentUrl: parentUrl || undefined,
		pageId: typeof fm[FIELD.PAGE_ID] === 'string' ? fm[FIELD.PAGE_ID] : '',
		lastSynced: typeof fm[FIELD.LAST_SYNCED] === 'string' ? fm[FIELD.LAST_SYNCED] : undefined,
		lastHash: typeof fm[FIELD.LAST_HASH] === 'string' ? fm[FIELD.LAST_HASH] : undefined,
		attachments,
	};
}

/** 同步成功后回写 frontmatter。app.fileManager.processFrontMatter 会原子地处理。 */
export async function writeBinding(app: App, file: TFile, patch: BindingPatch): Promise<void> {
	await app.fileManager.processFrontMatter(file, (fm) => {
		if (patch.url !== undefined) fm[FIELD.URL] = patch.url;
		if (patch.pageId !== undefined) fm[FIELD.PAGE_ID] = patch.pageId;
		if (patch.lastSynced !== undefined) fm[FIELD.LAST_SYNCED] = patch.lastSynced;
		if (patch.lastHash !== undefined) fm[FIELD.LAST_HASH] = patch.lastHash;
		if (patch.attachments !== undefined) fm[FIELD.ATTACHMENTS] = patch.attachments;
	});
}

/** 给当前文件插入模板 frontmatter 字段(仅在尚未存在 confluence_url 时);返回是否插入了。 */
export async function insertTemplateFrontmatter(app: App, file: TFile, placeholderUrl = ''): Promise<boolean> {
	let inserted = false;
	await app.fileManager.processFrontMatter(file, (fm) => {
		if (typeof fm[FIELD.URL] === 'string' && fm[FIELD.URL].trim()) return;
		fm[FIELD.URL] = placeholderUrl;
		fm[FIELD.PARENT_URL] = '';
		fm[FIELD.PAGE_ID] = '';
		fm[FIELD.LAST_SYNCED] = '';
		fm[FIELD.LAST_HASH] = '';
		inserted = true;
	});
	return inserted;
}

function isAttachmentMap(v: unknown): v is Record<string, AttachmentRecord> {
	if (!v || typeof v !== 'object') return false;
	for (const k of Object.keys(v as Record<string, unknown>)) {
		const entry = (v as Record<string, unknown>)[k];
		if (!entry || typeof entry !== 'object') return false;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return false;
	}
	return true;
}

export const FrontmatterFields = FIELD;
