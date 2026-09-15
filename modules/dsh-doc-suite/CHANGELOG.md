## 0.1.9 — 2026-09-15（A2.3：Word 字体统一 —— 全文单一「仿宋」）

- **根因（实测，两处）**：
  1. **命名样式覆盖不全** —— 规格只列 Normal / Heading 1-3，文档实际还用了 `Title` / `List Bullet` / `List Number` / `List Paragraph`，其字体仍是原文的「仿宋」，与正文的「仿宋_GB2312」**是两个不同字体名、视觉不一致**；
  2. **表格内 run 的直接字体未清** —— `_strip_run_fonts` 只遍历 `doc.paragraphs`，而 **python-docx 的 `doc.paragraphs` 不含表格内段落**（实测四属性全量统计 1564 处，其中表格 334 处 run 保留了直接格式）。
- **修复**：
  1. 新增 `iter_all_paragraphs()`：遍历正文 + 表格（**含嵌套表格**）内全部段落；`_strip_run_fonts` 改用它，并**同时清理段落级 `pPr/rPr` 的 rFonts/sz**；
  2. 新增**样式族 `style_families`（规格可配）**：把文档里**实际存在但 `styles` 段未逐条列出**的样式按角色族统一字体 —— body 族（Normal / Body Text / List* / Table Grid / Normal Table / No Spacing …，含前缀匹配）与 heading 族（Heading 1-9 / Title / Subtitle）；**只改字体，不动字号与段落格式**；
  3. **字体口径（主人 2026-09-15 定）**：全文**只允许「仿宋」一种** —— 英文/数字/汉字、正文与标题、表格与表头一律仿宋，`w:rFonts` **四属性(ascii/hAnsi/eastAsia/cs) 全 = 仿宋**；层级只靠**字号 + 加粗 + 对齐**区分；**不做字体优先级/回退链**；弃用「仿宋_GB2312」（多数机器未装、有回退风险）；
  4. 新增 `all_font_names()`（四属性统计）+ **落盘前字体统一性校验**：出现规格外字体（`allowed_fonts = ["仿宋"]`）即**拒绝产出**。
- **实测（原件副本）**：

  | 样本 | 修复前字体集合 | 修复后 |
  |---|---|---|
  | 青海成峰开票对账说明 | `{仿宋}`（正文/标题/表格曾混用多字体名，视觉不统一） | **`{仿宋}`** |
  | 羊曲水电站治安反恐防范简介 | `{仿宋, 黑体}`（标题黑体） | **`{仿宋}`** |

  内容零改动断言均通过（逐段 + 逐单元格，差异 0）。
- **回归 16 → 19 例**：新增「规格口径（allowed_fonts 单一）」「实现齐备（样式族 + 表格/段落清理 + 四属性断言）」「端到端：字体集合恒为 `{仿宋}`（样本含表格/英文/数字/直接格式污染）」。
- 顺带：`word_style.py` 内 `Times New Roman` / `Arial` / `黑体` / `仿宋_GB2312` 兜底默认值全部移除，统一为仿宋。
- **字号 / 加粗定案（主人 2026-09-15 选 A 方案）**：`Heading 2`（14pt）与 `Heading 4`（12pt）由**不加粗 → 加粗** —— 原实现下 h4 与正文完全同规格（同字号 / 同字重 / 同对齐），**层级丢失**；同时补上 `Heading 4` 的完整定义（此前只有标题键、无正文）。
- **字号改用中文标识**（主人 2026-09-15）：规格同时保存 `size_name`（人类可读）与 `size_pt`（实现值）—— `Heading 1` = **小三 15pt**、`Heading 2` = **四号 14pt**、`Heading 3`/`Heading 4` = **小四 12pt**、正文 `Normal` = **小四 12pt**。（0.1.6 过程值 h1 = 16pt/三号，按主人口径改为**小三 15pt**。）
- **Excel 字体与 Word 统一**（主人 2026-09-15）：`excel.font` 由 `宋体 11pt` → **仿宋 小四 12pt**（`name=仿宋` / `size=12` / `size_name=小四`）。
- **新增规格运维工具 `scripts/spec_sync.py`**（**零新增依赖**；**不含任何使用者私有路径** —— 展示文档输出走 `--doc-out`，缺省打印到标准输出）：一条命令完成「**校验** `specs/*.json` → **同步** profile 运行副本（逐文件 SHA256 校验）→ **生成**规格展示 Markdown」。`--check` 只校验不写盘（可进 CI）；退出码 **0 成功 / 2 规格或输入错误 / 3 同步后哈希不一致**；`extends` 继承件按**部分规格**放宽校验。
- **技能文档口径更正**：`skills/office-word|office-excel/SKILL.md` 里的过时描述（「页边距 2.54/3.17 + 黑体标题」「宋体 11」）已改为最新规格（「上下 3.17 / 左右 2.54 + 全文仿宋 + 小三/四号/小四」「仿宋 小四 12pt」），并在**仓库 / profile / 工作区 `.dsh/skills` 三处同步一致**（逐文件 SHA256）。

## 0.1.8 — 2026-09-15（A3：色板可读性修正 + 第二套内置风格 compact + extends 继承 + 自定义层样例）

- **色板修正：文字色与装饰色分离**（依据 `39_多套文档风格方案` 的 WCAG 本机实测）：
  - `colors.accent`：`ED7D31`（对白底 **2.77:1**，作文字不达标）→ **`B45309`（5.02:1）**；新增 `colors.accent_decor = ED7D31`，保留原亮色供**底纹/边框/图形**等装饰场景使用。
  - `colors.semantic.warn`：`BF9000`（**2.91:1**）→ **`8A6A00`（5.07:1）**；新增 `warn_decor = BF9000`。
  - 规格内加 `colors._note` 写明取用规则：**文字类属性取 `accent` / `warn`；非文字类（底纹/边框/图形）取 `*_decor`**。
- **规格支持 `extends` 继承**（`style_spec._load_by_id`）：派生风格只需写差异键，递归继承基座并带**循环保护**；加载顺序仍为「内置 → 使用者自定义层同名覆盖 → extends 链」。
- **新增第二套内置风格 `specs/compact.json`（内部纪要）**：`extends = standard`，按 39 号方案 2.3 —— 页边距 **2.2 / 2.2 / 2.0 / 2.0 cm**、Normal **10.5pt + 行距 1.15**、标题 **14 / 12 / 10.5pt**（整体降一档）、表格中性浅灰细线（`BFBFBF` / 2）、主色改**灰蓝 `44546A` / `5A6478`**。用法：`--spec compact`。
- **自定义层样例 `report`（汇报报告）**：写入 `~/.dsh/data/dsh-doc-suite/templates/report.json`（**使用者自定义层，非发布件**）：章节标题左对齐、表头底纹 `BDD7EE`、边框 4→6、强调色 `B45309`。用法：`--spec report`。
- **回归 14 → 16 例**：新增「`compact` / `report` 可加载且 `extends` 生效」「色板修正断言」。
- **零新增依赖**（规格仍为 JSON）；内容零改动红线不变。

## 0.1.7 — 2026-09-15（A2.2：表格宽度 / 列宽自适应）

- **表格撑满版心**（`word.table.width_mode = "full"`，默认）：`table-style` 设 `w:tblW` = 版心宽度
  （页宽 − 左/右页边距，dxa）、`w:tblLayout = fixed`（**关键** —— 不设 fixed 时 Word/WPS 会按内容重算列宽，
  设置等于无效），并清零 `w:tblInd`。
- **列宽自适应（两阶段分配）**：
  1. **先给「表头不折行」保底**：每列 ≥ 表头显示宽度 × 110 twips + 230（单元格内边距近似），
     按 `w:tblGrid/w:gridCol` 与每格 `w:tcPr/w:tcW` 写回（按 `w:gridSpan` 正确合计跨列宽）；
  2. 剩余宽度按权重分配：权重 = max(表头显示宽度, 数据平均宽度, **数据最大宽度 × 0.8**)，
     再按 `min_col_chars`(4) / `max_col_chars`(40) 夹取 —— **全角算 2、半角算 1**。
- **优先级（实测确定）**：① **表头必须一行**（主人明确要求）→ ② 数据短值尽量不折行 →
  ③ 超长数据允许折行（19 位发票号在 6 列表格中属版心物理限制，强行不折行会反过来挤压表头）。
- **规格新增**：`word.table.width_mode` / `min_col_chars` / `max_col_chars`（`auto` 可关闭宽度自适应）。
- **回归新增 1 例（共 14 例）**：断言 `tblW = 版心宽`、`tblLayout = fixed`、`ΣgridCol = 版心宽`、
  且**每个表头列的列宽 ≥ 其不折行所需宽度**。
- **零新增依赖**；内容零改动红线不变（落盘前逐段 + 逐单元格断言，差异即 exit 3）。

## 0.1.6 — 2026-09-15（A2.1：文档角色识别 + 表格列对齐；默认模板按主人真实投标文件校准）

- **新增文档角色识别**（`scripts/office/doc_roles.py`）—— 依据 `02_分析笔记/36_投标文件格式画像` 实测：
  - **双信号**：命名样式（heading 1-4 / 标题 / toc）**优先**；**编号模式兜底**（正文未套样式时唯一可用）：
    `N.` → heading_1、`N.M` → heading_2、`（N）` → heading_3、`A：`/`B:` → heading_4；
    居中 + 无编号 + 文首区（默认前 30 段）+ ≤40 字 → **doc_title**（封面大标题）。
  - 命中编号模式但未套命名样式的段落，**赋对应 Heading 命名样式**（只改样式、不改文本）；doc_title 用直接格式，不新建样式以免污染样式表。
  - **可回溯**：`apply-style --dry-run` 报告含各角色计数与样本（段落序号 / 角色 / 判定依据 / 文本前 40 字）。
- **规格 v1.1**（`specs/standard.json`，按主人真实投标文件校准）：
  - 页边距改为 **上下 3.17 / 左右 2.54 cm**（原为上下 2.54 / 左右 3.17，与投标文件相反）；
  - 标题字号：**主人 2026-09-15 对比两版样张后拍板为 B 方案** —— `Heading 1` = **16pt 黑体加粗居中**、`Heading 2` = **14pt 黑体**、`Heading 3` = **12pt 加粗**，新增 `Heading 4`（过程值曾按投标文件取 14/12pt，已按拍板改回）；
  - 新增 `word.doc_title` 段（封面大标题，居中加粗；字号阶梯 cover 36 / subtitle 22 / project 18 / party 16 / code 14pt，可配）；
  - 新增 `roles` 段（编号模式声明 + title_zone / title_max_chars）。
- **表格列对齐**（主人 2026-09-15：「标题、序号居中，其他右对齐」）：
  - 表头行 → 居中；**序号列**（序号 / 编号 / 项次 / No.）→ 居中；**数值列** → **右对齐**；纯文本列 → `text_align_default`（默认 **left** —— 长中文右对齐极难阅读；要「一律右对齐」改一个键即可）。
  - Word `table-style` 与 Excel `apply-style` **同步生效**；数值判定阈值 `numeric_ratio` 默认 0.6，可配。
- **零新增依赖**：仍只用标准库 + python-docx / openpyxl。
- 回归 `scripts/style-test.mjs` 扩充覆盖角色识别与列对齐。

## 0.1.5 — 2026-09-15（A 线：给【已有文件】套样式的能力）

- **新增三个样式化子命令**（设计规格见 `02_分析笔记/28_文档设计系统 v1（Word_Excel）.md`）：
  - `word_tool.py apply-style` —— 对**已有** docx 套版式：页面（A4 纵向、页边距 上下 2.54 / 左右 3.17cm）、命名样式（Normal / Heading 1-3）、
    **字体四属性**（`w:rFonts` 的 ascii / hAnsi / eastAsia / cs 全设 —— 只设 `font.name` 时中文会回落到默认东亚字体）、行距 **1.5 倍**、正文首行缩进 2 字符、标题大纲级别。
  - `word_tool.py table-style` —— 表头底纹 + 加粗 + 居中、边框、**跨页重复表头**、表内字号 10.5pt。
  - `excel_tool.py apply-style` —— 宋体 11、表头底纹 + 加粗 + 居中 + **冻结首行**、thin 边框、按**表头关键词**匹配数字格式与列宽、A4 纵向 + 缩放 1 页宽。
- **内容零改动红线（落盘前强制断言）**：Word 逐段 + 逐表格单元格、Excel 逐表逐单元格（含**公式原文**）比对，
  **任何差异 → 拒绝产出、exit 3、原文件不动**（实现为先写临时文件，断言通过才原子就位）。
  依据：34 号隔离试跑实测 gongwen-skill 会吞正文空格（`3,242,802.00 元` 变 `3,242,802.00元`），该类事故必须在工具层堵死。
- **两层规格、零新增依赖**：规格用标准库 `json`（**不引入 pyyaml**）；内置 `specs/standard.json`，
  使用者自定义层 `~/.dsh/data/dsh-doc-suite/templates/<id>.json` 深度覆盖（同 DSH 原生设置的「默认 ← base ← 用户覆盖」）。
  `package.json` 的 `files` 白名单新增 `specs`。
- **新增回归 `scripts/style-test.mjs`**（8 用例；零依赖、CI 可跑，缺 Python 库时自动 SKIP）：
  规格契约 / 四属性字体 / 子命令注册 / 端到端内容不变 / 公式保留。
- **本机实测**：青海成峰对账说明（366 项内容差异 **0**）、羊曲简介（差异 0）、石嘴山选型表（**13 条公式全保留**）、合同发票对账表（5 张表差异 0）。

## 0.1.4 — 2026-09-13（发布前中立性修复）

- **删除 0.1.1 条目中提及、但当时漏删的遗留私有配置脚本**（位于 `scripts/` 下）：原文件名含私有助手标识，
  文件内注释写死作者机器绝对路径，并在环境变量覆盖表中定义了 6 个私有环境变量。经全模块复核，
  **模块内无任何代码 `import` 它**，属死代码；其 `__pycache__` 编译产物一并清除。
- **发布件不再含任何私有标识**：模块目录内已无私有文件名、作者机器绝对路径或私有环境变量前缀残留。
- **工具脚本、技能与运行时行为零变化**：本次只移除未被引用的死代码，全部子命令、技能文档与既有环境变量行为均不受影响。

## 0.1.3 — 2026-09-12（移除 fontTools 可选依赖）

- **移除 `fontTools`**：它唯一的用途是 python-pptx 的 `fit_text()`，而该方法按空白断词、**对中文不可用**（见 0.1.2）；`autofit` 已改用 Pillow。
  查实依据：模块内**无任何代码 `import`**；**无任何依赖声明它**（`pip show fontTools` → `Required-by:` 为空；`pypdf` 仅在 extras `[fonts]`/`[full]` 下需要，未启用）。
- **整文件删除 `requirements-optional.txt`**（已无可选补强项），并清理全部引用：`package.json` 的 `files` 白名单、`doctor.py`（检查项 + 「Python ≥3.10 依据」表述）、`NOTICE`（许可条目）、`README`（安装步骤 + 依赖许可列表）、`requirements.txt` 与 `cordis.patch.yml` 的注释。
- **Python 门槛不变**：`>=3.10` 的依据改由必需依赖 **PyMuPDF 1.28+** 与 **Pillow 12+** 支撑（两者 `requires-python` 均为 `>=3.10`）。
- 本次只删**声明与检测项**，不会卸载本机已装的 fontTools（留着无害）。doctor 自检结论仍为「环境就绪」。
## 0.1.2 — 2026-09-12（PPT 自动缩字号 `autofit`）

- **新增 `ppt_tool.py autofit`**：文本框自动缩字号（文字溢出时逐磅下探到放得下）。
  - **刻意不用 python-pptx 的 `fit_text()`**：2026-09-12 实测它内部按空白断词（`pptx/text/layout.py` 的 `_LineSource` 用 `str.split()`），
    中文长句没有空格 → 整句被当成一个"词" → 永远超宽 → 二分查找返回 `None` → 抛 `TypeError: cannot unpack non-iterable NoneType`，**对中文不可用**。
  - 改为 **Pillow 自研测量 + 按字符断行**（中英文都算得准）；`--font-file` 可直接指定字体文件（最可靠），
    省略时按 `--font` / 文本框已有字体名映射到系统字体（微软雅黑 msyh.ttc / 黑体 simhei.ttf / 宋体 simsun.ttc / 等线 Deng.ttf 等）。
  - 参数：`--out`（另存，原文件不动）/ `--slide 1,3-5` / `--max-size 40` / `--min-size 8`（**下限保护**：到下限仍放不下则按下限写入并**告警**，提示拆页或精简文字）/ `--dry-run`；默认**就地修改并先备份**（`.bak-autofit-<时间戳>`）。
  - 退出码：缺 Pillow / 找不到可用字体 → **5**；`--font-file` 不存在 → **2**（中文单行错误，无堆栈）。
  - 实测：32 pt → 13 pt（5 行）；极端溢出框触发下限保护告警；就地修改生成备份、原文件可回溯。
- `fontTools` 由"解锁自动缩字号"降级为**保留项**（当前无子命令使用）；`requirements-optional.txt`、`doctor.py`、README 局限表、`skills/office-ppt/SKILL.md` 同步更正。
# Changelog · dsh-doc-suite

本模块遵循语义化版本。变更分三类：**新增** / **修复** / **变更（可能影响下游）**。

## 0.1.1 — 2026-09-12（当日夜间；安装后完整测试的修复轮）

### 修复（错误处理层，源自安装后完整测试的缺陷清单）

- **输入异常不再抛裸 Traceback**：新增 `scripts/cli_guard.py`（统一输入守卫 + 异常友好化），
  四个工具脚本全部接入。输入文件不存在/是目录 → 中文单行错误 + **exit 2**；
  WPS COM 错误（如 `com_error … '文档打开失败。' 3010`）→ 转成中文说明 + 可能原因提示。
  设 `DOC_SUITE_DEBUG=1` 可恢复完整堆栈（排障用）。
  修复前实测：14 个读取类子命令中 **12 个**抛裸 Traceback。
- **`excel read --sheet <不存在的表>`**：改为友好报错，并**列出该工作簿可用工作表名**（原来抛 `KeyError`）。
- **`pdf tables` 找不到表格**：由 `exit 1`（与真实失败同码）改为 **exit 0**，提示改走 stderr
  ——"没找到表"不是错误。
- **`pdf info` 增加 PDF 文件头校验**：非 PDF 文件（如误传 `.txt`）会告警"未检测到 %PDF 文件头"，
  不再静默给出误导性的"页数/元数据"。

### 变更（可能影响下游）

- **`excel chart` 的 `--sheet` 由必填改为可选**（缺省用第一张工作表），与 `summary`/`read` 行为一致。
  原来单表文件也必须显式传 `--sheet`，实测踩坑。
- **`pdf ocr` 改为退役墓碑**：OCR 通道已于 2026-09-12 退役。子命令保留（避免旧脚本静默跑偏），
  但只打印退役说明并 **exit 0**，不再本地 OCR、不再调用任何云端视觉 API。
  同时删除指向模块内**并不存在**的 `scripts/vision/describe_image.py`、`scripts/vision/ocr_tool.py`
  的死代码，以及一个遗留私有配置脚本与 `subprocess`/`tempfile` 等相关残留依赖。
- **`doctor.py --emit-skill-paths`（新增）**：输出 JSON（`moduleDir` / `scriptsDir` / `skillsDir` /
  `tools` / `skills`），供技能文档解析路径占位符。

### 文档

- 四个技能 `skills/*/SKILL.md`：
  - 新增**子命令速查表**（逐子命令用法 + 参数形态备注）；
  - 脚本路径由**作者机器绝对路径**改为占位符 **`<DOC_SUITE_SCRIPTS>`**，并写明解析方式；
  - `pdf-tools` 技能内残留的"扫描件走云端 OCR"指引全部改写为"转图片交基座原生识图"。
- README：新增「子命令速查」指引与高频坑提示；`files` 白名单补 `LICENSE`、`CHANGELOG.md`；
  已知局限表更新（技能路径问题标记为已解决，新增"脚本两份副本须同步"与非原生格式行为差异两条）。
- 集成体 README / RELEASE-CHECKLIST：同步本模块**硬前置**（Python ≥ 3.10 + WPS Office，不自动安装）
  与新增的文档模块发布门禁（Python 语法自检、技能不得含作者机器路径、必须含子命令速查表）。

### 验证

- `verify_fixes.py` 37/37 通过（含 15 项输入缺失友好化、表名提示、`--sheet` 可选、OCR 墓碑、
  无表 exit 0、非 PDF 提示、`DOC_SUITE_DEBUG`、以及 happy-path 回归与 `doctor` 回归）。
- 同步后三份副本（模块源码 / 工作区 `<workspace>/scripts` / 安装副本 `node_modules`）**SHA256 逐一一致**。

## 0.1.0 — 2026-09-12

- 首个版本：Word 处理+比对 / Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取。
- 宿主半只注册 `/doc-doctor`；能力实现在 Python 脚本 + DSH 原生技能。
- 安装后完整测试 14/14 通过（含 Word 字符级红线修订、KET 重算与真透视表、PPT→PDF→PNG、PDF 告警体系）。
