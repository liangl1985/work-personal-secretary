# -*- coding: utf-8 -*-
"""文档角色识别 + 表格列对齐判定 —— A 线样式能力共享层（A2.1）。

依据：02_分析笔记/36_投标文件格式画像（默认模板依据）实测结论
  * 编号模式（正文未套命名样式时**唯一可用**信号 —— 该投标文件 2528 段 style=None）：
      N.        -> heading_1   （如「1.产品主要技术参数指标」）
      N.M       -> heading_2   （如「1.1 技术规范书响应」）
      （N）      -> heading_3
      A：/B:    -> heading_4
  * 命名样式（heading 1-3 / 标题 1-3 / toc）优先于编号模式。
  * 居中 + 无编号 + 位于文首区 + 短文本 -> doc_title（封面大标题）。

红线：本模块**只读文本用于判定**，绝不改写任何文本（内容零改动断言在落盘侧把关）。
"""
from __future__ import annotations

import re

# 顺序敏感：N.M 必须先于 N. 判定
_NUM_PATTERNS = [
    ("heading_2", re.compile(r"^\s*\d+(?:\.\d+){1,3}[\.、]?\s+\S")),          # 1.1 / 1.1.2
    ("heading_1", re.compile(r"^\s*\d+[\.、]\s*\S")),                            # 1. / 1、
    ("heading_3", re.compile(r"^\s*[（(]\s*\d+\s*[）)]\s*\S")),                  # （1）
    ("heading_1", re.compile(r"^\s*[一二三四五六七八九十]{1,3}[、\.]\s*\S")),        # 一、 / 五、  ← 中文数字顿号
    ("heading_2", re.compile(r"^\s*[（(]\s*[一二三四五六七八九十]{1,3}\s*[）)]\s*\S")),  # （一）
    ("heading_4", re.compile(r"^\s*[A-Za-z][：:]\s*\S")),                          # A： / B:
]

_STYLE_ALIASES = {
    "heading_1": ("heading 1", "heading1", "标题 1", "标题1"),
    "heading_2": ("heading 2", "heading2", "标题 2", "标题2"),
    "heading_3": ("heading 3", "heading3", "标题 3", "标题3"),
    "heading_4": ("heading 4", "heading4", "标题 4", "标题4"),
}
_TOC_HINTS = ("toc", "目录")
# 元信息行（日期/编制/来源…）即使居中且短，也不是封面大标题
_TITLE_EXCLUDE = ("日期", "编制", "来源", "页码", "版本", "修订", "联系", "电话", "邮箱", "第 页", "共 页")

_NUMERIC_RE = re.compile(r"^[-+±]?[\d,，]+(?:\.\d+)?\s*(?:%|‰)?$")
_NUMERIC_UNIT_RE = re.compile(
    r"^[-+±]?[\d,，]+(?:\.\d+)?\s*(?:元|万元|亿元|台|套|个|只|条|米|千米|km|m|kv|v|a|w|kw|mw|mm|cm|kg|t|次|人|天|小时|页|项|点)\s*$",
    re.IGNORECASE,
)


def style_role(style_name: str | None) -> str | None:
    """命名样式名 -> 角色（toc/目录 返回 'toc'）。"""
    if not style_name:
        return None
    low = str(style_name).strip().lower()
    for role, names in _STYLE_ALIASES.items():
        for n in names:
            if low == n.lower():
                return role
    if any(h in low for h in _TOC_HINTS):
        return "toc"
    return None


def number_role(text: str | None) -> str | None:
    """编号模式 -> 角色（无编号返回 None）。"""
    if not text:
        return None
    t = str(text).strip()
    if not t or len(t) > 120:
        return None
    for role, pat in _NUM_PATTERNS:
        if pat.match(t):
            return role
    return None


def effective_align(par) -> str | None:
    """段落有效对齐：直接格式优先，其次命名样式。返回 'center'/'left'/... 或 None。"""
    a = getattr(par, "alignment", None)
    if a is not None:
        return str(a).split(" ")[0].strip().lower()
    try:
        a2 = par.style.paragraph_format.alignment
        if a2 is not None:
            return str(a2).split(" ")[0].strip().lower()
    except Exception:  # noqa: BLE001
        pass
    return None


def classify_paragraph(par, index: int, total: int, spec: dict) -> dict:
    """返回 {role, reason}。role ∈ doc_title/heading_1..4/body/toc。

    识别顺序：命名样式 > 编号模式 > 封面大标题启发式 > 正文。
    spec 可含 roles 段：{"title_zone": 30, "title_max_chars": 40, "title_min_index": 0}
    """
    rcfg = (spec or {}).get("roles") or {}
    zone = int(rcfg.get("title_zone", 30))
    max_chars = int(rcfg.get("title_max_chars", 40))

    text = (getattr(par, "text", "") or "").strip()
    sname = None
    try:
        sname = par.style.name if par.style is not None else None
    except Exception:  # noqa: BLE001
        sname = None

    srole = style_role(sname)
    nrole = number_role(text)

    # 编号模式 vs 命名样式冲突 → **以编号模式为准**（主人 2026-09-15 要求：纠正原文层级标记不一致，
    # 例：青海成峰对账说明里「三、」「四、」是 Heading 1，而「五、」被原文标成 Heading 2 → 应为一级标题）
    if nrole and srole and srole != "toc" and nrole != srole:
        return {"role": nrole, "reason": f"编号模式纠正（原文命名样式「{sname}」→ {nrole}）", "corrected": True}

    if srole and srole != "toc":
        return {"role": srole, "reason": f"命名样式「{sname}」"}
    if srole == "toc":
        return {"role": "toc", "reason": f"目录样式「{sname}」"}
    if nrole:
        return {"role": nrole, "reason": "编号模式"}

    align = effective_align(par)
    if (
        text
        and index < zone
        and len(text) <= max_chars
        and not any(k in text for k in _TITLE_EXCLUDE)
        and not text.endswith(("。", "；", "：", "，", ",", ";"))
        and align == "center"
    ):
        return {"role": "doc_title", "reason": "居中+无编号+文首区"}

    return {"role": "body", "reason": "默认"}


# ------------------------------------------------------------------ 列对齐

def looks_numeric(value) -> bool:
    """单元格是否「数值型」（纯数字 / 数字+常见单位）。"""
    if value is None or isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    s = str(value).strip()
    if not s or len(s) > 24:
        return False
    if s.startswith("="):  # 公式也算数值列
        return True
    s2 = s.replace(",", "").replace("，", "").replace(" ", "")
    # 长数字串（发票号 / 统一社会信用代码 / 银行账号等）是**标识**不是数值 —— 不右对齐
    if re.fullmatch(r"\d{13,}", s2):
        return False
    return bool(_NUMERIC_RE.match(s2) or _NUMERIC_UNIT_RE.match(s2))


def resolve_column_align(header, values, table_spec: dict) -> str:
    """列对齐：序号列 -> center；数值列 -> right；其余 -> text_align_default。

    table_spec 可含：
      align_rules: {serial_headers:[...], serial_align, numeric_align, numeric_ratio, text_align_default}
    """
    ar = (table_spec or {}).get("align_rules") or {}
    serial = ar.get("serial_headers") or ["序号", "编号", "项次", "no.", "no"]
    h = str(header or "").strip().lower()
    for kw in serial:
        if kw and str(kw).strip().lower() in h:
            return str(ar.get("serial_align", "center"))
    # 表头语义兜底：该列**暂时为空**（如主人未填单价）时，也能按表头判为数值列
    for kw in ar.get("numeric_headers") or []:
        if kw and str(kw).strip().lower() in h:
            return str(ar.get("numeric_align", "right"))
    vals = [v for v in (values or []) if v not in (None, "")]
    if vals:
        hit = sum(1 for v in vals if looks_numeric(v))
        if hit / len(vals) >= float(ar.get("numeric_ratio", 0.6)):
            return str(ar.get("numeric_align", "right"))
    return str(ar.get("text_align_default", "left"))
