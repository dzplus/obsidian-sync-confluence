import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import * as obsidianModule from 'obsidian';
import type SyncConfluencePlugin from './main';
import { ConfluenceApi, ConfluenceAuthType } from './confluence/api';
import { t } from './i18n';

export interface SyncConfluenceSettings {
	// ========== 认证 ==========
	/** 例: https://your-domain.atlassian.net/wiki */
	confluenceBaseUrl: string;
	/** 认证方式:basic(用户名+密码/Token)或 bearer(PAT) */
	authType: ConfluenceAuthType;
	/** basic 模式必填:Cloud 是邮箱,Server 是域账号;bearer 模式忽略 */
	username: string;
	/** SecretStorage 中保存的密钥名称(不存明文)。basic→密码/API Token,bearer→PAT */
	apiToken: string;

	// ========== 调度 ==========
	/** 分钟,0=禁用定时同步 */
	syncInterval: number;
	syncOnStartup: boolean;

	// ========== 扫描范围 ==========
	/** 仅扫描这些目录(相对 vault 根),空数组=全 vault */
	scanFolders: string[];
	/** glob 模式列表,匹配的文件跳过 */
	ignorePatterns: string[];

	// ========== 模板 ==========
	templateFolderPath: string;
	autoInstallTemplate: boolean;

	// ========== 行为 ==========
	showStatusBar: boolean;
	showNotice: boolean;
	frontmatterKey: string;

	// ========== 附件 ==========
	uploadAttachments: boolean;
	maxAttachmentSizeMB: number;

	// ========== 图表渲染 ==========
	renderMermaidToPng: boolean;
	mermaidRenderUrl: string;
	renderPlantUmlToPng: boolean;
	plantUmlServerUrl: string;
}

export const DEFAULT_SETTINGS: SyncConfluenceSettings = {
	confluenceBaseUrl: '',
	authType: 'basic',
	username: '',
	apiToken: '',

	syncInterval: 30,
	syncOnStartup: false,

	scanFolders: [],
	ignorePatterns: ['.obsidian/**', '.trash/**', 'templates/**'],

	templateFolderPath: 'templates',
	autoInstallTemplate: true,

	showStatusBar: true,
	showNotice: true,
	frontmatterKey: 'confluence_url',

	uploadAttachments: true,
	maxAttachmentSizeMB: 10,

	renderMermaidToPng: true,
	mermaidRenderUrl: 'https://kroki.io/mermaid/png',
	renderPlantUmlToPng: false,
	plantUmlServerUrl: 'https://www.plantuml.com/plantuml',
};

export class SyncConfluenceSettingTab extends PluginSettingTab {
	plugin: SyncConfluencePlugin;
	private authResultEl: HTMLElement | null = null;

	constructor(app: App, plugin: SyncConfluencePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		// ===== 认证 =====
		this.renderSection(containerEl, t('settings.section.auth'), (el) => {
			new Setting(el)
				.setName(t('settings.baseUrl.name'))
				.setDesc(t('settings.baseUrl.desc'))
				.addText((tx) => tx
					.setPlaceholder('https://xxx.atlassian.net/wiki')
					.setValue(s.confluenceBaseUrl)
					.onChange(async (v) => {
						s.confluenceBaseUrl = v.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(el)
				.setName(t('settings.authType.name'))
				.setDesc(t('settings.authType.desc'))
				.addDropdown((d) => d
					.addOption('basic', t('settings.authType.basic'))
					.addOption('bearer', t('settings.authType.bearer'))
					.setValue(s.authType)
					.onChange(async (v) => {
						s.authType = v as ConfluenceAuthType;
						await this.plugin.saveSettings();
						this.display(); // 重渲染,切换 username 显隐
					}));

			if (s.authType === 'basic') {
				new Setting(el)
					.setName(t('settings.username.name'))
					.setDesc(t('settings.username.desc'))
					.addText((tx) => tx
						.setPlaceholder(t('settings.username.placeholder'))
						.setValue(s.username)
						.onChange(async (v) => {
							s.username = v.trim();
							await this.plugin.saveSettings();
						}));
			}

			this.renderTokenSetting(el);

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.validate.button')).setCta().onClick(async () => {
					await this.runValidateAuth();
				}));

			this.authResultEl = el.createDiv({ cls: 'sync-confluence-auth-result' });
		});

		// ===== 同步调度 =====
		this.renderSection(containerEl, t('settings.section.schedule'), (el) => {
			new Setting(el)
				.setName(t('settings.interval.name'))
				.setDesc(t('settings.interval.desc'))
				.addText((tx) => tx
					.setPlaceholder('30')
					.setValue(String(s.syncInterval))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						s.syncInterval = isNaN(n) || n < 0 ? 0 : n;
						await this.plugin.saveSettings();
						this.plugin.restartSyncInterval();
					}));

			new Setting(el)
				.setName(t('settings.syncOnStartup.name'))
				.setDesc(t('settings.syncOnStartup.desc'))
				.addToggle((tx) => tx.setValue(s.syncOnStartup).onChange(async (v) => {
					s.syncOnStartup = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.syncNow')).setCta().onClick(async () => {
					await this.plugin.syncAll();
				}));
		});

		// ===== 扫描范围 =====
		this.renderSection(containerEl, t('settings.section.scope'), (el) => {
			new Setting(el)
				.setName(t('settings.scanFolders.name'))
				.setDesc(t('settings.scanFolders.desc'))
				.then((setting) => {
					const ta = setting.controlEl.createEl('textarea', { cls: 'sync-confluence-textarea' });
					ta.value = s.scanFolders.join('\n');
					ta.addEventListener('change', async () => {
						s.scanFolders = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					});
				});

			new Setting(el)
				.setName(t('settings.ignore.name'))
				.setDesc(t('settings.ignore.desc'))
				.then((setting) => {
					const ta = setting.controlEl.createEl('textarea', { cls: 'sync-confluence-textarea' });
					ta.value = s.ignorePatterns.join('\n');
					ta.addEventListener('change', async () => {
						s.ignorePatterns = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					});
				});
		});

		// ===== 模板 =====
		this.renderSection(containerEl, t('settings.section.template'), (el) => {
			new Setting(el)
				.setName(t('settings.templateFolder.name'))
				.setDesc(t('settings.templateFolder.desc'))
				.addText((tx) => tx
					.setPlaceholder('templates')
					.setValue(s.templateFolderPath)
					.onChange(async (v) => {
						s.templateFolderPath = v.trim() || 'templates';
						await this.plugin.saveSettings();
					}));

			new Setting(el)
				.setName(t('settings.autoInstallTemplate.name'))
				.setDesc(t('settings.autoInstallTemplate.desc'))
				.addToggle((tx) => tx.setValue(s.autoInstallTemplate).onChange(async (v) => {
					s.autoInstallTemplate = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText(t('settings.writeTemplateNow')).onClick(async () => {
					const ok = await this.plugin.installTemplateFile(true);
					new Notice(ok ? t('notice.templateWritten') : t('notice.templateWriteFailed'));
				}));
		});

		// ===== 附件 =====
		this.renderSection(containerEl, t('settings.section.attachments'), (el) => {
			new Setting(el)
				.setName(t('settings.uploadAttachments.name'))
				.setDesc(t('settings.uploadAttachments.desc'))
				.addToggle((tx) => tx.setValue(s.uploadAttachments).onChange(async (v) => {
					s.uploadAttachments = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName(t('settings.maxAttachmentSize.name'))
				.setDesc(t('settings.maxAttachmentSize.desc'))
				.addText((tx) => tx
					.setValue(String(s.maxAttachmentSizeMB))
					.onChange(async (v) => {
						const n = parseFloat(v);
						s.maxAttachmentSizeMB = isNaN(n) || n <= 0 ? 10 : n;
						await this.plugin.saveSettings();
					}));
		});

		// ===== 图表渲染 =====
		this.renderSection(containerEl, t('settings.section.diagrams'), (el) => {
			el.createEl('p', {
				text: t('settings.diagramsIntro'),
				cls: 'setting-item-description',
			});

			new Setting(el)
				.setName(t('settings.mermaid.toggleName'))
				.setDesc(t('settings.mermaid.toggleDesc'))
				.addToggle((tx) => tx.setValue(s.renderMermaidToPng).onChange(async (v) => {
					s.renderMermaidToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName(t('settings.mermaid.urlName'))
				.setDesc(t('settings.mermaid.urlDesc'))
				.addText((tx) => tx
					.setPlaceholder('https://kroki.io/mermaid/png')
					.setValue(s.mermaidRenderUrl)
					.onChange(async (v) => {
						s.mermaidRenderUrl = v.trim() || DEFAULT_SETTINGS.mermaidRenderUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));

			new Setting(el)
				.setName(t('settings.plantuml.toggleName'))
				.setDesc(t('settings.plantuml.toggleDesc'))
				.addToggle((tx) => tx.setValue(s.renderPlantUmlToPng).onChange(async (v) => {
					s.renderPlantUmlToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName(t('settings.plantuml.urlName'))
				.setDesc(t('settings.plantuml.urlDesc'))
				.addText((tx) => tx
					.setPlaceholder('https://www.plantuml.com/plantuml')
					.setValue(s.plantUmlServerUrl)
					.onChange(async (v) => {
						s.plantUmlServerUrl = v.trim() || DEFAULT_SETTINGS.plantUmlServerUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));
		});

		// ===== UI 行为 =====
		this.renderSection(containerEl, t('settings.section.ui'), (el) => {
			new Setting(el)
				.setName(t('settings.showStatusBar.name'))
				.addToggle((tx) => tx.setValue(s.showStatusBar).onChange(async (v) => {
					s.showStatusBar = v;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBarVisibility();
				}));

			new Setting(el)
				.setName(t('settings.showNotice.name'))
				.setDesc(t('settings.showNotice.desc'))
				.addToggle((tx) => tx.setValue(s.showNotice).onChange(async (v) => {
					s.showNotice = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName(t('settings.frontmatterKey.name'))
				.setDesc(t('settings.frontmatterKey.desc'))
				.addText((tx) => tx
					.setPlaceholder('confluence_url')
					.setValue(s.frontmatterKey)
					.onChange(async (v) => {
						s.frontmatterKey = v.trim() || 'confluence_url';
						await this.plugin.saveSettings();
					}));
		});
	}

	private renderSection(parent: HTMLElement, title: string, build: (el: HTMLElement) => void): void {
		const section = parent.createDiv({ cls: 'sync-confluence-section' });
		new Setting(section).setName(title).setHeading();
		build(section);
	}

	private renderTokenSetting(parent: HTMLElement): void {
		const isBearer = this.plugin.settings.authType === 'bearer';
		const setting = new Setting(parent)
			.setName(isBearer ? t('settings.token.nameBearer') : t('settings.token.nameBasic'))
			.setDesc(isBearer ? t('settings.token.descBearer') : t('settings.token.descBasic'));
		const SecretComponentCtor = (obsidianModule as unknown as {
			SecretComponent?: new (app: App, el: HTMLElement) => { setValue(v: string): unknown; onChange(fn: (v: string) => void): unknown };
		}).SecretComponent;
		const addComponent = (setting as unknown as { addComponent?: (fn: (el: HTMLElement) => unknown) => Setting }).addComponent;

		if (typeof addComponent === 'function' && SecretComponentCtor) {
			addComponent.call(setting, (compEl: HTMLElement) => {
				const comp = new SecretComponentCtor(this.app, compEl);
				comp.setValue(this.plugin.settings.apiToken);
				comp.onChange(async (value: string) => {
					this.plugin.settings.apiToken = value.trim();
					await this.plugin.saveSettings();
				});
				return comp;
			});
		} else {
			setting.addText((tx) => tx
				.setPlaceholder(t('settings.token.placeholderSecretName'))
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (v) => {
					this.plugin.settings.apiToken = v.trim();
					await this.plugin.saveSettings();
				}));
		}

		const hint = parent.createDiv({ cls: 'sync-confluence-keyvault-hint' });
		hint.createEl('span', { text: t('settings.token.hintLabel'), cls: 'sync-confluence-keyvault-hint-label' });
		hint.createSpan({ text: t('settings.token.hintBody') });
	}

	private async runValidateAuth(): Promise<void> {
		if (!this.authResultEl) return;
		this.authResultEl.removeClass('ok', 'error');
		this.authResultEl.setText(t('settings.validate.pending'));
		try {
			const tokenValue = await this.plugin.getApiTokenValue();
			const s = this.plugin.settings;
			const needsUsername = s.authType === 'basic';
			if (!s.confluenceBaseUrl || (needsUsername && !s.username) || !tokenValue) {
				this.authResultEl.addClass('error');
				this.authResultEl.setText(needsUsername ? t('settings.validate.missingBasic') : t('settings.validate.missingBearer'));
				return;
			}
			const api = new ConfluenceApi({
				baseUrl: s.confluenceBaseUrl,
				authType: s.authType,
				username: s.username,
				apiToken: tokenValue,
			});
			const r = await api.validateAuth();
			if (r.ok) {
				this.authResultEl.addClass('ok');
				this.authResultEl.setText(t('settings.validate.ok', { name: r.displayName ?? '' }));
			} else {
				this.authResultEl.addClass('error');
				this.authResultEl.setText(t('settings.validate.fail', { error: r.error ?? '' }));
			}
		} catch (e) {
			this.authResultEl.addClass('error');
			this.authResultEl.setText(t('settings.validate.exception', { error: e instanceof Error ? e.message : String(e) }));
		}
	}
}
