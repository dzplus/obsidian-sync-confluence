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
