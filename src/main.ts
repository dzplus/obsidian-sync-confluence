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
import { scanBoundNotes } from './sync/noteScanner';
import { InstanceResolver } from './sync/instanceResolver';
import { Logger } from './utils/logger';
import { StatusBarManager } from './ui/statusBar';
import { PropertyActionsManager } from './ui/propertyActions';
import { CreateBoundNoteModal } from './ui/createBoundNoteModal';
import { frontmatterHasBinding, insertTemplateFrontmatter, type Frontmatter } from './frontmatter/handler';
import { extractFirstTargetUrl, isCleartextHttpUrl } from './confluence/urlMatch';
import { LEGACY_MIGRATION_VERSION, migrateLegacySettings, migrateLegacyFrontmatter, migrateLegacyUsernames } from './migration';
import {
	SyncStatus,
	type ConfluenceInstance,
	type MultiInstanceBatchResult,
	type PerInstanceSyncResult,
} from './types';
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
	propertyActions: PropertyActionsManager | null = null;

	private engines: Map<string, SyncEngine> = new Map();
	private syncIntervalToken: number | null = null;
	private startupTimeoutToken: number | null = null;
	/** Log the cleartext-HTTP warning once per instance URL per session. */
	private httpWarnedKeys = new Set<string>();
	/**
	 * Tracks the last plugin version that ran both `migrateLegacySettings`
	 * and `migrateLegacyFrontmatter`. When this mismatches
	 * `LEGACY_MIGRATION_VERSION`, both migrations run once on plugin load
	 * (each is idempotent for already-migrated data); once the marker is
	 * at `LEGACY_MIGRATION_VERSION`, both migrations are bypassed entirely.
	 */
	private legacyMigrationVersion: string | null = null;

	async onload() {
		this.logger = new Logger();
		this.logger.info(t('plugin.loading'));

		await this.loadSettings();

		await this.ensureEngines();

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

		this.propertyActions = new PropertyActionsManager(this);
		this.propertyActions.start();

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
		this.propertyActions?.destroy();
		this.propertyActions = null;
		this.statusBar?.destroy();
		this.logger?.info(t('plugin.unloaded'));
	}

	async loadSettings() {
		const data = (await this.loadData()) as (Partial<SyncConfluenceSettings> & { legacyMigrationVersion?: string }) | null;
		const { legacyMigrationVersion, ...rest } = data ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, rest);
		this.legacyMigrationVersion = legacyMigrationVersion ?? null;
		if (this.legacyMigrationVersion !== LEGACY_MIGRATION_VERSION) {
			migrateLegacySettings(this.settings, this.logger);
			// `getMarkdownFiles()` returns 0 at plugin onload on large vaults —
			// Obsidian hasn't finished indexing yet. Run inline when the vault
			// is already populated (small vaults), otherwise defer 5s (same
			// window as `syncOnStartup`) so the vault has time to settle.
			const files = this.app.vault.getMarkdownFiles();
			if (files.length > 0) {
				await this.runFrontmatterMigrations();
			} else {
				window.setTimeout(() => { void this.runFrontmatterMigrations(); }, 5000);
			}
		}
	}

	private async runFrontmatterMigrations(): Promise<void> {
		try {
			await migrateLegacyFrontmatter(this.app, this.settings, this.logger);
			await migrateLegacyUsernames(this.app, this.settings, this.logger);
			this.legacyMigrationVersion = LEGACY_MIGRATION_VERSION;
			await this.saveSettings();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logger?.error('Frontmatter migrations failed', msg);
		}
	}

	async saveSettings() {
		const data: Record<string, unknown> = {
			...this.settings as unknown as Record<string, unknown>,
		};
		if (this.legacyMigrationVersion !== null) {
			data.legacyMigrationVersion = this.legacyMigrationVersion;
		}
		await this.saveData(data);
	}

	/**
	 * Resolve the secret token value for a given instance from SecretStorage.
	 * `instances[i].apiToken` stores the KEY NAME in the vault (selected by the
	 * user via SecretComponent). Legacy migration preserves the existing key
	 * name so the current SecretStorage entry remains valid.
	 */
	async getApiTokenValueForInstance(instanceId: string): Promise<string | null> {
		const inst = this.settings.instances.find((i) => i.id === instanceId);
		if (!inst) return null;
		if (!inst.apiToken) return null;
		return this.getSecretValue(inst.apiToken);
	}

	private async getSecretValue(key: string): Promise<string | null> {
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

	private async ensureEngines(): Promise<void> {
		this.engines.clear();
		for (const inst of this.settings.instances) {
			const tokenValue = await this.getApiTokenValueForInstance(inst.id);
			const needsUsername = inst.authType === 'basic';
			if (!inst.baseUrl || (needsUsername && !inst.username) || !tokenValue) {
				continue;
			}
			if (isCleartextHttpUrl(inst.baseUrl)) {
				const warnKey = `${inst.id}:${inst.baseUrl}`;
				if (!this.httpWarnedKeys.has(warnKey)) {
					this.httpWarnedKeys.add(warnKey);
					this.logger.warn(t('settings.baseUrl.httpWarning'), inst.name);
				}
			}
			const api = new ConfluenceApi({
				baseUrl: inst.baseUrl,
				authType: inst.authType,
				username: inst.username,
				apiToken: tokenValue,
			});
			const engine = new SyncEngine({
				app: this.app,
				settings: this.settings,
				logger: this.logger,
				api,
				instance: inst,
				instances: this.settings.instances,
			});
			this.engines.set(inst.id, engine);
		}
	}

	/** 设置变更后调用,如重建 renderer */
	async rebuildSyncEngine(): Promise<void> {
		for (const engine of this.engines.values()) {
			engine.rebuildRenderers();
		}
		if (this.engines.size === 0) {
			await this.ensureEngines();
		}
	}

	/** Settings 改了 token / baseUrl / username 时调用,强制重建 api 与 engine */
	async refreshCredentials(): Promise<void> {
		await this.ensureEngines();
	}

	// =========== 同步入口 ===========

	/**
	 * Run a single instance's bound-note group and return its
	 * `PerInstanceSyncResult`. Used by both syncAll and syncFolder — the
	 * two flows differ only in how they build the group list, not in how
	 * each group is processed.
	 */
	private async runInstanceGroup(
		instance: ConfluenceInstance,
		files: TFile[],
	): Promise<PerInstanceSyncResult> {
		const engine = this.engines.get(instance.id);
		const baseResult = {
			instanceName: instance.name,
			instanceId: instance.id,
		};
		if (!engine) {
			return {
				...baseResult,
				total: files.length,
				updated: 0,
				skipped: 0,
				failed: files.length,
				files: files.map((f) => ({
					path: f.path,
					skipped: false,
					success: false,
					error: t('notice.fillAuthFirst'),
				})),
			};
		}
		const r = await engine.syncFiles(files);
		if (!r) {
			return {
				...baseResult,
				total: files.length,
				updated: 0,
				skipped: 0,
				failed: files.length,
				files: files.map((f) => ({
					path: f.path,
					skipped: false,
					success: false,
					error: 'Engine busy',
				})),
			};
		}
		return {
			...baseResult,
			total: r.total,
			updated: r.updated,
			skipped: r.skipped,
			failed: r.failed,
			files: r.files,
		};
	}

	async syncAll(): Promise<void> {
		await this.ensureEngines();
		if (this.engines.size === 0) {
			new Notice(t('notice.fillAuthFirst'));
			return;
		}
		const files = scanBoundNotes(this.app, {
			frontmatterKey: this.settings.frontmatterKey,
			scanFolders: this.settings.scanFolders,
			ignorePatterns: this.settings.ignorePatterns,
		});
		if (files.length === 0) {
			this.statusBar?.update(SyncStatus.Idle);
			return;
		}
		this.statusBar?.showSyncing(t('status.syncing'));
		const resolver = new InstanceResolver({ instances: this.settings.instances });
		const { groups, unmatched } = resolver.groupByInstance(files, this.app, this.settings.frontmatterKey);

		const result: MultiInstanceBatchResult = {
			instances: [],
			total: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: unmatched.map((f) => ({
				path: f.path,
				skipped: false,
				success: false,
				error: t('notice.unmatchedUrl', { url: this.getFileUrl(f) }),
			})),
		};

		for (const [, group] of groups) {
			const perInst = await this.runInstanceGroup(group.instance, group.files);
			result.instances.push(perInst);
			result.total += perInst.total;
			result.updated += perInst.updated;
			result.skipped += perInst.skipped;
			result.failed += perInst.failed;
		}

		result.total += unmatched.length;
		result.failed += unmatched.length;

		this.showMultiInstanceResult(result);
	}

	async syncCurrentFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) { new Notice(t('notice.noteNotOpen')); return; }
		await this.syncFile(file);
	}

	/** 同步指定文件夹下所有绑定笔记(递归) */
	async syncFolder(folder: TFolder): Promise<void> {
		await this.ensureEngines();
		if (this.engines.size === 0) {
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
		const resolver = new InstanceResolver({ instances: this.settings.instances });
		const { groups, unmatched } = resolver.groupByInstance(files, this.app, this.settings.frontmatterKey);

		const result: MultiInstanceBatchResult = {
			instances: [],
			total: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: unmatched.map((f) => ({
				path: f.path,
				skipped: false,
				success: false,
				error: t('notice.unmatchedUrl', { url: this.getFileUrl(f) }),
			})),
		};

		for (const [, group] of groups) {
			const perInst = await this.runInstanceGroup(group.instance, group.files);
			result.instances.push(perInst);
			result.total += perInst.total;
			result.updated += perInst.updated;
			result.skipped += perInst.skipped;
			result.failed += perInst.failed;
		}

		result.total += unmatched.length;
		result.failed += unmatched.length;
		this.showMultiInstanceResult(result, folder.name + '/');
	}

	async syncFile(file: TFile): Promise<void> {
		if (!this.fileIsBound(file)) {
			new Notice(t('notice.noteNotBound'));
			return;
		}
		await this.ensureEngines();
		if (this.engines.size === 0) {
			new Notice(t('notice.fillAuthFirst'));
			return;
		}
		this.statusBar?.showSyncing(t('status.syncing'));
		const resolver = new InstanceResolver({ instances: this.settings.instances });

		// Multi-target files may span instances — route to every matched engine,
		// not just the first. Each engine independently filters binding.targets
		// to the subset it owns (see SyncEngine.targetBelongsToInstance).
		const { groups } = resolver.groupByInstance([file], this.app, this.settings.frontmatterKey);
		const matchedInstances = new Map<string, ConfluenceInstance>();
		for (const group of groups.values()) {
			matchedInstances.set(group.instance.id, group.instance);
		}
		if (matchedInstances.size === 0) {
			this.statusBar?.update(SyncStatus.Idle);
			new Notice(t('notice.unmatchedUrl', { url: this.getFileUrl(file) }));
			return;
		}

		const result: MultiInstanceBatchResult = {
			instances: [],
			total: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: [],
		};
		for (const inst of matchedInstances.values()) {
			const engine = this.engines.get(inst.id);
			if (!engine) {
				result.instances.push({
					instanceName: inst.name,
					instanceId: inst.id,
					total: 1,
					updated: 0,
					skipped: 0,
					failed: 1,
					files: [{
						path: file.path,
						skipped: false,
						success: false,
						error: t('notice.fillAuthFirst'),
					}],
				});
				result.total += 1;
				result.failed += 1;
				continue;
			}
			const r = await engine.syncOne(file);
			if (!r) {
				result.instances.push({
					instanceName: inst.name,
					instanceId: inst.id,
					total: 1,
					updated: 0,
					skipped: 0,
					failed: 1,
					files: [{
						path: file.path,
						skipped: false,
						success: false,
						error: 'Engine busy',
					}],
				});
				result.total += 1;
				result.failed += 1;
				continue;
			}
			const updated = r.success && !r.skipped ? 1 : 0;
			const skipped = r.skipped ? 1 : 0;
			const failed = !r.success ? 1 : 0;
			result.instances.push({
				instanceName: inst.name,
				instanceId: inst.id,
				total: 1,
				updated,
				skipped,
				failed,
				files: [r],
			});
			result.total += 1;
			result.updated += updated;
			result.skipped += skipped;
			result.failed += failed;
		}

		this.showMultiInstanceResult(result);
	}

	private showMultiInstanceResult(result: MultiInstanceBatchResult, title?: string): void {
		const anyFailed = result.failed > 0 || result.unmatched.length > 0;
		// all-failed = nothing was successfully synced or skipped. Previously we
		// required `instances.length > 0`, which mis-classified the case where
		// every scanned note landed in `unmatched` (instances empty, but still
		// wholly failed).
		const allFailed = result.updated === 0 && result.skipped === 0 && result.failed > 0;
		const lines = result.instances.map((i) => t('notice.instanceSummary', {
			name: i.instanceName,
			updated: String(i.updated),
			skipped: String(i.skipped),
			failed: String(i.failed),
		}));
		if (result.unmatched.length > 0) {
			lines.push(`Unmatched: ${result.unmatched.length}`);
		}
		const summary = (title ? `${title}\n` : '') + lines.join('\n');
		if (anyFailed) {
			if (allFailed) {
				this.statusBar?.showFailed(summary);
			} else {
				this.statusBar?.showPartial(summary);
			}
			if (this.settings.showNotice) {
				const noticeKey = allFailed ? 'notice.syncFailed' : 'notice.syncPartialFail';
				new Notice(t(noticeKey, { summary }));
			}
		} else {
			this.statusBar?.showSuccess(summary);
			if (this.settings.showNotice) new Notice(t('notice.syncResult', { summary }));
		}
	}

	/**
	 * Read the binding frontmatter for a file (or empty if unbound).
	 */
	private readFileFrontmatter(file: TFile): Frontmatter {
		return (this.app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined) ?? {};
	}

	/**
	 * First non-empty target URL from a file's binding (used for error
	 * messages). Empty string when the file has no URL.
	 */
	private getFileUrl(file: TFile): string {
		return extractFirstTargetUrl(this.readFileFrontmatter(file), this.settings.frontmatterKey);
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
				const ok = await insertTemplateFrontmatter(this.app, view.file, '', this.settings.frontmatterKey);
				new Notice(ok ? t('notice.frontmatterInsertedShort') : t('notice.frontmatterAlreadyExists'));
			},
		});
		this.addCommand({
			id: 'create-bound-note',
			name: t('command.createBoundNote'),
			callback: () => {
				const modal = new CreateBoundNoteModal(
					this.app,
					this.settings.scanFolders[0] ?? '',
					this.settings.instances,
					async (path, url) => {
						await this.ensureFolder(parentOf(path));
						const file = await this.app.vault.create(path, buildTemplateContent());
						await insertTemplateFrontmatter(this.app, file, url, this.settings.frontmatterKey);
						await this.app.workspace.openLinkText(file.path, '', false);
						return file;
					},
				);
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
				if (this.settings.instances.length === 0) {
					new Notice(t('notice.fillAuthFirst'));
					return;
				}
				const results: string[] = [];
				for (const inst of this.settings.instances) {
					const tokenValue = await this.getApiTokenValueForInstance(inst.id);
					const needsUsername = inst.authType === 'basic';
					if (!inst.baseUrl || (needsUsername && !inst.username) || !tokenValue) {
						results.push(`${inst.name}: ${needsUsername ? t('settings.validate.missingBasic') : t('settings.validate.missingBearer')}`);
						continue;
					}
					const api = new ConfluenceApi({
						baseUrl: inst.baseUrl,
						authType: inst.authType,
						username: inst.username,
						apiToken: tokenValue,
					});
					const r = await api.validateAuth();
					results.push(r.ok
						? `${inst.name}: ${t('notice.authOk', { name: r.displayName ?? '' })}`
						: `${inst.name}: ${t('notice.authFail', { error: r.error ?? '' })}`);
				}
				new Notice(results.join('\n'));
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
							const ok = await insertTemplateFrontmatter(this.app, file, '', this.settings.frontmatterKey);
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
							const ok = await insertTemplateFrontmatter(this.app, file, '', this.settings.frontmatterKey);
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
			const mermaidExt: 'svg' | 'png' = this.settings.mermaidRenderer === 'obsidian' ? 'svg' : 'png';
			const refs = await converter.extractReferences(markdown, file.path, { mermaidExt });
			// `stripSupplementaryChars` is per-instance. For the preview we pick
			// the instance whose baseUrl matches the note's confluence_url —
			// that's the one that would actually consume the output. Fall back
			// to the first configured instance, then to `false` for users with
			// no instances yet.
			const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Frontmatter;
			const fallbackUrl = extractFirstTargetUrl(fm, this.settings.frontmatterKey);
			const resolver = new InstanceResolver({ instances: this.settings.instances });
			const matchedInst = this.settings.instances.length > 0
				? (resolver.resolve(fallbackUrl) ?? this.settings.instances[0]!)
				: null;
			const xhtml = await converter.convert(markdown, file.path, {
				attachedFilenames: new Set(refs.attachments.map((r) => r.filename)),
				mermaidFilenameByHash: new Map(refs.mermaid.map((b) => [b.hash, b.filename])),
				plantUmlFilenameByHash: new Map(refs.plantUml.map((b) => [b.hash, b.filename])),
				renderMermaidToPng: this.settings.renderMermaidToPng,
				renderPlantUmlToPng: this.settings.renderPlantUmlToPng,
				defaultImageWidthPx: this.settings.defaultImageWidthPx,
				stripSupplementaryChars: matchedInst?.stripSupplementaryChars ?? false,
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
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
		if (!fm) return false;
		return frontmatterHasBinding(fm, this.settings.frontmatterKey);
	}
}

function parentOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx > 0 ? path.slice(0, idx) : '';
}
