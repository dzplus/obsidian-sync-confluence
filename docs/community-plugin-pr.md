# Community Plugin Submission — PR Description Template

Copy the body below into the PR you open against `obsidianmd/obsidian-releases`.

---

## I have read [the developer policies] and the [community plugin guidelines]

[the developer policies]: https://docs.obsidian.md/Developer+policies
[community plugin guidelines]: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

- [x] I have read the developer policies
- [x] I have read the plugin submission guidelines and followed them

## Plugin overview

**Repository**: https://github.com/dzplus/obsidian-sync-confluence
**Plugin ID**: `sync-confluence`
**Plugin name**: Sync Confluence
**Author**: duanzhang
**Description**: Sync notes to Confluence pages on a schedule, bound by a `confluence_url` field in frontmatter.

The plugin pushes Obsidian notes to their bound Confluence pages (Cloud or Server / Data Center) using a frontmatter field as the binding. It is intended for users who already maintain documentation in Confluence and want to keep authoring in Obsidian.

## Checklist

- [x] My plugin follows the [plugin guidelines]
- [x] My plugin does not duplicate functionality of an existing plugin
- [x] The repository has a `LICENSE` file (0BSD)
- [x] The repository has a `README.md` describing usage and configuration (English; Chinese summary at the bottom)
- [x] My GitHub Release contains `main.js`, `manifest.json`, and `styles.css` as separate assets (no zip)
- [x] The release tag matches the `version` field in `manifest.json` (currently `0.1.0`)
- [x] `manifest.json` `description` is in English
- [x] No use of `innerHTML`, `outerHTML`, or `insertAdjacentHTML`
- [x] All event listeners and timers are released in `onunload()`
- [x] Settings UI uses `Setting.setHeading()` instead of raw `<h3>` elements
- [x] Command names do not include the plugin name as a prefix

[plugin guidelines]: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

## Notable design decisions reviewers may ask about

### `isDesktopOnly: true`

The plugin uses Node's built-in `https` / `http` modules in `src/confluence/api.ts` for two specific Confluence Server requests (POST with JSON body, multipart attachment upload). This is unavailable on mobile, hence the desktop-only flag. PUT requests and idempotent reads still go through Obsidian's `requestUrl`.

### Why not use `requestUrl` for every request?

Confluence Server / Data Center deployments enforce an XSRF check that, in our testing, rejects:

- `requestUrl` POST with a JSON body — the Atlassian XSRF filter inspects the request shape and returns 401 / 403 in cases where `fetch` would not.
- `requestUrl` multipart binary uploads — Obsidian's body serialization normalizes the boundary in a way the Confluence multipart parser rejects.

Both issues are reproduced against vanilla Confluence Server 7.x / 8.x. The same payload formed manually via Node's `https` module is accepted. Inline comments in `src/confluence/api.ts` explain the workaround per call site. Cloud-only would not need this, but the plugin is intended to also support on-prem Confluence, which is the dominant deployment model in our target user base.

### Secret storage

Confluence API tokens and passwords are stored via Obsidian's SecretStorage API, not in plain text inside `data.json`. The settings UI only stores a secret-storage key reference; the actual value is resolved at API-call time.

### Network destinations

The plugin makes outbound HTTPS requests to:

1. The user-configured Confluence base URL (mandatory).
2. The configured PlantUML Server URL (optional, off by default; defaults to `https://www.plantuml.com/plantuml` if the user opts in).

Mermaid diagrams are rendered locally via the bundled `mermaid` library — no third-party network call.

### Funding

No funding URL is set. The plugin is provided as-is under 0BSD.

---

## Submission entry

Append the following object to `community-plugins.json`, in the correct alphabetical position by `id`:

```json
{
  "id": "sync-confluence",
  "name": "Sync Confluence",
  "author": "duanzhang",
  "description": "Sync notes to Confluence pages on a schedule, bound by a confluence_url field in frontmatter.",
  "repo": "dzplus/obsidian-sync-confluence"
}
```
