<div align="center">

# ☁️ Sync Confluence

<p>
  <a href="#english">English</a> |
  <a href="#中文">简体中文</a>
</p>

<p>
  <a href="https://github.com/dzplus/obsidian-sync-confluence/releases/latest"><img src="https://img.shields.io/github/v/release/dzplus/obsidian-sync-confluence?label=release&color=%235d6b98" alt="Release"></a>
  <img src="https://img.shields.io/badge/Obsidian-%E2%89%A51.4.0-7c3aed" alt="Obsidian">
  <img src="https://img.shields.io/badge/platform-desktop-blue" alt="Desktop">
  <img src="https://img.shields.io/badge/license-0BSD-green" alt="License">
  <a href="https://github.com/dzplus/obsidian-sync-confluence/issues"><img src="https://img.shields.io/github/issues/dzplus/obsidian-sync-confluence?color=%23f59e0b" alt="Issues"></a>
</p>

<p><em>Push Obsidian notes to Confluence on a schedule — one frontmatter field, zero mapping files.</em></p>

</div>

---

<a id="english"></a>

## 💡 Why Sync Confluence

- **Frontmatter-driven binding** — drop a Confluence page URL into your note's frontmatter, that's the entire wiring.
- **Multi-instance** — connect up to 10 Confluence instances per vault; notes are routed by longest-prefix URL matching and multi-target notes can span instances.
- **Cloud + Server / Data Center** — Basic auth (email + API token) for Atlassian Cloud, Bearer (Personal Access Token) for Server 7.9+ / DC.
- **Content-hash skip** — unchanged notes are not re-pushed; bandwidth and audit log stay clean.
- **Local attachments auto-upload** — `![[image.png]]` embeds become Confluence attachments; regular images display at a configurable width (192px by default) without resizing the uploaded source.
- **Auto-create child pages** — set `confluence_parent_url` and the first sync creates the page, then writes the URL back.
- **Mermaid / PlantUML pre-render** — diagrams are rendered to an image attachment before sync. Mermaid offers two engines: a kroki HTTP service (PNG, max compatibility) or the in-process Obsidian engine (SVG, pixel-identical to your preview).
- **Many triggers** — ribbon icon, command palette, editor / file-tree right-click, scheduled timer.
- **Bilingual UI** — automatically follows Obsidian's language (English / 简体中文).

## 📦 Install

> [!TIP]
> The plugin is published in the Obsidian community plugin browser. The community-plugin path is the fastest.

**From the community plugin browser**

1. Open **Settings → Community plugins**.
2. Click **Browse**, search **`Sync Confluence`**.
3. **Install** → **Enable**.

**From a GitHub release (manual)**

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/dzplus/obsidian-sync-confluence/releases/latest).
2. Drop them into `<vault>/.obsidian/plugins/sync-confluence/`.
3. Reload Obsidian → enable in **Settings → Community plugins**.

**Via BRAT (for beta tracking)**

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community store.
2. **BRAT settings → Add Beta plugin** → enter `dzplus/obsidian-sync-confluence`.

## 🚀 Quick Start

**1. Get a token from Confluence**

| You're on… | Get this | Where |
|---|---|---|
| **Atlassian Cloud** | API token | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| **Server / Data Center 7.9+** | Personal Access Token | Confluence → Profile picture → **Settings → Personal Access Tokens** |
| **Server (legacy)** | Your login password | (same as your domain login) |

**2. Store the token in Obsidian's secret vault** (Obsidian 1.11.4+)

`Settings → Key vault → Create new secret` → paste the token → name it (e.g. `confluence-token`).

**3. Plug it into the plugin**

`Settings → Sync Confluence → Confluence authentication`:

- **Base URL** — Cloud: `https://xxx.atlassian.net/wiki`. Server/DC: `https://confluence.your-corp.com` (usually no `/wiki`).
- **Authentication type** — Cloud + Server-legacy → **Basic**. Server-PAT → **Bearer**.
- **Account** (Basic only) — Cloud: your Atlassian email. Server: your domain account.
- **Password / API token** — pick the secret you just created.
- Click **Validate credentials**. You should see your display name.

**4. Bind a note**

Open any note and add to its frontmatter:

```yaml
---
confluence_url: https://xxx.atlassian.net/wiki/spaces/XXX/pages/12345/Title
---
```

Or use the command palette: **`Insert Confluence frontmatter into current note`** — the plugin will stub the fields for you.

**5. Sync**

Any of these works:
- Click the ☁ ribbon icon (syncs all bound notes).
- Run command: **`Sync current note`** / **`Sync all notes`**.
- Right-click the note (or a folder in the file tree) → **`Sync to Confluence`**.
- Let the timer fire (default: every 30 min — change in **Sync schedule**).

The status-bar pill shows the last result: `☁ Idle` / `☁ Syncing` / `☁ Synced` / `☁ Failed`.

## 🏢 Multi-instance Confluence

If you juggle notes across multiple Confluence servers (e.g. a personal Cloud workspace plus a corporate Server), wire them all up in one vault.

**Add an instance**

1. **Settings → Sync Confluence → Confluence authentication → Add Confluence Instance**.
2. Fill the card:
   - **Instance name** — a unique display name (`Personal`, `Acme`, …).
   - **Base URL** — e.g. `https://xxx.atlassian.net/wiki` (Cloud) or `https://confluence.acme.com` (Server).
   - **Authentication type** + **account** + **token** (Obsidian's secret vault).
3. Click **Validate credentials** to confirm.

**Routing**

For every note the plugin looks at every URL across `confluence_url` / `confluence_parent_url` (CSV and array forms included) and picks the instance whose `baseUrl` is the **longest matching prefix**. A note can land in several instances if its targets span them — each instance's engine syncs only the targets that belong to it.

> Up to **10 instances** per vault. If a note's URLs don't match any configured base URL, it's surfaced as `Unmatched` in the sync summary and skipped.

**Creating a bound note**

`Create bound note` shows the instance dropdown only when more than one instance is configured, and validates that the entered URL starts with the chosen instance's base URL.

**Mentions are per-instance too.** `@[[John Doe]]` resolves against `confluence_username.<instanceId>` (see [Links & mentions](#-links--mentions)) — if the same person has different usernames on different instances, list each one under its instance id. A person note without a slice for the current instance degrades to plain `@John Doe` on that instance only.

## 📝 Frontmatter cheatsheet

**Existing page — bind by URL**

```yaml
---
confluence_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page
---
```

**New page — let the plugin create it under a parent**

```yaml
---
confluence_parent_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent
confluence_url:
---
```

On the first sync the plugin creates the child page (titled after the note's filename) and writes the new URL back into `confluence_url`. Subsequent syncs hit that URL directly.

**Multi-parent example — create or update copies under multiple parents**

```yaml
---
confluence_parent_url:
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent-A
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/200/Parent-B
confluence_url:
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page
  - ""
confluence_page_id:
  - "12345"
  - ""
---
```

**CSV-format multi-parent example**

```yaml
---
confluence_parent_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent-A, https://xxx.atlassian.net/wiki/spaces/DOC/pages/200/Parent-B
confluence_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page, ""
confluence_page_id: 12345, ""
---
```

**Fields written back by the plugin** — leave these blank, they're maintained automatically:

- `confluence_page_id` — resolved page ID.
- `confluence_last_synced` — ISO timestamp of the last successful push.
- `confluence_last_hash` — content hash; equal hash = sync is a no-op.
- `confluence_attachments` — page ID → filename → `{hash, id}` cache, used to skip re-uploading unchanged attachments.

## 🔗 Links & mentions

**Wikilinks.** `[[Other Note]]` / `[[Other Note|alias]]` (and standard `[text](note.md)` links) are resolved through Obsidian's metadata cache. If the target note has a `confluence_url` binding, the link becomes a hyperlink to that Confluence page; otherwise it degrades to plain text. Batch syncs pre-create placeholder pages for parent-only notes first, so cross-references inside the same batch resolve on the first sync.

**Heading anchors.** Same-page `[[#Heading]]` / `[text](#heading)` and cross-page `[[Other Note#Heading]]` / `[text](note.md#heading)` links are converted to native Confluence heading anchors. Heading matching is case-sensitive, following Confluence behavior.

**User mentions (Server / DC only).** Write `@[[John Doe]]` to mention a Confluence user. The plugin looks up the linked note (`John Doe.md`) and reads `confluence_username` from its frontmatter. With multiple instances configured the value is a per-instance map keyed by `ConfluenceInstance.id`; each engine reads only its own slice:
>>>>>>> c43576a (feat: per-instance identity for @[[Name]] user mentions)

```yaml
---
confluence_username:
  default: john.d          # ConfluenceInstance.id → Confluence username
  inst-abc123: j.doe       # another instance may have a different username
---
```

If the entry for the current instance is present the mention becomes a real Confluence user link (notification + profile link); if the note, the field, or the slice for the current instance is missing it degrades to plain `@John Doe` text. Mentions inside code blocks are left untouched. The plugin never queries the Confluence user API during sync — maintain the username once per person note and it works offline from then on. Cloud is not supported yet (Cloud storage format requires `ri:account-id`).

## 🎨 Diagram rendering (optional)

| Source | Plugin behavior |
|---|---|
| ```mermaid``` block | On by default. Renders to an image attachment using one of two engines (see below). |
| ```plantuml``` block | Off by default; on → renders via a PlantUML server, uploads PNG. |

### Mermaid engine

Pick one in **Settings → Diagrams → Renderer**:

| Engine | Output | Best for |
|---|---|---|
| **Kroki remote service** (default) | PNG via `https://kroki.io/mermaid/png` (or self-hosted) | Maximum compatibility — works on every Confluence version, full CJK / emoji font coverage. Trade-off: time-axis diagrams (gantt / timeline) render at a cramped width and date labels overlap. |
| **Obsidian built-in engine** | SVG rendered locally with Obsidian's mermaid runtime | Pixel-identical to your editor preview, no network needed, time-axis diagrams scale to content width. Trade-off: SVG output — older Confluence Server (≤5.x) may not render it inline; fonts follow your Obsidian theme. |

For corporate networks using kroki, point **Kroki service URL** at a self-hosted [kroki](https://kroki.io) instance (a single `docker run` will do).

## ⌨️ Commands & menus

| Command | What it does |
|---|---|
| `Sync all notes` | Walks scan folders and syncs every bound note. |
| `Sync current note` | Syncs only the active note. |
| `Insert Confluence frontmatter into current note` | Stubs the 5 frontmatter fields so you only have to paste the URL. |
| `Create bound note` | Prompts for path + URL, then creates a new note already bound. |
| `Export storage preview of current note` | Writes the converted Confluence storage XHTML to `<note>.preview.xml` — useful for debugging parser errors. |
| `Validate credentials` | Pings Confluence with the current settings and shows your account name. |

Right-click menus:
- **In the editor** — Sync this note / Insert frontmatter (whichever applies).
- **In the file tree on a note** — same as above.
- **In the file tree on a folder** — Sync every bound note under this folder (recursive).

Properties panel: when a note has a `confluence_url` property, the plugin adds two icons next to the property key — **sync this note** and **open in Confluence** (multiple bound pages pop a picker menu). There is deliberately no one-click "unbind" button; destructive actions don't belong one click away in the properties panel.

## 🛠️ Troubleshooting

**`401` / `Authentication failed`** — Cloud uses **email + API token**, not your Atlassian password. Server 7.9+ should use **Bearer** with a PAT, not Basic.

**`XSRF` rejection on Server** — The plugin already routes around this by using Node `https` for POST + JSON / multipart uploads. If you still hit it, your reverse proxy may be stripping headers; check `X-Atlassian-Token: no-check`.

**Mermaid block shows source instead of image** — turn on **Render Mermaid diagrams** in settings. The default engine (kroki) needs network access to `kroki.io`; on a corporate network either self-host kroki or switch the engine to **Obsidian built-in (SVG)**, which renders locally.

**Gantt / timeline dates overlap on Confluence** — kroki renders these at a fixed narrow width so the date axis labels collide. Switch the engine to **Obsidian built-in (SVG)** to let the chart scale to content width.

**Cannot find secret vault** — requires Obsidian 1.11.4+. On older versions the plugin falls back to a plaintext field; upgrade Obsidian to use the encrypted vault.

**The plugin keeps syncing the same note** — check `confluence_last_hash`; if you're editing in the Confluence UI too, every sync will overwrite Confluence and reset the hash. This plugin is **one-way (Obsidian → Confluence) by design**.

## 🧱 Limitations

- **One-way sync only.** Edits made directly in Confluence are overwritten on the next sync.
- **Desktop only.** Mobile Obsidian doesn't expose the Node `https` modules the plugin relies on for XSRF-safe uploads.
- **No vendor macros.** Headings, lists, tables, fenced code, links, images and callouts are converted; vendor-specific macros aren't.

## 🧑‍💻 Development

```bash
bun install
bun run dev      # watch mode, writes dist/main.js
bun run build    # production build (typecheck + bundle)
```

`bun run build` also copies `manifest.json` and `styles.css` into `dist/`, so the directory can be dropped straight into `.obsidian/plugins/sync-confluence/` for local testing.

Release flow:

```bash
npm version 0.2.1     # bumps package.json + manifest.json + versions.json
git push && git push --tags
```

The `release.yml` workflow builds and attaches the three required files to a GitHub Release.

## 📄 License

[BSD Zero Clause](./LICENSE)

---

<a id="中文"></a>

## ☁️ Sync Confluence（中文）

> 按定时把 Obsidian 笔记推到 Confluence 对应页面 —— 一个 frontmatter 字段搞定绑定，不需要单独的映射文件。

### 💡 为什么用 Sync Confluence

- **Frontmatter 驱动绑定** —— 在笔记 frontmatter 里写一个 Confluence 页面 URL，就这一步。
- **多实例（Multi-instance）** —— 一个 vault 可连接最多 10 个 Confluence 实例，笔记按 URL 最长前缀匹配路由；multi-target 笔记可跨实例同步。
- **Cloud + Server / DC** —— Cloud 用 Basic（邮箱 + API token），Server 7.9+ / DC 用 Bearer（个人访问令牌）。
- **内容哈希去重** —— 没改的笔记不重复推送，省带宽也省审计噪声。
- **本地附件自动上传** —— 笔记里 `![[image.png]]` 形式引用的本地图片自动上传为 Confluence 附件;普通图片默认显示宽度为 192px(可配置),上传原图不压缩。
- **自动建子页面** —— 设 `confluence_parent_url`，首次同步时插件自动建子页面并把新 URL 回写到 `confluence_url`。
- **Mermaid / PlantUML 预渲染** —— 同步前渲染成图片附件，Confluence 端不装宏也能看图。Mermaid 支持两种引擎：kroki 远端服务（PNG，兼容性最好）或 Obsidian 内置引擎（SVG，跟笔记预览像素级一致）。
- **多种触发方式** —— Ribbon、命令面板、编辑器 / 文件树右键、定时器。
- **中英双语 UI** —— 跟随 Obsidian 语言自动切换。

### 📦 安装

> [!TIP]
> 插件已发布到 Obsidian 官方社区插件库，优先用这条路径。

**从社区插件库安装**

1. 打开 **设置 → 第三方插件**。
2. 点 **浏览**，搜索 **`Sync Confluence`**。
3. 点 **安装** → **启用**。

**从 GitHub Release 手动安装**

1. 在 [最新 Release 页面](https://github.com/dzplus/obsidian-sync-confluence/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放到 `<vault>/.obsidian/plugins/sync-confluence/`。
3. 重启 Obsidian → 在 **设置 → 第三方插件** 里启用。

**通过 BRAT（跟踪 beta 版）**

1. 从社区插件库装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. **BRAT 设置 → Add Beta plugin** → 填 `dzplus/obsidian-sync-confluence`。

### 🚀 快速开始

**1. 从 Confluence 拿一个 token**

| 你的环境 | 需要什么 | 在哪拿 |
|---|---|---|
| **Atlassian Cloud** | API token | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| **Server / DC 7.9+** | Personal Access Token | Confluence → 头像 → **设置 → Personal Access Tokens** |
| **Server（老账号体系）** | 登录密码 | （和你登录 Confluence 的密码一致） |

**2. 把 token 存到 Obsidian 密钥库**（需 Obsidian 1.11.4+）

`设置 → 密钥库 → 创建新密钥` → 把 token 粘到密钥值 → 给它起个名字（如 `confluence-token`）。

**3. 在插件里连起来**

`设置 → Sync Confluence → Confluence 认证`：

- **Base URL** —— Cloud 形如 `https://xxx.atlassian.net/wiki`；Server / DC 通常无 `/wiki` 后缀，如 `https://confluence.your-corp.com`。
- **认证方式** —— Cloud 与 Server 老账号体系选 **Basic**；Server PAT 选 **Bearer**。
- **账号**（仅 Basic）—— Cloud 填 Atlassian 邮箱；Server 填域账号。
- **密码 / API Token** —— 从下拉里选你刚存的密钥。
- 点 **验证认证**，应该看到自己的显示名。

**4. 给一篇笔记加 frontmatter 绑定**

打开任意笔记，在 frontmatter 里加：

```yaml
---
confluence_url: https://xxx.atlassian.net/wiki/spaces/XXX/pages/12345/Title
---
```

也可以用命令面板：**`在当前笔记插入 frontmatter`**，插件会把所有字段都准备好。

**5. 同步**

下面任意一种：
- 点左侧 ☁ Ribbon 图标（同步全部已绑定笔记）。
- 跑命令：**`同步当前笔记`** / **`同步全部笔记`**。
- 右键笔记 / 文件夹 → **`同步到 Confluence`**。
- 等定时器（默认 30 分钟一次，**同步调度** 里改）。

状态栏小图标会显示最近一次结果：`☁ 空闲` / `☁ 同步中` / `☁ 已同步` / `☁ 失败`。

### 🏢 多实例 Confluence

如果你要在同一个 vault 里同时管多个 Confluence 服务器（比如个人 Cloud + 公司 Server），多实例支持让你一次性配齐。

**新增实例**

1. **Settings → Sync Confluence → Confluence authentication → 新增 Confluence 实例**。
2. 填表：
   - **实例名称** —— 唯一的显示名（`个人` / `公司` 等）。
   - **Base URL** —— 例如 `https://xxx.atlassian.net/wiki`（Cloud）或 `https://confluence.company.com`（Server）。
   - **认证方式** + **账号** + **Token**（Obsidian 密钥库）。
3. 点 **Validate credentials** 校验。

**路由**

每个笔记，插件会把所有 `confluence_url` / `confluence_parent_url`（含 CSV 和数组形式）里的 URL 拿出来，挑出 **最长前缀匹配** 的实例作为目标。一个笔记可以同时落到多个实例里——比如它的多 target 横跨实例，每个实例的 engine 只会同步属于自己的 target。

> 单个 vault 最多 **10 个实例**。如果笔记的 URL 不匹配任何配置的 base URL，会在 sync summary 里显示成 `Unmatched` 并跳过。

**创建绑定笔记**

只有当配置了多个实例时，`Create bound note` 命令才会显示实例下拉框，并校验输入的 URL 是否以所选实例的 base URL 开头。

**Mention 也是 per-instance。** `@[[张三]]` 会按 `confluence_username.<instanceId>` 解析（见 [链接与 mention](#-链接与-mention)）——同一个人在不同实例上 username 不一样时，每个实例各列一行。没有当前实例对应 slice 的 person note，只在那个实例上降级为 `@张三`。

### 📝 Frontmatter 速查

**已有页面 —— 用 URL 直接绑**

```yaml
---
confluence_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page
---
```

**还没建页面 —— 让插件在指定父页下建子页面**

```yaml
---
confluence_parent_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent
confluence_url:
---
```

首次同步时插件以本笔记文件名为标题创建子页面，并把新页面 URL 回写到 `confluence_url`。之后同步直接走这个 URL。

**多父页面示例 —— 同一篇笔记同步到多个父页面下的副本**

```yaml
---
confluence_parent_url:
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent-A
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/200/Parent-B
confluence_url:
  - https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page
  - ""
confluence_page_id:
  - "12345"
  - ""
---
```

**CSV 格式多父页面示例**

```yaml
---
confluence_parent_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/100/Parent-A, https://xxx.atlassian.net/wiki/spaces/DOC/pages/200/Parent-B
confluence_url: https://xxx.atlassian.net/wiki/spaces/DOC/pages/12345/My-Page, ""
confluence_page_id: 12345, ""
---
```

**插件自动回写的字段** —— 你不用填，留空即可：

- `confluence_page_id` —— 解析出的 Page ID。
- `confluence_last_synced` —— 上次成功推送的 ISO 时间戳。
- `confluence_last_hash` —— 内容哈希；哈希一致就跳过本次同步。
- `confluence_attachments` —— Page ID → 文件名 → `{hash, id}` 附件缓存，用于跳过未变附件。

### 🔗 链接与 mention

**Wikilink。** `[[另一篇笔记]]` / `[[另一篇笔记|别名]]`（以及标准 `[文本](note.md)` 链接）会经 Obsidian metadata cache 解析：目标笔记已绑定 `confluence_url` → 替换为指向那个 Confluence 页面的超链接；未绑定 → 降级为纯文本。批量同步会先给"仅有 parent"的笔记预建占位页，同批笔记互相引用首次同步即可解析。

**标题锚点。** 同页 `[[#标题]]` / `[文本](#标题)` 和跨页 `[[另一篇笔记#标题]]` / `[文本](note.md#标题)` 会转换为 Confluence 原生标题锚点。标题匹配遵循 Confluence 规则，区分大小写。

**用户 mention（仅 Server / DC）。** 写 `@[[张三]]` 即可 mention Confluence 用户。插件查找被链接的笔记（`张三.md`），读其 frontmatter 的 `confluence_username`。配置多个实例时，值是 per-instance map，键为 `ConfluenceInstance.id`，每个 engine 只读属于自己的 slice：

```yaml
---
confluence_username:
  default: zhangsan           # ConfluenceInstance.id → Confluence username
  inst-abc123: zhang.s        # 另一个实例可能有不同的 username
---
```

当前实例对应条目存在 → 变成真实的 Confluence 用户链接（会通知对方、可点进个人页）；笔记 / 字段 / 当前实例对应 slice 缺失 → 降级为纯文本 `@张三`。代码块里的 mention 原样保留。插件同步过程**不会**调 Confluence 用户搜索 API——每人维护一次 username 后离线可用。Cloud 暂不支持（Cloud storage 格式要求 `ri:account-id`）。

### 🎨 图表渲染（可选）

| 源 | 插件行为 |
|---|---|
| ```mermaid``` 块 | 默认开。同步前渲染成图片附件，用两个引擎之一（见下）。 |
| ```plantuml``` 块 | 默认关；开 → 走 PlantUML Server 渲染为 PNG 上传。 |

#### Mermaid 引擎

在 **设置 → 图表渲染 → 渲染方式** 二选一：

| 引擎 | 输出 | 适用 |
|---|---|---|
| **Kroki 远端服务**（默认） | PNG，走 `https://kroki.io/mermaid/png`（或自建实例） | 兼容性最好——任何 Confluence 版本都能 inline 渲染，中文/emoji 字体齐全。代价：时间轴类图表（gantt / timeline）会被压缩到固定窄宽度，日期标签挤在一起。 |
| **Obsidian 内置引擎** | SVG，本地用 Obsidian 自带的 mermaid 渲染 | 跟编辑器预览像素级一致、无网络依赖、时间轴图表按内容宽度自然撑开。代价：产物是 SVG，老版本 Confluence Server（≤5.x）可能不 inline 显示；字体跟随你当前主题。 |

走 kroki 的企业内网用户，把 **Kroki 服务 URL** 指向自建 [kroki](https://kroki.io) 实例（一条 `docker run` 即可）。

### ⌨️ 命令与菜单

| 命令 | 作用 |
|---|---|
| `同步全部笔记` | 遍历扫描目录，同步所有已绑定的笔记 |
| `同步当前笔记` | 仅同步当前活动笔记 |
| `在当前笔记插入 frontmatter` | 把 5 个 frontmatter 字段填好，你只需要粘 URL |
| `创建绑定笔记` | 填路径 + URL，直接生成一篇已绑定的笔记 |
| `导出当前笔记的 storage 预览` | 把转换后的 Confluence storage XHTML 写到 `<笔记>.preview.xml`，便于排查转换报错 |
| `验证认证信息` | 用当前设置 ping Confluence，回显你的账号显示名 |

右键菜单：
- **编辑器内** —— 同步该笔记 / 插入 frontmatter（按是否已绑定切换）
- **文件树里点笔记** —— 同上
- **文件树里点文件夹** —— 同步该文件夹下所有已绑定笔记（递归）

属性面板：笔记有 `confluence_url` 属性时，插件在属性名旁注入两个图标 —— **同步当前笔记** 和 **在 Confluence 中打开**（绑定多个页面时弹菜单选择）。有意不做一键"解绑"按钮：破坏性操作不该在属性面板一击可达。

### 🛠️ 排错

**`401` / `认证失败`** —— Cloud 用 **邮箱 + API token**，不要填 Atlassian 登录密码。Server 7.9+ 走 PAT 的话要选 **Bearer**，不是 Basic。

**Server 上 `XSRF` 拒绝** —— 插件已经走 Node `https` 模块绕过 `requestUrl` 的 XSRF 限制了。如果还报，多半是你的反代剥了 header，检查一下 `X-Atlassian-Token: no-check` 透传。

**Mermaid 代码块没渲成图** —— 在设置里把 **渲染 Mermaid 图表** 打开。默认引擎（kroki）需要联网访问 `kroki.io`；企业内网要么自建 kroki，要么把引擎切到 **Obsidian 内置引擎（SVG）**，本地渲染、不走网络。

**Confluence 上 Gantt / timeline 的日期挤在一起** —— kroki 渲染这类时间轴图表用的画布太窄，日期标签互相重叠。把引擎切到 **Obsidian 内置引擎（SVG）**，让图表按内容宽度自然撑开。

**找不到密钥库** —— 需要 Obsidian 1.11.4+。老版本会回退到明文输入；升级 Obsidian 即可走加密密钥库。

**插件一直在同步同一篇笔记** —— 看 `confluence_last_hash`；如果你也在 Confluence 端直接改，每次同步都会被插件覆盖回 Obsidian 的内容，hash 会循环变化。本插件**单向（Obsidian → Confluence），不读回 Confluence 改动**。

### 🧱 限制

- **仅单向同步**。在 Confluence 端直接改的内容会在下次同步时被覆盖。
- **仅桌面端**。Obsidian 移动端没暴露插件做 XSRF-safe 上传所需的 Node `https` 模块。
- **不覆盖第三方 Confluence 宏**。标题、列表、表格、围栏代码、链接、图片、callout 都做了转换；vendor 自定义宏不处理。

### 🧑‍💻 开发

```bash
bun install
bun run dev      # watch 模式,写 dist/main.js
bun run build    # 生产构建(typecheck + 打包)
```

`bun run build` 会把 `manifest.json` 和 `styles.css` 一起拷到 `dist/`，整个目录可以直接拖到 `.obsidian/plugins/sync-confluence/` 本地测试。

发版：

```bash
npm version 0.2.1     # 同步 package.json + manifest.json + versions.json
git push && git push --tags
```

`release.yml` 会自动构建并把三个必备文件挂到 GitHub Release 上。

### 📄 许可证

[BSD Zero Clause](./LICENSE)
