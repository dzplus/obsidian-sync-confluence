import { Menu, TFile, setIcon } from 'obsidian';
import type SyncConfluencePlugin from '../main';
import { readBindingFromCache } from '../frontmatter/handler';
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
	private observerTimeout: number | null = null;

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
		for (const el of Array.from(document.querySelectorAll(`.${ACTIONS_CLS}`))) el.remove();
	}

	/** 立即尝试注入;行还没渲染出来就挂 observer 等它出现(上限 3s,防泄漏) */
	private scheduleInject(): void {
		this.stopObserver();
		if (this.tryInject()) return;

		const container = this.activeViewContainer();
		if (!container) return;
		this.observer = new MutationObserver(() => {
			if (this.tryInject()) this.stopObserver();
		});
		this.observer.observe(container, { childList: true, subtree: true });
		this.observerTimeout = window.setTimeout(() => this.stopObserver(), 3000);
	}

	private stopObserver(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.observerTimeout !== null) {
			window.clearTimeout(this.observerTimeout);
			this.observerTimeout = null;
		}
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

		const keyEl = row.querySelector('.metadata-property-key') ?? row;
		const wrap = document.createElement('span');
		wrap.className = ACTIONS_CLS;

		this.addButton(wrap, 'cloud-upload', t('propertyActions.sync'), () => {
			void this.plugin.syncFile(file);
		});
		this.addButton(wrap, 'external-link', t('propertyActions.open'), (evt) => {
			this.openBoundPages(file, evt);
		});

		keyEl.appendChild(wrap);
		return true;
	}

	private addButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: (evt: MouseEvent) => void,
	): void {
		const btn = document.createElement('span');
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

	private openBoundPages(file: TFile, evt: MouseEvent): void {
		const binding = readBindingFromCache(this.plugin.app, file, this.plugin.settings.frontmatterKey);
		const urls = (binding?.targets ?? []).map((t) => t.url).filter((u) => u.length > 0);
		if (urls.length === 0) return;
		if (urls.length === 1) {
			window.open(urls[0]!);
			return;
		}
		// 多目标:弹菜单让用户挑
		const menu = new Menu();
		for (const url of urls) {
			menu.addItem((item) => item
				.setTitle(url)
				.setIcon('external-link')
				.onClick(() => window.open(url)));
		}
		menu.showAtMouseEvent(evt);
	}
}
