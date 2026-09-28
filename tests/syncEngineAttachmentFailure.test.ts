import { describe, expect, mock, test } from 'bun:test';

mock.module('obsidian', () => ({
	requestUrl: () => {
		throw new Error('requestUrl must not be called by sync engine tests');
	},
	App: class App {},
	Component: class Component {},
	MarkdownRenderer: {},
	TFile: class TFile {},
	PluginSettingTab: class PluginSettingTab {},
	Setting: class Setting {},
	Notice: class Notice {},
}));

(globalThis as { window?: unknown }).window ??= globalThis;

const { SyncEngine } = await import('../src/sync/syncEngine');

describe('SyncEngine attachment failures', () => {
	test('persists a newly created page without marking sync successful when attachment upload fails', async () => {
		const svgFile = { name: 'diagram.svg', stat: { size: 12 } };
		const file = { path: 'notes/test.md', basename: 'test', extension: 'md' };
		const frontmatter = {
			confluence_parent_url: 'https://cf.test/pages/viewpage.action?pageId=10',
			confluence_url: '',
			confluence_page_id: '',
		};
		let pageUpdated = false;
		let frontmatterWritten = false;
		let pageCreateCount = 0;
		const app = {
			metadataCache: {
				getFileCache: () => ({ frontmatter }),
				getFirstLinkpathDest: (linkpath: string) => linkpath === './_attachments/diagram.svg' ? svgFile : null,
			},
			vault: {
				cachedRead: async () => '![diagram](<./_attachments/diagram.svg>)',
				getFiles: () => [svgFile],
				readBinary: async () => new TextEncoder().encode('<svg />').buffer,
			},
			fileManager: {
				processFrontMatter: async (_file: unknown, callback: (raw: unknown) => void) => {
					frontmatterWritten = true;
					callback(frontmatter);
				},
			},
		};
		const api = {
			findAttachmentByFilename: async () => null,
			createAttachment: async () => { throw new Error('Confluence rejected SVG'); },
			getPage: async () => ({ id: '10', title: 'parent', version: 1, type: 'page', spaceKey: 'DOC' }),
			createPage: async () => {
				pageCreateCount += 1;
				return { id: '123', title: 'test', webUrl: 'https://cf.test/pages/viewpage.action?pageId=123' };
			},
			updatePage: async () => { pageUpdated = true; },
		};
		const logger = {
			info: () => {},
			warn: () => {},
			error: () => {},
			recordSyncTime: () => {},
		};
		const instance = {
			id: 'default',
			name: 'Default',
			baseUrl: 'https://cf.test',
			authType: 'bearer',
			username: '',
			apiToken: 'token',
			stripSupplementaryChars: false,
		};
		const settings = {
			frontmatterKey: 'confluence_url',
			instances: [instance],
			uploadAttachments: true,
			maxAttachmentSizeMB: 10,
			defaultImageWidthPx: 192,
			renderMermaidToPng: false,
			renderPlantUmlToPng: false,
		};
		const engine = new SyncEngine({
			app: app as never,
			settings: settings as never,
			logger: logger as never,
			api: api as never,
			instance: instance as never,
			instances: [instance] as never,
		});

		const firstResult = await engine.syncOne(file as never);
		const secondResult = await engine.syncOne(file as never);

		expect(firstResult?.success).toBe(false);
		expect(firstResult?.error).toContain('diagram.svg');
		expect(secondResult?.success).toBe(false);
		expect(secondResult?.error).toContain('diagram.svg');
		expect(pageCreateCount).toBe(1);
		expect(pageUpdated).toBe(false);
		expect(frontmatterWritten).toBe(true);
		expect(frontmatter.confluence_page_id).toBe('123');
		expect(frontmatter.confluence_last_hash).toBeUndefined();
	});
});
