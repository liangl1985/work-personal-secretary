---
name: office-ppt
description: 处理 PowerPoint 演示文稿（.pptx/.ppt/.dps）：按 manifest 渲染成套成稿（16 类页型）、给已有 pptx 套样式（字体统一 + 内容零改动断言）、从大纲生成、提取文本、导出 PDF、逐页导出 PNG。当用户要求制作、修改或阅读 PPT/WPS 演示文稿时使用。
---

# PPT 演示文稿处理（office-ppt）

> **脚本位置**：下文命令里的 `<DOC_SUITE_SCRIPTS>` = dsh-doc-suite 模块的 `scripts/` 目录。
> 权威取值：`py -3 <模块目录>\doctor.py --emit-skill-paths`（读 JSON 的 `scriptsDir`）；
> DSH 标准布局下即 `~/.dsh/profiles/desktop/node_modules/dsh-doc-suite/scripts`。

## 一、先选路径（两条主线 + 一条旧路）

| 场景 | 用什么 | 特点 |
|---|---|---|
| **新建成套成稿**（要版式、要统一） | `ppt_render.py render` + **manifest** | 16 类页型、几何来自主题规格、超容量自动缩字号、原生图表/表格、可写演讲者备注 |
| **已有文件美化** | `ppt_style.py apply-style` | 统一字体（+ 可选文字色）；**内容零改动断言**，差异即 **exit 3** 拒绝产出 |
| 轻量大纲生成（旧路，仍保留） | `ppt_tool.py create` | 标题 + 正文的简单版式，**不套主题** |
| 只读 / 导出 | `ppt_tool.py read / convert / images` | 文本提取、导出 PDF、逐页 PNG（导出走 WPS COM） |

> 判据：**要"好看的成稿"走 ppt_render（先出样张确认再铺量）；只是"把已有 PPT 的字体统一"走 ppt_style**。

## 二、ppt_render.py（B 线主路径：manifest → pptx）

### 命令

| 子命令 | 用法 | 说明 |
|---|---|---|
| `render` | `render <manifest.json> <out.pptx> [--theme standard] [--assets DIR] [--dry-run]` | 渲染成稿；`--dry-run` 只校验与预演字号，不写文件 |
| `validate` | `validate <manifest.json> [--theme standard]` | 干跑校验（契约 + 主题规格几何 + 容量预演），失败 **exit 2** + 中文单行 |
| `list-layouts` | `list-layouts [--theme standard]` | 列出 16 类页型与组件（标注实现状态） |

**退出码**：`0` 成功 ｜ `2` 参数或 manifest 校验失败 ｜ `5` 缺 Pillow 或字体文件。

### manifest 最小示例

`§jsonc
{
  "schema": "dsh-doc-suite/ppt-manifest@1",
  "theme": "standard",
  "title": "册名（不进页面）",
  "notes": ["第 1 页讲稿", "第 2 页讲稿"],
  "slides": [
    { "layout": "cover",    "kicker": "2026 · 技术方案", "title": "标题", "subtitle": "副标题", "meta": "落款" },
    { "layout": "toc",      "title": "目录", "items": [{ "index": "01", "title": "建设背景", "page": "03" }] },
    { "layout": "section",  "index": "第 02 章", "title": "需求分析" },
    { "layout": "bullets",  "title": "建设思路", "bullets": ["要点一", "要点二"], "source": "数据来源：…" },
    { "layout": "cards",    "title": "方案价值", "cards": [{ "icon": "shield", "title": "合规达标", "body": "…" }] },
    { "layout": "compare",  "title": "前后对比", "left": { "title": "前", "body": ["…"] }, "right": { "title": "后", "body": ["…"] } },
    { "layout": "data",     "title": "关键指标", "items": [{ "value": "98%", "label": "覆盖率" }], "body": ["说明"] },
    { "layout": "chart",    "title": "整改进度", "type": "bar", "categories": ["1月"], "series": [{ "name": "计划", "values": [10] }] },
    { "layout": "table",    "title": "清单", "header": ["序号", "项"], "rows": [["1", "甲"]] },
    { "layout": "quote",    "text": "一句话引文。", "attribution": "— 来源" },
    { "layout": "image",    "title": "总体架构", "image": "assets/icons/network.png", "caption": "图 1 …", "body": ["要点"] },
    { "layout": "process",  "title": "实施步骤", "steps": [{ "index": "01", "title": "资产梳理", "body": "…" }] },
    { "layout": "timeline", "title": "里程碑", "milestones": [{ "when": "第 1—2 周", "title": "启动", "body": "…" }] },
    { "layout": "case",     "title": "同类案例", "cases": [{ "title": "某电网", "body": "…", "tag": "2025 · 12 厂站" }] },
    { "layout": "qa",       "title": "常见问答", "items": [{ "question": "…？", "answer": "…。" }] },
    { "layout": "closing",  "title": "谢谢", "subtitle": "落款" }
  ]
}
`§

### 16 类页型与容量上限（超出由渲染器省略或缩字号并**告警**）

| 页型 | 用途 | 关键字段（必填加粗） | 上限 |
|---|---|---|---|
| `cover` | 封面（深色） | **title** · kicker · subtitle · meta | — |
| `toc` | 目录 | **items[{title, index?, page?}]** | 8 条 |
| `section` | 章节页（深色） | **title** · index | — |
| `bullets` | 要点 | **bullets[]** · source | 8 行 |
| `cards` | 卡片 | **cards[{title, body?, icon?}]** | 6 张（≤3 单行 / 4 → 2×2 / 5–6 → 3×2） |
| `compare` | 左右对比 | **left / right {title, body[]}** | 每栏 5 行 |
| `data` | 数据页 | **items[{value, label}]** · body[] | 4 个 KPI · 说明 5 行 |
| `chart` | 图表 | **series[{name, values[]}]** · categories · type(bar/line/pie) | — |
| `table` | 表格 | **header[]** · rows[][] | 行数由渲染器压缩/告警 |
| `quote` | 引文 | **text** · attribution | 3 行 |
| `image` | 图文 | **image**（本地路径或 `gen:`）· caption · body[] | 要点 8 行 |
| `process` | 实施步骤 | **steps[{title, index?, body?}]** · body[] | 4 步 |
| `timeline` | 时间线 | **milestones[{when, title, body?}]** | 4 个 |
| `case` | 案例业绩 | **cases[{title, body?, tag?}]** · body[] | 3 张 |
| `qa` | 问答 | **items[{question, answer}]** | 4 组（2×2） |
| `closing` | 结束页（深色） | **title** · subtitle | — |

### 容错与口径（写给派单方）

- **未知 layout** → 退化为 `bullets` 并告警；**未知字段**忽略；**缺必填** → exit 2 并指名页号（`manifest.slides[N].xxx`）
- 超 `limits.max_slides` → 保留首页 + 中段 + 末页，并告警
- **超容量自动缩字号**（Pillow 按**字符**测量，不用 python-pptx 的 `fit_text()` —— 它对中文不可用）；到 `autofit.min_size_pt` 仍放不下则**告警**，此时应**拆页或精简文字**
- `notes` 与 slides 等长按索引写入**演讲者备注**（单页 `notes` 优先）
- 页型几何、字号、色值**全部来自 `specs/standard.json` 的 `pptx` 段**：改版式改规格，**不要改脚本**

### 常用命令

`§bat
:: 先干跑校验（推荐：先 validate 再 render）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_render.py validate "方案.manifest.json"
:: 渲染（--dry-run 可先看每页字号决策）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_render.py render "方案.manifest.json" "方案.pptx"
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_render.py render "方案.manifest.json" "方案.pptx" --dry-run
:: 看看有哪些页型可用
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_render.py list-layouts
`§

## 三、ppt_style.py（给【已有 PPT】套样式）

`§bat
:: 先看会改什么（不写盘）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_style.py apply-style "客户来的.pptx" --dry-run
:: 另存（原文件不动）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_style.py apply-style "客户来的.pptx" --out "统一字体.pptx"
:: 就地改（自动备份 .bak-pptstyle-<时间戳>）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_style.py apply-style "客户来的.pptx"
:: 顺带统一文字色（只改「未显式设色」的 run，慎用）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_style.py apply-style "客户来的.pptx" --text-color text_on_light
`§

- 作用范围：**逐 run 统一字体**（`a:latin / a:ea / a:cs` 三属性，覆盖正文、**表格单元格**、**演讲者备注**）；**不改字号、不改位置**
- **退出码**：`0` 成功 ｜ `2` 输入 / 参数 / 规格错 ｜ **`3` = 内容零改动断言失败 → 已拒绝产出、原文件未动**（安全拦截，不是工具坏了）
- 断言口径：逐页**文本 / 表格单元格 / 图表系列与类别 / 备注**快照比对；有差异先查是不是文件里有工具无法安全保留的结构（组合图形内文本、SmartArt 等）

## 四、ppt_tool.py（轻量生成 / 读取 / 导出）

工具脚本：`py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py`

| 子命令 | 用法 | 备注 |
|---|---|---|
| `create` | `create <out.pptx> [--title T] [--subtitle S] [--from-md a.md] [--template t.pptx]` | 输出是**位置参数**；`--from-md`/`--template` 所指文件必须存在 |
| `read` | `read <file>` | 提取所有幻灯片文本 |
| `convert` | `convert <src> <dst>` | **没有 `--to`**，两个都是位置参数 |
| `images` | `images <src> <outdir>` | **没有 `--out-dir`**，输出目录是第二个位置参数 |
| `autofit` | `autofit <file.pptx> [--out o.pptx] [--slide 1,3-5] [--font 微软雅黑] [--font-file 字体文件] [--max-size 40] [--min-size 8] [--dry-run]` | **文本框自动缩字号**（中文友好）；默认**就地改并备份**，到下限仍放不下会告警 |

`§bat
:: 导出 PDF / 逐页 PNG（WPS COM，保真度高、较慢）
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py convert "输入.pptx" "输出.pdf"
py -3 <DOC_SUITE_SCRIPTS>\office\ppt_tool.py images "输入.pptx" "输出目录\slides"
`§

## 五、Markdown → 幻灯片（仅 `create` 路径）

`§
# 季度工作汇报        → 新一页，标题
## 重点项目进展       → 正文中的小节行（◆ 前缀）
- 完成了 X            → 项目符号
1. 第一步             → 编号步骤
普通段落              → 正文段落
`§

## 六、典型工作流

1. **做一册成套成稿**：整理内容 → 写 manifest（16 类页型各就位）→ `validate` → `render` → `images` 出图**目检** → 交使用者确认 → 需要改版式就改 `specs` 再渲染。
2. **客户来稿美化**：`apply-style --dry-run` 先看范围 → 就地改（自动备份）或 `--out` 另存 → `images` 出图核对；若 **exit 3** → 报告"该文件有无法安全保留的结构"，不硬来。
3. **读 PPT**：用户发来 pptx 问内容 → `read` 提取文本 → 汇总要点。
4. **页面核对 / 发图**：`images` 导出 PNG → 交给基座原生识图或直接发图。
5. **文字溢出**：`autofit --dry-run` 看会缩到多少；到下限仍放不下 → 建议**拆页或精简**，不要继续缩。

## 七、注意事项（踩过的坑）

- **WPS COM 导出同名文件会返回上一次的缓存画面**：重渲染后出图**必须换输出文件名或换目录**，否则会误判「改了没生效」；出图后按**启动时间**清理残留的 `wpp`/`wps` 进程，**绝不盲杀使用者自己开着的 WPS**。
- **JSON 禁 BOM**：manifest 与规格一律用 Python/Node 写（PowerShell 会带 BOM，工具会直接拒绝并给中文提示）。
- 排版上限取决于几何预制程度：**复杂版式（动画、SmartArt、自动避让）本工具不做**。
- 进度/环形图：`ring` 组件经小样验证**未通过**，已**降级为数据条** —— 进度类数据用 **chart 页**表达。
- 生成物与技能的分工：**专家管"怎么想"、模型管"写什么"、本工具管"做成文件"**；本 SKILL.md 是工具与专家之间的契约。
- 输入文件不存在/是目录 → 中文单行错误 + `exit 2`（不是裸 Traceback）；排障设 `DOC_SUITE_DEBUG=1` 看完整堆栈。
