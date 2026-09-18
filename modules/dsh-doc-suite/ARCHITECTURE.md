# dsh-doc-suite · 模块说明（维护者向）

本文件只描述**已在代码里实现**的行为，结论一律带出处。文内路径均**相对于本模块根目录**（`modules/dsh-doc-suite/`），行号对应当前检出状态（`package.json` 版本 **0.7.15**，`package.json:3`）。
未实现 / 预留的部分在文中显式标注；文档与代码不一致时以代码为准，并已单独指出。

---

## 1. 架构

### 1.1 一句话定位

`dsh-doc-suite` 是「工作秘书」集成体的**文档能力子模块**：宿主机（Node/Cordis）侧**只做一个入口**——环境自检命令 `/doc-doctor` 与一个媒体设置命名空间；真正的 Word / Excel / PPT / PDF 处理能力以 **Python 脚本 + DSH 原生技能**（`scripts/` + `skills/`）的形态交付，刻意**不在 Node 侧重复实现文档处理**。

- 出处：`lib/index.js:4-6`（"能力实现是 Python 脚本 + DSH 原生技能……刻意不在 Node 侧重复实现文档处理"）；
- 出处：`cordis.patch.yml:4-5`（"宿主半只负责'环境自检入口'与设置项，不做文档处理本身（避免在 Node 侧重复造轮子）"）；
- 替谁做什么：替使用者处理四类办公文件（只读提取 / 生成 / 就地改写 / 套样式 / 格式转换 / 比对 / 素材生成），并保证"套样式不改内容"。

### 1.2 目录与关键文件职责

| 位置 | 职责 | 出处 |
|---|---|---|
| `lib/index.js`（104 行） | 宿主半：注册唯一命令 `/doc-doctor`；可选启动自检；解析 Python 启动器并回退候选 | `lib/index.js:21-22`（`name`/`inject`）、`28-35`（`runDoctor`）、`54-89`（命令）、`92-97`（`doctorOnStartup`） |
| `lib/settings.js`（122 行） | 设置命名空间 `dsh-doc-suite`（11 个扁平 `media*` 键）、`DEFAULTS`、`SETTINGS_SCHEMA`、`installSettings`、`mediaSummary` | `lib/settings.js:22`、`25-37`、`40-63`、`88-109`、`112-122` |
| `cordis.patch.yml` | bundle patch：`insert` 挂载 entry `doc-suite`；config 为**中性部署默认层** | `cordis.patch.yml:10-24` |
| `package.json` | `dsh.bundle.patch` 指向 patch；`files` 白名单决定发布件内容 | `package.json:42-46`、`24-38` |
| `doctor.py`（325 行） | 环境自检唯一入口：解释器 / 依赖 / WPS COM / 媒体四项；`--emit-skill-paths` 解析技能占位符 | `doctor.py:3-24`、`85`、`112`、`141`、`170`、`224-235` |
| `scripts/office/word_tool.py`（651 行） | Word CLI：`read/info/create/edit/convert/compare/apply-style/table-style` | `scripts/office/word_tool.py:4-15` |
| `scripts/office/word_style.py`（771 行） | Word 套样式实现（页面 / 命名样式 / 字体四属性 / 表格样式） | `scripts/office/word_style.py:2-8` |
| `scripts/office/excel_tool.py`（583 行） | Excel CLI：`summary/read/write/convert/chart/merge/recalc/pivot/apply-style` | `scripts/office/excel_tool.py:3-14` |
| `scripts/office/excel_style.py`（173 行） | Excel 套样式实现 + 富部件（图表/图片）丢弃告警 | `scripts/office/excel_style.py:4-8`、`23-37` |
| `scripts/office/ppt_tool.py`（443 行） | PPT 轻量 CLI：`create/read/convert/images/autofit`（旧路，不套主题） | `scripts/office/ppt_tool.py:4-13` |
| `scripts/office/ppt_render.py`（1268 行） | B 线主路径：manifest → pptx（`render/validate/list-layouts`） | `scripts/office/ppt_render.py:12-16`、`36` |
| `scripts/office/ppt_style.py`（194 行） | 存量 pptx 套主题（apply-style + 内容零改动断言） | `scripts/office/ppt_style.py:5-13` |
| `scripts/office/ppt_theme.py`（352 行） | 主题库 `list/inspect/import`（从母版提取主题 → 自定义层 json） | `scripts/office/ppt_theme.py:5-21` |
| `scripts/office/ppt_contrast.py`（185 行） | 对比度门禁的**单一真值**（WCAG 2.1 AA） | `scripts/office/ppt_contrast.py:4-16` |
| `scripts/office/style_spec.py`（293 行） | **规格体系**加载（两层 + extends）与**内容零改动断言**、安全落盘 | `scripts/office/style_spec.py:2-11`、`57-99`、`242-293` |
| `scripts/office/doc_roles.py`（247 行） | 段落角色识别（标题层级）+ 表格列对齐判定 | `scripts/office/doc_roles.py:4-13` |
| `scripts/office/wps_com.py`（197 行） | WPS COM 桥（`KWPS/KET/KWPP` 三个 ProgID） | `scripts/office/wps_com.py:2-14`、`24-28` |
| `scripts/pdf/pdf_tool.py`（412 行） | PDF CLI：`info/text/tables/merge/split/images/make`（`ocr` 为退役墓碑） | `scripts/pdf/pdf_tool.py:3-23` |
| `scripts/cli_guard.py`（138 行） | 统一 CLI 守卫：输入校验 + 异常友好化，输入错 `exit 2` | `scripts/cli_guard.py:8-13`、`22` |
| `scripts/spec_sync.py`（727 行） | 规格校验 + 同步 profile 副本（SHA256）+ 渲染展示文档 | `scripts/spec_sync.py:5-19` |
| `scripts/media/gen_image.py`（316 行） | ARK 生图（云端，失败 `exit 4` 可回退矢量） | `scripts/media/gen_image.py:5-17` |
| `scripts/media/gen_diagram.py`（281 行） | mermaid 本地渲染（Node + 本机 Edge，**无云端**） | `scripts/media/gen_diagram.py:5-15` |
| `scripts/media/setup_mermaid.ps1` + `scripts/media/runtime/` | mermaid 运行时的随包 lock 与安装脚本（**不进 dependencies**） | `scripts/media/gen_diagram.py:6-8` |
| `skills/`（5 个技能） | `office-word` / `office-excel` / `office-ppt` / `pdf-tools` / `media-gen` | `skills/office-word/SKILL.md:2`、`skills/office-ppt/SKILL.md:2` 等 |
| `specs/` | 10 套样式规格 + 1 份 manifest 字段规范 | 见 1.3 |
| `assets/` | 素材清单；`icons/` 6 个自绘图标（MIT）+ **`templates/` 三套随包母版**（`dusk` / `azure` / `crimson`，各 1 母版 + 11 版式） | `assets/manifest.json` |
| `templates/` | **使用者自定义层说明**；随包母版已改放 `assets/templates/`（渲染主线仍不依赖母版） | `templates/README.md:1` |
| `scripts/tests/test_python.py` + 5 套 `.mjs` | 回归与门禁（见 1.5） | `scripts/tests/test_python.py:3-13` |
| `requirements.txt` | Python 依赖与两条硬前置说明 | `requirements.txt:1-19` |

**本模块没有 `client/` 目录**：设置页由 DSH 原生设置服务渲染，集成体「能力配置页」也直接读该命名空间（`lib/settings.js:9-13`）。

### 1.3 规格体系（standard / govdoc / compact / report / 主题）

规格是**纯 JSON、零新增依赖**，两层加载、支持 `extends` 继承：

- 格式与两层：只用标准库 `json`；**内置层 `specs/` < 使用者自定义层 `~/.dsh/data/dsh-doc-suite/templates/`**，同名键**深度覆盖**，与 DSH 原生设置"schema 默认 ← base ← 用户覆盖"同构 —— `scripts/office/style_spec.py:4-7`、`19-21`；
- 加载顺序：内置 → 自定义覆盖 → 若声明 `extends` 则递归继承基座（带循环检测）；`load_spec()` 也接受**规格文件路径** —— `scripts/office/style_spec.py:57-99`；
- 深度合并语义：dict 递归、其它类型整体替换 —— `scripts/office/style_spec.py:46-54`。
- **适用格式 `for`（2026-09-18 起）**：顶层 `for` 声明该规格可用于哪些格式（`word` / `excel` / `ppt`）；`load_spec(..., for_format=...)` 在**合并 extends 之后**校验 —— 声明了 `for` 且不含该格式 → `SpecError`（中文单行 +「本格式可用」清单）；**未声明 `for` 的规格放行**（兼容自定义层老文件，如公司母版导入件 `tdhx.json`）；`--spec <文件路径>` 形式同样受校验 —— `scripts/office/style_spec.py:21、93、112、133`。声明口径：`standard` = word·excel·ppt；`govdoc`·`compact`·`report` = word·excel；`graphite`·`teal`·`wine`·`dusk`·`azure`·`crimson` = ppt。入口已传格式：`word_tool.py`→word · `excel_tool.py`→excel · `ppt_style.py` 与 `ppt_render.load_theme()`→ppt；`ppt_theme.py list` 只列可用于 PPT 的（未标注 `for` 的照列并标注）—— `scripts/office/ppt_theme.py:163`。

各规格一览（以文件头字段为准）：

| 规格 id | 名称 | extends | 覆盖范围 | 出处 |
|---|---|---|---|---|
| `standard` | 标准商务 | —（完整规格） | `word` + `excel` + `pptx` 全量几何 | `specs/standard.json:1-15` |
| `govdoc` | 党政机关公文 | `standard` | 只写差异键（页边距/字号/层次序数字体/标题） | `specs/govdoc.json:1-18` |
| `compact` | 内部纪要 | `standard` | 只写差异键（紧页边距/1.15 行距/五号正文/灰蓝主色） | `specs/compact.json:1-21` |
| `report` | 汇报报告 | `standard` | 只写差异键（章节标题左对齐 / 表头底纹 `BDD7EE` / 边框加粗 `size 6` / 强调色 `A34A00`） | `specs/report.json:1-40` |
| `graphite` / `teal` / `wine` | 石墨工程 / 青蓝技术 / 酒红正式 | `standard` | **只覆盖色板与 PPT 色角色**，几何/字号/字体全部继承；文字色为固定 hex、不随主题漂移 | `specs/graphite.json:1-21`、`specs/teal.json:1-21`、`specs/wine.json:1-21` |
| `dusk` / `azure` / `crimson` | 暗色商务 / 蓝色简约 / 红色党政 | `standard` | **由 WPS 模板库 pptx 导入**（`theme4.xml` + `slideMaster4.xml`，各 11 个版式）：只搬色板 / 字体 / 页面尺寸，文字强调色按 WCAG AA 压暗 | `specs/dusk.json:1-52`、`specs/azure.json:1-53`、`specs/crimson.json:1-54` |

- **色值口径**：颜色只允许"6 位 hex"或"可用色角色（顶层 `colors` 键 / `pptx.color_roles` 键）"，这是"换主题不失效"的前提 —— `scripts/spec_sync.py:94-103`；
- **规格校验**：完整规格必须有 `schema`/`id`/`word`/`excel`，`word.styles.Normal` 必填；`pptx` 段可选，出现则按几何契约校验；`extends` 件按**合并基座后**的几何校验；`for` 若存在必须是非空数组且元素 ∈ `word`/`excel`/`ppt`（缺省不报错）—— `scripts/spec_sync.py:37、373、385`；
- **对比度门禁**：逐规格算"文字 vs 背景"的 WCAG AA 比值，不达标即 `exit 4`；装饰色（`accent_decor`/`rule`/`chart_series`）不检 —— `scripts/spec_sync.py:639-662`、`scripts/office/ppt_contrast.py:4-16`；
- **manifest 字段规范** `specs/ppt-manifest.schema.json` 属"字段规范"而非样式规格，不参与规格校验但随 `specs/` 同步 —— `scripts/spec_sync.py:60-62`。

### 1.4 内容零改动断言与退出码语义

**断言机制**（Word / Excel / PPT 三条线共用同一实现）：

1. 定义 `ContentChangedError`，类属性 `exit_code = 3` —— `scripts/office/style_spec.py:28-31`；
2. 快照：Word = 段落文本 + 表格单元格文本；Excel = 逐表逐格**值/公式字符串**（`data_only=False`，保证公式原文可见）；PPT = 逐页文本 + 表格单元格 + 图表系列/类别 + 备注 —— `scripts/office/style_spec.py:128-187`；
3. 比对：差异为 0 才通过，否则抛 `ContentChangedError` 并打印前若干条差异 —— `scripts/office/style_spec.py:190-250`；
4. 安全落盘：`commit_style()` 先写**带 pid 的临时文件** → 在临时文件上做断言 → 通过后才原子就位（`os.replace`）；断言失败时**原文件绝对不动**，临时文件在 `finally` 清理 —— `scripts/office/style_spec.py:264-293`；
5. 调用点：Word `scripts/office/word_style.py:383`+`456`（版式）、`636`+`707`（表格）；Excel `scripts/office/excel_style.py:172`；PPT `scripts/office/ppt_style.py:139-140`。

**退出码语义**（跨脚本统一，维护者按此判断"是工具坏了还是安全拦截成功"）：

| 码 | 含义 | 出处 |
|---|---|---|
| 0 | 成功（`pdf tables` 找不到表**也是 0**） | `README.md:144-146`、`scripts/pdf/pdf_tool.py:21` |
| 1 | `doctor.py` 专有：环境**未就绪** | `README.md:144` |
| 2 | 输入文件缺失 / 参数校验不过 / 规格错（`cli_guard` 统一） | `scripts/cli_guard.py:22`、`25-26`、`scripts/office/ppt_render.py:36` |
| 3 | **内容零改动断言失败**：已拒绝产出、原文件未动 | `scripts/office/style_spec.py:31`、`scripts/office/word_tool.py:551-554`、`scripts/office/excel_tool.py:496-499`、`scripts/office/ppt_style.py:164-168`、`scripts/spec_sync.py:18`（规格同步不一致）、`scripts/office/ppt_contrast.py:16`（对比度不达标） |
| 4 | 媒体链路云端不可用 / 运行时缺失（**可回退**）；`pivot` 源区为空亦用 4 | `scripts/media/gen_image.py:17`、`scripts/media/gen_diagram.py:15`、`scripts/spec_sync.py:18`（对比度门禁）、`scripts/office/excel_tool.py:16-17` |
| 5 | 缺字体或 Pillow（PPT 渲染） | `scripts/office/ppt_render.py:36`、`95` |

> 排障开关：`DOC_SUITE_DEBUG=1` 保留完整堆栈；默认只给中文单行错误 + 一行提示 —— `scripts/cli_guard.py:10-11`、`21`。

### 1.5 回归与门禁（5 套 `.mjs` + 1 份 Python 单测）

| 脚本 | 覆盖面 | 出处 |
|---|---|---|
| `scripts/style-test.mjs`（589 行） | A 线样式：规格契约 + 实现关键点 + Python 侧加载 + 端到端套样式；含**行高系数门禁**（三处口径必须一致） | `scripts/style-test.mjs:1-2`、`24-26` |
| `scripts/media-test.mjs`（303 行） | 媒体链路：生图 / 图示 / 设置；**任何输出不得出现密钥明文** | `scripts/media-test.mjs:1-3` |
| `scripts/ppt-render-test.mjs`（386 行） | manifest 契约 + 实现与规格一致 + 校验/容错退出码 + 渲染产物 | `scripts/ppt-render-test.mjs:1-4` |
| `scripts/ppt-style-test.mjs`（246 行） | PPT 存量美化：字体统一 / 文本零改动 / 备份 / dry-run / `--out` / 白名单 / **`exit 3` 语义** | `scripts/ppt-style-test.mjs:1-3` |
| `scripts/ppt-theme-test.mjs`（140 行） | 主题库 `list/inspect/import` 与字体解析（用自造 pptx 当母版样本） | `scripts/ppt-theme-test.mjs:1-2` |
| `scripts/tests/test_python.py`（110 行） | 零第三方依赖的纯逻辑单测：对比度 / 主题压暗 / 深度合并 / 规格校验 | `scripts/tests/test_python.py:3-13` |

共性约定：全部**零依赖、可 CI 跑**，缺 Python 库或运行时自动 SKIP；夹具一律 `mkdtemp` 一次性临时目录并在退出时清理，不触碰使用者目录与 profile —— `scripts/style-test.mjs:12-15`、`scripts/ppt-render-test.mjs:4`、`scripts/ppt-theme-test.mjs:2`。

---

## 2. 数据流

### 2.1 入口 → 处理链路 → 落盘

**入口 A：DSH 命令 `/doc-doctor`（唯一的宿主侧业务入口）**

```
/doc-doctor [--fix]
  → lib/index.js:57-88  handler
  → runDoctor(launcher, args)（execFile 调 python，超时 60s，maxBuffer 4MB）  lib/index.js:28-35
  → 启动器回退链：config.pythonLauncher → 'py -3' → 'python3' → 'python'    lib/index.js:62-75
  → 输出：doctor.py 的 stdout + 一行媒体设置摘要（不含密钥明文）             lib/index.js:68、43-52
```

- 解释器存在但自检未通过（缺依赖 / 缺 WPS）时**立即回报**，不再试其它启动器 —— `lib/index.js:71-73`；
- 全部启动器都找不到时给出手工修复指引（winget / 官网）—— `lib/index.js:76-87`；
- **默认只报告不写盘**；只有 `--fix` 才执行 `pip install`（且不装解释器）—— `doctor.py:9-13`、`README.md:130-134`；
- 启动自检默认关闭，开启时只写日志 —— `lib/index.js:91-97`。

**入口 B：技能（随包 `skills/`）→ Python CLI**

模型按 `SKILL.md` 调用 `py -3 <DOC_SUITE_SCRIPTS>/.../*.py <子命令>`；技能文档里的脚本路径用 `<DOC_SUITE_SCRIPTS>` 占位符，权威取值来自 `doctor.py --emit-skill-paths`（输出 `moduleDir/scriptsDir/skillsDir/pythonLauncher/tools/skills` 的 JSON）—— `skills/office-word/SKILL.md:8-12`、`doctor.py:224-235`、`README.md:148-149`。

**入口 C：设置（命名空间 `dsh-doc-suite`）**

```
设置页 / 集成体能力配置页
  → ctx.settings.register('dsh-doc-suite', SETTINGS_SCHEMA, { base, applies: 'live' })   lib/settings.js:95
  → scope.get() → toConfig()（空串视为"未设置"）                                          lib/settings.js:75-80、96-97
  → scope.watch() 刷新 current                                                            lib/settings.js:97
  → 消费点：mediaSummary() 供 /doc-doctor 摘要                                            lib/settings.js:112-122
            gen_image.py 侧由参数/环境变量 ARK_API_KEY 读取（环境变量优先）                scripts/media/gen_image.py:6-7
```

设置服务不可用时降级为"组合配置 / 默认值"，插件启动不受影响 —— `lib/settings.js:99-102`。

**入口 D：集成体「能力配置页」**

集成体把五个子插件的设置集中渲染，其宿主侧写入校验**只接受长度 1 的顶层键**（不接受嵌套路径），因此本模块的媒体键自 0.7.7 起全部扁平化 —— `lib/settings.js:9-13`、`CHANGELOG.md:88-95`。

### 2.2 落盘位置（写哪些文件、写到哪）

| 产物 | 位置 / 命名 | 出处 |
|---|---|---|
| 套样式就地改的备份 | 与源文件同目录 `<原名>.bak-<tag>-YYYYmmdd-HHMMSS` | `scripts/office/style_spec.py:112-116` |
| 套样式中间产物 | 临时文件 `<stem>.tmp-style-<pid><后缀>`，成功即 `os.replace`，失败在 `finally` 清理 | `scripts/office/style_spec.py:270-293` |
| `--out` 指定输出 | 写到 `--out` 路径，**不生成备份** | `scripts/office/style_spec.py:119-123` |
| 用户自定义规格 / 母版 | `~/.dsh/data/dsh-doc-suite/templates/` | `scripts/office/style_spec.py:20`、`templates/README.md:9` |
| 用户素材 | `~/.dsh/data/dsh-doc-suite/assets` | `scripts/office/ppt_render.py:78` |
| mermaid 运行时 | `~/.dsh/data/dsh-doc-suite/tools/mermaid/`（不进 dependencies / files） | `scripts/media/gen_diagram.py:6-8` |
| 规格同步目标 | `~/.dsh/profiles/{desktop,web}/node_specs`（可用 `--profile-root` 指定） | `scripts/spec_sync.py:413-422`、`425-435` |
| 业务文档产物 | 由各 CLI 的位置参数 / `--out` 决定；本模块**不写**使用者业务目录（回归脚本用 `mkdtemp`） | `scripts/office/word_tool.py:11-15`、`scripts/style-test.mjs:12-14` |

> 说明：`spec_sync.py` 不含任何使用者私有路径，展示文档输出由 `--doc-out` 指定 —— `scripts/spec_sync.py:19`。

---

## 3. 对外接口

### 3.1 DSH 命令

| 名称 | 参数 | 说明 | 出处 |
|---|---|---|---|
| `doc-doctor` | 可选 `--fix`（作用于 `rawInput`） | 环境自检；输出末尾附媒体设置摘要 | `lib/index.js:54-57`、`61`、`68` |

### 3.2 DSH 工具（model tools）

**本版未注册任何工具**：`lib/index.js` 全文件只注册了一个 command，没有 `ctx.tools.register` 调用；`inject` 也只声明 `['commands', 'settings']` —— `lib/index.js:22`、`54`。四格式能力对模型而言只以**技能 + Python CLI** 暴露（见 3.4）。

### 3.3 设置命名空间与键

- 命名空间：`dsh-doc-suite` —— `lib/settings.js:22`；
- 注册方式：`ctx.settings.register(SETTINGS_NS, SETTINGS_SCHEMA, { base, applies: 'live' })`（设置改动**免重启生效**）—— `lib/settings.js:95`；
- 11 个**扁平顶层键**及其默认值 —— `lib/settings.js:25-37`、`40-63`：

| 键 | 默认 | 说明（schema description 摘要） |
|---|---|---|
| `mediaProvider` | `volcengine-ark` | 生图服务商 |
| `mediaImageEnabled` | `true` | 图形元素优先生图，关闭/失败回退矢量 |
| `mediaImageModel` | `doubao-seedream-5-0-pro-260628` | 方舟模型 ID |
| `mediaImageSize` | `1K` | 出图尺寸 |
| `mediaImageTimeoutMs` | `60000` | 单次请求超时 |
| `mediaImageRetries` | `2` | 失败重试次数（4xx 不重试） |
| `mediaImageFallbackToVector` | `true` | 失败自动回退矢量 |
| `mediaVideoEnabled` | `false` | 生视频开关 |
| `mediaVideoModel` | `''` | 生视频模型 ID |
| `mediaArkApiKey` | `''` | 敏感：默认空，不打印不落日志不入 git |
| `mediaArkEndpoint` | `https://ark.cn-beijing.volces.com/api/v3` | 方舟端点 |

另有 4 个 **bundle config 键**（`pythonLauncher` / `docsRoot` / `wpsRequired` / `doctorOnStartup`）—— `cordis.patch.yml:14-17`。注意它们**不在 `SETTINGS_SCHEMA` 里**：`normalizeBase()` 只保留 schema 认识的键 —— `lib/settings.js:66-72`。

### 3.4 Python CLI（脚本 → 子命令）

| 脚本 | 子命令 | 出处 |
|---|---|---|
| `scripts/office/word_tool.py` | `read` | `info` | `create` | `edit` | `convert` | `compare` | `apply-style` | `table-style` | `scripts/office/word_tool.py:4-15` |
| `scripts/office/excel_tool.py` | `summary` | `read` | `write` | `convert` | `chart` | `merge` | `recalc` | `pivot` | `apply-style` | `scripts/office/excel_tool.py:4-14` |
| `scripts/office/ppt_tool.py` | `create` | `read` | `convert` | `images` | `autofit` | `scripts/office/ppt_tool.py:4-10` |
| `scripts/office/ppt_render.py` | `render <manifest.json> <out.pptx>` | `validate` | `list-layouts` | `scripts/office/ppt_render.py:12-16` |
| `scripts/office/ppt_style.py` | `apply-style <file.pptx> [--spec] [--out] [--dry-run] [--text-color ROLE]` | `scripts/office/ppt_style.py:9-12` |
| `scripts/office/ppt_theme.py` | `list` | `inspect` | `import`（目标已存在需 `--force`） | `scripts/office/ppt_theme.py:5-21` |
| `scripts/office/ppt_contrast.py` | `check [--spec] [--all] [--json]` | `ratio <hex> <hex>` | `scripts/office/ppt_contrast.py:12-16` |
| `scripts/pdf/pdf_tool.py` | `info` | `text` | `tables` | `merge` | `split` | `images` | `make` | `ocr`（退役墓碑） | `scripts/pdf/pdf_tool.py:4-11` |
| `scripts/media/gen_image.py` | `image` | `check` | `scripts/media/gen_image.py:11-17` |
| `scripts/media/gen_diagram.py` | `render <in.mmd> <out.png\|svg>` | `check` | `scripts/media/gen_diagram.py:11-15` |
| `scripts/spec_sync.py` | `--check` | `--no-sync` | `--profile-root` | `--doc-out` | `--spec` | `scripts/spec_sync.py:665-672` |
| `doctor.py` | `--json` | `--fix` | `--skip-wps` | `--emit-skill-paths` | `doctor.py:215-222` |

**PPT 页型的真实进度（文档与代码不一致，以代码为准）**：代码里 `IMPLEMENTED_LAYOUTS` 已与 `ALL_LAYOUTS` 相同 —— **16 类全部已实现**（`cover/toc/section/bullets/cards/compare/data/chart/table/quote/closing/image/process/timeline/case/qa`），`cmd_list_layouts` 会打印"已实现 N / 共 M 类" —— `scripts/office/ppt_render.py:80-90`、`1200-1223`。但同文件头部注释与 `specs/ppt-manifest.schema.json` 的 `layout.description` 仍写着"②b 只实现 cover/bullets/cards"（`scripts/office/ppt_render.py:18-22`、`specs/ppt-manifest.schema.json:65`），属**未同步的旧文案**；未知/未实现 layout 仍统一退化为 `bullets` 并告警（`scripts/office/ppt_render.py:90`、`285-293`）。

### 3.5 技能（随包 skill）

| 技能名 | 定位 | 出处 |
|---|---|---|
| `office-word` | Word/.docx/.doc/.wps 处理 | `skills/office-word/SKILL.md:2` |
| `office-excel` | Excel/.xlsx/.xls/.et 处理 | `skills/office-excel/SKILL.md:2` |
| `office-ppt` | PPT/.pptx/.ppt/.dps 处理（两条主线 + 一条旧路） | `skills/office-ppt/SKILL.md:2`、`12-21` |
| `pdf-tools` | PDF 读取与结构操作（扫描件 OCR 已于 2026-09-12 退役） | `skills/pdf-tools/SKILL.md:2`、`8-11` |
| `media-gen` | ARK 生图 + mermaid 图示 | `skills/media-gen/SKILL.md:2` |

### 3.6 模块间导出的关键符号（JS）

- `lib/index.js`：`export const name = 'dsh-doc-suite'`、`export const inject = ['commands', 'settings']`、`export function apply(ctx, config)` —— `lib/index.js:21-22`、`37`；
- `lib/settings.js`：`SETTINGS_NS`、`DEFAULTS`、`SETTINGS_SCHEMA`、`installSettings(ctx, baseConfig)`、`mediaSummary(cfg)` —— `lib/settings.js:22`、`25`、`40`、`88`、`112`。

Python 侧"共享层"导出（供其它脚本 import）：

- `scripts/office/style_spec.py`：`SpecError`、`ContentChangedError`、`deep_merge`、`load_spec`、`describe_spec`、`backup_file`、`resolve_output`、`word_snapshot/excel_snapshot/pptx_snapshot`、`assert_content_unchanged`、`check_spec_supported`、`commit_style` —— `scripts/office/style_spec.py:24-31`、`46`、`88`、`102`、`112`、`119`、`128-187`、`242`、`253`、`264`；
- `scripts/office/doc_roles.py`：`classify_paragraph`、`detect_numbering_scheme`、`resolve_column_align`（被 word_style / excel_style 导入）—— `scripts/office/word_style.py:18`、`scripts/office/excel_style.py:20`；
- `scripts/spec_sync.py`：`deep_merge`、`validate`、`sync_specs`、`find_profile_specs`、`render_doc` —— `scripts/spec_sync.py:334`、`367`、`413`、`425`、`517`；
- `scripts/cli_guard.py`：`EXIT_INPUT = 2`、`check_inputs(args)`、`run(main_fn)` —— `scripts/cli_guard.py:22`、`58`、`122`。

---

## 4. 回退与恢复

### 4.1 版本回退

三条可用路径（以 CHANGELOG 与集成体运维纪律为准）：

1. **改回版本号**：CHANGELOG 每个版本都有「回退」小节，写法是"版本改回 `<上一版>`"，并注明需要同步回滚的文件。例：`CHANGELOG.md:82-84`（回退到 0.7.7）、`CHANGELOG.md:124-126`（回退到 0.7.6，**键路径回退需同步回滚 `settings.js` 与各文档**）；
2. **`git revert`**：多个版本的「回退」节并列给出该选项，例 `CHANGELOG.md:237`、`286`、`313`；
3. **重装（推荐配合 1 使用）**：`file:` 依赖有缓存，可靠顺序是 **升 `package.json` 补丁版本 → `dsh plugin --profile <p> install --force` → 仍不同步就删掉 profile 里 `node_modules/<模块>` 再 `dsh plugin add` → 逐文件 SHA256 比对**，最后**重启 DSH** —— 集成体根 `README.md:184-185`。

**生效面**（决定回退后要不要重启）：`scripts/**` 免重启；`lib/**`（含设置项 schema）与 `skills/**` **需重启 DSH** —— `README.md:164`。

### 4.2 数据备份与恢复

- **套样式备份**：不传 `--out` 时**先备份再就地改**，备份名 `<原名>.bak-<tag>-<时间戳>`（tag 为 `style` / `tstyle` 等）—— `scripts/office/style_spec.py:112-116`、`scripts/office/word_tool.py:549-560`；
  恢复方式 = 把该 `.bak-*` 文件复制回原文件名（备份是 `shutil.copy2` 全量副本）—— `scripts/office/style_spec.py:115`；
- **失败即不动**：断言失败时原文件未被替换，临时文件已清理，因此**无需恢复** —— `scripts/office/style_spec.py:264-293`；
- **规格层备份纪律**：内置层必须中性、私有口径放自定义层，回退时"删除自定义层文件即还原"—— `templates/README.md:12-14`、`CHANGELOG.md:237`（自定义层文件不在仓库内，删除即还原）。

### 4.3 不可逆操作与注意事项

| 项 | 说明 | 出处 |
|---|---|---|
| 就地改（不传 `--out`） | 会覆盖原文件（但有 `.bak-*` 备份）；要零风险请显式给 `--out` | `scripts/office/style_spec.py:119-123` |
| Excel 富部件丢失 | `openpyxl` 保存会丢弃图表 / 图片 / 绘图；模块**主动告警，不静默** | `scripts/office/excel_style.py:4-8`、`23-37` |
| `pivot` 源区为空 | 设计为 `exit 4` 并给替代做法，不静默产出空文件 | `scripts/office/excel_tool.py:16-17` |
| `compare` 的输入本身带修订 | python-docx 读出的正文不可信，**默认拒绝比对**，需 `--allow-tracked` | `scripts/office/word_tool.py:29-30` |
| 红线修订的覆盖边界 | 只覆盖**正文与表格**；页眉/页脚差异不被 WPS 记入 `Revisions`，工具会就此告警 | `scripts/office/word_tool.py:31-32`、`README.md:170` |
| WPS COM 依赖 | 比对 / 公式重算 / 透视 / 页码目录 / 导出依赖本机 WPS（ProgID `KWPS/KET/KWPP`）；模块**不自动安装解释器与 WPS** | `cordis.patch.yml:6-8`、`scripts/office/wps_com.py:13-14`、`README.md:122` |
| 生图属云端 | 调用前会显式告知（prompt 发送到该服务）；无密钥/失败自动回退本地矢量，全程不出网 | `scripts/media/gen_image.py:9`、`README.md:180` |
| `doctor.py --fix` | 会真的执行 `pip install`（改环境）；**默认只报告** | `doctor.py:11`、`218` |
| `spec_sync.py` 同步 | 会把 `specs/*.json` 覆盖写入 profile 副本并做 SHA256 校验；**`--check` 只读、不写任何文件** | `scripts/spec_sync.py:12-13`、`425-435`、`684-687` |
| `ppt_theme.py import` | 会写入自定义层主题 json；目标已存在时 `exit 3` 并要求 `--force` | `scripts/office/ppt_theme.py:21` |
| OCR 通道 | 已退役：`pdf_tool.py ocr` 只打印退役说明；扫描件请转图交基座原生识图 | `scripts/pdf/pdf_tool.py:11`、`23` |
| 运行时的引入 | mermaid 运行时**不进 dependencies / files**，需按需安装（`setup_mermaid.ps1`），失败 `exit 4` 可回退 SVG | `scripts/media/gen_diagram.py:6-8`、`README.md:136-138` |

### 4.4 已知未实现 / 预留（本版）

- `templates/`（模块内）**只含使用者自定义层说明**；三套**随包母版**已改放 `assets/templates/`（`dusk` / `azure` / `crimson`，各 1 母版 + 11 版式，登记在 `assets/manifest.json`），供 `ppt_tool.py create --template` 继承；渲染主线仍是代码几何，`specs/*.json` 的 `pptx` 段是唯一真值 —— `templates/README.md:1-14`、`assets/manifest.json`；
- 本模块**不注册 DSH 工具**，也不随包提供 `client/` 前端页面（见 3.2、1.2）；
- `specs/ppt-manifest.schema.json` 的 `layout` 描述未随实现更新（旧文案），以 `ppt_render.py` 的 `IMPLEMENTED_LAYOUTS` 为准 —— `specs/ppt-manifest.schema.json:65`、`scripts/office/ppt_render.py:84-86`。
