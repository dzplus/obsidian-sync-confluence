import { describe, expect, mock, test } from 'bun:test';

mock.module('obsidian', () => ({
	requestUrl: () => {
		throw new Error('requestUrl must not be called by converter tests');
	},
}));

// sha1Hex 走 window.crypto.subtle(Electron 渲染进程),bun 里没有 window,指回 globalThis 即可
(globalThis as { window?: unknown }).window ??= globalThis;

const { MarkdownConverter } = await import('../src/confluence/markdownConverter');

const converter = new MarkdownConverter({} as never);

const svgFilename = 'IDP DevPortal - My Team-page-wireframe.svg';
const svgFile = { name: svgFilename, stat: { size: 42 } };
const diagramFile = { name: 'diagram.svg', stat: { size: 24 } };
const imageConverter = new MarkdownConverter({
	metadataCache: {
		getFirstLinkpathDest: (linkpath: string) => {
			if (linkpath === `./_attachments/${svgFilename}`) return svgFile;
			if (linkpath === 'diagram.svg') return diagramFile;
			return null;
		},
	},
	vault: {
		getFiles: () => [svgFile, diagramFile],
	},
} as never);

/** extractReferences 的 hash → convert 的 fence 查表,走一遍上层的完整链路 */
async function convertWithDiagrams(markdown: string): Promise<string> {
	const refs = await converter.extractReferences(markdown, 'notes/d.md', { mermaidExt: 'svg' });
	const mermaidFilenameByHash = new Map(refs.mermaid.map((b) => [b.hash, b.filename]));
	return converter.convert(markdown, 'notes/d.md', {
		attachedFilenames: new Set(refs.mermaid.map((b) => b.filename)),
		mermaidFilenameByHash,
		plantUmlFilenameByHash: new Map<string, string>(),
		renderMermaidToPng: true,
		renderPlantUmlToPng: false,
		defaultImageWidthPx: 0,
		stripSupplementaryChars: false,
	});
}

describe('mermaid fence → ac:image', () => {
	test('闭合 fence 前带空行的块也能命中 hash(不会退回代码块)', async () => {
		const markdown = [
			'```mermaid',
			'flowchart TD',
			'A-->B',
			'',
			'```',
			'',
			'```mermaid',
			'flowchart TD',
			'C-->D',
			'```',
		].join('\n');

		const storage = await convertWithDiagrams(markdown);

		expect(storage.match(/<ac:image/g)).toHaveLength(2);
		expect(storage).not.toContain('ac:name="code"');
	});
});

describe('markdown image attachment references', () => {
	test('resolves angle-bracket destinations with spaces and renders an attachment image', async () => {
		const markdown = `![Services tab](<./_attachments/${svgFilename}>)`;
		const refs = await imageConverter.extractReferences(markdown, 'IDP DevPortal - My Team.md');

		expect(refs.attachments).toHaveLength(1);
		expect(refs.attachments[0]?.linkpath).toBe(`./_attachments/${svgFilename}`);
		expect(refs.attachments[0]?.filename).toBe(svgFilename);
		expect(refs.attachments[0]?.tfile).toBe(svgFile);

		const storage = await imageConverter.convert(markdown, 'IDP DevPortal - My Team.md', {
			attachedFilenames: new Set(refs.attachments.map((ref) => ref.filename)),
			mermaidFilenameByHash: new Map(),
			plantUmlFilenameByHash: new Map(),
			renderMermaidToPng: false,
			renderPlantUmlToPng: false,
			defaultImageWidthPx: 192,
			stripSupplementaryChars: false,
		});

		expect(storage).toContain(`<ri:attachment ri:filename="${svgFilename}" />`);
		expect(storage).not.toContain('<!--');
	});

	test('keeps standard local images and Obsidian embeds working', async () => {
		const markdown = [
			'![diagram](diagram.svg)',
			'',
			`![[./_attachments/${svgFilename}]]`,
		].join('\n');
		const refs = await imageConverter.extractReferences(markdown, 'notes/test.md');

		expect(refs.attachments).toHaveLength(2);
		expect(refs.attachments.map((ref) => ref.filename)).toEqual(['diagram.svg', svgFilename]);
		expect(refs.attachments.every((ref) => ref.tfile)).toBe(true);
	});

	test('does not collect external images or images shown inside code blocks', async () => {
		const markdown = [
			'![remote](https://example.test/diagram.svg)',
			'',
			'```markdown',
			'![code](diagram.svg)',
			'```',
		].join('\n');

		const refs = await imageConverter.extractReferences(markdown, 'notes/test.md');

		expect(refs.attachments).toHaveLength(0);
	});
});
