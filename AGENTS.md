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
- `src/main.ts` — Plugin entry point (`SyncConfluencePlugin extends Plugin`). Commands, context menus, ribbon icon, scheduled sync, template installation.
- `src/settings.ts` — Settings interface + `PluginSettingTab` UI.
- `src/confluence/` — API client (`api.ts`), markdown→Confluence storage conversion (`markdownConverter.ts`), attachment uploader, Mermaid/PlantUML PNG renderers, URL parser (`urlParser.ts`).
- `src/sync/` — `noteScanner.ts` (finds bound notes) + `syncEngine.ts` (orchestrates push, hash skip, attachment diff).
- `src/ui/` — Status bar pill (`statusBar.ts`), confirmation/create-note modals (`confirmModal.ts`, `createBoundNoteModal.ts`), property-panel action icons (`propertyActions.ts`).
- `src/i18n/` — `en.ts` / `zh.ts`, auto-detected from `window.localStorage.getItem('language')`. `t('dotted.key')` returns the key itself if missing (fail-visible).
- `src/frontmatter/handler.ts` — Reads/writes frontmatter bindings (`confluence_url`, `confluence_parent_url`, `confluence_page_id`, `confluence_last_synced`, `confluence_last_hash`, `confluence_attachments`). Supports configurable frontmatter key (`settings.frontmatterKey`).
- `src/utils/` — `logger.ts` (in-memory log buffer with listeners) + `hash.ts` (SHA-1 via Web Crypto).
- `src/types.ts` — Shared interfaces.
- `templates/confluence-note.md` — Default template used by `installTemplateFile`.
- `tests/e2e/` — End-to-end tests (Mermaid coverage fixtures, verification scripts).

## Conventions
- **Locale**: Add new UI strings to both `src/i18n/en.ts` and `src/i18n/zh.ts` using the same dotted key.
- **Hash skip**: `syncEngine.ts` compares a content hash to avoid re-pushing unchanged notes; do not break that invariant.
- **Attachments**: `confluence_attachments` frontmatter caches `filename → {hash, id}` to skip re-uploads.
- **Auth**: Supports Basic (email + API token / password) and Bearer (PAT). The plugin uses Node `https` directly (not Obsidian's `requestUrl`) to avoid Confluence Server XSRF rejections on POST/multipart uploads.
- **Desktop only**: `manifest.json` sets `isDesktopOnly: true` because it relies on Node built-in modules unavailable on mobile.

## Local testing
`bun run build` copies `manifest.json` and `styles.css` into `dist/`. Drop the entire `dist/` folder into `<vault>/.obsidian/plugins/sync-confluence/` and reload Obsidian.

## TypeScript quirks
- `tsconfig.json`: `baseUrl: "src"`, `module: ESNext`, `target: ES2018`, strict flags on (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, etc.).
- `skipLibCheck` is used in the build script.
