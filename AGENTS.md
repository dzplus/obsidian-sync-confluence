# AGENTS.md — Sync Confluence (Obsidian Plugin)

## Project
Obsidian plugin that pushes notes to Confluence pages. Frontmatter-driven (`confluence_url`), one-way sync, desktop-only.

## Toolchain
- **Package manager**: Bun (`bun.lock` — do not use npm/pnpm)
- **Build**: esbuild (`esbuild.config.mjs`) + TypeScript typecheck
- **Target**: ES2018, CJS bundle, `obsidian` and all CodeMirror/electron/builtin modules are **external**

## Commands
```bash
bun install
bun run dev       # watch mode → dist/main.js (no typecheck)
bun run build     # tsc -noEmit -skipLibCheck + esbuild production bundle + copy manifest.json & styles.css to dist/
```

## Release
```bash
npm version 0.x.x   # bumps package.json, runs version-bump.mjs to sync manifest.json + versions.json, auto-stages them
git push && git push --tags
```
- CI (`.github/workflows/release.yml`) builds on version tags (`[0-9]+.[0-9]+.[0-9]+`), verifies tag matches `manifest.json` version, then creates a GitHub Release attaching `dist/main.js`, `dist/manifest.json`, `dist/styles.css`.
- `version-bump.mjs` explicitly `git add`s `manifest.json` (and `versions.json` if changed) because npm does **not** auto-stage files touched by lifecycle scripts.

## Architecture
- `src/main.ts` — Plugin entry point (`SyncConfluencePlugin extends Plugin`). Manages one `SyncEngine` per configured Confluence instance in a `Map<string, SyncEngine>` keyed by `ConfluenceInstance.id`. Orchestrates sync fan-out, per-instance routing via `InstanceResolver`, command palette, context menus, ribbon icon, scheduled sync, template installation, and one-time legacy migration.
- `src/settings.ts` — Settings interface + `PluginSettingTab` UI. Renders one auth card per `ConfluenceInstance` (add / reorder / remove / validate). Reuses `SecretComponent` for token input where Obsidian exposes it; falls back to plain-text + `secretStorage.setSecret` for older Obsidian.
- `src/confluence/` — API client (`api.ts`), markdown→Confluence storage conversion (`markdownConverter.ts`), attachment uploader, Mermaid (Kroki-PNG / Obsidian-SVG) and PlantUML PNG renderers, URL parser (`urlParser.ts`), URL-prefix matcher (`urlMatch.ts`) used by `instanceResolver` and `syncEngine` to keep routing decisions consistent.
- `src/sync/` — `noteScanner.ts` (finds bound notes) + `syncEngine.ts` (orchestrates push, hash skip, attachment diff; in multi-instance mode filters `binding.targets` to those whose URL prefix matches the engine's `instanceBaseUrl`) + `instanceResolver.ts` (longest-prefix URL matching; a single file can be routed to multiple instances if its targets span them).
- `src/ui/` — Status bar pill (`statusBar.ts`), confirmation/create-note modals (`confirmModal.ts`, `createBoundNoteModal.ts`), property-panel action icons (`propertyActions.ts`). `CreateBoundNoteModal` accepts the full `instances[]` and validates that the entered URL matches the chosen instance's base URL.
- `src/i18n/` — `en.ts` / `zh.ts`, auto-detected from `window.localStorage.getItem('language')`. `t('dotted.key')` returns the key itself if missing (fail-visible).
- `src/frontmatter/handler.ts` — Reads/writes frontmatter bindings (`confluence_url`, `confluence_parent_url`, `confluence_page_id`, `confluence_last_synced`, `confluence_last_hash`, `confluence_attachments`). Supports configurable frontmatter key (`settings.frontmatterKey`) and multi-target / CSV / array field formats.
- `src/utils/` — `logger.ts` (in-memory log buffer with listeners) + `hash.ts` (SHA-1 via Web Crypto).
- `src/types.ts` — Shared interfaces, including multi-instance shapes (`ConfluenceInstance`, `PerInstanceSyncResult`, `MultiInstanceBatchResult`).
- `templates/confluence-note.md` — Default template used by `installTemplateFile`.
- `tests/e2e/` — End-to-end tests (Mermaid coverage fixtures, verification scripts).

## Conventions
- **Locale**: Add new UI strings to both `src/i18n/en.ts` and `src/i18n/zh.ts` using the same dotted key.
- **Hash skip**: `syncEngine.ts` compares a content hash to avoid re-pushing unchanged notes. `confluence_last_hash` is keyed by `instanceId → pageId → hash` (two-level nested Record). The instanceId layer is required because Confluence pageIds are local to an installation — two Server/DC instances can have the same pageId, and a single-level key would let engine A's stamp vouch for engine B's target. The engine passes only its own slice delta to writeBinding; the atomic merge inside writeBinding (under a plugin-wide mutex) preserves foreign slices verbatim.
- **Migrations** (`migrateLegacyFrontmatter`, `migrateLegacyUsernames`) read each file via `app.vault.cachedRead` and parse with `js-yaml` (`JSON_SCHEMA`), then project onto the 6 fields they care about. Writes go through `processFrontMatter`, which re-reads the live frontmatter inside the callback so a user edit between disk-read and write takes precedence over the snapshot. `settings.frontmatterKey` is honored in the binding check. `migrateLegacyFrontmatter` logs `found` / `legacyShape` / `migrated` / `readErrors` counters; `migrateLegacyUsernames` logs `legacyShape` / `migrated` / `readErrors`.
- **Attachments**: `confluence_attachments` frontmatter caches `instanceId → pageId → filename → {hash, id}` to skip re-uploads. The instanceId layer prevents cross-instance collisions; the pageId layer isolates multi-target uploads.
- **Mentions**: `confluence_username` frontmatter (on person notes referenced by `@[[Name]]`) holds a `PerInstanceUsernameMap` keyed by `ConfluenceInstance.id`. Each engine reads only its own slice; missing slice → resolver returns null → markdownConverter degrades to plain `@Name` on that instance only. Cloud mentions remain unsupported (still requires `ri:account-id`).
- **Auth**: Supports Basic (email + API token / password) and Bearer (PAT). The plugin uses Node `https` directly (not Obsidian's `requestUrl`) to avoid Confluence Server XSRF rejections on POST/multipart uploads. Per-instance tokens live in SecretStorage — on Obsidian with `SecretComponent` the user picks any custom key, on older Obsidian the plugin writes them under the derived key `sync-confluence-token-<instanceId>`.
- **Desktop only**: `manifest.json` sets `isDesktopOnly: true` because it relies on Node built-in modules unavailable on mobile.
- **Multi-instance**: Up to 10 configured Confluence instances per vault. Notes are routed via longest-prefix URL matching against each instance's `baseUrl`. A single file can land in multiple instance groups when its `confluence_url` / `confluence_parent_url` targets span instances; each `SyncEngine` filters `binding.targets` to the subset whose URL prefix matches its `instanceBaseUrl`. Targets that belong to a different instance are marked `foreign: true` and excluded from this engine's failure count. A file is reported as `Unmatched` only when none of its URLs prefix-match any configured instance.

## Local testing
`bun run build` copies `manifest.json` and `styles.css` into `dist/`. Drop the entire `dist/` folder into `<vault>/.obsidian/plugins/sync-confluence/` and reload Obsidian.

## TypeScript quirks
- `tsconfig.json`: `baseUrl: "src"`, `module: ESNext`, `target: ES2018`, strict flags on (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, etc.).
- `skipLibCheck` is used in the build script.
