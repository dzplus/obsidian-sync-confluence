#!/usr/bin/env bash
# e2e 测试编排:build → install → 切 renderer → 同步 → 验证。
# 默认两种 renderer 各跑一遍。
#
# 用法:
#   tests/e2e/run.sh                  # 全跑(kroki + obsidian)
#   tests/e2e/run.sh kroki            # 只跑 kroki
#   tests/e2e/run.sh obsidian         # 只跑 obsidian
#   SKIP_BUILD=1 tests/e2e/run.sh     # 跳过构建步骤(用现有 dist/)
#   KEEP_FIXTURE=1 tests/e2e/run.sh   # 测试后保留 vault 里的 fixture md
#
# 环境变量(必需):
#   CF_BASE_URL=https://cf.dawanju.net
#   CF_USERNAME=duanzhang
#   CF_PASSWORD=<password>
# 环境变量(可选):
#   VAULT=/Users/duanzhang/sync/Obsidian/PRD   # 目标 vault 绝对路径
#   VAULT_NAME=PRD                              # obsidian CLI 看到的 vault 名

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURE_SRC="$SCRIPT_DIR/fixtures/mermaid-coverage.md"

VAULT="${VAULT:-/Users/duanzhang/sync/Obsidian/PRD}"
VAULT_NAME="${VAULT_NAME:-PRD}"
PLUGIN_ID="sync-confluence"
TEST_REL_DIR="test-cases/sync-confluence-e2e"
TEST_STAMP="$(date +%s)"

# fixture 里 20 块 mermaid(§26 CRLF 段 +1),§17 跟 §1 hash 去重 → 19 唯一源
# 每块都该被记录(渲染成附件 或 fallback 成代码块)
EXPECTED_COUNT=19

REQUESTED_RENDERERS=("$@")
if [ ${#REQUESTED_RENDERERS[@]} -eq 0 ]; then
    REQUESTED_RENDERERS=(kroki obsidian)
fi

# ============ helpers ============
log() { printf "\033[1;34m[e2e]\033[0m %s\n" "$*" >&2; }
die() { printf "\033[1;31m[e2e][FAIL]\033[0m %s\n" "$*" >&2; exit 1; }

require() {
    command -v "$1" >/dev/null 2>&1 || die "缺工具: $1"
}

eval_cli() {
    # 把 JS 包成 IIFE,obsidian eval 默认不允许顶层 await
    obsidian "vault=${VAULT_NAME}" eval "code=(async () => { $1 })()"
}

# ============ 0. 前置检查 ============
log "前置检查"
require obsidian
require python3
[ -n "${CF_BASE_URL:-}" ] || die "CF_BASE_URL 未设置"
[ -n "${CF_USERNAME:-}" ] || die "CF_USERNAME 未设置"
[ -n "${CF_PASSWORD:-}" ] || die "CF_PASSWORD 未设置"
[ -d "$VAULT" ] || die "vault 路径不存在: $VAULT"
[ -f "$FIXTURE_SRC" ] || die "fixture 不存在: $FIXTURE_SRC"

# ============ 1. 构建 + 安装 ============
if [ "${SKIP_BUILD:-0}" != "1" ]; then
    log "构建插件"
    (cd "$PROJECT_ROOT" && bun run build) || die "构建失败"
fi

PLUGIN_DIR="${VAULT}/.obsidian/plugins/${PLUGIN_ID}"
[ -d "$PLUGIN_DIR" ] || die "plugin 未安装到 vault: $PLUGIN_DIR"
log "拷贝产物到 vault"
cp "$PROJECT_ROOT/dist/main.js" "$PLUGIN_DIR/main.js"
cp "$PROJECT_ROOT/dist/manifest.json" "$PLUGIN_DIR/manifest.json"
cp "$PROJECT_ROOT/dist/styles.css" "$PLUGIN_DIR/styles.css"

log "热重载插件"
obsidian "vault=${VAULT_NAME}" plugin:reload "id=${PLUGIN_ID}" >/dev/null
# Obsidian 重载 plugin 是异步的,留点时间让 onload 跑完
sleep 1

# ============ 2. 按 renderer 循环跑(每 renderer 用独立 fixture 文件 → 全新 CF 子页面) ============
declare -a RESULTS=()
OVERALL_FAIL=0

for RENDERER in "${REQUESTED_RENDERERS[@]}"; do
    log "============================================="
    log "Renderer: $RENDERER"
    log "============================================="

    # 2a. 准备目录 + 投放 §20 引用的图片附件(文件名含空格,Bug A repro 必需)
    #     先投图、再投 md,这样 Obsidian 扫到 md 时 PNG 已就位
    TEST_NAME="mermaid-coverage-${TEST_STAMP}-${RENDERER}"
    TEST_REL_PATH="${TEST_REL_DIR}/${TEST_NAME}.md"
    TEST_IMG_REL_PATH="${TEST_REL_DIR}/test image with spaces.png"
    TEST_ABS_PATH="${VAULT}/${TEST_REL_PATH}"
    TEST_IMG_ABS_PATH="${VAULT}/${TEST_IMG_REL_PATH}"
    mkdir -p "$(dirname "$TEST_ABS_PATH")"

    log "  → 投放图片附件: $TEST_IMG_REL_PATH"
    # 1×1 透明 PNG, base64 编码
    printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' \
        | base64 -d > "$TEST_IMG_ABS_PATH"

    log "  → 投放 fixture: $TEST_REL_PATH"
    cp "$FIXTURE_SRC" "$TEST_ABS_PATH"

    # 等 Obsidian 扫到 md + 图片(metadataCache 文件监听通常 1-2s)
    for i in 1 2 3 4 5 6 7 8 9 10; do
        STATUS=$(eval_cli '
            const md = !!app.vault.getAbstractFileByPath("'"$TEST_REL_PATH"'");
            const img = !!app.vault.getAbstractFileByPath("'"$TEST_IMG_REL_PATH"'");
            return md && img ? "ok" : (md ? "md_only" : (img ? "img_only" : "none"));
        ' | sed -n 's/^=> //p' | tr -d '"' | tr -d ' \n')
        [ "$STATUS" = "ok" ] && break
        sleep 1
    done
    [ "$STATUS" = "ok" ] || die "Obsidian 10s 内没识别到 md+img(状态: $STATUS)"

    # 2b. 切 renderer + 开 plantuml
    log "  → 切换 plugin renderer 到 $RENDERER + 开 plantuml"
    eval_cli '
        const p = app.plugins.plugins["'"$PLUGIN_ID"'"];
        p.settings.mermaidRenderer = "'"$RENDERER"'";
        p.settings.renderPlantUmlToPng = true;
        await p.saveSettings();
        p.rebuildSyncEngine();
        return p.settings.mermaidRenderer + "/" + p.settings.renderPlantUmlToPng;
    ' >/dev/null

    # 3b. 触发同步并等待完成。直接走 engine.syncOne() 拿结果对象;
    # plugin.syncFile() 返回 void(吃下结果发 Notice),不适合自动化判断。
    log "  → 触发同步 engine.syncOne()"
    SYNC_RESULT=$(eval_cli '
        const p = app.plugins.plugins["'"$PLUGIN_ID"'"];
        await p.ensureEngine();
        const f = app.vault.getAbstractFileByPath("'"$TEST_REL_PATH"'");
        if (!f) return "ERR:file_not_found";
        if (!p.engine) return "ERR:engine_not_ready";
        const r = await p.engine.syncOne(f);
        return JSON.stringify({skipped: r?.skipped, success: r?.success, error: r?.error, targets: r?.perTarget?.length});
    ' 2>&1) || die "同步调用失败: $SYNC_RESULT"
    log "  → 同步返回: $(printf '%s' "$SYNC_RESULT" | tr -d '\n' | head -c 400)"

    # 3c. 从 frontmatter 取 confluence_page_id(URL 可能是 /display/ 友好链不含 ID)
    log "  → 解析子页面 pageId"
    PAGE_ID=$(eval_cli '
        // 直接读文件解析,不走 metadataCache —— processFrontMatter 刚写完时缓存刷新是异步的,
        // 立刻查 cache 会拿到旧值(实测踩过:磁盘已有 page_id 但 cache 里没有)。
        const f = app.vault.getAbstractFileByPath("'"$TEST_REL_PATH"'");
        const text = await app.vault.read(f);
        let m = text.match(/^confluence_page_id:\s*"?(\d+)/m);
        if (m) return m[1];
        // fallback: 从 confluence_url 行解析
        m = text.match(/^confluence_url:.*?(?:pageId=(\d+)|\/pages\/(\d+))/m);
        return m ? (m[1] || m[2]) : "";
    ' | sed -n 's/^=> //p' | tr -d '"' | tr -d ' \n')

    [ -n "$PAGE_ID" ] || die "未能从 frontmatter 取到 pageId"
    log "  → pageId = $PAGE_ID"

    # 3d. REST 验证
    log "  → 运行验证脚本"
    REPORT_FILE=$(mktemp -t "e2e-report-${RENDERER}-XXXXXX.md")
    if python3 "$SCRIPT_DIR/scripts/verify.py" \
        --page-id "$PAGE_ID" \
        --expected-count "$EXPECTED_COUNT" \
        --renderer "$RENDERER" > "$REPORT_FILE"; then
        RESULTS+=("✓ $RENDERER (page=$PAGE_ID, report=$REPORT_FILE)")
    else
        RESULTS+=("✗ $RENDERER (page=$PAGE_ID, report=$REPORT_FILE)")
        OVERALL_FAIL=1
    fi
    echo "---- $RENDERER report ----"
    cat "$REPORT_FILE"
    echo "---- end report ----"
done

# ============ 4. 清理 ============
if [ "${KEEP_FIXTURE:-0}" != "1" ]; then
    log "清理 vault fixtures"
    find "${VAULT}/${TEST_REL_DIR}" -name "mermaid-coverage-${TEST_STAMP}-*.md" -type f -delete 2>/dev/null
    find "${VAULT}/${TEST_REL_DIR}" -name "test image with spaces.png" -type f -delete 2>/dev/null
    rmdir "${VAULT}/${TEST_REL_DIR}" 2>/dev/null || true
fi

# ============ 5. 汇总 ============
echo
log "============================================="
log "汇总"
log "============================================="
for r in "${RESULTS[@]}"; do
    echo "  $r"
done

exit "$OVERALL_FAIL"
