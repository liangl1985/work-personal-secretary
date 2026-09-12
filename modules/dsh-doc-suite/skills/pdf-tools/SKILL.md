---
name: pdf-tools
description: 读取与处理 PDF 文件：提取文本、提取表格、合并/拆分/选页、页面转图片、图片合成 PDF。当用户要求阅读、提取、合并、拆分或转换 PDF 时使用。（扫描件 OCR 通道于 2026-09-12 退役：遇扫描件请先告知主人，不要直接走云端 OCR。）
---

# PDF 处理（pdf-tools）

> ⚠️ **扫描件 OCR 通道已于 2026-09-12 退役**：本技能原先复用 `image-vision` 的**云端** OCR（智谱）——凭证段已从配置删除、key 待吊销。
> 现遇到扫描件/图片型 PDF：先告知主人；再做选择——①用 DSH 原生图片输入逐页看图 ②等本地 OCR 方案落地（见 `02_分析笔记/15_文档能力复用选型（可施工方案）.md`）。

工具脚本：`py -3 E:\lina\scripts\pdf\pdf_tool.py`（PyMuPDF / pdfplumber / pypdf）

## 常用命令

```bat
:: 基本信息：页数、元数据
py -3 E:\lina\scripts\pdf\pdf_tool.py info "输入.pdf"

:: 提取文本（--pages 支持 "1-3,5"）
py -3 E:\lina\scripts\pdf\pdf_tool.py text "输入.pdf" --pages 1-5 --out "正文.txt"

:: 提取表格（输出 csv / xlsx / json，不指定 --out 则打印）
py -3 E:\lina\scripts\pdf\pdf_tool.py tables "输入.pdf" --out "表格.xlsx"

:: 合并多个 PDF
py -3 E:\lina\scripts\pdf\pdf_tool.py merge "合并.pdf" a.pdf b.pdf c.pdf

:: 拆分/选页
py -3 E:\lina\scripts\pdf\pdf_tool.py split "输入.pdf" --pages 1-3,7 --out "选页.pdf"

:: 页面转 PNG（扫描件 OCR 前先转图）
py -3 E:\lina\scripts\pdf\pdf_tool.py images "输入.pdf" --pages 1-10 --outdir "E:\lina\output\pages" --dpi 150

:: 图片合成 PDF（--fit a4 自动缩放居中）
py -3 E:\lina\scripts\pdf\pdf_tool.py make "输出.pdf" 图1.png 图2.jpg --fit a4

:: 扫描件 OCR（需要 .lina/config.json 已配置 vision.apiKey）
py -3 E:\lina\scripts\pdf\pdf_tool.py ocr "扫描件.pdf" --out "扫描件.md"
```

## 典型工作流

1. **阅读 PDF**：`info` + `text` 提取全文 → 总结要点；表格数据用 `tables` 结构化。
2. **文档归档**：`merge` 合并同类文件，`split` 剔除无关页。
3. **扫描件/图片型 PDF**：`text` 提取为空时，用 `images` 转图 → `image-vision` 技能逐页识别，或直接 `ocr`（自动复用视觉 API 转写为 Markdown）。
4. **制作 PDF 附件**：把多张截图/扫描图用 `make` 合成一个 PDF。

## 注意事项

- `text`/`tables` 只对文字型 PDF 有效；扫描件必须先 OCR。
- `tables` 对复杂版式（跨页表格、无边框）可能提取不全，必要时配合 `images` + `image-vision` 双保险。
- `ocr` 每页调用一次视觉 API，页数多时耗时和费用都会增加，可先用 `--pages` 试跑一页。
- 输出文件默认放在用户指定位置；不要写进知识库目录（除非用户要求归档）。
