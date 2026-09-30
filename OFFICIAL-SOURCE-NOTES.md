# 官方源码读码笔记（OFFICIAL-SOURCE-NOTES）

> **读码日期**：2026-09-25
> **官方基线**：`deepseek-ai/deepseek-harness` @ `master`（最后 push 2026-09-24T14:10:21Z），版本 `dsh 0.1.7-rc.2`
> **材料来源**：两路子代理读码（官方源码侧／我方 6 模块侧）+ 主对话独立核实
> **配套文档**：`OFFICIAL-DESKTOP-ADAPTATION.md`（适配核对与改造清单）
> **⚡ 续接入口（2026-09-29）**：**`HANDOFF-0.2.0-RECHECK.md`** —— 0.2.0 新增破坏性变更、逐插件复核进度、官方 Desktop 实操踩坑全记录、未决事项与下一步；**新会话请先读它**
> **口径**：【事实】有原文/代码；【推断】由事实推出但未直证；【未确认】必须真机实测

## 0. 源码获取状态

| 方式 | 结果 |
|---|---|
| `git clone --depth 1 --branch dsh-v0.1.7-rc.2` | **失败**（网络慢，浅克隆长时间停在 0 字节，已终止） |
| 官方 tag 源码包 | `https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/tags/dsh-v0.1.7-rc.2`，**实测 HTTP 200** |
| 落盘位置 | `E:\lina\参考\deepseek-harness`（源码包 **30.88 MB**） |
| **最终结果（2026-09-25）** | **13,837 文件 / 114.4 MB**，`package.json` version = `0.1.7-rc.2`；`packages` 54 个包、`apps`（desktop/cli/web）、`docs/subsystems` 等关键路径齐全 ✅ |
| 解压告警（已核实·无影响） | tar 报 13 个条目 `Invalid argument` —— **均为官方仓库的符号链接**（`mode=120000`，如根 `CLAUDE.md`、`vendor/CLAUDE.md`、`snapshots/.../AGENTS.md`）；Windows 创建 symlink 需管理员或开发者模式。**真实文件内容完整**。改用英文路径重解压结果完全相同 ⇒ 与中文路径无关。 |

> 说明：`gh api` 报的仓库 `size` 234,260 KB ≈ 228.8 MB **含 git 历史**；源码包（工作树）仅 30.88 MB。
> 本文的官方结论来自 `gh api` **直连取文**（默认分支），**不是**本地文件行号；官方每次发版都需要重跑核对。

## 1. 官方插件机制（读码事实）

### 1.1 安装通道

【事实】安装入口为 `dsh plugin --profile <name> add <包名 | git spec | file:../本地检出>`，转发给 pnpm，在 profile 内以 hoisted 布局安装（`.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.zh.md:130`）。
【事实】支持的 spec 形态：registry / git / 本地路径 / tarball。
【事实】管理器在安装前做三件事：
1. `inspect(spec)` 读出 spec 指向什么（注册表包名走 `pnpm view`；绝对路径读其 `package.json`；git/tarball 只答复形式与 host）；
2. registry 按 `registry` + `fallbackRegistries`（默认 `https://registry.npmmirror.com/`）顺序询问，**私有源永不落到公共源**；
3. 对 GitHub 仓库做 `git ls-remote` 预检（`githubConnectionTimeoutMs` 默认 5000 ms）。

### 1.2 版本兼容门禁（接入的硬门槛）

【事实】安装点名时会在 pnpm 运行前检查该版本声明的 peer；**不兼容 DSH peer 直接失败，不下载、不跑构建脚本**（`plugin-manager/README.zh.md:63`）。豁免记在 profile 的 `compatibility.json`，键为精确 `package-name@version`，**插件升级与 DSH 升级都不继承**。
【事实】运行时：profile 导入插件前检查其 `peerDependencies` 中 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的声明与 `getDshRuntimeVersion()` 比对，每个范围都必须匹配，**预发布参与匹配**；**未声明 DSH peer 时不施加版本约束**；无效范围视为不兼容（`packages/boot/app-boot/README.zh.md:52`）。
【事实】实现细节（`packages/boot/app-boot/src/plugin-compatibility.ts`）：只检 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`；`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` **不受检**；判据是 `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`。
【事实】不兼容后果：普通行降级为 `disabled: true` 的游离行；**bundle 被列入 `skippedBundles` 并跳过**（`app-boot/README.zh.md:54`）。
【实测·本机真 semver】`semver.satisfies('0.1.7-rc.2','^0.1.5-rc.1',{includePrerelease:true}) === true`（`^0.1.0`／`~0.1.5-rc.1`／`^0.1.5` 亦 true；`0.2.0` → false）。
 ⇒ **我方 6 个模块当前不会被门禁拒绝**；风险在官方进入 `0.2.x` 时 `^0.1.5-rc.1` 全部失效。

### 1.3 Desktop 启动行为 —— **对既有文档的关键修正**

【事实·修正】**官方已删除"profile 核心包清理"机制**。依据：`apps/desktop/src` 实际文件清单**没有** `profile-core-cleanup.ts`、**没有** `profile-packages.ts`（实测目录列表）；且官方 note `2026-09-19-remove-desktop-profile-core-cleanup.zh.md:15` 原文写明删除这两个文件及其 spec。
【事实】新版 README 口径已改为：`启动 Host 前，Desktop 校验运行时描述符并准备 profile，**不改动已安装的包、依赖声明与锁文件**；只删除早期 Link 后端启动写下的 `.dsh-module-fallback` 投影，**启动从不运行 pnpm**`（`apps/desktop/README.zh.md:100`）；"首次启动不会把核心包复制到 profile 存储或通过 pnpm 安装核心包"（`:97`）。
【事实】该 note 同时说明：`官方包只把纯函数包放在 dependencies，带模块级身份的包一律声明为 peer`；第三方插件把身份敏感的 dsh 包写成实依赖，是该插件自身的打包选择（`:17`）。放弃的能力：**旧版 Desktop 装进 profile 的核心包副本与声明需手工删除一次**（`:19`）。
 ⇒ **本仓库 `OFFICIAL-DESKTOP-ADAPTATION.md` §2 第 3 条与 §5.1 P0-1 的依据（"启动前清理 profile 副本与回退链接、删除依赖声明"）已过时，必须更正**（见 §5）。

### 1.4 清单与客户端字段规范

【事实】`DshManifest = { manifestVersion?, bundle?, profile?, client? }`；`bundle.patch: string | string[]`；`profile.bundles?: string[]`（用已安装包名）（`packages/util/package-manifest/src/types.ts:30-78`）。
【事实·重要澄清】`client.inject?: string[]` 的**原文注释**是：
 `"Informational package-name dependencies, not Cordis service injection"`
 ⇒ 它是**信息性的包名依赖声明，不是 Cordis 服务注入**。我方把它当作"服务依赖声明"理解，需要修正认知。
【事实】`client.external?: string[]` 的语义是"超出隐式 client baseline 的精确模块表请求，含 `<pkg>/client` 子路径；缺省＝只有 baseline externals"（`:88-93`）。
【事实】插件展示元信息来自 `locale/en.json` 的 `meta.title` / `meta.description` + 清单顶层 `icon`，需在 package.json 导出 `./locale/*.json` 并把 `locale/*.json` 加进 `files`（`docs/cookbook/adding-a-package.zh.md:114-154`）。
【事实】官方 workspace 包约定：`@deepseek-ai/cordis` 同时在 `peerDependencies` 与 `devDependencies`（相同范围）；**每个 dsh peer 都要在 devDependencies 镜像**；**`@deepseek-ai/schemastery` 放 `dependencies`**（它是运行时校验器）（`cookbook:27`、`lookup-order:138`）。
【事实】宿主服务名实测存在且形状一致：`ctx.systemPrompt.section()/context()`、`ctx.tools.register()`、`ctx.commands.register()`、`ctx.webServer`、`ctx.settings`。

## 2. 官方文档处理能力（读码事实）

【事实】`packages/skill/skill-office` 注册 `office-docx` / `office-pptx` / `office-xlsx`，做创建、局部编辑、**结构检查**、交付；渲染/转换/重算依赖 **LibreOffice Kit CLI**；**不支持传统格式（.doc/.xls/.wps）、加密与宏格式**（`skill-office/README.zh.md:96`）。
【事实】`packages/document/office-to-pdf` 支持 `DOC/DOCX/XLS/XLSX/PPT/PPTX` 转 PDF，走 `@deepseek-ai/libreoffice-kit`；**不查系统 LibreOffice、不在运行时下载引擎**。
【事实】`packages/skill/tool-workspace-dependencies` 提供 `load_workspace_dependencies`，返回随包 Python/Node/pnpm 的**绝对路径**，**不改 PATH**；Desktop 内置 Python 含 numpy/pandas/python-docx/python-pptx/openpyxl/Pillow/lxml/XlsxWriter，**不含任何 PDF 库**（`apps/desktop/README.zh.md:53`）。
【事实】`office-docx/SKILL.md` 明令：*"Do not install packages or discover a system Python for the default workflow."*
【事实】`office-docx/SKILL.md:30` 明令：*"Do not represent ordinary replacement, colored text, or comments as tracked changes."* ⇒ 官方**不做**修订/红线比对。
【推断·官方无的项（含检索依据）】修订/红线比对（`CompareDocuments` 全仓 0 命中）· 数据透视表（`pivotTable` 0 命中）· PDF 处理（`pymupdf`/`pdfplumber` 0 命中，内置 Python 不含 PDF 库）· 生图（`seedream` 0 命中）· 面向文档的 mermaid（只命中官网工具链）· 不使用 WPS（`wps` 仅命中 package-lock.json）。
【未确认】官方 Desktop 是否在其它发行形态携带 PDF 库；`.et/.wps` 支持；官方 Excel 图表创建；官方对修订的检查。

## 3. 我方 6 插件的差距

### P0（不改则装不上或会互相打架）

1. **安装通道必须改走官方插件事务**
 【事实】`modules/work-personal-secretary/lib/install.js:10-15` 自建原子替换（复制 → SHA256 → 替换目录 → **更新 profile 的 package.json**）；`:23-24` 写入范围含 `<profileDir>/node_modules/<id>`、`package.json`、`cordis.patch.yml`。
 【事实】官方 profile manifest 写入受 **profile 写锁**保护，CLI 与 service 共用；安装/删除还涉及 `pnpm-lock.yaml` 快照恢复与 `dsh.profile.bundles` 有序列表。
 【推断】我方直接 fs 写盘不取锁、不动 lockfile ⇒ 与官方插件页/pnpm 并发时可能互相覆盖。
 ⇒ 改造方向：落盘改走受支持通道（Desktop 内＝插件页/共享 service；Agent 内＝`plugin_manager` 工具，需 `danger-full-access` 或批准），或改为"生成 patch + 依赖声明交给官方事务执行"。

2. **不要再承诺"自动清理核心包副本"**
 【实测】我方 6 模块对 `desktop-packages` / `desktop-runtime` / `CLEAN_PROFILE` / `autoInstallPeers` 的引用数 = **0**（`profiles/desktop` 的 15 处命中全在 README/CHANGELOG/测试）。
 ⇒ 代码无需改，但**文档与安装引导必须删除该承诺**；历史机器若残留核心包副本，需人工一次性清理。

3. **DSH peer 声明已合规，需守住"身份敏感包只许写 peer"**
 【事实】6 模块的 dsh 包全部只在 `peerDependencies`，`dependencies` 为空——**没有把身份敏感 dsh 包写成实依赖**。
 【实测】当前 `0.1.7-rc.2` 下所有范围均满足 ⇒ 不会被门禁拒。风险：官方进 `0.2.x` 时全部失效，6 个 bundle 会进 `skippedBundles`。

4. **宿主服务名核对：全部存在，无需改**
 我方 `inject`：experts `[systemPrompt,tools,commands,settings]`；work-memory 追加 `webServer`；集成体 `[settings,webServer]`；doc-suite `[commands,settings]`；mermaid `[webServer]`；tokenpet `[]`。官方五个服务全部存在且形状一致。

### P1（能装，但有使用者可见缺陷或不符合官方约定）

5. **缺插件展示元信息** —— 6 模块都没有 `locale/` 目录、没有 `./locale/*.json` 导出、`files` 未含它 ⇒ 官方插件页/设置页会回退显示 `package.json.name`，无中文标题、无描述、无图标。
6. **`@deepseek-ai/schemastery` 放错段** —— 我方 4 个模块把它放 `peerDependencies`；官方约定放 `dependencies`。它不受兼容门禁检查，但 `autoInstallPeers:false` 下 peer 不会被装进 profile（【未确认】是否由 installation 闭包提供）。
7. **dsh peer 未在 `devDependencies` 镜像** —— 仅 workspace-tokenpet 做了；官方约定每个 dsh peer 都要镜像。只影响插件自身编译/独立自测，不影响运行时解析。
8. **doc-suite 的 Python 通道与官方不一致** —— `pythonLauncher: 'py -3'` + 硬前置 Python/WPS；官方走 `load_workspace_dependencies` 绝对路径且**不用系统 Python**。纯净化机器上 `py -3` 可能不存在。
9. **client 侧 `external` 未声明** —— 4 个带 client 的模块只写了 `platform` 与 `inject`（注意 `inject` 的真实语义见 §1.4）。【未确认】client bundle 是否引用 baseline 之外的裸模块。

### P2（改进项）

10. 注入 order 硬编码（480/481/500/10150）—— 官方提供 `getSectionOrder()` / `getContextOrder()` 具名分配，硬编码会随官方重排漂移。
11. section name 唯一性 —— 官方"重复注册会抛错"，需带插件前缀。
12. 注入回调容错 —— 官方对 text 回调不容错，我方已有降级判断，建议保持。
13. 加 locale 后需与 README 默认值表同步。

## 4. 哪些插件已无需自行维护

| 模块 | 官方是否已内置同类能力 | 判定 |
|---|---|---|
| `dsh-doc-suite` 0.7.17 | **部分**：官方 `skill-office` 覆盖 docx/pptx/xlsx 创建＋编辑＋结构检查，Desktop 默认注册且自带 Python 库 | **不建议整体退役，建议收窄**：让出"纯 OOXML 新建/结构检查"，保留官方明确不做的——WPS/传统格式（`.doc/.xls/.et/.wps`）、加密与宏文件、PDF 全工具链、PPT 成套模板排版、生图/示意图 |
| `workspace-tokenpet` 1.0.4 | **部分**：`packages/client/ui-trajectory` 已提供 token 用量/耗时/TTFT/吞吐检查器 | **桌宠本体仍需维护**（形象动画、成长、陪伴、面板无替代）；"用量数据展示"可考虑复用官方 session/usage 服务 |
| `dsh-mermaid` 0.4.0 | **否**：官方 mermaid 只在 `website/` 与构建脚本 | **仍需维护**（且为第三方包 MrmoLabs，非我方自有代码） |
| `dsh-experts` 0.5.13 | **否**：`dsh-persona` 仅能在 preset 作用域内遮蔽单个 agent，**不支持全局挂载** | **仍需维护** |
| `dsh-work-memory` 1.0.9 | **否**：官方无内置记忆包，只有第三方 MCP 示例 | **仍需维护** |
| `work-personal-secretary` 1.1.9 | **否** | **仍需维护**，但安装引擎必须改造（P0-1） |

> **结论**：真正"无需自行维护"的只有 **`dsh-doc-suite` 中与官方 `office-docx/office-pptx/office-xlsx` 完全重叠的那部分技能**；其余 5 个模块都还有官方未覆盖的核心职责。

## 5. 对既有文档的修正（本次读码产生）

| 位置 | 原写法 | 修正 |
|---|---|---|
| `OFFICIAL-DESKTOP-ADAPTATION.md` §2 第 3 条 | "生产版启动 Host 前清理 profile 副本与回退链接、删除依赖声明与 overrides" | **已过时**：官方 2026-09-19 删除该机制；新版口径为"不改动已安装的包、依赖声明与锁文件，启动从不运行 pnpm" |
| 同上 §5.1 P0-1 | 以"清理机制"为据判定集成体安装形态会被打掉 | **依据作废**；P0 改为"安装通道须走官方插件事务（写锁/lockfile/bundles 语义）" |
| §5.1 P0-3（原 peer 复核） | 待实测 peer 范围能否匹配 | **已实测**：`0.1.7-rc.2` 全部满足；风险点在官方 `0.2.x` |

## 6. 未确认清单（必须真机实测）

1. `@deepseek-ai/schemastery` 在 `autoInstallPeers:false` + peer 声明下是否由 installation 闭包提供（验法：官方 Desktop 装 dsh-experts，看是否 `ERR_MODULE_NOT_FOUND`）。
2. 集成体 `install.js` 写盘与官方插件页/pnpm 的冲突范围（验法：桌面端跑一次插件页操作后比对 profile `package.json` 与 `pnpm-lock.yaml`）。
3. 4 个 client bundle 是否引用 baseline 之外的裸模块。
4. 官方 `0.2.x` 到来时 `^0.1.5-rc.1` 的失效影响。
5. doc-suite 的 WPS 通道在官方 Desktop 上的可用性（COM 是否被允许、`py -3` 是否存在）。
6. tokenpet 的 skins 落盘在官方 `$DSH_HOME` 下是否受 profile 独占约束。
7. 硬编码 order 与官方已有贡献方是否重叠。
8. 官方**桌面版仍未发布**（最新 `dsh-v0.1.7-rc.2` 为 Pre-release，release assets = 0），以上全部为**静态读码结论，未经运行验证**。

## 7. 待决策与主人裁定（2026-09-25）

| 事项 | 主人裁定 |
|---|---|
| 本次文档是否提交 git（`M README.md` + 两个新文档） | **不提交**，本地保存即可 |
| `dsh-doc-suite` 是否收窄定位（让出纯 OOXML 新建/结构检查给官方技能） | **待源码精读后再议** —— 源码到位后先精读官方实现，再讨论怎么修这个插件 |
| `peerDependencies` 范围是否现在放宽（防官方 `0.2.x` 打断） | **暂不做** |

> **待办**：官方源码包（`E:\lina\参考\deepseek-harness`）解压完成 → 精读官方 `skill-office`（三份 SKILL.md + `check_office.py`）、`office-to-pdf`、`boot/plugin-manager` 的实现 → 与主人讨论 `dsh-doc-suite` 的改造方向。

## 8. 三项修正任务（主人 2026-09-25 定）

> 顺序即优先级。每项的具体改法**待源码精读后细化**；精读对象＝`E:\lina\参考\deepseek-harness`（官方 0.1.7-rc.2 源码包）。

### 任务 1：集成体安装模式修订

- **目标**：把 `work-personal-secretary` 的安装从"自建写盘"改为官方**受支持通道**。
- **现状（已实测）**：`modules/work-personal-secretary/lib/install.js:10-15` 自建原子替换，直接写 profile 的 `node_modules/<id>`、`package.json`、`cordis.patch.yml`（`:23-24`），**不取 profile 写锁、不动 `pnpm-lock.yaml`、不更新 `dsh.profile.bundles`**。
- **待精读**：官方 `packages/boot/plugin-manager` 的安装事务（写锁、lockfile 快照恢复、bundles 有序列表）、`plugin_manager` 工具的调用契约与权限要求（Creator 模式、`danger-full-access` 或逐次批准）。
- **未定**：是"调用官方事务"，还是"生成声明交给官方执行"。

### 任务 2：桌宠用量复用官方数据 + 显示余额

- **目标**：`workspace-tokenpet` 的用量显示改为**直接复用官方数据**；并按官方口径把**余额信息**一并显示出来。
- **现状**：我方自算索引（`session-usage-index.ts` / `usage.ts`）。
- **待精读**：
  1. 官方 token 用量数据的来源与结构（`packages/client/ui-trajectory` 的检查器：token 用量 / 耗时 / TTFT / 吞吐）；
  2. **官方余额数据的来源**（哪个服务或接口暴露余额、字段、刷新语义、是否随账号或 API Key 不同）；
  3. 能否作为**宿主服务**读取（`ctx.get(...)`），而不是我方重新计算。
- **已核实（2026-09-25）官方确有余额数据**：
  - 载体：`packages/client/ui-settings-account` 的 `AccountSnapshot`（定义于 `src/client/AccountSection.tsx`），余额在 `details.balance`；经 **`account` Remote 命名空间**读取。
  - 金额口径（官方 README 原文）："余额沿用 Platform Web 的金额格式：两位小数和千分位分组，正金额截断至分，小于一分的正金额显示为 <0.01，负金额按舍入规则处理且显示绝对值至少为 0.01。**Host 返回的原始余额字符串保持不变。**"
  - 启用条件：账号功能**仅在具备 preload 桥接的 Desktop 内启用**（普通 Web 不订阅账号状态）。
  - 相关：官方还区分 `QUOTA`（API Key 路由）与 `ACCOUNT_QUOTA`（账号路由，HTTP 402 与流内 SSE）；账号页会重读"**资料、余额与未通知赠金**"；官方自带"用量"页（隔离的原生 Platform 视图）。
  - **新增待精读**：`account` Remote 命名空间的访问方式（我方 client 插件能否订阅）、Host 侧是否另有余额服务可直接取。
- **约束**：不得改动官方原始数据；我方只做展示层（只读复用）。

### 任务 3：dsh-doc-suite 精修 —— 与官方互补，并连带调整工具/技能专家

- **目标**：与官方 `skill-office` 形成**互补**而非重叠；互补完成后，**工具/技能专家**（专家库中与文档/技能相关的专家视角与技能配置）也要对应调整。
- **待精读**：
  1. 官方如何**定义与使用 skill**（`packages/skill/skill`、`tool-skill`、`skill-filesystem` 的注册、发现、优先级机制）；
  2. 官方 office 技能的**实际使用方式**是否即 skill 模式；若是，我方是否应对齐为 skill 模式；
  3. 若要"补强"，如何做到**不影响官方原始数据与原始技能**（只增不改、命名空间隔离、优先级不抢占）。
- **边界（官方明确不做或做不全，我方保留）**：WPS 通道与旧格式（`.doc/.xls/.et/.wps`）、加密与宏文件、PDF 全家桶（文本/表格 bbox/合并拆分/转图/合成）、PPT 成套模板排版与主题库、数据透视、Excel 图表与合并、媒体生成（生图/mermaid）。

## 9. 精读结论 · 任务 1（集成体安装模式修订）

> 依据：子代理精读官方 `packages/boot/plugin-manager` + `packages/boot/app-boot` + `packages/util/atomic-write`；我方 `modules/work-personal-secretary/lib/install.js`（1336 行）。行号为精读时点。

### 9.1 官方事务契约（关键）

| 维度 | 官方做法（出处） |
|---|---|
| 入口 | ① 服务 `ctx.pluginManager.installBundle(spec, options)`（`plugin-manager/src/index.ts:461-567`）② 进程内函数 `runPluginCommand(context, args, options)`（`operations.ts:544-557`，**自带写锁**）③ CLI `dsh plugin --profile <name> add <spec>` |
| 写锁 | 锁对象 = profile 的 `package.json`；`withFileLock` 建 `package.json.lock`（`atomic-write/src/index.ts:235-268`）；service 默认 `waitMs=120000`；**整个操作**（pnpm、失败恢复、bundles 写入、HMR reload）都在锁内（`index.ts:767-791`） |
| 快照集 | 只有两份：`package.json` + `pnpm-lock.yaml`（`index.ts:79`）；恢复语义"原本不存在则删、存在则原子写回 0600" |
| 失败回滚 | Git 预检失败 / pnpm 失败 / 取消 / bundle 与兼容性校验拒绝 → `restoreFiles`（`index.ts:526-553`）；**`pnpm-workspace.yaml` 有意不恢复**（保留待审批构建脚本） |
| lockfile | 正常安装不跑 `pnpm install`，由 `pnpm add` 维护；兼容性拒绝时按快照重装回装前版本（`operations.ts:504-516`） |
| bundles | 三处语义：service `selectBundle`（启用追加末尾、关闭过滤、受管理组件保护）· CLI `reconcile`（仅追加本次新增）· app-boot `reconcileProfilePlugins`（无生产调用点） |
| compatibility.json | 结构 `{"pkg@exact": ["exactDshVersion"]}`；有**独立锁**（锁序 package.json → compatibility.json）；授权需 `acceptRisk`（`profile-compatibility.ts`） |
| 保护名单 | `protectedModules` + `protectsManager`；`OPTIONAL_BUNDLES` 随装可选、默认关闭、不可卸载 |

### 9.2 我方改造点（16 条，精选）

| # | 我方现状 | 官方要求 | 处置 |
|---|---|---|---|
| C1 | `api.js:1133-1184` 进程内拷贝 + 手写 profile 文件 | 经 pnpm + 校验 + 启用 | **优先调 `ctx.pluginManager`**（需在 `lib/index.js:40` 的 `inject` 加 `pluginManager`），或进程内用 `@deepseek-ai/dsh-plugin-manager/operations` |
| C2 | `install.js:999-1002` 手写 `dependencies[id]="file:node_modules/<id>"` | 由 `pnpm add <spec>` 写依赖并维护 lockfile+node_modules | **不要手写**；否则清单/锁/磁盘三者失配 |
| C3 | **无锁**（仅备份+校验+best-effort 回滚） | `package.json.lock` 串行整个操作 | 所有 profile 写路径改用 `withFileLock(join(profileDir,'package.json'), fn, {waitMs:120000})` |
| C4 | 只备份 `package.json` + `cordis.patch.yml` | 快照 `package.json` + `pnpm-lock.yaml` | 把 lockfile 纳入事务快照 |
| C7 | **完全没有** compatibility.json | 安装前后各校验一次 + 豁免入口 | 安装前 `evaluatePluginCompatibility` 预检、安装后复检 |
| C8 | 无保护名单 | `protectedModules` / `OPTIONAL_BUNDLES` | 集成体自身与管理组件不可被本安装器关闭/卸载 |
| C9 | 手写 YAML 行插入（`install.js:540-602`） | yaml 文档级编辑、保留注释、`findLast` 匹配 | 换文档级编辑，避免破坏用户注释 |
| C15 | 同步串行、无取消 | requestId + `cancelInstall`/`waitForInstall` | 安装异步化 + 可取消，避免长事务挂死 Web 请求 |

### 9.3 可直接调用的编程入口（非交互）

- `ctx.pluginManager.installBundle(spec, options?)` / `waitForInstall(requestId)` / `cancelInstall(requestId)` / `removeBundle(name)` / `setBundleEnabled` / `setPluginEnabled` / `listPlugins` / `listBundles` / `inspect` / `registries` / `setVersionExemption`
- 进程内函数：`@deepseek-ai/dsh-plugin-manager/operations`（**公开子路径**）的 `runPluginCommand`（自带锁）与 `runProfilePnpm`（调用方需自行持锁）

### 9.4 未确认

U1 本机是否具备 pnpm 可执行文件（官方事务硬依赖）；U2 现有"手写 node_modules + file: 依赖"在官方 hoisted linker 下跑 `pnpm install` 会怎样（需实测）；U3 Desktop profile 的包管理路径是否与 Web profile 同一事务；U7 官方不允许关闭/卸载自身所需的 bundle，我方无此限制。

---

## 10. 精读结论 · 任务 2（桌宠复用官方用量 + 显示余额）

### 10.1 用量侧 —— 我方**已接通**，只需对齐语义

- 【事实】Host 服务 `ctx.tokenMeter`（`packages/llm/token-meter/src/index.ts:94-98,101,111`）；客户端读 session 投影 `tokenUsage`/`contextPressure`/`contextBreakdown`（token-meter 注册）+ `sessionStats`（session-stats 注册）
- 【事实】**我方 tokenpet 已在读 5 个投影**（`modules/workspace-tokenpet/src/client/index.ts:525-533`）⇒ 用量侧不是"接线"问题
- 【纠偏·重要】官方**复用投影的范例是 `packages/client/ui-chat/src/client/chat/StatsPills.tsx:319,326-327`**（投影优先 → 窗口内折叠兜底）；`ui-trajectory` 反而**不读投影**、自己从事件窗口算（`TrajectoryTimeline.tsx:53-68`）⇒ **参照物要换成 StatsPills**
- 【事实】官方**没有**"跨会话终身累计"投影 ⇒ 我方 `lifetime-ledger.ts` / `aggregateCumulativeUsage` **不能删**；单会话粒度折叠与官方 `tokenUsage` 职责重叠，可削减

### 10.2 余额侧 —— 数据存在，但**本机内核还没有**

- 【事实】`AccountSnapshot`（`ui-settings-account/src/client/AccountSection.tsx:16-32`）：`notice?` / `view` / `details` / `failed`
- 【事实】服务链：`ctx.deepseekAccount`（Definition `credentials/deepseek-account/src/index.ts:32-34`）→ `PlatformAccount`（`deepseek-account-platform/src/index.ts:84,205-207`）→ HTTP `/api/v0/users/get_user_summary` 的 `normal_wallets`/`bonus_wallets`
- 【事实】Remote：`AccountController`，namespace **`account`**（`api/account-controller/src/index.ts:13,34-37`）
- 【事实】金额格式 `formatBalance.ts:10-16`：**roundDown**；`balance` 是**十进制字符串**（不要 `parseFloat`，保留服务端精度）；`0`→`¥0.00`、`0<v<0.01`→`<¥0.01`、负值有专门分支
- 【实测·主对话】本机宿主（dsh **0.1.5-rc.2**）：有 `dsh-token-meter` / `dsh-session-stats` / `dsh-client-ui-trajectory`；**没有** `dsh-deepseek-account` / `dsh-llm-deepseek-account` / `dsh-api-account-controller` / `dsh-client-ui-settings-account` / `dsh-platform-account`
 ⇒ **余额功能在官方较新内核才有；本机现在无法开发/验证，必须等官方桌面版**

### 10.3 改造方向（余额）

- **通道 A（推荐）**：client 侧 `inject` 增 `'remote.account'`，用 `ctx.remote.account.getBalance(client)` + `$stream` 订阅 AccountView（与官方同路）
- 通道 B：Host 侧 `ctx.get('deepseekAccount')` + 自建 HTTP 端点（但 `AccountClientMetadata.version` 来源不明）
- 通道 C：复用官方 `hooks.account` —— **实质不可用**（是官方插件 apply 闭包内私有对象）
- **降级四条**：`remote.account` 缺失 → 不注册该行 · 返回 `null` → "未登录" · `status:'failed'` → "余额不可用"（可给 usageUrl 外链） · `DSH_CLIENT_VERSION` 缺失 → 关闭余额区并 `console.info`，**不抛给宿主**

---

## 11. 精读结论 · 任务 3（doc-suite 与官方互补 + 工具/技能专家调整）

### 11.1 官方 skill 机制要点

- 【事实】三角：Service Definition `dsh-skill`（`ctx.skills`）/ Provider（`skill-filesystem`、`skill-badge`、`skill-office`）/ Consumer（`tool-skill`）；注册表只做合并与裁决
- 【事实】形态只有两种：`<name>/SKILL.md` 或 `<name>.md`；**发现深度仅 1 层**；name 必须 kebab-case
- 【事实】frontmatter：必填 `name`/`description`，可选 `whenToUse`/`metadata`/`disable-model-invocation`/`user-invocable`；布尔解析严格（`true/false/yes/no/on/off`），**非法值整条丢弃**；旧键名被拒
- 【事实】**rank 小者优先**：100 项目 `.dsh/skills` · 200 project-agents · 300 `customSkillDirs` · 400 `<dshHome>/skills` · 500 user-agents · **600 bundled（官方 office 在此）**；运行时注册固定 250
 ⇒ 【推断·关键】**我方技能装在工作区 `.dsh/skills`（rank 100）会遮蔽官方 rank 600 的同名技能**；但技能名不冲突（`office-word` vs `office-docx`）故当前无实际遮蔽
- 【事实】重名裁决只有 rank/顺序，**被遮蔽项静默隐藏、无查看 API**

### 11.2 官方 office 的实际形态（**不是纯 skill**）

【事实】三件套：**skill（指令正文）** + **工具 `load_workspace_dependencies`（定位解释器）** + **Provider 运行时段落**（`get()` 时把 `Installed LibreOffice Kit` 段（含 `libreofficeKit.node`/`cli` 绝对路径）拼进正文）。技能名来自常量 `SKILL_NAMES`（不从 frontmatter 读）。

### 11.3 我方现状与差异

- 【事实】我方五套技能（`media-gen`/`office-excel`/`office-ppt`/`office-word`/`pdf-tools`）：`<name>/SKILL.md` 形态，frontmatter **只有 name+description**
- 【事实】宿主半 `lib/index.js` **不注册任何 skill provider**；上架靠集成体 basedeck **复制**到 `<workspace>/.dsh/skills/`（只补缺失、SHA256 比对、modified 不覆盖）
- 【实测】`E:\lina\.dsh\skills\` 下 11 个技能；**模块版与工作区副本的 office-word/excel/ppt 三份 SHA256 不一致**（pdf-tools/media-gen 一致）——待查因果
- 【事实】差异：脚本定位用占位符 `<DOC_SUITE_SCRIPTS>`（官方用 Provider `resourceBase` 渲染的 Base directory 指引）；注册路径不同；frontmatter 未用官方全字段

### 11.4 补强三路径（均不改官方文件）

| 路径 | 做法 | 代价 |
|---|---|---|
| A（现状） | 只往 `<workspace>/.dsh/skills/` 增目录 | 依赖 cwd；`E:\lina` 无 `.git` ⇒ 仅该 cwd 会话可见 |
| **B（推荐）** | `customSkillDirs`（rank 300）指向模块自带 `skills/` | 组合配置加一行（改我方 patch，不动官方）；技能随包升级、不依赖 cwd |
| C | 自建 Provider（仿 `skill-badge`，rank 600 或自定） | 能用 `resourceBase` 对齐官方；Node 代码量增加 |

**不抢占优先级的硬约束**：不用官方已有技能名（`office-docx/pptx/xlsx`、`dsh-badge` 等），只在新增名字上补强 —— 我方 `office-word`/`office-excel`/`office-ppt` 已满足。

### 11.5 工具/技能专家（dsh-experts）调整点

- 【事实】`capability.js` 已首选宿主 skill 注册表（`ctx.skills.snapshot`，失败退回 `experts/skills.auto.json`）；`SKILL_HINTS` 是硬编码 11 项技能名表
- 【推断】同时装官方 office 与我方技能时，同一格式会出现**两条相似指针**（`office-docx` 与 `office-word`）⇒ 需在 `SKILL_HINTS` 补官方三条 + `dsh-badge`，并**在指针文字里区分通道**（官方＝内置 LibreOffice；我方＝WPS COM）
- 【事实】`skill-index.mjs` 的 ROOTS 有 100/200/400/500/600 但**缺 300 custom**；若采用路径 B 需补
- 【事实】我方 `skill-management` 技能未提官方调用策略键与严格布尔语法 ⇒ 需补齐

---

## 12. 本轮收尾状态（2026-09-25）

**本轮主线**：官方桌面版适配调研 + 三项改造任务的精读。已按主人要求**收尾**，等官方发布下一个版本再启动。

### 已完成

| 项 | 产物 |
|---|---|
| 官方桌面版适配核对（两次） | `OFFICIAL-DESKTOP-ADAPTATION.md`（144 行，含 3 处更正） |
| 官方源码读码 + 三份精读 | 本文件 §1–§11 |
| 官方源码本地挂放 | `E:\lina\参考\deepseek-harness`（13,837 文件 / 114.4 MB / `0.1.7-rc.2`） |
| 三项改造任务施工依据 | §8（任务清单）+ §9/§10/§11（精读结论） |

### 未开始（按主人裁定，一律未动手）

- 三项任务**均未做任何代码改动**；插件源码零修改
- **未做任何 git 操作**（本地保存即可）

### 关键基线（下次续接起点）

- 官方最新：`dsh-v0.1.7-rc.2`（2026-09-24T14:10:21Z，Pre-release）；**官方桌面版仍未发布**（release assets = 0）
- 官方仓库：**Issues 已禁用**，bug 反馈走 **GitHub Discussions**（README.zh.md 原文）
- 本机：DSH Desktop `2.0.11` + dsh `0.1.5-rc.2`；**无 account 相关包** ⇒ 余额功能待官方内核升级

### 触发条件（下次启动本项目的信号）

1. 官方发布**下一个版本**（0.1.7 正式版 / 0.1.8 / 或官方桌面版）
2. **官方桌面版实际发布**（release assets > 0）→ 任务 1 / 2 / 3 全部可启动实测
3. 本机 anywhere-labs 版内核升级

### 下次开机第一件事

重跑基线核对：`gh release list --repo deepseek-ai/deepseek-harness --limit 5`，再看 `apps/desktop/package.json` 版本与 **release assets 是否非空**。

### 检查记录

| 检查日 | 最新版本 | `apps/desktop` | release assets | 最新提交 | 结论 |
|---|---|---|---|---|---|
| 2026-09-25 | `v0.1.7-rc.2` | 0.1.7-rc.2 | 0 | 2026-09-24 | 收尾，待下一版本 |
| 2026-09-28 | `v0.1.7-rc.2`（**无变化**） | 0.1.7-rc.2 | **0** | **2026-09-27**（多个 `fix(pty)` / `fix(zh-agent-copy)` / `fix(git-command-line)` / `fix(web-lane-flakes)`，PR 已到 #5282） | **未发新版本；代码仍活跃开发中**（与「还有些小 BUG 在修」相符） |

| **2026-09-29** | **`v0.2.0-rc.1`**（09-28 发布，**minor 跃迁** 0.1.7→0.2.0） | **0.2.0-rc.1** | **0** | 2026-09-28 `release(dsh): 0.2.0-rc.1 (#5387)` | ⚠️ **官方已进入 0.2.x**（桌面版仍未发布）；我方 peer `^0.1.5-rc.1` 对 0.2.x **不满足** → 6 个 bundle 会被 `skippedBundles`。desktop README 47,422→47,801 字符（小幅）。0.2.0 源码含 `api/account-controller` 与 `client/ui-settings-account`（余额链路齐备） |

> **2026-09-29 实测（本机 `semver` 包，判据与官方一致 `includePrerelease: true`）**：
> `0.2.0-rc.1` vs `^0.1.5-rc.1` → **false** ｜ vs `^0.1.5` → false ｜ vs `>=0.1.5-rc.1 <0.3.0` → **true** ｜ vs `*` → true
> `0.1.7-rc.2` vs `^0.1.5-rc.1` → **true**（所以现在能跑）
> ⇒ **6 个模块（除 dsh-mermaid 无 peer 声明外）的 dsh peer 必须放宽**，否则在官方 `0.2.x` 上会被兼容门禁列入 **`skippedBundles`** 并跳过。最小改法：`>=0.1.5-rc.1 <0.3.0`。

### 本地源码版本（2026-09-29）

| 版本 | 路径 | 规模 | 状态 |
|---|---|---|---|
| ~~`0.1.7-rc.2`~~ | ~~`E:\lina\参考\deepseek-harness`~~ | — | **2026-09-29 已按主人指示删除**（不再需要） |
| **`0.2.0-rc.1`** | `E:\lina\ref\deepseek-harness-0.2.0-rc.1` | **13,990 文件 / 113.6 MB** | 2026-09-29 下载，**完整性已校验** |

> 两版都缺官方仓库的 **13 个符号链接条目**（Windows 创建 symlink 需管理员/开发者模式），**真实文件内容完整**。
> **下载经验（可复用）**：① `git clone` 在本网络下会卡死（0 字节）→ 改用 **tag tarball**；② 必须加 `curl --retry-all-errors`，**首次下载曾截断成 13.2 MB**；③ 解压前先 `tar -tzf` **校验条目数**（`0.2.0-rc.1` = **15,963** 条；与官方 `git/trees` 的 15,962 条目一致）。

## 13. 官方 0.2.0-rc.1 改造难度评估（三路复核，2026-09-29）

> 方法：三路独立复核（官方 `E:\lina\ref\deepseek-harness-0.2.0-rc.1` 源码 + 我方 6 模块）＋ 主对话独立复核关键断言。**旧结论（§9–§11 为 0.1.7 基线）未采信，全部按 0.2.0 重核**。

### 13.1 两个全插件级共性问题

| # | 问题 | 依据 | 影响 |
|---|---|---|---|
| **1** | **兼容门禁（0.2.0 新增）** | `packages/boot/app-boot/src/plugin-compatibility.ts:61-88`（只检 `@deepseek-ai/dsh` 与 `dsh-*` 前缀）｜**主对话复核**：本机 `0.1.5-rc.2` 的 app-boot grep 该代码 = **0 命中**，0.2.0 源码 = **19 处** | peer 不覆盖 0.2.0 的包 → 进 `skippedBundles`（`profile.ts:666-683`），**整个 patch 层不加载** |
| **2** | **设置 API 换代** | 0.2.0 `SettingsForms` 只有 `configure/describe/mutate/update/replace/prepareDocument`（`settings/settings/src/index.ts:266-340`）｜**主对话复核**：0.2.0 的 `register` 只剩 1 处注释；本机 `0.1.5` 的 `dsh-settings/lib/index.js:288` 是真实现 | 调用 `settings.register` → TypeError → 被 catch 降级 → **插件仍能跑，但设置页消失、热改失效** |

**peer 实测**（本机 semver，判据与官方一致 `includePrerelease:true`）：`0.2.0-rc.1` vs `^0.1.5-rc.1` → **false**；vs **`>=0.1.5-rc.1 <0.3.0`** → **true**。

### 13.2 六插件难度总表

| 插件 | 装得上 | 跑得起 | 难度 | 工作量 |
|---|---|---|---|---|
| `dsh-mermaid` 0.4.0 | ✅ **零改动** | ✅ 全兼容 | **低** | **0 h**（补 locale 元信息 0.5–1 h） |
| `dsh-work-memory` 1.0.9 | ❌ peer×7 | ⚠️ 4/5 通道活、设置失效 | **低**（恢复设置页＝中） | 最小 1–2 h；恢复设置 4–8 h |
| `workspace-tokenpet` 1.0.4 | ❌ peer×5 | ⚠️ 趋势本就是降级态 | **低—中** | 装上 0.5–1 h；趋势 4–8 h；余额 6–12 h |
| `dsh-experts` 0.5.13 | ❌ peer×1 | ⚠️ 设置失效 | **中** | 低配 0.5–1 h；完整 4–8 h |
| `dsh-doc-suite` 0.7.17 | ❌ peer×1 | ⚠️ 设置失效 | **中** | 4–8 h（+client 卡片 8–16 h） |
| `work-personal-secretary` 1.1.9 | ❌ peer×4 | ⚠️ webServer 活、设置失效 | **中** | **8–20 h**（含 6000 行 client 半） |

### 13.3 分插件要点

**`dsh-mermaid`（唯一零改动）**：无 `peerDependencies` ⇒ 门禁在 `plugin-compatibility.ts:68` **直接 return undefined**；client bundle 的 bare import 只有 `react`/`react-dom`（在官方 baseline）⇒ 无需 `dsh.client.external`；与官方 client API 近零耦合（只挂 MutationObserver 扫 mermaid 代码块）。

**`dsh-work-memory`**：唯二坏点＝peer + `settings.register`；**数据面（store/archive/backup/graph/triage，纯 `node:fs`）与宿主版本无关**；改动集中在一个文件。

**`workspace-tokenpet`**：
- `listSnapshots` / `readFrom` 在**本机 0.1.5 也不存在** ⇒ **不是 0.2.0 回归**（其 CHANGELOG:134 记录 1.0.2 正为此加守卫），趋势功能一直是降级态
- 4 个官方投影（`tokenUsage`/`contextPressure`/`contextBreakdown`/`sessionStats`）**逐字段一致** ✅
- **余额**：0.2.0-rc.1 链路齐备（`api/account-controller` + `ui-settings-account`）；但 `accountClientMetadata` **未导出** ⇒ 必须自实现；`AccountClientMetadata` **必填** `timezoneOffsetSeconds`

**`dsh-experts` / `dsh-doc-suite`**：
- `systemPrompt`/`tools`/`commands`/事件通道/`skills` **全部兼容**
- `{{ }}` 严格插值风险：我方 95 处 `{{` **全在 JSDoc 与自有模板**（如 tokenpet 的 `{{prompt}}`），**不是注入文本**（主对话复核）⇒ 风险低
- ⚠️ 官方 `office-docx/SKILL.md` 明令 *"never search for or invoke system LibreOffice / Do not search for COM automation"*，与我方 WPS COM 口径**指令相反** ⇒ 需在我方 SKILL.md 写明适用边界

**`work-personal-secretary`**：自建 `install.js` 是**文件级安装器**（写 `node_modules/<id>`、profile `package.json`、`cordis.patch.yml`）；0.2.0 **新增官方 `plugin-manager`**（本机 0.1.5 无该包）⇒ 功能重叠；client 半 6000 行，槽位名/载荷需真机验。

### 13.4 建议施工顺序（待主人定）

1. **第一批 · 低成本、不依赖官方桌面版**：全 6 包 peer 改 **`>=0.1.5-rc.1 <0.3.0`**（每包 1–7 行）→ 恢复「能装上」；升版本 + CHANGELOG
2. **第二批**：设置 API 迁移（experts / doc-suite / 集成体 / work-memory）→ 恢复设置页
3. **第三批**：集成体 `install.js` 对齐官方 `plugin-manager`
4. **第四批**：tokenpet 余额（依赖官方桌面版 + preload 环境）
5. **mermaid**：零改动（顺手补 `locale/` 展示元信息）

### 13.5 未确认清单（必须真机实测）

- 改 peer 后是否真的脱离 `skippedBundles`（代码已读，未跑）
- `settings.register` 是否在别处 provide（结论来自源码 grep）
- `describe()` 返回字段口径（`SettingsNamespaceView` vs 旧 descriptor）
- client 槽位名与注入载荷（`settings.section` / `sidebar.right.pane.tab` / resource 协议）
- 官方 CLI `dsh plugin` 子命令入口（cmdline 源码内未命中，可能在 desktop app 侧）
- 双安装器冲突（官方 plugin-manager 是否会重算/覆盖我方 `file:node_modules/<id>`）
- `dsh.client.external` 是否为 0.2.0 必需字段
- 余额的 `DSH_CLIENT_VERSION` 第三方插件能否自备；普通 Web（无 preload）下 `remote.account` 是否注册

## 附录：方法与局限

- 官方取文：`gh api -H 'Accept: application/vnd.github.raw' repos/deepseek-ai/deepseek-harness/contents/<path>`，默认分支 `master`，时点 2026-09-24/25；另用 `git/trees/master?recursive=1` 做包名与能力盘点。
- 我方取文：`E:\lina\DSH插件\src\work-personal-secretary\modules\` 下 6 模块静态审计。
- **局限**：① 官方源码**未固定 commit**，行号为取文时点，发版后须复核；② 本地源码包尚未解压完成，本轮全部为 `gh api` 直读取文；③ 一次 `pypdf` 检索因 GitHub API 403 速率限制未完成，标"未核查"；④ 未运行任何测试脚本。
