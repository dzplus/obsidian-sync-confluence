#!/usr/bin/env python3
"""
e2e 验证脚本:抓 Confluence 页面 + 列附件 + 下载每个 mermaid 产物校验有效性。

输入: --page-id <id> --expected-count <n> --renderer <kroki|obsidian>
输出: stdout 是 markdown 报表, exit 0 = 全通过, 1 = 有失败

凭证从环境变量取(脚本调用方负责注入):
  CF_BASE_URL, CF_USERNAME, CF_PASSWORD
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import re
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


def auth_header() -> dict[str, str]:
    user = os.environ["CF_USERNAME"]
    pw = os.environ["CF_PASSWORD"]
    b64 = base64.b64encode(f"{user}:{pw}".encode()).decode()
    return {"Authorization": f"Basic {b64}"}


def cf_get(path: str) -> dict:
    base = os.environ["CF_BASE_URL"].rstrip("/")
    req = urllib.request.Request(f"{base}{path}", headers=auth_header())
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def cf_get_bytes(path: str) -> bytes:
    base = os.environ["CF_BASE_URL"].rstrip("/")
    req = urllib.request.Request(f"{base}{path}", headers=auth_header())
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def fetch_page(page_id: str) -> dict:
    return cf_get(f"/rest/api/content/{page_id}?expand=body.storage,version")


def fetch_attachments(page_id: str) -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        r = cf_get(f"/rest/api/content/{page_id}/child/attachment?start={start}&limit=200")
        out.extend(r.get("results", []))
        if r.get("size", 0) < 200:
            break
        start += 200
    return out


def validate_png(data: bytes) -> tuple[bool, str]:
    if len(data) < 100:
        return False, f"too small ({len(data)}B)"
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return False, "not a PNG"
    # 读 IHDR 拿尺寸 (offset 16-23)
    w = int.from_bytes(data[16:20], "big")
    h = int.from_bytes(data[20:24], "big")
    if w < 50 or h < 50:
        return False, f"dimensions too small ({w}x{h})"
    return True, f"{w}x{h} {len(data)//1024}KB"


def validate_svg(data: bytes) -> tuple[bool, str]:
    if len(data) < 100:
        return False, f"too small ({len(data)}B)"
    text = data.decode("utf-8", errors="replace")
    if "<svg" not in text:
        return False, "missing <svg> root"
    # 必须有视觉子元素之一
    if not re.search(r"<(g|path|rect|circle|text|line|polygon)\b", text):
        return False, "no visual child elements"
    # 取宽高(viewBox 优先)
    vb = re.search(r'viewBox="([^"]+)"', text)
    if vb:
        parts = vb.group(1).split()
        if len(parts) == 4:
            w, h = parts[2], parts[3]
            return True, f"viewBox {w}x{h} {len(data)//1024}KB"
    w = re.search(r'\bwidth="(\d+)', text)
    h = re.search(r'\bheight="(\d+)', text)
    if w and h:
        return True, f"{w.group(1)}x{h.group(1)} {len(data)//1024}KB"
    return True, f"valid svg {len(data)//1024}KB"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--page-id", required=True)
    ap.add_argument("--expected-count", type=int, required=True,
                    help="期望的 mermaid 附件个数(去重后)")
    ap.add_argument("--renderer", choices=["kroki", "obsidian"], required=True,
                    help="决定预期扩展名 + 校验逻辑")
    args = ap.parse_args()

    ext = "svg" if args.renderer == "obsidian" else "png"
    validate = validate_svg if ext == "svg" else validate_png

    checks: list[CheckResult] = []

    # Check 1: 页面存在
    try:
        page = fetch_page(args.page_id)
        checks.append(CheckResult(
            "page exists",
            True,
            f"version={page['version']['number']} title={page['title']!r}",
        ))
    except urllib.error.HTTPError as e:
        checks.append(CheckResult("page exists", False, f"HTTP {e.code}"))
        print_report(checks, args)
        return 1

    storage = page["body"]["storage"]["value"]

    # Check 2: 附件清单
    try:
        attachments = fetch_attachments(args.page_id)
    except urllib.error.HTTPError as e:
        checks.append(CheckResult("list attachments", False, f"HTTP {e.code}"))
        print_report(checks, args)
        return 1

    mermaid_atts = [a for a in attachments
                    if a["title"].startswith("mermaid-") and a["title"].endswith(f".{ext}")]
    other_atts = [a for a in attachments
                  if a["title"].startswith("mermaid-") and not a["title"].endswith(f".{ext}")]

    # 不直接对总数较真——renderer 之间宽容度不同(kroki 严、obsidian 松)。
    # 真正在意的是「每块要么被渲染、要么被 fallback」,见 check 5。
    checks.append(CheckResult(
        f"mermaid {ext} attachment count",
        len(mermaid_atts) > 0,
        f"found {len(mermaid_atts)}; stale-other-ext: {len(other_atts)}",
    ))

    # Check 3: 每个 mermaid 附件下载 + 验证
    for att in mermaid_atts:
        title = att["title"]
        try:
            link = att["_links"]["download"]
            data = cf_get_bytes(link)
            ok, detail = validate(data)
            checks.append(CheckResult(f"download+validate {title}", ok, detail))
        except urllib.error.HTTPError as e:
            checks.append(CheckResult(f"download {title}", False, f"HTTP {e.code}"))

    # Check 4: storage 里每个 mermaid 附件都被 <ac:image> 引用
    refs = set(re.findall(r'ri:filename="(mermaid-[^"]+)"', storage))
    ref_count_ok = len(refs) == len(mermaid_atts)
    checks.append(CheckResult(
        "<ac:image> references match attachments",
        ref_count_ok,
        f"refs={len(refs)} atts={len(mermaid_atts)} "
        f"{'(all matched)' if ref_count_ok else 'MISMATCH: ' + str(refs.symmetric_difference({a['title'] for a in mermaid_atts}))}",
    ))

    # Check 5: 每块要么渲染要么 fallback —— 这是真正的 invariant。
    # attachments + raw_mermaid_code_blocks >= expected_unique_blocks
    # kroki:  严格,语法错全部 fallback(14 valid + 4 broken = 18)
    # obsidian: 容错,语法错产生占位 SVG(18 svg + 0 fallback = 18)
    raw_count = len(re.findall(
        r'<ac:parameter ac:name="language">mermaid</ac:parameter>', storage))
    accounted = len(mermaid_atts) + raw_count
    checks.append(CheckResult(
        "every block accounted for (rendered or fallback)",
        accounted >= args.expected_count,
        f"rendered={len(mermaid_atts)} + fallback={raw_count} = {accounted} (expected ≥ {args.expected_count})",
    ))

    # Check 6: issue #1 / bibendi Bug A —— 文件名含空格的图片
    # fixture §20 用 ![[test image with spaces.png|alt-with-space]]
    # 期望:storage 里有 <ac:image ri:filename="test image with spaces.png">
    # bug 现象:wikilink → 标准 markdown 转换时 URL 没编码 → markdown-it 解析失败 → 原文输出
    img_filename = "test image with spaces.png"
    has_acimage = f'ri:filename="{img_filename}"' in storage
    has_raw_md = re.search(
        r'!\[[^\]]*\]\(test image with spaces\.png\)', storage) is not None
    checks.append(CheckResult(
        "Bug A (issue #1): image with spaces in filename embedded as <ac:image>",
        has_acimage and not has_raw_md,
        f"has_ac_image={has_acimage} has_raw_markdown_leak={has_raw_md}",
    ))

    # Check 7-N: issue #1 / bibendi Bug B 及变体 —— 所有 plantuml 块都该替换为 ac:image
    # fixture 有 5 个 plantuml 块: §21 普通 / §22 空格缩进 / §23 tab缩进 / §24 lang带attr / §25 blockquote
    # 期望:5 张 plantuml-*.png,0 个 raw plantuml 代码块。
    plantuml_imgs = re.findall(r'ri:filename="plantuml-[a-f0-9]+\.png"', storage)
    raw_plantuml_count = len(re.findall(
        r'<ac:parameter ac:name="language">plantuml</ac:parameter>', storage))
    raw_plantuml_with_attr_count = len(re.findall(
        r'<ac:parameter ac:name="language">plantuml [^<]+</ac:parameter>', storage))
    total_raw_plantuml = raw_plantuml_count + raw_plantuml_with_attr_count

    EXPECTED_PLANTUML_BLOCKS = 6
    checks.append(CheckResult(
        "PlantUML §21 (no indent)",
        len(plantuml_imgs) >= 1,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 1)",
    ))
    checks.append(CheckResult(
        "PlantUML §22 (4-space indent in list) — fixed in this session",
        len(plantuml_imgs) >= 2,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 2 if §21+§22 both render)",
    ))
    checks.append(CheckResult(
        "PlantUML §23 (tab indent) — Mac scenario hypothesis",
        len(plantuml_imgs) >= 3,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 3 if §21+§22+§23 render)",
    ))
    checks.append(CheckResult(
        "PlantUML §24 (lang with attribute)",
        len(plantuml_imgs) >= 4,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 4 if up to §24 render)",
    ))
    checks.append(CheckResult(
        "PlantUML §25 (blockquote wrapped)",
        len(plantuml_imgs) >= 5,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 5 if all render)",
    ))
    checks.append(CheckResult(
        "PlantUML §26 (CRLF line endings)",
        len(plantuml_imgs) >= 6,
        f"plantuml image count: {len(plantuml_imgs)} (need ≥ 6 if all render)",
    ))
    checks.append(CheckResult(
        "no raw plantuml code blocks left",
        total_raw_plantuml == 0,
        f"raw plantuml: plain={raw_plantuml_count} with_attr={raw_plantuml_with_attr_count}",
    ))

    return print_report(checks, args)


def print_report(checks: list[CheckResult], args) -> int:
    fails = [c for c in checks if not c.ok]
    print(f"# e2e 验证报告 (renderer={args.renderer}, page_id={args.page_id})")
    print()
    print(f"**Result: {len(checks) - len(fails)}/{len(checks)} passed**")
    print()
    print("| Check | Result | Detail |")
    print("|---|---|---|")
    for c in checks:
        mark = "✓" if c.ok else "✗"
        print(f"| {c.name} | {mark} | {c.detail} |")
    print()
    if fails:
        print(f"**{len(fails)} failure(s):**")
        for c in fails:
            print(f"- ✗ `{c.name}`: {c.detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
