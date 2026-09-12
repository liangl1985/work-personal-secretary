---
name: office-ppt
description: 处理 PowerPoint 演示文稿（.pptx/.ppt/.dps）：从大纲生成幻灯片、套用模板、提取幻灯片文本、导出 PDF、将每页导出为 PNG 图片。当用户要求制作、修改或阅读 PPT/WPS 演示文稿时使用。
---

# PPT 演示文稿处理（office-ppt）

> **脚本位置**：下文命令里的 `<DOC_SUITE_SCRIPTS>` = dsh-doc-suite 模块的 `scripts/` 目录。
> 权威取值：`py -3 <模块目录>\doctor.py --emit-skill-paths`（读 JSON 的 `scriptsDir`）；
> DSH 标准布局下即 `~/.dsh/profiles/desktop/node_modules/dsh-doc-suite/scripts`。

工具脚本：`py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py`（.pptx 走 python-pptx，导出 PDF/PNG 走 WPS COM）

## 子命令速查（参数形态实测确认）

| 子命令 | 用法 | 备注 |
|---|---|---|
| `create` | `create <out.pptx> [--title T] [--subtitle S] [--from-md a.md] [--template t.pptx]` | 输出是**位置参数**；`--from-md`/`--template` 所指文件必须存在 |
| `read` | `read <file>` | 提取所有幻灯片文本 |
| `convert` | `convert <src> <dst>` | **没有 `--to`**，两个都是位置参数 |
| `images` | `images <src> <outdir>` | **没有 `--out-dir`**，输出目录是第二个位置参数 |
| `autofit` | `autofit <file.pptx> [--out o.pptx] [--slide 1,3-5] [--font 微软雅黑] [--font-file 字体文件] [--max-size 40] [--min-size 8] [--dry-run]` | **文本框自动缩字号**（中文友好）；默认**就地修改并备份**，`--out` 则另存；到 `--min-size` 仍放不下会告警 |

## 常用命令

```bat
:: 从 Markdown 大纲生成 PPT（含封面页）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py create "汇报.pptx" --title "季度工作汇报" --subtitle "2025年Q3" --from-md "大纲.md"

:: 基于现有模板生成（复用其母版/版式）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py create "新.pptx" --title T --from-md "大纲.md" --template "公司模板.pptx"

:: 提取幻灯片全部文本
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py read "输入.pptx"

:: 导出 PDF（WPS COM，保真度高）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py convert "输入.pptx" "输出.pdf"

:: 每页导出 PNG（用于预览/发图）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py images "输入.pptx" "输出目录\slides"

# 文字溢出：先 dry-run 看会缩到多少，再决定另存还是就地改
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py autofit "输入.pptx" --dry-run --font 微软雅黑
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py autofit "输入.pptx" --out "修正后.pptx" --font 微软雅黑
```

## Markdown → 幻灯片规则

```
# 季度工作汇报        → 新一页，标题
## 重点项目进展       → 正文中的小节行（◆ 前缀）
- 完成了 X            → 项目符号
1. 第一步             → 编号列表
普通段落              → 正文段落
```

## 典型工作流

1. **汇报 PPT**：用户给要点/文档 → 整理成 Markdown 大纲 → `create` 生成 → `convert` 导出 PDF 预览。
2. **读 PPT 内容**：用户发来 pptx 问"里面讲了什么" → `read` 提取文本 → 汇总要点。
3. **截图版 PPT / 页面核对**：`images` 导出 PNG → 直接发给用户或交给基座原生识图。
4. **文字溢出**：用户说"这页字太多放不下" → `autofit`（先 `--dry-run` 看缩到多少）。若到 `--min-size` 仍放不下，工具会**告警**——此时应建议**拆页或精简文字**，不要继续缩小字号。

## 注意事项

- 默认 16:9 版式；`--template` 可复用公司模板的母版与配色。**排版上限取决于模板预制程度**——本工具不做自动排版。
- 生成的是基础版式（标题+正文），复杂版式（图示、SmartArt、动画）需要人工在 WPS 中调整。
- 导出 PDF/PNG 依赖本机 WPS Office COM（KWPP）。
- 大纲中的图片暂不支持自动嵌入；如需要，把图片路径写进大纲并说明。
- 自 2026-09-12 起，输入文件不存在/是目录会给出**中文单行错误并 exit 2**（不再是裸 Traceback）；排障时设 `DOC_SUITE_DEBUG=1` 可看完整堆栈。
