/**
 * Process-wide `obsidian` stub, installed from bunfig.toml `[test] preload`.
 *
 * The `obsidian` package ships types only (`"main": ""`), so every test that
 * reaches a module importing it needs a stub. Several test files register
 * their own with `mock.module('obsidian', …)`, and that is where this gets
 * subtle: Bun freezes the module's export shape the first time `obsidian` is
 * actually instantiated, and whichever mock is registered at that moment
 * wins. Registering a fuller stub afterwards cannot add exports back.
 *
 * A test file that stubs only `requestUrl` can therefore decide the shape for
 * the whole run — `attachmentUploader.test.ts` instantiates `obsidian`
 * through `api.ts` without registering anything itself — and every later file
 * importing something that reaches `mermaidRenderer` dies with
 * "Export named 'Component' not found in module 'obsidian'". Which file gets
 * there first depends on test-file discovery order, which differs between
 * machines: this passed locally and failed in CI.
 *
 * Preloading registers this complete stub and then instantiates `obsidian`,
 * freezing the full shape before any test file runs. Per-file
 * `mock.module('obsidian', …)` calls still swap the values behind those
 * exports, so existing tests keep their intent; they no longer decide which
 * exports exist.
 */
import { mock } from 'bun:test';

/** `src/utils/hash.ts` reads `window.crypto.subtle`; `src/i18n` probes `window.localStorage`. */
(globalThis as { window?: unknown }).window ??= globalThis;

export class TFile {
	constructor(public path = '', public basename = '', public name = '') {}
}

export class TFolder {
	constructor(public path = '', public name = '') {}
}

class Stub {}

/** Tests drive Confluence through fakes; a real HTTP request is a bug. */
function requestUrl(): never {
	throw new Error('requestUrl must not be called from tests');
}

/** Every `obsidian` export that `src/` imports as a value. */
export const obsidianStub = {
	App: Stub,
	Component: Stub,
	Editor: Stub,
	MarkdownRenderer: Stub,
	MarkdownView: Stub,
	Menu: Stub,
	Modal: Stub,
	Notice: Stub,
	Plugin: Stub,
	PluginSettingTab: Stub,
	Setting: Stub,
	TFile,
	TFolder,
	normalizePath: (p: string) => p,
	setIcon: () => undefined,
	requestUrl,
};

mock.module('obsidian', () => obsidianStub);

// Registering alone is not enough — see the note above. Instantiating it here
// is what freezes the complete shape ahead of the first test file.
await import('obsidian');
