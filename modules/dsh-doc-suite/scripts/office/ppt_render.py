#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PPT 渲染器：manifest → pptx（B 线施工②b 最小版）。

设计依据
--------
- 02_分析笔记/55_dsh-doc-suite PPT能力设计（落地版）.md 第三、四、十一章；
- 02_分析笔记/58_B线设计阶段收尾与实施交接.md 第八节（②b 目标）。
几何真值全部取自 specs/standard.json 的 pptx 段（②a 已定稿、经主人目视确认）：
本脚本不写死任何尺寸、字号与色值，只读规格；改版式请改 specs，不改代码。

命令面（②b 已实现）
--------------------
    render   <manifest.json> <out.pptx> [--theme standard] [--assets DIR] [--dry-run]
    validate <manifest.json> [--theme standard]
    list-layouts [--theme standard]

②b 范围与容错（55 号 3.1）
--------------------------
- 只实现 cover / bullets / cards 三类；未知或未实现 layout → 退化为 bullets 并告警；
- 未知字段忽略；缺必填字段 → exit 2 并指明页号；超 limits.max_slides → 保留首页 + 中段 + 末页；
- notes 与 slides 等长按索引对齐，写入演讲者备注（单页 notes 优先）。

容量口径
--------
    段距 = gap_after_pt ÷ 72（只加在段与段之间）；未写 line_spacing 时回退
    pptx.spacing.line_spacing（1.35）—— 这两点与 spec_sync 完全一致。
    行高 = 字号 ÷ 72 × SINGLE_LINE_EM(1.228) × 行距倍数（WPS 实测，见常量处实测数据）。
    注意：spec_sync 的容量判据拿「字号 × 行距 ÷ 72」当行高，比实际小约 23%，
    即 specs 里声明的 max_lines 偏乐观；渲染器按实际行高判定（更保守，宁缩不溢），
    两者差异属 ②a 几何口径遗留，待 ③a 统一。
文本测量用 Pillow 按字符换行（python-pptx 的 fit_text() 按空格断词，对中文不可用——
ppt_tool.py 已实测结论）；换行实现复用 ppt_tool，避免出现两份测量口径。
超容量时按整磅下探到 autofit.min_size_pt，到下限仍放不下则告警（不静默丢字）。

退出码：0 成功 ｜ 2 参数/输入错（含 manifest 校验失败、主题规格几何不自洽）｜ 5 缺 Pillow 或字体文件
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # scripts/office
SCRIPTS = HERE.parent                            # scripts
MODULE = SCRIPTS.parent                          # 模块根
for _p in (str(HERE), str(SCRIPTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import cli_guard    # noqa: E402
import ppt_tool     # noqa: E402
import spec_sync    # noqa: E402
import style_spec   # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

try:  # python-pptx 是必需依赖；validate / list-layouts 不需要它也能跑
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.oxml.ns import qn
    from pptx.util import Emu, Inches, Pt
    PPTX_OK = True
except Exception:  # pragma: no cover - 缺依赖时由 render 给出可读提示
    PPTX_OK = False

MANIFEST_SCHEMA = MODULE / "specs" / "ppt-manifest.schema.json"
DEFAULT_ASSETS = MODULE / "assets"
USER_ASSETS = Path.home() / ".dsh" / "data" / "dsh-doc-suite" / "assets"

# 55 号第五章：核心 11 类 + 扩展 5 类 = 16 类；②b 只实现前三个
ALL_LAYOUTS = ("cover", "toc", "section", "bullets", "cards", "compare", "data",
               "chart", "table", "quote", "closing",
               "image", "process", "timeline", "case", "qa")
IMPLEMENTED_LAYOUTS = ("cover", "toc", "section", "bullets", "cards", "compare", "data",
                       "chart", "table", "quote", "closing",
                       "image", "process", "timeline", "case", "qa")
ALL_COMPONENTS = ("card", "chip", "kpi", "bar", "ring", "icon", "toc_item", "compare_panel")
IMPLEMENTED_COMPONENTS = ("card", "kpi", "toc_item", "compare_panel",
                        "step", "milestone", "case_card", "qa_item")
FALLBACK_LAYOUT = "bullets"

# 标题性字号键 → 用 fonts.heading；其余用 fonts.body
TITLE_SIZES = ("cover_title", "section_title", "slide_title", "card_title", "subtitle")

EXIT_NO_FONT = 5
EMU_PER_INCH = 914400.0
PX_PER_INCH = 96.0
PX_PER_PT = PX_PER_INCH / 72.0
TOL_IN = 0.002

# 单倍行高系数（WPS 实测，微软雅黑）：行距倍数是乘在「单倍行高」上的，不是直接乘字号。
# 本机实测（2026-09-16 ②b 样张出图后按像素量：1280px / 13.3333in = 96 px/in）：
#   20pt、行距 1.35 → 相邻段起点间距 57px = 行高 44.2px（0.4605 in）+ 段距 10pt(13.3px)；
#   19pt、行距 1.35 → 同段两行间距 42px = 0.4375 in（= 19/72 × 1.228 × 1.35）。
#   而「pt × 1.35 ÷ 72」对 19pt 只有 0.3563 in，低约 23% —— 按那个口径判容量会把放不下的
#   文本判成放得下（②b 样张第 4 页实测溢出）。Pillow 的 font.getmetrics()（≈1.36 em）偏大
#   11%，同样不用。换字体时按同样方法重新校准（出图 → 像素量行间距）。
# 三处必须一致：本文件 / scripts/spec_sync.py / scripts/style-test.mjs（后者有门禁断言）。
SINGLE_LINE_EM = 1.228

_TYPE_CN = {"object": "对象", "array": "数组", "string": "字符串", "integer": "整数",
            "number": "数字", "boolean": "布尔值"}

# 卡片图标兜底：图标名 → 内置几何标记，用**形状**画（坐标精确、天然同心）。
# 为什么不用字体符号字符：字符由 WPS 自行排版，实测白色字符 ink 中心比圆盘中心偏左上
# 1~2px（②c 主人目检后按像素量：96px/in、圆径 46px 下 Δx −0.8~−2.0px / Δy −1.7~+0.5px），
# 放大到大屏就看得出来；改形状后同心度由坐标保证（复核 Δ≤0.5px）。
# assets/icons/ 最小集仍属 ③b，有 PNG 时优先贴图（add_picture 落位同样精确）。
ICON_MARKS = {
    "shield": "DIAMOND", "check": "DIAMOND", "star": "DIAMOND",
    "lock": "ROUNDED_RECTANGLE", "doc": "RECTANGLE", "chart": "RECTANGLE",
    "eye": "DONUT", "user": "OVAL", "cloud": "OVAL", "clock": "OVAL",
    "gear": "HEXAGON", "net": "HEXAGON", "flag": "TRIANGLE", "bolt": "TRIANGLE",
}
ICON_MARK_SCALE = 0.42      # 标记边长 = min(槽宽, 槽高) × 该比例


class ManifestError(cli_guard.InputError):
    """manifest 层面错误（使用者输入问题）→ exit 2，中文单行。"""


class FontMissing(Exception):
    """渲染所需字体文件在本机找不到 → exit 5。"""


# --------------------------------------------------------------------- JSON / 校验

def read_json_file(path, what):
    """读 JSON：禁 BOM（55 号硬约束 1），错误一律中文单行。"""
    p = Path(path)
    try:
        raw = p.read_bytes()
    except OSError as exc:
        raise cli_guard.InputError("%s读取失败: %s（%s）" % (what, p, exc))
    if raw[:3] == b"\xef\xbb\xbf":
        raise ManifestError("%s含 BOM，请用 Python/Node 写 JSON（PowerShell 会带 BOM）：%s" % (what, p))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ManifestError("%s不是 UTF-8 编码: %s（%s）" % (what, p, exc))
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ManifestError("%s不是合法 JSON: %s（第 %d 行第 %d 列：%s）"
                            % (what, p, exc.lineno, exc.colno, exc.msg))


def _kind(value):
    if isinstance(value, bool):
        return "布尔值"
    if isinstance(value, dict):
        return "对象"
    if isinstance(value, list):
        return "数组"
    if isinstance(value, str):
        return "字符串"
    if isinstance(value, int):
        return "整数"
    if isinstance(value, float):
        return "数字"
    if value is None:
        return "null"
    return type(value).__name__


def _type_ok(value, t):
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "string":
        return isinstance(value, str)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "boolean":
        return isinstance(value, bool)
    return True


def _resolve_ref(root, ref):
    if not str(ref).startswith("#/"):
        raise cli_guard.InputError("manifest 规范里的 $ref 不受支持（只认 #/ 内部引用）：%s" % ref)
    node = root
    for part in str(ref)[2:].split("/"):
        node = node.get(part) if isinstance(node, dict) else None
        if node is None:
            raise cli_guard.InputError("manifest 规范里的 $ref 悬空：%s" % ref)
    return node


def _cond_matches(data, cond):
    """if 条件子集：required / properties（递归 const / enum）。够表达「按 layout 分派」。"""
    if not isinstance(data, dict):
        return False
    for key in cond.get("required") or []:
        if key not in data:
            return False
    for key, sub in (cond.get("properties") or {}).items():
        if key not in data or not isinstance(sub, dict):
            continue
        if "const" in sub and data[key] != sub["const"]:
            return False
        if "enum" in sub and data[key] not in sub["enum"]:
            return False
        if "properties" in sub and not _cond_matches(data[key], sub):
            return False
    return True


def _validate(value, schema, root, path, errors):
    """JSON Schema 子集校验（零依赖）：type / required / properties / items / allOf / if-then / $ref。"""
    if not isinstance(schema, dict):
        return
    if "$ref" in schema:
        _validate(value, _resolve_ref(root, schema["$ref"]), root, path, errors)
        return
    t = schema.get("type")
    if t and not _type_ok(value, t):
        errors.append("%s：应为%s，实得 %s" % (path, _TYPE_CN.get(t, t), _kind(value)))
        return
    if "const" in schema and value != schema["const"]:
        errors.append("%s：应为 %r，实得 %r" % (path, schema["const"], value))
    if "enum" in schema and value not in schema["enum"]:
        errors.append("%s：只能是 %s 之一，实得 %r"
                      % (path, "、".join(repr(x) for x in schema["enum"]), value))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append("%s：应 ≥ %s，实得 %s" % (path, schema["minimum"], value))
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append("%s：应 > %s，实得 %s" % (path, schema["exclusiveMinimum"], value))
    if isinstance(value, dict):
        for key in schema.get("required") or []:
            if key not in value:
                errors.append("%s：缺必填字段 %s" % (path, key))
        for key, sub in (schema.get("properties") or {}).items():
            if key in value:
                _validate(value[key], sub, root, "%s.%s" % (path, key), errors)
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append("%s：至少 %d 项（实得 %d）" % (path, schema["minItems"], len(value)))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append("%s：最多 %d 项（实得 %d）" % (path, schema["maxItems"], len(value)))
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                _validate(item, item_schema, root, "%s[%d]" % (path, i), errors)
    for sub in schema.get("allOf") or []:
        if not isinstance(sub, dict):
            continue
        if "if" in sub:
            branch = sub.get("then") if _cond_matches(value, sub["if"]) else sub.get("else")
            if isinstance(branch, dict):
                _validate(value, branch, root, path, errors)
        else:
            _validate(value, sub, root, path, errors)


def load_schema():
    if not MANIFEST_SCHEMA.exists():
        raise cli_guard.InputError("找不到 manifest 字段规范: %s（发布件应随 specs/ 提供）" % MANIFEST_SCHEMA)
    schema = read_json_file(MANIFEST_SCHEMA, "manifest 字段规范")
    if not isinstance(schema, dict):
        raise cli_guard.InputError("manifest 字段规范根节点应为对象: %s" % MANIFEST_SCHEMA)
    return schema


def normalize_slides(slides):
    """未知/未实现 layout → 退化为 bullets 并告警（55 号 3.1 兼容规则）。"""
    out, warns = [], []
    for i, s in enumerate(slides, 1):
        if not isinstance(s, dict):
            out.append(s)
            continue
        lay = str(s.get("layout") or "").strip()
        if lay in IMPLEMENTED_LAYOUTS:
            out.append(s)
            continue
        warns.append("第 %d 页：layout=%s ②b 尚未实现 → 退化为 %s 渲染（③a/③b 补齐）"
                     % (i, lay or "(空)", FALLBACK_LAYOUT))
        item = dict(s)
        item["layout"] = FALLBACK_LAYOUT
        out.append(item)
    return out, warns


def apply_max_slides(slides, limits):
    """超 limits.max_slides → 保留首页 + 中段（均匀取样）+ 末页，并告警。"""
    if not isinstance(limits, dict):
        return slides, []
    max_n = limits.get("max_slides")
    if not isinstance(max_n, int) or isinstance(max_n, bool) or max_n < 1 or len(slides) <= max_n:
        return slides, []
    if max_n == 1:
        keep = [slides[0]]
    elif max_n == 2:
        keep = [slides[0], slides[-1]]
    else:
        mids = list(slides[1:-1])
        need = max_n - 2
        if need >= len(mids):
            picks = mids
        elif need == 1:
            picks = [mids[len(mids) // 2]]
        else:
            idxs = sorted({int(round(j * (len(mids) - 1) / (need - 1))) for j in range(need)})
            picks = [mids[i] for i in idxs]
        keep = [slides[0]] + picks + [slides[-1]]
    return keep, ["超出 limits.max_slides=%d：原 %d 页 → 保留 %d 页（首页 + 中段 + 末页）"
                  % (max_n, len(slides), len(keep))]


def validate_manifest(manifest, schema):
    """结构校验；未知 layout 归一化后再校验一轮（补上 bullets 的必填要求）。"""
    errors = []
    _validate(manifest, schema, schema, "manifest", errors)
    slides = manifest.get("slides")
    if isinstance(slides, list):
        normalized, _ = normalize_slides(slides)
        again = []
        copy = dict(manifest)
        copy["slides"] = normalized
        _validate(copy, schema, schema, "manifest", again)
        errors += again
    seen, uniq = set(), []
    for e in errors:
        if e not in seen:
            seen.add(e)
            uniq.append(e)
    return uniq


# --------------------------------------------------------------------- 主题与素材

def load_theme(theme_id):
    """加载主题规格并做 ②a 几何校验（复用 spec_sync，渲染器与校验器同一口径）。"""
    try:
        spec = style_spec.load_spec(theme_id)
    except style_spec.SpecError as exc:
        raise cli_guard.InputError(str(exc))
    except json.JSONDecodeError as exc:
        raise cli_guard.InputError("主题规格不是合法 JSON：%s（%s）" % (theme_id, exc))
    pp = spec.get("pptx")
    if not isinstance(pp, dict) or not pp:
        raise cli_guard.InputError("主题规格 %r 不含 pptx 段，无法渲染 PPT（PPT 规格一律 extends standard 派生）"
                                   % theme_id)
    errs = spec_sync._pptx_problems(pp, spec.get("colors") or {})
    if errs:
        raise cli_guard.InputError("主题规格 %r 的 pptx 几何不自洽：%s" % (theme_id, errs[0]))
    return spec


def resolve_assets(arg):
    """素材目录：--assets（显式） → 使用者自定义层 → 内置 assets/。前一个命中即用（文件级覆盖）。"""
    dirs = []
    if arg:
        p = Path(arg)
        if not p.is_dir():
            raise cli_guard.InputError("--assets 指定的素材目录不存在: %s" % p)
        dirs.append(p)
    dirs.append(USER_ASSETS)
    dirs.append(DEFAULT_ASSETS)
    return dirs


class FontResolver:
    """字体名 → 本机字体文件 + 按磅号缓存的 Pillow 字体对象（映射表复用 ppt_tool）。"""

    def __init__(self):
        self.fonts_dir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        self._paths = {}
        self._fonts = {}

    def path_for(self, name):
        key = str(name).strip().lower()
        if key in self._paths:
            return self._paths[key]
        hints = ppt_tool.FONT_FILE_HINTS.get(key)
        candidates = [hints] if hints else []
        candidates += [key + ".ttf", key + ".ttc", key + ".otf"]
        found = None
        for fn in candidates:
            if not fn:
                continue
            p = self.fonts_dir / fn
            if p.exists():
                found = str(p)
                break
        self._paths[key] = found
        return found

    def load(self, name, pt):
        try:
            from PIL import ImageFont
        except Exception:
            raise FontMissing("Pillow（缺它无法按字符测量文本）")
        path = self.path_for(name)
        if not path:
            raise FontMissing(str(name))
        px = max(1, int(round(pt * PX_PER_PT)))
        key = (path, px)
        if key not in self._fonts:
            self._fonts[key] = ImageFont.truetype(path, px)
        return self._fonts[key]


# --------------------------------------------------------------------- 渲染器

class Renderer:
    """按 specs 的 pptx 几何把 manifest 画成 pptx；dry=True 时只做测量与报告（不建 pptx）。"""

    def __init__(self, spec, asset_dirs, dry=False):
        self.spec = spec
        self.pp = spec.get("pptx") or {}
        self.sizes = self.pp.get("sizes_pt") or {}
        self.roles = self.pp.get("color_roles") or {}
        self.colors = spec.get("colors") or {}
        self.spacing = self.pp.get("spacing") or {}
        self.chrome = self.pp.get("chrome") or {}
        self.default_ls = float(self.spacing.get("line_spacing") or 1.0)
        slide = self.pp.get("slide") or {}
        self.page_w = float(slide.get("width_emu") or 12192000) / EMU_PER_INCH
        self.page_h = float(slide.get("height_emu") or 6858000) / EMU_PER_INCH
        self.fonts_cfg = self.pp.get("fonts") or {}
        self.allowed_fonts = [str(x) for x in (self.pp.get("allowed_fonts") or [])]
        self.asset_dirs = [Path(d) for d in asset_dirs]
        self.resolver = FontResolver()
        self.dry = dry
        self.warnings = []
        self.report = []
        self.current_page = {"entries": []}
        self.heading_font = self._font_name("heading")
        self.body_font = self._font_name("body")
        self._check_fonts_allowed()

    # ---- 规格读取 ----
    def _font_name(self, kind):
        node = self.fonts_cfg.get(kind) or {}
        name = str(node.get("ea") or node.get("latin") or "").strip()
        if not name:
            raise cli_guard.InputError("主题规格的 pptx.fonts.%s 缺字体名（ea / latin）" % kind)
        return name

    def _check_fonts_allowed(self):
        if not self.allowed_fonts:
            return
        for name in (self.heading_font, self.body_font):
            if name not in self.allowed_fonts:
                raise cli_guard.InputError("主题规格用到的字体 %r 不在 pptx.allowed_fonts 白名单内（%s）"
                                           % (name, "、".join(self.allowed_fonts)))

    def _layout(self, name):
        lay = (self.pp.get("layouts") or {}).get(name)
        if not isinstance(lay, dict):
            raise cli_guard.InputError("主题规格的 pptx.layouts 缺页型 %s（②a 契约三类必须齐全）" % name)
        return lay

    def ensure_fonts(self):
        missing = []
        for name in (self.heading_font, self.body_font):
            if not self.resolver.path_for(name):
                missing.append(name)
        if missing:
            raise FontMissing("、".join(sorted(set(missing))))
        self.resolver.load(self.body_font, 20)

    # ---- 基础绘制 ----
    def color(self, token, depth=0):
        """色值解析链：6 位 hex → pptx.color_roles 的键 → 顶层 colors 的键（支持 neutral.light）。"""
        t = str(token if token is not None else "").strip()
        if len(t) == 6 and all(c in "0123456789abcdefABCDEF" for c in t):
            return RGBColor.from_string(t.upper())
        if not t:
            raise cli_guard.InputError("几何里请求了空色值（fill / color 未写）")
        if depth > 4:
            raise cli_guard.InputError("色角色解析过深（疑似循环引用）：%s" % t)
        if t in self.roles:
            return self.color(self.roles[t], depth + 1)
        node = self.colors
        try:
            for part in t.split("."):
                node = node[part]
        except (KeyError, TypeError):
            raise cli_guard.InputError("色值 %r 既不是 6 位 hex，也不是 pptx.color_roles / 顶层 colors 的键" % t)
        return RGBColor.from_string(str(node).upper())

    @staticmethod
    def _geo(box):
        return (Inches(box["x"]), Inches(box["y"]), Inches(box["w"]), Inches(box["h"]))

    def _add_shape(self, slide, box, fill, shape=None):
        if self.dry:
            return None
        shp = slide.shapes.add_shape(shape if shape is not None else MSO_SHAPE.RECTANGLE, *self._geo(box))
        if fill:
            shp.fill.solid()
            shp.fill.fore_color.rgb = self.color(fill)
        else:
            shp.fill.background()
        shp.line.fill.background()
        shp.shadow.inherit = False
        return shp

    def _paint_bg(self, slide, token):
        if token:
            self._add_shape(slide, {"x": 0, "y": 0, "w": self.page_w, "h": self.page_h}, token)

    def _style_run(self, run, pt, bold, color_token, font_name):
        run.font.size = Pt(pt)
        run.font.bold = bool(bold)
        run.font.color.rgb = self.color(color_token)
        run.font.name = font_name
        rPr = run.font._rPr
        for tag in ("a:ea", "a:cs"):    # 中文字体必须显式设 a:ea（55 号硬约束 3）
            rPr.append(rPr.makeelement(qn(tag), {"typeface": font_name}))

    # ---- 文本测量 ----
    def _line_spacing(self, text):
        ls = text.get("line_spacing")
        if isinstance(ls, (int, float)) and not isinstance(ls, bool) and ls > 0:
            return float(ls)
        return self.default_ls      # 与 spec_sync 同口径：未写则回退 pptx.spacing.line_spacing

    @staticmethod
    def _line_h_in(pt, ls):
        """WPS 实际行高：字号 ÷ 72 × 单倍行高系数 × 行距倍数（见 SINGLE_LINE_EM）。"""
        return pt / 72.0 * SINGLE_LINE_EM * ls

    @staticmethod
    def _height_in(counts, line_h, gap_pt, gap_between_only):
        seg = max(0, len(counts) - 1) if gap_between_only else len(counts)
        return sum(counts) * line_h + seg * (gap_pt / 72.0)

    def _fit(self, paras, font_name, w_in, h_in, base_pt, min_pt, ls, gap_pt, gap_between_only):
        """逐磅下探，返回 (采用字号, 每段行数, 采用行高 in, 告警或 None)。"""
        w_px = max(1.0, w_in * PX_PER_INCH)
        top = max(1, int(round(base_pt)))
        bottom = max(1, int(round(min_pt)))
        # 单段单行：spec 的 box.h 是按「字号 × 行距 ÷ 72」设计的，比 WPS 实际行高小 1~3pt。
        # 这类元素（页标题 / 来源行 / 卡片标题 / 封面各元素）只做宽度校验，不因行高收缩字号 ——
        # 否则会把 ②a 已确认的设计字号系统性压小；其溢出量 ≤0.06 in，不会压到相邻元素。
        # 只有多段（要点/卡片正文）与需要换行的长文本才按真实行高严格判定。
        if len(paras) == 1:
            font = self.resolver.load(font_name, top)
            lines, width, _ = ppt_tool._wrap_by_char(paras[0], font, w_px)
            if len(lines) == 1 and width <= w_px + 1:
                return top, [1], self._line_h_in(top, ls), None
        for pt in range(top, bottom - 1, -1):
            font = self.resolver.load(font_name, pt)
            counts, widest = [], 0.0
            for p in paras:
                lines, w, _ = ppt_tool._wrap_by_char(p, font, w_px)
                counts.append(max(1, len(lines)))
                widest = max(widest, float(w))
            if widest > w_px + 1:
                continue
            line_h = self._line_h_in(pt, ls)
            if self._height_in(counts, line_h, gap_pt, gap_between_only) <= h_in + TOL_IN:
                return pt, counts, line_h, None
        font = self.resolver.load(font_name, bottom)
        counts = []
        for p in paras:
            lines, _, _ = ppt_tool._wrap_by_char(p, font, w_px)
            counts.append(max(1, len(lines)))
        return bottom, counts, self._line_h_in(bottom, ls), (
            "缩到下限 %dpt 仍放不下（需 %d 行 / %d 字），建议拆页或精简文字"
            % (bottom, sum(counts), sum(len(p) for p in paras)))

    # ---- 文本元素 ----
    def _draw_text(self, slide, el, paras, offset=(0.0, 0.0), number=1):
        text_spec = el.get("text") or {}
        base_box = el["box"]
        box = {"x": base_box["x"] + offset[0], "y": base_box["y"] + offset[1],
               "w": base_box["w"], "h": base_box["h"]}
        items = [str(p) for p in paras] or [""]
        sref = text_spec.get("size")
        base_pt = self.sizes.get(sref)
        if not isinstance(base_pt, (int, float)) or isinstance(base_pt, bool):
            raise cli_guard.InputError("主题规格的 sizes_pt 缺字号键 %r（元素 role=%s）" % (sref, el.get("role")))
        ls = self._line_spacing(text_spec)
        bullet = el.get("bullet") or {}
        is_bullet = bool(bullet)
        gap_pt = float(bullet.get("gap_after_pt") or 0) if is_bullet else 0.0
        gap_between_only = bool(bullet.get("gap_between_only", True)) if is_bullet else True
        indent_in = float(bullet.get("indent_in") or 0) if is_bullet else 0.0
        fit = el.get("autofit") or {}
        min_pt = float(fit.get("min_size_pt") or base_pt)
        bold = bool(text_spec.get("bold"))
        font_name = self.heading_font if (bold or str(sref) in TITLE_SIZES) else self.body_font
        valign = str(text_spec.get("valign") or "top")
        align = str(text_spec.get("align") or "left")
        avail_w = max(0.2, box["w"] - indent_in)

        pt, counts, line_h, warn = self._fit(items, font_name, avail_w, box["h"], base_pt,
                                             min_pt, ls, gap_pt, gap_between_only)
        entry = {"role": el.get("role"), "pt": pt}
        if abs(float(pt) - float(base_pt)) > 0.05:
            entry["from"] = base_pt
        self.current_page["entries"].append(entry)
        if warn:
            self.warnings.append("第 %d 页 %s：%s" % (number, el.get("role"), warn))
        if self.dry:
            return

        tf = slide.shapes.add_textbox(*self._geo(box)).text_frame
        tf.word_wrap = True
        tf.auto_size = MSO_AUTO_SIZE.NONE
        tf.vertical_anchor = {"top": MSO_ANCHOR.TOP, "middle": MSO_ANCHOR.MIDDLE,
                              "bottom": MSO_ANCHOR.BOTTOM}.get(valign, MSO_ANCHOR.TOP)
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        para_align = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                      "right": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
        self_draw_dots = bool(is_bullet and bullet.get("char") and valign == "top" and align == "left")
        for i, content in enumerate(items):
            para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            para.alignment = para_align
            para.line_spacing = ls
            if gap_pt and (i < len(items) - 1 or not gap_between_only):
                para.space_after = Pt(gap_pt)
            if indent_in:
                para._p.get_or_add_pPr().set("marL", str(int(Inches(indent_in))))
            run = para.add_run()
            if is_bullet and bullet.get("char") and not self_draw_dots:
                run.text = "%s %s" % (bullet.get("char"), content)
            else:
                run.text = content
            self._style_run(run, pt, bold, text_spec.get("color") or "text_on_light", font_name)
        if self_draw_dots:
            self._draw_bullet_dots(slide, box, counts, line_h, gap_pt, gap_between_only, indent_in, bullet)

    def _draw_bullet_dots(self, slide, box, counts, line_h, gap_pt, gap_between_only, indent_in, bullet):
        """自绘项目符号圆点（悬挂缩进）：圆点对齐每段首行中线，行高与容量判定同一口径。"""
        dot = min(0.11, line_h * 0.32)
        hanging = float(bullet.get("hanging_in") or indent_in or dot)
        cur = box["y"]
        for i, n_lines in enumerate(counts):
            cy = cur + (line_h - dot) / 2.0
            cx = box["x"] + indent_in - hanging + (hanging - dot) / 2.0
            self._add_shape(slide, {"x": cx, "y": cy, "w": dot, "h": dot},
                            bullet.get("color") or "accent", MSO_SHAPE.OVAL)
            cur += n_lines * line_h
            if gap_pt and (i < len(counts) - 1 or not gap_between_only):
                cur += gap_pt / 72.0

    # ---- 页 ----
    def _page_number_on(self, layout):
        pn = self.chrome.get("page_number") or {}
        if not pn.get("show", True):
            return False
        return layout not in (pn.get("skip_layouts") or [])

    def _draw_standard_page(self, slide, s, number):
        """页型通用绘制（③a）：背景 → 骨架（如 inherits content_page）→ 本页元素。

        元素按 role 分派：grid（组件槽位）/ chart / table（原生对象）/ page_number / 文本 / 装饰形状。
        取值默认与 manifest 字段同名（见 specs 的 _note_geometry ⑨），仅 body 一处例外。
        """
        layout = str(s.get("layout") or FALLBACK_LAYOUT)
        lay = self._layout(layout)
        self._paint_bg(slide, lay.get("background"))
        elements = []
        if lay.get("inherits") == "content_page":
            elements += list((self.pp.get("content_page") or {}).get("elements") or [])
        elements += list(lay.get("elements") or [])
        by_role = {}
        for el in elements:            # 骨架与富内容同表：rule 的 follow_text 要能引用骨架里的 title
            by_role.setdefault(str(el.get("role")), el)
        for el in elements:
            role = str(el.get("role"))
            if role == "grid":
                self._draw_grid(slide, el, self._grid_items(s), number)
            elif role == "chart":
                self._draw_chart(slide, el, s, number)
            elif role == "table":
                self._draw_table(slide, el, s, number)
            elif role == "image":
                self._draw_image(slide, el, s, number)
            elif role == "page_number":
                if not self._page_number_on(layout):
                    continue
                fmt = str((self.chrome.get("page_number") or {}).get("format") or "{n}")
                self._draw_text(slide, el, [fmt.replace("{n}", str(number))], number=number)
            elif "text" in el:
                value = self._element_value(s, role)
                if value is None or value == "" or value == []:
                    if el.get("optional"):
                        continue
                    value = ""
                paras = value if isinstance(value, list) else [str(value)]
                self._draw_text(slide, el, [str(x) for x in paras], number=number)
            elif el.get("follow_text"):
                self._draw_rule(slide, el, s, by_role)
            else:
                self._add_shape(slide, el["box"], el.get("fill"))

    def _draw_image(self, slide, el, s, number):
        """图文页的图片元素（③b）：本地路径优先（contain 居中，不拉伸）；gen: 前缀属生图链路，
        未接入或文件缺失时用占位框并**告警**（绝不静默留白）。"""
        box = el["box"]
        spec = str(s.get("image") or el.get("image") or "").strip()
        path = None
        if spec and not spec.startswith("gen:"):
            cand = Path(spec)
            if not cand.is_file() and not cand.is_absolute():
                alt = MODULE / spec                # 相对路径再按模块根兜一次（技能文档口径）
                if alt.is_file():
                    cand = alt
            path = cand
        if path is not None and path.is_file():
            if not self.dry:
                self._add_picture_fit(slide, path, box)
            return
        if not spec:
            why = "manifest 未给 image 字段"
        elif spec.startswith("gen:"):
            why = "gen: 生图链路未接入（⑥ 步）"
        else:
            why = "图片文件不存在：%s" % spec
        self.warnings.append("第 %d 页 image：%s → 已用占位框" % (number, why))
        self._add_shape(slide, box, el.get("placeholder_fill") or "surface_alt")

    def _add_picture_fit(self, slide, path, box):
        """插入图片：contain（保持比例、居中），避免非等比槽位把图拉变形。"""
        x, y = float(box["x"]), float(box["y"])
        w, h = float(box["w"]), float(box["h"])
        try:
            from PIL import Image as _Image
            with _Image.open(str(path)) as img:
                w_px, h_px = img.size
            if w_px > 0 and h_px > 0:
                ratio = min(w / float(w_px), h / float(h_px))
                nw, nh = w_px * ratio, h_px * ratio
                x += (w - nw) / 2.0
                y += (h - nh) / 2.0
                w, h = nw, nh
        except Exception:
            pass
        slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))

    def _draw_rule(self, slide, el, s, by_role):
        """装饰线（③a ⑩）：声明 follow_text 时，按被跟随元素的**实测文字宽度**定宽 ——
        线宽 = max(min_w_in, 文字宽 + 2 × pad_chars × 字号)，起点左移 pad_chars × 字号
        （即「左右各超出文字半个字符」），并做页内保护（不越出左右安全边）。"""
        box = dict(el.get("box") or {})
        follow = el.get("follow_text")
        if isinstance(follow, dict) and box:
            src_role = str(follow.get("element") or "title")
            src = by_role.get(src_role)
            text = self._element_value(s, src_role)
            if isinstance(src, dict) and isinstance(text, str) and text.strip():
                tspec = src.get("text") or {}
                pt = float(self.sizes.get(tspec.get("size")) or 0)
                if pt > 0:
                    bold = bool(tspec.get("bold")) or str(tspec.get("size")) in TITLE_SIZES
                    font = self.resolver.load(self.heading_font if bold else self.body_font, pt)
                    text_w = float(ppt_tool._text_width(font, text)) / PX_PER_INCH
                    pad = float(follow.get("pad_chars") or 0.0) * pt / 72.0
                    min_w = float(follow.get("min_w_in") or 0.0) or float(box.get("w") or 0.0)
                    left = float(src["box"]["x"]) - pad
                    right = min(left + max(min_w, text_w + 2 * pad), self.page_w - 0.1)
                    box["x"] = max(0.1, left)
                    box["w"] = max(0.05, right - box["x"])
        self._add_shape(slide, box, el.get("fill"))

    @staticmethod
    def _grid_items(s):
        """网格槽位的数据来源：compare 用左右两栏，cards 用 cards，其余页型用 items。"""
        layout = str(s.get("layout") or "")
        field = {"compare": None, "cards": "cards", "process": "steps",
                 "timeline": "milestones", "case": "cases"}.get(layout, "items")
        if layout == "compare":
            return [x for x in (s.get("left"), s.get("right")) if isinstance(x, dict)]
        return [x for x in (s.get(field) or []) if isinstance(x, dict)]

    @staticmethod
    def _element_value(s, role):
        """元素取值：默认与 manifest 同名字段；body 例外（bullets 页取 bullets、data 页取 body）。"""
        if role == "body":
            if isinstance(s.get("body"), list):
                return [str(x) for x in s["body"] if str(x).strip()]
            if isinstance(s.get("bullets"), list):
                return [str(x) for x in s["bullets"] if str(x).strip()]
            return s.get("body") or ""
        return s.get(role)



    def _draw_grid(self, slide, grid, items, number):
        """网格槽位：按 slot 取组件逐格渲染；超容量省略并告警（不静默丢）。"""
        entries = [c for c in items if isinstance(c, dict)]
        cols = int(grid.get("cols") or 3)
        max_rows = int(grid.get("max_rows") or 1)
        slot = str(grid.get("slot") or "card")
        if len(entries) == 4 and cols == 3 and slot == "card":
            cols = 2                                     # 55 号：卡片 4 张 2×2
        cap = cols * max_rows
        if len(entries) > cap:
            self.warnings.append("第 %d 页 %s：%d 项超过网格容量 %d（%d 列 × %d 行），已省略 %d 项（建议拆页）"
                                 % (number, slot, len(entries), cap, cols, max_rows, len(entries) - cap))
            entries = entries[:cap]
        if not entries:
            self.warnings.append("第 %d 页 %s：没有可渲染的条目（manifest 未给数据）" % (number, slot))
            return
        rows = max(1, int(math.ceil(len(entries) / float(cols))))
        col_w = float(grid["col_w_in"])
        row_h = float(grid["row_h_in"])
        gap = float(grid["gap_in"])
        gx, gy, gh = float(grid["box"]["x"]), float(grid["box"]["y"]), float(grid["box"]["h"])
        block_h = rows * row_h + (rows - 1) * gap
        top = gy + (gh - block_h) / 2.0 if str(grid.get("valign") or "") == "middle" else gy
        comp = (self.pp.get("components") or {}).get(slot)
        if not isinstance(comp, dict) or not comp:
            raise cli_guard.InputError("主题规格的 pptx.components 缺槽位组件 %r（%s 网格引用）" % (slot, slot))
        for i, entry in enumerate(entries):
            col, row = i % cols, i // cols
            self._draw_component(slide, comp, gx + col * (col_w + gap),
                                 top + row * (row_h + gap), col_w, row_h, entry, number)

    def _draw_component(self, slide, comp, ox, oy, slot_w, slot_h, values, number):
        """组件实例：values 为「role → 文本（str / list）」映射，role 默认与条目字段同名。"""
        if not self.dry and (comp.get("fill") or comp.get("line")):
            # 底板只在**显式声明** fill / line 时画：几何是真值，渲染器不替规格做主
            shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                         *self._geo({"x": ox, "y": oy, "w": slot_w, "h": slot_h}))
            shp.fill.solid()
            shp.fill.fore_color.rgb = self.color(comp.get("fill") or "surface_alt")
            shp.shadow.inherit = False
            line = comp.get("line") or {}
            if line:
                shp.line.color.rgb = self.color(line.get("color") or "card_line")
                shp.line.width = Pt(float(line.get("width_pt") or 0.75))
            else:
                shp.line.fill.background()
            radius = float(comp.get("radius_in") or 0)
            if radius > 0:
                try:
                    shp.adjustments[0] = min(0.5, radius / max(0.01, min(slot_w, slot_h)))
                except Exception:
                    pass
        bar = comp.get("accent_bar") or {}
        if bar:
            size = float(bar.get("size_in") or 0.05)
            edge = str(bar.get("edge") or "top")
            if edge == "bottom":
                bar_box = {"x": ox, "y": oy + slot_h - size, "w": slot_w, "h": size}
            elif edge == "left":
                bar_box = {"x": ox, "y": oy, "w": size, "h": slot_h}
            elif edge == "right":
                bar_box = {"x": ox + slot_w - size, "y": oy, "w": size, "h": slot_h}
            else:
                bar_box = {"x": ox, "y": oy, "w": slot_w, "h": size}
            self._add_shape(slide, bar_box, bar.get("fill") or "rule")
        for el in comp.get("elements") or []:
            role = str(el.get("role"))
            if role == "icon":
                value = values.get("icon")
                if not value and el.get("optional"):
                    continue
                self._draw_icon(slide, el, ox, oy, value, number)
                continue
            if "text" in el:
                value = el.get("fixed_text") if el.get("fixed_text") is not None else values.get(role)
                if value is None or value == "" or value == []:
                    if el.get("optional"):
                        continue
                    value = ""
                paras = value if isinstance(value, list) else [str(value)]
                self._draw_text(slide, el, [str(x) for x in paras], offset=(ox, oy), number=number)
                continue
            # 无文本的装饰元素（分隔线 / 序号底板 / 圆点 等）：按 shape 声明取形状
            box = {"x": ox + el["box"]["x"], "y": oy + el["box"]["y"],
                   "w": el["box"]["w"], "h": el["box"]["h"]}
            declared = str(el.get("shape") or "").lower()
            if declared == "oval":
                shape = MSO_SHAPE.OVAL
            elif declared == "rounded" or el.get("radius_in"):
                shape = MSO_SHAPE.ROUNDED_RECTANGLE
            else:
                shape = MSO_SHAPE.RECTANGLE
            shp = self._add_shape(slide, box, el.get("fill"), shape)
            if shape == MSO_SHAPE.ROUNDED_RECTANGLE and el.get("radius_in") and shp is not None:
                try:
                    shp.adjustments[0] = min(0.5, float(el["radius_in"])
                                             / max(0.01, min(float(box["w"]), float(box["h"]))))
                except Exception:
                    pass

    def _find_icon(self, name):
        for d in self.asset_dirs:
            for ext in (".png", ".jpg", ".jpeg"):
                p = Path(d) / "icons" / ("%s%s" % (name, ext))
                if p.is_file():
                    return p
        return None

    def _draw_icon(self, slide, el, ox, oy, value, number):
        """图标槽位：素材 PNG > 内置几何标记 > 使用者显式单字符。底圆与标记同一坐标系，天然同心。"""
        name = str(value or "").strip()
        box = {"x": ox + el["box"]["x"], "y": oy + el["box"]["y"],
               "w": el["box"]["w"], "h": el["box"]["h"]}
        image = self._find_icon(name) if name else None
        if image is not None and not self.dry:
            self._add_picture_fit(slide, image, box)
            return
        self._add_shape(slide, box, el.get("fill") or "panel_dark", MSO_SHAPE.OVAL)
        if not name:
            return
        color_token = (el.get("text") or {}).get("color") or "text_on_dark"
        if len(name) == 1:
            # 使用者显式给的单个字符：仍走文本（字体自身的 1~2px 排版偏移无法用坐标消除）
            self._draw_text(slide, el, [name], offset=(ox, oy), number=number)
            return
        size = min(float(box["w"]), float(box["h"])) * ICON_MARK_SCALE
        mark_box = {"x": box["x"] + (box["w"] - size) / 2.0,
                    "y": box["y"] + (box["h"] - size) / 2.0, "w": size, "h": size}
        shape = getattr(MSO_SHAPE, ICON_MARKS.get(name.lower(), "DIAMOND"), MSO_SHAPE.DIAMOND)
        self._add_shape(slide, mark_box, color_token, shape)

    # ---- 原生对象：图表 / 表格（③a 第二批）----
    def _draw_chart(self, slide, el, s, number):
        """图表：python-pptx 原生对象。几何只给区域；类型/图例/数据标签取自 layout；
        系列色走 color_roles.chart_series（不写死 hex），与主题一致。"""
        series = [x for x in (s.get("series") or []) if isinstance(x, dict) and x.get("values")]
        if not series:
            self.warnings.append("第 %d 页 chart：manifest 未给 series，已跳过图表（不产空白图）" % number)
            return
        need = max(len(x.get("values") or []) for x in series)
        cats = [str(x) for x in (s.get("categories") or [])]
        if len(cats) < need:
            cats = cats + ["%d" % (i + 1) for i in range(len(cats), need)]   # 只补索引，不猜语义
        ctype = str(s.get("type") or el.get("chart_type") or "bar").lower()
        chart_type = {"bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
                      "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
                      "line": XL_CHART_TYPE.LINE_MARKERS,
                      "pie": XL_CHART_TYPE.PIE}.get(ctype, XL_CHART_TYPE.COLUMN_CLUSTERED)
        if self.dry:
            return
        data = CategoryChartData()
        data.categories = cats
        for item in series:
            data.add_series(str(item.get("name") or "系列"),
                            tuple(float(v) for v in (item.get("values") or [])))
        chart = slide.shapes.add_chart(chart_type, *self._geo(el["box"]), data).chart
        chart.has_title = False
        legend = str(el.get("legend") or "bottom").lower()
        if legend and legend != "none":
            chart.has_legend = True
            chart.legend.position = {"bottom": XL_LEGEND_POSITION.BOTTOM, "top": XL_LEGEND_POSITION.TOP,
                                     "right": XL_LEGEND_POSITION.RIGHT,
                                     "left": XL_LEGEND_POSITION.LEFT}.get(legend, XL_LEGEND_POSITION.BOTTOM)
            chart.legend.include_in_layout = False
        else:
            chart.has_legend = False
        if el.get("data_labels"):
            try:
                plot = chart.plots[0]
                plot.has_data_labels = True
                plot.data_labels.number_format = 'General'  # 实测：'0.#' / '0.###' 在 WPS 下都会渲染成 "10."（小数点被强制）
                plot.data_labels.number_format_is_linked = False
            except Exception:
                pass
        chart_slots = self.roles.get("chart_series") or {}
        for i, plot_series in enumerate(chart.series):
            token = chart_slots.get("s%d" % (i + 1))
            if not token:
                continue
            try:
                if chart_type == XL_CHART_TYPE.PIE:
                    for j, point in enumerate(plot_series.points):
                        point.format.fill.solid()
                        point.format.fill.fore_color.rgb = self.color(chart_slots.get("s%d" % (j + 1)) or token)
                else:
                    plot_series.format.fill.solid()
                    plot_series.format.fill.fore_color.rgb = self.color(token)
            except Exception:
                pass

    def _draw_table(self, slide, el, s, number):
        """表格：python-pptx 原生表格。字号引用 sizes_pt 的 header_size / cell_size。"""
        header = [str(x) for x in (s.get("header") or [])]
        rows = [[str(c) for c in r] for r in (s.get("rows") or []) if isinstance(r, list)]
        if not header and not rows:
            self.warnings.append("第 %d 页 table：manifest 未给 header / rows，已跳过表格" % number)
            return
        cols = max([len(header)] + [len(r) for r in rows])
        if cols <= 0:
            return
        header = header + [""] * (cols - len(header))
        body = [r + [""] * (cols - len(r)) for r in rows]
        hsize = self.sizes.get(str(el.get("header_size") or "table_header"), 14)
        csize = self.sizes.get(str(el.get("cell_size") or "table_cell"), 14)
        if self.dry:
            return
        table = slide.shapes.add_table(len(body) + (1 if header else 0), cols, *self._geo(el["box"])).table
        # 列宽按内容权重分配（中文按 2、ASCII 按 1 计；下限 4）—— 避免「序号」列等宽占掉 1/4
        weights = []
        for c in range(cols):
            cells = ([header[c]] if header else []) + [row[c] for row in body]
            weights.append(max(4, max((sum(2 if ord(ch) > 127 else 1 for ch in str(v)) for v in cells), default=4)))
        total_emu = int(max(0.0, float(el["box"]["w"])) * EMU_PER_INCH)
        for c in range(cols):
            table.columns[c].width = Emu(int(total_emu * weights[c] / float(sum(weights))))
        first = 0
        if header:
            for c, text in enumerate(header):
                self._fill_cell(table.cell(0, c), text, hsize, True, "text_on_dark", "panel_dark")
            first = 1
        for r, row in enumerate(body):
            for c, text in enumerate(row):
                zebra = bool(el.get("zebra")) and (r % 2 == 1)
                self._fill_cell(table.cell(first + r, c), text, csize, False,
                                "text_on_light", "surface_alt" if zebra else "surface")

    def _fill_cell(self, cell, text, pt, bold, color_token, fill_token):
        cell.text = str(text)
        cell.fill.solid()
        cell.fill.fore_color.rgb = self.color(fill_token)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        cell.margin_left = cell.margin_right = Inches(0.08)
        cell.margin_top = cell.margin_bottom = Inches(0.03)
        for para in cell.text_frame.paragraphs:
            para.alignment = PP_ALIGN.LEFT
            for run in para.runs:
                self._style_run(run, pt, bold, color_token, self.body_font)

    # ---- 主流程 ----
    def build(self, manifest, slides):
        if not self.dry and not PPTX_OK:
            raise cli_guard.InputError("缺少必需依赖 python-pptx —— 渲染 PPT 需要它："
                                       "py -3 -m pip install -r requirements.txt")
        notes = manifest.get("notes") or []
        prs = None
        if not self.dry:
            prs = Presentation()
            prs.slide_width = Emu(int(self.pp["slide"]["width_emu"]))
            prs.slide_height = Emu(int(self.pp["slide"]["height_emu"]))
        for i, s in enumerate(slides, 1):
            layout = str(s.get("layout") or FALLBACK_LAYOUT)
            self.current_page = {"index": i, "layout": layout,
                                 "title": str(s.get("title") or ""), "entries": []}
            slide = None if self.dry else prs.slides.add_slide(prs.slide_layouts[6])
            self._draw_standard_page(slide, s, i)
            note = s.get("notes")
            if not note and isinstance(notes, list) and i - 1 < len(notes) and isinstance(notes[i - 1], str):
                note = notes[i - 1]
            if note and not self.dry:
                slide.notes_slide.notes_text_frame.text = str(note)
            self.report.append(self.current_page)
        return prs, self.report


# --------------------------------------------------------------------- 输出

def _short(text, limit=30):
    s = str(text).replace("\n", " ").strip()
    return s if len(s) <= limit else s[:limit - 1] + "…"


def _num(v):
    f = float(v)
    return str(int(f)) if abs(f - round(f)) < 0.05 else ("%.1f" % f)


def print_report(report, warnings):
    for page in report:
        head = "第 %d 页 %s" % (page["index"], page["layout"])
        if page.get("title"):
            head += "「%s」" % _short(page["title"])
        line = []
        for e in page["entries"]:
            if "from" in e:
                line.append("%s %s→%spt" % (e["role"], _num(e["from"]), _num(e["pt"])))
            else:
                line.append("%s %spt" % (e["role"], _num(e["pt"])))
        print(head + ("：" + " / ".join(line) if line else ""))
    if warnings:
        print("警告 %d 条：" % len(warnings))
        for w in warnings:
            print("  ! " + w)


def _print_manifest_errors(errors):
    print("错误: manifest 校验未通过（%d 条）：" % len(errors), file=sys.stderr)
    for e in errors[:20]:
        print("  · " + e, file=sys.stderr)
    if len(errors) > 20:
        print("  …（其余 %d 条省略）" % (len(errors) - 20), file=sys.stderr)


def _theme_id(args, manifest=None):
    theme = getattr(args, "theme", None)
    if not theme and isinstance(manifest, dict):
        theme = manifest.get("theme")
    return str(theme or style_spec.DEFAULT_SPEC)


def _prepare(manifest, schema):
    """校验 + 归一化 + 裁页；返回 (slides, warnings)；校验失败返回 (None, None)。"""
    errors = validate_manifest(manifest, schema)
    if errors:
        _print_manifest_errors(errors)
        return None, None
    slides, warnings = normalize_slides(list(manifest.get("slides") or []))
    slides, cut = apply_max_slides(slides, manifest.get("limits") or {})
    return slides, warnings + cut


def cmd_render(args):
    schema = load_schema()
    manifest = read_json_file(args.manifest, "manifest")
    if not isinstance(manifest, dict):
        raise ManifestError("manifest 根节点应为对象: %s" % args.manifest)
    slides, warnings = _prepare(manifest, schema)
    if slides is None:
        return 2
    theme_id = _theme_id(args, manifest)
    spec = load_theme(theme_id)
    renderer = Renderer(spec, resolve_assets(args.assets), dry=bool(args.dry_run))
    renderer.warnings = list(warnings)
    try:
        renderer.ensure_fonts()
    except FontMissing as exc:
        print("错误: 本机找不到字体文件 %s（Pillow 用它按字符测量文本）" % exc, file=sys.stderr)
        print("提示: 装上该字体，或改 specs 的 pptx.fonts / allowed_fonts；"
              "字体名映射表见 scripts/office/ppt_tool.py 的 FONT_FILE_HINTS", file=sys.stderr)
        return EXIT_NO_FONT
    prs, report = renderer.build(manifest, slides)
    if args.dry_run:
        print_report(report, renderer.warnings)
        print("（--dry-run：未写文件）")
        return 0
    out = Path(args.out)
    if out.is_dir():
        raise cli_guard.InputError("输出路径是目录而非文件: %s" % out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name("%s.tmp-render%s" % (out.stem, out.suffix or ".pptx"))
    try:
        prs.save(str(tmp))
        os.replace(str(tmp), str(out))
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    print_report(report, renderer.warnings)
    print("OK: 已生成 %s（%d 页 · 主题 %s）" % (out, len(prs.slides._sldIdLst), spec.get("id") or theme_id))
    return 0


def cmd_validate(args):
    schema = load_schema()
    manifest = read_json_file(args.manifest, "manifest")
    if not isinstance(manifest, dict):
        raise ManifestError("manifest 根节点应为对象: %s" % args.manifest)
    slides, warnings = _prepare(manifest, schema)
    if slides is None:
        return 2
    theme_id = _theme_id(args, manifest)
    spec = load_theme(theme_id)
    renderer = Renderer(spec, resolve_assets(None), dry=True)
    renderer.warnings = list(warnings)
    counts = []
    for s in slides:
        lay = str(s.get("layout") or FALLBACK_LAYOUT)
        if counts and counts[-1][0] == lay:
            counts[-1][1] += 1
        else:
            counts.append([lay, 1])
    print("OK: manifest 合法（%d 页 · 主题 %s）" % (len(slides), spec.get("id") or theme_id))
    print("    页型：" + " / ".join("%s×%d" % (k, v) for k, v in counts))
    try:
        renderer.ensure_fonts()
        renderer.build(manifest, slides)
        print_report(renderer.report, [])
    except FontMissing as exc:
        print("    警告: 本机缺字体文件 %s → 已跳过容量预演（render 时会 exit 5）" % exc)
    for w in renderer.warnings:
        print("  ! " + w)
    return 0


def cmd_list_layouts(args):
    theme_id = _theme_id(args)
    spec = load_theme(theme_id)
    pp = spec["pptx"]
    slide = pp.get("slide") or {}
    pp_fonts = pp.get("fonts") or {}
    print("主题规格：%s（%s）· 页面 %.4f × %.4f 英寸 · 字体 标题 %s / 正文 %s"
          % (spec.get("id") or theme_id, spec.get("name") or "-",
             float(slide.get("width_emu") or 0) / EMU_PER_INCH,
             float(slide.get("height_emu") or 0) / EMU_PER_INCH,
             (pp_fonts.get("heading") or {}).get("ea"),
             (pp_fonts.get("body") or {}).get("ea")))
    print("页型（已实现 %d / 共 %d 类）：" % (len(IMPLEMENTED_LAYOUTS), len(ALL_LAYOUTS)))
    for name in ALL_LAYOUTS:
        lay = (pp.get("layouts") or {}).get(name)
        if name in IMPLEMENTED_LAYOUTS and isinstance(lay, dict):
            note = "已实现"
            if lay.get("inherits"):
                note += " · inherits %s" % lay["inherits"]
            note += " · 元素 %d" % len(lay.get("elements") or [])
            print("   ✔ %-9s %s" % (name, note))
        else:
            note = "规格已就位 · " if isinstance(lay, dict) else ""
            print("   ✘ %-9s %s未实现（后续扩展位；当前落 %s 兜底）" % (name, note, FALLBACK_LAYOUT))
    print("组件：")
    for name in ALL_COMPONENTS:
        comp = (pp.get("components") or {}).get(name)
        ok = name in IMPLEMENTED_COMPONENTS and isinstance(comp, dict) and bool(comp)
        if ok:
            print("   ✔ %-6s 已实现 · 坐标 %s · 元素 %d"
                  % (name, comp.get("coord") or "absolute", len(comp.get("elements") or [])))
        else:
            tail = "ring 待小样验证" if name == "ring" else "③a 补齐"
            print("   ✘ %-6s 未实现（%s）" % (name, tail))
    print("素材：内置 %s（%s）· 使用者自定义层 %s（%s）"
          % (DEFAULT_ASSETS, "存在" if DEFAULT_ASSETS.is_dir() else "未建（③b）",
             USER_ASSETS, "存在" if USER_ASSETS.is_dir() else "未建"))
    print("manifest 字段规范：%s" % MANIFEST_SCHEMA)
    return 0


def main():
    parser = argparse.ArgumentParser(description="PPT 渲染器（manifest → pptx · B 线施工②b）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("render", help="manifest → pptx（②b：cover / bullets / cards）")
    p.add_argument("manifest", help="manifest JSON 文件")
    p.add_argument("out", help="输出的 .pptx 路径（已存在则覆盖，源文件不受影响）")
    p.add_argument("--theme", help="主题规格 id 或路径（默认取 manifest.theme，缺省 standard）")
    p.add_argument("--assets", help="素材目录（含 icons/）；默认 使用者自定义层 → 内置 assets/")
    p.add_argument("--dry-run", action="store_true", help="只校验与预演字号/容量，不写文件")
    p.set_defaults(fn=cmd_render)

    p = sub.add_parser("validate", help="干跑校验：manifest + 主题规格 + 容量预演")
    p.add_argument("manifest")
    p.add_argument("--theme")
    p.set_defaults(fn=cmd_validate)

    p = sub.add_parser("list-layouts", help="列出页型与组件（标注实现状态与资源来源）")
    p.add_argument("--theme")
    p.set_defaults(fn=cmd_list_layouts)

    args = parser.parse_args()
    cli_guard.check_inputs(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
