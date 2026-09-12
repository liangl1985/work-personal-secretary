---
name: office-word
description: 处理 Word 文档（.docx/.doc/.wps）：提取全文与表格、从 Markdown 生成文档、查找替换、统计信息、文档比对（红线修订）、导出 PDF 等格式转换。当用户要求撰写、修改、阅读、比对或转换 Word/WPS 文字文档时使用。
---

# Word 文档处理（office-word）

> **脚本位置**：下文命令里的 `<DOC_SUITE_SCRIPTS>` = dsh-doc-suite 模块的 `scripts/` 目录。
> 权威取值：`py -3 <模块目录>\doctor.py --emit-skill-paths`（读 JSON 的 `scriptsDir`）；
> DSH 标准布局下即 `~/.dsh/profiles/desktop/node_modules/dsh-doc-suite/scripts`。

工具脚本：`py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py`（.docx 走 python-docx，.doc/.wps 旧格式与格式转换走 WPS COM）

## 子命令速查（参数形态实测确认）

| 子命令 | 用法 | 备注 |
|---|---|---|
| `read` | `read <file>` | 提取全文（含表格，标题转 `#` 前缀） |
| `info` | `info <file>` | 段落数/字符数/表格数 |
| `create` | `create <out.docx> [--title T] [--from-md a.md] [--body 文本]` | 输出文件是**位置参数**；`--from-md` 所指文件必须存在 |
| `edit` | `edit <file> --replace "旧=新" [--replace "a=b"] [--out out.docx]` | `--replace` **必填**、可重复；不加 `--out` 则原地保存 |
| `convert` | `convert <src> <dst>` | **两个都是位置参数**（没有 `--to`） |
| `compare` | `compare A.docx B.docx --out-dir <目录> [--author 名] [--allow-tracked]` | `--out-dir` **必填**，产出 `diff.txt`+`diff.html`+`tracked.docx` |

## 常用命令

```bat
:: 读取文档全文（含表格，标题转 # 前缀）
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py read "输入.docx"

:: 统计：段落数/字符数/表格数
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py info "输入.docx"

:: 从 Markdown 生成 docx（支持 # 标题、- 列表、1. 列表、| 表格 |）
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py create "输出.docx" --title "文档标题" --from-md "大纲.md"

:: 查找替换（可多次 --replace，默认原地保存，--out 另存）
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py edit "输入.docx" --replace "旧文本=新文本" --out "输出.docx"

:: 导出 PDF（WPS COM，保真度高）
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py convert "输入.docx" "输出.pdf"

:: 文档比对：两版对照（红线修订，可直接用 Word/WPS 打开审阅）
py -3 <DOC_SUITE_SCRIPTS>\office\word_tool.py compare "旧版.docx" "新版.docx" --out-dir "比对输出" --author 姓名
```

## 典型工作流

1. **生成周报/公文**：先用 Markdown 写好内容（标题用 `#`），再 `create` 生成 docx；如需替换占位符（如 `{{姓名}}`）用 `edit`。
2. **阅读客户/同事发来的文档**：`read` 提取全文；旧格式 `.doc`/`.wps` 自动走 WPS COM。
3. **版本比对（投标文件/合同）**：`compare` 产出三件套——`diff.txt`（纯文本差异）、`diff.html`（左右对照）、`tracked.docx`（**字符级**红线修订，作者名已按 `--author` 改写）。**口径只覆盖正文与表格**，页眉页脚差异不参与修订，工具会就此告警。
4. **批量导出 PDF**：遍历目录逐个 `convert`，适合合并打印或存档。

## 注意事项

- `edit` 只做**文本级**替换，可能影响跨 run 的格式；复杂排版建议导出后人工核对。
- 生成文档默认中文字体为微软雅黑；需要模板样式时，先人工做一个 docx 骨架，再用 `edit` 填充。
- 转换 PDF 与红线比对依赖本机 **WPS Office**；报 `WPS 打开/处理文件失败` 时，先确认文件没被 WPS 占用、路径没有写错。
- 输入文件若本身已带修订（`w:ins`/`w:del`），`compare` 默认拒绝（加上 `--allow-tracked` 才继续）。
- 自 2026-09-13 起，输入文件不存在/是目录会给出**中文单行错误并 exit 2**（不再是裸 Traceback）；排障时设 `DOC_SUITE_DEBUG=1` 可看完整堆栈。
