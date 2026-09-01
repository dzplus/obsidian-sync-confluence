/**
 * One-shot migration of legacy settings and frontmatter into the
 * multi-instance shape. Both migrations are gated by a marker stored in
 * `data.json` alongside the settings (see `LEGACY_MIGRATION_VERSION` and
 * `loadSettings` in `main.ts`).
 *
 * Each migration is idempotent for already-migrated data, so re-running on
 * a vault that's past the current version is a no-op. Bumping
 * `LEGACY_MIGRATION_VERSION` forces both migrations to run once.
 */

import type { App, TFile } from 'obsidian';
import * as yaml from 'js-yaml';
import type { SyncConfluenceSettings } from './settings';
import type { AttachmentRecord, PerInstanceUsernameMap, SyncTarget } from './types';
import { InstanceResolver } from './sync/instanceResolver';
import { readTargetsFromFrontmatter, isUnsafeObjectKey } from './frontmatter/handler';

/**
 * Bump whenever the plugin's config or frontmatter shape changes in a way
 * that requires one-shot migration of legacy data. Each bump forces
 * `migrateLegacySettings` and `migrateLegacyFrontmatter` to run once on
 * plugin load (each is idempotent for already-migrated data, full
 * rewrite for users with legacy data).
 *
 * Versions encoded:
 *   - '0.4.0' — initial migration from pre-multi-instance legacy:
 *     - settings: `confluenceBaseUrl` / `authType` / `username` /
 *       `apiToken` flat fields → `instances[0]` (id='default').
 *     - frontmatter: `lastHash: "H"` string plus both historical
 *       attachment shapes (`filename → record` and 0.3.8's
 *       `pageId → filename → record`) → per-instance nested form.
 *   Bump again for any future shape change that needs a sweep.
 */
export const LEGACY_MIGRATION_VERSION = '0.4.0';

/**
 * Minimal logging interface used by the migration functions. Matches the
 * shape of `Logger` from `./utils/logger`; accepting an interface instead
 * of a concrete class avoids a circular-import surface between plugin
 * orchestrator and the migration module.
 */
export interface MigrationLogger {
	info(message: string, details?: string): void;
	warn(message: string, details?: string): void;
}

/**
 * Disk-read frontmatter snapshot for migration. Built by the js-yaml-backed
 * reader below, which parses the frontmatter block with the same library
 * Obsidian uses internally and then walks the parsed object to detect
 * legacy (scalar / flat-mapping) vs. already-migrated (nested-mapping)
 * shapes. Anything outside our schema is ignored.
 *
 * Why disk-read instead of `metadataCache`: on large vaults (1000+ files)
 * Obsidian's metadataCache hasn't populated entries for files the user
 * hasn't touched, so cache-based reads return `undefined` and the migration
 * silently no-ops on every note. Disk reads work regardless of cache state.
 */
interface LegacyFrontmatterSnapshot {
	/** Configured URL key (or `confluence_url`) or `confluence_parent_url` has non-empty content. */
	hasBinding: boolean;
	/** `confluence_page_id` parsed from scalar / CSV / array form. */
	pageIds: string[];
	/** Legacy string form of `confluence_last_hash`; null if already nested. */
	legacyLastHash: string | null;
	/** Legacy flat form of `confluence_attachments`; null if already nested or absent. */
	legacyAttachments: Record<string, { hash: string; id: string }> | null;
	/** Legacy string form of `confluence_username`; null if already nested. */
	legacyUsername: string | null;
}

/**
 * Parse the YAML frontmatter block with `js-yaml` and project it onto the
 * narrow shape the migrations care about. Returns `null` if the file has no
 * frontmatter block; corrupt YAML degrades to `null` (the migration's
 * per-field null checks naturally skip such files).
 */
function readFrontmatterSnapshot(raw: string, urlKey: string): LegacyFrontmatterSnapshot | null {
	const fm = parseFrontmatter(raw);
	if (!fm) return null;

	const snap: LegacyFrontmatterSnapshot = {
		hasBinding: hasNonEmptyValue(fm[urlKey]) || hasNonEmptyValue(fm['confluence_parent_url']),
		pageIds: collectPageIds(fm['confluence_page_id']),
		legacyLastHash: typeof fm['confluence_last_hash'] === 'string' && (fm['confluence_last_hash'] as string).trim().length > 0
			? (fm['confluence_last_hash'] as string).trim()
			: null,
		legacyAttachments: extractLegacyFlatAttachments(fm['confluence_attachments']),
		legacyUsername: typeof fm['confluence_username'] === 'string' && (fm['confluence_username'] as string).trim().length > 0
			? (fm['confluence_username'] as string).trim()
			: null,
	};
	return snap;
}

/**
 * Parse the YAML frontmatter block with `js-yaml` and return the raw object
 * (or `null` if missing/corrupt). Used by the migration loop to extract URLs
 * for instance routing without going through the narrow snapshot projection.
 */
function parseFrontmatter(raw: string): Record<string, unknown> | null {
	// Strip a UTF-8 BOM if present — Obsidian's metadataCache hides it but
	// `vault.cachedRead` may pass it through. Without this, files saved
	// by editors that prepend a BOM silently miss the regex match.
	const normalized = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
	const fmMatch = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!fmMatch) return null;
	const block = fmMatch[1]!;
	let parsed: unknown;
	try {
		parsed = yaml.load(block, { schema: yaml.JSON_SCHEMA });
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	return parsed as Record<string, unknown>;
}

/** True when the value is a non-empty string or an array containing any non-empty string. */
function hasNonEmptyValue(v: unknown): boolean {
	if (typeof v === 'string') return v.trim().length > 0;
	if (Array.isArray(v)) return v.some((x) => typeof x === 'string' && x.trim().length > 0);
	return false;
}

/** Collect pageId strings from a scalar (CSV / single value) or array form. */
function collectPageIds(v: unknown): string[] {
	if (typeof v === 'string') {
		// Split on ASCII and full-width comma (matches the rest of the
		// codebase — see `splitCsv` in frontmatter/handler.ts).
		return v.split(/[，,]/).map((s) => s.trim()).filter(Boolean);
	}
	if (Array.isArray(v)) {
		return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
	}
	return [];
}

/**
 * Detect pre-multi-instance flat attachment map shape
 * `{ filename: { hash, id } }`. Returns the flat map if it's a real legacy
 * shape; returns `null` for already-migrated nested shape, empty objects,
 * or non-object values.
 */
function extractLegacyFlatAttachments(v: unknown): Record<string, { hash: string; id: string }> | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const entries = Object.entries(v as Record<string, unknown>);
	if (entries.length === 0) return null;
	const flat: Record<string, { hash: string; id: string }> = {};
	let ok = false;
	for (const [key, entry] of entries) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return null;
		flat[key] = { hash: e.hash, id: e.id };
		ok = true;
	}
	return ok ? flat : null;
}

/** Normalize a folder path the same way `scanBoundNotes` does. */
function normalizeFolder(s: string): string {
	return s.trim().replace(/^\/+|\/+$/g, '');
}

/** Minimal glob → RegExp (`*` and `?` only), copied from noteScanner.ts. */
function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp('^' + escaped + '$');
}

/**
 * Migrate pre-multi-instance flat auth (confluenceBaseUrl / authType / username / apiToken)
 * into `instances[0]` under id='default'. After migration flat fields are removed
 * to avoid a second source of truth.
 *
 * Idempotent: when no legacy data is present (fresh install OR already-
 * migrated user), this is a no-op. The `hasLegacyData` guard makes the
 * migration safe under future `LEGACY_MIGRATION_VERSION` bumps — a user
 * whose data was migrated on plugin 0.4.0 still has marker === '0.4.0'
 * with no legacy fields, so when 0.5.0's marker mismatch triggers this
 * function again, it bails without overwriting `settings.instances`.
 *
 * Returns `true` if any change was made (so the caller can decide how
 * loud to be in logs).
 */
export function migrateLegacySettings(
	settings: SyncConfluenceSettings,
	logger: MigrationLogger,
): boolean {
	const raw = settings as unknown as Record<string, unknown>;
	const legacyBaseRaw = typeof raw['confluenceBaseUrl'] === 'string' ? (raw['confluenceBaseUrl'] as string) : '';
	const legacyUsernameRaw = typeof raw['username'] === 'string' ? (raw['username'] as string) : '';
	const legacyKey = typeof raw['apiToken'] === 'string' ? (raw['apiToken'] as string) : '';
	// `stripSupplementaryChars` was a global setting in 0.3.7 but moved to
	// per-instance in 0.4.0. If the user had it on, copy to the Default
	// instance so the legacy behaviour survives the upgrade.
	const legacyStripSupplementary = raw['stripSupplementaryChars'] === true;

	const hasLegacyData = legacyBaseRaw.trim() !== ''
		|| legacyUsernameRaw.trim() !== ''
		|| legacyKey.trim() !== ''
		|| raw['authType'] === 'bearer'
		|| legacyStripSupplementary;

	// No legacy data — fresh install or already-migrated user. Don't touch
	// `instances` (it might be empty for the fresh install, or already
	// populated for the already-migrated user).
	if (!hasLegacyData) return false;

	const normalizedLegacyBase = legacyBaseRaw.trim().replace(/\/+$/, '');
	const legacyAuth = raw['authType'] === 'bearer' ? 'bearer' : 'basic';

	settings.instances = [{
		id: 'default',
		name: 'Default',
		baseUrl: normalizedLegacyBase,
		authType: legacyAuth,
		username: legacyUsernameRaw.trim(),
		// Preserve the legacy key name when one was set — the existing
		// SecretStorage entry still works, no copy needed. The derived
		// `sync-confluence-token-default` slot is only used when no legacy
		// key existed (i.e. the user had no token stored yet).
		apiToken: legacyKey || 'sync-confluence-token-default',
		stripSupplementaryChars: legacyStripSupplementary,
	}];

	// Note: this overwrites any pre-existing `instances` array. In the
	// typical migration path this is a non-issue (the user had no
	// `instances` yet), but a half-migrated user with both legacy fields
	// and a configured `instances` would lose their custom config. The
	// `hasLegacyData` guard above ensures this code only runs when legacy
	// fields are actually present, so the overlap case requires the user
	// to have re-introduced legacy fields after migration — at which point
	// overwriting is the safer default.
	// Drop legacy flat fields to avoid a second source of truth.
	delete raw['confluenceBaseUrl'];
	delete raw['authType'];
	delete raw['username'];
	delete raw['apiToken'];
	delete raw['stripSupplementaryChars'];
	logger.info('Legacy auth migrated to multi-instance "Default"');
	return true;
}

/**
 * One-shot frontmatter migration for notes that were written by pre-multi-
 * instance versions of this plugin. Converts:
 *
 *   - `confluence_last_hash: "H"` (string) →
 *       `{ [instanceId]: { [pageId]: "H" for each declared pageId } }`
 *   - `confluence_attachments` in either legacy flat form or 0.3.8's
 *       pageId-bucketed form →
 *       `{ [instanceId]: { [pageId]: { filename: { hash, id } } } }`
 *
 * Per-target routing uses the same authoritative URL rule as the sync engine,
 * preserving the index relationship between URL, pageId and attachment
 * bucket. Unmatched data falls back to the first configured instance id (or
 * `default` when none exists) so it is not discarded.
 *
 * Reads files via `vault.cachedRead` + `js-yaml` parser rather than
 * `metadataCache` — the cache is incomplete at onload time on large vaults
 * (1000+ files), and migration must catch bound notes the user has not
 * recently opened.
 *
 * Only the two known predecessor shapes are handled. Any other intermediate
 * shape is left alone; already-migrated per-instance maps are no-ops.
 *
 * Failures are isolated per-file and never crash plugin load.
 */
export async function migrateLegacyFrontmatter(
	app: App,
	settings: SyncConfluenceSettings,
	logger: MigrationLogger,
): Promise<number> {
	const configDir = app.vault.configDir;
	const scanFolders = settings.scanFolders.map(normalizeFolder).filter((s) => s.length > 0);
	const ignoreRegexes = [`${configDir}/**`, ...settings.ignorePatterns]
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map(globToRegex);

	const allFiles = app.vault.getMarkdownFiles().filter((f) => {
		if (scanFolders.length > 0 && !scanFolders.some((s) => f.path === s || f.path.startsWith(s + '/'))) return false;
		if (ignoreRegexes.some((r) => r.test(f.path))) return false;
		return true;
	});

	const resolver = new InstanceResolver({ instances: settings.instances });
	const urlKey = settings.frontmatterKey || 'confluence_url';
	logger.info(`migrateLegacyFrontmatter: starting — scanning ${allFiles.length} files via disk read, ${settings.instances.length} configured instance(s)`);
	let found = 0;
	let legacyShape = 0;
	let migrated = 0;
	let readErrors = 0;
	for (const file of allFiles) {
		try {
			const raw = await app.vault.cachedRead(file);
			const fm = parseFrontmatter(raw);
			if (!fm) continue;
			if (!hasNonEmptyValue(fm[urlKey]) && !hasNonEmptyValue(fm['confluence_parent_url'])) continue;
			found++;
			const hasLegacy = typeof fm['confluence_last_hash'] === 'string'
				|| isLegacyFlatAttachmentShape(fm['confluence_attachments'])
				|| isLegacyPageAttachmentShape(fm['confluence_attachments']);
			if (!hasLegacy) continue;
			legacyShape++;
			const fallbackInstanceId = settings.instances[0]?.id ?? 'default';
			const ok = await writeMigratedFrontmatter(
				app,
				file,
				resolver,
				urlKey,
				fallbackInstanceId,
			);
			if (ok) migrated++;
		} catch (e) {
			readErrors++;
			logger.warn(`Failed to read/migrate ${file.path}`, e instanceof Error ? e.message : String(e));
		}
	}
	logger.info(`migrateLegacyFrontmatter: done — found=${found}, legacyShape=${legacyShape}, migrated=${migrated}, readErrors=${readErrors}`);
	return migrated;
}

/**
 * Apply the per-instance wrapping for `confluence_last_hash` and
 * `confluence_attachments` via `processFrontMatter`. Routing is recomputed
 * from the live, index-aligned targets inside the write transaction so a
 * concurrent frontmatter edit cannot send a pageId to the wrong instance.
 */
async function writeMigratedFrontmatter(
	app: App,
	file: TFile,
	resolver: InstanceResolver,
	urlKey: string,
	fallbackInstanceId: string,
): Promise<boolean> {
	let changed = false;
	await app.fileManager.processFrontMatter(file, (raw) => {
		const fmRaw = raw as Record<string, unknown>;
		if (typeof fmRaw['confluence_last_hash'] !== 'string'
			&& !isLegacyFlatAttachmentShape(fmRaw['confluence_attachments'])
			&& !isLegacyPageAttachmentShape(fmRaw['confluence_attachments'])) {
			return; // already migrated; nothing to do
		}
		const targets = readTargetsFromFrontmatter(fmRaw, urlKey).targets;
		const routes = targets.map((target) => ({
			target,
			instanceId: resolver.resolveTarget(target)?.id ?? fallbackInstanceId,
		}));
		if (typeof fmRaw['confluence_last_hash'] === 'string') {
			const hash = fmRaw['confluence_last_hash'] as string;
			const nested: Record<string, Record<string, string>> = {};
			for (const route of routes) {
				const pageId = route.target.pageId.trim();
				if (!pageId) continue;
				const bucket = nested[route.instanceId] ?? {};
				bucket[pageId] = hash;
				nested[route.instanceId] = bucket;
			}
			fmRaw['confluence_last_hash'] = nested;
			changed = true;
		}
		const attachmentValue = fmRaw['confluence_attachments'];
		if (isLegacyFlatAttachmentShape(attachmentValue)
			|| isLegacyPageAttachmentShape(attachmentValue)) {
			const nested = migrateAttachmentCache(attachmentValue, routes, fallbackInstanceId);
			fmRaw['confluence_attachments'] = nested;
			changed = true;
		}
	});
	return changed;
}

function migrateAttachmentCache(
	value: unknown,
	routes: Array<{ target: SyncTarget; instanceId: string }>,
	fallbackInstanceId: string,
): Record<string, Record<string, Record<string, AttachmentRecord>>> {
	const nested: Record<string, Record<string, Record<string, AttachmentRecord>>> = {};
	const put = (
		instanceId: string,
		pageId: string,
		attachments: Record<string, AttachmentRecord>,
	): void => {
		if (isUnsafeObjectKey(instanceId) || isUnsafeObjectKey(pageId)) return;
		const instanceBucket = nested[instanceId] ?? {};
		instanceBucket[pageId] = copySafeAttachmentRecords(attachments);
		nested[instanceId] = instanceBucket;
	};

	if (isLegacyPageAttachmentShape(value)) {
		for (const [pageId, attachments] of Object.entries(value)) {
			if (isUnsafeObjectKey(pageId)) continue;
			const owners = new Set(
				routes
					.filter((route) => route.target.pageId.trim() === pageId)
					.map((route) => route.instanceId),
			);
			if (owners.size === 0) owners.add(fallbackInstanceId);
			for (const instanceId of owners) put(instanceId, pageId, attachments);
		}
		return nested;
	}

	if (isLegacyFlatAttachmentShape(value)) {
		const firstRoute = routes.find((route) => route.target.pageId.trim().length > 0);
		const pageId = firstRoute?.target.pageId.trim() ?? '';
		put(firstRoute?.instanceId ?? fallbackInstanceId, pageId, value);
	}
	return nested;
}

function copySafeAttachmentRecords(attachments: Record<string, AttachmentRecord>): Record<string, AttachmentRecord> {
	const out: Record<string, AttachmentRecord> = {};
	for (const [k, rec] of Object.entries(attachments)) {
		if (isUnsafeObjectKey(k)) continue;
		out[k] = rec;
	}
	return out;
}

/**
 * Shape-only check used inside the write transaction: is the current
 * `confluence_attachments` value still in legacy flat form? Mirrors
 * `isLegacyFlatAttachmentMap` (exported below for direct testing).
 */
function isLegacyFlatAttachmentShape(
	v: unknown,
): v is Record<string, AttachmentRecord> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const entries = Object.entries(v as Record<string, unknown>);
	if (entries.length === 0) return false;
	for (const [, entry] of entries) {
		if (!entry || typeof entry !== 'object') return false;
		const e = entry as Record<string, unknown>;
		if (typeof e.hash !== 'string' || typeof e.id !== 'string') return false;
	}
	return true;
}

/**
 * Shape used by 0.3.8: `pageId → filename → {hash,id}`. This is the direct
 * predecessor of the multi-instance shape and must not be discarded.
 */
function isLegacyPageAttachmentShape(
	v: unknown,
): v is Record<string, Record<string, AttachmentRecord>> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const entries = Object.entries(v as Record<string, unknown>);
	if (entries.length === 0) return false;
	return entries.every(([, bucket]) => isLegacyFlatAttachmentShape(bucket));
}

/**
 * One-shot frontmatter migration for the `confluence_username` field, which
 * was a flat string (`confluence_username: john.doe`) in pre-multi-instance
 * versions and is now a per-instance map keyed by `ConfluenceInstance.id`.
 *
 * The legacy string has no instance disambiguation, so the username is
 * duplicated under every configured instance — this avoids the user having
 * to manually re-enter the username per instance. If the username is
 * actually only valid on one of them, the user can prune the others later
 * (the field is a plain map, easy to edit).
 *
 * Reads files via `vault.cachedRead` + `js-yaml` parser rather than
 * `metadataCache`, same reason as `migrateLegacyFrontmatter`.
 *
 * Scans the whole vault (excluding `app.vault.configDir`) — person notes
 * referenced by `@[[Name]]` typically aren't bound to Confluence, so a
 * bound-only scan would miss them. Idempotent: already-migrated maps are
 * left alone.
 */
export async function migrateLegacyUsernames(
	app: App,
	settings: SyncConfluenceSettings,
	logger: MigrationLogger,
): Promise<number> {
	const configDir = app.vault.configDir;
	const allFiles = app.vault.getMarkdownFiles().filter(
		(f) => !f.path.startsWith(configDir + '/'),
	);
	// Duplicate the username under every configured instance so the user
	// doesn't have to re-enter it per instance. If no instances are set yet,
	// fall back to the literal `'default'` key (matches pre-multi-instance
	// shape and survives the eventual migration once they add an instance).
	const instanceIds = settings.instances.length > 0
		? settings.instances.map((i) => i.id)
		: ['default'];
	logger.info(`migrateLegacyUsernames: starting — scanning ${allFiles.length} vault files via disk read (excluding configDir), instanceIds=${instanceIds.join(',')}`);
	let legacyShape = 0;
	let migrated = 0;
	let readErrors = 0;
	for (const file of allFiles) {
		try {
			const raw = await app.vault.cachedRead(file);
			const snap = readFrontmatterSnapshot(raw, 'confluence_username');
			if (!snap) continue;
			if (snap.legacyUsername === null) continue;
			legacyShape++;
			const ok = await writeMigratedUsername(app, file, instanceIds);
			if (ok) migrated++;
		} catch (e) {
			readErrors++;
			logger.warn(`Failed to read/migrate ${file.path}`, e instanceof Error ? e.message : String(e));
		}
	}
	logger.info(`migrateLegacyUsernames: done — legacyShape=${legacyShape}, migrated=${migrated}, readErrors=${readErrors}`);
	return migrated;
}

/**
 * Apply the per-instance wrapping for `confluence_username` via
 * `processFrontMatter`. Re-reads inside the write transaction so a user
 * edit between the disk-read and the write doesn't get clobbered.
 */
async function writeMigratedUsername(
	app: App,
	file: TFile,
	instanceIds: string[],
): Promise<boolean> {
	await app.fileManager.processFrontMatter(file, (raw) => {
		const fmRaw = raw as Record<string, unknown>;
		const current = fmRaw['confluence_username'];
		if (typeof current !== 'string') return;
		const trimmed = current.trim();
		if (!trimmed) return;
		const next: PerInstanceUsernameMap = {};
		for (const id of instanceIds) next[id] = trimmed;
		fmRaw['confluence_username'] = next;
	});
	return true;
}

/**
 * Detect pre-multi-instance flat attachment map shape
 * `{ filename: { hash, id } }` — non-empty. Empty objects are not
 * considered legacy (they're already-empty maps that just need to stay
 * empty after migration). Exported for direct testing / future
 * bulk-repair tools.
 */
export function isLegacyFlatAttachmentMap(v: unknown): boolean {
	return isLegacyFlatAttachmentShape(v);
}

export function isLegacyPageAttachmentMap(v: unknown): boolean {
	return isLegacyPageAttachmentShape(v);
}
