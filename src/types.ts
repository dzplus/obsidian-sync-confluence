import type { TFile } from 'obsidian';

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
}

export const SyncStatusText: Record<SyncStatus, string> = {
	[SyncStatus.Idle]: '☁ 空闲',
	[SyncStatus.Syncing]: '☁ 同步中',
	[SyncStatus.Success]: '☁ 已同步',
	[SyncStatus.Failed]: '☁ 失败',
};

/** 单个笔记的 Confluence 绑定信息(从 frontmatter 读出) */
export interface NoteBinding {
	/** confluence_url。空字符串表示尚未创建页面,需要配合 parentUrl 走 createPage 流程 */
	url: string;
	pageId: string;
	/** confluence_parent_url。仅在 url 为空时使用,指定新页面挂哪个父页 */
	parentUrl?: string;
	lastSynced?: string;
	lastHash?: string;
	/** filename -> { hash, id } 附件缓存,用于跳过重传 */
	attachments?: Record<string, AttachmentRecord>;
}

export interface AttachmentRecord {
	hash: string;
	id: string;
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
}

/** 一次 syncAll 的汇总 */
export interface BatchSyncResult {
	total: number;
	updated: number;
	skipped: number;
	failed: number;
	files: FileSyncResult[];
}
