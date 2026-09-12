"""PowerPoint 工具（.pptx 走 python-pptx；旧格式与导出走 WPS COM）。

用法：
  python ppt_tool.py create <out.pptx> --title 标题 --subtitle 副标题 [--from-md a.md] [--template t.pptx]
  python ppt_tool.py read <file>                            # 提取所有幻灯片文本
  python ppt_tool.py convert <src> <dst>                    # 导出 PDF（WPS COM）
  python ppt_tool.py images <src> <outdir>                  # 每页导出 PNG（WPS COM）

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

    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
