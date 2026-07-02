import type { App, TFile } from 'obsidian';
import { NoteBinding, AttachmentRecord, SyncTarget, NoteBindingFormats, FrontmatterFieldFormat } from '../types';

const FIELD = {
	URL: 'confluence_url',
	PARENT_URL: 'confluence_parent_url',
	PAGE_ID: 'confluence_page_id',
	LAST_SYNCED: 'confluence_last_synced',
	LAST_HASH: 'confluence_last_hash',
	ATTACHMENTS: 'confluence_attachments',
} as const;

/**
 * frontmatter 在 Obsidian 类型上是 `any`,但我们只读写已知字段,
 * 全局缩窄为 `Record<string, unknown>` 让 lint 不再报 no-unsafe-*。
 */
export type Frontmatter = Record<string, unknown>;

export interface TargetBindingPatch {
	parentUrl?: string;
	url?: string;
	pageId?: string;
}

export interface BindingPatch {
	targetUpdates?: TargetBindingPatch[];
	_formats?: NoteBindingFormats;
	lastSynced?: string;
	lastHash?: string;
	attachments?: Record<string, Record<string, AttachmentRecord>>;
}

/**
 * 从 frontmatter 读取 Confluence 绑定信息。
 * 仅在存在 confluence_url 或 confluence_parent_url 时返回非 null。
 */
export function readBindingFromCache(app: App, file: TFile, urlKey: string = FIELD.URL): NoteBinding | null {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
	if (!fm) return null;
	const { targets, formats } = readTargetsFromFrontmatter(fm, urlKey);
	if (!targetsHaveBinding(targets)) return null;

	const rawAttachments = fm[FIELD.ATTACHMENTS];
	const attachments = normalizeAttachments(rawAttachments, targets);
	const rawLastSynced = fm[FIELD.LAST_SYNCED];
	const rawLastHash = fm[FIELD.LAST_HASH];

	return {
		targets,
		_formats: formats,
		lastSynced: typeof rawLastSynced === 'string' ? rawLastSynced : undefined,
		lastHash: typeof rawLastHash === 'string' ? rawLastHash : undefined,
		attachments,
	};
}

/** 同步成功后回写 frontmatter。app.fileManager.processFrontMatter 会原子地处理。 */
export async function writeBinding(app: App, file: TFile, patch: BindingPatch, urlKey: string = FIELD.URL): Promise<void> {
	await app.fileManager.processFrontMatter(file, (raw: unknown) => {
		const fm = raw as Frontmatter;
		if (patch.targetUpdates !== undefined) {
			const parsed = readTargetsFromFrontmatter(fm, urlKey, Math.max(1, patch.targetUpdates.length));
			const targets = parsed.targets;
			for (let i = targets.length; i < patch.targetUpdates.length; i++) {
				targets.push({ url: '', pageId: '' });
			}
			patch.targetUpdates.forEach((update, index) => {
				const target = targets[index];
				if (!target) return;
				if (update.url !== undefined) target.url = update.url;
				if (update.parentUrl !== undefined) target.parentUrl = update.parentUrl || undefined;
				if (update.pageId !== undefined) target.pageId = update.pageId;
			});
			writeTargetsToFrontmatter(fm, targets, urlKey, patch._formats ?? parsed.formats);
		}
		if (patch.lastSynced !== undefined) fm[FIELD.LAST_SYNCED] = patch.lastSynced;
		if (patch.lastHash !== undefined) fm[FIELD.LAST_HASH] = patch.lastHash;
		if (patch.attachments !== undefined) fm[FIELD.ATTACHMENTS] = patch.attachments;
	});
}

/** 给当前文件插入模板 frontmatter 字段(仅在尚未存在绑定时);返回是否插入了。 */
export async function insertTemplateFrontmatter(
	app: App,
	file: TFile,
	placeholderUrl = '',
	urlKey: string = FIELD.URL,
): Promise<boolean> {
	let inserted = false;
	await app.fileManager.processFrontMatter(file, (raw: unknown) => {
		const fm = raw as Frontmatter;
		if (frontmatterHasBinding(fm, urlKey)) return;
		fm[urlKey] = placeholderUrl;
		fm[FIELD.PARENT_URL] = '';
		fm[FIELD.PAGE_ID] = '';
		fm[FIELD.LAST_SYNCED] = '';
		fm[FIELD.LAST_HASH] = '';
		inserted = true;
	});
	return inserted;
}

export function frontmatterHasBinding(fm: Frontmatter, urlKey: string = FIELD.URL): boolean {
	return targetsHaveBinding(readTargetsFromFrontmatter(fm, urlKey).targets);
}

function readTargetsFromFrontmatter(
	fm: Frontmatter,
	urlKey: string,
	minLength = 1,
): { targets: SyncTarget[]; formats: NoteBindingFormats } {
	const urls = normalizeToArray(fm[urlKey], 'url');
	const parents = normalizeToArray(fm[FIELD.PARENT_URL], 'url');
	const pageIds = normalizeToArray(fm[FIELD.PAGE_ID], 'pageId');
	const length = Math.max(minLength, urls.values.length, parents.values.length, pageIds.values.length);
	const targets: SyncTarget[] = [];
	for (let i = 0; i < length; i++) {
		const parentUrl = parents.values[i] ?? '';
		targets.push({
			url: urls.values[i] ?? '',
			parentUrl: parentUrl || undefined,
			pageId: pageIds.values[i] ?? '',
		});
	}
	return {
		targets,
		formats: {
			url: urls.format,
			parentUrl: parents.format,
			pageId: pageIds.format,
		},
	};
}

function writeTargetsToFrontmatter(
	fm: Frontmatter,
	targets: SyncTarget[],
	urlKey: string,
	formats: NoteBindingFormats,
): void {
	fm[urlKey] = serializeValues(targets.map((target) => target.url), formats.url);
	fm[FIELD.PARENT_URL] = serializeValues(targets.map((target) => target.parentUrl ?? ''), formats.parentUrl);
	fm[FIELD.PAGE_ID] = serializeValues(targets.map((target) => target.pageId), formats.pageId);
}

function normalizeToArray(v: unknown, kind: 'url' | 'pageId'): { values: string[]; format: FrontmatterFieldFormat } {
	if (Array.isArray(v)) {
		return { values: v.map(normalizeScalarValue), format: 'array' };
	}
	if (typeof v !== 'string') return { values: [], format: 'scalar' };
	const value = v.trim();
	if (!hasComma(value)) return { values: [value], format: 'scalar' };
	const parts = splitCsv(value);
	if (kind === 'url' && parts.some((part) => part.length > 0 && !part.startsWith('http'))) {
		return { values: [value], format: 'scalar' };
	}
	return { values: parts, format: 'csv' };
}

function serializeValues(values: string[], format: FrontmatterFieldFormat): string | string[] {
	if (format === 'array') return values;
	if (format === 'csv' || values.length > 1) return values.map(escapeCsvSegment).join(', ');
	return values[0] ?? '';
}

function hasComma(value: string): boolean {
	return value.includes(',') || value.includes('，');
}

function splitCsv(value: string): string[] {
	return value.split(/[，,]/).map((part) => {
		const trimmed = part.trim();
		return trimmed === '""' || trimmed === "''" ? '' : trimmed;
	});
}

function escapeCsvSegment(value: string): string {
	return value.length > 0 ? value : '""';
}

function normalizeScalarValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	return typeof value === 'string' ? value.trim() : String(value).trim();
}

function targetsHaveBinding(targets: SyncTarget[]): boolean {
	return targets.some((target) => target.url.trim().length > 0 || (target.parentUrl?.trim().length ?? 0) > 0);
}

function normalizeAttachments(
	v: unknown,
	targets: SyncTarget[],
): Record<string, Record<string, AttachmentRecord>> | undefined {
	if (isNestedAttachmentMap(v)) return v;
	if (isFlatAttachmentMap(v)) {
		const firstPageId = targets[0]?.pageId ?? '';
		return { [firstPageId]: v };
	}
	return undefined;
}

function isFlatAttachmentMap(v: unknown): v is Record<string, AttachmentRecord> {
	if (!v || typeof v !== 'object') return false;
	for (const k of Object.keys(v as Record<string, unknown>)) {
		const entry = (v as Record<string, unknown>)[k];
		if (!entry || typeof entry !== 'object') return false;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return false;
	}
	return true;
}

function isNestedAttachmentMap(v: unknown): v is Record<string, Record<string, AttachmentRecord>> {
	if (!v || typeof v !== 'object') return false;
	for (const pageId of Object.keys(v as Record<string, unknown>)) {
		const pageBucket = (v as Record<string, unknown>)[pageId];
		if (!isFlatAttachmentMap(pageBucket)) return false;
	}
	return true;
}

export const FrontmatterFields = FIELD;
