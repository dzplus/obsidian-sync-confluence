import type { App, TFile } from 'obsidian';

export interface ScanOptions {
	frontmatterKey: string;
	scanFolders: string[];
	ignorePatterns: string[];
}

/**
 * 扫描 vault 中所有含 confluence_url frontmatter 的笔记。
 * 走 metadataCache,O(n) 但每个文件只查 cache(已索引),不读盘。
 */
export function scanBoundNotes(app: App, opts: ScanOptions): TFile[] {
	const all = app.vault.getMarkdownFiles();
	const scanFolders = opts.scanFolders.map(normalizeFolder).filter((s) => s.length > 0);
	const ignoreRegexes = opts.ignorePatterns
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map(globToRegex);

	const out: TFile[] = [];
	for (const file of all) {
		if (scanFolders.length > 0 && !scanFolders.some((f) => file.path === f || file.path.startsWith(f + '/'))) continue;
		if (ignoreRegexes.some((r) => r.test(file.path))) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		const url = fm[opts.frontmatterKey];
		const parentUrl = fm['confluence_parent_url'];
		const hasUrl = typeof url === 'string' && url.trim().length > 0;
		const hasParent = typeof parentUrl === 'string' && parentUrl.trim().length > 0;
		// url 或 parent_url 至少一个有值才同步(parent_url 用于首次自动建子页)
		if (!hasUrl && !hasParent) continue;
		out.push(file);
	}
	return out;
}

function normalizeFolder(s: string): string {
	return s.trim().replace(/^\/+|\/+$/g, '');
}

/** 极简 glob → RegExp:支持 * 与 ? */
function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp('^' + escaped + '$');
}
