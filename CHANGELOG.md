# Changelog · 更新日志

All notable changes to this project will be documented in this file.
本文件记录本项目所有值得关注的变更。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

## [0.3.8] — 2026-07-29

### English

#### Added

- **Multi-instance Confluence support.** Up to 10 Confluence instances per vault. Each instance has its own name / base URL / auth type / account / token, rendered as an independent card in **Settings → Confluence authentication**. Tokens live in Obsidian's SecretStorage (key vault on Obsidian 1.11.4+, plaintext + derived key `sync-confluence-token-<instanceId>` on older builds). The settings top-level fields (`confluenceBaseUrl` / `authType` / `username` / `apiToken`) are gone — only `instances: ConfluenceInstance[]` remains.
- **Longest-prefix URL routing (`InstanceResolver`).** Every note is scanned across all its `confluence_url` / `confluence_parent_url` targets (scalar / CSV / array); each URL is matched against every configured instance's `baseUrl` with the longest-prefix-wins rule and host-boundary safety. A single file can land in multiple instance groups when its targets span instances. Grouped notes flow into one `SyncEngine` per instance, each filtering its `binding.targets` to the subset whose URL prefix matches its `instanceBaseUrl`. Targets that belong to another instance are marked `foreign: true` and excluded from the engine's failure count, so the hash-skip invariant stays intact when one instance fails. Files whose URLs prefix-match no instance are surfaced as `Unmatched` in the sync summary.
- **Frontmatter shape change for per-instance dedup state.** `confluence_last_hash` becomes `Record<instanceId, Record<pageId, string>>` (two-level); `confluence_attachments` becomes `Record<instanceId, Record<pageId, Record<filename>, { hash, id }>>>`. The instanceId layer exists because Confluence pageIds are local to a Server/DC installation — two instances can have the same pageId, and a single-level key would let engine A's stamp vouch for engine B's target. Pre-multi-instance flat shapes (`confluence_last_hash: "H"` string, `confluence_attachments: { filename: rec }`) are migrated on plugin load by `migrateLegacyFrontmatter` (one-time; idempotent).
- **Settings UI:** Add / reorder / remove buttons per instance card, in-place duplicate-name / duplicate-baseUrl warnings, instance dropdown on the `Create bound note` command (shown only when more than one instance is configured, validates the entered URL belongs to the chosen instance).
- **Debug helpers:** `tests/e2e/scripts/verify-lastHash.ts` and `verify-urlMatch.ts` exercise the per-instance shape and the longest-prefix routing respectively.
- **Configurable image display width.** Regular local images now sync with a default Confluence display width of 192px, configurable under *Attachments → Default image display width*. Set it to `0` to keep the original size. The source attachment is still uploaded unchanged, and diagram images keep their natural dimensions.
- **[issue #4 follow-up] Heading anchor links.** Same-page `[[#Heading]]` / `[text](#heading)` and cross-page `[[Note#Heading]]` / `[text](note.md#heading)` links now become native Confluence `ac:link` anchors. Previously the converter deliberately stripped the heading fragment, leaving same-page links as plain text and cross-page links pointing only to the page.

#### Changed

- **`stripSupplementaryChars` moved from top-level setting to per-instance.** Previously a single global flag (default off) controlling whether emoji and supplementary characters are replaced with `[U+XXXX]` placeholders for legacy Confluence Server on 3-byte MySQL utf8 (added upstream in 0.3.7 to fix issue #5). Now lives on `ConfluenceInstance.stripSupplementaryChars` because users with a mixed fleet (legacy Server + Cloud) need different per-server behavior — enable only on the Server card whose MySQL still uses 3-byte utf8, leave off for Cloud and utf8mb4 Server so emoji sync natively. The toggle is per-instance in the settings card, after the Validate button. The salt logic in `computeContentHash` (also from 0.3.7) carries over unchanged.
- **Legacy migration:** `migrateLegacySettings` (run on the marker mismatch between saved `legacyMigrationVersion` and `LEGACY_MIGRATION_VERSION`) now also reads the legacy top-level `stripSupplementaryChars` field when present and copies the value onto the synthesized "Default" instance, so a user who had the toggle on under 0.3.7 keeps the same behavior on their primary Server after upgrade. Already-migrated instances without legacy fields are left untouched.
- **`confluence_username` is now a per-instance map.** Pre-multi-instance, person-note frontmatter had `confluence_username: john.doe` (a flat string) — used by the `@[[Name]]` mention resolver to look up the Confluence username for the current instance. With multiple instances the same person can have different usernames on different installations (e.g. SSO vs. legacy domain account), so the value is now keyed by `ConfluenceInstance.id`: `confluence_username: { default: john.doe, inst-abc123: j.doe }`. Each `SyncEngine` reads only its own `instance.id` slice; missing slice → resolver returns null → mention degrades to plain `@Name` on that instance only. A new `migrateLegacyUsernames` runs inside the same gated migration block as `migrateLegacySettings` / `migrateLegacyFrontmatter` (firing once when `legacyMigrationVersion !== LEGACY_MIGRATION_VERSION`) and converts every flat-string `confluence_username` field across the vault to the per-instance map under the first configured instance's id (falling back to the literal `'default'` when no instances exist yet). The migration is idempotent and only rewrites notes still in the legacy string form; already-migrated notes are untouched. Cloud mentions remain unsupported (still requires `ri:account-id`).

### 中文

#### 新增

- **多实例 Confluence 支持**:单个 vault 最多可配 10 个 Confluence 实例。每个实例独立卡片(在 **设置 → Confluence 认证** 下),含独立的名称 / base URL / 认证方式 / 账号 / token。token 存在 Obsidian 密钥库(密钥库需 Obsidian 1.11.4+,老版本回退到明文 + 派生 key `sync-confluence-token-<instanceId>`)。原设置里的顶层字段(`confluenceBaseUrl` / `authType` / `username` / `apiToken`)全部移除,只留 `instances: ConfluenceInstance[]`。
- **最长前缀 URL 路由(`InstanceResolver`)**:扫描每个笔记的全部 `confluence_url` / `confluence_parent_url` target(scalar / CSV / 数组),每个 URL 与每个配置的实例 `baseUrl` 做最长前缀匹配(带 host boundary 防护)。一个笔记可落到多个实例组,只要它的 target 跨实例。每组走各自的 `SyncEngine`,engine 只同步 URL 前缀命中自己 `instanceBaseUrl` 的 target。属于别的实例的 target 标 `foreign: true`、不计入本 engine 失败数,以保住 hash-skip 不变(一个实例挂掉时另一个实例的笔记不会被反复重推)。所有 URL 都不命中任何实例时,文件在同步摘要里显示为 `Unmatched`。
- **Frontmatter 改为 per-instance 去重形态**:`confluence_last_hash` 变成 `Record<instanceId, Record<pageId, string>>`(两层);`confluence_attachments` 变成 `Record<instanceId, Record<pageId, Record<filename>, { hash, id }>>>`。instanceId 这一层必须存在,因为 Confluence pageId 在每个 Server/DC 站点是局部的——两个实例可能 pageId 相同,单层 key 会让 A 实例的戳给 B 实例的目标做了证明。每个 engine 只写自己的 slice delta,`writeBinding` 的原子合并(在 plugin 互斥锁下)保留其他实例的 slice 不动。
- **设置 UI**:每张实例卡片含 add / reorder / remove、in-place 重名 / 重 URL 警告;`Create bound note` 命令在多于 1 实例时显示实例下拉并校验输入 URL 命中该实例的 base URL。
- **调试工具**:`tests/e2e/scripts/verify-lastHash.ts` 与 `verify-urlMatch.ts` 分别验证 per-instance 形态与最长前缀路由。
- **图片显示宽度可配置**:普通本地图片同步到 Confluence 后默认显示为 192px,可在 *附件 → 图片默认显示宽度* 中修改;填 `0` 保持原始大小。上传的源附件不会被压缩,Mermaid / PlantUML 图表仍保持自然尺寸。
- **[issue #4 补全] 标题锚点链接**:同页 `[[#标题]]` / `[文本](#标题)` 和跨页 `[[笔记#标题]]` / `[文本](note.md#标题)` 现在会生成 Confluence 原生 `ac:link` 锚点。此前转换器会主动剥掉标题片段,导致同页锚点退化为纯文本、跨页链接只能跳到页面顶部。

#### 变更

- **`stripSupplementaryChars` 从顶层设置迁到每实例**。原来这是一个全局开关(默认关),控制是否把 emoji 和增补字符替换为 `[U+XXXX]` 占位符,以兼容老 Confluence Server(3 字节 MySQL utf8,issue #5;上游 0.3.7 引入)。现在挪到 `ConfluenceInstance.stripSupplementaryChars`,因为同一 vault 内可能有混部需求(Server 老 MySQL + Cloud utf8mb4),需要每个实例独立配置:只有 MySQL 仍跑 3 字节 utf8 的那张 Server 卡片才打开,Cloud 和 utf8mb4 Server 保持关闭,emoji 原样同步。UI 上开关移到每实例卡片里 Validate 按钮下方。`computeContentHash` 里的加盐逻辑(同样来自 0.3.7)原样保留。
- **兼容迁移**:`migrateLegacySettings`(在保存的 `legacyMigrationVersion` 与 `LEGACY_MIGRATION_VERSION` 不一致时触发,且幂等)现在还会读取遗留的顶层 `stripSupplementaryChars`,如果存在就复制到合成的 "Default" 实例上。这样在 0.3.7 时打开过这个开关的用户升上来后,主 Server 的行为不变。已经迁移过、没有遗留字段的实例不会被改动。
- **`confluence_username` 改为 per-instance map**。多实例之前,人员笔记 frontmatter 是 `confluence_username: zhangsan`(扁平字符串)——给 `@[[姓名]]` mention 解析用。配置多实例后,同一个人在不同 Confluence 上可能有不同 username(如 SSO 账号 vs 老域账号),所以现在值改为以 `ConfluenceInstance.id` 为键的 map:`confluence_username: { default: zhangsan, inst-abc123: zhang.s }`。每个 `SyncEngine` 只读自己 `instance.id` 对应的 slice;当前实例没有 slice → resolver 返回 null → mention 在该实例上降级为纯文本 `@姓名`。新增 `migrateLegacyUsernames`,在跟 `migrateLegacySettings` / `migrateLegacyFrontmatter` 同一个 gated block 里跑(当 `legacyMigrationVersion !== LEGACY_MIGRATION_VERSION` 时触发一次),扫描全 vault 把扁平字符串形式的 `confluence_username` 一次性迁到 per-instance map,落到第一个已配实例的 id 上(没有任何实例时退回到字面量 `'default'`)。迁移幂等,只重写仍是字符串的笔记;已经迁好的笔记不会被改动。Cloud mention 仍不支持(需要 `ri:account-id`)。

---

## [0.3.7] — 2026-07-24

### English

#### Fixed

- **Emoji and other supplementary-character sync on legacy Confluence Server (issue #5).** `stripSupplementaryChars` was previously applied unconditionally at the end of `postProcessHtml`, replacing every codePoint > 0xFFFF (all emoji and most modern scripts) with `[U+XXXX]` placeholders — regardless of the target server's charset. The flag only existed to protect legacy Confluence Server installs on 3-byte MySQL utf8 from `400 Unsupported character found in content`, but the unconditional behavior punished every Cloud and modern utf8mb4 Server user by silently dropping their emoji. New **Legacy server compatibility: replace emoji with [U+XXXX]** toggle (default off) in the auth section. Leave off for Cloud and utf8mb4 Server — emoji syncs natively. Enable only on Confluence Server whose MySQL still uses 3-byte utf8.
- **Content-hash dedup respects toggle-off transitions.** When `stripSupplementaryChars` is off and a note contains supplementary characters, `computeContentHash` salts the hash so a page previously synced with `[U+XXXX]` placeholders re-pushes once with the real emoji after the toggle is flipped from on to off, instead of being skipped forever by hash dedup. Hashes of plain-ASCII notes, and all hashes while the toggle is on, stay identical to the pre-0.3.7 scheme — forward-compatible.

### 中文

#### 修复

- **老 Confluence Server 上的 emoji 与增补字符同步 (issue #5)**。原 `stripSupplementaryChars` 在 `postProcessHtml` 末尾被无条件启用,把任何 codePoint > 0xFFFF 的字符(全部 emoji 与大多数现代文字)替换为 `[U+XXXX]` 占位符——而不论目标服务器字符集。这个开关原本只是为了保护老 Confluence Server(3 字节 MySQL utf8)避开 `400 Unsupported character found in content` 错误而存在的;但无条件启用也让 Cloud 与所有现代 utf8mb4 Server 用户的 emoji 被静默吞掉。现改为认证区域下显式的 **老 Server 兼容:emoji 替换为 [U+XXXX]** 开关(默认关)。Cloud 与 utf8mb4 Server 请保持关闭,emoji 原样同步;仅当你的 Confluence Server MySQL 仍是 3 字节 utf8 时打开。
- **关掉占位开关后内容哈希去重会重推一次**:`stripSupplementaryChars = false` 且笔记含增补字符时,`computeContentHash` 对 hash 加盐;之前用占位符同步过的页面,在开关从开切到关后会重新推送一次真实 emoji,不再因 hash 命中被永久跳过。纯 ASCII 笔记的 hash,以及开关开着时的所有 hash,都与 0.3.7 之前完全一致——本次改动 forward-compatible。

---

## [0.3.6] — 2026-07-07

### English

#### Fixed

- **Property-row action buttons layout.** Icons moved from the property *key* cell to the *value* cell's right edge (`margin-left: auto`). The old placement squeezed long keys like `confluence_url` into `conflue...` and made the icons look orphaned between the key and value. Now the key stays fully readable and the icons sit at the row's right edge, consistent regardless of value length.
- **Property-row buttons disappearing when cursor enters the note.** Obsidian rebuilds the property row's inner DOM whenever it flips into edit mode, and the old code disconnected its `MutationObserver` after 3 seconds — so the buttons never got re-injected. `MutationObserver` is now persistent (still scoped to the active view) and coalesces high-frequency mutations through `requestAnimationFrame`, so keystrokes in the note body don't churn.
- **`confluence_url` array corrupted into CSV string on multi-target sync.** When frontmatter had `confluence_url` as a single scalar URL but the engine later needed to write N targets (e.g. after a multi-target parent sync), `serializeValues` fell into the CSV branch and produced `"url1, url2"` as one string — Obsidian then rendered it as a single `<a>` with only one open-icon, breaking multi-URL UX. Fix in `handler.ts`: scalar-format + multiple values now upgrades to a proper YAML list so Obsidian recognizes the field as a URL list and renders each URL as its own pill.
- **Obsidian store audit findings.** `mermaidRenderer.ts` now uses `setCssStyles` instead of raw `style.cssText`; `propertyActions.ts` uses `activeDocument` instead of `document` for popout-window compatibility.

#### Changed

- **Removed the row-end "open" icon.** Each URL pill already carries Obsidian's built-in `⤴` open button. The row-end `🌐` was redundant; only the `☁️` sync-note icon remains at the row's right edge.

### 中文

#### 修复

- **属性行按钮位置**:按钮从属性 *key* 那格挪到 *value* 那格的右边缘(用 `margin-left: auto` 推到最右)。原来的位置会把 `confluence_url` 挤成 `conflue...`,按钮夹在 key 和 value 之间视觉像孤儿。改后 key 完整可读,按钮固定在行右边缘,不随 value 长度浮动。
- **光标进入笔记后按钮消失**:Obsidian 属性行进入编辑态会重建行内 DOM,而原来的 `MutationObserver` 挂 3 秒就 disconnect,后续 DOM 重建不再响应。改成 observer 常驻观察 active view + `requestAnimationFrame` 合并高频 mutation,编辑正文时不会因 keystroke 频繁触发 tryInject。
- **多目标同步时 `confluence_url` 被拼成 CSV 字符串**:frontmatter 里 `confluence_url` 是单值 scalar 时,同步引擎需要写入多个 target(比如多父页同步后)会走进 `serializeValues` 的 CSV 分支,输出 `"url1, url2"` 一坨字符串。Obsidian 属性面板把它识别成单个 URL,只渲染一个 `<a>` + 一个打开图标,多目标 UI 崩坏。修复:`handler.ts` 里 scalar 遇多值升 YAML list,Obsidian 自动识别为 URL 列表,每个 URL 独立 pill。
- **Obsidian 商店审核发现的问题**:`mermaidRenderer.ts` 改用 `setCssStyles` 而非直接 `style.cssText`;`propertyActions.ts` 改用 `activeDocument` 替代 `document`(popout 窗口兼容)。

#### 变更

- **移除属性行末的"打开"图标**:每个 URL pill 自带 Obsidian 原生的 `⤴` 打开按钮,行末的 `🌐` 完全冗余,已删除;行末只保留 `☁️` 同步整篇笔记的图标。

---

## [0.3.5] — 2026-07-07

### English

#### Added

- **[issue #2] Property-row action buttons.** When a note has a `confluence_url` property, two icons appear next to the property key in the properties panel: *Sync to Confluence* and *Open in Confluence* (multi-target bindings pop a picker menu). Implemented with the Share-Note-style `MutationObserver` injection pattern. Deliberately no one-click "unbind" button — destructive actions don't belong one click away in the properties panel.
- **[issue #3] User mentions via `@[[Name]]` (Server / DC only).** The plugin resolves the linked note and reads `confluence_username` from its frontmatter; present → the mention becomes a real `<ac:link><ri:user>` user link (Confluence normalizes it to `ri:userkey` server-side), absent → degrades to plain `@Name` text. Mentions inside code blocks stay literal. No Confluence user-API lookups during sync by design — scheduled/batch syncs must not block on network searches or interactive pickers. Cloud (`ri:account-id`) not supported yet.

### 中文

#### 新增

- **[issue #2] 属性行操作按钮**:笔记有 `confluence_url` 属性时,属性面板该行旁注入两个图标——*同步到 Confluence* 和 *在 Confluence 中打开*(多目标绑定弹菜单选择)。采用 Share Note 同款 `MutationObserver` 注入模式。有意不做一键"解绑":破坏性操作不该在属性面板一击可达。
- **[issue #3] `@[[Name]]` 用户 mention(仅 Server / DC)**:插件解析被链接的笔记并读取其 frontmatter 的 `confluence_username`;有值 → 替换为真实的 `<ac:link><ri:user>` 用户链接(Confluence 服务端会归一为 `ri:userkey`),无值 → 降级为纯文本 `@Name`。代码块内的 mention 原样保留。同步过程设计上不调用 Confluence 用户搜索 API——定时/批量同步不能被网络查询或交互弹窗阻塞。Cloud(`ri:account-id`)暂不支持。

---

## [0.3.4] — 2026-07-03

> **Upgrade note / 升级提示** — `confluence_attachments` 的存储形态从平铺 (`filename → record`) 改为嵌套 (`pageId → filename → record`) 以支持多目标。读取时自动迁移老形态,数据不会丢;但**升级后首次同步会在 frontmatter 里多一层缩进**,YAML diff 一次性出现属正常。 / The `confluence_attachments` shape changed from flat to nested (`pageId → filename → record`) to support multi-target. The reader auto-migrates the old shape on first read — no data loss — but expect a one-time YAML diff on your first sync after upgrading.

### English

#### Fixed

- **[issue #1]** Image embeds with **spaces in the filename** (e.g., Obsidian's auto-generated `Pasted image YYYYMMDDHHMMSS.png`) were leaking into Confluence as raw Markdown text instead of `<ac:image>`. Root cause: `preprocessObsidianSyntax` rewrote `![[file with space.png]]` → `![alt](file with space.png)` without URL-encoding the path, so markdown-it couldn't parse it and the attachment collector's regex didn't match. Fix: `encodeURI()` the path on rewrite. Regression test added in `tests/e2e/fixtures/mermaid-coverage.md` §20.
- **[issue #1, related]** Notes with **CRLF line endings** (Windows vaults, files produced by external tools) had every Mermaid / PlantUML fence fall back to a raw code block even though the attachment uploaded fine. Root cause: markdown-it normalizes `\r\n` → `\n` before tokenizing, but `extractFenceBlocks` split on `\n` only, leaving a trailing `\r` on every line — so the fence-content hash never matched the render-side lookup. Fix: apply the same newline normalization at the top of `extractFenceBlocks`. Regression test in `tests/e2e/fixtures/mermaid-coverage.md` §26.
- **[issue #1, related]** Mermaid / PlantUML fenced blocks were silently falling back to raw code blocks (despite the attachment being uploaded) in any of these scenarios: **fence inside a list item with 4-space or tab indent**, **fence with lang attribute** (`` ```plantuml id=foo ``), or **fence inside a blockquote** (`` > ```plantuml ``). Root cause: `extractFenceBlocks` used a regex that didn't recognize `>` blockquote prefixes, only stripped indent matching exact space/tab, and refused fence info lines with non-whitespace after the lang word — so the content hash diverged from what markdown-it computed at render time, and the renderer fell through to `renderAcCode`. Fix: extend the fence regex to accept `[\s>]*` container prefix, strip up to `indent` leading container chars (space/tab/`>`) from each content line, accept attribute info after lang, and have the fence renderer extract only the first whitespace-separated token from `token.info` as the lang. Regression tests added in `tests/e2e/fixtures/mermaid-coverage.md` §22-25.

#### Added

- **Mermaid renderer choice.** New setting *Diagrams → Renderer* lets you pick between the existing **Kroki remote service (PNG)** and the new **Obsidian built-in engine (SVG)**. The Obsidian engine renders mermaid in-process via `MarkdownRenderer`, so the output is pixel-identical to the editor preview, needs no network, and lets time-axis diagrams (gantt / timeline) scale to content width instead of being squashed into kroki's fixed ~584px canvas. Trade-off: SVG output — older Confluence Server (≤5.x) may not render it inline. UI shows ✓Pros / ✗Cons for each engine.
- **Multi-target sync.** A single note can now sync to several Confluence pages at once. `confluence_url`, `confluence_parent_url`, and `confluence_page_id` all accept multiple values via scalar, comma-separated, or YAML array forms. Per-target success / failure is tracked independently — one target failing no longer aborts the rest, and the `confluence_attachments` map is keyed by `pageId` so attachment IDs from different targets don't collide.
- **Two-pass batch sync.** When running *Sync all* / *Sync folder*, the engine first pre-creates placeholder pages for every note that has only a `confluence_parent_url`, then runs the real sync. This means `[[wikilink]]`-style cross-note references inside the batch resolve to the peer's freshly minted Confluence URL on first sync — no more "sync twice to fix the links."
- **Wikilink → Confluence URL rewriting.** `[[other-note]]` (and standard `[text](note.md)` links) inside the body now resolve through Obsidian's metadata cache and, if the target note has a `confluence_url` bound, become a hyperlink to that Confluence page. Falls back to plain text when no binding exists.
- **Frontmatter format preservation.** The binding reader now remembers whether `confluence_url` (and friends) were written as scalar, CSV, or YAML array; the writer round-trips in the same style, so your YAML doesn't churn between commits.
- **End-to-end test suite (`tests/e2e/`).** Fully automated via the Obsidian CLI: builds the plugin, hot-reloads it into a target vault, switches renderer modes through `obsidian eval`, syncs a 19-block mermaid coverage fixture (16 chart types + Chinese / emoji / dedup / broken-syntax edge cases), then verifies each Confluence attachment by REST. See `tests/e2e/README.md`.
- **`CHANGELOG.md`** (this file).

#### Changed

- Mermaid diagram filenames now use the renderer's native extension (`.svg` for Obsidian engine, `.png` for kroki), so attachment MIME detection works without per-renderer overrides.
- Settings panel reflows: the kroki URL field is hidden when the Obsidian engine is selected, since it's unused.
- README — *Diagram rendering* section rewritten to describe both engines and their trade-offs; troubleshooting entry added for the gantt / timeline label-collision case.

#### Internal

- `MermaidRenderer` class split into `IMermaidRenderer` interface + two implementations (`KrokiMermaidRenderer`, `ObsidianMermaidRenderer`). Existing call sites updated.
- `NoteBinding` reshaped from a single-target structure (`url`, `pageId`, `parentUrl` on the root) to `{ targets: SyncTarget[] }`. All readers / writers / sync flow updated; `_formats` (in-memory only) records the original frontmatter style for round-tripping.
- `MarkdownConverter.extractReferences` now accepts `{ mermaidExt, plantUmlExt }` so the converter can produce the right `<ac:image>` filename per renderer.
- `MarkdownConverter.convert` now receives the source path (was `_sourcePath`) and threads a `resolveWikilink` callback through `preprocessObsidianSyntax`.

### 中文

#### 修复

- **[issue #1]** 文件名**含空格**的图片(如 Obsidian 自动生成的 `Pasted image YYYYMMDDHHMMSS.png`)同步到 Confluence 后显示为原始 markdown 文本而不是 `<ac:image>`。根因:`preprocessObsidianSyntax` 把 `![[文件 名.png]]` 重写成 `![alt](文件 名.png)` 时没对路径做 URL 编码,markdown-it 解析失败,附件收集 regex 也匹配不上。修法:重写时对路径调 `encodeURI()`。回归测试用例:`tests/e2e/fixtures/mermaid-coverage.md` §20。
- **[issue #1, 关联]** **CRLF 行尾**的笔记(Windows vault / 外部工具生成的文件)所有 Mermaid / PlantUML fence 都退化为代码块,尽管附件本身上传成功。根因:markdown-it 在 tokenize 前把 `\r\n` 归一成 `\n`,而 `extractFenceBlocks` 只按 `\n` split,每行末尾残留 `\r` → fence 内容 hash 与渲染侧查表永远对不上。修法:`extractFenceBlocks` 入口做同样的换行归一。回归测试:`tests/e2e/fixtures/mermaid-coverage.md` §26。
- **[issue #1, 关联]** Mermaid / PlantUML 代码块在以下场景下,**附件已上传但 storage 里仍显示为代码块**:列表项里 4 空格缩进 / tab 缩进的 fence、lang 行带 attribute(``` ```plantuml id=foo``` )、`> ` blockquote 包裹的 fence。根因:`extractFenceBlocks` 的 regex 不识别 `>` 前缀、剥缩进时只剥精确匹配的空格 / tab、lang 行后面有非空白字符整段就 match 失败 → 拿到的 content hash 跟 markdown-it 渲染时算出的不一致 → renderer 查不到 → fallback 到 code 块。修法:fence 行 regex 接受 `[\s>]*` 容器前缀,内容行按 `indent` 字符剥前导容器字符(空格/tab/`>`),lang 后允许 attribute 信息,fence renderer 用 `token.info` 的第一个 token 作为 lang。回归测试用例:§22-25。

#### 新增

- **Mermaid 渲染方式可选**:新增 *图表渲染 → 渲染方式* 设置,在原有的 **Kroki 远端服务(PNG)** 和新增的 **Obsidian 内置引擎(SVG)** 之间二选一。Obsidian 引擎通过 `MarkdownRenderer` 在插件进程内直接渲染,产出跟笔记预览像素级一致、无需联网,且时间轴类图表(gantt / timeline)宽度按内容自然撑开,不再被压进 kroki 固定的 ~584px 画布。代价:产物是 SVG,老版 Confluence Server(≤5.x)可能不 inline 显示。设置页对每个引擎给出 ✓优 / ✗劣 提示。
- **多目标同步**:一篇笔记可同时同步到多个 Confluence 页面。`confluence_url` / `confluence_parent_url` / `confluence_page_id` 支持标量、逗号分隔、YAML 数组三种形式。每个目标的成功 / 失败独立跟踪——单个目标失败不再中断其它目标;`confluence_attachments` 按 `pageId` 分桶存储,不同目标的附件 ID 不串扰。
- **批次同步两阶段化**:跑 *同步全部* / *同步文件夹* 时,先给所有仅有 `confluence_parent_url` 的笔记预创建占位子页,再进入正式同步。这样 `[[wikilink]]` 形式的跨笔记引用在首次同步就能解析到对方刚生成的 Confluence URL——不再需要"同步两次才能修好链接"。
- **Wikilink → Confluence URL 重写**:正文里的 `[[other-note]]`(以及标准 `[text](note.md)` 链接)会经 Obsidian metadata cache 解析;目标笔记若已绑定 `confluence_url`,链接就会被替换为指向那个 Confluence 页面的超链接。没绑定则降级为纯文本。
- **Frontmatter 格式回环保留**:读 binding 时记下 `confluence_url` 等字段原来是写成标量、CSV 还是 YAML 数组;回写时按原风格输出,YAML 不会在两次 commit 之间反复抖动。
- **端到端测试套件(`tests/e2e/`)**:基于 Obsidian CLI 全自动运行 —— 构建插件 → 热重载到目标 vault → 通过 `obsidian eval` 切换渲染器 → 同步 19 块 mermaid 覆盖 fixture(16 类图表 + 中文 / emoji / 去重 / 语法错边界)→ 通过 REST 校验每张 Confluence 附件。详见 `tests/e2e/README.md`。
- **`CHANGELOG.md`**(本文件)。

#### 变更

- Mermaid 图表附件文件名按当前渲染器的原生格式扩展(Obsidian 引擎用 `.svg`,kroki 用 `.png`),MIME 识别走文件名,无需按渲染器额外分支。
- 设置面板重排:选 Obsidian 引擎时隐藏 kroki URL 字段,因为该字段此时不使用。
- README —— *图表渲染* 章节重写,描述两个引擎的取舍;故障排查段新增 gantt / timeline 日期挤压问题对应的解决路径。

#### 内部

- `MermaidRenderer` 类拆为 `IMermaidRenderer` 接口 + 两个实现(`KrokiMermaidRenderer` / `ObsidianMermaidRenderer`),调用方相应改用接口。
- `NoteBinding` 从单目标(根上的 `url` / `pageId` / `parentUrl`)重构为 `{ targets: SyncTarget[] }`。所有读 / 写 / 同步流程相应改造;`_formats`(仅运行时)记录原 frontmatter 形态用于回写。
- `MarkdownConverter.extractReferences` 新增 `{ mermaidExt, plantUmlExt }` 入参,让 converter 按渲染器生成正确的 `<ac:image>` 文件名。
- `MarkdownConverter.convert` 改为接收 `sourcePath`(原 `_sourcePath`),并通过 `preprocessObsidianSyntax` 把 `resolveWikilink` 回调透传下去。

---

## [0.3.3] — 2026-06-07

- **EN**: Community-plugin reviewer warning cleanup.
- **中文**:处理 Obsidian 社区插件审核员的告警。

## [0.3.2] — 2026-06-07

- **EN**: `manifest.minAppVersion` bumped to 1.4.4 (required for `processFrontMatter`).
- **中文**:`manifest.minAppVersion` 升到 1.4.4(`processFrontMatter` 需要)。

## [0.3.1] — 2026-06-05

- **EN**: Fix 4 attachment & callout regressions in the markdown converter.
- **中文**:修复 markdown 转换器里 4 个附件 / callout 的回归缺陷。

## [0.3.0] — 2026-06-02

- **EN**: Bilingual UI (English / 简体中文) and onboarding-focused README.
- **中文**:UI 双语化(英文 / 简体中文),README 改为面向新用户的入门视角。

## [0.2.0]

- **EN**: Initial community-plugin compliance release.
- **中文**:首版符合 Obsidian 社区插件规范的发布。
