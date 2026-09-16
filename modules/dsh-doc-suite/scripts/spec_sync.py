#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规格同步与校验（dsh-doc-suite）

改完 specs/*.json 后跑一次，自动完成三件事：
  1) 校验：所有规格 JSON 合法 + 必需字段齐（extends 继承件放宽）
  2) 同步：复制到使用者运行副本（profile 的模块目录），并做 SHA256 校验
  3) 展示：把规格渲染成人类可读的 Markdown（供核对；可写入文件）

用法：
  py -3 spec_sync.py                        # 校验 + 同步 + 打印展示 Markdown
  py -3 spec_sync.py --doc-out spec.md      # 同时把展示文档写入指定文件
  py -3 spec_sync.py --check                # 只校验（CI 用），不写任何文件
  py -3 spec_sync.py --no-sync              # 跳过 profile 同步
  py -3 spec_sync.py --profile-root <dir>   # 指定 profile 里的模块目录（含 specs/）
  py -3 spec_sync.py --spec standard        # 只处理指定规格 id

退出码：0 成功 / 2 输入或规格错误 / 3 校验发现不一致
说明：本脚本**不含任何使用者私有路径**（展示文档输出由 --doc-out 指定，缺省打印到标准输出）。
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE = HERE.parent
SPECS = MODULE / "specs"
REQ_TOP = ("schema", "id", "word", "excel")
REQ_WORD = ("page", "fonts")
REQ_EXCEL = ("font", "header", "border", "print")
# pptx 段（B 线）：②a 契约——凡带 pptx 段的规格，这三类页型必须齐全
REQ_PPTX_LAYOUTS = ("cover", "bullets", "cards")
EMU_PER_INCH = 914400.0
# WPS 实测单倍行高系数（2026-09-16 ②b 出图像素实测；③a 统一口径）：
# 行高 = 字号 ÷ 72 × 该系数 × 行距。三处必须一致 —— 本文件 / scripts/office/ppt_render.py /
# scripts/style-test.mjs（后者有门禁断言，防止口径漂移）。
SINGLE_LINE_EM = 1.228
_HEX6 = re.compile(r"^[0-9A-Fa-f]{6}$")
_BOX_KEYS = ("x", "y", "w", "h")
_TOL_IN = 0.002


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def die(msg, code=2):
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def load_specs(only=None):
    if not SPECS.is_dir():
        die("找不到 specs/ 目录：%s" % SPECS)
    out = {}
    for p in sorted(SPECS.glob("*.json")):
        if p.name.endswith(".schema.json"):
            continue   # 字段规范（如 ppt-manifest.schema.json）不是样式规格，不参与规格校验；仍随 specs/ 同步
        try:
            s = json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc:
            die("规格不是合法 JSON：%s（%s）" % (p.name, exc))
        if only and s.get("id") != only:
            continue
        out[p.name] = s
    if not out:
        die("specs/ 下没有匹配的规格文件" + ("（--spec %s）" % only if only else ""))
    return out


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _color_tokens(colors):
    """顶层 colors 里可被 PPT 引用的键：字符串值用键名，字典值用「父.子」（neutral.light / semantic.risk）。"""
    toks = set()
    for k, v in (colors or {}).items():
        if str(k).startswith("_"):
            continue
        if isinstance(v, str):
            toks.add(k)
        elif isinstance(v, dict):
            for kk, vv in v.items():
                if isinstance(vv, str) and not str(kk).startswith("_"):
                    toks.add("%s.%s" % (k, kk))
    return toks


def _check_color(where, value, allowed, errs):
    """颜色引用只允许两种：6 位 hex，或可用色角色（pptx.color_roles 的键 / 顶层 colors 的键）。

    这条是「换主题不失效」的前提：几何里写死 #1F4E79 的时候，换主题就改不动它了。
    """
    if value is None:
        return
    if not isinstance(value, str) or not (_HEX6.match(value) or value in allowed):
        shown = "、".join(sorted(allowed)[:8]) + ("…" if len(allowed) > 8 else "")
        errs.append("%s 的色值 %r 既不是 6 位 hex 也不是可用色角色（%s）" % (where, value, shown))


def _check_pptx_element(where, e, max_w, max_h, sizes, allowed, components, errs,
                        relative=False, default_ls=1.0):
    if not isinstance(e, dict):
        errs.append("%s 应为对象" % where)
        return
    role = e.get("role")
    if not role:
        errs.append("%s 缺 role" % where)
    where = "%s(%s)" % (where, role or "?")
    box = e.get("box")
    if not isinstance(box, dict):
        errs.append("%s 缺 box" % where)
    else:
        miss = [k for k in _BOX_KEYS if not _num(box.get(k))]
        if miss:
            errs.append("%s.box 缺少数值键 %s" % (where, "、".join(miss)))
        else:
            if box["w"] <= 0 or box["h"] <= 0:
                errs.append("%s.box 宽高应为正数（w=%s, h=%s）" % (where, box["w"], box["h"]))
            if box["x"] < -_TOL_IN or box["y"] < -_TOL_IN:
                errs.append("%s.box 起点为负（x=%s, y=%s）" % (where, box["x"], box["y"]))
            right, bottom = box["x"] + box["w"], box["y"] + box["h"]
            if right > max_w + _TOL_IN or bottom > max_h + _TOL_IN:
                scope = "相对卡片框" if relative else "页面"
                errs.append("%s.box 越界：右下 (%.4f, %.4f) 超出%s可用区 (%.4f, %.4f)"
                            % (where, right, bottom, scope, max_w, max_h))
    if role == "grid":
        keys = ("cols", "max_rows", "gap_in", "col_w_in", "row_h_in")
        miss = [k for k in keys if not _num(e.get(k))]
        if miss:
            errs.append("%s 缺少数值键 %s" % (where, "、".join(miss)))
        elif isinstance(box, dict) and _num(box.get("w")) and _num(box.get("h")):
            need_w = e["cols"] * e["col_w_in"] + (e["cols"] - 1) * e["gap_in"]
            need_h = e["max_rows"] * e["row_h_in"] + (e["max_rows"] - 1) * e["gap_in"]
            if need_w > box["w"] + _TOL_IN:
                errs.append("%s 网格需要宽 %.4f，超过网格区宽 %.4f（cols×col_w + 间距）" % (where, need_w, box["w"]))
            if need_h > box["h"] + _TOL_IN:
                errs.append("%s 网格需要高 %.4f，超过网格区高 %.4f（rows×row_h + 间距）" % (where, need_h, box["h"]))
        slot = e.get("slot")
        if slot and components is not None and slot not in components:
            errs.append("%s 的 slot=%r 在 components 中不存在" % (where, slot))
    text = e.get("text")
    if isinstance(text, dict):
        sref = text.get("size")
        if not isinstance(sref, str):
            errs.append("%s 的 text.size 应为 sizes_pt 的键名（字符串），实得 %r" % (where, sref))
            base_pt = None
        elif sref not in sizes:
            errs.append("%s 引用了 sizes_pt 中不存在的字号键 %r" % (where, sref))
            base_pt = None
        else:
            base_pt = sizes[sref]
        _check_color(where + ".text.color", text.get("color"), allowed, errs)
        fit = e.get("autofit")
        ls = text.get("line_spacing", default_ls)   # 与渲染约定一致：未写则回退 spacing.line_spacing
        ls = float(ls) if _num(ls) else default_ls
        bullet = e.get("bullet")
        gap_in = 0.0
        if isinstance(bullet, dict) and _num(bullet.get("gap_after_pt")):
            gap_in = float(bullet["gap_after_pt"]) / 72.0
        if isinstance(fit, dict) and _num(fit.get("min_size_pt")) and _num(base_pt):
            if fit["min_size_pt"] > base_pt:
                errs.append("%s 的 autofit.min_size_pt=%s 大于所引用字号 %s=%s"
                            % (where, fit["min_size_pt"], sref, base_pt))
            # 容量自洽：max_lines 是「基础字号下 box 能放下的行数」，段距只加在段与段之间
            max_lines = fit.get("max_lines")
            if _num(max_lines) and isinstance(box, dict) and _num(box.get("h")) and max_lines > 0:
                line_h = base_pt / 72.0 * SINGLE_LINE_EM * ls
                need = max_lines * line_h + max(0, max_lines - 1) * gap_in
                if need > box["h"] + _TOL_IN:
                    tail = "（含 %d 段 %spt 段距）" % (max_lines - 1, bullet.get("gap_after_pt")) if gap_in else ""
                    errs.append("%s 容量不自洽：%s 行 × %.4f in%s = %.4f in > box.h %.4f —— "
                                "max_lines 应按基础字号反算（或加高 box）"
                                % (where, max_lines, line_h, tail, need, box["h"]))
        elif not isinstance(fit, dict) and _num(base_pt) and isinstance(box, dict) and _num(box.get("h")):
            line_h = base_pt / 72.0 * SINGLE_LINE_EM * ls
            if line_h > box["h"] + _TOL_IN:
                errs.append("%s 单行高 %.4f in 已超出 box.h %.4f，且无 autofit 可缩（应加 autofit 或加高 box）"
                            % (where, line_h, box["h"]))
    _check_color(where + ".fill", e.get("fill"), allowed, errs)
    line = e.get("line")
    if isinstance(line, dict):
        _check_color(where + ".line.color", line.get("color"), allowed, errs)
    bar = e.get("accent_bar")
    if isinstance(bar, dict):
        _check_color(where + ".accent_bar.fill", bar.get("fill"), allowed, errs)
    bullet = e.get("bullet")
    if isinstance(bullet, dict):
        _check_color(where + ".bullet.color", bullet.get("color"), allowed, errs)


def _pptx_problems(p, colors=None):
    """pptx 段几何校验（②a）：页内不越界、引用不悬空、网格与组件自洽。

    只做**结构性**校验（不查字体是否安装、不查对比度）：那些由 sample 目检与
    allowed_fonts 白名单在渲染期负责。错误信息一律中文单行、带具体数值。
    """
    errs = []
    if not isinstance(p, dict):
        return ["pptx 应为对象"]
    slide = p.get("slide") or {}
    w_emu, h_emu = slide.get("width_emu"), slide.get("height_emu")
    if not (_num(w_emu) and _num(h_emu) and w_emu > 0 and h_emu > 0):
        errs.append("pptx.slide 需要正的 width_emu / height_emu")
        return errs
    page_w, page_h = w_emu / EMU_PER_INCH, h_emu / EMU_PER_INCH

    sizes = p.get("sizes_pt")
    if not isinstance(sizes, dict) or not sizes:
        errs.append("pptx.sizes_pt 缺失或为空")
        sizes = {}
    for k, v in sizes.items():
        if not (_num(v) and v > 0):
            errs.append("pptx.sizes_pt.%s 应为正数（字号 pt）" % k)

    roles = p.get("color_roles")
    if not isinstance(roles, dict) or not roles:
        errs.append("pptx.color_roles 缺失或为空")
        roles = {}
    base_tokens = _color_tokens(colors)
    for k, v in roles.items():
        if str(k).startswith("_"):
            continue
        if isinstance(v, str):
            _check_color("pptx.color_roles.%s" % k, v, base_tokens, errs)
        elif isinstance(v, dict):
            for kk, vv in v.items():
                if not str(kk).startswith("_"):
                    _check_color("pptx.color_roles.%s.%s" % (k, kk), vv, base_tokens, errs)
    allowed = {k for k, v in roles.items()
               if not str(k).startswith("_") and isinstance(v, str)}
    for k, v in roles.items():
        if isinstance(v, dict):   # chart_series 这类子表：允许「父.子」，但不允许整体作为色值
            allowed.update("%s.%s" % (k, kk) for kk, vv in v.items()
                           if isinstance(vv, str) and not str(kk).startswith("_"))
    allowed |= base_tokens
    spacing = p.get("spacing") or {}
    default_ls = float(spacing["line_spacing"]) if _num(spacing.get("line_spacing")) else 1.0

    components = p.get("components")
    if components is None:
        components = {}
    elif not isinstance(components, dict):
        errs.append("pptx.components 应为对象")
        components = {}

    groups = {}

    def _take_elements(where, holder):
        """取 elements：必须是**非空数组**（空页型/空骨架静默通过是 2026-09-16 复核抓出的漏检）。"""
        els = holder.get("elements")
        if not isinstance(els, list) or not els:
            errs.append("%s.elements 应为**非空**数组（否则会静默渲染成空白页）" % where)
            return []
        return els

    cp = p.get("content_page")
    if cp is not None:
        if not isinstance(cp, dict):
            errs.append("pptx.content_page 应为对象")
        else:
            groups["content_page"] = _take_elements("pptx.content_page", cp)
    layouts = p.get("layouts")
    if not isinstance(layouts, dict) or not layouts:
        errs.append("pptx.layouts 缺失或为空")
        layouts = {}
    for name in REQ_PPTX_LAYOUTS:
        if not isinstance(layouts.get(name), dict):
            errs.append("pptx.layouts 缺页型 %s（②a 契约：%s 三类必须齐全）"
                        % (name, " / ".join(REQ_PPTX_LAYOUTS)))
    for name, lay in layouts.items():
        if name.startswith("_"):
            continue
        if not isinstance(lay, dict):
            errs.append("pptx.layouts.%s 应为对象" % name)
            continue
        groups["layouts.%s" % name] = _take_elements("pptx.layouts.%s" % name, lay)
        _check_color("pptx.layouts.%s.background" % name, lay.get("background"), allowed, errs)
    # inherits 两阶段校验：先建完全部段再查引用，否则「继承后声明的段」会被误报为不存在
    for name, lay in layouts.items():
        if name.startswith("_") or not isinstance(lay, dict):
            continue
        ref = lay.get("inherits")
        if ref and ref not in groups:
            errs.append("pptx.layouts.%s 的 inherits=%r 指向不存在的段" % (name, ref))

    slots = {}
    for elements in groups.values():
        if not isinstance(elements, list):
            continue
        for e in elements:
            if isinstance(e, dict) and e.get("role") == "grid" and e.get("slot"):
                slots[str(e["slot"])] = (e.get("col_w_in"), e.get("row_h_in"))

    for gname, elements in groups.items():
        if not isinstance(elements, list):
            errs.append("pptx.%s.elements 应为数组" % gname)
            continue
        for i, e in enumerate(elements):
            _check_pptx_element("%s.elements[%d]" % (gname, i), e, page_w, page_h,
                                sizes, allowed, components, errs, default_ls=default_ls)

    for cname, comp in components.items():
        if cname.startswith("_") or not isinstance(comp, dict):
            continue
        elements = comp.get("elements")
        if elements is None:
            continue
        if not isinstance(elements, list):
            errs.append("pptx.components.%s.elements 应为数组" % cname)
            continue
        slot_w, slot_h = slots.get(cname, (None, None))
        relative = comp.get("coord") == "relative"
        _check_color("pptx.components.%s.fill" % cname, comp.get("fill"), allowed, errs)
        line = comp.get("line")
        if isinstance(line, dict):
            _check_color("pptx.components.%s.line.color" % cname, line.get("color"), allowed, errs)
        bar = comp.get("accent_bar")
        if isinstance(bar, dict):
            _check_color("pptx.components.%s.accent_bar.fill" % cname, bar.get("fill"), allowed, errs)
        for i, e in enumerate(elements):
            _check_pptx_element("components.%s.elements[%d]" % (cname, i), e,
                                slot_w or page_w, slot_h or page_h,
                                sizes, allowed, components, errs, relative=relative,
                                default_ls=default_ls)
    return errs


def deep_merge(base, override):
    """深度合并：dict 递归，其它类型整体替换。与 style_spec.deep_merge 同语义（此处不 import，保持零依赖）。"""
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _merge_chain(base_id, spec, specs_by_id, _seen=None):
    """沿 extends 链逐层合并，返回合并后的完整规格；基座缺失或成环返回 None。

    必要性（2026-09-16 独立复核）：主题**一律 extends standard 派生**（55 号 3.4#4），
    若只校验继承件自身的覆盖段，则所有真实自定义主题（compact.json 即此形态）
    都会绕过 pptx 几何校验 —— 等于新校验形同虚设。
    """
    _seen = set() if _seen is None else _seen
    if base_id in _seen:
        return None
    _seen.add(base_id)
    base = specs_by_id.get(base_id)
    if not isinstance(base, dict):
        return None
    parent_id = base.get("extends")
    if isinstance(parent_id, str) and parent_id:
        base = _merge_chain(parent_id, base, specs_by_id, _seen)
        if base is None:
            return None
    return deep_merge(base, {k: v for k, v in spec.items() if k != "extends"})


def validate(name, s, specs_by_id=None):
    errs = []
    for k in ("schema", "id"):
        if k not in s:
            errs.append("缺顶层键 %s" % k)
    if "extends" in s:
        # 继承件（部分规格）：校验自身覆盖段结构 + **合并基座后**校验 pptx 几何
        base_id = s.get("extends")
        if not base_id:
            errs.append("extends 为空")
        for seg in ("word", "excel", "colors", "pptx"):
            if seg in s and not isinstance(s[seg], dict):
                errs.append("%s 应为对象" % seg)
        if isinstance(base_id, str) and base_id:
            if not specs_by_id:
                errs.append("无法取得 specs/ 内的全部规格，extends=%r 的合并校验被跳过" % base_id)
            else:
                merged = _merge_chain(base_id, s, specs_by_id)
                if merged is None:
                    errs.append("extends 指向的基座 %r 不在 specs/ 内（或成环），无法校验合并后的 pptx 几何" % base_id)
                elif "pptx" in merged:
                    errs.extend(["[extends %s 合并后] %s" % (base_id, e)
                                 for e in _pptx_problems(merged["pptx"], merged.get("colors") or {})])
    else:
        # 完整规格：必需段与必需样式
        for k in ("word", "excel"):
            if k not in s:
                errs.append("缺顶层键 %s" % k)
        w = s.get("word") or {}
        for k in REQ_WORD:
            if k not in w:
                errs.append("word 缺 %s" % k)
        if not (w.get("styles") or {}).get("Normal"):
            errs.append("word.styles.Normal 缺失")
        e = s.get("excel") or {}
        for k in REQ_EXCEL:
            if k not in e:
                errs.append("excel 缺 %s" % k)
        # pptx 段可选（纯 Word/Excel 规格不受影响）；一旦出现就按 ②a 几何契约全量校验
        if "pptx" in s:
            errs.extend(_pptx_problems(s["pptx"], s.get("colors") or {}))
    if errs:
        die("规格 %s 校验失败：%s" % (name, "；".join(errs)))
    return True


def find_profile_specs(profile_root=None):
    if profile_root:
        p = Path(profile_root) / "specs"
        return p if p.is_dir() else None
    home = Path.home()
    for prof in ("desktop", "web"):
        p = home / ".dsh" / "profiles" / prof / "node_modules" / "dsh-doc-suite" / "specs"
        if p.is_dir():
            return p
    return None


def sync_specs(dst_dir, only=None):
    rows = []
    for p in sorted(SPECS.glob("*.json")):
        s = json.loads(p.read_text(encoding="utf-8"))
        if only and s.get("id") != only:
            continue
        d = Path(dst_dir) / p.name
        shutil.copy2(p, d)
        a, b = sha256(p), sha256(d)
        rows.append((p.name, a[:10], b[:10], a == b))
    return rows


_AMAP = {"justify": "两端对齐", "center": "居中", "left": "左", "right": "右", "both": "两端对齐"}


def _row(*cells):
    return "| " + " | ".join(str(c) for c in cells) + " |"


def _box_txt(box):
    if not isinstance(box, dict):
        return "-"
    return "%s, %s, %s, %s" % tuple(box.get(k, "-") for k in _BOX_KEYS)


def _element_rows(A, elements):
    A(_row("元素", "位置 x,y,w,h（英寸）", "字号", "色角色", "备注"))
    A("|---|---|---|---|---|")
    for el in elements:
        note = []
        if el.get("role") == "grid":
            note.append("网格 %s 列 × 最多 %s 行 · 列宽 %s · 行高 %s · 间距 %s · 槽位 %s"
                        % (el.get("cols"), el.get("max_rows"), el.get("col_w_in"),
                           el.get("row_h_in"), el.get("gap_in"), el.get("slot")))
        if el.get("bullet"):
            note.append("项目符号 " + str((el.get("bullet") or {}).get("char")))
        if el.get("autofit"):
            note.append("下限 %spt / 最多 %s 行"
                        % ((el["autofit"] or {}).get("min_size_pt"), (el["autofit"] or {}).get("max_lines")))
        if el.get("optional"):
            note.append("可选")
        text = el.get("text") or {}
        A(_row(el.get("role"), _box_txt(el.get("box")), text.get("size", "-"),
               text.get("color") or el.get("fill") or "-", "；".join(note)))


def _render_pptx(A, pp):
    sizes = pp.get("sizes_pt") or {}
    croles = pp.get("color_roles") or {}
    slide = pp.get("slide") or {}
    w_emu = slide.get("width_emu") or 0
    h_emu = slide.get("height_emu") or 0
    A("## PPT 版式（pptx 段）")
    A("")
    A(_row("项", "值"))
    A("|---|---|")
    A(_row("页面（英寸）", "%.4f × %.4f" % (w_emu / EMU_PER_INCH, h_emu / EMU_PER_INCH)))
    mg = pp.get("margin") or {}
    if mg:
        A(_row("页边距（英寸）", "上 %s / 下 %s / 左 %s / 右 %s"
               % (mg.get("top"), mg.get("bottom"), mg.get("left"), mg.get("right"))))
    A(_row("字体", "标题 %s / 正文 %s" % ((pp.get("fonts") or {}).get("heading", {}).get("ea"),
                                        (pp.get("fonts") or {}).get("body", {}).get("ea"))))
    A(_row("字号阶梯（pt）", " · ".join("%s=%s" % (k, v) for k, v in sizes.items())))
    A(_row("色角色", " · ".join("%s=%s" % (k, v) for k, v in croles.items()
                               if isinstance(v, str) and not str(k).startswith("_"))))
    A("")
    cp = pp.get("content_page") or {}
    if cp.get("elements"):
        A("### 内容页共用骨架 content_page")
        A("")
        _element_rows(A, cp["elements"])
        A("")
    for name in REQ_PPTX_LAYOUTS:
        lay = (pp.get("layouts") or {}).get(name)
        if not isinstance(lay, dict):
            continue
        tail = "（inherits %s）" % lay.get("inherits") if lay.get("inherits") else ""
        A("### 页型 %s%s" % (name, tail))
        A("")
        _element_rows(A, lay.get("elements") or [])
        A("")
    for cname, comp in (pp.get("components") or {}).items():
        if cname.startswith("_") or not isinstance(comp, dict) or not comp.get("elements"):
            continue
        A("### 组件 %s（%s）" % (cname, comp.get("coord", "absolute")))
        A("")
        _element_rows(A, comp["elements"])
        A("")


def render_doc(spec):
    s = spec
    w = s.get("word") or {}
    e = s.get("excel") or {}
    c = s.get("colors") or {}
    L = []
    A = L.append
    A("# 规格展示 · " + str(s.get("name", s.get("id"))) + "（" + str(s.get("id")) + "）")
    A("")
    A("> 由 spec_sync.py 自动生成；真相源为 specs/*.json，请改 JSON 后重新生成。")
    if s.get("extends"):
        A("> 本规格继承自：" + str(s.get("extends")) + "（仅列出自身覆盖项）")
    A("")
    A("## 基本信息")
    A("")
    A(_row("项", "值"))
    A("|---|---|")
    for k in ("id", "name", "version", "updated", "extends", "mood"):
        if s.get(k):
            A(_row(k, s[k]))
    if s.get("best_for"):
        A(_row("best_for（适用场合）", " / ".join(s["best_for"])))
    A("")
    p = w.get("page") or {}
    if p:
        m = p.get("margins_cm") or {}
        A("## 页面")
        A("")
        A(_row("纸型", str(p.get("size")) + " " + str(p.get("orientation"))))
        if m:
            A(_row("页边距(cm)", "上 " + str(m.get("top")) + " / 下 " + str(m.get("bottom")) + " / 左 " + str(m.get("left")) + " / 右 " + str(m.get("right"))))
        A("")
    fonts = w.get("fonts") or {}
    if fonts:
        A("## 字体")
        A("")
        A(_row("角色", "字体", "说明"))
        A("|---|---|---|")
        for k, v in fonts.items():
            A(_row(k, v.get("ea"), ("西文 " + str(v.get("latin"))) if v.get("latin") else ""))
        if w.get("allowed_fonts"):
            A(_row("allowed_fonts", ", ".join(w["allowed_fonts"]), "白名单外字体即拒绝产出"))
        A("")
    styles = w.get("styles") or {}
    if styles:
        A("## 段落样式")
        A("")
        A(_row("角色", "中文标识", "字号(pt)", "加粗", "对齐", "行距", "段前/段后", "缩进"))
        A("|---|---|---|---|---|---|---|---|")
        for k, v in styles.items():
            ind = []
            if v.get("first_line_chars"):
                ind.append("首行 " + str(v["first_line_chars"]) + " 字符")
            if v.get("hanging_chars"):
                ind.append("悬挂 " + str(v["hanging_chars"]) + " 字符")
            A(_row(k, v.get("size_name", "-"), v.get("size_pt"), "加粗" if v.get("bold") else "常规",
                   _AMAP.get(str(v.get("align")), v.get("align")), v.get("line_spacing"),
                   str(v.get("space_before_pt")) + "/" + str(v.get("space_after_pt")),
                   "；".join(ind) if ind else "无"))
        A("")
    t = w.get("table") or {}
    if t:
        h = t.get("header") or {}
        b = t.get("body") or {}
        bd = t.get("borders") or {}
        A("## 表格")
        A("")
        A(_row("项", "值"))
        A("|---|---|")
        A(_row("宽度模式", t.get("width_mode")))
        A(_row("表头", "底纹 " + str(h.get("shading")) + "、" + ("加粗" if h.get("bold") else "常规") + "、" + str(h.get("align"))))
        A(_row("表内文字", str(b.get("size_pt")) + "pt、" + str(b.get("align"))))
        A(_row("边框", str(bd.get("style")) + "、" + str(bd.get("size")) + "pt、" + str(bd.get("color"))))
        A(_row("跨页重复表头", t.get("repeat_header")))
        A("")
    if c:
        sem = c.get("semantic") or {}
        A("## 色板")
        A("")
        A(_row("角色", "色值", "用途"))
        A("|---|---|---|")
        A(_row("主色 primary", "#" + str(c.get("primary")), "标题 / 表头底纹"))
        A(_row("辅助 secondary", "#" + str(c.get("secondary")), "次级元素"))
        A(_row("强调 accent（文字）", "#" + str(c.get("accent")), "关键数据文字"))
        if c.get("accent_decor"):
            A(_row("强调 accent_decor（装饰）", "#" + str(c.get("accent_decor")), "底纹 / 线框 / 图表"))
        A(_row("语义-通过 pass", "#" + str(sem.get("pass")), "合格 / 正常"))
        A(_row("语义-风险 risk", "#" + str(sem.get("risk")), "不满足 / 风险"))
        A(_row("语义-注意 warn（文字）", "#" + str(sem.get("warn")), "待确认"))
        if sem.get("warn_decor"):
            A(_row("语义-注意 warn_decor", "#" + str(sem.get("warn_decor")), "底纹 / 线框"))
        A("")
    pp = s.get("pptx") or {}
    if pp:
        _render_pptx(A, pp)
    if e:
        f = e.get("font") or {}
        eh = e.get("header") or {}
        eb = e.get("border") or {}
        pr = e.get("print") or {}
        A("## Excel")
        A("")
        A(_row("项", "值"))
        A("|---|---|")
        A(_row("字体", str(f.get("name")) + " " + str(f.get("size")) + "pt" + ("（" + str(f.get("size_name")) + "）" if f.get("size_name") else "")))
        A(_row("表头", "底纹 " + str(eh.get("shading")) + "、加粗、居中、冻结 " + str(eh.get("freeze"))))
        A(_row("边框", str(eb.get("style")) + "（" + str(eb.get("scope")) + "）、颜色 " + str(eb.get("color"))))
        A(_row("打印", str(pr.get("paper")) + " " + str(pr.get("orientation")) + "、缩放 " + str(pr.get("fit_to_width")) + " 页宽"))
        A("")
    notes = [("%s.%s" % ("word", k), v) for k, v in w.items() if k.startswith("_note") and isinstance(v, str)]
    notes += [("%s.%s" % ("colors", k), v) for k, v in c.items() if k.startswith("_note") and isinstance(v, str)]
    notes += [("%s.%s" % ("pptx", k), v) for k, v in (s.get("pptx") or {}).items()
              if k.startswith("_note") and isinstance(v, str)]
    if notes:
        A("## 内嵌说明")
        A("")
        for k, v in notes:
            A("- **" + k + "**：" + v)
        A("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="dsh-doc-suite 规格：校验 / 同步 profile / 生成展示文档")
    ap.add_argument("--check", action="store_true", help="只校验，不写任何文件（CI 用）")
    ap.add_argument("--no-sync", action="store_true", help="不同步 profile 副本")
    ap.add_argument("--profile-root", help="profile 内模块目录（含 specs/）；缺省自动探测")
    ap.add_argument("--doc-out", help="规格展示 Markdown 输出路径；缺省打印到标准输出")
    ap.add_argument("--spec", help="只处理指定规格 id")
    args = ap.parse_args(argv)

    specs = load_specs(args.spec)
    specs_by_id = {s["id"]: s for s in specs.values() if isinstance(s.get("id"), str)}
    for name, s in specs.items():
        validate(name, s, specs_by_id)
    print("[1/3] 规格校验通过：%s" % "、".join(specs))

    if args.check:
        print("[2/3] --check：跳过同步与生成")
        print("[3/3] 完成")
        return 0

    if args.no_sync:
        print("[2/3] --no-sync：跳过 profile 同步")
    else:
        dst = find_profile_specs(args.profile_root)
        if dst is None:
            print("[2/3] 未找到 profile 副本目录（可用 --profile-root 指定）—— 跳过同步")
        else:
            rows = sync_specs(dst, args.spec)
            bad = [r for r in rows if not r[3]]
            for n, a, b, ok in rows:
                print("       %s  %s  %s  %s" % (n, a, b, "一致" if ok else "★不一致"))
            if bad:
                print("       → 同步后仍不一致，请检查写入权限", file=sys.stderr)
                return 3
            print("[2/3] 已同步 %d 个规格到 %s" % (len(rows), dst))

    want_doc = args.doc_out or (not args.check)
    if args.doc_out:
        blocks = [render_doc(s) for s in specs.values()]
        text = ("\n\n---\n\n").join(blocks)
        Path(args.doc_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.doc_out).write_text(text, encoding="utf-8")
        print("[3/3] 展示文档已写入：%s" % args.doc_out)
    else:
        for s in specs.values():
            print(render_doc(s))
        print("", file=sys.stderr)
        print("[3/3] 展示文档已打印到标准输出（用 --doc-out 可写入文件）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print("spec_sync 失败：%s" % exc, file=sys.stderr)
        sys.exit(2)
