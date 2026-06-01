import { SyncStatus, SyncStatusText } from '../types';
import type SyncConfluencePlugin from '../main';

export class StatusBarManager {
	private plugin: SyncConfluencePlugin;
	private el: HTMLElement | null = null;
	private current: SyncStatus = SyncStatus.Idle;

	constructor(plugin: SyncConfluencePlugin) {
		this.plugin = plugin;
	}

	create(): HTMLElement {
		this.el = this.plugin.addStatusBarItem();
		this.el.addClass('sync-confluence-status');
		this.update(SyncStatus.Idle);
		return this.el;
	}

	update(status: SyncStatus, tooltip?: string): void {
		if (!this.el) return;
		this.current = status;
		this.el.removeClass('idle', 'syncing', 'success', 'failed');
		this.el.addClass(status);
		this.el.setText(SyncStatusText[status]);
		this.el.setAttribute('aria-label', tooltip ?? this.defaultTooltip(status));
		this.el.setAttribute('aria-label-position', 'top');
	}

	private defaultTooltip(status: SyncStatus): string {
		const last = this.plugin.logger?.getLastSyncTime();
		const lastStr = last ? `最后同步: ${last.toLocaleString('zh-CN')}` : '';
		switch (status) {
			case SyncStatus.Idle: return `Sync Confluence: 空闲${lastStr ? ' - ' + lastStr : ''}`;
			case SyncStatus.Syncing: return 'Sync Confluence: 正在同步...';
			case SyncStatus.Success: return `Sync Confluence: 同步完成 - ${new Date().toLocaleTimeString('zh-CN')}`;
			case SyncStatus.Failed: return 'Sync Confluence: 同步失败';
			default: return 'Sync Confluence';
		}
	}

	showSyncing(text?: string): void {
		this.update(SyncStatus.Syncing);
		if (this.el && text) this.el.setText(`☁ ${text}`);
	}

	showSuccess(summary?: string): void {
		this.update(SyncStatus.Success, summary);
		setTimeout(() => {
			if (this.current === SyncStatus.Success) this.update(SyncStatus.Idle);
		}, 4000);
	}

	showFailed(error?: string): void {
		this.update(SyncStatus.Failed, error ? `同步失败: ${error}` : undefined);
	}

	destroy(): void {
		this.el?.remove();
		this.el = null;
	}
}
