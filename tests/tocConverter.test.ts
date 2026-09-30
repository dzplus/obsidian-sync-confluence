import { describe, expect, mock, test } from 'bun:test';

mock.module('obsidian', () => ({
	requestUrl: () => {
		throw new Error('requestUrl must not be called by converter tests');
	},
}));

const { MarkdownConverter } = await import('../src/confluence/markdownConverter');

const context = {
	attachedFilenames: new Set<string>(),
	mermaidFilenameByHash: new Map<string, string>(),
	plantUmlFilenameByHash: new Map<string, string>(),
	renderMermaidToPng: false,
	renderPlantUmlToPng: false,
	defaultImageWidthPx: 0,
	stripSupplementaryChars: false,
};

const converter = new MarkdownConverter({} as never);

function englishTocMarkdown(calloutTitle: string): string {
	return [
		'# Doc',
		'',
		`> [!summary]+ ${calloutTitle}`,
		'> - [[#Section]]',
		'>     - [[#Subsection]]',
		'> - [Other](#Other)',
		'',
		'## Section',
		'',
		'### Subsection',
		'',
		'## Other',
	].join('\n');
}

async function expectOfficialTocMacro(markdown: string, notePath: string): Promise<void> {
	const storage = await converter.convert(markdown, notePath, context);

	expect(storage).toContain('<ac:structured-macro ac:name="toc">');
	expect(storage).toContain('<ac:parameter ac:name="minLevel">2</ac:parameter>');
	expect(storage).toContain('<ac:parameter ac:name="maxLevel">3</ac:parameter>');
	expect(storage).not.toContain('ac:name="info"');
	expect(storage.match(/ac:name="toc"/g)).toHaveLength(1);
}

describe('Confluence TOC conversion', () => {
	test('replaces a Chinese summary TOC callout with the official H2-H3 macro', async () => {
		const markdown = [
			'# 文档标题',
			'',
			'> [!summary]+ 目录',
			'> - [[#第一章]]',
			'>     - [[#第一节]]',
			'> - [第二章](#第二章)',
			'',
			'## 第一章',
			'',
			'### 第一节',
			'',
			'## 第二章',
		].join('\n');

		const storage = await converter.convert(markdown, 'notes/toc.md', context);

		expect(storage).toContain('<ac:structured-macro ac:name="toc">');
		expect(storage).toContain('<ac:parameter ac:name="minLevel">2</ac:parameter>');
		expect(storage).toContain('<ac:parameter ac:name="maxLevel">3</ac:parameter>');
		expect(storage).not.toContain('ac:name="info"');
		expect(storage).not.toContain('第一章]]');
		expect(storage).not.toContain('ac:anchor="第一章"');
		expect(storage.match(/ac:name="toc"/g)).toHaveLength(1);
	});

	test('replaces a Contents summary TOC callout with the official H2-H3 macro', async () => {
		await expectOfficialTocMacro(englishTocMarkdown('Contents'), 'notes/toc-contents.md');
	});

	test('replaces a Table of Contents summary TOC callout with the official H2-H3 macro', async () => {
		await expectOfficialTocMacro(
			englishTocMarkdown('Table of Contents'),
			'notes/toc-table-of-contents.md',
		);
	});

	test('replaces a TOC summary callout with the official H2-H3 macro', async () => {
		await expectOfficialTocMacro(englishTocMarkdown('TOC'), 'notes/toc-short.md');
	});

	test('matches English TOC callout titles case-insensitively', async () => {
		await expectOfficialTocMacro(englishTocMarkdown('contents'), 'notes/toc-lowercase.md');
	});

	test('keeps non-TOC summary callouts unchanged', async () => {
		const markdown = [
			'> [!summary]+ 目录',
			'> 这里只是摘要，没有标题链接。',
			'',
			'> [!summary] 本章摘要',
			'> - [[#第一章]]',
			'',
			'## 第一章',
		].join('\n');

		const storage = await converter.convert(markdown, 'notes/summary.md', context);

		expect(storage).not.toContain('ac:name="toc"');
		expect(storage.match(/ac:name="info"/g)).toHaveLength(2);
		expect(storage).toContain('这里只是摘要，没有标题链接。');
		expect(storage).toContain('本章摘要');
	});

	test('keeps English non-whitelist summary callouts unchanged', async () => {
		const markdown = [
			'> [!summary]+ Summary',
			'> - [[#Section]]',
			'',
			'## Section',
		].join('\n');

		const storage = await converter.convert(markdown, 'notes/summary-en.md', context);

		expect(storage).not.toContain('ac:name="toc"');
		expect(storage).toContain('ac:name="info"');
		expect(storage).toContain('Summary');
	});

	test('does not convert TOC syntax shown inside a fenced code block', async () => {
		const markdown = [
			'```markdown',
			'> [!summary]+ 目录',
			'> - [[#第一章]]',
			'```',
			'',
			'## 第一章',
		].join('\n');

		const storage = await converter.convert(markdown, 'notes/example.md', context);

		expect(storage).not.toContain('ac:name="toc"');
		expect(storage).toContain('<ac:parameter ac:name="language">markdown</ac:parameter>');
		expect(storage).toContain('<![CDATA[> [!summary]+ 目录');
	});
});
