# -*- coding: utf-8 -*-
"""Word 套样式（apply-style / table-style）—— A 线样式能力实现。

红线（来自 34 号实测教训）：
  1. **绝不改正文文本**：本模块只动格式（rPr / pPr / tblPr），不碰 w:t 内容；
  2. **落盘前后逐段+逐单元格比对**，任何差异 → 抛 ContentChangedError，调用方拒绝产出；
  3. **eastAsia 必须显式设**：w:rFonts 的 ascii / hAnsi / eastAsia / cs **四属性全设**
     （只设 font.name 时中文会回落到默认东亚字体 —— 这是踩坑①的实测根因）。
"""
from __future__ import annotations

from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from doc_roles import classify_paragraph, resolve_column_align
from style_spec import assert_content_unchanged, word_snapshot

_ALIGN = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}
_VALIGN = {
    "top": WD_ALIGN_VERTICAL.TOP,
    "center": WD_ALIGN_VERTICAL.CENTER,
    "bottom": WD_ALIGN_VERTICAL.BOTTOM,
}
_CM = {"A4": (21.0, 29.7), "A3": (29.7, 42.0), "Letter": (21.59, 27.94)}


# ------------------------------------------------------------------ 低层工具

def _rpr(style_or_run):
    el = style_or_run._element if hasattr(style_or_run, "_element") else style_or_run
    return el.get_or_add_rPr()


def _set_rfonts(el, latin: str, ea: str) -> None:
    """四属性全设（ascii/hAnsi/eastAsia/cs）—— 缺 eastAsia 中文必回落。"""
    rpr = el.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rstyle = rpr.find(qn("w:rStyle"))
        if rstyle is not None:
            rstyle.addnext(rfonts)
        else:
            rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), ea)
    rfonts.set(qn("w:cs"), latin)


def _set_indent(style, chars: float, size_pt: float) -> None:
    """首行缩进 N 字符：同时写 w:firstLineChars（Word/WPS 都认）与 w:firstLine（兼容值）。"""
    ppr = style.element.get_or_add_pPr()
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        spacing = ppr.find(qn("w:spacing"))
        jc = ppr.find(qn("w:jc"))
        if spacing is not None:
            spacing.addnext(ind)
        elif jc is not None:
            jc.addprevious(ind)
        else:
            ppr.append(ind)
    if chars:
        ind.set(qn("w:firstLineChars"), str(int(chars * 100)))
        ind.set(qn("w:firstLine"), str(int(chars * size_pt * 20)))
    else:
        for attr in ("w:firstLineChars", "w:firstLine"):
            if ind.get(qn(attr)) is not None:
                del ind.attrib[qn(attr)]


def _set_outline_level(style, level: int) -> None:
    ppr = style.element.get_or_add_pPr()
    el = ppr.find(qn("w:outlineLvl"))
    if el is None:
        el = OxmlElement("w:outlineLvl")
        jc = ppr.find(qn("w:jc"))
        if jc is not None:
            jc.addnext(el)
        else:
            ppr.append(el)
    el.set(qn("w:val"), str(int(level)))


def iter_all_paragraphs(doc):
    """遍历正文 + 表格（含嵌套表格）内的全部段落。

    注意：python-docx 的 doc.paragraphs **不含**表格内段落，这是 A2.3
    「表格文字字体不统一」的根因之一。
    """
    def walk(parent):
        for p in parent.paragraphs:
            yield p
        for t in parent.tables:
            for row in t.rows:
                for cell in row.cells:
                    yield from walk(cell)

    yield from walk(doc)


def _strip_run_fonts(doc) -> int:
    """清 run 级与段落级直接字体/字号（不动文本），让命名样式真正生效。

    覆盖：正文段落、表格（含嵌套）内段落、段落级 pPr/rPr。
    """
    n = 0
    for para in iter_all_paragraphs(doc):
        for run in para.runs:
            rpr = run._element.find(qn("w:rPr"))
            if rpr is None:
                continue
            for tag in ("w:rFonts", "w:sz", "w:szCs"):
                el = rpr.find(qn(tag))
                if el is not None:
                    rpr.remove(el)
                    n += 1
        ppr = para._element.find(qn("w:pPr"))
        if ppr is not None:
            prpr = ppr.find(qn("w:rPr"))
            if prpr is not None:
                for tag in ("w:rFonts", "w:sz", "w:szCs"):
                    el = prpr.find(qn(tag))
                    if el is not None:
                        prpr.remove(el)
                        n += 1
    return n


# ---------------------------------------------------------------- 字体统一（A2.3）

# 样式族规则：把文档里**实际存在但规格未逐条列出**的样式按角色族统一字体。
# 可用规格 word.style_families 覆盖（同名键整体替换）。
DEFAULT_STYLE_FAMILIES = {
    "body": {
        "names": ["Normal", "Body Text", "List Paragraph", "List Bullet", "List Number",
                  "List Continue", "Table Grid", "Normal Table", "No Spacing",
                  "Plain Text", "Table Text", "List"],
        "prefixes": ["List"],
        "font": "body",
    },
    "heading": {
        "names": ["Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5",
                  "Heading 6", "Heading 7", "Heading 8", "Heading 9", "Title", "Subtitle"],
        "prefixes": ["Heading"],
        "font": "h1",
    },
}


def _family_of(style_name: str, families: dict):
    for fam, cfg in families.items():
        if style_name in (cfg.get("names") or []):
            return fam
    for fam, cfg in families.items():
        for pre in (cfg.get("prefixes") or []):
            if style_name.startswith(pre):
                return fam
    return None


def _apply_style_families(doc, wspec: dict) -> list:
    """按角色族统一「规格未列出样式」的字体（只改字体，不动字号与段落格式）。"""
    listed = set((wspec.get("styles") or {}).keys())
    families = wspec.get("style_families") or DEFAULT_STYLE_FAMILIES
    fonts = wspec.get("fonts") or {}
    changed = []
    for style in doc.styles:
        try:
            name = style.name
        except Exception:  # noqa: BLE001
            continue
        if not name or name in listed:
            continue
        fam = _family_of(name, families)
        if fam is None:
            continue
        fkey = (families.get(fam) or {}).get("font") or "body"
        fdef = fonts.get(fkey) or fonts.get("body") or {}
        try:
            _set_rfonts(style.element, fdef.get("latin", "仿宋"),
                        fdef.get("ea", "仿宋"))
        except Exception:  # noqa: BLE001
            continue
        changed.append(name)
    return changed


def effective_fonts(doc) -> dict:
    """统计全文（**含表格**）实际生效的东亚字体分布。

    优先级：run 级 rFonts > 段落级 pPr/rPr > 段落样式链 > 默认。
    用于「字体统一性断言」——不接受「看起来统一了」。
    """
    from collections import Counter

    def style_ea(style):
        seen = set()
        cur = style
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            rpr = cur.element.find(qn("w:rPr"))
            if rpr is not None:
                rf = rpr.find(qn("w:rFonts"))
                if rf is not None and rf.get(qn("w:eastAsia")):
                    return rf.get(qn("w:eastAsia"))
            cur = cur.base_style
        return None

    cnt: Counter = Counter()
    for para in iter_all_paragraphs(doc):
        p_ea = None
        ppr = para._element.find(qn("w:pPr"))
        if ppr is not None:
            prpr = ppr.find(qn("w:rPr"))
            if prpr is not None:
                rf = prpr.find(qn("w:rFonts"))
                if rf is not None:
                    p_ea = rf.get(qn("w:eastAsia"))
        try:
            s_ea = style_ea(para.style) if para.style is not None else None
        except Exception:  # noqa: BLE001
            s_ea = None
        runs = para.runs
        if not runs:
            cnt[p_ea or s_ea or "(默认)"] += 1
            continue
        for run in runs:
            r_ea = None
            rpr = run._element.find(qn("w:rPr"))
            if rpr is not None:
                rf = rpr.find(qn("w:rFonts"))
                if rf is not None:
                    r_ea = rf.get(qn("w:eastAsia"))
            cnt[r_ea or p_ea or s_ea or "(默认)"] += 1
    return dict(cnt)


# ------------------------------------------------------------------ 角色识别（A2.1）

_ROLE_TO_STYLE = {
    "heading_1": "Heading 1",
    "heading_2": "Heading 2",
    "heading_3": "Heading 3",
    "heading_4": "Heading 4",
}


def _ensure_style(doc, name: str):
    """取命名样式；文档没有则新建（基于 Normal），避免 KeyError 静默跳过。"""
    from docx.enum.style import WD_STYLE_TYPE

    try:
        return doc.styles[name]
    except KeyError:
        st = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        try:
            st.base_style = doc.styles["Normal"]
        except KeyError:
            pass
        return st


def _apply_doc_title(par, tcfg: dict, size_pt: float) -> None:
    """封面大标题：直接格式（不新建样式，避免污染文档样式表）。"""
    pf = par.paragraph_format
    if tcfg.get("align") in _ALIGN:
        pf.alignment = _ALIGN[tcfg["align"]]
    if tcfg.get("space_before_pt") is not None:
        pf.space_before = Pt(float(tcfg["space_before_pt"]))
    if tcfg.get("space_after_pt") is not None:
        pf.space_after = Pt(float(tcfg["space_after_pt"]))
    for run in par.runs:
        run.font.size = Pt(float(size_pt))
        if tcfg.get("bold") is not None:
            run.font.bold = bool(tcfg["bold"])
        _set_rfonts(run._element, tcfg.get("latin", "仿宋"), tcfg.get("ea", "仿宋"))


def _title_size(text: str, tcfg: dict) -> float:
    """按封面阶梯给字号（36/22/18/16/14），无法判断用 default。"""
    sizes = tcfg.get("sizes_pt") or {}
    default = float(tcfg.get("default_size_pt", 22))
    t = (text or "").strip()
    if not t:
        return default
    if len(t) <= 6 and ("投标" in t or "文件" in t or "方案" in t):
        return float(sizes.get("cover", default))
    if t.startswith(("（", "(")) or t.endswith(("）", ")")):
        return float(sizes.get("subtitle", default))
    if any(k in t for k in ("编号", "包号", "项目编号")):
        return float(sizes.get("code", default))
    if any(k in t for k in ("投标人", "法定代表人", "供应商", "单位名称")):
        return float(sizes.get("party", default))
    if len(t) >= 8:
        return float(sizes.get("project", default))
    return default


def _apply_roles(doc, spec: dict, wspec: dict) -> dict:
    """角色识别 + 套用，返回**可回溯**报告（--dry-run 时也会打印）。"""
    tcfg = wspec.get("doc_title") or {}
    paras = list(doc.paragraphs)
    total = len(paras)
    counts: dict = {}
    samples: list = []
    corrected: list = []
    styled = 0

    decided = []
    for i, p in enumerate(paras):
        decided.append((i, p, classify_paragraph(p, i, total, spec)))

    for i, p, info in decided:
        role = info["role"]
        counts[role] = counts.get(role, 0) + 1
        if role in _ROLE_TO_STYLE:
            if info.get("corrected") and len(corrected) < 20:
                corrected.append({"para": i, "role": role, "via": info["reason"], "text": (p.text or "")[:40]})
            target = _ROLE_TO_STYLE[role]
            try:
                cur = p.style.name if p.style is not None else None
            except Exception:  # noqa: BLE001
                cur = None
            if cur != target:
                try:
                    p.style = _ensure_style(doc, target)
                    styled += 1
                except Exception:  # noqa: BLE001
                    continue
                if len(samples) < 15:
                    samples.append({"para": i, "role": role, "via": info["reason"], "text": (p.text or "")[:40]})
        elif role == "doc_title":
            _apply_doc_title(p, tcfg, _title_size(p.text or "", tcfg))
            if len(samples) < 15:
                samples.append({"para": i, "role": role, "via": info["reason"], "text": (p.text or "")[:40]})

    return {"counts": counts, "styled": styled, "samples": samples, "corrected": corrected}


# ------------------------------------------------------------------ apply-style

def apply_word_style(src, spec: dict, out=None, dry_run: bool = False) -> dict:
    """对**已有** docx 套版式：页面 + 命名样式（Normal/Heading 1-3）+ 字体四属性。"""
    from docx import Document

    wspec = spec.get("word") or {}
    if not wspec:
        raise ValueError(f"规格 {spec.get('id')} 不含 word 段")

    before = word_snapshot(src)
    doc = Document(str(src))
    report = {"page": 0, "styles": [], "runs_stripped": 0, "tables": 0}

    # ① 页面
    page = wspec.get("page") or {}
    size = _CM.get(str(page.get("size", "A4")), _CM["A4"])
    m = page.get("margins_cm") or {}
    for section in doc.sections:
        section.page_width, section.page_height = Cm(size[0]), Cm(size[1])
        if m:
            section.top_margin = Cm(float(m.get("top", 2.54)))
            section.bottom_margin = Cm(float(m.get("bottom", 2.54)))
            section.left_margin = Cm(float(m.get("left", 3.17)))
            section.right_margin = Cm(float(m.get("right", 3.17)))
        report["page"] += 1

    # ② 命名样式
    fonts = wspec.get("fonts") or {}
    for style_name, cfg in (wspec.get("styles") or {}).items():
        try:
            style = doc.styles[style_name]
        except KeyError:
            continue  # 文档没有该命名样式（如 Heading 4）则跳过，不新建以免污染
        fkey = cfg.get("font") or "body"
        fdef = fonts.get(fkey) or fonts.get("body") or {}
        size_pt = float(cfg.get("size_pt", 12))
        style.font.size = Pt(size_pt)
        if "bold" in cfg:
            style.font.bold = bool(cfg["bold"])
        _set_rfonts(style.element, fdef.get("latin", "仿宋"), fdef.get("ea", "仿宋"))
        pf = style.paragraph_format
        if cfg.get("align") in _ALIGN:
            pf.alignment = _ALIGN[cfg["align"]]
        if cfg.get("line_spacing"):
            pf.line_spacing = float(cfg["line_spacing"])
        if cfg.get("space_before_pt") is not None:
            pf.space_before = Pt(float(cfg["space_before_pt"]))
        if cfg.get("space_after_pt") is not None:
            pf.space_after = Pt(float(cfg["space_after_pt"]))
        _set_indent(style, float(cfg.get("first_line_chars", 0) or 0), size_pt)
        if cfg.get("outline_level") is not None:
            _set_outline_level(style, int(cfg["outline_level"]))
        report["styles"].append(style_name)

    # ②b 样式族补齐（A2.3）：把文档实际存在、规格未列出的样式按角色族统一字体
    report["style_families"] = _apply_style_families(doc, wspec)

    # ③ 清 run 级 / 段落级直接字体（含表格内，让命名样式真正生效）；不动文本
    if wspec.get("strip_run_font", True):
        report["runs_stripped"] = _strip_run_fonts(doc)

    # ④ 角色识别 → 套用（A2.1）：未套命名样式但符合编号模式的段落赋对应 Heading 样式
    if wspec.get("apply_roles", True):
        report["roles"] = _apply_roles(doc, spec, wspec)

    # ⑤ 字体统一性校验（A2.3）：出现规格之外的东亚字体即拒绝产出（防坏产物落盘）
    fonts_after = all_font_names(doc)
    report["fonts"] = fonts_after
    allowed = list(wspec.get("allowed_fonts") or [])
    if allowed:
        bad = {k: v for k, v in fonts_after.items() if k not in allowed}
        if bad:
            raise ValueError(
                f"字体统一性校验失败：出现规格外东亚字体 {bad}（允许：{allowed}）"
            )

    if dry_run:
        return report

    doc.save(str(out or src))
    assert_content_unchanged(before, word_snapshot(out or src), "word")
    return report


# ------------------------------------------------------------------ table-style

def _set_tbl_borders(table, borders: dict) -> None:
    tbl_pr = table._tbl.tblPr
    el = tbl_pr.find(qn("w:tblBorders"))
    if el is None:
        el = OxmlElement("w:tblBorders")
        tbl_pr.append(el)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        node = el.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            el.append(node)
        node.set(qn("w:val"), borders.get("style", "single"))
        node.set(qn("w:sz"), str(int(borders.get("size", 4))))
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), borders.get("color", "auto"))


def _set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)


def _repeat_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    if tr_pr.find(qn("w:tblHeader")) is None:
        tr_pr.append(OxmlElement("w:tblHeader"))


# ------------------------------------------------------------------ 表格宽度自适应（A2.2）

def _display_width(text: str) -> int:
    """显示宽度：全角/宽字符算 2，其余算 1（列宽加权用）。"""
    from unicodedata import east_asian_width

    return sum(2 if east_asian_width(ch) in ("W", "F") else 1 for ch in (text or ""))


def _body_twips(doc, section_index: int = 0) -> int:
    """版心宽度（twips）＝ 页宽 − 左页边距 − 右页边距。"""
    sec = doc.sections[section_index]
    emu = int(sec.page_width or 0) - int(sec.left_margin or 0) - int(sec.right_margin or 0)
    return max(240, int(round(emu / 635.0)))


def _set_tbl_width(tbl, twips: int) -> None:
    """tblW = 版心宽；tblLayout = fixed（关键：否则 Word/WPS 按内容重算列宽）；清 tblInd。"""
    tbl_pr = tbl.tblPr
    el = tbl_pr.find(qn("w:tblW"))
    if el is None:
        el = OxmlElement("w:tblW")
        tbl_pr.append(el)
    el.set(qn("w:w"), str(int(twips)))
    el.set(qn("w:type"), "dxa")
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")
    ind = tbl_pr.find(qn("w:tblInd"))
    if ind is not None:
        ind.set(qn("w:w"), "0")
        ind.set(qn("w:type"), "dxa")


def _col_weights(table, ncols: int, cfg: dict) -> list:
    """列权重 = max(表头显示宽度, 该列数据平均显示宽度)，再按 min/max 夹取。"""
    rows = table.rows
    if not rows:
        return [1.0] * ncols
    wmin = float(cfg.get("min_col_chars", 4))
    wmax = float(cfg.get("max_col_chars", 40))
    head = rows[0]
    weights = []
    for ci in range(ncols):
        wh = _display_width(head.cells[ci].text) if ci < len(head.cells) else 0
        vals = []
        for ri in range(1, min(len(rows), 60)):
            cells = rows[ri].cells
            if ci < len(cells):
                vals.append(_display_width(cells[ci].text))
        wb = (sum(vals) / len(vals)) if vals else 0
        wmx = max(vals) if vals else 0
        # 含最大值加权：让「发票号码」这类长值列多分到宽度（尽量减少折行）
        weights.append(min(max(float(max(wh, wb, wmx * 0.8, 2)), wmin), wmax))
    return weights


def _col_need(table, ncols: int, pad_twips: int = 230, char_twips: int = 110) -> list:
    """**表头不折行**的硬需求（twips）= 表头显示宽度 × 每单位宽 + 单元格内边距。

    优先级（A2.2 实测确定）：① 表头必须一行（主人明确要求）；② 数据短值**尽量**不折行
    （交给权重，含最大值加权）；③ 超长数据（如 19 位发票号在 6 列表格中）**允许折行**
    —— 那是版心物理限制，强行不折行会挤压表头。
    """
    rows = table.rows
    if not rows:
        return [0] * ncols
    head = rows[0]
    needs = []
    for ci in range(ncols):
        wh = _display_width(head.cells[ci].text) if ci < len(head.cells) else 0
        needs.append(wh * char_twips + pad_twips if wh else 0)
    return needs


def _fit_table_width(table, total_twips: int, cfg: dict) -> dict:
    """表格撑满版心 + 列宽自适应；按 gridSpan 正确写每格 tcW（只动表格属性，不写 w:t）。"""
    tbl = table._tbl
    grid = tbl.find(qn("w:tblGrid"))
    cols = grid.findall(qn("w:gridCol")) if grid is not None else []
    ncols = len(cols)
    if ncols == 0:
        return {"cols": 0, "widths": []}

    _set_tbl_width(tbl, total_twips)
    weights = _col_weights(table, ncols, cfg)
    # 两阶段分配：先给「短值列」不折行保底（单列不超版心一半），剩余按权重分
    needs = _col_need(table, ncols)
    cap = int(total_twips * 0.5)
    floors = [min(int(n), cap) for n in needs]
    base = sum(floors)
    if base >= total_twips:
        scale = total_twips / float(base)
        widths = [int(f * scale) for f in floors]
    else:
        rest = total_twips - base
        tot = sum(weights) or 1.0
        widths = [floors[i] + int(rest * weights[i] / tot) for i in range(ncols)]
    widths[-1] += total_twips - sum(widths)  # 舍入差额补给最后一列
    for ci, gc in enumerate(cols):
        gc.set(qn("w:w"), str(widths[ci]))

    for tr in tbl.findall(qn("w:tr")):
        ci = 0
        for tc in tr.findall(qn("w:tc")):
            tc_pr = tc.find(qn("w:tcPr"))
            if tc_pr is None:
                tc_pr = OxmlElement("w:tcPr")
                tc.insert(0, tc_pr)
            span = 1
            gs = tc_pr.find(qn("w:gridSpan"))
            if gs is not None:
                try:
                    span = max(1, int(gs.get(qn("w:val")) or 1))
                except (TypeError, ValueError):
                    span = 1
            chunk = widths[ci:ci + span]
            wsum = sum(chunk) if chunk else widths[min(ci, ncols - 1)]
            el = tc_pr.find(qn("w:tcW"))
            if el is None:
                el = OxmlElement("w:tcW")
                tc_pr.append(el)
            el.set(qn("w:w"), str(int(wsum)))
            el.set(qn("w:type"), "dxa")
            ci += span
    return {"cols": ncols, "widths": widths}


def apply_word_table_style(src, spec: dict, out=None, dry_run: bool = False) -> dict:
    """表格样式：表头底纹/加粗/居中、边框、跨页重复表头、表内字号（不动文本）。"""
    from docx import Document

    wspec = spec.get("word") or {}
    tspec = wspec.get("table") or {}
    if not tspec:
        raise ValueError(f"规格 {spec.get('id')} 不含 word.table 段")

    before = word_snapshot(src)
    doc = Document(str(src))
    hdr_cfg = tspec.get("header") or {}
    body_cfg = tspec.get("body") or {}
    body_size = float(body_cfg.get("size_pt", 10.5))
    body_font = (wspec.get("fonts") or {}).get(body_cfg.get("font", "table"), {})
    report = {"tables": 0, "header_cells": 0, "body_cells": 0}

    width_mode = str(tspec.get("width_mode", "full"))
    body_tw = _body_twips(doc) if width_mode == "full" else 0
    fitted: list = []

    for table in doc.tables:
        report["tables"] += 1
        if width_mode == "full":
            fit = _fit_table_width(table, body_tw, tspec)
            fitted.append({"cols": fit["cols"], "widths_twips": fit["widths"]})
        if tspec.get("style_name"):
            try:
                table.style = tspec["style_name"]
            except KeyError:
                pass
        if tspec.get("borders"):
            _set_tbl_borders(table, tspec["borders"])
        rows = table.rows
        if not rows:
            continue
        if tspec.get("repeat_header", True):
            _repeat_header(rows[0])
        ar = tspec.get("align_rules") or {}
        col_align = {}
        if ar:
            for ci0 in range(len(rows[0].cells)):
                htxt = rows[0].cells[ci0].text
                vals = [rows[ri].cells[ci0].text for ri in range(1, len(rows))]
                col_align[ci0] = resolve_column_align(htxt, vals, tspec)

        for ci, cell in enumerate(rows[0].cells):
            if hdr_cfg.get("shading"):
                _set_cell_shading(cell, hdr_cfg["shading"])
            cell.vertical_alignment = _VALIGN.get(hdr_cfg.get("valign", "center"), WD_ALIGN_VERTICAL.CENTER)
            for p in cell.paragraphs:
                if hdr_cfg.get("align") in _ALIGN:
                    p.alignment = _ALIGN[hdr_cfg["align"]]
                for run in p.runs:
                    if hdr_cfg.get("bold") is not None:
                        run.font.bold = bool(hdr_cfg["bold"])
                    run.font.size = Pt(body_size)
                    _set_rfonts(run._element, body_font.get("latin", "仿宋"), body_font.get("ea", "仿宋"))
            report["header_cells"] += 1
        for row in rows[1:]:
            for ci, cell in enumerate(row.cells):
                cell.vertical_alignment = _VALIGN.get(body_cfg.get("valign", "center"), WD_ALIGN_VERTICAL.CENTER)
                want = col_align.get(ci, body_cfg.get("align"))
                for p in cell.paragraphs:
                    if want in _ALIGN:
                        p.alignment = _ALIGN[want]
                    for run in p.runs:
                        run.font.size = Pt(body_size)
                        _set_rfonts(run._element, body_font.get("latin", "仿宋"), body_font.get("ea", "仿宋"))
                report["body_cells"] += 1

    if fitted:
        report["width_mode"] = width_mode
        report["body_twips"] = body_tw
        report["fitted"] = fitted

    if dry_run:
        return report

    doc.save(str(out or src))
    assert_content_unchanged(before, word_snapshot(out or src), "word")
    return report



def all_font_names(doc) -> dict:
    """统计全文（含表格）出现的**全部字体名**——收集 rFonts 四属性(ascii/hAnsi/eastAsia/cs)。

    用于「字体统一性断言」：本项目全文只允许 1 种字体（仿宋）。
    有效性：run 级 > 段落级 pPr/rPr > 段落样式链（逐属性取首个有值者）。
    """
    from collections import Counter

    attrs = ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs")

    def collect(rfonts):
        out = {}
        if rfonts is None:
            return out
        for a in attrs:
            v = rfonts.get(qn(a))
            if v:
                out[a] = v
        return out

    def style_fonts(style):
        out = {}
        seen = set()
        cur = style
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            rpr = cur.element.find(qn("w:rPr"))
            if rpr is not None:
                for a, v in collect(rpr.find(qn("w:rFonts"))).items():
                    out.setdefault(a, v)
            cur = cur.base_style
        return out

    cnt = Counter()
    for para in iter_all_paragraphs(doc):
        p_fonts = {}
        ppr = para._element.find(qn("w:pPr"))
        if ppr is not None:
            prpr = ppr.find(qn("w:rPr"))
            if prpr is not None:
                p_fonts = collect(prpr.find(qn("w:rFonts")))
        try:
            s_fonts = style_fonts(para.style) if para.style is not None else {}
        except Exception:  # noqa: BLE001
            s_fonts = {}
        runs = para.runs
        if not runs:
            for a in attrs:
                v = p_fonts.get(a) or s_fonts.get(a)
                if v:
                    cnt[v] += 1
            continue
        for run in runs:
            rpr = run._element.find(qn("w:rPr"))
            r_fonts = collect(rpr.find(qn("w:rFonts"))) if rpr is not None else {}
            for a in attrs:
                v = r_fonts.get(a) or p_fonts.get(a) or s_fonts.get(a)
                if v:
                    cnt[v] += 1
    return dict(cnt)
