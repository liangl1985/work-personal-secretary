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

# ---- 标题性判据（2026-09-15 修：正文里的编号引导句曾被误升为标题）----
# 一条「像标题」的编号段落必须同时满足：够短、无句末标点、不含句子级逗号。
# 真标题（如「1.2.1 安全通信网络」「（一）系统概述」）能过；正文句（如「（1）本项目按等保三级建设，…」）过不了。
MAX_HEADING_LEVEL = 5          # 最大标题层级（主人 2026-09-15：最多用到 5 级）
HEADING_MAX_CHARS = 40         # 编号标题长度上限，超过视为正文
_HEADING_TAIL = ("。", "；", "！", "？", "，", ",", ";", ".")   # 以此收尾 → 不是标题
_HEADING_INNER = ("。", "；", "！", "？", "，", ",", ";")          # 含这些 → 不是标题

# 编号模式（按**编号深度**定层级，不再一律压成 2 级）：
#   点号体系 1 / 1.1 / 1.1.1 / 1.1.1.1 / 1.1.1.1.1  → heading_1..5（层级 = 段数）
#   公文体   一、 → 1 ；（一） → 2 ；（1） → 3 ；A： → 4
# 编号后**必须有分隔**（`、` `.` 或空格）—— 这既支持中文「1、标题」（`、` 后可无空格），
# 又能排除 2020.08.21 / 2020年08月 这类以数字开头的日期行。每段限 1–3 位。
_DOTTED_RE = re.compile(r"^\s*(\d{1,3}(?:\.\d{1,3})*)\s*(?:[\.、]\s*|\s+)\S")   # 1. / 1、 / 1.1 / 1.2.1 …
_CN_NUM_RE = re.compile(r"^\s*[一二三四五六七八九十]{1,3}\s*[、\.]\s*\S")        # 一、 / 五、
_CN_PAREN_RE = re.compile(r"^\s*[（(]\s*[一二三四五六七八九十]{1,3}\s*[）)]\s*\S")  # （一）
_AR_PAREN_RE = re.compile(r"^\s*[（(]\s*\d+\s*[）)]\s*\S")                    # （1）
_ALPHA_RE = re.compile(r"^\s*[A-Za-z][：:]\s*\S")                            # A： / B:


def _looks_like_heading(t: str, max_chars: int = HEADING_MAX_CHARS) -> bool:
    """标题性判据：短、不以句末标点收尾、不含句子级标点。"""
    if not t or len(t) > max_chars:
        return False
    if t.endswith(_HEADING_TAIL):
        return False
    if any(k in t for k in _HEADING_INNER):
        return False
    return True


_STYLE_ALIASES = {
    "heading_1": ("heading 1", "heading1", "标题 1", "标题1"),
    "heading_2": ("heading 2", "heading2", "标题 2", "标题2"),
    "heading_3": ("heading 3", "heading3", "标题 3", "标题3"),
    "heading_4": ("heading 4", "heading4", "标题 4", "标题4"),
    "heading_5": ("heading 5", "heading5", "标题 5", "标题5"),
}

# 层级序号（用于「编号模式 vs 命名样式」的差异判定）
_LEVEL_OF = {"heading_1": 1, "heading_2": 2, "heading_3": 3, "heading_4": 4, "heading_5": 5}
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


def detect_numbering_scheme(texts) -> str:
    """判定文档的编号体系（2026-09-15 加）：

      "govdoc" —— 公文体：一、 / （一） / 1. / （1） 四级；
      "dotted" —— 数字点体系：1 / 1.1 / 1.1.1 / 1.1.1.1（默认）。

    判据（按可靠性排序）：出现 `1.1` 形态 → dotted；只有 `（一）` 形态 → govdoc。
    为什么需要：`1、` 在 dotted 里是一级标题，在 govdoc 里是「（一）」之下的三级标题 ——
    同一形态在两套体系里层级不同，必须按整篇文档的口径来判，不能逐段猜。
    """
    texts = [str(t or "") for t in (texts or [])]
    if any(re.match(r"^\s*\d{1,3}\.\d{1,3}(?:\.\d{1,3})*\s*[\s、\.]", t) or re.match(r"^\s*\d{1,3}\.\d{1,3}", t) for t in texts):
        return "dotted"
    if any(_CN_PAREN_RE.match(t) for t in texts):
        return "govdoc"
    return "dotted"


def number_role(text: str | None, max_chars: int = HEADING_MAX_CHARS, scheme: str = "dotted") -> str | None:
    """编号模式 -> 角色（无编号、或不像标题时返回 None）。

    2026-09-15 修（主人：最多用到 5 级标题）：
      * 点号体系按**编号深度**定层级 —— 1 → h1、1.1 → h2、1.2.1 → h3、1.2.3.4 → h4、1.2.3.4.5 → h5，
        不再把 1.1.2 一律压成 heading_2（原实现按 1–3 段点号一律判 h2）；
      * 加**标题性判据**（长度 ≤ max_chars、不以句末标点收尾、不含句子级逗号），
        正文里的编号引导句（「（1）本项目…，…」）不再被误升为标题。
    """
    if not text:
        return None
    t = str(text).strip()
    if not _looks_like_heading(t, max_chars):
        return None
    m = _DOTTED_RE.match(t)
    if m:
        depth = len(m.group(1).split("."))
        # 公文体里「1、」位于「（一）」之下 → 三级；数字点体系里「1.」即一级
        if scheme == "govdoc" and depth == 1:
            return "heading_3"
        return "heading_%d" % min(depth, MAX_HEADING_LEVEL)
    if _CN_NUM_RE.match(t):
        return "heading_1"
    if _CN_PAREN_RE.match(t):
        return "heading_2"
    if _AR_PAREN_RE.match(t):
        return "heading_4" if scheme == "govdoc" else "heading_3"
    if _ALPHA_RE.match(t):
        return "heading_4"
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


def classify_paragraph(par, index: int, total: int, spec: dict, scheme: str = "dotted") -> dict:
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
    nrole = number_role(text, int(rcfg.get("heading_max_chars", HEADING_MAX_CHARS)),
                       str(rcfg.get("numbering_scheme") or scheme or "dotted"))

    # 层级处理策略（spec.roles.level_fix，2026-09-15 新增）：
    #   "always"（默认）—— 编号模式优先：既纠正原文层级标记不一致（如「五、」被标成 Heading 2 → 一级），
    #                     也允许「原文完全没套样式」的稿件靠编号建立层级（36 号画像的主场景）；
    #   "style"        —— 保守：只在段落**已有 Heading 样式**时按编号纠正层级，无样式段落不升标题；
    #   "off"          —— 完全不用编号改层级，只认命名样式。
    level_fix = str(rcfg.get("level_fix", "always")).lower()

    if level_fix in ("always", "style") and nrole and srole and srole != "toc" and nrole != srole:
        # 2026-09-15 修：只在**相差 1 级**时判为「原文标错」并纠正（如青海成峰「五、」被标成 Heading 2 → 一级）；
        # 相差 ≥2 级（如原文 Heading 3 vs 编号模式 heading_1）判为**两套编号体系并存**，尊重原文命名样式，
        # 不做升降 —— 否则混合体系的文档会被整章打乱（实测 C 组稿 9 段错位即由此而来）。
        if abs(_LEVEL_OF.get(nrole, 9) - _LEVEL_OF.get(srole, 9)) <= 1:
            return {"role": nrole, "reason": f"编号模式纠正（原文命名样式「{sname}」→ {nrole}）", "corrected": True}
        return {"role": srole, "reason": f"命名样式「{sname}」（编号模式 {nrole} 与之差 ≥2 级，判为不同体系，不纠正）"}

    if srole and srole != "toc":
        return {"role": srole, "reason": f"命名样式「{sname}」"}
    if srole == "toc":
        return {"role": "toc", "reason": f"目录样式「{sname}」"}
    if nrole and level_fix == "always":
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
