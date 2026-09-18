# dsh-doc-suite —— 文档能力模块（Word / Excel / PPT / PDF）

> `work-personal-secretary` 集成体的文档能力子模块。**能力的实现是 Python 脚本 + DSH 原生技能**；宿主半只提供"环境自检入口"，不在 Node 侧重复造轮子。

## 一、它提供什么（四格式，按使用方定义）

| 格式 | 范围 | 关键能力 |
|---|---|---|
| **Word** | 处理 + **比对** + **套样式** | 读取（全文/表格/样式，含"带修订文档拒绝裸读"保护）、生成、编辑、转 PDF；**比对**：文本 diff + HTML 对照 + **可用 Word/WPS 打开的"红线修订版"**（字符级）；**套样式**：对**已有** docx 一键套版式（`apply-style` / `table-style`，见「一之二」节） |
| **Excel** | 处理 + **套样式** | 读写、公式写入、**重算读值**（KET `CalculateFull`）、**数据透视**、条件格式、图表、合并、批量；**套样式**：对**已有** xlsx 一键套样式（`apply-style`，见「一之二」节） |
| **PPT** | **成套渲染 + 存量美化 + 制作** | `成套渲染`：manifest → pptx（**16 类页型**、主题规格驱动几何、原生图表/表格、演讲者备注、超容量自动缩字号）；`存量美化`：`apply-style` 对已有 pptx 统一字体 + **内容零改动断言**（exit 3 拒绝产出）；另有轻量大纲生成（`create`）、母版套用、导出 PDF / 逐页 PNG。详见 `skills/office-ppt/SKILL.md` |
| **PDF** | **只读精确提取**（附少量组装） | 文字、表格（**带 bbox**）、图片、书签/元数据；合并 / 拆分 / 页面转图 / 图片合成 PDF；**旋转页/合并单元格/扫描件主动告警**（不做版式编辑、不做本地 OCR；`ocr` 子命令已退役，只打印退役说明并 exit 0） |

> **子命令速查**：每个格式的完整子命令、参数形态（位置参数 vs 选项）与易错点，见 `skills/<对应技能>/SKILL.md` 的「子命令速查」表。
> **技能清单（5 个 DSH 原生技能）**：`office-word`（Word 处理 + 比对）、`office-excel`（Excel 处理）、`office-ppt`（PPT 成套渲染 + 存量美化 + 制作）、`pdf-tools`（PDF 只读提取 + 合并/拆分/图片合成）、`media-gen`（配图生图 + mermaid 图示）。
> 三个高频坑先记住：`convert <src> <dst>`（**没有** `--to`）、`ppt images <src> <outdir>`（**没有** `--out-dir`）、`merge/make` 的**输出参数在前**。

## 一之二、样式能力（A 线：给【已有文件】套样式）

> 三个子命令，**对已有文件生效**（不改内容、只改版式）—— 这是与其他"生成新文件"工具的核心区别。

| 命令 | 作用 |
|---|---|
| `word_tool.py apply-style <docx> [--spec standard|govdoc|compact|<路径>] [--out X] [--dry-run]` | 对已有 Word 套版式：页面 / 命名样式 / **段落角色识别** / 字体四属性 / 行距 / 缩进 |
| `word_tool.py table-style <docx> [同上]` | 表格：表头底纹+加粗+居中、边框、**跨页重复表头**、**宽度撑满版心 + 列宽自适应**、列对齐 |
| `excel_tool.py apply-style <xlsx> [--sheet S] [--out X] [--dry-run]` | 对已有 Excel 套样式：字体 / 表头底纹+冻结 / 边框 / 数字格式 / 列宽 / 打印设置 / 列对齐 |

**退出码（三命令一致）**：`0` 成功 ｜ `2` 输入或规格错误 ｜ **`3` = 内容发生变化 → 已拒绝产出、原文件未改动**

> `exit 3` 是**安全拦截**而非失败：落盘前逐段（Word）/ 逐单元格含公式原文（Excel）比对，**任何差异即拒绝写入**（先写临时文件，断言通过才原子就位）。缺省就地修改并生成 `.bak-style-<时间戳>` 备份。

### 默认规范（`standard`）速览

> **数值一律以 `specs/*.json` 为准**（下表只是摘要；完整展示用 `spec_sync.py` 生成，勿以本文为准）。内置**共 10 套**（全部随包）：Word/Excel 常用 **`standard`（标准商务）· `govdoc`（党政机关公文）· `compact`（内部纪要，密排小字）· `report`（汇报报告）**；PPT 主题另有 **`graphite`（石墨工程）/ `teal`（青蓝技术）/ `wine`（酒红正式）/ `dusk`（暗色商务）/ `azure`（蓝色简约）/ `crimson`（红色党政）**；后九者用 `extends` 只写差异键。

| 项 | 值 |
|---|---|
| 字体 | **全文统一「仿宋」** —— 英文 / 数字 / 汉字 / 正文 / 标题 / 表格**同一种**；`w:rFonts` 四属性（ascii/hAnsi/eastAsia/cs）**全设**；**不做优先级 / 回退链**；白名单（`allowed_fonts`）外字体**拒绝产出** |
| 页面 | A4 纵向；页边距 **上下 2.54 / 左右 3.17 cm**（2026-09-17 改通用默认：原投标口径属特殊场合、不预置） |
| 一级标题 | **小三 15pt** 加粗 居中 |
| 二级标题 | **四号 14pt** 加粗 左对齐 |
| 三级 / 四级标题 | **小四 12pt** 加粗 左对齐 |
| 正文 | **小四 12pt**、两端对齐、**首行缩进 2 字符**、行距 1.5 |
| 表格 | 撑满版心（`tblLayout=fixed`）· 表头底纹 `D9E2F3` + 加粗 + 居中 · 表内 10.5pt · 边框 single 4pt `#808080` · **跨页重复表头** · 列对齐＝表头居中 / 序号列居中 / **数值列右** / 文本列左 |
| 色板 | 主 `#1F4E79` · 辅 `#2E75B6` · 强调**文字** `#A34A00`（装饰 `#ED7D31`）· 语义 绿 `#4E7A2B` / 红 `#C00000` / 注意**文字** `#8A6A00`（装饰 `#BF9000`） |

### 公文风格（`govdoc`）

> 依 **GB/T 9704-2012《党政机关公文格式》** 要点（2026-09-17 新增）。数值查证来源：北京市老干部局《图解〈党政机关公文格式2012版〉国家标准及WORD制作方法》· 保山学院纪检监察网（公开转载口径；**出口径以国标原文与 `specs/govdoc.json` 为准**）。

| 项 | 值 |
|---|---|
| 页面 | A4 纵向；页边距 **上 3.7 / 下 3.5 / 左 2.8 / 右 2.6 cm**（版心 156×225 mm） |
| 正文 | **三号 16pt 仿宋**、两端对齐、首行缩进 2 字符、行距 1.75（≈28pt，每页 22 行） |
| 层次序数 | 一、**黑体** · （一）**楷体** · 1. /（1）**仿宋**（识别沿用 standard 的编号体系） |
| 公文标题 | **二号 22pt 居中**（规范为方正小标宋简体；本机未装该字体，用 宋体 加粗 等价替代 —— 装有小标宋者把 `specs/govdoc.json` 的 `doc_title.ea` 改回即可） |
| 白名单 | 仿宋 / 黑体 / 楷体 / 宋体 / Times New Roman（白名单外字体拒绝产出） |

```powershell
py -3 scripts/office/word_tool.py apply-style 来文.docx --spec govdoc --out 成文.docx
```

> **已知局限**：本风格只做**版式**（页面 / 字体 / 字号 / 层次样式），不生成公文**版头要素**（发文机关标志、发文字号、印章、成文日期位置）与页脚页码；套用后请目检字体是否生效。

**两层规格**：内置 `specs/*.json` **10 套**（`standard` 标准商务 / `govdoc` 党政机关公文 / `compact` 内部纪要 / `report` 汇报报告 / `graphite` 石墨工程 / `teal` 青蓝技术 / `wine` 酒红正式 / `dusk` 暗色商务 / `azure` 蓝色简约 / `crimson` 红色党政）← **使用者自定义层** `~/.dsh/data/dsh-doc-suite/templates/<id>.json`（同名键深度覆盖；单位 / 个人口径放这一层，**不进发布件**）。派生风格可用 `extends` 只写差异键。

### 改规格的标准流程（`spec_sync.py`）

```powershell
# 1) 改 specs/standard.json（或 compact.json / 自定义层）
# 2) 一条命令：校验 + 同步 profile 运行副本（SHA256）+ 生成规格展示 Markdown
py -3 scripts/spec_sync.py --doc-out <规格展示.md>

# 其他用法
py -3 scripts/spec_sync.py --check            # 只校验、不写盘（CI 用）
py -3 scripts/spec_sync.py --no-sync          # 不同步 profile
py -3 scripts/spec_sync.py --spec standard    # 只处理指定风格
```

> `spec_sync.py` 退出码：**0** 成功 / **2** 规格或输入错误 / **3** 同步后发现哈希不一致。它**零新增依赖**，且**不含任何使用者私有路径**（展示文档输出由 `--doc-out` 指定，缺省打印到标准输出）。

## 一之三、B 线 PPT 与媒体能力（2026-09-16）

> 与 A 线（Word/Excel 套样式）同构：**几何 / 字号 / 色值全部来自 `specs/standard.json` 的 `pptx` 段** —— 改版式改规格，不改脚本。

| 路径 | 命令 | 说明 |
|---|---|---|
| **成套渲染**（新建） | `office/ppt_render.py render <manifest.json> <out.pptx>` | 16 类页型：cover / toc / section / bullets / cards / compare / data / chart / table / quote / image / process / timeline / case / qa / closing；未知 layout 退化 bullets 并告警；缺必填 exit 2 指名页号；超 max_slides 保留首页+中段+末页；notes 写演讲者备注 |
| **干跑校验** | `office/ppt_render.py validate <manifest.json>` · `list-layouts` | 契约 + 主题几何 + 容量预演；列页型与组件 |
| **存量美化** | `office/ppt_style.py apply-style <file.pptx> [--out X] [--dry-run] [--text-color ROLE]` | 逐 run 统一字体（a:latin / a:ea / a:cs，含表格与备注）；**不改字号与位置** |
| **配图生图** | `media/gen_image.py image --prompt ... --out ...` | 火山引擎 **ARK**（Seedream 5.0 Pro）；**云端服务**（调用前显式告知）；失败/无密钥 → **exit 4 可回退** |
| **主题库 / 母版导入** | `office/ppt_theme.py list` · `inspect <母版.pptx>` · `import <母版.pptx> --id <id>` | **10 套**内置主题 + 自定义层；**从公司母版导入**（只搬色板 / 字体 / 页面尺寸，**不搬内容**；文字色自动压暗至 WCAG AA；字体并入白名单）。渲染用 `--theme <id>` |
| **图示渲染** | `media/gen_diagram.py render <in.mmd> <out.png|svg>` | mermaid **本机**渲染（Node + Edge）；运行时不在包内，用 `media/setup_mermaid.ps1` 安装/迁移 |

**退出码**：`0` 成功 ｜ `2` 输入/参数/规格错 ｜ **`3` = 内容零改动断言失败（已拒绝产出、原文件未动）** ｜ `4` = 媒体链路云端不可用或运行时缺失（**可回退**） ｜ `5` 缺字体/Pillow。

**manifest 契约**：`specs/ppt-manifest.schema.json`（JSON Schema；validate 由它驱动）；**字段速查与示例见 `skills/office-ppt/SKILL.md`**。

### 媒体设置（键路径；设置 → 插件 → dsh-doc-suite）

| 键 | 默认 | 说明 |
|---|---|---|
| `mediaProvider` | `volcengine-ark` | 生图平台（默认火山引擎） |
| `mediaImageEnabled` | `true` | 图形元素优先生图（失败自动回退代码矢量） |
| `mediaImageModel` | `doubao-seedream-5-0-pro-260628` | 方舟模型 ID（以控制台开通为准） |
| `mediaImageSize` / `mediaImageTimeoutMs` / `mediaImageRetries` | `1K` / `60000` / `2` | 尺寸 / 超时（毫秒）/ 重试 |
| `mediaImageFallbackToVector` | `true` | 失败即回退矢量（不需人工介入） |
| `mediaVideoEnabled` / `mediaVideoModel` | `false` / 空 | 生视频（默认关；模型 ID 按控制台填） |
| `mediaArkApiKey` | **空** | ARK 密钥（敏感：默认空、不落日志；**发布件永不含**） |
| `mediaArkEndpoint` | `https://ark.cn-beijing.volces.com/api/v3` | 方舟端点 |

> **默认值三处一致**：`lib/settings.js` 的 schema 与 DEFAULTS、`cordis.patch.yml` 的注释、本表（回归用例会比对 schema ↔ DEFAULTS）。

## 二、硬前置（安装前必须满足）

| 前置 | 要求 | 为什么 |
|---|---|---|
| **Python** | **>= 3.10**（建议 3.12） | 由 **PyMuPDF 1.28+** 与 **Pillow 12+** 的 `requires_python: >=3.10` 决定（其余依赖只要求 >=3.8/3.9） |
| **WPS Office** | 已安装且 COM 可实例化 | **比对 / 公式重算 / 透视 / 页码目录**全部依赖 WPS COM；`doctor.py` 会自动探测可用 ProgID（本机实测为 `KWPS.Application`） |
| Windows 调用约定 | 一律 `py -3`，**不要用 `python`** | `python` 可能是 Microsoft Store 别名 stub（报 "Python was not found"，exit 9009） |

> **本模块不会自动安装 Python 解释器或 WPS Office**：装解释器属系统级操作（需管理员、可能受企业网络策略限制），WPS 是商业软件。二者都由 `doctor.py` 检测并在缺失时**给出可复制的修复命令**，由使用者确认后执行。

## 三、安装与自检

```powershell
# 1) 装依赖（必需）
py -3 -m pip install -r requirements.txt

# 2) 自检（唯一入口；缺什么它告诉你补什么）
py -3 doctor.py            # 人类可读报告
py -3 doctor.py --json     # 供插件 /doc-doctor 解析
py -3 doctor.py --fix      # 显式确认后才执行 pip 安装（不装解释器）
py -3 doctor.py --skip-wps # 跳过 WPS COM 检查（非 Windows 或已知没装 WPS 时）

# 3b) 可选：媒体链路运行时（mermaid 图示用；不进依赖/发布件，按需安装）
#     powershell -ExecutionPolicy Bypass -File scripts\media\setup_mermaid.ps1            # 体检
#     powershell -ExecutionPolicy Bypass -File scripts\media\setup_mermaid.ps1 -Install   # 安装（不下载 Chromium）

# 4) 解析技能文档里的路径占位符（对外分发不写死绝对路径）
py -3 doctor.py --emit-skill-paths   # 输出 JSON：scriptsDir / tools / skills
```

> **退出码约定**：`doctor.py` **0 = 环境就绪 / 1 = 未就绪**（`--emit-skill-paths` 恒为 0）；
> `scripts/` 下的四个工具脚本在输入缺失或未预期异常时统一为 **exit 2**（中文单行错误写 stderr），
> 设 `DOC_SUITE_DEBUG=1` 可恢复完整堆栈；`pdf tables` 找不到表格不是错误（**exit 0**）。

> **技能文档的路径约定**：`skills/*/SKILL.md` 里的命令使用 `<DOC_SUITE_SCRIPTS>` 占位符
> （= 本模块 `scripts/` 目录），解析方式就是上面的 `--emit-skill-paths`。

内网/离线环境：用 `py -3 -m pip download -r requirements.txt --platform win_amd64 --python-version 312 -d vendor/wheels` 预先取包，再用 `--no-index --find-links vendor/wheels` 安装（本机 `pip cache` 为空，不能依赖缓存）。

## 四、插件侧

```powershell
# 装进 profile（与集成体其他子模块一致）
# ① clone 仓库后按本地路径安装（本机已验证）
dsh plugin --profile desktop add file:<仓库目录>/modules/dsh-doc-suite
```

- 宿主半只注册一个命令：**`/doc-doctor`** —— 执行环境自检并回报结论与修复命令。
- 配置项（中性默认层，可在设置页用户层覆盖）：`pythonLauncher`（默认 `py -3`）、`docsRoot`、`wpsRequired`、`doctorOnStartup`；**媒体设置**命名空间 `dsh-doc-suite` 的 `media*（扁平顶层键）`（见「一之三」节表）。
- `/doc-doctor` 输出末尾附一行**媒体设置摘要**（不含密钥明文）；`doctor.py` 的 [4] 段报告生图配置来源与 mermaid 运行时状态。
- **改了 `lib/**`（含设置项 schema）需重启 DSH**；`scripts/**.py` 免重启；`skills/**` 需重启（启动时扫描技能）。

## 五、已知局限（重要，别踩）

| # | 局限 | 说明 |
|---|---|---|
| 1 | **页眉差异不参与红线修订** | WPS `CompareDocuments` 的 `Revisions` 只覆盖正文/表格，且 `RejectAll` 回退不了页眉。工具已就页眉差异主动告警；正式断言口径 = **正文 + 表格** |
| 2 | **修订作者名** | `app.UserName` 改不动 `CompareDocuments` 的作者（且赋值会污染 WPS 全局配置）→ 已改为**在产物 OOXML 层改写** `w:ins/w:del` 的 `w:author`，默认取系统用户名，`--author` 可覆盖 |
| 3 | **WPS COM 不认相对路径** | `SaveAs` 传相对路径会报 3011；模块内已用 `os.path.abspath()` / `Path.resolve()` 绝对化处理，**其他脚本调用 WPS 时注意同一坑** |
| 4 | PDF 硬边界 | 合并单元格表格与旋转页表格**必然失真且不报错** → 已改为**主动告警**；图片提取到的是内嵌版（非原件）；加密 PDF 需口令且 `pypdf` 提中文乱码（PyMuPDF 正常） |
| 5 | PPT 排版 | **无动画 API、页码无 API**，整体排版靠模板预制；**缩字号已提供 `autofit` 子命令**（Pillow 自研测量，中文友好）。**不用** python-pptx 的 `fit_text()`：它按空格断词，对中文不可用（实测抛 `TypeError: cannot unpack non-iterable NoneType`） |
| 6 | Excel | `recalc` 对 `.xls` 旧格式未实测；`pivot` 不做小计行识别（源区域含"合计"行会被当行项目） |
| 7 | ~~技能里的脚本路径~~ **已解决（2026-09-12）** | `skills/*/SKILL.md` 已改用占位符 `<DOC_SUITE_SCRIPTS>`，不再含作者机器绝对路径；解析方式 = `py -3 doctor.py --emit-skill-paths` |
| 8 | ~~脚本存在两份副本~~ **已解决（2026-09-15）** | 工作区遗留的 doc-suite 脚本副本（`office/`、`pdf/`、`cli_guard.py`）**已删除**；**唯一源 = 模块内 `scripts/`**（工作区只保留技能文档副本，与模块 `skills/` 同步）。路径解析一律以 `py -3 doctor.py --emit-skill-paths` 为准 |
| 10 | **PPT 几何容量口径** | 行高按 WPS 实测（**字号 ÷ 72 × 1.228 × 行距**）反算，`max_lines` 等容量值据此定；`spec_sync.py`、渲染器、`style-test.mjs` 三处口径由**门禁用例**守住（改其一必改另两处） |
| 11 | **进度环降级** | `ring` 组件经三次小样（BLOCK_ARC 角度 adjustment）**未标定出可控弧度** → 按预案**降级为数据条**：进度类数据用 **chart 页**表达 |
| 12 | **生图需密钥且属云端** | 默认密钥为空 → 生图不可用并**自动回退代码矢量**（全程不出网）；显式配密钥后 prompt 会发送到火山引擎 ARK，**须先告知使用者且不得含客户信息/报价/涉密内容** |
| 13 | **Edge 大版本升级可能让图示暂时失效** | mermaid-cli 经 puppeteer 驱动本机 Edge，puppeteer 与浏览器主版本有对应关系（本机当前 puppeteer 25.11 ↔ Edge 153）。`gen_diagram.py check` 与 `doctor.py` 的 [4] 段会比对「Edge 主版本 vs puppeteer 期望 Chrome 主版本」并给结论；不一致时按 `skills/media-gen/SKILL.md`「Edge 大版本升级后」处置（退 SVG / 指定浏览器 / 装匹配 Chrome for Testing）。**失败形态是 exit 4 + 可回退，不连累其它能力** |
| 9 | 非原生格式"尽力而为" | `word read` / `excel read` 对非 docx/xlsx 文件会回落 WPS COM 读取（读到内容即成功），`ppt read` 则会失败（python-pptx 抛 `PackageNotFoundError`，经 `cli_guard` 转为中文单行错误 + exit 2）；三种行为不完全一致，属有意保留（WPS 能读 .txt/.csv 这类纯文本） |

## 六、许可与归属

- 本模块代码：MIT（见 `LICENSE` 与 `NOTICE`）。
- 依赖库许可：python-docx(MIT) / openpyxl(MIT) / python-pptx(MIT) / PyMuPDF(**AGPL-3.0 或商业许可**，注意分发口径) / pdfplumber(MIT) / pypdf(BSD-3) / Pillow(**HPND**，MIT-CMU 系) / pywin32(PSF) —— **随包分发时需复核 PyMuPDF 的 AGPL 口径**（本模块只"依赖"而不"内置"其代码，通常按依赖声明处理，但对外发布前请确认）。
- **WPS Office 不随包**，需使用者自行安装并遵守其许可。
