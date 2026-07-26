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
import type { SyncConfluenceSettings } from './settings';
import { scanBoundNotes } from './sync/noteScanner';

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
 *     - frontmatter: `lastHash: "H"` string and
 *       `attachments: { filename: rec }` flat →
 *       per-instance nested form.
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
 * Extract every pageId declared in the configured URL field for legacy
 * hash distribution. Handles scalar, CSV, and array frontmatter shapes.
 */
function collectPageIds(fm: Record<string, unknown>, urlKey: string): string[] {
	const pageIds: string[] = [];
	const raw = fm['confluence_page_id'];
	if (typeof raw === 'string') {
		for (const p of raw.split(/[,,]/)) {
			const trimmed = p.trim();
			if (trimmed) pageIds.push(trimmed);
		}
	} else if (Array.isArray(raw)) {
		for (const p of raw) {
			if (typeof p === 'string' && p.trim()) pageIds.push(p.trim());
		}
	}
	return pageIds;
}

/**
 * Detect pre-multi-instance flat attachment map shape
 * `{ filename: { hash, id } }` — non-empty. Empty objects are not
 * considered legacy (they're already-empty maps that just need to stay
 * empty after migration). Used by the migration entry points to decide
 * whether a note still needs migration.
 *
 * Exported for direct testing of the migration helpers.
 */
export function isLegacyFlatAttachmentMap(v: unknown): boolean {
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
 *   - `confluence_attachments: { filename: { hash, id } }` (flat) →
 *       `{ [instanceId]: { [pageId]: { filename: { hash, id } } } }`
 *
 * Only the original pre-multi-instance shapes are handled. Any other
 * intermediate shape (e.g. a hand-edited pageId-only form) is left alone
 * and the note falls back to `undefined` from the read helpers — the
 * engine will re-upload attachments / re-sync as needed on the next
 * run. Idempotent: notes already in the per-instance form are no-ops.
 *
 * Failures are isolated per-file and never crash plugin load.
 *
 * Returns the number of notes that were actually rewritten.
 */
export async function migrateLegacyFrontmatter(
	app: App,
	settings: SyncConfluenceSettings,
	logger: MigrationLogger,
): Promise<number> {
	const files = scanBoundNotes(app, {
		frontmatterKey: settings.frontmatterKey,
		scanFolders: settings.scanFolders,
		ignorePatterns: settings.ignorePatterns,
	});
	// The `?? 'default'` only fires when migrateLegacySettings was a no-op
	// (no legacy data) AND migrateLegacyFrontmatter still has legacy files
	// to migrate. That requires a hand-edited data.json with legacy
	// frontmatter but no instances — at which point the user has bigger
	// problems. We fall back to 'default' so migration still runs.
	const instanceId = settings.instances[0]?.id ?? 'default';
	let migrated = 0;
	for (const file of files) {
		try {
			if (await tryMigrateLegacyFile(app, file, instanceId)) migrated += 1;
		} catch (e) {
			logger.warn(`Failed to migrate legacy frontmatter on ${file.path}`, e instanceof Error ? e.message : String(e));
		}
	}
	if (migrated > 0) {
		logger.info(`Migrated legacy frontmatter on ${migrated} notes`);
	}
	return migrated;
}

/**
 * Migrate one file's frontmatter if it has legacy shapes. Returns true
 * when the file was rewritten. Exported for direct testing / future
 * bulk-repair tools.
 */
export async function tryMigrateLegacyFile(
	app: App,
	file: TFile,
	instanceId: string,
): Promise<boolean> {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
	if (!fm) return false;
	const lastHash = fm['confluence_last_hash'];
	const attachments = fm['confluence_attachments'];
	const isLegacyStringHash = typeof lastHash === 'string';
	const isLegacyFlatAttach = isLegacyFlatAttachmentMap(attachments);
	if (!isLegacyStringHash && !isLegacyFlatAttach) return false;

	// Collect pageIds from confluence_page_id for legacy-string seeding.
	const pageIds = collectPageIds(fm, '');

	await app.fileManager.processFrontMatter(file, (raw) => {
		const fmRaw = raw as Record<string, unknown>;
		if (typeof fmRaw['confluence_last_hash'] === 'string') {
			const hash = fmRaw['confluence_last_hash'] as string;
			const inner: Record<string, string> = {};
			for (const pid of pageIds) inner[pid] = hash;
			fmRaw['confluence_last_hash'] = { [instanceId]: inner };
		}
		if (isLegacyFlatAttachmentMap(fmRaw['confluence_attachments'])) {
			const flat = fmRaw['confluence_attachments'] as Record<string, { hash: string; id: string }>;
			const targetPageId = pageIds[0] ?? '';
			fmRaw['confluence_attachments'] = {
				[instanceId]: { [targetPageId]: { ...flat } },
			};
		}
	});
	return true;
}
