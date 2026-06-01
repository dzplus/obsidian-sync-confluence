import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { parsePageIdFromUrl } from '../confluence/urlParser';

export interface CreateBoundNoteResult {
	file: TFile;
}

/** 弹窗:输入笔记路径 + Confluence URL → 创建笔记并写入模板 frontmatter */
export class CreateBoundNoteModal extends Modal {
	private notePath: string;
	private url: string = '';

	constructor(
		app: App,
		private defaultFolder: string,
		private onCreate: (path: string, url: string) => Promise<TFile>,
	) {
		super(app);
		const ts = new Date().toISOString().slice(0, 10);
		this.notePath = (defaultFolder ? defaultFolder + '/' : '') + `confluence-note-${ts}.md`;
	}

	onOpen(): void {
		this.titleEl.setText('创建绑定到 Confluence 的笔记');

		const wrap = this.contentEl.createDiv({ cls: 'sync-confluence-create-form' });

		new Setting(wrap)
			.setName('笔记路径')
			.setDesc('相对 vault 根的路径,自动补 .md')
			.addText((t) => t.setValue(this.notePath).onChange((v) => { this.notePath = v.trim(); }));

		new Setting(wrap)
			.setName('Confluence 页面 URL')
			.setDesc('支持 /pages/{id}/ 与 ?pageId={id} 两种 URL 形式')
			.addText((t) => t
				.setPlaceholder('https://xxx.atlassian.net/wiki/spaces/XXX/pages/12345/Title')
				.onChange((v) => { this.url = v.trim(); }));

		new Setting(wrap)
			.addButton((btn) => btn.setButtonText('取消').onClick(() => this.close()))
			.addButton((btn) => btn.setButtonText('创建').setCta().onClick(async () => {
				if (!this.notePath) { new Notice('请填写笔记路径'); return; }
				if (!this.url) { new Notice('请填写 Confluence URL'); return; }
				if (!parsePageIdFromUrl(this.url)) {
					new Notice('无法从 URL 解析 page ID');
					return;
				}
				try {
					await this.onCreate(this.notePath.endsWith('.md') ? this.notePath : this.notePath + '.md', this.url);
					this.close();
				} catch (e) {
					new Notice('创建失败: ' + (e instanceof Error ? e.message : String(e)));
				}
			}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
