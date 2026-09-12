---
name: office-word
description: 处理 Word 文档（.docx/.doc/.wps）：提取全文与表格、从 Markdown 生成文档、查找替换、统计信息、导出 PDF 等格式转换。当用户要求撰写、修改、阅读或转换 Word/WPS 文字文档时使用。
---

# Word 文档处理（office-word）

工具脚本：`py -3 E:\lina\scripts\office\word_tool.py`（.docx 用 python-docx，旧格式 .doc/.wps 走 WPS COM）

## 常用命令

```bat
:: 读取文档全文（含表格，标题转 # 前缀）
py -3 E:\lina\scripts\office\word_tool.py read "输入.docx"

:: 统计：段落数/字符数/表格数
py -3 E:\lina\scripts\office\word_tool.py info "输入.docx"

:: 从 Markdown 生成 docx（支持 # 标题、- 列表、1. 列表、| 表格 |）
py -3 E:\lina\scripts\office\word_tool.py create "输出.docx" --title "文档标题" --from-md "大纲.md"

:: 查找替换（可多次 --replace，默认原地保存，--out 另存）
py -3 E:\lina\scripts\office\word_tool.py edit "输入.docx" --replace "旧文本=新文本" --out "输出.docx"

:: 导出 PDF（WPS COM，保真度高）
py -3 E:\lina\scripts\office\word_tool.py convert "输入.docx" "输出.pdf"
```

## 典型工作流

1. **生成周报/公文**：先用 Markdown 写好内容（标题用 `#`），再 `create` 生成 docx；如需替换占位符（如 `{{姓名}}`）用 `edit`。
2. **阅读客户/同事发来的文档**：`read` 提取全文；旧格式 `.doc`/`.wps` 自动走 WPS COM。
3. **批量导出 PDF**：遍历目录逐个 `convert`，适合合并打印或存档。

## 注意事项

- `.docx` 修改会**丢失**宏、域、复杂排版？——不会丢，但 `edit` 只做文本级替换，可能影响跨 run 的格式；复杂排版建议用 WPS COM 手动打开核对。
- 生成文档默认中文字体为微软雅黑；如需模板样式，可先人工做好一个 docx 骨架，再用 `edit` 填充。
- 转换 PDF 依赖本机 WPS Office（`.lina/config.json` 的 `office.useWpsCom`），失败时提示用户检查 WPS 是否安装。
- 处理用户文档前先确认文件路径存在；输出文件放入用户指定位置或 `E:\lina\knowledge-base\templates` 之外的常规目录，不要污染知识库。
