---
name: office-excel
description: 处理 Excel 表格（.xlsx/.xls/.et）：读取工作表与单元格、写入数据、CSV 导入、生成图表、合并多个工作簿、导出 PDF/CSV。当用户要求整理、分析、汇总或生成电子表格时使用。
---

# Excel 表格处理（office-excel）

工具脚本：`py -3 E:\lina\scripts\office\excel_tool.py`（.xlsx 用 openpyxl，.xls 旧格式走 WPS COM）

## 常用命令

```bat
:: 概览：各工作表名称与行列数
py -3 E:\lina\scripts\office\excel_tool.py summary "输入.xlsx"

:: 读取数据（--sheet 指定表，--range 指定范围，--json 输出结构化）
py -3 E:\lina\scripts\office\excel_tool.py read "输入.xlsx" --sheet "Sheet1" --range A1:D20
py -3 E:\lina\scripts\office\excel_tool.py read "输入.xlsx" --json

:: 写入：新建或修改表格（--cell 可多次，--from-csv 导入数据）
py -3 E:\lina\scripts\office\excel_tool.py write "输出.xlsx" --cell A1=部门 --cell B1=人数 --from-csv "data.csv"

:: 导出 CSV / PDF
py -3 E:\lina\scripts\office\excel_tool.py convert "输入.xlsx" "输出.csv"
py -3 E:\lina\scripts\office\excel_tool.py convert "输入.xlsx" "输出.pdf"

:: 图表（第一行作为系列名，第一列作为分类轴；--type line|bar|col|pie）
py -3 E:\lina\scripts\office\excel_tool.py chart "输入.xlsx" --sheet Sheet1 --range A1:D13 --type line --title "月度趋势" --out "带图.xlsx"

:: 合并多个工作簿（--mode sheets 每文件一个工作表 / rows 纵向追加）
py -3 E:\lina\scripts\office\excel_tool.py merge "合并.xlsx" a.xlsx b.xlsx c.xlsx
```

## 典型工作流

1. **数据汇总**：多份 xlsx → `merge` 合并 → `read --json` 读取 → 分析后写回新表。
2. **报表生成**：用 `write --cell` 或 CSV 导入填数 → `chart` 加图表 → `convert` 导出 PDF 汇报。
3. **数据核对**：`read --range` 精确抽取区域，逐项比对；公式结果用 `data_only` 读取（即已计算值）。

## 注意事项

- `read` 返回的是**计算结果**（公式已求值）；`write` 写入的文本不会被计算，需要公式请直接写 `=SUM(A1:A10)` 这样的字符串。
- `chart` 的 `--range` 第一行会被当作系列名；饼图只取第一系列。
- 旧格式 `.xls`/`.et` 的读取与 PDF 导出走 WPS COM，需要本机 WPS Office。
- 大数据量（>10 万行）建议用 CSV 中转，避免 openpyxl 内存压力。
