import { describe, expect, test } from 'bun:test';
import { migrateLegacyFrontmatter } from '../src/migration';
import type { SyncConfluenceSettings } from '../src/settings';

const settings: SyncConfluenceSettings = {
	instances: [
		{
			id: 'a',
			name: 'A',
			baseUrl: 'https://a.example/wiki',
			authType: 'basic',
			username: 'a',
			apiToken: 'a-token',
			stripSupplementaryChars: false,
		},
		{
			id: 'b',
			name: 'B',
			baseUrl: 'https://b.example/wiki',
			authType: 'basic',
			username: 'b',
			apiToken: 'b-token',
			stripSupplementaryChars: false,
		},
	],
	syncInterval: 0,
	syncOnStartup: false,
	scanFolders: [],
	ignorePatterns: [],
	templateFolderPath: 'templates',
	autoInstallTemplate: false,
	showStatusBar: false,
	showNotice: false,
	frontmatterKey: 'cf_url',
	checkRemoteConflicts: false,
	uploadAttachments: true,
	maxAttachmentSizeMB: 10,
	defaultImageWidthPx: 192,
	renderMermaidToPng: false,
	mermaidRenderer: 'kroki',
	mermaidRenderUrl: 'https://kroki.io/mermaid/png',
	renderPlantUmlToPng: false,
	plantUmlServerUrl: 'https://www.plantuml.com/plantuml',
};

describe('legacy frontmatter migration', () => {
	test('preserves 0.3.8 page buckets and maps each target to its own instance', async () => {
		const file = { path: 'note.md' };
		const liveFrontmatter: Record<string, unknown> = {
			cf_url: [
				'https://a.example/wiki/pages/123/A',
				'https://b.example/wiki/pages/456/B',
			],
			confluence_page_id: '123，456',
			confluence_last_hash: 'legacy-hash',
			confluence_attachments: {
				'123': { 'a.png': { hash: 'a-hash', id: 'a-id' } },
				'456': { 'b.png': { hash: 'b-hash', id: 'b-id' } },
			},
		};
		const markdown = [
			'---',
			'cf_url:',
			'  - https://a.example/wiki/pages/123/A',
			'  - https://b.example/wiki/pages/456/B',
			'confluence_page_id: "123，456"',
			'confluence_last_hash: legacy-hash',
			'confluence_attachments:',
			'  "123":',
			'    a.png: { hash: a-hash, id: a-id }',
			'  "456":',
			'    b.png: { hash: b-hash, id: b-id }',
			'---',
			'body',
		].join('\n');
		const app = {
			vault: {
				configDir: '.obsidian',
				getMarkdownFiles: () => [file],
				cachedRead: async () => markdown,
			},
			fileManager: {
				processFrontMatter: async (_file: unknown, update: (fm: Record<string, unknown>) => void) => {
					update(liveFrontmatter);
				},
			},
		};
		const logger = { info: () => undefined, warn: () => undefined };

		const migrated = await migrateLegacyFrontmatter(
			app as never,
			settings,
			logger,
		);

		expect(migrated).toBe(1);
		expect(liveFrontmatter.confluence_last_hash).toEqual({
			a: { '123': 'legacy-hash' },
			b: { '456': 'legacy-hash' },
		});
		expect(liveFrontmatter.confluence_attachments).toEqual({
			a: { '123': { 'a.png': { hash: 'a-hash', id: 'a-id' } } },
			b: { '456': { 'b.png': { hash: 'b-hash', id: 'b-id' } } },
		});
	});
});
