# Changelog · 更新日志

All notable changes to this project will be documented in this file.
本文件记录本项目所有值得关注的变更。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

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
