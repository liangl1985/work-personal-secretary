---
name: pdf-tools
description: 读取与处理 PDF 文件：提取文本、提取表格（带 bbox）、合并/拆分/选页、页面转图片、图片合成 PDF。当用户要求阅读、提取、合并、拆分或转换 PDF 时使用。（扫描件 OCR 通道于 2026-09-12 退役：遇扫描件请转图片交基座原生识图，不要走云端 OCR。）
---

# PDF 处理（pdf-tools）

> ⚠️ **扫描件 OCR 通道已于 2026-09-12 退役**：本工具**不再做本地 OCR，也不再调用任何云端视觉 API**。
> `ocr` 子命令保留为墓碑，只会打印退役说明。
> 遇到扫描件/图片型 PDF 的替代做法：① 用 `images` 把页面转成 PNG，直接发给基座（DSH 原生识图）；
> ② `text` 会明确回报"此页为扫描件"，据此判断是否需要转图。

> **脚本位置**：下文命令里的 `<DOC_SUITE_SCRIPTS>` = dsh-doc-suite 模块的 `scripts/` 目录。
> 权威取值：`py -3 <模块目录>\doctor.py --emit-skill-paths`（读 JSON 的 `scriptsDir`）；
> DSH 标准布局下即 `~/.dsh/profiles/desktop/node_modules/dsh-doc-suite/scripts`。

工具脚本：`py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py`（PyMuPDF / pdfplumber / pypdf，**只读精确提取**）

## 子命令速查（参数形态实测确认）

| 子命令 | 用法 | 备注 |
|---|---|---|
| `info` | `info <pdf>` | 页数/元数据；非 PDF 文件会告警 |
| `text` | `text <pdf> [--pages 1-3,5] [--out out.txt]` | 旋转页/扫描件会告警 |
| `tables` | `tables <pdf> [--pages ..] [--out out.xlsx\|csv\|json]` | 输出带 `bbox` 与引擎名；**找不到表不是错误（exit 0）**，提示走 stderr |
| `merge` | `merge <out.pdf> a.pdf b.pdf ...` | **输出在前**，输入是位置参数 |
| `split` | `split <pdf> --pages 1-3,7 --out <pdf>` | `--pages`/`--out` 必填 |
| `images` | `images <pdf> [--pages ..] --outdir <目录> [--dpi 150]` | `--outdir` 必填 |
| `make` | `make <out.pdf> img1.png img2.jpg ... [--fit a4\|auto]` | **输出在前**；`--fit a4` 自动缩放居中 |
| `ocr` | `ocr <pdf>` | **【已退役】** 只打印退役说明并 exit 0 |

## 常用命令

```bat
:: 基本信息：页数、元数据
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py info "输入.pdf"

:: 提取文本（--pages 支持 "1-3,5"）
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py text "输入.pdf" --pages 1-5 --out "正文.txt"

:: 提取表格（输出 csv / xlsx / json，不指定 --out 则打印）
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py tables "输入.pdf" --out "表格.xlsx"

:: 合并多个 PDF
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py merge "合并.pdf" a.pdf b.pdf c.pdf

:: 拆分/选页
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py split "输入.pdf" --pages 1-3,7 --out "选页.pdf"

:: 页面转 PNG（扫描件交给基座原生识图前先转图）
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py images "输入.pdf" --pages 1-10 --outdir "输出目录\pages" --dpi 150

:: 图片合成 PDF（--fit a4 自动缩放居中）
py -3 <DOC_SUITE_SCRIPTS>\pdf\pdf_tool.py make "输出.pdf" 图1.png 图2.jpg --fit a4
```

## 典型工作流

1. **阅读 PDF**：`info` + `text` 提取全文 → 总结要点；表格数据用 `tables` 结构化（每张表带 `bbox=...` 与 `引擎=` 行）。
2. **文档归档**：`merge` 合并同类文件，`split` 剔除无关页。
3. **扫描件/图片型 PDF**：`text` 回报空且提示"扫描件"时 → `images` 转图 → **直接发给基座原生识图**。
4. **制作 PDF 附件**：把多张截图/扫描图用 `make` 合成一个 PDF。

## 注意事项

- `text`/`tables` 只对**文字型** PDF 有效；扫描件没有文本层，必须转图后交给基座识图。
- `tables` 对复杂版式（跨页表格、无边框、**合并单元格、旋转页**）可能提取不全或列序错乱——工具会主动告警"该表可能失真，需人工复核"。
- 输出文件默认放在用户指定位置；不要写进知识库目录（除非用户要求归档）。
- 自 2026-09-12 起，输入文件不存在/是目录会给出**中文单行错误并 exit 2**（不再是裸 Traceback）；排障时设 `DOC_SUITE_DEBUG=1` 可看完整堆栈。
