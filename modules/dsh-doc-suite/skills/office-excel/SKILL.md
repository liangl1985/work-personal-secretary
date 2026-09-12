---
name: office-excel
description: 处理 Excel 表格（.xlsx/.xls/.et）：读取工作表与单元格、写入数据、CSV 导入、公式重算、数据透视、生成图表、合并多个工作簿、导出 PDF/CSV。当用户要求整理、分析、汇总或生成电子表格时使用。
---

# Excel 表格处理（office-excel）

> **脚本位置**：下文命令里的 `<DOC_SUITE_SCRIPTS>` = dsh-doc-suite 模块的 `scripts/` 目录。
> 权威取值：`py -3 <模块目录>\doctor.py --emit-skill-paths`（读 JSON 的 `scriptsDir`）；
> DSH 标准布局下即 `~/.dsh/profiles/desktop/node_modules/dsh-doc-suite/scripts`。

工具脚本：`py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py`（.xlsx 走 openpyxl，.xls/.et 旧格式与公式重算/透视/导出走 WPS COM）

## 子命令速查（参数形态实测确认）

| 子命令 | 用法 | 备注 |
|---|---|---|
| `summary` | `summary <file>` | 各工作表名称与行列数 |
| `read` | `read <file> [--sheet S] [--range A1:C10] [--json]` | 读到公式未重算的格会向 **stderr** 提示先 `recalc` |
| `write` | `write <file> [--cell A1=值]... [--from-csv data.csv] [--sheet S]` | 文件不存在则**新建**；`--sheet` 不存在则新建表 |
| `convert` | `convert <src> <dst>` | 两个都是**位置参数**；目标可为 `.pdf`/`.csv` |
| `chart` | `chart <file> [--sheet S] --range A1:D10 [--type line\|bar\|col\|pie] [--title T] [--anchor G2] --out <xlsx>` | `--sheet` **可省略**（默认第一张表）；`--range`/`--out` 必填 |
| `merge` | `merge <out.xlsx> f1.xlsx f2.xlsx ... [--mode rows\|sheets]` | 输出在前，输入文件是位置参数 |
| `recalc` | `recalc <file> [--sheet S] [--out out.xlsx]` | KET `CalculateFull`，之后 `read` 才能读到真值 |
| `pivot` | `pivot <file> --source-range "表!A1:D7" --out <xlsx> [--rows 字段]... [--values 字段] [--dest-sheet 名]` | 源区**必须含表头且非空**；指向空区会 exit 4 并给出替代做法 |

## 常用命令

```bat
:: 概览：各工作表名称与行列数
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py summary "输入.xlsx"

:: 读取数据（--sheet 指定表，--range 指定范围，--json 输出结构化）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py read "输入.xlsx" --sheet "Sheet1" --range A1:D20
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py read "输入.xlsx" --json

:: 写入：新建或修改表格（--cell 可多次，--from-csv 导入数据）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py write "输出.xlsx" --cell A1=部门 --cell B1=人数 --from-csv "data.csv"

:: 导出 CSV / PDF
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py convert "输入.xlsx" "输出.csv"
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py convert "输入.xlsx" "输出.pdf"

:: 公式重算（openpyxl 无计算引擎；写公式后必须重算才能读到数值）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py recalc "带公式.xlsx"

:: 数据透视表（源区含表头，如 A1:D7）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py pivot "源.xlsx" --source-range "数据!A1:D7" --rows 地区 --values 金额 --out "透视.xlsx"

:: 图表（第一行作为系列名，第一列作为分类轴；--type line|bar|col|pie）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py chart "输入.xlsx" --range A1:D13 --type line --title "月度趋势" --out "带图.xlsx"

:: 合并多个工作簿（--mode sheets 每文件一个工作表 / rows 纵向追加）
py -3 <DOC_SUITE_SCRIPTS>\office\excel_tool.py merge "合并.xlsx" a.xlsx b.xlsx c.xlsx
```

## 典型工作流

1. **数据汇总**：多份 xlsx → `merge` 合并 → `read --json` 读取 → 分析后写回新表。
2. **报表生成**：用 `write --cell` 或 CSV 导入填数 → `chart` 加图表 → `convert` 导出 PDF 汇报。
3. **公式表核对**：`read` 若提示"公式未重算"，先 `recalc` 再读——否则公式格返回 `None`。
4. **分类统计**：`pivot` 出真透视表（产物含 `xl/pivotTables/*` 与 `xl/pivotCache/*`，WPS 里可继续拖字段）。若 COM 建表不可行，命令会明确报"不可行"并给出替代做法，**不会**静默产出空文件。

## 注意事项

- `read` 返回的是**计算结果**；`write` 写入的字符串不会被求值，要公式就直接写 `=SUM(A1:A10)`，然后跑 `recalc`。
- `chart` 的 `--range` 第一行会被当作系列名；饼图只取第一系列。
- 旧格式 `.xls`/`.et` 的读取与 PDF 导出走 WPS COM，需要本机 WPS Office；`recalc` 对 `.xls` 未实测。
- `pivot` 不做小计行识别：源区域里若有"合计"行，会被当成一个行项目，注意排除。
- 大数据量（>10 万行）建议用 CSV 中转，避免 openpyxl 内存压力。
- 自 2026-09-12 起，输入文件不存在/是目录、工作表名写错，都会给出**中文单行错误并 exit 2**（表名写错时还会列出可用表名）；排障时设 `DOC_SUITE_DEBUG=1` 可看完整堆栈。
