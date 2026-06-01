# Sync Confluence

把 Obsidian 笔记按设定间隔自动推送到 Confluence 对应页面。

## 工作方式

1. 在笔记 frontmatter 写一行 `confluence_url: https://your-domain.atlassian.net/wiki/spaces/XXX/pages/12345/Title`
2. 设置页填写 Confluence baseUrl、邮箱、API token
3. 触发 "立即同步" 或等定时器到点,插件会把笔记正文转成 Confluence storage format 推送过去

## 特性

- **frontmatter 驱动绑定**:零额外配置,把页面 URL 写进笔记就关联了
- **内容哈希去重**:无变化的笔记跳过推送
- **本地附件上传**:`![[image.png]]` 嵌入的本地图片自动作为 Confluence 附件
- **Mermaid 预渲染**:可选把 mermaid 代码块本地渲染为 PNG 上传(默认开启)
- **PlantUML 预渲染**:可选走 PlantUML Server 渲染 PNG(默认关闭,需自行开启)
- **多种触发方式**:Ribbon 图标、命令面板、编辑器/文件右键菜单、定时器

## 开发

```bash
bun install
bun run dev        # watch 模式
bun run build      # 生产构建,输出 dist/
```

## 安装

### 方式 A:从 GitHub Release 手动安装

1. 到 [Releases](https://github.com/dzplus/obsidian-sync-confluence/releases) 下载最新版本里的 `main.js`、`manifest.json`、`styles.css` 三个文件
2. 在 vault 目录下创建 `.obsidian/plugins/sync-confluence/`,把三个文件放进去
3. 在 Obsidian 设置 → 第三方插件中刷新列表并启用 "Sync Confluence"

### 方式 B:用 BRAT 自动安装与更新(推荐)

1. 在 Obsidian 社区插件市场安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. 打开 BRAT 设置 → Add Beta plugin → 填入 `dzplus/obsidian-sync-confluence`
3. BRAT 会自动从 Release 拉取并安装,后续也会自动接收新版本

## 范围

V1 仅支持 Obsidian → Confluence 单向同步;Confluence 端如有改动,下次同步会被覆盖。
