import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private titleText: string,
		private message: string,
		private confirmText: string,
		private resolve: (confirmed: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		const msgEl = this.contentEl.createDiv({ cls: 'sync-confluence-confirm-message' });
		msgEl.createEl('pre', { text: this.message });
		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('取消').onClick(() => {
				this.resolve(false);
				this.close();
			}))
			.addButton((btn) => btn.setButtonText(this.confirmText).setCta().onClick(() => {
				this.resolve(true);
				this.close();
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function showConfirm(app: App, title: string, message: string, confirmText = '确定'): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, title, message, confirmText, resolve).open();
	});
}
