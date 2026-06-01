# Sync Confluence

Sync Obsidian notes to Confluence pages on a schedule. Each note is bound to a Confluence page via a `confluence_url` field in its frontmatter — no extra mapping file, no extra UI to keep in sync. Works with both Atlassian Cloud and on-prem Confluence Server / Data Center.

> 中文说明见文末。

## How it works

1. Add a line to your note's frontmatter:
   ```yaml
   confluence_url: https://your-domain.atlassian.net/wiki/spaces/XXX/pages/12345/Title
   ```
2. Fill in **base URL**, **auth credentials**, and the API token in the plugin settings.
3. Trigger **Sync all notes** (ribbon icon / command palette / right-click), or let the timer fire on its interval.
4. The plugin converts the note body to Confluence storage format and pushes it to the bound page.

## Features

- **Frontmatter-driven binding** — drop a page URL into the note, done. No separate config to keep in sync.
- **Content-hash skip** — unchanged notes are not re-pushed.
- **Local attachment upload** — `![[image.png]]` embeds are uploaded as Confluence attachments.
- **Auto-create child pages** — if a note has `confluence_parent_url` instead of `confluence_url`, the first sync creates the page under that parent and writes the new URL back to the note.
- **Mermaid pre-rendering** — Mermaid code blocks are rendered locally to PNG and uploaded as images (so anyone viewing the Confluence page sees the diagram, even without the Mermaid macro).
- **PlantUML pre-rendering** — optional, via a PlantUML Server. Off by default.
- **Multiple triggers** — ribbon icon, command palette, editor/file context menu, scheduled timer.

## Authentication

| Type | Cloud | Server / DC |
|---|---|---|
| **Basic** | email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens) | domain account + password |
| **Bearer** | OAuth Bearer | Personal Access Token (Server 7.9+) |

Tokens are stored via Obsidian's SecretStorage (not in plain config files).

## Installation

### From the community plugin browser
Pending review. Once accepted, search "Sync Confluence" in Settings → Community plugins.

### From a GitHub Release (manual)
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/dzplus/obsidian-sync-confluence/releases).
2. Place them in `<vault>/.obsidian/plugins/sync-confluence/`.
3. Reload Obsidian, then enable the plugin in Settings → Community plugins.

### Via BRAT (recommended for beta tracking)
Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community store, open BRAT settings, choose **Add Beta plugin**, and enter `dzplus/obsidian-sync-confluence`. BRAT will install the plugin and keep it updated as new releases are tagged.

## Scope and limitations

- **One-way sync only** (Obsidian → Confluence). If someone edits the page directly in Confluence, the next sync overwrites it.
- **Desktop only**. The plugin relies on Node `https` / `http` modules to work around Confluence Server's XSRF rejection of certain `requestUrl` payloads (POST + JSON, multipart binary). See `src/confluence/api.ts` for the inline rationale.
- **No Confluence macro coverage beyond the basics**. Common markdown constructs (headings, lists, tables, code blocks, links, images, callouts) are converted; vendor-specific macros are not.

## Development

```bash
bun install
bun run dev      # watch mode, writes dist/main.js
bun run build    # production build
```

The build copies `manifest.json` and `styles.css` into `dist/` so the directory can be dropped straight into `.obsidian/plugins/sync-confluence/` for local testing.

To release a new version:

```bash
npm version 0.2.0          # bumps package.json + manifest + versions.json
git push && git push --tags
```

The `release.yml` workflow then builds and publishes a GitHub Release with the three required files attached.

## License

[BSD Zero Clause](./LICENSE)

---

## 中文简介

把 Obsidian 笔记按设定间隔自动推送到 Confluence 对应页面。

- **绑定方式**：在笔记 frontmatter 写 `confluence_url`(已有页面)或 `confluence_parent_url`(由插件首次同步时创建子页面)
- **特性**：内容哈希去重、本地附件自动上传、Mermaid/PlantUML 预渲染、定时器与多种手动触发方式
- **认证**：支持 Cloud (email + API token) 与 Server/DC (域账号 + 密码 或 PAT),token 走 Obsidian SecretStorage
- **范围**：仅 Obsidian → Confluence 单向;Confluence 端的改动会在下次同步时被覆盖
