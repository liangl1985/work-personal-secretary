#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PPT 主题库：列出 / 检视 / 从母版导入（B 线，2026-09-16）。

三条路径：
  list    列出可用主题（内置 specs/ + 使用者自定义层 ~/.dsh/data/dsh-doc-suite/templates/）
  inspect 只读检视一份 pptx 的母版与主题（色板 / 字体 / 版式 / 页面尺寸），不写任何文件
  import  从 pptx 提取主题 → 生成**自定义层**主题 json（只写差异键，几何继承 standard）

导入的映射口径（可追溯）：
  - 主色 primary      ← 主题 clrScheme 的 dk2（母版的深底/主色）
  - 辅助色 secondary  ← accent1
  - 装饰色 accent_decor ← accent1（明亮品牌色，用于色带/线条/图形；**不作文字色**）
  - 文字强调色 accent ← 由品牌**深色变体**得到：品牌亮色作文字通常不达 WCAG AA（4.5:1），
                        脚本按固定步长把 RGB 逐级压暗，取第一个达标值，并在 _note 里记录系数
  - fonts.heading/body ← majorFont/minorFont 的 ea（中文）+ latin（西文）
  - slide.width_emu/height_emu ← presentation.xml 的 sldSz
  - chart_series      ← accent1..accent6 中取前 5（图表配色，装饰用，不检对比度）
  - **不导入**：母版里的文字/图片/版式等内容（本工具只搬视觉令牌，不搬内容）

退出码：0 成功 ｜ 2 参数或输入错 ｜ 3 目标主题已存在（需 --force）｜ 4 导入后对比度不达标（已写入，提示需注意）
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
for _p in (str(SCRIPTS),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import cli_guard  # noqa: E402
import style_spec  # noqa: E402
from ppt_contrast import is_hex6, ratio  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
MODULE = SCRIPTS.parent
BUILTIN = MODULE / "specs"
CUSTOM = Path.home() / ".dsh" / "data" / "dsh-doc-suite" / "templates"
OFFICE_DEFAULT_ACCENTS = {"5B9BD5", "4472C4", "ED7D31"}     # Office 默认主题的 accent1/accent5/accent2
EXIT_EXISTS = 3
EXIT_CONTRAST = 4


def _parse(z, name):
    try:
        return ET.fromstring(z.read(name)), None
    except Exception as exc:                       # noqa: BLE001
        return None, exc


def _color_of(node):
    if node is None or not len(node):
        return ""
    child = list(node)[0]
    v = child.get("lastClr") or child.get("val") or ""
    return v.upper()


def read_pptx_theme(path):
    """读一份 pptx 的母版/主题结构（不修改文件）。"""
    z = zipfile.ZipFile(path)
    themes = {}
    for n in sorted(x for x in z.namelist() if x.startswith("ppt/theme/theme") and x.endswith(".xml")):
        root, err = _parse(z, n)
        if root is None:
            continue
        cs = root.find(A + "themeElements/" + A + "clrScheme")
        fs = root.find(A + "themeElements/" + A + "fontScheme")
        colors = {}
        if cs is not None:
            for key in ("dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
                        "accent4", "accent5", "accent6", "hlink", "folHlink"):
                colors[key] = _color_of(cs.find(A + key))
        fonts = {}
        if fs is not None:
            for kind in ("majorFont", "minorFont"):
                f = fs.find(A + kind)
                if f is None:
                    continue
                fonts[kind] = {tag: ((f.find(A + tag).get("typeface") or "") if f.find(A + tag) is not None else "")
                               for tag in ("latin", "ea", "cs")}
        themes[Path(n).name] = {"name": root.get("name") or "", "colors": colors, "fonts": fonts}

    masters = {}
    for m in sorted(x for x in z.namelist() if x.startswith("ppt/slideMasters/slideMaster") and x.endswith(".xml")):
        rels = m.replace("slideMasters/", "slideMasters/_rels/") + ".rels"
        theme, layouts, layout_names = "", 0, []
        root, _ = _parse(z, rels)
        if root is not None:
            for rel in root:
                ty = rel.get("Type", "")
                if ty.endswith("/theme"):
                    theme = Path(rel.get("Target", "").replace("../", "ppt/")).name
                elif ty.endswith("/slideLayout"):
                    layouts += 1
        for lay in sorted(x for x in z.namelist() if x.startswith("ppt/slideLayouts/slideLayout") and x.endswith(".xml")):
            lroot, _ = _parse(z, lay)
            if lroot is None:
                continue
            cSld = lroot.find(P + "cSld")
            nm = cSld.get("name") if cSld is not None else ""
            if nm:
                layout_names.append(nm)
        masters[Path(m).name] = {"theme": theme, "layouts": layouts,
                                 "layout_names": sorted(set(layout_names))}
    return themes, masters


def _page_size(z):
    root, _ = _parse(z, "ppt/presentation.xml")
    if root is None:
        return None
    sz = root.find(P + "sldSz")
    if sz is None:
        return None
    return int(sz.get("cx")), int(sz.get("cy"))


def pick_theme(themes, masters):
    """选公司母版主题：优先「挂载版式最多」的母版所引用的主题；排除 Office 默认色板。"""
    ranked = sorted(masters.items(), key=lambda kv: -kv[1]["layouts"])
    for mname, m in ranked:
        t = themes.get(m.get("theme", ""))
        if not t:
            continue
        if t["colors"].get("accent1", "") not in OFFICE_DEFAULT_ACCENTS:
            return mname, m["theme"], t, m
    if ranked:
        mname, m = ranked[0]
        return mname, m["theme"], themes.get(m["theme"], {}), m
    return "", "", {}, {}


def darken_to_aa(hex6, backgrounds=("FFFFFF", "F2F2F2"), target=4.5, step=0.88):
    """把品牌亮色逐级压暗，直到对**所有给定背景**都达标（WCAG AA）。

    背景要覆盖「白底」与「备用底」（表格底纹 / 卡片底 F2F2F2）——只按白底算会漏掉后者
    （2026-09-16 实测：tdhx 母版首轮只按白底，备用底 4.23:1 不达标）。
    """
    if not is_hex6(hex6):
        return hex6, 1.0, False
    r, g, b = (int(hex6[i:i + 2], 16) for i in (0, 2, 4))
    factor = 1.0
    for _ in range(14):
        cand = "%02X%02X%02X" % (int(r * factor), int(g * factor), int(b * factor))
        if all(ratio(cand, bg) >= target for bg in backgrounds):
            return cand, round(factor, 4), True
        factor *= step
    return "%02X%02X%02X" % (int(r * factor), int(g * factor), int(b * factor)), round(factor, 4), False


def cmd_list(args):
    rows = []
    for d, src in ((BUILTIN, "内置"), (CUSTOM, "自定义层")):
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.json")):
            if p.name.endswith(".schema.json"):
                continue
            try:
                cfg = json.loads(p.read_text(encoding="utf-8-sig"))
            except Exception as exc:               # noqa: BLE001
                print("  ⚠️ %s 读取失败：%s" % (p.name, exc), file=sys.stderr)
                continue
            sid = str(cfg.get("id") or p.stem)
            # 只列可用于 PPT 的：按**合并后**的 for 判断（自定义层覆盖内置同 id 时以内层为准）；
            # 未声明 for 的保留并标注（兼容使用者自定义层老文件，如公司母版导入件）
            declared = style_spec.resolve_for(sid)
            if isinstance(declared, list) and "ppt" not in declared:
                continue
            uses = "ppt" if isinstance(declared, list) else "未标注格式"
            rows.append({"id": sid, "name": cfg.get("name", ""),
                         "mood": cfg.get("mood", ""), "source": src, "for": uses,
                         "extends": cfg.get("extends", ""), "file": str(p)})
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0
    print("%-12s %-14s %-8s %-8s %-12s %s" % ("id", "名称", "来源", "extends", "用于", "风格"))
    for r in rows:
        print("%-12s %-14s %-8s %-8s %-12s %s" % (r["id"], r["name"], r["source"], r["extends"] or "-", r["for"], r["mood"]))
    print("\n共 %d 套可用于 PPT（内置 %s，自定义层 %s）" % (len(rows), BUILTIN, CUSTOM))
    print("说明：本表只列 for 含 ppt 的主题；未标注格式的按\"全部格式可用\"处理。"
          "Word / Excel 的文档规格见 skills/office-word、office-excel。")
    return 0


def _print_inspect(path, themes, masters, size):
    print("文件：%s（%.1f MB）" % (path.name, path.stat().st_size / 1024 / 1024))
    if size:
        print("页面：%.4f x %.4f 英寸（%s）" % (size[0] / 914400, size[1] / 914400,
                                          "16:9" if abs(size[0] / size[1] - 16 / 9) < 0.01 else "非 16:9"))
    print("\n主题 %d 套：" % len(themes))
    for name, t in sorted(themes.items()):
        c = t["colors"]
        office = "（Office 默认色板）" if c.get("accent1", "") in OFFICE_DEFAULT_ACCENTS else "（非默认 → 候选品牌主题）"
        print("  %-14s name=%-18s %s" % (name, t["name"], office))
        print("      dk2=%s accent1=%s accent2=%s accent3=%s" % (c.get("dk2"), c.get("accent1"), c.get("accent2"), c.get("accent3")))
    print("\n母版 %d 个（按挂载版式数排序）：" % len(masters))
    for name, m in sorted(masters.items(), key=lambda kv: -kv[1]["layouts"]):
        print("  %-20s theme=%-12s 版式 %d 个" % (name, m["theme"], m["layouts"]))
    mname, tname, t, m = pick_theme(themes, masters)
    if t:
        print("\n→ 建议作为公司母版：%s（theme=%s，版式 %d 个）" % (mname, tname, m["layouts"]))
        print("  色板：dk2=%s accent1=%s accent2=%s accent6=%s"
              % (t["colors"].get("dk2"), t["colors"].get("accent1"),
                 t["colors"].get("accent2"), t["colors"].get("accent6")))
        print("  字体：major latin=%s ea=%s ｜ minor latin=%s ea=%s"
              % (t["fonts"].get("majorFont", {}).get("latin"), t["fonts"].get("majorFont", {}).get("ea"),
                 t["fonts"].get("minorFont", {}).get("latin"), t["fonts"].get("minorFont", {}).get("ea")))
        print("  版式（前 12）：" + "、".join(m["layout_names"][:12]))
    return 0


def cmd_inspect(args):
    path = Path(args.pptx)
    if not path.is_file():
        raise cli_guard.InputError("母版文件不存在：%s" % path)
    themes, masters = read_pptx_theme(path)
    size = _page_size(zipfile.ZipFile(path))
    return _print_inspect(path, themes, masters, size)


def cmd_import(args):
    src = Path(args.pptx)
    if not src.is_file():
        raise cli_guard.InputError("母版文件不存在：%s" % src)
    out = Path(args.out) if args.out else (CUSTOM / ("%s.json" % args.id))
    if out.exists() and not args.force:
        print("目标已存在（加 --force 覆盖）：%s" % out, file=sys.stderr)
        return EXIT_EXISTS
    themes, masters = read_pptx_theme(src)
    if args.theme:
        tname = args.theme if args.theme.endswith(".xml") else args.theme + ".xml"
        t = themes.get(tname)
        mname = args.master or "?"
        m = masters.get(mname, {})
        if not t:
            raise cli_guard.InputError("找不到主题 %s（可用：%s）" % (tname, "、".join(sorted(themes))))
    else:
        mname, tname, t, m = pick_theme(themes, masters)
    if not t:
        raise cli_guard.InputError("未能从该 pptx 提取到可用主题（可能是空文件或非 pptx）")
    size = _page_size(zipfile.ZipFile(src))
    c = t["colors"]
    primary = c.get("dk2") or "1F4E79"
    brand = c.get("accent1") or "2E75B6"
    accent_text, factor, ok = darken_to_aa(brand)
    fonts = t["fonts"]
    heading_ea = fonts.get("majorFont", {}).get("ea") or fonts.get("minorFont", {}).get("ea") or "微软雅黑"
    body_ea = fonts.get("minorFont", {}).get("ea") or heading_ea
    heading_latin = fonts.get("majorFont", {}).get("latin") or "Arial"
    body_latin = fonts.get("minorFont", {}).get("latin") or heading_latin
    chart = [c.get("accent%d" % i) or brand for i in range(1, 6)]

    cfg = {
        "schema": "dsh-doc-suite/style-spec@1",
        "id": args.id,
        "name": args.name or ("%s（母版导入）" % (t["name"] or args.id)),
        "extends": "standard",
        "mood": args.mood or "沿用母版品牌色板",
        "best_for": ["沿用甲方母版的方案", "与既有公司模板同源的汇报"],
        "version": "1.0",
        "updated": args.updated or "",
        "_note": ("母版导入（ppt_theme.py import，2026-09-16）：从使用者提供的 pptx 提取**视觉令牌**"
                  "（色板 / 字体 / 页面尺寸），**不搬内容**。来源：theme=%s（name=%s）· master=%s（版式 %d 个）。"
                  "映射：primary←dk2、secondary←accent1、accent_decor←accent1、accent(文字)←accent1 压暗至 AA"
                  "（系数 %s，白底与备用底同时达标%s）。几何 / 字号 / 语义色沿用 standard。"
                  % (tname, t["name"], mname, m.get("layouts", 0),
                     factor, "" if ok else "，**仍未达标，请人工复核**")),
        "colors": {
            "primary": primary,
            "secondary": brand,
            "accent": accent_text,
            "accent_decor": brand,
        },
        "pptx": {
            "fonts": {
                "heading": {"latin": heading_latin, "ea": heading_ea},
                "body": {"latin": body_latin, "ea": body_ea},
            },
            # 白名单：导入的字体必须并入，否则 apply-style 会因「字体不在白名单」拒绝产出
            "allowed_fonts": sorted({f for f in (heading_ea, body_ea, heading_latin, body_latin) if f}),
            "color_roles": {
                "text_heading": "primary",
                "rule": "accent_decor",
                "panel_dark": "primary",
                "accent": "accent",
                "chart_series": {"s1": chart[0], "s2": chart[1], "s3": chart[2], "s4": chart[3], "s5": chart[4]},
            },
        },
    }
    if size:
        cfg["pptx"]["slide"] = {"width_emu": size[0], "height_emu": size[1]}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes((json.dumps(cfg, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print("已生成自定义层主题：%s" % out)
    print("  色板：primary=%s（dk2）· secondary/accent_decor=%s（accent1）· accent(文字)=%s（压暗系数 %s）"
          % (primary, brand, accent_text, factor))
    print("  字体：heading=%s / %s · body=%s / %s" % (heading_latin, heading_ea, body_latin, body_ea))
    if size:
        print("  页面：%.4f x %.4f 英寸" % (size[0] / 914400, size[1] / 914400))
    print("  版式来源：%s（theme=%s，%d 个版式）" % (mname, tname, m.get("layouts", 0)))

    # 导入即体检：对比度不达标就明确提示（不阻止，但给出退出码 4）
    try:
        from office.style_spec import load_spec
        from ppt_contrast import evaluate
        rows, bad = evaluate(load_spec(str(out)), args.id)
        print("  对比度：%d 项，%s" % (len(rows), "全部达标 ✅" if not bad else "%d 项不达标 ⚠️" % bad))
        for row in rows:
            if not row["ok"]:
                print("    ❌ %s：%.2f:1 < %.1f（%s on %s）"
                      % (row["item"], row["ratio"], row["threshold"], row["fg"], row["bg"]))
        return EXIT_CONTRAST if bad else 0
    except Exception as exc:                       # noqa: BLE001
        print("  对比度：跳过（%s）" % exc)
        return 0


def main():
    ap = argparse.ArgumentParser(description="PPT 主题库：列出 / 检视 / 从母版导入")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="列出可用主题")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("inspect", help="只读检视 pptx 的母版与主题（不写文件）")
    p.add_argument("pptx")
    p.set_defaults(fn=cmd_inspect)

    p = sub.add_parser("import", help="从母版提取 → 生成自定义层主题")
    p.add_argument("pptx")
    p.add_argument("--id", required=True, help="主题 id（自定义层文件名）")
    p.add_argument("--name", help="主题显示名")
    p.add_argument("--mood", help="风格说明")
    p.add_argument("--updated", default="2026-09-16")
    p.add_argument("--theme", help="指定主题文件（如 theme2.xml）；缺省自动选非 Office 默认的那套")
    p.add_argument("--master", help="记录用母版名（如 slideMaster2.xml）")
    p.add_argument("--out", help="输出路径（默认写入自定义层目录）")
    p.add_argument("--force", action="store_true", help="覆盖已存在的自定义层主题")
    p.set_defaults(fn=cmd_import)

    args = ap.parse_args()
    cli_guard.check_inputs(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
