import { describe, expect, test } from 'bun:test';

// sha1Hex uses window.crypto in the Electron renderer; Bun exposes the same
// Web Crypto implementation on globalThis.
(globalThis as { window?: unknown }).window ??= globalThis;

const { AttachmentUploader, shouldSkipBeforeRead } = await import('../src/confluence/attachmentUploader');

const TEN_MB = 10 * 1024 * 1024;

describe('shouldSkipBeforeRead', () => {
	test('skips when stat.size is above the limit', () => {
		expect(shouldSkipBeforeRead(TEN_MB + 1, TEN_MB)).toBe(true);
	});

	test('does not skip when stat.size is at or under the limit', () => {
		expect(shouldSkipBeforeRead(TEN_MB, TEN_MB)).toBe(false);
		expect(shouldSkipBeforeRead(1, TEN_MB)).toBe(false);
	});

	test('does not skip when stat is missing so the post-read check can run', () => {
		expect(shouldSkipBeforeRead(undefined, TEN_MB)).toBe(false);
		expect(shouldSkipBeforeRead(Number.NaN, TEN_MB)).toBe(false);
	});
});

describe('AttachmentUploader', () => {
	test('uploads SVG attachments with the image/svg+xml MIME type', async () => {
		const calls: unknown[][] = [];
		const file = { name: 'diagram.svg', stat: { size: 12 } };
		const app = {
			vault: {
				readBinary: async () => new TextEncoder().encode('<svg />').buffer,
			},
		};
		const api = {
			findAttachmentByFilename: async () => null,
			createAttachment: async (...args: unknown[]) => {
				calls.push(args);
				return { id: 'attachment-1' };
			},
		};
		const logger = { warn: () => {}, error: () => {}, info: () => {} };
		const uploader = new AttachmentUploader(app as never, api as never, logger as never, { maxSizeBytes: TEN_MB });

		const result = await uploader.syncAttachments('123', [{
			rawMatch: '![diagram](diagram.svg)',
			linkpath: 'diagram.svg',
			alt: 'diagram',
			tfile: file as never,
			filename: 'diagram.svg',
		}], {});

		expect(result.uploaded).toBe(1);
		expect(result.unavailable).toEqual([]);
		expect(calls[0]?.[1]).toBe('diagram.svg');
		expect(calls[0]?.[3]).toBe('image/svg+xml');
	});

	test('marks unresolved and oversized referenced files as unavailable', async () => {
		const app = { vault: { readBinary: async () => new ArrayBuffer(0) } };
		const api = {
			findAttachmentByFilename: async () => null,
			createAttachment: async () => ({ id: 'attachment-1' }),
		};
		const logger = { warn: () => {}, error: () => {}, info: () => {} };
		const uploader = new AttachmentUploader(app as never, api as never, logger as never, { maxSizeBytes: 10 });

		const result = await uploader.syncAttachments('123', [
			{
				rawMatch: '![missing](missing.svg)',
				linkpath: 'missing.svg',
				alt: 'missing',
				tfile: null,
				filename: 'missing.svg',
			},
			{
				rawMatch: '![large](large.svg)',
				linkpath: 'large.svg',
				alt: 'large',
				tfile: { name: 'large.svg', stat: { size: 11 } } as never,
				filename: 'large.svg',
			},
		], {});

		expect(result.failed).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.unavailable).toEqual(['missing.svg', 'large.svg']);
	});
});
