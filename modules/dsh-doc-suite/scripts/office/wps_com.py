"""WPS Office COM 桥接工具（依赖 pywin32 + 本机 WPS Office）。

需要完整保真度的文档操作 / 格式转换时使用；python-docx / openpyxl /
python-pptx 无法处理的场景（.doc/.xls/.ppt 旧格式、导出 PDF、PPT 转图片）
由本模块兜底。

用法：
  python wps_com.py convert <src> <dst>            # 格式转换（含导出 PDF）
  python wps_com.py text <src>                     # 读取旧格式文档的纯文本
  python wps_com.py ppt-images <pptx> <outdir>     # PPT 每页导出 PNG

说明：
  - 通过 ProgID KWPS/KET/KWPP 调用 WPS（不占用标准 Word/Excel/PowerPoint 注册名）。
  - COM 对象会隐藏窗口运行；转换完成后自动关闭，不残留进程。
"""
import argparse
import os
import sys

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

APP_KINDS = {
    "word": "KWPS.Application",
    "excel": "KET.Application",
    "ppt": "KWPP.Application",
}

_EXT_KIND = {
    "word": {".doc", ".docx", ".wps", ".rtf", ".txt", ".md"},
    "excel": {".xls", ".xlsx", ".xlsm", ".csv", ".et", ".ett"},
    "ppt": {".ppt", ".pptx", ".dps", ".dpt"},
}


def kind_for(path):
    ext = os.path.splitext(path)[1].lower()
    for kind, exts in _EXT_KIND.items():
        if ext in exts:
            return kind
    raise ValueError(f"无法识别的文件类型: {path}")


def get_app(kind):
    import win32com.client

    app = win32com.client.Dispatch(APP_KINDS[kind])
    for attr, value in (("Visible", False), ("DisplayAlerts", 0)):
        try:
            setattr(app, attr, value)
        except Exception:
            pass
    return app


def open_doc(app, kind, src, read_only=True):
    src = os.path.abspath(src)
    if kind == "word":
        return app.Documents.Open(src, ReadOnly=read_only)
    if kind == "excel":
        return app.Workbooks.Open(src, ReadOnly=read_only, UpdateLinks=0)
    try:  # 部分 WPS 版本要求 PPT 带窗口打开
        return app.Presentations.Open(src, ReadOnly=read_only, WithWindow=False)
    except Exception:
        return app.Presentations.Open(src, ReadOnly=read_only)


def _close(app, doc):
    try:
        if doc is not None:
            doc.Close(False)
    except Exception:
        pass
    try:
        app.Quit()
    except Exception:
        pass


def convert(src, dst, kind=None):
    kind = kind or kind_for(src)
    app = get_app(kind)
    doc = None
    try:
        doc = open_doc(app, kind, src)
        dst = os.path.abspath(dst)
        ext = os.path.splitext(dst)[1].lower()
        if ext == ".pdf":
            # WPS 的 ExportAsFixedFormat 在 pywin32 动态调度下签名不稳定，
            # 失败时回退到 SaveAs + 格式码（word 17=PDF / excel 57=PDF / ppt 32=PDF）。
            try:
                if kind == "word":
                    doc.ExportAsFixedFormat(dst, 17)  # wdExportFormatPDF
                elif kind == "excel":
                    doc.ExportAsFixedFormat(0, dst)  # xlTypePDF
                else:
                    doc.ExportAsFixedFormat(dst, 2)  # ppFixedFormatTypePDF
            except Exception:
                fmt = {"word": 17, "excel": 57, "ppt": 32}[kind]
                doc.SaveAs(dst, fmt)
        else:
            doc.SaveAs(dst)  # 由扩展名推断目标格式
        print(f"OK: {src} -> {dst}")
        return 0
    finally:
        _close(app, doc)


def read_text(src, kind=None):
    """读取文档纯文本（旧格式 .doc/.xls/.ppt 等走 COM）。"""
    kind = kind or kind_for(src)
    app = get_app(kind)
    doc = None
    try:
        doc = open_doc(app, kind, src)
        if kind == "word":
            return doc.Content.Text
        if kind == "excel":
            lines = []
            for ws in doc.Worksheets:
                lines.append(f"== Sheet: {ws.Name} ==")
                used = ws.UsedRange
                try:
                    values = used.Value
                except Exception:
                    values = None
                if values is None:
                    continue
                if not isinstance(values, (tuple, list)):
                    values = [[values]]
                rows = values if isinstance(values, (tuple, list)) and isinstance(values[0], (tuple, list)) else [values]
                for row in rows:
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(cells):
                        lines.append(" | ".join(cells))
            return "\n".join(lines)
        # ppt
        lines = []
        for slide in doc.Slides:
            for shape in slide.Shapes:
                try:
                    if shape.HasTextFrame and shape.TextFrame.HasText:
                        lines.append(shape.TextFrame.TextRange.Text)
                except Exception:
                    continue
        return "\n".join(lines)
    finally:
        _close(app, doc)


def export_ppt_images(src, outdir):
    kind = "ppt"
    app = get_app(kind)
    pres = None
    try:
        pres = open_doc(app, kind, src)
        os.makedirs(outdir, exist_ok=True)
        for i, slide in enumerate(pres.Slides, start=1):
            out = os.path.join(outdir, f"slide-{i:03d}.png")
            slide.Export(out, "PNG", 1280, 720)
            print(f"OK: {out}")
        return 0
    finally:
        _close(app, pres)


def main():
    parser = argparse.ArgumentParser(description="WPS Office COM 桥接工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("convert", help="格式转换 / 导出 PDF")
    p.add_argument("src")
    p.add_argument("dst")
    p.add_argument("--kind", choices=sorted(APP_KINDS), default=None)

    p = sub.add_parser("text", help="读取旧格式文档纯文本")
    p.add_argument("src")
    p.add_argument("--kind", choices=sorted(APP_KINDS), default=None)

    p = sub.add_parser("ppt-images", help="PPT 每页导出为 PNG")
    p.add_argument("src")
    p.add_argument("outdir")

    args = parser.parse_args()
    if args.cmd == "convert":
        return convert(args.src, args.dst, args.kind)
    if args.cmd == "text":
        print(read_text(args.src, args.kind))
        return 0
    if args.cmd == "ppt-images":
        return export_ppt_images(args.src, args.outdir)
    return 1


if __name__ == "__main__":
    sys.exit(main())
