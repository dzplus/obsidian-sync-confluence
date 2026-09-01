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

/** Keys that must never be copied from untrusted YAML/frontmatter into our maps. */
export function isUnsafeObjectKey(key: string): boolean {
	return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export interface TargetBindingPatch {
	parentUrl?: string;
	url?: string;
	pageId?: string;
}

export interface BindingPatch {
	targetUpdates?: TargetBindingPatch[];
	_formats?: NoteBindingFormats;
	lastSynced?: string;
	/**
	 * Per-instance hash delta. The engine passes only its OWN slice updates
	 * (the pageIds it actually pushed in this sync). writeBinding merges
	 * the delta against the current frontmatter inside a plugin-wide mutex
	 * so foreign slices are preserved verbatim, even under concurrent
	 * writers. Passing a full map here would re-introduce the
	 * stale-snapshot race the mutex alone cannot prevent.
	 */
	lastHashDelta?: Record<string, Record<string, string>>;
	attachmentsDelta?: Record<string, Record<string, Record<string, AttachmentRecord>>>;
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
	const attachments = normalizeAttachments(rawAttachments);
	const rawLastSynced = fm[FIELD.LAST_SYNCED];
	const rawLastHash = fm[FIELD.LAST_HASH];

	return {
		targets,
		_formats: formats,
		lastSynced: typeof rawLastSynced === 'string' ? rawLastSynced : undefined,
		lastHash: readLastHashFromFrontmatter(rawLastHash),
		attachments,
	};
}

/**
 * Serialize writeBinding calls through a plugin-wide mutex so concurrent
 * engines writing the same file's frontmatter can't race on the merge.
 */
let writeLock: Promise<void> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
	const prev = writeLock;
	let release!: () => void;
	writeLock = new Promise<void>((resolve) => { release = resolve; });
	try {
		await prev;
		return await fn();
	} finally {
		release();
	}
}

/** 同步成功后回写 frontmatter。app.fileManager.processFrontMatter 会原子地处理。 */
export async function writeBinding(app: App, file: TFile, patch: BindingPatch, urlKey: string = FIELD.URL): Promise<void> {
	await withWriteLock(async () => {
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
			if (patch.lastHashDelta !== undefined) {
				fm[FIELD.LAST_HASH] = mergeLastHash(fm[FIELD.LAST_HASH], patch.lastHashDelta);
			}
			if (patch.attachmentsDelta !== undefined) {
				fm[FIELD.ATTACHMENTS] = mergeAttachments(fm[FIELD.ATTACHMENTS], patch.attachmentsDelta);
			}
		});
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

export function readTargetsFromFrontmatter(
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
	if (format === 'csv') return values.map(escapeCsvSegment).join(', ');
	// scalar 遇多值升 YAML list,让 Obsidian 属性面板识别为 List 类型 → 每个值独立 pill
	if (values.length > 1) return values;
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

/**
 * Normalize the `confluence_attachments` frontmatter into the per-instance
 * nested shape. The pre-multi-instance flat form
 * `{ filename: { hash, id } }` is handled by `migrateLegacyFrontmatter` in
 * `main.ts` — by the time this function runs in production, all bound
 * notes are in the per-instance form. Other shapes (pageId-nested,
 * malformed) return undefined and the caller treats the note as having no
 * attachment cache; the engine will re-upload on next sync.
 */
function normalizeAttachments(
	v: unknown,
): Record<string, Record<string, Record<string, AttachmentRecord>>> | undefined {
	if (isTripleNestedAttachmentMap(v)) return v;
	return undefined;
}

/**
 * Normalize the `confluence_last_hash` frontmatter into the per-instance
 * nested shape. The pre-multi-instance string form
 * `lastHash: "H"` is handled by `migrateLegacyFrontmatter` in `main.ts` —
 * by the time this function runs in production, all bound notes are in
 * the per-instance form. Other shapes return undefined.
 */
function readLastHashFromFrontmatter(
	raw: unknown,
): Record<string, Record<string, string>> | undefined {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const result: Record<string, Record<string, string>> = {};
		for (const [instanceId, instanceHash] of Object.entries(raw as Record<string, unknown>)) {
			if (isUnsafeObjectKey(instanceId)) continue;
			if (!instanceHash || typeof instanceHash !== 'object' || Array.isArray(instanceHash)) continue;
			const inner: Record<string, string> = {};
			for (const [pageId, hash] of Object.entries(instanceHash as Record<string, unknown>)) {
				if (isUnsafeObjectKey(pageId)) continue;
				if (typeof hash === 'string') inner[pageId] = hash;
			}
			if (Object.keys(inner).length > 0) result[instanceId] = inner;
		}
		return Object.keys(result).length > 0 ? result : undefined;
	}
	return undefined;
}

/**
 * Resolve the cached content hash for a specific (instanceId, pageId) pair.
 * Returns undefined when no record exists.
 */
export function getLastHashForTarget(
	binding: NoteBinding,
	instanceId: string,
	pageId: string,
): string | undefined {
	const raw = binding.lastHash;
	if (raw === undefined) return undefined;
	return raw[instanceId]?.[pageId];
}

/**
 * Atomically merge an engine-supplied hash delta into the current
 * `confluence_last_hash` frontmatter. Runs inside writeBinding's
 * plugin-wide mutex so concurrent writers serialize. Foreign slices
 * (other instanceIds) are preserved verbatim; the engine's own slice is
 * overwritten from the delta.
 */
export function mergeLastHash(
	existing: unknown,
	delta: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
	const base: Record<string, Record<string, string>> = {};

	if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
		for (const [instanceId, instanceHash] of Object.entries(existing as Record<string, unknown>)) {
			if (isUnsafeObjectKey(instanceId)) continue;
			if (!instanceHash || typeof instanceHash !== 'object' || Array.isArray(instanceHash)) continue;
			const inner: Record<string, string> = {};
			for (const [pageId, hash] of Object.entries(instanceHash as Record<string, unknown>)) {
				if (isUnsafeObjectKey(pageId)) continue;
				if (typeof hash === 'string') inner[pageId] = hash;
			}
			if (Object.keys(inner).length > 0) base[instanceId] = inner;
		}
	}

	for (const [instanceId, instanceHash] of Object.entries(delta)) {
		if (isUnsafeObjectKey(instanceId)) continue;
		if (!instanceHash || typeof instanceHash !== 'object') continue;
		const target = base[instanceId] ?? {};
		for (const [pageId, hash] of Object.entries(instanceHash)) {
			if (isUnsafeObjectKey(pageId)) continue;
			if (typeof hash === 'string') target[pageId] = hash;
		}
		base[instanceId] = target;
	}

	for (const instanceId of Object.keys(base)) {
		if (Object.keys(base[instanceId]!).length === 0) delete base[instanceId];
	}

	return base;
}

/**
 * Atomically merge an engine-supplied attachments delta into the current
 * `confluence_attachments` frontmatter. Same shape invariant as
 * mergeLastHash: every instance slice (foreign and own) is preserved,
 * and per-pageId entries are replaced from the delta (not merged —
 * the engine passes the authoritative full set after its `stillReferenced`
 * cleanup).
 */
export function mergeAttachments(
	existing: unknown,
	delta: Record<string, Record<string, Record<string, AttachmentRecord>>>,
): Record<string, Record<string, Record<string, AttachmentRecord>>> {
	const base: Record<string, Record<string, Record<string, AttachmentRecord>>> = {};

	if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
		for (const [instanceId, pageBucket] of Object.entries(existing as Record<string, unknown>)) {
			if (isUnsafeObjectKey(instanceId)) continue;
			if (!pageBucket || typeof pageBucket !== 'object' || Array.isArray(pageBucket)) continue;
			const inner: Record<string, Record<string, AttachmentRecord>> = {};
			for (const [pageId, filenameBucket] of Object.entries(pageBucket as Record<string, unknown>)) {
				if (isUnsafeObjectKey(pageId)) continue;
				if (isFlatAttachmentMap(filenameBucket)) {
					inner[pageId] = copyFlatAttachmentMap(filenameBucket);
				}
			}
			if (Object.keys(inner).length > 0) base[instanceId] = inner;
		}
	}

	for (const [instanceId, pageBucket] of Object.entries(delta)) {
		if (isUnsafeObjectKey(instanceId)) continue;
		if (!pageBucket || typeof pageBucket !== 'object') continue;
		const target = base[instanceId] ?? {};
		for (const [pageId, filenameBucket] of Object.entries(pageBucket)) {
			if (isUnsafeObjectKey(pageId)) continue;
			if (isFlatAttachmentMap(filenameBucket)) {
				target[pageId] = copyFlatAttachmentMap(filenameBucket);
			}
		}
		base[instanceId] = target;
	}

	for (const instanceId of Object.keys(base)) {
		if (Object.keys(base[instanceId]!).length === 0) delete base[instanceId];
	}

	return base;
}

function isFlatAttachmentMap(v: unknown): v is Record<string, AttachmentRecord> {
	if (!v || typeof v !== 'object') return false;
	for (const k of Object.keys(v as Record<string, unknown>)) {
		if (isUnsafeObjectKey(k)) continue;
		const entry = (v as Record<string, unknown>)[k];
		if (!entry || typeof entry !== 'object') return false;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return false;
	}
	return true;
}

function copyFlatAttachmentMap(v: Record<string, AttachmentRecord>): Record<string, AttachmentRecord> {
	const out: Record<string, AttachmentRecord> = {};
	for (const [k, rec] of Object.entries(v)) {
		if (isUnsafeObjectKey(k)) continue;
		out[k] = rec;
	}
	return out;
}

/**
 * Current per-instance attachment shape:
 * `{ instanceId: { pageId: { filename: { hash, id } } } }`.
 */
function isTripleNestedAttachmentMap(
	v: unknown,
): v is Record<string, Record<string, Record<string, AttachmentRecord>>> {
	if (!v || typeof v !== 'object') return false;
	for (const instanceId of Object.keys(v as Record<string, unknown>)) {
		if (isUnsafeObjectKey(instanceId)) continue;
		const instanceBucket = (v as Record<string, unknown>)[instanceId];
		if (!instanceBucket || typeof instanceBucket !== 'object') return false;
		for (const pageId of Object.keys(instanceBucket as Record<string, unknown>)) {
			if (isUnsafeObjectKey(pageId)) continue;
			const pageBucket = (instanceBucket as Record<string, unknown>)[pageId];
			if (!isFlatAttachmentMap(pageBucket)) return false;
		}
	}
	return true;
}

export const FrontmatterFields = FIELD;
