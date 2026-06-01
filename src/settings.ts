import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import * as obsidianModule from 'obsidian';
import type SyncConfluencePlugin from './main';
import { ConfluenceApi, ConfluenceAuthType } from './confluence/api';

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
		this.renderSection(containerEl, 'Confluence 认证', (el) => {
			new Setting(el)
				.setName('Confluence base URL')
				.setDesc('Cloud 形如 https://xxx.atlassian.net/wiki;Server 通常无 /wiki 后缀,如 https://confluence.your-corp.com')
				.addText((t) => t
					.setPlaceholder('https://xxx.atlassian.net/wiki')
					.setValue(s.confluenceBaseUrl)
					.onChange(async (v) => {
						s.confluenceBaseUrl = v.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(el)
				.setName('认证方式')
				.setDesc('Basic:用户名 + 密码/API Token,适用于 Cloud(email+API token)与 Server 老账号体系(域账号+密码)。Bearer:Personal Access Token,适用于 Server 7.9+ / DC 启用 PAT 后,或 Cloud OAuth Bearer 令牌。')
				.addDropdown((d) => d
					.addOption('basic', 'Basic(用户名 + 密码/Token)')
					.addOption('bearer', 'Bearer(Personal Access Token)')
					.setValue(s.authType)
					.onChange(async (v) => {
						s.authType = v as ConfluenceAuthType;
						await this.plugin.saveSettings();
						this.display(); // 重渲染,切换 username 显隐
					}));

			if (s.authType === 'basic') {
				new Setting(el)
					.setName('账号(用户名 / 邮箱)')
					.setDesc('Cloud 填 Atlassian 邮箱;Server 填域账号(如 duanzhang)')
					.addText((t) => t
						.setPlaceholder('you@example.com 或 域账号')
						.setValue(s.username)
						.onChange(async (v) => {
							s.username = v.trim();
							await this.plugin.saveSettings();
						}));
			}

			this.renderTokenSetting(el);

			new Setting(el)
				.addButton((btn) => btn.setButtonText('验证认证').setCta().onClick(async () => {
					await this.runValidateAuth();
				}));

			this.authResultEl = el.createDiv({ cls: 'sync-confluence-auth-result' });
		});

		// ===== 同步调度 =====
		this.renderSection(containerEl, '同步调度', (el) => {
			new Setting(el)
				.setName('定时同步间隔(分钟)')
				.setDesc('0 = 禁用定时,仅手动触发')
				.addText((t) => t
					.setPlaceholder('30')
					.setValue(String(s.syncInterval))
					.onChange(async (v) => {
						const n = parseInt(v, 10);
						s.syncInterval = isNaN(n) || n < 0 ? 0 : n;
						await this.plugin.saveSettings();
						this.plugin.restartSyncInterval();
					}));

			new Setting(el)
				.setName('启动时同步一次')
				.setDesc('Obsidian 启动 5 秒后自动跑一次全量同步')
				.addToggle((t) => t.setValue(s.syncOnStartup).onChange(async (v) => {
					s.syncOnStartup = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText('立即同步全部').setCta().onClick(async () => {
					await this.plugin.syncAll();
				}));
		});

		// ===== 扫描范围 =====
		this.renderSection(containerEl, '扫描范围', (el) => {
			new Setting(el)
				.setName('扫描目录(可选)')
				.setDesc('每行一个目录(相对 vault 根)。留空 = 扫描整个 vault')
				.then((setting) => {
					const ta = setting.controlEl.createEl('textarea', { cls: 'sync-confluence-textarea' });
					ta.value = s.scanFolders.join('\n');
					ta.addEventListener('change', async () => {
						s.scanFolders = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					});
				});

			new Setting(el)
				.setName('忽略模式')
				.setDesc('每行一个 glob 模式,匹配的笔记跳过同步')
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
		this.renderSection(containerEl, '笔记模板', (el) => {
			new Setting(el)
				.setName('模板目录')
				.setDesc('模板文件存放路径(相对 vault 根)')
				.addText((t) => t
					.setPlaceholder('templates')
					.setValue(s.templateFolderPath)
					.onChange(async (v) => {
						s.templateFolderPath = v.trim() || 'templates';
						await this.plugin.saveSettings();
					}));

			new Setting(el)
				.setName('自动安装模板')
				.setDesc('插件加载时若模板目录不存在 confluence-note.md 则自动创建')
				.addToggle((t) => t.setValue(s.autoInstallTemplate).onChange(async (v) => {
					s.autoInstallTemplate = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.addButton((btn) => btn.setButtonText('现在写入模板').onClick(async () => {
					const ok = await this.plugin.installTemplateFile(true);
					new Notice(ok ? '模板已写入' : '模板写入失败,查看控制台');
				}));
		});

		// ===== 附件 =====
		this.renderSection(containerEl, '附件', (el) => {
			new Setting(el)
				.setName('上传本地附件')
				.setDesc('启用后,笔记里 ![[image.png]] 形式引用的本地图片会上传为 Confluence 附件')
				.addToggle((t) => t.setValue(s.uploadAttachments).onChange(async (v) => {
					s.uploadAttachments = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName('附件大小上限(MB)')
				.setDesc('超过此大小的附件会被跳过')
				.addText((t) => t
					.setValue(String(s.maxAttachmentSizeMB))
					.onChange(async (v) => {
						const n = parseFloat(v);
						s.maxAttachmentSizeMB = isNaN(n) || n <= 0 ? 10 : n;
						await this.plugin.saveSettings();
					}));
		});

		// ===== 图表渲染 =====
		this.renderSection(containerEl, '图表渲染(Mermaid / PlantUML)', (el) => {
			el.createEl('p', {
				text: '开启后,对应代码块会在本地或远端渲染为 PNG 并上传到 Confluence;关闭则原样推送代码块,由 Confluence 端 App 渲染或显示为源码。',
				cls: 'setting-item-description',
			});

			new Setting(el)
				.setName('Mermaid → PNG')
				.setDesc('POST mermaid 源码到下方 kroki 服务渲染为 PNG 上传(Confluence Server 不 inline 渲染 SVG,且本地 SVG→PNG 路径无中文字体支持)')
				.addToggle((t) => t.setValue(s.renderMermaidToPng).onChange(async (v) => {
					s.renderMermaidToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName('Mermaid 渲染服务 URL')
				.setDesc('完整 URL,默认 https://kroki.io/mermaid/png(公共实例);企业内网可自建 kroki docker 实例后改这里')
				.addText((t) => t
					.setPlaceholder('https://kroki.io/mermaid/png')
					.setValue(s.mermaidRenderUrl)
					.onChange(async (v) => {
						s.mermaidRenderUrl = v.trim() || DEFAULT_SETTINGS.mermaidRenderUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));

			new Setting(el)
				.setName('PlantUML → PNG')
				.setDesc('通过 PlantUML Server 渲染(默认走 plantuml.com 公共实例,有速率限制)')
				.addToggle((t) => t.setValue(s.renderPlantUmlToPng).onChange(async (v) => {
					s.renderPlantUmlToPng = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildSyncEngine();
				}));

			new Setting(el)
				.setName('PlantUML server URL')
				.setDesc('不含尾部 /,例如 https://www.plantuml.com/plantuml 或自建实例')
				.addText((t) => t
					.setPlaceholder('https://www.plantuml.com/plantuml')
					.setValue(s.plantUmlServerUrl)
					.onChange(async (v) => {
						s.plantUmlServerUrl = v.trim() || DEFAULT_SETTINGS.plantUmlServerUrl;
						await this.plugin.saveSettings();
						this.plugin.rebuildSyncEngine();
					}));
		});

		// ===== UI 行为 =====
		this.renderSection(containerEl, '通知与状态栏', (el) => {
			new Setting(el)
				.setName('显示状态栏')
				.addToggle((t) => t.setValue(s.showStatusBar).onChange(async (v) => {
					s.showStatusBar = v;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBarVisibility();
				}));

			new Setting(el)
				.setName('显示通知')
				.setDesc('同步完成 / 失败时弹 Notice')
				.addToggle((t) => t.setValue(s.showNotice).onChange(async (v) => {
					s.showNotice = v;
					await this.plugin.saveSettings();
				}));

			new Setting(el)
				.setName('frontmatter 字段名')
				.setDesc('高级选项:Confluence URL 在 frontmatter 中的字段名,默认 confluence_url')
				.addText((t) => t
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
			.setName(isBearer ? 'Personal Access Token' : '密码 / API Token')
			.setDesc(isBearer
				? '从下方下拉中选择已在密钥库中保存的 PAT(Confluence 个人 → 设置 → Personal Access Tokens 创建)'
				: '从下方下拉中选择已在密钥库中保存的密钥。Cloud 填 Atlassian API Token;Server 域账号体系填登录密码');
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
			setting.addText((t) => t
				.setPlaceholder('密钥名称(需 Obsidian 1.11.4+ 密钥库)')
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (v) => {
					this.plugin.settings.apiToken = v.trim();
					await this.plugin.saveSettings();
				}));
		}

		const hint = parent.createDiv({ cls: 'sync-confluence-keyvault-hint' });
		hint.createEl('span', { text: '创建密钥:', cls: 'sync-confluence-keyvault-hint-label' });
		hint.createSpan({
			text: ' 设置 → 密钥库 → 创建新密钥;在 Atlassian 账户 → Security → API tokens 创建一个 token,粘贴为密钥值。',
		});
	}

	private async runValidateAuth(): Promise<void> {
		if (!this.authResultEl) return;
		this.authResultEl.removeClass('ok', 'error');
		this.authResultEl.setText('验证中...');
		try {
			const tokenValue = await this.plugin.getApiTokenValue();
			const s = this.plugin.settings;
			const needsUsername = s.authType === 'basic';
			if (!s.confluenceBaseUrl || (needsUsername && !s.username) || !tokenValue) {
				this.authResultEl.addClass('error');
				this.authResultEl.setText(needsUsername ? '请先填写 base URL / 账号 / Token' : '请先填写 base URL / PAT');
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
				this.authResultEl.setText(`认证成功: ${r.displayName}`);
			} else {
				this.authResultEl.addClass('error');
				this.authResultEl.setText(`认证失败: ${r.error}`);
			}
		} catch (e) {
			this.authResultEl.addClass('error');
			this.authResultEl.setText('验证异常: ' + (e instanceof Error ? e.message : String(e)));
		}
	}
}
