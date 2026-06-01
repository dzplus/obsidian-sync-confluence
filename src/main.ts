import {
	Editor,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SyncConfluenceSettings,
	SyncConfluenceSettingTab,
} from './settings';
import { ConfluenceApi } from './confluence/api';
import { MarkdownConverter } from './confluence/markdownConverter';
import { SyncEngine } from './sync/syncEngine';
import { Logger } from './utils/logger';
import { StatusBarManager } from './ui/statusBar';
import { CreateBoundNoteModal } from './ui/createBoundNoteModal';
import { insertTemplateFrontmatter } from './frontmatter/handler';
import { SyncStatus } from './types';

const TEMPLATE_FILENAME = 'confluence-note.md';
const TEMPLATE_CONTENT = `---
confluence_url:
confluence_parent_url:
confluence_page_id:
confluence_last_synced:
confluence_last_hash:
---

# 标题

> 两种用法二选一:
> 1. 已有 Confluence 页面 → 把目标页面 URL 填到 \`confluence_url\`
> 2. 还没建页面 → 把父页面 URL 填到 \`confluence_parent_url\`,首次同步时插件会自动以本笔记文件名为标题创建子页面,并把新页面 URL 回写到 \`confluence_url\`
> 其余字段(page_id / last_synced / last_hash)由插件自动维护。

## 正文

在这里写内容...
`;

export default class SyncConfluencePlugin extends Plugin {
	settings!: SyncConfluenceSettings;
	logger!: Logger;
	statusBar: StatusBarManager | null = null;

	private api: ConfluenceApi | null = null;
	private engine: SyncEngine | null = null;
	private syncIntervalToken: number | null = null;
	private startupTimeoutToken: number | null = null;

	async onload() {
		this.logger = new Logger();
		this.logger.info('插件加载中...');

		await this.loadSettings();

		await this.ensureEngine();

		this.addRibbonIcon('cloud-upload', '同步全部笔记到 Confluence', async () => {
			await this.syncAll();
		});

		this.addSettingTab(new SyncConfluenceSettingTab(this.app, this));
		this.registerCommands();
		this.registerMenuIntegrations();

		if (this.settings.showStatusBar) {
			this.statusBar = new StatusBarManager(this);
			this.statusBar.create();
		}

		this.restartSyncInterval();

		if (this.settings.autoInstallTemplate) {
			await this.installTemplateFile(false);
		}

		if (this.settings.syncOnStartup) {
			this.startupTimeoutToken = window.setTimeout(() => {
				this.startupTimeoutToken = null;
				void this.syncAll();
			}, 5000);
		}

		this.logger.info('插件加载完成');
	}

	onunload() {
		this.stopSyncInterval();
		if (this.startupTimeoutToken !== null) {
			window.clearTimeout(this.startupTimeoutToken);
			this.startupTimeoutToken = null;
		}
		this.statusBar?.destroy();
		this.logger?.info('插件已卸载');
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<SyncConfluenceSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** 从 SecretStorage 拿到 token 真值(settings.apiToken 存的是密钥名) */
	async getApiTokenValue(): Promise<string | null> {
		const key = this.settings.apiToken;
		if (!key) return null;
		const storage = (this.app as unknown as { secretStorage?: { getSecret?(key: string): unknown } }).secretStorage;
		if (!storage || typeof storage.getSecret !== 'function') return null;
		try {
			const raw = storage.getSecret(key);
			const value = raw && typeof (raw as { then?: unknown }).then === 'function'
				? await (raw as Promise<unknown>)
				: raw;
			return typeof value === 'string' ? value : null;
		} catch {
			return null;
		}
	}

	private async ensureEngine(): Promise<void> {
		const tokenValue = await this.getApiTokenValue();
		const needsUsername = this.settings.authType === 'basic';
		if (!this.settings.confluenceBaseUrl || (needsUsername && !this.settings.username) || !tokenValue) {
			this.engine = null;
			this.api = null;
			return;
		}
		this.api = new ConfluenceApi({
			baseUrl: this.settings.confluenceBaseUrl,
			authType: this.settings.authType,
			username: this.settings.username,
			apiToken: tokenValue,
		});
		this.engine = new SyncEngine({
			app: this.app,
			settings: this.settings,
			logger: this.logger,
			api: this.api,
		});
	}

	/** 设置变更后调用,如重建 renderer */
	rebuildSyncEngine(): void {
		if (this.engine) {
			this.engine.rebuildRenderers();
		} else {
			void this.ensureEngine();
		}
	}

	/** Settings 改了 token / baseUrl / username 时调用,强制重建 api 与 engine */
	async refreshCredentials(): Promise<void> {
		await this.ensureEngine();
	}

	// =========== 同步入口 ===========

	async syncAll(): Promise<void> {
		await this.ensureEngine();
		if (!this.engine) {
			new Notice('请先在设置中填写 Confluence 认证信息');
			return;
		}
		this.statusBar?.showSyncing('同步中...');
		const r = await this.engine.syncAll();
		if (!r) {
			this.statusBar?.update(SyncStatus.Idle);
			return;
		}
		const summary = `更新 ${r.updated} / 跳过 ${r.skipped} / 失败 ${r.failed}`;
		if (r.failed === 0) {
			this.statusBar?.showSuccess(summary);
			if (this.settings.showNotice && r.total > 0) new Notice(`Sync Confluence: ${summary}`);
		} else {
			this.statusBar?.showFailed(summary);
			if (this.settings.showNotice) new Notice(`Sync Confluence 部分失败: ${summary}`);
		}
	}

	async syncCurrentFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) { new Notice('没有打开的笔记'); return; }
		await this.syncFile(file);
	}

	/** 同步指定文件夹下所有绑定笔记(递归) */
	async syncFolder(folder: TFolder): Promise<void> {
		await this.ensureEngine();
		if (!this.engine) {
			new Notice('请先在设置中填写 Confluence 认证信息');
			return;
		}
		const files = this.collectBoundFilesUnder(folder);
		if (files.length === 0) {
			new Notice(`${folder.name} 下没有绑定的笔记`);
			return;
		}
		this.statusBar?.showSyncing(`同步 ${folder.name}/`);
		this.logger.info(`同步文件夹 ${folder.path}: ${files.length} 个绑定笔记`);
		const r = await this.engine.syncFiles(files);
		if (!r) { this.statusBar?.update(SyncStatus.Idle); return; }
		const summary = `${folder.name}/: 更新 ${r.updated} / 跳过 ${r.skipped} / 失败 ${r.failed}`;
		if (r.failed === 0) {
			this.statusBar?.showSuccess(summary);
			if (this.settings.showNotice) new Notice(`Sync Confluence: ${summary}`);
		} else {
			this.statusBar?.showFailed(summary);
			if (this.settings.showNotice) new Notice(`Sync Confluence 部分失败: ${summary}`);
		}
	}

	async syncFile(file: TFile): Promise<void> {
		await this.ensureEngine();
		if (!this.engine) {
			new Notice('请先在设置中填写 Confluence 认证信息');
			return;
		}
		this.statusBar?.showSyncing('同步中...');
		const r = await this.engine.syncOne(file);
		if (!r) { this.statusBar?.update(SyncStatus.Idle); return; }
		if (r.skipped) {
			this.statusBar?.update(SyncStatus.Idle, '内容未变,已跳过');
			if (this.settings.showNotice) new Notice(`无变化,跳过: ${file.name}`);
		} else if (r.success) {
			this.statusBar?.showSuccess('同步成功');
			if (this.settings.showNotice) new Notice(`已同步: ${file.name}`);
		} else {
			this.statusBar?.showFailed(r.error);
			new Notice(`同步失败: ${file.name}\n${r.error ?? ''}`);
		}
	}

	// =========== 调度 ===========

	restartSyncInterval(): void {
		this.stopSyncInterval();
		if (this.settings.syncInterval > 0) {
			const ms = this.settings.syncInterval * 60 * 1000;
			const id = window.setInterval(() => { void this.syncAll(); }, ms);
			this.registerInterval(id);
			this.syncIntervalToken = id;
			this.logger.info(`定时同步已启动,间隔 ${this.settings.syncInterval} 分钟`);
		}
	}

	private stopSyncInterval(): void {
		if (this.syncIntervalToken !== null) {
			window.clearInterval(this.syncIntervalToken);
			this.syncIntervalToken = null;
		}
	}

	// =========== 模板 ===========

	/** 把 confluence-note.md 写入模板目录。force=true 时覆盖。 */
	async installTemplateFile(force: boolean): Promise<boolean> {
		try {
			const folder = normalizePath(this.settings.templateFolderPath || 'templates');
			await this.ensureFolder(folder);
			const fullPath = folder + '/' + TEMPLATE_FILENAME;
			const existing = this.app.vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) {
				if (!force) return true;
				await this.app.vault.modify(existing, TEMPLATE_CONTENT);
			} else {
				try {
					await this.app.vault.create(fullPath, TEMPLATE_CONTENT);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					if (/already exists/i.test(msg)) return true;
					throw e;
				}
			}
			this.logger.info(`模板已写入: ${fullPath}`);
			return true;
		} catch (e) {
			this.logger.error('模板写入失败', e instanceof Error ? e.message : String(e));
			return false;
		}
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path) return;
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		try {
			await this.app.vault.createFolder(path);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/already exists/i.test(msg)) return;
			throw e;
		}
	}

	// =========== UI ===========

	updateStatusBarVisibility(): void {
		if (this.settings.showStatusBar && !this.statusBar) {
			this.statusBar = new StatusBarManager(this);
			this.statusBar.create();
		} else if (!this.settings.showStatusBar && this.statusBar) {
			this.statusBar.destroy();
			this.statusBar = null;
		}
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'sync-all',
			name: '同步全部笔记',
			callback: () => { void this.syncAll(); },
		});
		this.addCommand({
			id: 'sync-current-file',
			name: '同步当前笔记',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.syncFile(file);
				return true;
			},
		});
		this.addCommand({
			id: 'insert-template',
			name: '在当前笔记插入 frontmatter',
			editorCallback: async (_editor: Editor, view: MarkdownView) => {
				if (!view.file) { new Notice('没有打开的笔记'); return; }
				const ok = await insertTemplateFrontmatter(this.app, view.file);
				new Notice(ok ? 'frontmatter 已插入' : '该笔记已有 confluence_url,跳过');
			},
		});
		this.addCommand({
			id: 'create-bound-note',
			name: '创建绑定笔记',
			callback: () => {
				const modal = new CreateBoundNoteModal(this.app, this.settings.scanFolders[0] ?? '', async (path, url) => {
					await this.ensureFolder(parentOf(path));
					const file = await this.app.vault.create(path, TEMPLATE_CONTENT);
					await insertTemplateFrontmatter(this.app, file, url);
					await this.app.workspace.openLinkText(file.path, '', false);
					return file;
				});
				modal.open();
			},
		});
		this.addCommand({
			id: 'export-storage-preview',
			name: '导出当前笔记的 storage 预览',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.exportStoragePreview(file);
				return true;
			},
		});
		this.addCommand({
			id: 'validate-auth',
			name: '验证认证信息',
			callback: async () => {
				const tokenValue = await this.getApiTokenValue();
				const needsUsername = this.settings.authType === 'basic';
				if (!this.settings.confluenceBaseUrl || (needsUsername && !this.settings.username) || !tokenValue) {
					new Notice('请先填写 Confluence 认证信息');
					return;
				}
				const api = new ConfluenceApi({
					baseUrl: this.settings.confluenceBaseUrl,
					authType: this.settings.authType,
					username: this.settings.username,
					apiToken: tokenValue,
				});
				const r = await api.validateAuth();
				new Notice(r.ok ? `认证成功: ${r.displayName}` : `认证失败: ${r.error}`);
			},
		});
	}

	private registerMenuIntegrations(): void {
		// 编辑器右键:已绑定 → 同步;未绑定 → 插入 frontmatter
		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, _editor: Editor, view: MarkdownView) => {
			const file = view.file;
			if (!file || file.extension !== 'md') return;
			if (this.fileIsBound(file)) {
				menu.addItem((item) => item
					.setTitle('同步到 Confluence')
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFile(file); }));
			} else {
				menu.addItem((item) => item
					.setTitle('插入 Confluence frontmatter')
					.setIcon('cloud')
					.onClick(async () => {
						const ok = await insertTemplateFrontmatter(this.app, file);
						new Notice(ok ? 'frontmatter 已插入,把 confluence_url 改为目标页面 URL' : '该笔记已有 confluence_url');
					}));
			}
		}));

		// 文件树右键:文件 → 同上规则;文件夹 → 同步其下所有绑定笔记
		this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, fileOrFolder) => {
			if (fileOrFolder instanceof TFolder) {
				if (!this.folderHasBoundFile(fileOrFolder)) return;
				menu.addItem((item) => item
					.setTitle('同步到 Confluence(整个文件夹)')
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFolder(fileOrFolder); }));
				return;
			}
			if (!(fileOrFolder instanceof TFile) || fileOrFolder.extension !== 'md') return;
			const file = fileOrFolder;
			if (this.fileIsBound(file)) {
				menu.addItem((item) => item
					.setTitle('同步到 Confluence')
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFile(file); }));
			} else {
				menu.addItem((item) => item
					.setTitle('插入 Confluence frontmatter')
					.setIcon('cloud')
					.onClick(async () => {
						const ok = await insertTemplateFrontmatter(this.app, file);
						new Notice(ok ? 'frontmatter 已插入,打开笔记把 confluence_url 改为目标页面 URL' : '该笔记已有 confluence_url');
					}));
			}
		}));
	}

	/**
	 * 把当前笔记走完整 markdown → storage 转换链(但不真正调 Confluence,也不上传附件/图表),
	 * 把结果写到同目录的 *.preview.xml,方便诊断 XHTML 解析错误。
	 */
	async exportStoragePreview(file: TFile): Promise<void> {
		try {
			const converter = new MarkdownConverter(this.app);
			const markdown = await this.app.vault.cachedRead(file);
			const refs = await converter.extractReferences(markdown, file.path);
			const xhtml = await converter.convert(markdown, file.path, {
				attachedFilenames: new Set(refs.attachments.map((r) => r.filename)),
				mermaidFilenameByHash: new Map(refs.mermaid.map((b) => [b.hash, b.filename.replace(/\.png$/i, '.svg')])),
				plantUmlFilenameByHash: new Map(refs.plantUml.map((b) => [b.hash, b.filename])),
				renderMermaidToPng: this.settings.renderMermaidToPng,
				renderPlantUmlToPng: this.settings.renderPlantUmlToPng,
			});
			const lines = xhtml.split('\n').map((l, i) => `${String(i + 1).padStart(5, ' ')}  ${l}`).join('\n');
			const previewPath = file.path.replace(/\.md$/i, '.preview.xml');
			const existing = this.app.vault.getAbstractFileByPath(previewPath);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, lines);
			} else {
				await this.app.vault.create(previewPath, lines);
			}
			new Notice(`已导出 storage 预览: ${previewPath}`);
		} catch (e) {
			new Notice('导出预览失败: ' + (e instanceof Error ? e.message : String(e)));
		}
	}

	/** 递归收集文件夹下所有"绑定"的 markdown 文件(含 confluence_url 或 confluence_parent_url) */
	private collectBoundFilesUnder(folder: TFolder): TFile[] {
		const out: TFile[] = [];
		const walk = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFolder) walk(child);
				else if (child instanceof TFile && child.extension === 'md' && this.fileIsBound(child)) {
					out.push(child);
				}
			}
		};
		walk(folder);
		return out;
	}

	/** 文件夹下是否至少有 1 个绑定笔记(用于 file-menu 决定是否显示菜单项) */
	private folderHasBoundFile(folder: TFolder): boolean {
		const stack: TFolder[] = [folder];
		while (stack.length > 0) {
			const f = stack.pop()!;
			for (const child of f.children) {
				if (child instanceof TFolder) stack.push(child);
				else if (child instanceof TFile && child.extension === 'md' && this.fileIsBound(child)) {
					return true;
				}
			}
		}
		return false;
	}

	private fileIsBound(file: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return false;
		const url = fm[this.settings.frontmatterKey];
		const parent = fm['confluence_parent_url'];
		const hasUrl = typeof url === 'string' && url.trim().length > 0;
		const hasParent = typeof parent === 'string' && parent.trim().length > 0;
		return hasUrl || hasParent;
	}
}

function parentOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx > 0 ? path.slice(0, idx) : '';
}
