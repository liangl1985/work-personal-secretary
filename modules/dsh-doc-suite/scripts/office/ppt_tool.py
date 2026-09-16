"""PowerPoint 工具（.pptx 走 python-pptx；旧格式与导出走 WPS COM）。

用法（Windows 一律用 py -3，`python` 可能是 Microsoft Store 别名 stub）：
  py -3 ppt_tool.py create <out.pptx> --title 标题 --subtitle 副标题 [--from-md a.md] [--template t.pptx]
  py -3 ppt_tool.py read <file>                            # 提取所有幻灯片文本
  py -3 ppt_tool.py convert <src> <dst>                    # 导出 PDF（WPS COM）
  py -3 ppt_tool.py images <src> <outdir>                  # 每页导出 PNG（WPS COM）
  py -3 ppt_tool.py autofit <file.pptx> [--out o.pptx] [--slide 1,3-5] [--font 微软雅黑]
                                        [--font-file msyh.ttc] [--max-size 40] [--min-size 8] [--dry-run]
                                                           # 文本框自动缩字号（自研测量，中文友好）

参数形态（实测易踩）：**全是位置参数**——convert 是 `convert <src> <dst>`（**没有** `--to`），
images 是 `images <src> <outdir>`（**没有** `--out-dir`）。

Markdown -> 幻灯片规则：
  # 标题        -> 新幻灯片（标题）
  ## 小节       -> 正文中的小节行（带 ◆ 前缀）
  - / 1. 内容   -> 正文项目符号
  其他文本       -> 正文段落
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cli_guard  # noqa: E402
import wps_com  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def md_to_slides(prs, text):
    title_layout = prs.slide_layouts[0]
    content_layout = prs.slide_layouts[1]
    current = None
    bullets = []

    def flush():
        nonlocal current, bullets
        if current is None:
            return
        slide = prs.slides.add_slide(content_layout)
        slide.shapes.title.text = current
        try:
            tf = slide.placeholders[1].text_frame
        except Exception:
            tf = slide.shapes.add_textbox(3657600, 2539520, 9144000, 5000000).text_frame
        first = True
        for b in bullets:
            para = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            para.text = b
        bullets = []

    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("# "):
            flush()
            current = s[2:].strip()
        elif s.startswith("## "):
            bullets.append("◆ " + s[3:].strip())
        elif re.match(r"^[-*]\s+", s):
            bullets.append(re.sub(r"^[-*]\s+", "", s))
        elif re.match(r"^\d+[.、]\s+", s):
            bullets.append(re.sub(r"^\d+[.、]\s+", "", s))
        else:
            bullets.append(s)
    flush()


def cmd_create(args):
    from pptx import Presentation

    prs = Presentation(args.template) if args.template else Presentation()
    if args.title:
        slide = prs.slides.add_slide(prs.slide_layouts[0])
        slide.shapes.title.text = args.title
        if args.subtitle:
            try:
                slide.placeholders[1].text = args.subtitle
            except Exception:
                pass
    body = ""
    if args.from_md:
        body = Path(args.from_md).read_text(encoding="utf-8-sig")
    if body.strip():
        md_to_slides(prs, body)
    prs.save(args.out)
    print(f"OK: 已生成 {args.out}（{len(prs.slides._sldIdLst)} 页）")
    return 0


def cmd_read(args):
    from pptx import Presentation

    prs = Presentation(args.file)
    for i, slide in enumerate(prs.slides, 1):
        print(f"--- 第 {i} 页 ---")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in para.runs)
                    if text.strip():
                        print(text)
    return 0


def cmd_convert(args):
    return wps_com.convert(args.src, args.dst, "ppt")


def cmd_images(args):
    return wps_com.export_ppt_images(args.src, args.outdir)


# ---- autofit：文本框自动缩字号 -------------------------------------------------
# **刻意不用 python-pptx 的 TextFrame.fit_text()**（2026-09-12 实测结论）：
#   它内部按空白断词（`pptx/text/layout.py` 的 `_LineSource` 用 `str.split()`），
#   中文长句没有空格 → 整句被当成一个"词" → 永远超宽 → 二分查找返回 None →
#   直接抛 `TypeError: cannot unpack non-iterable NoneType`。**该方法对中文不可用。**
#
# 故本命令自研，只用必需依赖 **Pillow** 测尺寸：
#   按**字符**断行（CJK 可任意断行；英文照此处理虽不完美但不会算错），
#   从 --max-size 逐磅下探到 --min-size，取第一个能放进文本框（含内边距）的字号。
EXIT_NO_FONT = 5

# 常见字体名 → Windows 字体文件名（找不到时提示用 --font-file 直接指定）
FONT_FILE_HINTS = {
    "微软雅黑": "msyh.ttc",
    "microsoft yahei": "msyh.ttc",
    "microsoft yahei ui": "msyh.ttc",     # 母版里常见写法（与微软雅黑同一字体文件，实测 msyh.ttc）
    "微软雅黑 ui": "msyh.ttc",
    "黑体": "simhei.ttf",
    "simhei": "simhei.ttf",
    "宋体": "simsun.ttc",
    "simsun": "simsun.ttc",
    "等线": "Deng.ttf",
    "dengxian": "Deng.ttf",
    "楷体": "simkai.ttf",
    "仿宋": "simfang.ttf",
    "arial": "arial.ttf",
    "calibri": "calibri.ttf",
    "calibri light": "calibril.ttf",      # 实测本机存在 calibril.ttf
}

EMU_PER_INCH = 914400.0
PX_PER_INCH = 96.0
PX_PER_PT = PX_PER_INCH / 72.0


def _windows_fonts_dir():
    import os
    return os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def _select_slides(prs, spec):
    """--slide '1,3-5' → [(序号, slide)]；未给则全部。序号从 1 起。"""
    slides = list(prs.slides)
    if not spec:
        return list(enumerate(slides, 1))
    wanted = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "-" in part:
                a, _, b = part.partition("-")
                wanted.update(range(int(a), int(b) + 1))
            else:
                wanted.add(int(part))
        except ValueError:
            raise cli_guard.InputError(f"--slide 写法不对: {part}（示例 1,3-5）")
    out = [(i, s) for i, s in enumerate(slides, 1) if i in wanted]
    if not out:
        raise cli_guard.InputError(f"--slide 指定的页不存在（该文件共 {len(slides)} 页）")
    return out


def _first_size_pt(text_frame):
    """取文本框里第一个显式设置字号的 run（pt）；没有则 None。"""
    for para in text_frame.paragraphs:
        for run in para.runs:
            size = run.font.size
            if size is not None:
                try:
                    return round(size.pt, 1)
                except Exception:
                    return None
    return None


def _has_text(text_frame):
    return any(run.text.strip() for para in text_frame.paragraphs for run in para.runs)


def _resolve_font_file(args, text_frame):
    """确定测量用字体文件：--font-file > --font 映射 > 文本框首个 run 的字体名映射。"""
    if args.font_file:
        p = Path(args.font_file)
        if not p.exists():
            raise cli_guard.InputError(f"--font-file 指定的字体文件不存在: {p}")
        return str(p)

    names = []
    if args.font:
        names.append(args.font)
    for para in text_frame.paragraphs:
        for run in para.runs:
            if run.font.name:
                names.append(run.font.name)
                break
        if names:
            break

    fonts_dir = Path(_windows_fonts_dir())
    for name in names:
        key = str(name).strip().lower()
        cand = fonts_dir / FONT_FILE_HINTS.get(key, key + ".ttf")
        if cand.exists():
            return str(cand)
    return None


def _wrap_by_char(text, font, max_width_px):
    """按字符断行（中文友好）。返回 (行列表, 最宽行宽度, 行高)。"""
    lines, cur = [], ""
    widths = []
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            widths.append(_text_width(font, cur))
            cur = ""
            continue
        trial = cur + ch
        if cur and _text_width(font, trial) > max_width_px:
            lines.append(cur)
            widths.append(_text_width(font, cur))
            cur = ch
        else:
            cur = trial
    lines.append(cur)
    widths.append(_text_width(font, cur))
    return lines, (max(widths) if widths else 0), _text_height(font)


def _text_width(font, text):
    try:
        return font.getlength(text)          # Pillow >= 8
    except AttributeError:
        return font.getsize(text)[0]


def _text_height(font):
    try:
        return font.getsize("汉字Hg")[1]
    except AttributeError:
        box = font.getbbox("汉字Hg")
        return box[3] - box[1]


def _fit_point_size(text_frame, font_file, box_w_px, box_h_px, max_pt, min_pt):
    """逐磅下探，返回第一个能放下的 (pt, 总行数)；都不行返回 (None, None)。"""
    from PIL import ImageFont

    paras = ["".join(r.text for r in p.runs) for p in text_frame.paragraphs]
    paras = [p for p in paras if p.strip()] or [""]
    top = max(1, int(round(max_pt)))
    bottom = max(1, int(round(min_pt)))
    for pt in range(top, bottom - 1, -1):
        px = max(1, int(round(pt * PX_PER_PT)))
        font = ImageFont.truetype(font_file, px)
        total_lines, ok = 0, True
        for para in paras:
            lines, widest, _ = _wrap_by_char(para, font, box_w_px)
            if widest > box_w_px:
                ok = False
                break
            total_lines += len(lines)
        if not ok:
            continue
        if total_lines * _text_height(font) <= box_h_px:
            return pt, total_lines
    return None, None


def cmd_autofit(args):
    """文本框自动缩字号：文字溢出时按需缩小，直到放进文本框（中文友好，自研测量）。

    - 只用必需依赖 **Pillow** 测量（**不用** python-pptx 的 `fit_text()`：它按空格断词，对中文不可用）；
    - `--min-size` 是**下限保护**：逐磅下探若到下限仍放不下，就按下限写入并**告警**
      （含义是"再缩也放不下，请拆页或精简文字"，而不是把字缩到看不清）；
    - `--font-file` 直接指定字体文件（最可靠）；省略时按 `--font` 名 → 文本框已有字体名映射到系统字体；
    - 默认**就地修改并先备份**；给 `--out` 则另存新文件、原文件不动；`--dry-run` 只报告不落盘。
    """
    import shutil
    from datetime import datetime
    from pptx import Presentation
    from pptx.util import Pt

    try:
        from PIL import ImageFont  # noqa: F401
    except Exception:
        print("错误: 缺少必需依赖 Pillow —— 自动缩字号用它测量文本尺寸", file=sys.stderr)
        print("提示: py -3 -m pip install -r requirements.txt", file=sys.stderr)
        return EXIT_NO_FONT

    # 参数级校验放前面：--font-file 不存在属输入错误（exit 2），不该等到逐框失败
    if args.font_file and not Path(args.font_file).exists():
        raise cli_guard.InputError(f"--font-file 指定的字体文件不存在: {args.font_file}")

    prs = Presentation(args.file)
    targets = _select_slides(prs, args.slide)

    done, failed, unchanged, floor_hits = [], [], 0, []
    for index, slide in targets:
        for shape in slide.shapes:
            if not shape.has_text_frame or not _has_text(shape.text_frame):
                continue
            tf = shape.text_frame
            before = _first_size_pt(tf)
            try:
                font_file = _resolve_font_file(args, tf)
            except cli_guard.InputError as exc:
                failed.append(f"第 {index} 页 / {shape.shape_type}：{exc}")
                continue
            if not font_file:
                failed.append(
                    f"第 {index} 页 / {shape.shape_type}：找不到可用字体文件"
                    "（文本框未指定可识别的字体名）→ 请用 --font 或 --font-file 指定，如 --font 微软雅黑")
                continue

            # 可用区域扣除文本框内边距
            box_w_px = float(shape.width or 0) / EMU_PER_INCH * PX_PER_INCH
            box_h_px = float(shape.height or 0) / EMU_PER_INCH * PX_PER_INCH
            for attr in ("margin_left", "margin_right"):
                box_w_px -= float(getattr(tf, attr, 0) or 0) / EMU_PER_INCH * PX_PER_INCH
            for attr in ("margin_top", "margin_bottom"):
                box_h_px -= float(getattr(tf, attr, 0) or 0) / EMU_PER_INCH * PX_PER_INCH
            if box_w_px <= 1 or box_h_px <= 1:
                failed.append(f"第 {index} 页 / {shape.shape_type}：文本框可用区域为零（宽高或内边距异常）")
                continue

            pt, lines = _fit_point_size(tf, font_file, box_w_px, box_h_px, args.max_size, args.min_size)
            if pt is None:
                pt, lines = args.min_size, None
                floor_hits.append(
                    f"第 {index} 页（初始 {before} pt；缩到下限 {args.min_size} pt 仍放不下，建议拆页或精简文字）")
            elif before is not None and abs(before - pt) < 0.05:
                unchanged += 1

            for para in tf.paragraphs:
                for run in para.runs:
                    try:
                        run.font.size = Pt(pt)
                    except Exception:
                        pass
            done.append((index, before, pt, lines))

    print("扫描页：" + "、".join("第 " + str(i) + " 页" for i, _ in targets))
    print(f"文本框处理：{len(done)} 个（其中字号未变的 {unchanged} 个）")
    for index, before, pt, lines in done:
        if before is None or abs(before - pt) >= 0.05:
            tail = f"，{lines} 行" if lines else ""
            print(f"  · 第 {index} 页：{before} pt → {pt} pt{tail}")
    if floor_hits:
        print("触发下限保护（再缩也放不下，建议拆页或精简文字）：")
        for line in floor_hits:
            print("  · " + line)
    if failed:
        print(f"失败 {len(failed)} 个文本框（其余已处理）：")
        for line in failed[:10]:
            print("  · " + line)

    if args.dry_run:
        print("（--dry-run：未写文件）")
        return 0
    if not done:
        print("没有可处理的文本框（该页 / 该文件没有文字，或全部失败）。")
        return 0

    if args.out:
        prs.save(args.out)
        print(f"OK: 已另存为 {args.out}（原文件未改动）")
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = Path(str(args.file) + ".bak-autofit-" + stamp)
        shutil.copy2(args.file, backup)
        prs.save(args.file)
        print(f"OK: 已就地更新 {args.file}（原文件已备份为 {backup.name}）")
    return 0


def main():
    parser = argparse.ArgumentParser(description="PowerPoint 工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("create")
    p.add_argument("out")
    p.add_argument("--title")
    p.add_argument("--subtitle")
    p.add_argument("--from-md")
    p.add_argument("--template")
    p.set_defaults(fn=cmd_create)

    p = sub.add_parser("read")
    p.add_argument("file")
    p.set_defaults(fn=cmd_read)

    p = sub.add_parser("convert")
    p.add_argument("src")
    p.add_argument("dst")
    p.set_defaults(fn=cmd_convert)

    p = sub.add_parser("images")
    p.add_argument("src")
    p.add_argument("outdir")
    p.set_defaults(fn=cmd_images)

    p = sub.add_parser("autofit", help="文本框自动缩字号（Pillow 测量，中文友好；缺字体文件则 exit 5）")
    p.add_argument("file")
    p.add_argument("--out", help="输出文件；省略则就地修改（自动备份原文件）")
    p.add_argument("--slide", help="只处理指定页，如 1,3-5；省略=全部")
    p.add_argument("--font", help="测量用字体名（如 微软雅黑）；省略则用文本框已有字体名")
    p.add_argument("--font-file", dest="font_file", help="直接指定字体文件（最可靠），如 C:\\Windows\\Fonts\\msyh.ttc")
    p.add_argument("--max-size", type=float, default=40.0, help="字号上限（磅，默认 40）")
    p.add_argument("--min-size", type=float, default=8.0, help="字号下限（磅，默认 8；到下限仍放不下则告警）")
    p.add_argument("--dry-run", action="store_true", help="只报告结果，不写文件")
    p.set_defaults(fn=cmd_autofit)

    args = parser.parse_args()
    cli_guard.check_inputs(args)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(cli_guard.run(main))
