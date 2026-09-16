#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对比度校验（WCAG 2.1 AA）—— B 线主题库的**单一真值**。

设计（55 号第八章 ⑧「对比度目前只靠人工实测、无门禁」的收口）：
  - 文字色 vs 背景 ≥ **4.5:1**（AA 正文）；大字号（≥18pt）可放宽到 3:1，本模块统一按 4.5 从严。
  - **装饰色不检**（accent_decor / rule / chart_series 用于色带、线条与图形，不作文字）。
  - 换主题只会改 primary / secondary / accent / accent_decor 与色角色引用；text_on_light 等
    文字色是**固定 hex**（见 specs/standard.json 的 color_roles._note），因此换主题不会让文字失效 —— 
    但 primary 作深底、accent 作文字仍必须逐一复测，本模块负责这件事。

用法：
  py -3 ppt_contrast.py check [--spec <id|路径>] [--all] [--json]   # 校验
  py -3 ppt_contrast.py ratio <hex> <hex>                          # 算两个色的比值

退出码：0 全部达标 ｜ 2 参数/规格错 ｜ 3 有不达标项
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
for _p in (str(SCRIPTS),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import cli_guard  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

AA_TEXT = 4.5
AA_LARGE = 3.0
EXIT_FAIL = 3
_HEX6 = re.compile(r"^#?[0-9A-Fa-f]{6}$")


def is_hex6(v):
    """严格判定 6 位 hex：**不能只看长度** —— 键名 accent / danger 之类恰好也是 6 个字符。"""
    return isinstance(v, str) and bool(_HEX6.match(v.strip()))


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex6):
    h = str(hex6).lstrip("#").upper()
    if len(h) != 6:
        raise cli_guard.InputError("色值应为 6 位 hex：%s" % hex6)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _resolve(cfg, key):
    """取色值：色角色优先（可能是顶层 colors 的键或 hex），再回退顶层 colors。"""
    roles = ((cfg.get("pptx") or {}).get("color_roles") or {})
    colors = cfg.get("colors") or {}

    def walk(node, dotted):
        cur = node
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return None
            cur = cur[part]
        return cur

    v = roles.get(key)
    if isinstance(v, str):
        if is_hex6(v):
            return v.lstrip("#").upper()
        in_colors = walk(colors, v)
        if is_hex6(in_colors):
            return in_colors.lstrip("#").upper()
    direct = walk(colors, key)
    return direct.lstrip("#").upper() if is_hex6(direct) else None


def checks_for(cfg):
    """返回 [(说明, 前景, 背景, 门槛, 是否必检)]。"""
    surface = _resolve(cfg, "surface") or "FFFFFF"
    surface_alt = _resolve(cfg, "surface_alt") or "F2F2F2"
    panel_dark = _resolve(cfg, "panel_dark") or "1F4E79"
    colors = cfg.get("colors") or {}
    sem = colors.get("semantic") or {}
    accent = _resolve(cfg, "accent") or (colors.get("accent") or "A34A00")
    muted_light = _resolve(cfg, "text_muted_on_light") or "595959"
    plain_light = _resolve(cfg, "text_on_light") or "404040"
    plain_dark = _resolve(cfg, "text_on_dark") or "FFFFFF"
    muted_dark = _resolve(cfg, "text_muted_on_dark") or "D9D9D9"
    return [
        ("正文 · 浅底", plain_light, surface, AA_TEXT),
        ("次要字 · 浅底", muted_light, surface, AA_TEXT),
        ("标题色 · 浅底", _resolve(cfg, "text_heading") or "1F4E79", surface, AA_TEXT),
        ("强调色（文字用）· 浅底", accent, surface, AA_TEXT),
        ("正文 · 浅底备用（卡片/表头底纹）", plain_light, surface_alt, AA_TEXT),
        ("强调色 · 浅底备用", accent, surface_alt, AA_TEXT),
        ("深底标题", plain_dark, panel_dark, AA_TEXT),
        ("深底次要字", muted_dark, panel_dark, AA_TEXT),
        ("通过（绿）· 白底", sem.get("pass") or "4E7A2B", surface, AA_TEXT),
        ("风险（红）· 白底", sem.get("risk") or "C00000", surface, AA_TEXT),
        ("注意（深黄）· 白底", sem.get("warn") or "8A6A00", surface, AA_TEXT),
        ("通过（绿）· 备用底", sem.get("pass") or "4E7A2B", surface_alt, AA_TEXT),
        ("风险（红）· 备用底", sem.get("risk") or "C00000", surface_alt, AA_TEXT),
        ("注意（深黄）· 备用底", sem.get("warn") or "8A6A00", surface_alt, AA_TEXT),
    ]


def evaluate(cfg, spec_id):
    rows = []
    bad = 0
    for label, fg, bg, threshold in checks_for(cfg):
        r = ratio(fg, bg)
        ok = r >= threshold
        bad += 0 if ok else 1
        rows.append({"spec": spec_id, "item": label, "fg": fg, "bg": bg,
                     "ratio": round(r, 2), "threshold": threshold, "ok": ok})
    return rows, bad


def cmd_ratio(args):
    print("%.2f:1" % ratio(args.fg, args.bg))
    return 0


def cmd_check(args):
    from office.style_spec import load_spec  # 延迟导入：与规格层同一真值
    ids = []
    if args.spec:
        ids = [args.spec]
    else:
        for d in (SCRIPTS.parent / "specs", Path.home() / ".dsh" / "data" / "dsh-doc-suite" / "templates"):
            if d.is_dir():
                ids += sorted(p.stem for p in d.glob("*.json") if not p.name.endswith(".schema.json"))
    all_rows, total_bad = [], 0
    for sid in ids:
        try:
            cfg = load_spec(sid)
        except Exception as exc:                     # noqa: BLE001
            print("  ⚠️ 跳过 %s：%s" % (sid, exc), file=sys.stderr)
            continue
        rows, bad = evaluate(cfg, sid)
        all_rows += rows
        total_bad += bad
        mark = "✅" if bad == 0 else "❌"
        print("%s %-12s %d 项，最低 %.2f:1%s"
              % (mark, sid, len(rows), min(r["ratio"] for r in rows),
                 "" if bad == 0 else "（%d 项不达标）" % bad))
    if args.json:
        print(json.dumps({"rows": all_rows, "fail": total_bad}, ensure_ascii=False, indent=2))
    return EXIT_FAIL if total_bad else 0


def main():
    ap = argparse.ArgumentParser(description="对比度校验（WCAG 2.1 AA）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("check", help="校验主题规格的文字对比度")
    p.add_argument("--spec", help="主题 id 或规格文件路径（默认：全部内置 + 自定义层）")
    p.add_argument("--all", action="store_true", help="与默认行为一致（保留以便阅读）")
    p.add_argument("--json", action="store_true", help="附加输出机器可读明细")
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("ratio", help="算两个色的对比度")
    p.add_argument("fg")
    p.add_argument("bg")
    p.set_defaults(fn=cmd_ratio)
    args = ap.parse_args()
    cli_guard.check_inputs(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
