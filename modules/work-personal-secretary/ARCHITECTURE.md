# 模块架构说明 · work-personal-secretary（集成体本体）

> **读者**：本模块的维护者。
> **路径约定**：本文所有相对路径以**本文件所在目录**（`modules/work-personal-secretary/`）为基准；`<DSH_HOME>` 指 DSH 的数据根（默认 `~/.dsh`）、`<profile>` 指当前 profile 目录、`<workspace>` 指会话工作区、`<memoryDir>` 指记忆库目录、`<obsidianDir>` 指知识库（vault）根目录。
> **口径**：只写**已实现**的行为；未实现的一律标注「本版未实现」。每条结论附 `相对路径:行号`。代码与注释/文档不一致时，本文以**代码**为准，并在 4.6 节列出已核实的不一致点。
> **版本基线**：`package.json:3` = `1.1.4`；`client/index.js:45` 的 `BUILD = 'v1.1.4'`（由 `scripts/smoke-load.mjs:2019-2027` 断言与 `package.json` 同步）。注意 `CHANGELOG.md:3` 与 `CHANGELOG.md:41` 分别把 1.1.3、1.2.0 段标注为**未发布** —— 版本号不等于已发布 tag。

---

## 1. 架构

### 1.1 这个模块是什么、替谁做什么

`modules/work-personal-secretary` 是**集成体本体**（一个 Cordis 插件），不是运行时能力提供者：它在 DSH 设置里开一个独立分区「工作秘书」，用四页签（安装与检查 / 核心配置 / 配置 / 关于与致谢）**替使用者完成三类工作**——①检查本机环境并安装/覆盖安装五个子插件；②把 DSH 底层配置（`AGENTS.md` 指令块、记忆种子、技能、设置用户层、记忆体与知识库目录骨架、使用者身份条目）**分步写进磁盘**；③渲染并打开随包说明网页。运行期能力（记忆、文档、专家、图表、桌面形象）全部由子插件自己提供，本模块不替代它们。

出处：`README.md:3-5`（定位）、`lib/index.js:2-11`（第一大功能=安装器，第二大功能=配置落地）、`README.md:11-16`（能力与状态表）。

### 1.2 目录组成与文件职责

本模块目录下**实际存在**的内容如下（`lib/`、`client/`、`defaults/`、`scripts/` 四目录 + 7 个根文件）：

| 路径 | 职责 | 关键入口 / 导出（出处） |
|---|---|---|
| `package.json` | 包定义：`main`、`exports`、`files` 白名单、`scripts`、`dsh.bundle.patch`、`dsh.client` | `main: lib/index.js`(`:16`)；`files`(`:24-34`)；`scripts`(`:35-44`)；`dsh.bundle.patch`(`:48-51`)；`dsh.client.inject`(`:52-58`) |
| `cordis.patch.yml` | **中性部署默认层**：`insert` 挂载本体 entry，配置只有 `selfCheckOnStartup`、`repoRoot` 两个 | `:8-16`（insert id=`work-personal-secretary`；注释明说不含个人路径与称呼 `:1-7`） |
| `lib/index.js` | 宿主半入口：声明 `inject`、注册设置命名空间、接线 API 路由 | `inject = ['settings','webServer']`(`:40`)；`SUB_PLUGINS`(`:59-65`)；`readVersion()`(`:46-53`)；`apply()`(`:67-121`) |
| `lib/api.js` | **全部 HTTP 路由**：路由常量、前缀分发、写操作同源守卫、命令白名单执行 | `API_ROOT`(`:111`)、`API_PATHS`(`:113`)、`PAGE_ROOT/PAGE_PATHS`(`:121-122`)、`CORE_API_EXACT_PATHS`(`:130`)、`DOC_SPECS`(`:140-143`)；`installApi()`(`:428`)、`installSettingsExactRoutes()`(`:1327`)、`resolveFixCommand()`(`:334`)、`runFixCommand()`(`:390`)、`openWithSystem()`(`:297`) |
| `lib/probe.js` | 七项**只读**环境探针 + 自动补齐白名单（服务端唯一定义处） | `PROBE_ORDER`(`:32`)、`FIX_WHITELIST`(`:97-118`)、`FIX_EXECUTION_ORDER`(`:121`)、`runProbes()`(`:1295`)、`detectDesktopVersion()`(`:787`)、`readAsarEntryFile()`(`:655`) |
| `lib/install.js` | 子插件安装引擎（原子替换 + 逐文件 SHA256 + 回滚）、仓库根解析、profile 登记 | `SUB_PLUGIN_IDS`(`:137-143`)、`resolveRepoRoot()`(`:627-688`)、`listSubPlugins()`(`:739-794`)、`updateProfilePackage()`(`:952`)、`installSubPlugin()`(`:1078-1318`)、`resolveInstallAllPlan()`(`:1325`)、`deployPetSkins()`(`:233`) |
| `lib/basedeck.js` | **配置底座引擎**：八项计划器 + 写回器 + 备份/锁/护栏 + 根目录派生与反推 + 记忆条目工具 | `BASEDECK_ITEMS`(`:68-77`)、`BASEDECK_APPLY_ORDER`(`:89`)、`planBaseDeck()`(`:1062`)、`applyBaseDeck()`(`:2241-2297`)、`publicPlan()`(`:2300-2323`)、`resolveDeckContext()`(`:873-993`)、`deriveRootChildren()`(`:2382`)、`inferRootDir()`(`:2397`)、`parseMemoryEntries()`(`:2433`)、`withMemoryDirLock()`(`:1620`) |
| `lib/identity.js` | 「使用者身份」条目的读 / 计划 / 整条写入（区间替换 + 写后逐字节校验 + 回滚） | `parseEntries()`(`:100-103`)、`entryBody()`(`:111`)、`locateIdentityRanges()`(`:148-160`)、`readIdentity()`(`:183-217`)、`applyIdentity()`(`:410`)、`applyIdentityAsync()`(`:429`) |
| `lib/domain.js` | 五个预置岗位正文 + 岗位正文生成通道 | `IDENTITY_PREFIX = '使用者身份：'`(`:20`)、`DOMAIN_PRESETS`(`:70-76`)、`generateDomainContent()`(`:139`) |
| `lib/dirs.js` | 目录选择后端：`ctx.directoryPicker` 的 **browse / native 能力分支代理**（纯逻辑，返回 `{status, body}`） | `isFullyQualifiedPath()`(`:62-67`)、`getDirectoryPicker()`(`:73-81`)、`listDirectories()`(`:160-207`)、`createChildDirectory()`(`:215-241`) |
| `lib/import.js` | **旧知识库导入**（只管知识库）：只读扫描 + 逐项对照清单 + 按勾选只补缺失（**绝不覆盖**）+ 写后 SHA256 校验与失败回滚 | `IMPORT_LIST_LIMIT`、`IMPORT_SENSITIVE_RULES`、`walkImportFiles()`、`detectSensitiveText()`、`isSafeImportRel()`、`scanImport()`、`applyImport()` |
| `lib/mirror-sync.js` | **记忆镜像收尾同步**（T5-4）：执行链最后一步写身份成功后，尽力同步一次 `00_全局记忆`；入口按候选目录（profile → repo → bundled）加载 work-memory 的 `lib/backup.js`，失败只降级不阻断 | `memoryMirrorCandidates()`、`syncMirrorBestEffort()` |
| `lib/preflight.js` | 可用性检查：环境就绪三项 / 两目录合法可写 / 两目录关系 / 重名文件占用 | `PREFLIGHT_ENV_IDS`(`:32`)、`relationOf()`(`:59-68`)、`NESTING_DETAIL`(`:79-84`)、`targetState()`(`:100-125`)、`checkDirectory()`(`:128-138`)、`runPreflight()`(`:284`) |
| `lib/setup-state.js` | 核心配置页「当前生效值」：**只走宿主 `ctx.settings.describe`**，只读、不抛 | `SETUP_STATE_KEYS`(`:33-37`)、`buildSetupState()`(`:68-112`)、`readSetupState()`、`readObsidianSyncDir()`（单取镜像目录**原值**，T5-4）、`resolveMigrateSource()` |
| `lib/settings.js` | 本体自己的设置命名空间（`repoRoot`），schemastery **动态导入降级** | `SETTINGS_NS`(`:31`)、`DEFAULTS`(`:34-36`)、`WPS_SETTINGS_SCHEMA`(`:39-45`)、`installSettings()`(`:72-104`)、动态 import(`:23-28`) |
| `lib/settings-api.js` | 配置页宿主侧：白名单 ns 只读枚举 / 白名单写入（revision 栅栏）/ 专家打分预览 | `SETTINGS_NS_WHITELIST`(`:36`)、`SETTINGS_API_PATHS`(`:42`)、`validateWriteRequest()`(`:206-265`)、`sanitizeMessage()`(`:271-276`)、`createSettingsApi()`(`:346-508`) |
| `lib/md.js` | 极简 Markdown → HTML（随包说明网页），零依赖 + 输出转义 + 链接白名单 | `renderMarkdown()`(`:80-142`)、`renderFragment()`(`:182-189`)、`renderPage()`(`:197-208`)、`PAGE_CSS`(`:152-171`)、`DOC_SCOPE_CLASS = 'wps-doc'`(`:145`) |
| `client/index.js` | 客户端半：**手写 loader bundle**，注册 `settings.section` 分区，四页签全部界面 | `BUILD`(`:45`)、`HOST_ORIGIN/HOST_BASE`(`:57-68`)、`Tabs()`(`:2107-2123`)、`CorePage()`(`:2820`)、`CORE_CHAIN`(`:2766-2773`)、`runChainStep()`(`:3185-3263`)、`ConfigPage()`(`:5546`)、`apply()`(`:6104-6182`)、`inject`(`:6186`) |
| `defaults/`（模块内） | 随包说明的**单一真相源**（2 个 md）与被校验的产物（2 个 html） | `defaults/install.zh-CN.md`、`defaults/use.zh-CN.md`、`install.zh-CN.html`、`use.zh-CN.html`；映射表 `lib/api.js:140-143` |
| `scripts/` | 七套自测（不依赖宿主运行时）+ 一个生成脚本 | `smoke-load.mjs`、`probe-test.mjs`、`install-test.mjs`、`basedeck-test.mjs`、`settings-api-test.mjs`、`identity-test.mjs`、`defaults-test.mjs`、`build-defaults-html.mjs` |
| `README.md` / `CHANGELOG.md` / `NOTICE` / `LICENSE` | 使用者与维护者文档、第三方致谢、MIT 许可 | `README.md:33-56`（目录结构）、`README.md:61-87`（配置项与设计约定） |

**本模块不含** `specs/`、`skills/`、`templates/`（这些属于子模块 `modules/dsh-doc-suite`，见其目录）。**另有一份同名但不同处的 `defaults/`**：仓库根 `defaults/AGENTS.zh-CN.md`（指令层模板）与仓库根 `defaults/global-memory.seed.md`（记忆种子），由 `lib/basedeck.js:943-946` 从**模块目录向上两级**取（`join(moduleDir, '..', '..', 'defaults', …)`）。`README.md:73` 明确提示「与模块内的说明文档目录不是同一处」。

### 1.3 与宿主的关系（依赖与降级）

- **宿主半声明两个服务**：`export const inject = ['settings','webServer']`（`lib/index.js:40`）。缺 `webServer` 时只注册设置分区、路由不可用并记日志（`lib/index.js:90-93`）；缺 `settings` 时 `repoRoot` 退回自动探测（`lib/settings.js:88-92`）。
- **`directoryPicker` 故意不写进 `inject`**：运行时 `ctx.get('directoryPicker')` 取值，缺该服务不能让整个插件加载失败（`lib/dirs.js:69-81`、`lib/api.js:866`）。
- **客户端声明**：`return { apply, inject: ['slots','uiWorkspace'] }`（`client/index.js:6186`），包级还声明两个客户端注入包（`package.json:52-58`）。
- **零运行时依赖**：只有 `peerDependencies`，无 `dependencies`（`package.json:60-67`）；`schemastery` 用 top-level `await import` + `try/catch` 降级为 `null`（`lib/settings.js:23-28`）。

---

## 2. 数据流

### 2.1 入口 A —— 「安装与检查」页（`install` 页签）

链路（客户端 `InstallPage`，`client/index.js:2282`）：

1. 进页即 `GET /work-personal-secretary/api/check`（`lib/api.js:892`）→ `runProbes()`（`lib/probe.js:1295`）→ 七项只读探针（`lib/probe.js:32`）。
2. 「依赖安装工具」卡按客户端写死顺序 `FIX_ORDER = ['python','pythonDeps','wps','obsidian']`（`client/index.js:94`）**逐项** `POST /fix { id }`（`lib/api.js:1018`）→ `resolveFixCommand()`（`lib/api.js:334`）查 `FIX_WHITELIST`（`lib/probe.js:97-118`）→ `execFile` 执行固定命令（`lib/api.js:390-428`，`execFile` + 参数数组，不用 shell）；逐项请求层失败时兜底 `POST /fix-all { ids }`（`lib/api.js:1034`，服务端按 `FIX_EXECUTION_ORDER` 串行）。
3. 子插件组：`GET /plugins`（`lib/api.js:900`）→ `listSubPlugins()`（`lib/install.js:739-794`）；安装走 `POST /install { id }`（`lib/api.js:1064` → `installSubPlugin()`，`lib/install.js:1078-1318`）或 `POST /install-all { ids }`（`lib/api.js:1081` → 固定顺序 `resolveInstallAllPlan()`，`lib/install.js:1325`）。
4. 说明文件：`GET /docs` 列路径与存在性（`lib/api.js:807-818`）；`POST /open-doc { doc }` 用系统默认程序打开插件目录里的物理 HTML（`lib/api.js:822-853` → `openWithSystem()`，`lib/api.js:297`）。`doc` 只做白名单查表，**不接受路径入参**。

落盘：

| 目标 | 写入方 | 出处 |
|---|---|---|
| `<profile>/node_modules/<id>/` | 原子替换（临时 `<id>.wps-new` → 校验 → 替换，旧目录暂存 `<id>.wps-old`） | `lib/install.js:1088-1090`、`:1162-1236` |
| `<profile>/package.json` | `dependencies[id] = 'file:node_modules/<id>'` + `dsh.profile.bundles` 追加去重 | `lib/install.js:999-1002`、`:952-1078` |
| `<profile>/package.json.bak-<YYYYMMDD-HHmmss-SSS>` | 写前备份，轮转只保留最近 **10** 份 | `lib/install.js:985`、`:85-88` |
| `<DSH_HOME>/data/workspace-tokenpet/skins/` | 装 `workspace-tokenpet` 后部署桌宠素材（**只补缺失、绝不覆盖**；新址缺套装时从旧址迁移） | `lib/install.js:1293-1305`、`:120-134`、`:233-321` |

### 2.2 入口 B —— 「核心配置」页（`core` 页签）· 六步执行链

页面组件 `CorePage`（`client/index.js:2820`）；门禁三项 = 记忆库子插件 / Python ≥ 3.10 / 8 个 pip 包（`lib/preflight.js:32`、`client/index.js:107`）；三项全绿才展开表单。执行链定义在 `CORE_CHAIN`（`client/index.js:2766-2773`），实现体是 `runChainStep()`（`client/index.js:3185-3263`）：

| 步 | 客户端动作 | 服务端处理 | 落盘 |
|---|---|---|---|
| 1 `check` | `POST /preflight { memoryDir, obsidianDir, workspace:'' }`（`:3187`） | `lib/api.js:698-728` → `runPreflight()`（`lib/preflight.js:284`）；有 `level:'block'` 或 `ready!==true` 即停 | 无（只读） |
| 2 `migrateMemory` | 先 `GET /basedeck` 只读取顶层 `migrateFrom`（`:3215-3217`）；无旧目录则显示「无需迁移」且不发写请求；否则 `POST /basedeck { ids:['migrateMemory'], dryRun:false, overrides }`（`:3218-3222`） | `lib/api.js:1167` → `applyBaseDeck()`（`lib/basedeck.js:2241`）→ `planMigrateMemory`(`:3027-3137`) / `applyMigrateMemory`(`:3143`、`:3178`） | 复制**缺失文件**到 `<memoryDir>`；噪音文件（锁/备份/临时）不迁移（`:2963-2975`、`:3111`）；同名不同内容一律保留目标（`conflicts`，`:3086`）；**从不删除旧目录**（`:3128`、`:3141-3142`） |
| 3 `memoryDeck` | `POST /basedeck { ids:['memoryDeck'], dryRun:false, overrides }`（`:3204-3210`） | `planMemoryDeck`(`lib/basedeck.js:2493-2629`) → `applyDeckFiles`(`:2811`)/`applyDeckFilesLocked`(`:2829`) | `<memoryDir>/` 下建 `PROJECTS`/`DAILY`/`ARCHIVE`（`:2332`）；`MEMORY.md` 追加「使用者身份」占位条目（`:2537`，已存在同前缀条目则跳过 `:2538-2539`）；新建 `USER.md`、`GRAPH.json`（`:2549-2563`）；`PROJECTS/工作秘书.md` 补四条（`:2566-2605`，正文分别来自模块内 `defaults/use.zh-CN.md`、`defaults/install.zh-CN.md`，`:2579-2585`） |
| 4 `knowledgeDeck` | 同上，`ids:['knowledgeDeck']` | `planKnowledgeDeck`(`:2709-2801`) → 同一写回器 | `<obsidianDir>/` 下建 `00_全局记忆`、`工具/`（`技能`/`脚本`/`MCP`）、新建 `🏠 主页.md`、`工具/00_工具总览.md`、`.obsidian/app.json`（`:2725-2757`）；**已存在一律保留不覆盖**（`:2770-2775`） |
| 5 `link` | `POST /basedeck { ids:['settings'], dryRun:false, overrides:{ memoryDir, obsidianSyncDir:<obsidianDir>/00_全局记忆, obsidianDir } }`（`:3242-3247`） | `planSettings`(`:1348`)/`applySettings`(`:2098-2182`) | 写 `<DSH_HOME>/settings.yaml` 的两个键 `work-memory.memoryDir`、`work-memory.obsidianSyncDir`（目标键表 `lib/basedeck.js:157-162` 前两行）；只增改目标键、其余行与注释逐字节保留（`:2150-2159` 有「非目标键变化即回滚」校验）；写前备份 `<file>.bak-<stamp>` |
| 6 `identity` | `POST /identity/save { content, memoryDir, dryRun:false }`（`:3252-3256`） | `lib/api.js:745-760` → `applyIdentityAsync()`（`lib/identity.js:429`） | 整条改写/追加 `<memoryDir>/MEMORY.md` 里以「使用者身份：」开头的条目（`lib/identity.js:134-170`、`:264-299`）；命中 0 条追加、1 条改写并保留原 `id`、多于 1 条拒绝（`:250-255`） |

写完后再渲染「旧知识库导入卡」（客户端 `ImportCard`，出现条件 `runPhase === 'done'`；**只管知识库**，记忆体已在第 1 步迁完）。
卡上的流程是**清单 → 勾选 → 逐项对照写入**：`POST /import/scan` 只读列出源目录每个文件的对照结果
（`copy` 缺失可补 / `same` 已存在且一致 / `conflict` 已存在但内容不同 / `occupied` 同名位置是目录），
`POST /import/apply` 只写使用者勾选且状态为 `copy` 的条目；`same` / `conflict` / `occupied` 一律保留目标内容
（**绝不覆盖**）；命中敏感模式的条目只列出、由使用者自己勾选确认（设计定稿 §3.4 / §12 决议 8 与 13② / §12.1）。

**根目录派生与反推**（1.1.3 的目录模型）：使用者只选一个「存储根目录」，两个子目录由 `deriveRootChildren()` 派生为 `<root>/memory-data` 与 `<root>/obsidian-data`（`lib/basedeck.js:2374-2389`）；子目录名经 `GET /setup-state` 的 `rootSubdirs` 下发，客户端**不硬编码**（`lib/setup-state.js:109`、`client/index.js:3034-3037`）；载入时 `inferRootDir()` 只在两个目录正好是同一父目录下的这两个名字时才反推根目录，推不出就留空、**不猜**（`lib/basedeck.js:2397-2407`、`lib/setup-state.js:100-103`）。

### 2.3 入口 C —— 「配置」页（`config` 页签，读写子插件设置）

四组标签 `CFG_GROUP_TABS = [work-memory, experts, docs, pet]`（`client/index.js:4901-4906`），一次只渲染当前组（`ConfigPage`，`:5546`）：

1. `GET /api/settings`（`lib/settings-api.js:365-384`）：`ctx.settings.describe({ redactSecrets: true })` → `buildSettingsView()`(`:165`) 按 `SETTINGS_NS_WHITELIST`（`:36`）裁剪，复杂类型降级为 `type:'complex'` 只读（`SCALAR_TYPES`，`:51`）。
2. `POST /api/settings/write`（`:387-472`）：同源守卫 → `validateWriteRequest()`(`:206-265`，ns 白名单 + 仅顶层键 + op 只有 `set/unset` + 上限 64 条）→ **`dryRun` 默认 `true` 不写盘**（`:431-439`）→ 只有 `dryRun:false` 才调 `settings.mutate(ns, ops, revision)`（`:443`）→ 冲突映射 HTTP 409 `{ expected, actual }`（`:445-451`）→ 写成功重读回填 `revision/value/user`（`:458-471`）。
3. `GET /api/experts/preview?text=`（`:490`）：动态加载子插件 `match.js` 做打分预览（文本上限 2000，`PREVIEW_TEXT_LIMIT`，`:45`）；子插件未装 → `ok:false, unavailable:true` 可读降级（`:501-507`）。
4. 「文档能力」组的自检状态复用 `/check` 探针结果（`client/index.js:4910-4920`）；「桌面形象」组跳到桌宠自己的分区（`CFG_PET_SECTION = 'workspace-tokenpet'`，`:4751`）。

### 2.4 入口 D —— 随包说明网页与记忆条目（单一真相源）

- 真相源是模块内两个 md：`defaults/install.zh-CN.md`（安装引导）、`defaults/use.zh-CN.md`（使用说明），映射表只有一处 `DOC_SPECS`（`lib/api.js:140-143`，注释明说「杜绝两处漂移」）。
- HTML 是**受校验的产物**：`scripts/build-defaults-html.mjs` 用 `lib/md.js` 的 `renderPage()` 渲染并写 `defaults/*.html`（`scripts/build-defaults-html.mjs:22-35`，标题对表与 `DOC_SPECS` 一致 `:22-26`）；`scripts/defaults-test.mjs:196-203` 逐字节比对「磁盘 HTML」与「现渲染结果」——改了 md 忘记重生成即测试红。
- 两个形态：默认完整文档 `renderPage()`；`?embed=1` 回**片段**（无 `html/head/body`，样式全部作用域在 `.wps-doc`，`lib/md.js:152-189`），供页内注入（路由 `lib/api.js:1259-1281`）。
- 同一份 md 还写进记忆库：`memoryDeck` 把 `use.zh-CN.md` 全文写入 `PROJECTS/工作秘书.md` 的【使用说明】条、`install.zh-CN.md` 写入【安装说明】条（`lib/basedeck.js:2579-2585`），`scripts/defaults-test.mjs:150-151` 逐字断言二者同源。
- `defaults/*.md` 不出现在 `工具/` 或 `skills/` 的落盘路径中。

### 2.5 幂等、并发与一致性

- **只补缺失、不覆盖**是本模块的统一纪律：`memoryDeck`/`knowledgeDeck`（`lib/basedeck.js:2608-2612`、`:2778-2782`）、`skills`（`:1308-1314`，本地改过的只报告差异不覆盖）、迁移（`:3098-3103`）、桌宠素材（`lib/install.js:233-321`）。
- **记忆库写入共用一把锁** `.work-memory.lock`（`lib/basedeck.js:1551-1561`）：`memorySeed` 与 `memoryDeck` 在**锁内重算计划再写**（`:1965-1977`、`:2811-2827`），`identity.js` 通过 re-export 复用同一实现（`lib/identity.js:44-45`），避免「各写一把锁」。同步等待上限 1s、异步 5s、陈旧锁 10s 可抢占（`:1554-1558`）。
- **两处取设置值的路径不同**（维护时要注意）：`/basedeck` 的计划器 `resolveDeckContext()` **直接读** `<DSH_HOME>/settings.yaml`（`lib/basedeck.js:888-890`、`readSettingsValues` `:565`）；而 `/setup-state` `lib/setup-state.js:4-7` 明确只走宿主 `ctx.settings.describe`、不读该文件。写设置一律走 `ctx.settings.mutate`（`lib/api.js:500-533`）。

---

## 3. 对外接口

### 3.1 DSH 工具与命令

**本模块不注册任何 DSH 工具，也不注册任何命令**：`inject` 只有 `settings` / `webServer`（`lib/index.js:40`），代码中不存在 `ctx.tools.register` / `ctx.commands` 调用。工具类接口全部属于子插件（记忆工具在 `dsh-work-memory`，专家检索在 `dsh-experts`）。

### 3.2 HTTP 路由（JSON API）

前缀 `API_ROOT = /work-personal-secretary/api`（`lib/api.js:116`）。注册方式：1 条 `prefix` + 24 条 `exact`（`API_PATHS` 7 + `PAGE_PATHS` 2 + `CORE_API_EXACT_PATHS` 12 + `SETTINGS_API_PATHS` 3），共 **25 条**（注册落在 `lib/api.js:1290-1341`，计数口径注释 `lib/api.js:33-45`、`:1358-1364`）。桌面外壳的 fetch 桥只认 exact，故 prefix 之外另注册 exact。

> 出处列的行号为**写作时实测快照**，随代码增补可能整体漂移；定位以「路径 + 常量 / 函数名」为准（行号可临时 grep 校准）。

| 方法 + 路径 | 入参 | 语义 / 落盘 | 出处 |
|---|---|---|---|
| GET `/check` | — | 七项只读探针报告 `{ok, checkedAt, items[], summary}` | `lib/api.js:892-895`；`lib/probe.js:1295` |
| POST `/fix` | `{ id }` | 按白名单执行固定命令；返回 `{id, ok, command, exitCode, durationMs, output}`（输出截断 8000） | `lib/api.js:1018-1033`、`:334-428`、`:170-172` |
| POST `/fix-all` | `{ ids: string[] }` | 服务端按 `FIX_EXECUTION_ORDER` 串行；未知 id 计入 `rejected` | `lib/api.js:1034-1060`、`lib/probe.js:121` |
| GET `/plugins` | — | 五个子插件版本/安装模式清单；含 `repoRoot/repoRootSource/items/summary` 与三种 repoRoot 回显 | `lib/api.js:900-927`、`lib/install.js:739-794` |
| POST `/install` | `{ id }` | 装单个子插件（原子替换 + SHA256） | `lib/api.js:1064-1078`、`lib/install.js:1078` |
| POST `/install-all` | `{ ids: string[] }` | 按白名单固定顺序串行；`ids` 非数组 → `ok:false` 可读提示 | `lib/api.js:1081-1115` |
| GET `/basedeck` | `?workspace=`、`?obsidianDir=` | 八项配置底座的**只读计划**（绝不写盘）；顶层带 `migrateFrom/migrateFromSource` | `lib/api.js:1130-1162`、`lib/basedeck.js:2300-2323` |
| POST `/basedeck` | `{ ids?, dryRun?, overrides }`，`overrides = { workspace, defaultDomain, identityExpert, memoryDir, obsidianSyncDir, obsidianDir }` | **`dryRun` 默认 `true`**；`ids` 缺省 = 八项全写；`workspace` 非空时必须是合法工作区（否则 `ok:false`） | `lib/api.js:1164-1238`（`dryRun = body.dryRun !== false` 在 `:1172`）、`lib/basedeck.js:2241-2297` |
| GET `/repo-root` | — | 四来源与当前解析结果（只读） | `lib/api.js:934-953` |
| POST `/repo-root` | `{ repoRoot }` | 写设置用户层（免重启）；设置不可用时退回写 profile 的 `cordis.patch.yml`（写前备份）；非空但无效 → 400 且不写盘 | `lib/api.js:954-1001`、`lib/install.js:540` |
| GET `/preflight` | `?memoryDir=&obsidianDir=&workspace=` | 只读可用性检查 `{ok, ready, checks[], summary, checkedAt}` | `lib/api.js:698-728`、`lib/preflight.js:284` |
| POST `/preflight` | 同上三个字段 | 同语义（同源保护） | `lib/api.js:701-707` |
| GET `/identity` | `?memoryDir=`（只允许配置的记忆库目录或其子路径，否则 403） | 身份条目状态与正文 | `lib/api.js:733-742`、`lib/identity.js:183-217` |
| POST `/identity/save` | `{ content(≤4000), memoryDir?, dryRun? }` | `dryRun` 默认 `true`；整条写入身份（异步锁）。**真写成功时**追加一次尽力而为的记忆镜像同步（T5-4），响应多一个 `mirror` 字段（`{ok, skipped, source?, files?, pruned?, reason?}`） | `lib/api.js`、`lib/identity.js:429`、`lib/mirror-sync.js` |
| GET `/domain/list` | — | 五个预置岗位正文 `{items:[{id,label,content}], maxChars}` | `lib/api.js:763-771`、`lib/domain.js:70-76` |
| POST `/domain/generate` | `{ name, content, provider?, model? }` | 生成岗位正文；`promptEnhancer` → `llm` → 无模型服务时 **503** | `lib/api.js:775-804`、`lib/domain.js:139` |
| GET `/docs` | — | 两个说明文件的存在性与路径（服务端拼路径） | `lib/api.js:807-818` |
| POST `/open-doc` | `{ doc: 'guide' \| 'help' }` | 用系统默认程序打开物理 HTML；**不接受路径入参** | `lib/api.js:822-853` |
| GET `/setup-state` | — | 核心配置页当前生效值 + `rootSubdirs` + `note`（只读、不抛） | `lib/api.js:857-860`、`lib/setup-state.js:132-191` |
| GET `/dirs` | `?path=`（可省；传了必须完全限定绝对路径） | 列一层目录 `{ok, kind, path, parent, home, crumbs, entries, truncated}` | `lib/api.js:868-877`、`lib/dirs.js:160-207` |
| POST `/dirs/new` | `{ path, name }` | 在父目录下建**一层**子目录 | `lib/api.js:880-889`、`lib/dirs.js:215-241` |
| POST `/import/scan` | `{ from, to }` | 旧知识库导入：**只读**列清单 + 逐项对照（同源保护） | `lib/api.js:904-915`、`lib/import.js` |
| POST `/import/apply` | `{ from, to, rels:[], dryRun? }` | 按勾选只补缺失（`dryRun` 默认 `true`；**绝不覆盖**；路径相对） | `lib/api.js:918-932`、`lib/import.js` |
| GET `/settings` | — | 白名单 ns 的设置枚举（只读） | `lib/settings-api.js:365-384` |
| POST `/settings/write` | `{ ns, ops:[{op:'set'\|'unset', path:[key], value?}], revision?, dryRun? }` | 写子插件设置用户层；`dryRun` 默认 `true`；冲突 409 | `lib/settings-api.js:387-472`、`lib/api.js:1356-1364` |
| GET `/experts/preview` | `?text=`（截断 2000） | 专家打分实时预览（只读，动态加载子插件 `match.js`） | `lib/settings-api.js:490-508` |

**同源守卫**：写操作（POST）要求 `Content-Type: application/json` + `Origin` 同源，否则 403（`lib/api.js:231-244`）；只读路由用宽松版守卫（不带 `Origin` 放行、带了且跨站拒绝，`lib/api.js:246-256`），用于 `GET /identity`、`GET /dirs`。

**注意（已核实）**：`POST /repo-root` 与 `GET /repo-root` **不在** `API_PATHS` 或 `CORE_API_EXACT_PATHS` 中（`lib/api.js:113`、`:130`），因此只在浏览器载体的 prefix 路由下可达；桌面外壳（合成 origin，只认 exact）下不可达。`/repo-root` 的 handler 在 `lib/api.js:932-1003`。

### 3.3 随包网页路由（text/html，路径冻结）

| 方法 + 路径 | 形态 | 出处 |
|---|---|---|
| GET `/work-personal-secretary/guide` | 完整 HTML；`?embed=1` 回片段 | `lib/api.js:121-122`、`:1259-1288` |
| GET `/work-personal-secretary/help` | 同上 | 同上 |

正文取自模块内 `defaults/install.zh-CN.md` / `defaults/use.zh-CN.md`（`lib/api.js:1273-1275`）。客户端主路径**不是导航这两个地址**，而是 `POST /open-doc` 打开插件目录里的物理 HTML（`lib/api.js:146-158` 注释给出理由：真机直接导航会因宿主门禁拿不到 GUI 会话 cookie 而 403）。

### 3.4 设置命名空间与键

| 命名空间 | 键 | 类型/默认 | 谁读谁写 | 出处 |
|---|---|---|---|---|
| `work-personal-secretary`（本体） | `repoRoot` | string，默认 `''`（空 = 自动探测） | 本体 schema；`GET/POST /repo-root` 与安装成功后自动回写 | `lib/settings.js:31-45`、`lib/api.js:164`、`:500-533`、`:1072-1076` |
| `work-memory` | `memoryDir`、`obsidianSyncDir`（+ 引导不预设的其他键） | 由子插件 schema 决定 | 引导写（`SETTINGS_TARGETS`）；配置页读写 | `lib/basedeck.js:157-162`、`lib/settings-api.js:36-39` |
| `experts` | `defaultDomain`、`identityExpert`（+ 阈值类键） | 由子插件 schema 决定 | 引导写（kind=`keep`：只有引导显式填值才写）；配置页读写 | `lib/basedeck.js:155-161`、`lib/settings-api.js:36-39` |
| `dsh-doc-suite` | 文档能力设置（扁平化后的媒体键） | 由子插件 schema 决定 | 配置页读写 | `lib/settings-api.js:36-39`、`CHANGELOG.md:89-92` |

写设置的**键白名单**在服务端硬编码：`work-memory` / `experts` / `dsh-doc-suite`（`lib/settings-api.js:36`），且只接受**该 ns schema 已声明的顶层键**（`lib/settings-api.js:231-255`）。`GET /setup-state` 读的三个键定义在 `lib/setup-state.js:33-37`。

### 3.5 模块间导出的关键符号（供维护者/测试引用）

- `lib/index.js`：`name`(`:37`)、`inject`(`:40`)、`readVersion()`(`:46`)、`SUB_PLUGINS`(`:59`)、`apply()`(`:67`)。
- `lib/api.js`：`API_ROOT`、`API_PATHS`、`PAGE_ROOT`、`PAGE_PATHS`、`CORE_API_EXACT_PATHS`、`DOC_SPECS`、`PAGE_SPECS`、`SETTINGS_NS`、`REPO_ROOT_MAX_CHARS`、`FIX_TIMEOUT_MS`、`FIX_OUTPUT_LIMIT`（`:111-172`）、`openWithSystem()`(`:297`)、`resolveFixCommand()`(`:334`)、`resolveFixAllPlan()`(`:373`)、`runFixCommand()`(`:390`)、`installApi()`(`:428`)、`installSettingsExactRoutes()`(`:1327`)。
- `lib/install.js`：`MODULE_DIR`、`MODULES_DIR_NAME`、`MODULE_ID`、`EXCLUDED_DIRS`、`MAX_ANCESTOR_LEVELS`、`BACKUP_SUFFIX`、`BACKUP_KEEP`、`ATOMIC_NEW_SUFFIX`、`ATOMIC_OLD_SUFFIX`、`PET_SKINS_PLUGIN_ID`、`SUB_PLUGIN_IDS`、`SUB_PLUGIN_ID_LIST`、`posix()`、`resolveIo()`、`subPluginSpec()`、`isSubPluginId()`、`resolveDshHome()`、`deployPetSkins()`、`describePetSkins()`、`detectBom()`、`readPackageVersion()`、`sha256File()`、`backupStamp()`、`isRepoRoot()`、`locatePatchEntry()`、`readProfileRepoRoot()`、`writeProfileRepoRoot()`、`resolveRepoRoot()`、`readProfileRegistry()`、`listSubPlugins()`、`walkFiles()`、`compareTrees()`、`listBackups()`、`pruneBackups()`、`preflightProfilePackage()`、`updateProfilePackage()`、`installSubPlugin()`、`resolveInstallAllPlan()`。
- `lib/basedeck.js`：`BASEDECK_ITEMS`、`BASEDECK_ID_LIST`、`BASEDECK_APPLY_ORDER`、`SETTINGS_TARGETS`、`NONE_SENTINEL_VALUE`、`MEMORY_SKELETON_DIRS`、`ENTRY_SEP`、`parseMemoryEntries()`、`appendEntriesText()`、`resolveWorkspace()`、`safeWorkspaceParam()`、`resolveDeckContext()`、`planBaseDeck()`、`applyBaseDeckItem()`(`:1809`)、`applyBaseDeck()`、`publicPlan()`、`deriveRootChildren()`、`inferRootDir()`、`memoryTopSegmentInVault()`、`listVaultModules()`、`buildVaultHomeText()`、`buildToolOverviewText()`、`deriveVaultRootFromMirror()`(`:727`)、`withMemoryDirLock()`、`withMemoryDirLockAsync()`、`assertWritableDir()`、`atomicWriteText()`、`backupFile()`、`readFileStrict()`、`walkFilesForMigrate()`(`:2997`)、`LEGACY_MEMORY_SUBDIR`(`:2948`)、`MIGRATE_SOURCE_LABELS`(`:2951`)。
- `lib/identity.js`：`LOCK_BUSY_MESSAGE`、`withMemoryDirLock`、`withMemoryDirLockAsync`（re-export，`:45`）、`ENTRY_DELIMITER`、`IDENTITY_TAG`、`PERSONA_MARK`、`splitEntryRanges()`、`parseEntries()`、`serializeEntries()`、`entryBody()`、`entryIdOf()`、`genIdentityId()`、`todayStamp()`、`locateIdentity()`、`locateIdentityRanges()`、`makeIdentityEntry()`、`resolveMemoryFile()`、`readIdentity()`、`applyIdentity()`、`applyIdentityAsync()`。
- `lib/dirs.js`：`DIRS_PATH_MAX`、`DIRS_NAME_MAX`、`DIRS_ERROR_TEXT`、`isFullyQualifiedPath()`、`getDirectoryPicker()`、`pickerCapability()`、`pickerDegrade()`、`badInput()`、`pickerFailure()`、`listDirectories()`、`createChildDirectory()`。
- `lib/import.js`：`IMPORT_LIST_LIMIT`、`IMPORT_TEXT_SCAN_BYTES`、`IMPORT_SENSITIVE_RULES`、`IMPORT_ITEM_STATES`、`IMPORT_STATE_RANK`、`isSafeImportRel()`、`isPathInside()`、`walkImportFiles()`、`detectSensitiveText()`、`scanImport()`、`applyImport()`。
- `lib/preflight.js`：`PREFLIGHT_ENV_IDS`、`MEMORY_PLUGIN_NAME`、`MIN_PYTHON`、`volumeOf()`、`relationOf()`、`isSameOrNested()`、`NESTING_DETAIL`、`canWriteTo()`、`targetState()`、`checkDirectory()`、`environmentChecks()`、`pathChecks()`、`runPreflight()`。
- `lib/probe.js`：`PROBE_ORDER`、`PROBE_LABELS`、`STATUSES`、`FIX_KINDS`、`NODE_ENGINE_RANGE`、`MIN_PYTHON`、`RECOMMENDED_PYTHON`、`REQUIRED_PIP_PACKAGES`、`SUB_PLUGIN_NAMES`、`WPS_PROGID`、`WINGET_PACKAGE_IDS`、`WINGET_FLAGS`、`FIX_WHITELIST`、`FIX_EXECUTION_ORDER`、`AUTO_FIXABLE_IDS`、`runProbes()`、`detectDesktopVersion()`、`readModuleVersion()`。
- `lib/settings-api.js`：`SETTINGS_NS_WHITELIST`、`SETTINGS_NS_TITLES`、`SETTINGS_API_PATHS`、`PREVIEW_TEXT_LIMIT`、`MAX_WRITE_OPS`、`SCALAR_TYPES`、`EXPERTS_CONFIG_FALLBACK`、`normalizeSchemaFields()`、`normalizeNamespace()`、`buildSettingsView()`、`validateWriteRequest()`、`sanitizeMessage()`、`expertsModuleCandidates()`、`loadExpertsModules()`、`createSettingsApi()`。
- `lib/setup-state.js`：`SETUP_STATE_NAMESPACES`、`SETUP_STATE_KEYS`、`pickKeyValue()`、`buildSetupState()`、`readSetupState()`、`readObsidianSyncDir()`、`resolveMigrateSource()`。
- `lib/mirror-sync.js`：`memoryMirrorCandidates()`、`syncMirrorBestEffort()`。
- `lib/settings.js`：`SETTINGS_NS`、`DEFAULTS`、`WPS_SETTINGS_SCHEMA`、`installSettings()`。
- `lib/md.js`：`escapeHtml()`、`renderInline()`、`renderMarkdown()`、`DOC_SCOPE_CLASS`、`PAGE_CSS`、`renderFragment()`、`renderPage()`。
- `lib/domain.js`：`IDENTITY_PREFIX`、`DOMAIN_MAX_CHARS`、`DOMAIN_NAME_MAX_CHARS`、`DOMAIN_PURPOSE`、`DOMAIN_PRESETS`、`isPresetDomainId()`、`findPresetDomain()`、`normalizeDomainText()`、`buildDomainPrompt()`、`generateDomainContent()`。

### 3.6 客户端页面与设置项

- 分区注册：`ctx.slots.register({ name:'settings.section', id:'work-personal-secretary', order:35, label, locale:NS, inject:()=>({t}) }, Section)`（`client/index.js:6168-6181`）；文案走宿主 locale，缺它时回退内置中文（`:6105-6122`）。
- 四页签 id：`install / core / config / about`（`client/index.js:2111-2116`）。
- 目录选择三条路（按顺序降级）：桌面壳 bridge `window.__DSH_DESKTOP_PICK_DIRECTORY__` → `ctx.uiWorkspace.pickDirectory()` → 应用内目录浏览器（`GET /dirs` + `POST /dirs/new`）→ 手动输入（`client/index.js:6124-6165`、`:3010-3033`、`:3589-3625`、`:3641`）。
- `BUILD` 常量必须与 `package.json` 的 `version` 一致：`scripts/smoke-load.mjs:2019-2027` 真比对（`BUILD === 'v' + version`）。

### 3.7 本版未实现（明确边界）

1. **「工具/」三个子目录的同步**：只建目录与 `00_工具总览.md`，文档明确写「本版只建了这三个目录和这份总览，没有实现任何同步」（`lib/basedeck.js:2686-2706`，总览正文 `:2700-2702`）。
2. **镜像的持续同步**不属本模块：本模块只在执行链收尾触发**一次**（见 3.2 的 `/identity/save`）；此后仍由 `dsh-work-memory` 在其三条写路径后各自触发，本模块不接管、不做定时或文件监听。
3. **旧记忆库目录的清理**：迁移**从不删除**旧目录（`lib/basedeck.js:3128` 固定 `oldDirKept: true`、`:3141-3142`），没有「迁移后清理」实现。
4. **`/repo-root` 在桌面外壳的 exact 可达性**：未注册 exact（见 3.2 末尾注意）。
5. **子插件「升级」只是覆盖重装**：安装动作只有「首次安装 / 覆盖重装」两种，没有版本高低比较（`lib/install.js:1155` 的 `overwrite` 仅在版本**相同**时为 true，回显为「覆盖重装」；`upToDate` 由 `bundledVersion === installedVersion` 判定，`:774`）。安装源恒为 `<repoRoot>/modules/<id>`（`:1087`），因此「升级」= 仓库副本刷新后重装。

---

## 4. 回退与恢复

### 4.1 版本回退（改版本号 → 重装 → 重启）

本模块没有自带回退命令，回退靠**换回旧包 + 重新装入 + 重启**：

1. **版本号两处必须同步改**：`package.json:3` 的 `version` 与 `client/index.js:45` 的 `BUILD`（`README.md:30-31` 说明「每次改动都会升版本号，界面里的 BUILD 常量与它同步维护」；`scripts/smoke-load.mjs:2019-2027` 会断言二者一致，不一致即自测红）。
2. **重装**：`dsh plugin --profile <profile> add <本模块目录>`（`README.md:26-28`；亦见 `defaults/install.zh-CN.md:54-62` 对子插件的同款命令）。
3. **重启 DSH**：宿主侧（`lib/`）改动需重启才加载；仅客户端改动刷新页面即可（`README.md:30`、`defaults/install.zh-CN.md:62`）。
4. **若只想回退某个子插件**：把 `<repoRoot>/modules/<id>` 换回旧副本后走 `POST /install { id }` 覆盖重装——成功后旧目录 `<id>.wps-old` **已被删除**（`lib/install.js:1266-1270`），所以**不能**靠该暂存目录回退，只能重装。
5. `git revert` 不是本模块的运行时回退手段，只在源码仓层面有效；`CHANGELOG.md:3`、`:41` 标注 1.1.3 与 1.2.0 均未发布，回退时不要假设存在对应发布 tag。

### 4.2 数据备份与恢复（自动产生，手动恢复）

| 备份对象 | 命名 / 位置 | 保留策略 | 出处 |
|---|---|---|---|
| `<profile>/package.json` | `package.json.bak-<YYYYMMDD-HHmmss-SSS>` | 只保留最近 **10** 份，写前先轮转 | `lib/install.js:85-91`、`:983-996`、`:900-923` |
| 配置底座改写的既有文件（`AGENTS.md`、`MEMORY.md`、`settings.yaml` …） | `<文件>.bak-<stamp>` | 每个文件保留最近 **5** 份 | `lib/basedeck.js:94-96`、`:1743-1772` |
| 身份写入的 `MEMORY.md` | `MEMORY.md.bak-<stamp>`（文件原本不存在时不备份） | 同上 | `lib/identity.js:301`、`:323-329` |
| 记忆库根 | 由 `dsh-work-memory` 自己备份（默认 `<DSH_HOME>/data/dsh-work-memory/backup`），本模块只保证目录存在 | — | `lib/basedeck.js:128-133`、`:923-925` |

手动恢复：把对应的 `.bak-<stamp>` 复制回原文件名即可（文件格式为 UTF-8 **无 BOM**；本模块多处拒绝写入带 BOM 的文件，例如 `lib/install.js:931`、`lib/identity.js:240-242`、`lib/basedeck.js:2530`）。备份会被轮转清理，**长期回退必须另做外部备份**。

### 4.3 自动回滚机制（写入失败不留半成品）

- **子插件安装**五步回滚：复制到临时目录 → 逐文件 SHA256 校验 → 原子替换（旧目录先改名暂存）→ 更新 profile/package.json → 成功后删旧目录；任一步失败即回滚（旧目录改回、临时目录清理、新建目录移除），前置检查不通过时**绝不触碰目标目录**（`lib/install.js:1060-1068`、`:1114-1143`、`:1171-1236`、`:1238-1264`）。
- **配置底座写回**：`applyDeckFilesLocked` 先建目录再写文件，任一失败调 `rollbackAll()`（还原备份文件 / 删除本轮新建文件、按逆序删本轮新建目录，删目录**带 recursive**，`lib/basedeck.js:2857-2899`）；写后校验无 BOM + SHA256（`:2901-2916`）。
- **设置写入**：写前备份 → 原子写 → 校验无 BOM + YAML 结构 + **非目标键值未变**，任一不满足即回滚（`lib/basedeck.js:2121-2159`）。
- **身份写入**三项独立校验：①文件内容与预期逐字节相同；②目标区间以外字节未变；③含「助手人设」的条目未变——任一失败即回滚（`lib/identity.js:337-363`）。
- **记忆库锁竞争**：拿不到 `.work-memory.lock` 时统一返回可读失败、**不改动任何文件**（`lib/basedeck.js:1560-1561`）。
- **迁移是唯一「失败即停」的步骤**：迁移失败时后续步骤一律不执行，避免「设置已切换但旧记忆没带过来」的错觉（`lib/basedeck.js:2271-2277`）。

### 4.4 不可逆操作与注意事项

1. **安装成功即删除 `<id>.wps-old`**（`lib/install.js:1266-1270`）：这是回退链上唯一的「没有自动后悔药」的动作；删不掉时只在回显里提示「可手动清理」（`:1289-1291`）。
2. **安装源固定**：目标目录的源恒为 `<repoRoot>/modules/<id>`（`lib/install.js:1087`），仓库副本缺失/仓库根解析不到时安装会直接失败且不触碰目标（`:1119-1130`）。
3. **覆盖重装的判定按版本相等**：`overwrite` 只在「目标已存在且版本相同」时为 true（`:1145-1155`），其余情况都按普通替换处理——不要据此认为「版本不同会拒绝安装」。
4. **`POST /basedeck` 缺省写八项**：`ids` 缺省 = `BASEDECK_ID_LIST`（`lib/api.js:1173`），调用方若依赖旧的 5 项缺省集合必须显式传 `ids`（`CHANGELOG.md:29`）。
5. **`dryRun` 三处默认值**：`POST /basedeck`（`lib/api.js:1172`）、`POST /identity/save`（`lib/api.js:756`）、`POST /settings/write`（`lib/settings-api.js:263`）都默认 `true`，只有显式 `dryRun:false` 才落盘。
6. **迁移只补缺失、不覆盖同名不同内容的文件**：冲突会留在目标侧（`lib/basedeck.js:3086`、`:3112`），并计入 `conflicts`；不要期望迁移能「覆盖修正」目标里的旧文件。
7. **`AGENTS.md` 块被手改时不覆盖**：判定为 `user_modified` 时新版块写到同目录的 `AGENTS.wps-new.md`，由使用者人工合并（`lib/basedeck.js:99`、`:402-443`）。
8. **发布件中立性是硬约束**：`cordis.patch.yml` 顶部注释要求「不含任何个人路径、称呼或凭据」（`cordis.patch.yml:1-7`）；`scripts/defaults-test.mjs:42-48` 定义了一份禁用串清单（个人路径、称呼、客户与项目名、凭据样例等），对 `defaults/*.md` 与渲染出的 HTML 做命中检查（`:88-95`、`:202`）——维护随包说明时必须先跑该脚本。
9. **本模块不读、不写任何凭据**：探针里的 WPS 只做 COM ProgID 实例化并退出、不打开文档（`lib/probe.js:76-77`）；`settings` 枚举一律 `redactSecrets: true`（`lib/settings-api.js:360`），错误信息会把盘符绝对路径替换为 `<path>`（`:271-276`）。

### 4.5 自测与门禁（改动后必跑）

七套脚本均**不依赖宿主运行时**，夹具一律建在系统临时目录下（各自脚本头部注释列出覆盖范围）：

| 脚本 | 覆盖要点 | 运行方式 |
|---|---|---|
| `scripts/smoke-load.mjs` | mock loader + mock ctx **真跑客户端 `apply()`**；含 `BUILD` 与 `package.json.version` 真比对 | `npm run smoke`（`package.json:37`） |
| `scripts/probe-test.mjs` | 七项探针形状、`/fix` 白名单逐字断言、`/fix-all` 固定顺序（**绝不真跑安装**） | `npm run probe`(`:38`) |
| `scripts/install-test.mjs` | 安装全流程、原子替换与失败回滚、备份轮转（10）、桌宠素材部署 | `npm run install`(`:39`) |
| `scripts/basedeck-test.mjs` | 八项契约、`AGENTS.md` 七状态、幂等、迁移、目录选择、dry-run 零写盘 | `npm run basedeck`(`:40`) |
| `scripts/identity-test.mjs` | 定位 / 追加 / 改写 / 多命中拒绝 / 回滚 / BOM 拒绝 / 锁 | `npm run identity`(`:41`) |
| `scripts/defaults-test.mjs` | 说明文件健康 + **敏感过滤** + md/HTML/记忆条目三者同源 + `files` 白名单 | `npm run defaults`(`:42`) |
| `scripts/settings-api-test.mjs` | 三条路由契约、写入校验、409、降级不崩、专家预览、**真实子插件 schema 键数静态核对** | `node scripts/settings-api-test.mjs`（`package.json` 未提供同名 npm script） |

补充：`npm run check`（`package.json:36`）对 14 个文件做 `node --check`；`npm run build:defaults`（`:43`）在**改了 `defaults/*.md` 之后必须重跑**，否则 `defaults-test` 的逐字节比对会红（`scripts/build-defaults-html.mjs:7-11`）。仓库级 CI 会遍历 `*/scripts/*-test.mjs` 并逐套执行（`.github/workflows/ci.yml:47-62`）。

### 4.6 已核实的注释 / 文档滞后点（维护时按代码为准）

1. 路由计数注释：`lib/api.js` 的三处（文件头、常量注释、`installSettingsExactRoutes` 文档注释）与 `lib/index.js:16-20`、`:95-96` 已在 T5-5 一并更正为 **24 exact + 1 prefix = 25**（旧值 22 / 23、index.js 旧值 18）。以 `CORE_API_EXACT_PATHS` 常量与 `scripts/probe-test.mjs` 的集合全等断言为准。
2. `lib/index.js:62` 的 `SUB_PLUGINS` 用途文案写「常驻一位身份专家，其余按问题归属补位」，与专家库 0.3.0「身份退场（`identityExpert` 留空 = 不常驻）」的现状不一致；同问题也出现在仓库根 `defaults/global-memory.seed.md:17` 的【专家库】条目。该字段只用于展示（不参与安装判定），但会误导维护者。
3. `lib/basedeck.js:968-969` 注释称「basedeck 自己不读 settings.yaml」，而同一函数在 `:888-890` 确实通过 `readSettingsValues()` 读了 `<DSH_HOME>/settings.yaml`（只读、用于计划）。准确口径见 2.5 节。
4. `.github/workflows/ci.yml:44-45` 的注释写「探针 probe 134 / 安装引擎 install 169 / 底座契约 basedeck 179 / 设置 API settings-api 109」，与 `CHANGELOG.md:36` 记录的通过数（149 / 244 / 415 / 112）不一致，注释未随脚本增补更新。
5. `README.md:93-99` 的分期路线把「P6 四页签 / 核心配置执行链」归到 1.1.3，而 `CHANGELOG.md:3` 标注 1.1.3 未发布——对外表述时需与发布状态对齐。

---

*本文只描述本模块已实现的行为；未实现项见 3.7 节。所有结论均可按标注的 `路径:行号` 回到代码复核。*
