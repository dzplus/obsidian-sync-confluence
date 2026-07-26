import type { TFile } from 'obsidian';
import { t } from './i18n';

export interface LogEntry {
	timestamp: Date;
	level: 'info' | 'warn' | 'error';
	message: string;
	details?: string;
}

export enum SyncStatus {
	Idle = 'idle',
	Syncing = 'syncing',
	Success = 'success',
	Failed = 'failed',
	Partial = 'partial',
}

/**
 * Label shown in the status-bar pill. Evaluated lazily via getters so the
 * active locale (resolved once at i18n load time) is applied at read time.
 */
export const SyncStatusText: Record<SyncStatus, string> = {
	get [SyncStatus.Idle]() { return t('status.idle'); },
	get [SyncStatus.Syncing]() { return t('status.syncing'); },
	get [SyncStatus.Success]() { return t('status.success'); },
	get [SyncStatus.Failed]() { return t('status.failed'); },
	get [SyncStatus.Partial]() { return t('status.partial'); },
} as Record<SyncStatus, string>;

export interface AttachmentRecord {
	hash: string;
	id: string;
}

export interface SyncTarget {
	/** confluence_url。空字符串表示尚未创建页面,需要配合 parentUrl 走 createPage 流程 */
	url: string;
	/** confluence_parent_url。仅在 url 为空时使用,指定新页面挂哪个父页 */
	parentUrl?: string;
	/** resolved or created page ID; empty string when not yet created */
	pageId: string;
}

export type FrontmatterFieldFormat = 'scalar' | 'csv' | 'array';

export interface NoteBindingFormats {
	url: FrontmatterFieldFormat;
	parentUrl: FrontmatterFieldFormat;
	pageId: FrontmatterFieldFormat;
}

/** 单个笔记的 Confluence 绑定信息(从 frontmatter 读出) */
export interface NoteBinding {
	/** index-aligned Confluence target slots; at least one entry */
	targets: SyncTarget[];
	/** in-memory only; used to preserve scalar/csv/array frontmatter style on write */
	_formats?: NoteBindingFormats;
	lastSynced?: string;
	/**
	 * Cached content hash used for the per-target skip check. Shape:
	 * `instanceId → pageId → hash`. The instanceId layer is required because
	 * Confluence pageIds are local to a Server/DC installation — two
	 * instances can have the same pageId, and a single pageId key would let
	 * engine A's stamp vouch for engine B's target. Each engine owns only
	 * its own instance slot; foreign slots are preserved verbatim. Pre-
	 * multi-instance string form was migrated to this shape by
	 * `migrateLegacyFrontmatter` on plugin load.
	 */
	lastHash?: Record<string, Record<string, string>>;
	/**
	 * Attachment cache. Same nested shape: `instanceId → pageId → filename →
	 * { hash, id }`. Pre-multi-instance flat form
	 * `{ filename: { hash, id } }` was migrated by `migrateLegacyFrontmatter`.
	 */
	attachments?: Record<string, Record<string, Record<string, AttachmentRecord>>>;
}

/** markdown 中提取出的本地附件引用 */
export interface AttachmentRef {
	/** Obsidian 内的源 markdown 字符串片段,后续用于替换 */
	rawMatch: string;
	/** 链接或路径文本 */
	linkpath: string;
	/** alt 文本(可选) */
	alt: string;
	/** Obsidian 解析到的实际文件,可能为 null(链接断了) */
	tfile: TFile | null;
	/** 显示用文件名(用于 Confluence 附件名) */
	filename: string;
}

/** 单文件同步结果 */
export interface FileSyncResult {
	path: string;
	skipped: boolean;
	success: boolean;
	error?: string;
	uploadedAttachments?: number;
	skippedAttachments?: number;
		perTarget?: Array<{
			parentUrl?: string;
			pageId: string;
			url: string;
			success: boolean;
			error?: string;
			/**
			 * Multi-instance: true means the target belongs to a different
			 * instance and was not handled by this engine. It does NOT count as a
			 * failure — only this engine's owned targets decide whether to write
			 * its slice of the per-instance lastHash. Foreign slices stay
			 * untouched so the other engine's hash-skip invariant stays correct.
			 */
			foreign?: boolean;
		}>;
}

/** 一次 syncAll 的汇总 */
export interface BatchSyncResult {
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	files: FileSyncResult[];
}

// ========== Multi-Confluence Support Types ==========

/**
 * Per-instance identity map for `@[[Name]]` mentions. With multiple
 * instances the same person can have different usernames on different
 * Confluence installations (e.g. SSO vs. legacy domain account), so the
 * value is keyed by `ConfluenceInstance.id`.
 */
export type PerInstanceUsernameMap = Record<string, string>;

/** Configuration for a single Confluence instance. */
export interface ConfluenceInstance {
	/** Stable identifier (used for SecretStorage key derivation and UI references). */
	id: string;
	/** Display name. */
	name: string;
	/** Example: https://your-domain.atlassian.net/wiki */
	baseUrl: string;
	/** Auth mode: basic (username + password/token) or bearer (PAT). */
	authType: 'basic' | 'bearer';
	/** Required for basic mode. */
	username: string;
	/** Key name in SecretStorage (the secret value is never stored in plain text). */
	apiToken: string;
	/**
	 * Legacy-confluence-server compatibility: replace emoji and other
	 * supplementary characters with [U+XXXX] placeholders so pages sync
	 * successfully when the server's MySQL still uses 3-byte utf8 (issue #5).
	 * Default off; emoji sync natively on Cloud and utf8mb4 servers. Per-instance
	 * because users may maintain a mix of legacy Server and modern Cloud.
	 */
	stripSupplementaryChars: boolean;
}

/** Sync result for a single instance. */
export interface PerInstanceSyncResult {
	instanceName: string;
	instanceId: string;
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	files: FileSyncResult[];
}

/** Aggregate result across all configured instances. */
export interface MultiInstanceBatchResult {
	instances: PerInstanceSyncResult[];
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	/** Files that matched no configured instance. */
	unmatched: FileSyncResult[];
}
