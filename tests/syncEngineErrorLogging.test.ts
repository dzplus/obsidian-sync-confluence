import { beforeEach, describe, expect, test } from 'bun:test';
// `obsidian` is stubbed process-wide by bunfig.toml `[test] preload`; see
// tests/setup/obsidian-stub.ts for why it cannot be stubbed from here. TFile
// comes from the same stub so the engine sees one class identity.
import { TFile as StubTFile } from './setup/obsidian-stub';

const { SyncEngine } = await import('../src/sync/syncEngine');
const { ConfluenceApiError } = await import('../src/confluence/api');
const { DEFAULT_SETTINGS } = await import('../src/settings');
import type { ConfluenceApi } from '../src/confluence/api';
import type { Logger } from '../src/utils/logger';
import type { ConfluenceInstance } from '../src/types';

const BASE_URL = 'https://wiki.example.test';
const FAILING_PAGE_ID = '111';
const OK_PAGE_ID = '222';
const RESPONSE_BODY = '<html><body>internal stack trace + session cookie</body></html>';
const SHORT_MESSAGE = `Confluence GET /rest/api/content/${FAILING_PAGE_ID} → 500`;

const instance: ConfluenceInstance = {
	id: 'inst-1',
	name: 'Wiki',
	baseUrl: BASE_URL,
	authType: 'basic',
	username: 'user',
	apiToken: 'token-key',
	stripSupplementaryChars: false,
};

interface LogEntry {
	level: 'info' | 'warn' | 'error';
	message: string;
	details?: string;
}

class FakeLogger {
	entries: LogEntry[] = [];
	info(message: string, details?: string): void { this.entries.push({ level: 'info', message, details }); }
	warn(message: string, details?: string): void { this.entries.push({ level: 'warn', message, details }); }
	error(message: string, details?: string): void { this.entries.push({ level: 'error', message, details }); }
	recordSyncTime(): void { /* no-op */ }
	find(level: LogEntry['level'], fragment: string): LogEntry | undefined {
		return this.entries.find((e) => e.level === level && e.message.includes(fragment));
	}
}

/** Records every getPage call so a test can prove syncTarget actually ran. */
class FakeApi {
	getPageCalls: string[] = [];
	updatePageCalls: string[] = [];

	constructor(private failures: Map<string, unknown>) {}

	async getPage(pageId: string) {
		this.getPageCalls.push(pageId);
		const failure = this.failures.get(pageId);
		if (failure) throw failure;
		return { id: pageId, title: 'Demo', version: 3, type: 'page', spaceKey: 'SP' };
	}

	async updatePage(pageId: string) {
		this.updatePageCalls.push(pageId);
	}
}

function pageUrl(pageId: string): string {
	return `${BASE_URL}/pages/viewpage.action?pageId=${pageId}`;
}

function buildEngine(failures: Map<string, unknown>, pageIds: string[]) {
	const file = new StubTFile('notes/demo.md', 'demo', 'demo.md');
	const frontmatter: Record<string, unknown> = {
		confluence_url: pageIds.map(pageUrl),
		confluence_page_id: [...pageIds],
	};
	const writtenFrontmatter: Record<string, unknown>[] = [];
	const app = {
		vault: {
			cachedRead: async () => '# Demo\n\nPlain body with no attachments.\n',
		},
		metadataCache: {
			getFileCache: () => ({ frontmatter }),
			getFirstLinkpathDest: () => null,
		},
		fileManager: {
			processFrontMatter: async (_f: unknown, cb: (fm: Record<string, unknown>) => void) => {
				const fm: Record<string, unknown> = { ...frontmatter };
				cb(fm);
				writtenFrontmatter.push(fm);
			},
		},
	};
	const logger = new FakeLogger();
	const api = new FakeApi(failures);
	const engine = new SyncEngine({
		app: app as never,
		settings: {
			...DEFAULT_SETTINGS,
			instances: [instance],
			uploadAttachments: false,
			renderMermaidToPng: false,
			renderPlantUmlToPng: false,
		},
		logger: logger as unknown as Logger,
		api: api as unknown as ConfluenceApi,
		instance,
		instances: [instance],
	});
	return { engine, file: file as never, logger, api, writtenFrontmatter };
}

function apiError(pageId: string): InstanceType<typeof ConfluenceApiError> {
	return new ConfluenceApiError(
		500,
		'unknown',
		`Confluence GET /rest/api/content/${pageId} → 500`,
		RESPONSE_BODY,
	);
}

describe('per-target API failures: syncTarget → Promise.allSettled → logger', () => {
	let harness: ReturnType<typeof buildEngine>;

	beforeEach(() => {
		harness = buildEngine(
			new Map<string, unknown>([[FAILING_PAGE_ID, apiError(FAILING_PAGE_ID)]]),
			[FAILING_PAGE_ID, OK_PAGE_ID],
		);
	});

	test('the failing target really goes through syncTarget', async () => {
		await harness.engine.syncOne(harness.file);
		// Without this the rest of the suite could pass vacuously on a
		// misrouted target that never reached the API at all.
		expect(harness.api.getPageCalls).toContain(FAILING_PAGE_ID);
		expect(harness.api.updatePageCalls).toEqual([OK_PAGE_ID]);
	});

	test('the response body reaches the partial-failure log', async () => {
		await harness.engine.syncOne(harness.file);

		const warn = harness.logger.find('warn', '部分目标同步失败');
		expect(warn).toBeDefined();
		expect(warn?.details).toContain(RESPONSE_BODY);
		expect(warn?.details).toContain(SHORT_MESSAGE);
		// The whole-file catch (which already formatted details) must not be
		// the one that fired — this is the per-target path.
		expect(harness.logger.entries.some((e) => e.level === 'error')).toBe(false);
	});

	test('FileSyncResult and perTarget keep only the short message', async () => {
		const result = await harness.engine.syncOne(harness.file);

		expect(result?.success).toBe(false);
		expect(result?.error).toContain(SHORT_MESSAGE);
		expect(result?.error).not.toContain(RESPONSE_BODY);
		expect(result?.error).not.toContain('session cookie');

		const failed = result?.perTarget?.[0];
		expect(failed?.success).toBe(false);
		expect(failed?.error).toBe(SHORT_MESSAGE);
		expect(failed?.error).not.toContain(RESPONSE_BODY);

		expect(result?.perTarget?.[1]?.success).toBe(true);
	});
});

describe('per-target API failures: every target fails', () => {
	test('each response body is logged once, none leak into the result', async () => {
		const { engine, file, logger, api } = buildEngine(
			new Map<string, unknown>([
				[FAILING_PAGE_ID, apiError(FAILING_PAGE_ID)],
				[OK_PAGE_ID, apiError(OK_PAGE_ID)],
			]),
			[FAILING_PAGE_ID, OK_PAGE_ID],
		);

		const result = await engine.syncOne(file);

		expect(api.getPageCalls.sort()).toEqual([FAILING_PAGE_ID, OK_PAGE_ID]);
		const warn = logger.find('warn', '部分目标同步失败');
		expect(warn?.details).toContain(`content/${FAILING_PAGE_ID} → 500`);
		expect(warn?.details).toContain(`content/${OK_PAGE_ID} → 500`);
		expect(warn?.details?.split(RESPONSE_BODY).length - 1).toBe(2);
		// Each record is message + body, so the two must stay blank-line
		// separated instead of running together into one four-line blob.
		expect(warn?.details).toContain(
			`${RESPONSE_BODY}\n\nConfluence GET /rest/api/content/${OK_PAGE_ID} → 500`,
		);
		expect(result?.error).not.toContain(RESPONSE_BODY);
	});
});

describe('single-target note whose only target fails', () => {
	test('still logs the body and returns only the short message', async () => {
		// The common real-world shape: one confluence_url, no successful
		// sibling target. successful.length === 0 skips the whole writeback
		// block, but the partial-failure warn is still the path taken.
		const { engine, file, logger, api } = buildEngine(
			new Map<string, unknown>([[FAILING_PAGE_ID, apiError(FAILING_PAGE_ID)]]),
			[FAILING_PAGE_ID],
		);

		const result = await engine.syncOne(file);

		expect(api.getPageCalls).toEqual([FAILING_PAGE_ID]);
		const warn = logger.find('warn', '部分目标同步失败');
		expect(warn?.details).toContain(RESPONSE_BODY);
		expect(logger.entries.some((e) => e.level === 'error')).toBe(false);
		expect(result?.error).toBe(SHORT_MESSAGE);
		expect(result?.perTarget?.[0]?.error).not.toContain(RESPONSE_BODY);
	});
});

describe('per-target failures without a Confluence response body', () => {
	test('a plain Error still logs its message', async () => {
		const { engine, file, logger } = buildEngine(
			new Map<string, unknown>([[FAILING_PAGE_ID, new Error('socket hang up')]]),
			[FAILING_PAGE_ID, OK_PAGE_ID],
		);

		const result = await engine.syncOne(file);

		const warn = logger.find('warn', '部分目标同步失败');
		expect(warn?.details).toContain('socket hang up');
		expect(result?.error).toContain('socket hang up');
	});
});
