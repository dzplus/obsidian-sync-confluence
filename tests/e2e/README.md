# Sync-Confluence e2e 测试

无 GUI 交互的全自动测试栈,验证 mermaid 渲染从 plugin 到 Confluence 落地的完整链路。

## 它做什么

1. `bun run build` 构建插件
2. 拷贝产物到目标 vault 的 `.obsidian/plugins/sync-confluence/`
3. `obsidian plugin:reload` 热重载插件
4. 投放 fixture(18 块 mermaid 覆盖 16 种图表类型 + 中文 / emoji / 边界)到 vault
5. **对每种 renderer(kroki / obsidian)**:
   - 用 `obsidian eval` 改 plugin `settings.mermaidRenderer` 并 `saveSettings + rebuildSyncEngine`
   - 用 `obsidian eval` 直接 `await plugin.syncOne(file)` 触发同步并阻塞到完成
   - 从 frontmatter 读回 `confluence_url` 拿子页面 pageId
   - 跑 `verify.py`:抓页面 + 列附件 + 下载每个 mermaid 产物验证(SVG/PNG 校验逻辑分开)+ 校验 `<ac:image>` 引用 + 检查 fallback 是否被误触发
6. 清理 vault 里的 fixture(可关)
7. 输出汇总

## 前提

- macOS / Linux
- Obsidian ≥ 1.12.4(自带 CLI;`obsidian --help` 能跑就行)
- `python3` ≥ 3.9
- `bun`(构建用,或 `SKIP_BUILD=1` 跳过)
- 目标 vault 里已经装过 sync-confluence(脚本只热替换文件,不做首次安装)
- 目标 vault 的 plugin `data.json` 已完成 Confluence 认证

## 运行

```bash
# 必需:Confluence 凭证 (推荐写进 ~/.config/mhc-skills/sync-confluence-e2e.env 后 source)
export CF_BASE_URL=https://cf.dawanju.net
export CF_USERNAME=duanzhang
export CF_PASSWORD=<password>

# 默认:跑 kroki + obsidian 两种 renderer 全量
tests/e2e/run.sh

# 只跑一种
tests/e2e/run.sh obsidian
tests/e2e/run.sh kroki

# 调试:跳过构建,保留 fixture(用于失败后手动看 Confluence 上的中间产物)
SKIP_BUILD=1 KEEP_FIXTURE=1 tests/e2e/run.sh obsidian

# 换 vault
VAULT=/Users/me/SomeVault VAULT_NAME=SomeVault tests/e2e/run.sh
```

## Confluence 测试目标

fixture frontmatter 写死了 `confluence_parent_url=https://cf.dawanju.net/pages/viewpage.action?pageId=223740097`(`~duanzhang` space 下的 `markdown-syntax-test`)。

每次跑 e2e:
- 文件名带 timestamp 后缀 → 每次同步生成**全新子页面**,不污染历史
- 老子页面累积在 parent 下,定期手动清理(或加 cleanup 步骤,默认不开)

要换 parent,改 `fixtures/mermaid-coverage.md` 的 frontmatter。

## fixture 覆盖

| # | 类型 | 关注点 |
|---|---|---|
| 1 | flowchart | 中文 + emoji 节点 |
| 2 | sequenceDiagram | 多 participant |
| 3 | classDiagram | 继承关系 |
| 4 | stateDiagram-v2 | start/end + 状态转移 |
| 5 | erDiagram | 表关系 |
| 6 | **gantt** | 时间轴宽度(原始问题) |
| 7 | **timeline** | 时间轴 |
| 8 | pie | 数据图 |
| 9 | journey | 阶段图 |
| 10 | gitGraph | 分支图 |
| 11 | mindmap | 树结构 |
| 12 | quadrantChart | 四象限 |
| 13 | requirementDiagram | 需求关系 |
| 14 | xychart-beta | XY 数据 |
| 15 | sankey-beta | 桑基图 |
| 16 | C4Context | 架构 C4 |
| 17 | (复用 §1) | hash 去重逻辑 |
| 18 | flowchart | LaTeX-like Unicode |

期望:**17 个**唯一 mermaid 附件(§17 跟 §1 hash 相同被去重)。

## 验证逻辑

`scripts/verify.py` 跑五项 check:

1. **page exists** — 子页面存在 + 版本号
2. **attachment count** — `mermaid-*.{ext}` 附件个数 ≥ 期望
3. **download + validate** — 每个附件下载下来按格式校验:
   - PNG:magic header 正确、IHDR 解出来 ≥ 50×50
   - SVG:含 `<svg>` 根、有视觉子节点(g/path/rect/text/...)、提取出宽高
4. **`<ac:image>` references match** — storage 里每个 `ri:filename` 都指向真实存在的附件
5. **no fallback triggered** — storage 里不能出现 `language=mermaid` 代码块(说明哪个 mermaid 渲染失败被 fallback 成代码了)

任一 check 失败,verify.py 返回 exit 1,run.sh 整体失败。报表是 markdown,直接 cat 出来给人看。

## 没做的事

- **视觉差异** — 不做 pixel-perfect 截图对比。要做的话用 `obsidian dev:screenshot path=...` 抓图,再用 `imagemagick compare` 比较,代价高、维护重。先靠人眼瞄。
- **CI 化** — 脚本本身已 CI-ready,但需要 macOS runner + 装 Obsidian + 注入凭证。本仓库未配 GitHub Actions(私有 Confluence,公开 runner 拿不到)。
- **多 vault 并行** — `obsidian eval` 是串行的,跑两次串着跑就行。
