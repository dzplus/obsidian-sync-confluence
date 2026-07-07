import { setIcon } from 'obsidian';
import type SyncConfluencePlugin from '../main';
import { t } from '../i18n';

const ACTIONS_CLS = 'sync-confluence-prop-actions';

/**
 * 在 properties 面板的 confluence_url 行内注入操作图标(issue #2):
 *  - cloud-upload: 同步当前笔记
 *  - external-link: 打开绑定的 Confluence 页面(多目标时弹菜单)
 *
 * 实现参考 Share Note 插件的模式:properties 面板异步渲染,
 * active-leaf-change 后用 MutationObserver 等目标行出现再注入。
 * 有意不做"解绑"按钮 —— 破坏性操作不该在属性面板一击可达。
 */
export class PropertyActionsManager {
	private observer: MutationObserver | null = null;
	private injectPending = false;

	constructor(private plugin: SyncConfluencePlugin) {}

	start(): void {
		const { plugin } = this;
		plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', () => this.scheduleInject()));
		plugin.registerEvent(plugin.app.workspace.on('layout-change', () => this.scheduleInject()));
		plugin.registerEvent(plugin.app.metadataCache.on('changed', (file) => {
			if (file.path === plugin.app.workspace.getActiveFile()?.path) this.scheduleInject();
		}));
		this.scheduleInject();
	}

	destroy(): void {
		this.stopObserver();
		for (const el of Array.from(activeDocument.querySelectorAll(`.${ACTIONS_CLS}`))) el.remove();
	}

	/** 每次触发都常驻观察 activeView:属性面板进入编辑态时 Obsidian 会重建行内 DOM,需要自动重注入 */
	private scheduleInject(): void {
		this.stopObserver();
		this.tryInject();

		const container = this.activeViewContainer();
		if (!container) return;
		this.observer = new MutationObserver(() => this.requestInject());
		this.observer.observe(container, { childList: true, subtree: true });
	}

	/** rAF 合并高频 mutation(编辑时每 keystroke 会 fire) */
	private requestInject(): void {
		if (this.injectPending) return;
		this.injectPending = true;
		window.requestAnimationFrame(() => {
			this.injectPending = false;
			this.tryInject();
		});
	}

	private stopObserver(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private activeViewContainer(): HTMLElement | null {
		const leaf = this.plugin.app.workspace.getMostRecentLeaf();
		return (leaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl ?? null;
	}

	/** @returns true = 已注入或无需注入(行存在) / false = 目标行还没出现 */
	private tryInject(): boolean {
		const container = this.activeViewContainer();
		const file = this.plugin.app.workspace.getActiveFile();
		if (!container || !file) return true;

		const urlKey = this.plugin.settings.frontmatterKey || 'confluence_url';
		const row = container.querySelector(`.metadata-property[data-property-key="${urlKey}"]`);
		if (!row) return false;

		// 重复注入防护:该行已有按钮就不再动
		if (row.querySelector(`.${ACTIONS_CLS}`)) return true;

		const valueEl = row.querySelector('.metadata-property-value') ?? row;
		const wrap = activeDocument.createElement('span');
		wrap.className = ACTIONS_CLS;

		this.addButton(wrap, 'cloud-upload', t('propertyActions.sync'), () => {
			void this.plugin.syncFile(file);
		});

		valueEl.appendChild(wrap);
		return true;
	}

	private addButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: (evt: MouseEvent) => void,
	): void {
		const btn = activeDocument.createElement('span');
		btn.className = 'sync-confluence-prop-btn clickable-icon';
		btn.setAttribute('aria-label', label);
		setIcon(btn, icon);
		this.plugin.registerDomEvent(btn, 'click', (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			onClick(evt);
		});
		parent.appendChild(btn);
	}

}
