import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { parsePageIdFromUrl } from '../confluence/urlParser';
import { urlMatchesBaseUrl } from '../confluence/urlMatch';
import { t } from '../i18n';
import type { ConfluenceInstance } from '../types';

export interface CreateBoundNoteResult {
	file: TFile;
}

/** 弹窗:输入笔记路径 + Confluence URL → 创建笔记并写入模板 frontmatter */
export class CreateBoundNoteModal extends Modal {
	private notePath: string;
	private url: string = '';
	private selectedInstanceId: string = '';

	constructor(
		app: App,
		defaultFolder: string,
		private instances: ConfluenceInstance[],
		private onCreate: (path: string, url: string) => Promise<TFile>,
	) {
		super(app);
		const ts = new Date().toISOString().slice(0, 10);
		this.notePath = (defaultFolder ? defaultFolder + '/' : '') + `confluence-note-${ts}.md`;
		this.selectedInstanceId = instances[0]?.id ?? '';
	}

	onOpen(): void {
		this.titleEl.setText(t('modal.createBoundNote.title'));

		const wrap = this.contentEl.createDiv({ cls: 'sync-confluence-create-form' });

		new Setting(wrap)
			.setName(t('modal.createBoundNote.notePathName'))
			.setDesc(t('modal.createBoundNote.notePathDesc'))
			.addText((tx) => tx.setValue(this.notePath).onChange((v) => { this.notePath = v.trim(); }));

		if (this.instances.length > 1) {
			new Setting(wrap)
				.setName(t('settings.instanceSelect.label'))
				.setDesc(t('settings.instanceSelect.desc'))
				.addDropdown((d) => {
					for (const inst of this.instances) {
						d.addOption(inst.id, inst.name);
					}
					d.setValue(this.selectedInstanceId);
					d.onChange((v) => { this.selectedInstanceId = v; });
				});
		}

		new Setting(wrap)
			.setName(t('modal.createBoundNote.urlName'))
			.setDesc(t('modal.createBoundNote.urlDesc'))
			.addText((tx) => tx
				.setPlaceholder('https://xxx.atlassian.net/wiki/spaces/XXX/pages/12345/Title')
				.onChange((v) => { this.url = v.trim(); }));

		new Setting(wrap)
			.addButton((btn) => btn.setButtonText(t('modal.createBoundNote.cancel')).onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText(t('modal.createBoundNote.create')).setCta().onClick(async () => {
				if (!this.notePath) { new Notice(t('notice.pathRequired')); return; }
				if (!this.url) { new Notice(t('notice.urlRequired')); return; }
				if (!parsePageIdFromUrl(this.url)) {
					new Notice(t('notice.urlCannotParsePageId'));
					return;
				}
				try {
					const inst = this.instances.find((i) => i.id === this.selectedInstanceId);
					if (inst && inst.baseUrl && !urlMatchesBaseUrl(this.url, inst.baseUrl)) {
						new Notice(t('notice.urlDoesNotMatchInstance', { url: this.url, instance: inst.name }));
						return;
					}
					await this.onCreate(this.notePath.endsWith('.md') ? this.notePath : this.notePath + '.md', this.url);
					this.close();
				} catch (e) {
					new Notice(t('notice.createFailed', { error: e instanceof Error ? e.message : String(e) }));
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}