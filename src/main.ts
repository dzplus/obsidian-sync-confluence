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
import { t } from './i18n';

const TEMPLATE_FILENAME = 'confluence-note.md';

function buildTemplateContent(): string {
	return `---
confluence_url:
confluence_parent_url:
confluence_page_id:
confluence_last_synced:
confluence_last_hash:
---

${t('template.title')}

${t('template.usage')}

${t('template.bodyHeading')}

${t('template.bodyPlaceholder')}
`;
}

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
		this.logger.info(t('plugin.loading'));

		await this.loadSettings();

		await this.ensureEngine();

		this.addRibbonIcon('cloud-upload', t('plugin.ribbonTooltip'), async () => {
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

		this.logger.info(t('plugin.loaded'));
	}

	onunload() {
		this.stopSyncInterval();
		if (this.startupTimeoutToken !== null) {
			window.clearTimeout(this.startupTimeoutToken);
			this.startupTimeoutToken = null;
		}
		this.statusBar?.destroy();
		this.logger?.info(t('plugin.unloaded'));
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
			new Notice(t('notice.fillAuthFirst'));
			return;
		}
		this.statusBar?.showSyncing(t('status.syncing'));
		const r = await this.engine.syncAll();
		if (!r) {
			this.statusBar?.update(SyncStatus.Idle);
			return;
		}
		const summary = t('summary.all', { updated: r.updated, skipped: r.skipped, failed: r.failed });
		if (r.failed === 0) {
			this.statusBar?.showSuccess(summary);
			if (this.settings.showNotice && r.total > 0) new Notice(t('notice.syncResult', { summary }));
		} else {
			this.statusBar?.showFailed(summary);
			if (this.settings.showNotice) new Notice(t('notice.syncPartialFail', { summary }));
		}
	}

	async syncCurrentFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) { new Notice(t('notice.noteNotOpen')); return; }
		await this.syncFile(file);
	}

	/** 同步指定文件夹下所有绑定笔记(递归) */
	async syncFolder(folder: TFolder): Promise<void> {
		await this.ensureEngine();
		if (!this.engine) {
			new Notice(t('notice.fillAuthFirst'));
			return;
		}
		const files = this.collectBoundFilesUnder(folder);
		if (files.length === 0) {
			new Notice(t('notice.folderNoBoundNotes', { folder: folder.name }));
			return;
		}
		this.statusBar?.showSyncing(folder.name + '/');
		this.logger.info(`Sync folder ${folder.path}: ${files.length} bound notes`);
		const r = await this.engine.syncFiles(files);
		if (!r) { this.statusBar?.update(SyncStatus.Idle); return; }
		const summary = t('summary.folder', {
			folder: folder.name,
			updated: r.updated,
			skipped: r.skipped,
			failed: r.failed,
		});
		if (r.failed === 0) {
			this.statusBar?.showSuccess(summary);
			if (this.settings.showNotice) new Notice(t('notice.syncResult', { summary }));
		} else {
			this.statusBar?.showFailed(summary);
			if (this.settings.showNotice) new Notice(t('notice.syncPartialFail', { summary }));
		}
	}

	async syncFile(file: TFile): Promise<void> {
		await this.ensureEngine();
		if (!this.engine) {
			new Notice(t('notice.fillAuthFirst'));
			return;
		}
		this.statusBar?.showSyncing(t('status.syncing'));
		const r = await this.engine.syncOne(file);
		if (!r) { this.statusBar?.update(SyncStatus.Idle); return; }
		if (r.skipped) {
			this.statusBar?.update(SyncStatus.Idle);
			if (this.settings.showNotice) new Notice(t('notice.syncedNoChange', { file: file.name }));
		} else if (r.success) {
			this.statusBar?.showSuccess();
			if (this.settings.showNotice) new Notice(t('notice.syncedOk', { file: file.name }));
		} else {
			this.statusBar?.showFailed(r.error);
			new Notice(t('notice.syncedFail', { file: file.name, error: r.error ?? '' }));
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
			this.logger.info(`Scheduled sync started, interval ${this.settings.syncInterval} min`);
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
			const content = buildTemplateContent();
			if (existing instanceof TFile) {
				if (!force) return true;
				await this.app.vault.modify(existing, content);
			} else {
				try {
					await this.app.vault.create(fullPath, content);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					if (/already exists/i.test(msg)) return true;
					throw e;
				}
			}
			this.logger.info(`Template written: ${fullPath}`);
			return true;
		} catch (e) {
			this.logger.error('Failed to write template', e instanceof Error ? e.message : String(e));
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
			name: t('command.syncAll'),
			callback: () => { void this.syncAll(); },
		});
		this.addCommand({
			id: 'sync-current-file',
			name: t('command.syncCurrent'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.syncFile(file);
				return true;
			},
		});
		this.addCommand({
			id: 'insert-template',
			name: t('command.insertTemplate'),
			editorCallback: async (_editor: Editor, view: MarkdownView) => {
				if (!view.file) { new Notice(t('notice.noteNotOpen')); return; }
				const ok = await insertTemplateFrontmatter(this.app, view.file);
				new Notice(ok ? t('notice.frontmatterInsertedShort') : t('notice.frontmatterAlreadyExists'));
			},
		});
		this.addCommand({
			id: 'create-bound-note',
			name: t('command.createBoundNote'),
			callback: () => {
				const modal = new CreateBoundNoteModal(this.app, this.settings.scanFolders[0] ?? '', async (path, url) => {
					await this.ensureFolder(parentOf(path));
					const file = await this.app.vault.create(path, buildTemplateContent());
					await insertTemplateFrontmatter(this.app, file, url);
					await this.app.workspace.openLinkText(file.path, '', false);
					return file;
				});
				modal.open();
			},
		});
		this.addCommand({
			id: 'export-storage-preview',
			name: t('command.exportStoragePreview'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.exportStoragePreview(file);
				return true;
			},
		});
		this.addCommand({
			id: 'validate-auth',
			name: t('command.validateAuth'),
			callback: async () => {
				const tokenValue = await this.getApiTokenValue();
				const needsUsername = this.settings.authType === 'basic';
				if (!this.settings.confluenceBaseUrl || (needsUsername && !this.settings.username) || !tokenValue) {
					new Notice(t('notice.fillAuthFirst'));
					return;
				}
				const api = new ConfluenceApi({
					baseUrl: this.settings.confluenceBaseUrl,
					authType: this.settings.authType,
					username: this.settings.username,
					apiToken: tokenValue,
				});
				const r = await api.validateAuth();
				new Notice(r.ok
					? t('notice.authOk', { name: r.displayName ?? '' })
					: t('notice.authFail', { error: r.error ?? '' }));
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
					.setTitle(t('menu.syncToConfluence'))
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFile(file); }));
			} else {
				menu.addItem((item) => item
					.setTitle(t('menu.insertFrontmatter'))
					.setIcon('cloud')
					.onClick(async () => {
						const ok = await insertTemplateFrontmatter(this.app, file);
						new Notice(ok ? t('notice.frontmatterInserted') : t('notice.frontmatterAlreadyExists'));
					}));
			}
		}));

		// 文件树右键:文件 → 同上规则;文件夹 → 同步其下所有绑定笔记
		this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, fileOrFolder) => {
			if (fileOrFolder instanceof TFolder) {
				if (!this.folderHasBoundFile(fileOrFolder)) return;
				menu.addItem((item) => item
					.setTitle(t('menu.syncFolder'))
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFolder(fileOrFolder); }));
				return;
			}
			if (!(fileOrFolder instanceof TFile) || fileOrFolder.extension !== 'md') return;
			const file = fileOrFolder;
			if (this.fileIsBound(file)) {
				menu.addItem((item) => item
					.setTitle(t('menu.syncToConfluence'))
					.setIcon('cloud-upload')
					.onClick(() => { void this.syncFile(file); }));
			} else {
				menu.addItem((item) => item
					.setTitle(t('menu.insertFrontmatter'))
					.setIcon('cloud')
					.onClick(async () => {
						const ok = await insertTemplateFrontmatter(this.app, file);
						new Notice(ok ? t('notice.frontmatterInsertedFileMenu') : t('notice.frontmatterAlreadyExists'));
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
			new Notice(t('notice.exportPreviewOk', { path: previewPath }));
		} catch (e) {
			new Notice(t('notice.exportPreviewFailed', { error: e instanceof Error ? e.message : String(e) }));
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
