---
name: office-ppt
description: 处理 PowerPoint 演示文稿（.pptx/.ppt/.dps）：从大纲生成幻灯片、提取幻灯片文本、导出 PDF、将每页导出为 PNG 图片。当用户要求制作、修改或阅读 PPT/WPS 演示文稿时使用。
---

# PPT 演示文稿处理（office-ppt）

工具脚本：`py -3 E:\lina\scripts\office\ppt_tool.py`（.pptx 用 python-pptx，导出走 WPS COM）

## 常用命令

```bat
:: 从 Markdown 大纲生成 PPT（含封面页）
py -3 E:\lina\scripts\office\ppt_tool.py create "汇报.pptx" --title "季度工作汇报" --subtitle "2025年Q3" --from-md "大纲.md"

:: 基于现有模板生成（复用其母版/版式）
py -3 E:\lina\scripts\office\ppt_tool.py create "新.pptx" --title T --from-md 大纲.md --template "公司模板.pptx"

:: 提取幻灯片全部文本
py -3 E:\lina\scripts\office\ppt_tool.py read "输入.pptx"

:: 导出 PDF（WPS COM，保真度高）
py -3 E:\lina\scripts\office\ppt_tool.py convert "输入.pptx" "输出.pdf"

:: 每页导出 PNG（用于预览/发图）
py -3 E:\lina\scripts\office\ppt_tool.py images "输入.pptx" "E:\lina\output\slides"
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
3. **截图版 PPT**：`images` 导出 PNG → 用 `image-vision` 技能逐页识别或直接发给用户。

## 注意事项

- 默认 16:9 版式；`--template` 可复用公司模板的母版与配色。
- 生成的是基础版式（标题+正文），复杂版式（图示、SmartArt、动画）需要人工在 WPS 中调整，或明确要求后由助手用 COM 精细化修改。
- 导出 PDF/PNG 依赖本机 WPS Office COM（KWPP）。
- 大纲中的图片暂不支持自动嵌入；如需要，把图片路径写进大纲并说明，助手会用 COM 插入。
