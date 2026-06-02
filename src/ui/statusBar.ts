import { SyncStatus, SyncStatusText } from '../types';
import type SyncConfluencePlugin from '../main';
import { getLocale, t } from '../i18n';

export class StatusBarManager {
	private plugin: SyncConfluencePlugin;
	private el: HTMLElement | null = null;
	private current: SyncStatus = SyncStatus.Idle;
	private resetTimeoutToken: number | null = null;

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
		const localeTag = getLocale() === 'zh' ? 'zh-CN' : 'en-US';
		const lastSuffix = last ? t('status.tooltipLastSync', { time: last.toLocaleString(localeTag) }) : '';
		switch (status) {
			case SyncStatus.Idle: return t('status.tooltipIdle', { lastSuffix });
			case SyncStatus.Syncing: return t('status.tooltipSyncing');
			case SyncStatus.Success: return t('status.tooltipSuccess', { time: new Date().toLocaleTimeString(localeTag) });
			case SyncStatus.Failed: return t('status.tooltipFailed');
			default: return 'Sync Confluence';
		}
	}

	showSyncing(text?: string): void {
		this.update(SyncStatus.Syncing);
		if (this.el && text) this.el.setText(t('status.syncingLabelPrefix', { text }));
	}

	showSuccess(summary?: string): void {
		this.update(SyncStatus.Success, summary);
		if (this.resetTimeoutToken !== null) window.clearTimeout(this.resetTimeoutToken);
		this.resetTimeoutToken = window.setTimeout(() => {
			this.resetTimeoutToken = null;
			if (this.current === SyncStatus.Success) this.update(SyncStatus.Idle);
		}, 4000);
	}

	showFailed(error?: string): void {
		this.update(SyncStatus.Failed, error ? t('status.tooltipFailedWithError', { error }) : undefined);
	}

	destroy(): void {
		if (this.resetTimeoutToken !== null) {
			window.clearTimeout(this.resetTimeoutToken);
			this.resetTimeoutToken = null;
		}
		this.el?.remove();
		this.el = null;
	}
}
