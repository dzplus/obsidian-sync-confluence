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
- **Cloud + Server / Data Center** — Basic auth (email + API token) for Atlassian Cloud, Bearer (Personal Access Token) for Server 7.9+ / DC.
- **Content-hash skip** — unchanged notes are not re-pushed; bandwidth and audit log stay clean.
- **Local attachments auto-upload** — `![[image.png]]` embeds become Confluence attachments.
- **Auto-create child pages** — set `confluence_parent_url` and the first sync creates the page, then writes the URL back.
- **Mermaid / PlantUML pre-render** — diagrams are rendered to PNG so they show up even without macros on the Confluence side.
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

**Fields written back by the plugin** — leave these blank, they're maintained automatically:

- `confluence_page_id` — resolved page ID.
- `confluence_last_synced` — ISO timestamp of the last successful push.
- `confluence_last_hash` — content hash; equal hash = sync is a no-op.
- `confluence_attachments` — filename → `{hash, id}` cache, used to skip re-uploading unchanged attachments.

## 🎨 Diagram rendering (optional)

| Source | Plugin behavior | Why |
|---|---|---|
| ```mermaid``` block | Off by default; on → POSTs source to `https://kroki.io/mermaid/png`, uploads PNG as attachment. | Confluence Server doesn't render inline SVG; CJK fonts on local SVG→PNG pipelines are flaky. |
| ```plantuml``` block | Off by default; on → renders via a PlantUML server, uploads PNG. | Lets you read diagrams in Confluence without installing a macro. |

For corporate networks, point **Mermaid render service URL** at a self-hosted [kroki](https://kroki.io) instance.

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

## 🛠️ Troubleshooting

**`401` / `Authentication failed`** — Cloud uses **email + API token**, not your Atlassian password. Server 7.9+ should use **Bearer** with a PAT, not Basic.

**`XSRF` rejection on Server** — The plugin already routes around this by using Node `https` for POST + JSON / multipart uploads. If you still hit it, your reverse proxy may be stripping headers; check `X-Atlassian-Token: no-check`.

**Mermaid block shows source instead of image** — turn on **Mermaid → PNG** in settings; the default endpoint is the public `kroki.io`. Inside a corporate network, run your own kroki container and point the URL at it.

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
- **Cloud + Server / DC** —— Cloud 用 Basic（邮箱 + API token），Server 7.9+ / DC 用 Bearer（个人访问令牌）。
- **内容哈希去重** —— 没改的笔记不重复推送，省带宽也省审计噪声。
- **本地附件自动上传** —— 笔记里 `![[image.png]]` 形式引用的本地图片自动上传为 Confluence 附件。
- **自动建子页面** —— 设 `confluence_parent_url`，首次同步时插件自动建子页面并把新 URL 回写到 `confluence_url`。
- **Mermaid / PlantUML 预渲染** —— 渲成 PNG 上传，Confluence 端不装宏也能看图。
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

**插件自动回写的字段** —— 你不用填，留空即可：

- `confluence_page_id` —— 解析出的 Page ID。
- `confluence_last_synced` —— 上次成功推送的 ISO 时间戳。
- `confluence_last_hash` —— 内容哈希；哈希一致就跳过本次同步。
- `confluence_attachments` —— 文件名 → `{hash, id}` 附件缓存，用于跳过未变附件。

### 🎨 图表渲染（可选）

| 源 | 插件行为 | 为什么 |
|---|---|---|
| ```mermaid``` 块 | 默认关；开 → POST 源码到 `https://kroki.io/mermaid/png`，下载 PNG 作为附件上传 | Confluence Server 不 inline 渲染 SVG；本地 SVG→PNG 走 puppeteer 缺中文字体支持 |
| ```plantuml``` 块 | 默认关；开 → 走 PlantUML Server 渲染为 PNG 上传 | Confluence 端不装宏也能看图 |

企业内网可把 **Mermaid 渲染服务 URL** 指向自建 [kroki](https://kroki.io) 实例。

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

### 🛠️ 排错

**`401` / `认证失败`** —— Cloud 用 **邮箱 + API token**，不要填 Atlassian 登录密码。Server 7.9+ 走 PAT 的话要选 **Bearer**，不是 Basic。

**Server 上 `XSRF` 拒绝** —— 插件已经走 Node `https` 模块绕过 `requestUrl` 的 XSRF 限制了。如果还报，多半是你的反代剥了 header，检查一下 `X-Atlassian-Token: no-check` 透传。

**Mermaid 代码块没渲成图** —— 在设置里把 **Mermaid → PNG** 打开。默认走公共 `kroki.io`；企业内网请自建 kroki 容器后改 URL。

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
