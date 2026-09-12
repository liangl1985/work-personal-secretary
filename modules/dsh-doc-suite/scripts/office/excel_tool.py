"""Excel 工具（.xlsx 走 openpyxl；.xls 旧格式走 WPS COM）。

用法：
  python excel_tool.py summary <file>                        # 概览：工作表与规模
  python excel_tool.py read <file> [--sheet S] [--range A1:C10] [--json]
  python excel_tool.py write <file> --cell A1=值 [--cell B2=...] [--sheet S]
  python excel_tool.py write <file> --from-csv data.csv --sheet S
  python excel_tool.py convert <file> <dst>                  # 导出 PDF / CSV（WPS COM）
  python excel_tool.py chart <file> --sheet S --range A1:D10 --type line --out out.xlsx
  python excel_tool.py merge <out.xlsx> f1.xlsx f2.xlsx [--mode rows|sheets]
  python excel_tool.py recalc <file> [--sheet S] [--out out.xlsx]        # WPS COM 重算公式并保存
  python excel_tool.py pivot <file> --source-range "S!A3:E23" --out out.xlsx [--rows 产品] [--values 数量]

recalc / pivot 说明（2026-09-12 新增，据实测）：
  - openpyxl 无计算引擎：写入公式后 data_only=True 读回是 None；recalc 走 KET COM
    CalculateFull() 后保存，之后 data_only=True 即可读回真值。
  - read 在 data_only 读到 None 且该格实为公式时，会向 stderr 提示"公式未重算，请先 recalc"
    （stdout 输出格式不变）。
  - pivot 走 KET COM PivotCaches/CreatePivotTable + AddDataField 创建真透视表；若 COM 创建不可行，
    会明确报告"不可行"并给出替代做法（不会静默产出空文件）。
"""
import argparse
import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wps_com  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ALPHAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def col_letter(n):
    """1 -> A, 27 -> AA"""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = ALPHAS[r] + s
    return s


def _col(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def parse_range(spec):
    """'A1:C10' -> ((1,1),(10,3))，'A1' -> 单格。"""
    m = re.match(r"^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$", spec.upper())
    if not m:
        raise ValueError(f"无效范围: {spec}")
    c1, r1 = m.group(1), int(m.group(2))
    r2, c2 = (int(m.group(4)), m.group(3)) if m.group(3) else (r1, c1)
    return (r1, _col(c1)), (r2, _col(c2))


def _plain(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def load_workbook(path, data_only=True):
    from openpyxl import load_workbook as _lw

    try:
        return _lw(path, data_only=data_only)
    except Exception:
        return None


def _warn_uncalculated(path, sheet, cells):
    """data_only 读到 None 且该格实为公式 -> 向 stderr 提示先 recalc（2026-09-12 新增）。

    cells: [(坐标, 值)]。只写 stderr，不改动 stdout 既有输出格式。
    """
    blanks = [coord for coord, value in cells if value is None]
    if not blanks:
        return
    from openpyxl import load_workbook as _lw

    try:
        formula_wb = _lw(path, data_only=False)
    except Exception:
        return
    if sheet not in formula_wb.sheetnames:
        return
    formula_ws = formula_wb[sheet]
    formulas = []
    for coord in blanks:
        try:
            value = formula_ws[coord].value
        except Exception:
            continue
        if isinstance(value, str) and value.startswith("="):
            formulas.append((coord, value))
    if not formulas:
        return
    sample = "；".join(f"{coord}={expr}" for coord, expr in formulas[:3])
    print(
        f"⚠️ 警告: {sheet} 有 {len(formulas)} 个公式单元格未重算（data_only=True 读到 None），"
        f"例如 {sample}。公式未重算，请先: py -3 excel_tool.py recalc \"{path}\"",
        file=sys.stderr,
    )


def cmd_summary(args):
    wb = load_workbook(args.file)
    if wb is not None:
        for ws in wb.worksheets:
            print(f"{ws.title}\t行数 {ws.max_row}\t列数 {ws.max_column}")
        return 0
    print(wps_com.read_text(args.file, "excel"))
    return 0


def cmd_read(args):
    wb = load_workbook(args.file)
    if wb is None:
        print(wps_com.read_text(args.file, "excel"))
        return 0
    sheet = args.sheet or wb.sheetnames[0]
    ws = wb[sheet]
    if args.range:
        (r1, c1), (r2, c2) = parse_range(args.range)
        cell_rows = [list(r) for r in ws.iter_rows(min_row=r1, max_row=r2, min_col=c1, max_col=c2)]
    else:
        cell_rows = [list(r) for r in ws.iter_rows()]
    _warn_uncalculated(args.file, sheet, [(c.coordinate, c.value) for row in cell_rows for c in row])
    rows = [[c.value for c in row] for row in cell_rows]
    if args.json:
        print(json.dumps({"sheet": sheet, "rows": [[_plain(v) for v in row] for row in rows]}, ensure_ascii=False))
        return 0
    print(f"== {sheet} ==")
    for row in rows:
        cells = [_plain(v) for v in row]
        if any(cells):
            print(" | ".join(cells))
    return 0


def cmd_write(args):
    from openpyxl import Workbook, load_workbook

    if Path(args.file).exists():
        wb = load_workbook(args.file)
    else:
        wb = Workbook()
    sheet = args.sheet or wb.sheetnames[0]
    if sheet not in wb.sheetnames:
        wb.create_sheet(sheet)
    ws = wb[sheet]

    if args.from_csv:
        with open(args.from_csv, encoding="utf-8-sig", newline="") as fh:
            for row in csv.reader(fh):
                ws.append(row)

    for spec in args.cell or []:
        cell, _, value = spec.partition("=")
        cell = cell.strip().upper()
        ws[cell] = value

    wb.save(args.file)
    print(f"OK: 已写入 {args.file} (sheet={sheet})")
    return 0


def cmd_convert(args):
    dst = args.dst.lower()
    if dst.endswith(".csv") and args.src.lower().endswith((".xlsx", ".xlsm")):
        wb = load_workbook(args.src)
        ws = wb[wb.sheetnames[0]]
        with open(args.dst, "w", encoding="utf-8-sig", newline="") as fh:
            writer = csv.writer(fh)
            for row in ws.iter_rows(values_only=True):
                writer.writerow([_plain(v) for v in row])
        print(f"OK: {args.src} -> {args.dst}")
        return 0
    return wps_com.convert(args.src, args.dst, "excel")


def cmd_chart(args):
    from openpyxl import load_workbook
    from openpyxl.chart import BarChart, LineChart, PieChart, Reference

    (r1, c1), (r2, c2) = parse_range(args.range)
    wb = load_workbook(args.file)
    ws = wb[args.sheet]
    cls = {"line": LineChart, "bar": BarChart, "col": BarChart, "pie": PieChart}[args.type]
    chart = cls()
    if args.type == "col":
        chart.type = "col"
    chart.title = args.title or ""
    data = Reference(ws, min_row=r1, min_col=c1, max_row=r2, max_col=c2)
    chart.add_data(data, titles_from_data=True)
    if c2 > c1:
        chart.set_categories(Reference(ws, min_row=r1, min_col=c1, max_row=r2, max_col=c1))
    ws.add_chart(chart, args.anchor or "G2")
    wb.save(args.out)
    print(f"OK: 图表已加入并保存 {args.out}")
    return 0


def cmd_merge(args):
    from openpyxl import Workbook, load_workbook

    out = Workbook()
    out.remove(out.active)
    if args.mode == "sheets":
        for f in args.files:
            wb = load_workbook(f)
            for ws in wb.worksheets:
                target = out.create_sheet(Path(f).stem[:28])
                for row in ws.iter_rows(values_only=True):
                    target.append([_plain(v) for v in row])
    else:  # rows：每个文件第一个工作表按行追加
        target = out.create_sheet("合并")
        for fi, f in enumerate(args.files):
            wb = load_workbook(f)
            ws = wb[wb.sheetnames[0]]
            for ri, row in enumerate(ws.iter_rows(values_only=True)):
                if fi > 0 and ri == 0:
                    continue  # 只保留第一个文件的表头
                target.append([_plain(v) for v in row])
    out.save(args.out)
    print(f"OK: 已合并 {len(args.files)} 个文件 -> {args.out}")
    return 0


# ==================== recalc / pivot（2026-09-12 新增，KET COM） ====================

def _ket_app():
    """新建独立 KET 实例（VBScript 动态调度 + 隐藏窗口）。"""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("KET.Application")
    for attr, value in (("Visible", False), ("DisplayAlerts", False)):
        try:
            setattr(app, attr, value)
        except Exception:
            pass
    return app


def _ket_quit(app):
    import pythoncom

    try:
        app.Quit()
    except Exception:
        pass
    try:
        pythoncom.CoUninitialize()
    except Exception:
        pass


def _formula_stats(path, sheets=None):
    """用 openpyxl 统计：公式单元格总数 / 已重算 / 仍为 None。"""
    from openpyxl import load_workbook

    wb_values = load_workbook(path, data_only=True)
    wb_formula = load_workbook(path, data_only=False)
    stats = []
    for name in (sheets or wb_values.sheetnames):
        if name not in wb_values.sheetnames:
            continue
        ws_value, ws_formula = wb_values[name], wb_formula[name]
        total = filled = none_left = 0
        for row in ws_formula.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    total += 1
                    if ws_value[cell.coordinate].value is None:
                        none_left += 1
                    else:
                        filled += 1
        stats.append((name, total, filled, none_left))
    return stats


def cmd_recalc(args):
    import os

    src = os.path.abspath(args.file)
    if not os.path.isfile(src):
        print(f"错误: 文件不存在 {src}", file=sys.stderr)
        return 2
    out = os.path.abspath(args.out) if args.out else src
    if not src.lower().endswith((".xlsx", ".xlsm", ".xls", ".et")):
        print("错误: recalc 仅支持 Excel 工作簿（.xlsx/.xlsm/.xls/.et）", file=sys.stderr)
        return 2

    app = None
    wb = None
    try:
        app = _ket_app()
        wb = app.Workbooks.Open(src, UpdateLinks=0)
        if args.sheet:
            names = [ws.Name for ws in wb.Worksheets]
            if args.sheet not in names:
                print(f"错误: 工作表不存在 {args.sheet}（现有: {names}）", file=sys.stderr)
                return 2
            wb.Worksheets(args.sheet).Calculate()
        app.CalculateFull()  # 全量重算（实测：重算后 data_only=True 可读回真值）
        if out != src:
            if os.path.exists(out):
                os.remove(out)
            wb.SaveAs(out)
        else:
            wb.Save()
        wb.Close(False)
        wb = None
    except Exception as exc:
        print(f"错误: KET 重算失败（{type(exc).__name__}: {exc}）", file=sys.stderr)
        return 3
    finally:
        try:
            if wb is not None:
                wb.Close(False)
        except Exception:
            pass
        if app is not None:
            _ket_quit(app)

    print(f"OK: 已重算并保存 -> {out}（计算范围: {'全表 CalculateFull' if not args.sheet else args.sheet + ' + CalculateFull'}）")
    stats = _formula_stats(out, [args.sheet] if args.sheet else None)
    left = 0
    for name, total, filled, none_left in stats:
        left += none_left
        print(f"   [{name}] 公式单元格 {total} 个：已重算 {filled}，仍为 None {none_left}")
    if left:
        print(f"⚠️ 警告: 仍有 {left} 个公式单元格读不回值（可能是外部链接/不支持的函数）", file=sys.stderr)
        return 1
    return 0


def _parse_source_range(spec):
    """'数据!A3:E23' 或 'A3:E23' -> (sheet 或 None, 'A3:E23')。"""
    spec = spec.strip()
    m = re.match(r"^(?:(?P<sheet>[^!]+)!)?(?P<rng>\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?)$", spec)
    if not m:
        raise ValueError(f"无效源区域: {spec}（示例: 数据!A3:E23 或 A3:E23）")
    return m.group("sheet"), m.group("rng").replace("$", "").upper()


def _pivot_headers(path, sheet, rng):
    """读源区域第一行作为字段名，返回 (表头列表, 首列名, 末列名)。"""
    from openpyxl import load_workbook

    (r1, c1), (r2, c2) = parse_range(rng)
    wb = load_workbook(path, data_only=True)
    ws = wb[sheet]
    headers = [ws.cell(row=r1, column=c).value for c in range(c1, c2 + 1)]
    headers = [str(h) if h is not None else f"列{c1 + i}" for i, h in enumerate(headers)]
    return headers


def cmd_pivot(args):
    import os
    import zipfile

    src = os.path.abspath(args.file)
    out = os.path.abspath(args.out)
    if not os.path.isfile(src):
        print(f"错误: 文件不存在 {src}", file=sys.stderr)
        return 2
    try:
        sheet_name, rng = _parse_source_range(args.source_range)
    except ValueError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2

    app = None
    wb = None
    failed = None
    try:
        app = _ket_app()
        wb = app.Workbooks.Open(src, UpdateLinks=0)
        sheet_name = sheet_name or wb.Worksheets(1).Name
        headers = _pivot_headers(src, sheet_name, rng)
        row_fields = args.rows or [headers[0]]
        value_field = args.values or headers[-1]

        dest = args.dest_sheet or "透视表"
        existing = [ws.Name for ws in wb.Worksheets]
        base, n = dest, 1
        while dest in existing:
            n += 1
            dest = f"{base}{n}"
        new_sheet = wb.Worksheets.Add()
        try:
            new_sheet.Name = dest
        except Exception:
            pass
        dest = new_sheet.Name  # 以实际工作表名为准（重名时 WPS 会自动改名）

        cache = wb.PivotCaches().Create(SourceType=1, SourceData=f"{sheet_name}!{rng}")
        pt = cache.CreatePivotTable(TableDestination=f"{dest}!R3C1", TableName="PT1")
        for field in row_fields:
            pt.PivotFields(field).Orientation = 1  # xlRowField
        pt.AddDataField(pt.PivotFields(value_field), f"求和项:{value_field}", -4157)  # xlSum
        wb.SaveAs(out)
        wb.Close(False)
        wb = None
    except Exception as exc:
        failed = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            if wb is not None:
                wb.Close(False)
        except Exception:
            pass
        if app is not None:
            _ket_quit(app)

    if failed:
        print(f"⚠️ 结论: KET COM 创建数据透视表不可行（{failed}）", file=sys.stderr)
        print(
            "替代做法：① 用 WPS 手工插入（数据→数据透视表）后另存；"
            "② 用 openpyxl 直接写「分组汇总表」代替透视表（按行字段分组求和，无法产出真透视部件）；"
            "③ 若源表已有透视表，openpyxl 往返会保留（xl/pivotTables、xl/pivotCache 均在）。",
            file=sys.stderr,
        )
        return 4

    parts = [n for n in zipfile.ZipFile(out).namelist() if "pivot" in n.lower()]
    print(f"OK: 已创建数据透视表 -> {out}（sheet={dest} 行字段={row_fields} 值字段={value_field} 目标=R3C1）")
    print(f"   包内 pivot 部件: {parts if parts else '（无）'}")
    try:
        from openpyxl import load_workbook

        wbp = load_workbook(out)
        print(f"   openpyxl 读回: {[str(p) for p in getattr(wbp[dest], '_pivots', [])]}")
    except Exception as exc:
        print(f"   openpyxl 读回失败: {type(exc).__name__}: {exc}", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description="Excel 工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("summary")
    p.add_argument("file")
    p.set_defaults(fn=cmd_summary)

    p = sub.add_parser("read")
    p.add_argument("file")
    p.add_argument("--sheet")
    p.add_argument("--range")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_read)

    p = sub.add_parser("write")
    p.add_argument("file")
    p.add_argument("--cell", action="append", metavar="A1=值")
    p.add_argument("--from-csv")
    p.add_argument("--sheet")
    p.set_defaults(fn=cmd_write)

    p = sub.add_parser("convert")
    p.add_argument("src")
    p.add_argument("dst")
    p.set_defaults(fn=cmd_convert)

    p = sub.add_parser("chart")
    p.add_argument("file")
    p.add_argument("--sheet", required=True)
    p.add_argument("--range", required=True)
    p.add_argument("--type", choices=["line", "bar", "col", "pie"], default="line")
    p.add_argument("--title", default="")
    p.add_argument("--anchor", default="G2")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_chart)

    p = sub.add_parser("merge")
    p.add_argument("out")
    p.add_argument("files", nargs="+")
    p.add_argument("--mode", choices=["rows", "sheets"], default="sheets")
    p.set_defaults(fn=cmd_merge)

    p = sub.add_parser("recalc", help="用 WPS COM 重算公式并保存（之后 data_only 可读真值）")
    p.add_argument("file")
    p.add_argument("--sheet", help="仅对该工作表额外调用 Calculate()")
    p.add_argument("--out", help="另存到新文件（默认原地保存）")
    p.set_defaults(fn=cmd_recalc)

    p = sub.add_parser("pivot", help="用 WPS COM 创建数据透视表")
    p.add_argument("file")
    p.add_argument("--source-range", required=True, metavar="S!A3:E23", help="源数据区域，如 数据!A3:E23")
    p.add_argument("--out", required=True, help="输出工作簿")
    p.add_argument("--rows", action="append", metavar="字段", help="行字段（默认源区首列表头，可重复）")
    p.add_argument("--values", metavar="字段", help="值字段（默认源区末列表头，求和）")
    p.add_argument("--dest-sheet", help="放置透视表的工作表名（默认新建 透视表）")
    p.set_defaults(fn=cmd_pivot)

    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
