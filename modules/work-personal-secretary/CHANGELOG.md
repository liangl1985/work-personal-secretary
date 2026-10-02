# CHANGELOG · work-personal-secretary（集成体本体）

## 1.1.24 — 2026-10-02（「未配置」改为按需出现：有值就不在下拉里）

> 使用者 2026-10-02：卡片生效后下拉已正确列出全部岗位，但**顶上多出一条「未配置」**。

- **原因**：\`<select>\` 必须有一个 option 才能承载"当前值"显示，1.1.18 起那个空态占位是**无条件渲染**的，
  所以它一直躺在展开列表里 —— 那不是"没读到值"，是它本来就被摆在那里。
- **修**：占位项改为**按需插入** —— 只有"当前选中的岗位**不在清单里**"（含压根没选）时才插入。
  于是：**配置读到值 → 下拉里只有真实岗位**；真的没值（或选中项已失效）→ 才由它显示「未配置」。
  它仍是 \`disabled\`，不可选、不可点。
- **测试**：新增"有选中岗位 → 下拉里不出现「未配置」"断言；既有"两级来源都空 → 停在「未配置」"用例保留。
- 回归：smoke-load 537 / 0；其余见提交说明。

## 1.1.23 — 2026-10-02（修卡片目录算不出来：DSH_HOME 解析漏了兜底）

> 真机 2026-10-02：卡片已生成在 \`<DSH_HOME>/data/work-personal-secretary/domains\`，但接口返回
> \`cardsDir: ""\`、\`jobs: []\` —— **目录压根没算出来**，卡片自然读不到，下拉里也就没有那个岗位。

- **根因**：1.1.22 的 \`domainsDirOf()\` 只读 \`deps.dshHome\` 与 \`process.env.DSH_HOME\` 两处，
  而 \`index.js\` 传给 \`installApi\` 的 deps 里**并没有 dshHome**，DSH 主进程也**没有** \`DSH_HOME\` 环境变量
  → 两处都空 → 返回空目录 → 卡片读不到。
- **修**：改用 \`lib/\` 里**与配置底座同源**的 \`resolveDshHome()\`（\`deps.dshHome\` 测试注入 →
  环境变量 → **\`~/.dsh\` 兜底**）。实测（清掉 DSH_HOME 后）返回 \`C:\\Users\\liangl\\.dsh\`，兜底生效。
- **顺带**：profile 覆盖层里 \`selectedDomain\` 的旧前缀 \`custom:\` 改为 \`card:\`（卡片 id 前缀统一），
  否则下拉按 id 找不到该项、会回退显示第一个预置岗位。改前已再备份。
- 回归：smoke-load 536 / 0；其余见提交说明。

## 1.1.22 — 2026-10-02（岗位卡片化：新建岗位 = 生成一张岗位卡片文件）

> 使用者 2026-10-02 定的存储方式：**下拉读的岗位统一来自"岗位信息卡"**；预置 5 张来自源码常量，
> **新建的岗位 = 独立的卡片文件**，放在**配置文件指向的目录**里；**有几张卡片就显示几个岗位**。
> 同时明确：建出来的就是**普通岗位**，不再叫"自定义"。

- **新增 `lib/domainCards.js`**（岗位卡片存储）：一张卡一个 `*.json`；原子写（tmp + rename）；
  文件名由 id **白名单化**并做相对路径越界校验（防 ".." 与绝对路径注入）；名称/正文按 10/200 字截断；
  读目录容错（坏文件跳过并计入 `invalid`）；单目录上限 200 张。
- **新增配置项 `domainsDir`**（volatile）：**卡片目录** —— 这就是"配置文件指向卡片"的那条指向；
  留空用默认 `<DSH_HOME>/data/work-personal-secretary/domains`。
- **`GET /domain/list`** 改为返回**预置 5 张 + 卡片目录里的全部卡片**（下拉的唯一来源）。
- **新增 `POST /domain/card`**（新建/覆盖一张卡片）与 `POST /domain/card/delete`；两条都加入
  `CORE_API_EXACT_PATHS`（桌面载体只认精确路由）。
- **`GET|POST /jobs`** 改为**卡片后端**：GET 返回卡片列表；POST **逐张 upsert**，**刻意不删除** ——
  整表覆盖在"读到空"时会删光使用者的岗位（1.1.20 的教训），删除走专用接口。
- **前端**：保存岗位改为调 `POST /domain/card`（**服务端写卡片**，然后重拉 `/domain/list`）；
  下拉**只认 `/domain/list`**（不再在前端拼 `custom`，否则同一岗位出现两次）；
  新建项文案 `都不是（新建岗位…）` → **`＋ 新建岗位…`**；岗位名**不再带"（自定义）"后缀**；
  卡片 id 前缀统一为 `card:`（`/setup-state` 的非预置派生同步）。
- **迁移**：已把配置里旧 `customJobs` 的那一条写成卡片文件
  `<DSH_HOME>/data/work-personal-secretary/domains/工控信息安全售前.json`（label 已去后缀）。
  备份：`E:\lina\backup\2026-10-02-岗位卡片化前\cordis.patch.yml.bak-*`。
- 回归：smoke-load 536 / 0；其余见提交说明。

## 1.1.21 — 2026-10-02（岗位来源修正：读回配置里本来就有的岗位值）

> 使用者 2026-10-02 反馈：界面显示「未配置」，但**配置文件里应该有值**。实测确认他说得对。

- **实测数据**：profile 覆盖层 `work-personal-secretary` 的 config 里 `selectedDomain: ""` + `customJobs: "[]"`
  （1.1.17/1.1.18 新加的两个键，确实空）；但 `GET /setup-state` 返回
  `domain: {id:"infosec", label:"信息安全", isPreset:true, source:"settings"}` ——
  **`experts.defaultDomain` 同样是 profile 配置里的岗位值**（source 明确标 settings）。
- **1.1.18 的错误**：把来源收窄成"只认 selectedDomain"，于是把配置里**本来就有的**岗位值排除在外，
  界面反而显示「未配置」。
- **修正**：岗位改为**配置优先、逐级回落**：
  ① 配置文件里的 `selectedDomain`（有则用，`loadCustomJobs` 已填）；
  ② 宿主设置里的 `experts.defaultDomain`（`/setup-state` 的 `domain`，同属 profile 配置）；
  ③ 两级都空 → 保持空，UI 显示「未配置」（一眼可辨"配置空"与"读到了值"）。
- **测试同步**：1.1.18 改窄的三处断言恢复；另**新增**一条"两级来源都空 → 停在「未配置」"用例 ——
  空态由独立用例守住，不再靠牺牲正常路径。534 通过 / 0 失败。
- 真机预期：重启后「工作岗位」显示 **信息安全**（配置里的值）；两级都为空时才显示「未配置」。

## 1.1.20 — 2026-10-02（防数据丢失：读取失败不再开启写回）

> 真机 2026-10-02：配置里已保存的自定义岗位**莫名变空**。定位到前端一条**数据丢失路径**。

- **问题**：`loadCustomJobs()` 原本在 `finally` 里无条件 `jobsHydrated.current = true` —— 于是
  **`GET /jobs` 读取失败**（插件未加载 / 404 / 超时）时，state 里仍是默认空列表，而写回已经开启，
  下一个 effect 便把**空列表写回配置**，覆盖掉使用者已保存的岗位。
- **修**：`jobsHydrated.current = true` 移入**成功分支**；读取失败**不开启写回**（宁可不写，不覆盖）。
  代价：读取失败时"新建岗位"这一次写不进去，刷新后读到即可；换来的是**已有配置不会被清空**。
- 回归：smoke-load 533 通过 / 0 失败。

## 1.1.19 — 2026-10-02（空态修正：「未配置」是不可选占位，不是下拉选项）

> 使用者 2026-10-02 指出两处：① 界面显示的是"请选择…"而不是配置值 / 未配置；
> ② **「未配置」不该做进下拉里变成一个可选项**。

- **① 显示错位的真因**：`<select>` 的第一个 option 一直是 placeholder（`value:''`），而 1.1.18 把「未配置」
  也作为 `value:''` 的选项塞进了 `domainOptions` —— 浏览器对同值 option 取**第一个**，于是永远显示
  placeholder「请选择…」，「未配置」被挡在后面。
- **② 修**：把「未配置」从可选列表**移除**；placeholder 项改为**不可选的空态占位**（`disabled: true`），
  文案由 `coreDomainPlaceholder`（请选择…）换成 `coreDomainUnset`（未配置）。于是：
  配置里**读到值** → 下拉显示该值；**没读到** → 显示「未配置」，且**点不开、选不了**。
- 文案精简：下拉里只放「未配置」，解释放 `coreFieldDomainHint`（"显示「未配置」= 配置文件里没有选中的岗位"）。
- **两处入口同源**：核心配置页签（`initialTab: 'core'`）与设置面板「工作秘书」渲染的是**同一个组件**，
  一次改动同时生效。
- 回归：smoke-load 533 通过 / 0 失败（既有断言"下拉含「未配置」空态文案"仍成立）。

## 1.1.18 — 2026-10-02（岗位读取语义收紧：配置有值显示值，无值显示「未配置」）

> 使用者 2026-10-02 第二次澄清（比 1.1.17 更严）：**先判断配置文件是否有数据 —— 有则显示数据，
> 无则显示「未配置」**。1.1.17 做成了"无值回落到默认岗位"：界面看起来像配置成功，**无法分辨"配置空"
> 与"读到了值"**，反而不便于查错。

- **下拉首项固定为「未配置」**（`client/index.js` 的 `domainOptions`）：配置文件 `selectedDomain` 没有值时就停在它 ——
  显式空态便于查错，不拿预置岗位冒充"已配置"。新增文案 `coreDomainUnset`（中 / 英）。
- **删除 `/setup-state` 对岗位的回填**（原 `dom` 段整段移除）：选中的岗位**只认配置文件**；预置岗位仍在下拉里
  可选，但不再被自动选中。**目录类字段的回填不受影响** —— 那是"当前生效值"，语义不同。
- **门禁随之一致**：岗位未配置 → 保存按钮置灰（不再由预填解锁）。
- **测试同步**（`smoke-load.mjs`）：3 处旧断言描述的是被淘汰的"自动回填"行为，**改写**为新语义的断言
  （不删用例）：未配置空态可见、岗位未配置 → 保存置灰、不再凭空派生自定义岗位。533 通过 / 0 失败。
- 真机预期：重启后「工作岗位」显示 **未配置（配置文件里没有选中的岗位）**；手动选定 → 写入配置 → 之后一直在。

## 1.1.17 — 2026-10-02（岗位读取语义改为「配置优先」：选中岗位也持久化）

> 使用者 2026-10-02 定的口径：**配置表里有值就直接读出来显示，没有值才显示默认**。
> 现状缺口：自定义岗位列表已落配置（1.1.16），但**「当前选中哪个岗位」从未持久化** ——
> `CORE_STATE_DEFAULT.domainId` 默认空、靠 `GET /setup-state` 的 `domain` 回填，而它**只认预置岗位**
> （真机实测 `{id:"infosec",isPreset:true,source:"settings"}`）。于是选了自定义岗位，重启/刷新后又变回"信息安全"。

- **新增配置键 `selectedDomain`**（`lib/settings.js`，**volatile** —— 宿主设置服务只允许写 volatile 字段）：
  当前选中岗位 id（含 `custom:<名称>`），与 `customJobs` 同一持久化通道，落 profile 覆盖层。
- **`GET /jobs` 同时返回 `selected`**；`POST /jobs` 接受 `{ jobs, selected }`，并在**同一次 mutate** 里写两键。
- **前端读取语义**（`client/index.js`）：`loadCustomJobs()` 水合 `custom` **与** `domainId` ——
  **配置里有 selected 就直接用它（含自定义）；没有才保持现状，让 `/setup-state` 回落默认**；
  变化监听改为 `[st.custom, st.domainId]`，任一变化都整表写回，选中的岗位随之持久化。
- 回归：defaults 61 / settings-api 115 / smoke-load 533 / probe 151 / install 246 / identity 73 / basedeck 574，失败 0。
- 真机预期：选中自定义岗位 → 重启 DSH → 下拉里仍是它（不再回落到"信息安全"）。

## 1.1.16 — 2026-10-02（修自定义岗位写不进去：customJobs 必须 volatile）

> 真机（2026-10-02）：1.1.14 加的自定义岗位持久化**完全没生效** —— 新建岗位不落盘，重启后列表依旧为空。
> 取证：`GET /jobs` → `{ok:true,jobs:[]}`；profile 覆盖层里 `customJobs` 行数 = 0。

- **根因**：1.1.14 为了让该键**不出现在设置表单**，刻意**没加 `.volatile()`**；而宿主设置服务
  **只允许写 volatile 字段**，于是 `POST /jobs` 被拒 —— 端到端实测复现：
  `写入设置失败：Config field "customJobs" is not volatile`。前端 `.catch(() => {})` 又**静默吞掉**了它，
  界面上只表现为"没生效"。
- **修**：`customJobs` 改为 `withVolatile(...)`，并补 description 说明"由配置页维护、通常无需手工编辑"；
  代价是它会出现在设置表单里（属预期，已在 description 里写明）。
- **顺带**：`persistCustomJobs` 的失败不再静默 —— 改 `console.warn` 留痕，避免同类问题只能表现为"没生效"。
- **教训（已写进注释）**：「数组语义用字符串」的库内约定可以照搬（`enabledDomains`），
  但 **volatile 是宿主写入的硬前提**，不能为了表单整洁而省。
- 回归：defaults 61 / settings-api 115 / probe 151 / install 246 / identity 73 / basedeck 570 / smoke-load 533，失败 0。

## 1.1.15 — 2026-10-02（修「一键配置」第 4 步永久失败：applySettings 补 service 分支）

> 真机（2026-10-02）：「一键配置」走到第 4 步「建立两者关联」就红，第 5 步「写入岗位身份」卡在等待。
> 取证：`POST /basedeck { ids:['settings'], dryRun:false, overrides:{当前值} }` 返回
> `results[0] = { status:'update', ok:false, detail:'没有可写入的键，未写盘' }`。

- **根因**：rc.2 迁移只改了 `planSettings`（写计划）与 `api.js` 的 `writeDeckSettingsViaService`（写回器），
  **漏改执行层 `applySettings`** —— 它的注释写着「待写的键交给写回器经 ctx.settings.mutate 落地
  （见 applySettings 的 viaService 分支）」，而那个分支**根本不存在**。走设置服务时 `internal.planned`
  恒为 `null`（文件级计划只在文件通道生成），于是必然落到 `if (!internal.planned || !internal.planned.ok)`
  并返回 `ok:false`（「没有可写入的键，未写盘」）—— 一个**已经写入成功**的键被判成没写。
- **修**：`applySettings` 补 `internal.viaService === true` 分支 → `ok:true` + detail 说明
  「由宿主设置服务落地（不经 settings.yaml）」；同时 `api.js` 把 `writeDeckSettingsViaService` 的失败
  **传播到最终 ok**（`ok: applied.ok && !serviceWriteFailed`），避免上面的恒 `ok:true` 掩盖真实写入失败。
- **测试**：`basedeck-test.mjs` 新增 `[9b] service 通道` 用例 —— 此前该文件**只覆盖文件通道**
  （`settingsSource` / `viaService` 零命中），这正是这个 bug 能长期漏网的原因。回归：574 通过 / 0 失败。
- **已知次要项**（本次未改，记录在案）：service 通道下只要传了 `overrides` 就计入待写键（不与现值比较），
  因此每次「一键配置」都会做一次幂等的 `settings.mutate`；无副作用，但可优化。

## 1.1.14 — 2026-10-02（自定义岗位走插件配置文件：新增 GET/POST /jobs）

> 触发：遗留核查（2026-10-02）。「核心配置」页新建的自定义岗位此前只活在**前端 React state**
> （`client/index.js` 的 `prev.custom.concat(...)`），关掉设置页或重启 DSH 后列表即消失；
> 而岗位**正文**一直是存住的（`POST /identity/save` → `MEMORY.md` 使用者身份条目）。
> 使用者指出：插件有**自带配置文件**机制，这类数据应落那里，而不是另建一套存储。

- **配置键 `customJobs`**（`lib/settings.js`）：JSON 字符串（数组语义用字符串是本库既有约定，
  见 `dsh-experts` 的 `enabledDomains`）。**刻意不加 `.volatile()`** —— 它不进设置表单，
  只作为该 profile 覆盖层里的持久化位。
- **两个端点**（`lib/api.js`，均为 exact 路由，已加入 `CORE_API_EXACT_PATHS`）：
  - `GET  /jobs` —— 返回自定义岗位列表（内存态：启动时由 config 解析，写入成功后同步）；
  - `POST /jobs { jobs, dryRun }` —— 整表写入设置用户层（`ctx.settings.mutate` + revision 栅栏），
    `dryRun` 默认 `true`；成功后更新内存态。**该键非 volatile → 重启后由 config 回落生效**。
- **解析容错**（`parseCustomJobs`）：非法 JSON / 形状不符 / 超限项一律丢弃，绝不抛（该值来自设置文件，可能被手工改坏）。
- **前端**（`client/index.js`）：初始化时 `GET /jobs` 水合 `custom`；此后**监听 state 变化自动写回**
  （而不在每个变更点手写，避免把副作用塞进 React updater）。首次水合完成前不写，防止空列表覆盖既有数据。
  另补 `useRef` 的降级定义（与既有 `useEffect` 同一口径，渲染替身环境不崩）。
- **回归**：集成体七套全绿（probe 151 / install 246 / settings-api 115 / identity 73 / defaults 61 /
  basedeck 570 / smoke-load 533，失败 0）。

## 1.1.13 — 2026-09-30（配置取值通道统一：不再直读宿主 settings.yaml）

> 触发：真机 0.2.0-rc.2 实测 `/basedeck` 八项**全部非绿**（`setupNeeded=true`）—— 记忆库路径、知识库路径、岗位信息在界面上都「读不到」。
> 根因**不在 rc.2**：计划器 `resolveDeckContext()` 自己直读 `<DSH_HOME>/settings.yaml`（1.1.4 起引入的旁路，ARCHITECTURE 2.5 有记），而 rc.2 已把该文件搬迁为 `settings.yaml.imported` → 旁路断供，全部回落默认值（记忆库被判成 `<DSH_HOME>/data/dsh-work-memory/memory`，于是 memorySeed / dirs / memoryDeck / migrateMemory 连带变红）。

- **读通道统一**：新增 `options.settingsValues` 注入（`lib/basedeck.js` `resolveDeckContext`）。设置生效值一律由 api 层 `deckSettingsValues()` 经**宿主设置服务**（`ctx.settings.describe` → `buildSettingsView`）取出后注入，与 `/setup-state` 同源；未注入时（脚本 / 单测 / 0.1.x 老调用方）才退回直读文件，并在 `ctx.settingsSource` 标 `'file'`。
- **只注入「设置里确实存在」的键**：保持「没配过」与「配了空值」（如 `obsidianSyncDir` 显式关闭镜像）的语义区分。
- **`settings` 项的状态语义**：走设置服务时不做文件级 BOM / 结构校验与文本级改写计划；状态由「是否仍有待写键」决定（有 → `update`，无 → `up_to_date`），`target` 显示「宿主设置（profile / 设置服务）」。
- **知识库根目录进配置**：新增集成体配置键 `obsidianDir`（`lib/settings.js` 的 `DEFAULTS` / schema、`lib/index.js` 透传 `installApi`、`lib/api.js` 注入计划器）→ `knowledgeDeck` 不再恒为 `none`；README 配置项表补 `workspace` / `obsidianDir` 两行。
- **岗位信息落配置文件**：profile 的 `cordis.patch.yml` 新增 `experts` entry 覆盖层（**写全 20 键**以兼容「整块替换」语义，避免 `expertInjectMax` / `expertSecondThreshold` 等刻意档位被打回默认值），其中 `defaultDomain: infosec`（本人岗位）、`identityExpert: ''`（刻意不常驻）、`expertSetupDone: true`（消除「还没确认本人岗位」的重复提示）。
- **修复（同日真机自查）**：`obsidianDir` 与 `repoRoot` 同属 **volatile 字段**，rc.2 的 `config` 里是**引用对象**；`lib/index.js` 取值时只有 `repoRoot` 走了 `unwrapValue()`，`obsidianDir` 漏解包 → 真机上该配置**看着配好却不生效**（现象：`knowledgeDeck` 恒为 `none`）。已按 `repoRoot` 同一条纪律解包并留痕。
- **指令模板去重（同日，使用者决议）**：语言 / 协作 / 专家库三节此前在「指令模板 + 记忆种子」两处重复维护，现由**记忆种子单一承担**；`defaults/AGENTS.zh-CN.md` 删同三节（68 → 39 行）并把 `template-version` 1 → 2（模板头约定：措辞实质变更时 +1）；`README.md`「默认约定」段改写为单一载体口径（并说明想让其在指令层生效需在使用者自己的 `AGENTS.md` 块外声明）。`scripts/basedeck-test.mjs` 断言迁移：不再写死 `template-version === 1`，并新增 3 条「真实模板不得含这三节」的护栏（basedeck-test 567 → 570）。
- **回归**：集成体七套脚本全绿（probe 151 / install 246 / settings-api 115 / identity 73 / defaults 61 / basedeck **570** / smoke-load 533，失败 0）。
- **写入分支已同批改到设置服务**：`POST /basedeck` 落盘前先经 `ctx.settings.mutate` 写入，再重算设置现值（`lib/api.js` 的 `writeDeckSettingsViaService()`）—— **不再触碰宿主 settings.yaml**。`agentsMd` / `skills` 的 `user_modified`（本地定制过）**保持不覆盖**（信息态，不计入 `setupNeeded`）。

## 1.1.12 — 2026-09-30（DSH 0.2.0-rc.2 桌面载体适配）

> 触发：真机实测（官方桌面端 0.2.0-rc.2）配置页点「自动生成」报 `生成失败：缺少 Origin 头`。

- **写操作同源守卫放宽**（`lib/api.js:240-263`）：原要求 POST **必须**带 `Origin` 头，而官方桌面端的 fetch 桥**不发 Origin** → 所有写操作 403（`/domain/generate`、`/identity/save`、`/preflight` POST、`/import/apply`、`/dirs/new`、`/fix`、`/install` 全线失败）。现改为「**不带 Origin 放行；带了则必须同源**」。
  **安全性未降**：浏览器发起的跨源 POST **一定**带 `Origin`（会被拒）；`Content-Type: application/json` 仍强制（挡住 form/multipart 类简单请求）；`Origin: null`（沙箱 iframe）仍按跨站拒绝 —— 浏览器侧的 CSRF 面**未扩大**。能连本机端口的进程本就可执行本地写操作，不构成新增攻击面。
- **`/repo-root` 纳入精确路由**（`lib/api.js:140`）：桌面壳的 fetch 桥**只认精确路由**，此前该路由仅在 prefix 下可达 → 桌面端「保存仓库目录」404。现加入 `CORE_API_EXACT_PATHS`（12 → 13 条），GET / POST 均可达。
- **测试断言同步**：`settings-api-test` 把「缺 Origin → 403」改为「→ 200 且**恰好** 1 次 mutate」，并**新增**「`Origin: null` → 403 且零写入」守住红线；`install-test` 新增两条 `/repo-root` 可达性回归；`apply()` 路由计数 25 → 26。

- **（已评估后撤回）守卫的 Host 检查顺序**：`verify` 的安全复核建议把 `if (!host)` 提到 `if (!origin)` 之前，以消除「无 Origin 且无 Host 时跳过 Host 检查」。实测采纳该改动会让**不带 Host 头的请求**一律 403，而测试夹具正是这类请求 → `basedeck-test` 直接抛 TypeError；而 HTTP/1.1 请求**必然**带 Host，原风险实际为零。**故不采纳**，保持 `if (!origin) return null` 在前的原顺序（`verify` 本人也标注该建议为「可选、非阻塞」）。

## 1.1.11 — 2026-09-30（DSH 0.2.0-rc.2：设置注册迁移到 Config 派生）

> 触发：0.2.0 移除了 `ctx.settings.register`，集成体设置页在 rc.2 下失效（条目不可见、不可读写）。

- **具名导出 `Config`**：`lib/settings.js` 导出 `Config`（即原 `WPS_SETTINGS_SCHEMA`），由 `lib/index.js` re-export。rc.2 的设置系统从 `plugin.Config` 派生表单（`vendor/cordis/src/registry.ts:326` → `packages/settings/settings/src/index.ts:425-428`），命名空间即 profile entry id `work-personal-secretary`。
- **`repoRoot` 加 `.volatile()`**：rc.2 只把带 volatile 的字段投影进设置表单（`settings/src/schema.ts:37-47`）；整棵 schema 无 volatile 时 `describe()` 直接返回空（`settings/src/index.ts:308-309`），条目**根本不出现**。
- **解包 volatile 引用**：rc.2 下 `apply(ctx, config)` 里 volatile 字段是**引用对象**（官方判定见 `vendor/cosmokit/src/volatile.ts:52-54`）。新增 `unwrapValue()`，用官方同协议 `Symbol.for('cosmokit.volatile.write')` 判定后 `.get()`（**不引新依赖**，且不像结构判定那样误伤 `Map` / 普通 `{get}` 对象）；`toConfig` 与 `index.js` 的两处 repoRoot 读取都走它。
- **双分支兼容**：`ctx.settings.register` 存在时保持 0.1.x 旧行为（`scope.get()` / `scope.watch`）；不存在（rc.2）时取值改用 `apply` 传入的 config。
- **读取实时解包**：rc.2 的 volatile 由 loader **就地更新**（`vendor/loader/src/config/entry.ts:162-195` 的 `_commitVolatile()` → `updateVolatile(ref, source)`），**既不重跑 `apply`、也不重启 fiber**；因此分支 B 的 `read()` 必须**每次实时重算**，不能缓存 apply 时快照（否则设置页写入后，插件内部的 `settingsRepoRoot()` 会永远读到旧值，安装页继续报「未找到集成体仓库目录」）。
- **`.volatile()` 特性探测**：`.volatile()` 是 schemastery **3.18.3** 才引入的方法，而本包 peer 下界是 `^3.18.1`；该 schema 在**模块顶层求值**，直接调用会在 3.18.1 / 3.18.2 宿主上抛 TypeError（外层 `try/catch` 只包 `await import()`，接不住），导致**整个插件加载失败**。新增 `withVolatile()` 探测后按需调用；宿主不支持时该字段退化为普通字段（不进设置页，但不崩）。
- **`Config` 在 schemastery 不可用时为 `undefined`**（**不能是 `null`** —— rc.2 的判据含 `'toJSON' in schema`，对 null 会抛 TypeError）。

## 1.1.10 — 2026-09-30（DSH 0.2.0-rc.2 兼容：peer 范围放宽）

> 触发：官方 0.2.0-rc.2 引入**插件兼容性闸门**（`packages/boot/app-boot/src/plugin-compatibility.ts:61-88`）。peerDependencies 中匹配 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项若不满足运行时版本，该 bundle 会被跳过（bundle 级 `skippedBundles`）或被单独 disable（行级 `compatibility-preflight.ts`），patch 层不加载。

- **peer 范围放宽**：4 条 `@deepseek-ai/dsh*` 由 `^0.1.5-rc.1` 改为 `>=0.1.5-rc.1 <0.3.0`（`package.json:66-69`）。旧范围按 semver 展开为 `>=0.1.5-rc.1 <0.2.0-0`，**拒绝 `0.2.0-rc.2`**；新范围同时满足 `0.1.5-rc.2`（现网运行时）与 `0.2.0-rc.2`（新版）。`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 不在闸门检查范围，不动。
- **`BUILD` 常量同步**：`client/index.js:45` 由 `v1.1.9` 改为 `v1.1.10`（`scripts/smoke-load.mjs` 断言它与 `package.json` 同步）。
- **验证**：本机 semver 7.8.5 复现闸门判定 —— 新范围对 `0.2.0-rc.2`、`0.1.5-rc.2` 均为 true，旧范围对 `0.2.0-rc.2` 为 false；七个自测脚本修正 BUILD 后全部通过。
- **未做（留待第二批）**：`ctx.settings.register` 在 0.2.0 已移除 → rc.2 下设置页静默失效（插件功能本身不受影响，`inject` 与其余 API 面兼容）。完整方案见项目文档 `RC2-ADAPTATION-PLAN.md`。

## 1.1.9 — 2026-09-18（随包说明与实现对齐：14 处不一致修订）

> 触发：使用者指出「PPT 母版那段描述不对」。据此对两份随包说明做了一次**实现级复核**（子代理逐条比对 + 主对话复核载重结论），共修 **14 处**；两份 HTML 已按 md 重生成。

### 一、数字与事实类（确认错误，已改）

- **PPT 规格分类**（`use.zh-CN.md:188` / `:202`）：原写「这**四套**只用于 Word 与表格」「这**七套**只用于演示 PPT」—— 把三格式共用的基准套 `standard` 算进了「专用套数」。按真相源 `dsh-doc-suite/specs/*.json` 的 `for` 字段改正为：**govdoc / compact / report 三套**专用 Word 与表格；**graphite / teal / wine / dusk / azure / crimson 六套**专用演示。
- **配置链步数**（`install.zh-CN.md:176`）：「点保存后**四步**依次打勾」→ **六步**（与 `BASEDECK_APPLY_ORDER` 及 `use.zh-CN.md` 一致）。
- **自动备份频率**（`use.zh-CN.md:135`）：「每次写库后复制一份」→ **写库时触发、但每天至多一次**（`dsh-work-memory/lib/backup.js:7,45-49`）。
- **删去两项并不存在的能力**（`use.zh-CN.md:167` / `:169`）：Excel 的「条件格式」（`scripts/` 全目录零命中）；PDF 的「取图片」「读书签与元信息」（`pdf/pdf_tool.py` 无对应子命令，`info` 只出页数与文件元数据）→ 已从说明中删去，只保留确有的能力。
- **扫描件行为**（`use.zh-CN.md:226`）：原写「它会把那几页转成图片给你看」，实际只**提示**哪几页是扫描件、转图需另做 → 已按实际改写。
- **工具文件夹**（`use.zh-CN.md:444-446`）：原写「本版只有框架、不做同步」，而 1.1.7 起已随包写入 `00_工具总览.md` 与 `工具/技能/DSH与插件使用技巧.md` → 已改写为「已随包两份内容，持续同步仍未实现」。

### 二、口径与措辞类（已改）

- **母版路径的边界**（`use.zh-CN.md:215`）：补写实情 —— 走母版时**只自动套第 1、2 个版式**（标题页／内容页），其余 9 个版式需在 WPS 里新建页时自选；「十几类页型成套出稿」走的是**不套母版**的另一条渲染路径。
- **环境依赖名称**（`use.zh-CN.md:49` · `install.zh-CN.md:172`）：「Python 依赖」→ 与探针页面一致的「**Python 依赖库**」（`lib/probe.js:39`）。
- **专家域举例**（`use.zh-CN.md:20` · `install.zh-CN.md:14`）：「法务」→「**劳动法**」（19 位专家中无法务条目，只有 `hr-labor-law`）。

### 三、随包件内部矛盾（本次查出的硬伤）

- **授权口径自相矛盾**：`dsh-doc-suite/skills/office-ppt/SKILL.md:236` 仍写 `redistributable: false`，而 `assets/manifest.json` 的 `templates` 段早已按使用者 2026-09-18 的裁定改为 `true`。**已对齐**（SKILL 改为 `true` + 用途限定）；`dsh-doc-suite/CHANGELOG.md` 的 0.7.15 历史条目**补注**口径被推翻的说明（不改历史结论，只加后续事实）。

### 验证

- `defaults-test` **59 通过 / 0 失败**（含 md ↔ HTML 逐字节同源、发布件禁用串自检）
- 两份 HTML 由 `scripts/build-defaults-html.mjs` 按 md 重生成
- `dsh-doc-suite` 五套回归：**24 / 19 / 26 / 13 / 7**（全 0 失败）

### 四、本机写入包（开局包）· 同期一并交付（**版本号不升**，并入本版）

> 起因：审计发现**「该写没写」会被静默吞掉** —— `planSkills` 在 `skillsSourceDir` 为空（repoRoot 解析失败）时判成 `up_to_date`，界面显示「共 0 个技能：一致 0 / 缺失 0」，使用者与引导都看不出问题。本次改为把「该写的内容」**原样落到存储根**，并在**项目记忆**里挂待办。

- **落点**：`<存储根>/开局/`（存储根由 `inferRootDir(memoryDir, obsidianDir)` 反推；**推不出不猜** —— 记 `broken` + 可读原因并保留待办）
  - `后置优化包/`：`怎么用.md`（源 `defaults/starter-readme.zh-CN.md`，面向使用者）+ `AGENTS.md`（指令层标记块）+ `清单.json`
  - `记忆库/`：`MEMORY.md`（身份占位 + 种子条目）、`USER.md`、`GRAPH.json`、`PROJECTS/工作秘书.md`、`PROJECTS`/`DAILY`/`ARCHIVE`
  - `知识库/`：`🏠 主页.md`、`工具/00_工具总览.md`、`.obsidian/app.json`、`工具/技能/DSH与插件使用技巧.md`、`00_全局记忆/`、`工具/{技能,脚本,MCP}/`
  - `技能/`：5 个 `SKILL.md`（源 `dsh-doc-suite/skills/`）
- **机器可读核查清单 `清单.json`**（**运行时生成**，非模板文件）：逐项 `{id, src, dst, mode}`；`dst` **只用 4 个占位符**（`{{workspace}}` / `{{memoryDir}}` / `{{obsidianDir}}` / `{{backupDir}}`），**不含任何本机绝对路径** —— 同一个包在任何机器上都成立。`mode` 五种：`file` 逐字节 · `block` 只比 `wps` 标记块区间 · `entry` 单条条目 · `entry-set` 一组条目 · `dir` 存在即可。
- **核查回路**：新增只读导出 `verifyStarterPack()`，逐项判 `missing` / `match` / `differs` / `kept` / `broken`；**`differs` 不覆盖**（可能是使用者改过），只在 `confirmed.json` 里记 `kept`。
- **项目记忆待办**：`PROJECTS/工作秘书.md` 新增第五段 `【待写入·本机】`（`tag=关键`，每轮必现，正文指向 `清单.json`）；沿用「只补缺失、不覆盖」，**核查全部通过后摘除**。
- **并入现有步、ABI 不变**：落包并入 `dirs` 步（`planDirs` / `applyDirs`），记忆库内容并入 `memoryDeck` 步 —— **`BASEDECK_ITEMS` 仍是八项，顺序与下标一字未动**。
- **缺源一律显式失败**：源文件读不到 / 带 BOM / 存储根反推不出 → `state='broken'` + 中文可读原因，`apply` 层**零文件写入**，绝不判 `up_to_date`。
- **一处设计取舍（已复核同意）**：存储根反推失败时，`dirs` 步的 `apply` 仍返回 `ok:true`（工作目录该建照建），只把 `starterStatus` 置 `broken` —— 不误报「连目录都没建成」，同时把真相显式暴露。
- **读数**：`basedeck-test` **567 / 0**（原 500 + 新增 67）· `defaults-test` **61 / 0**（原 59）· `smoke-load` 533 · `probe-test` 151 · `install-test` 244 · `settings-api-test` 112 · `identity-test` 73（全 0 失败）· `check-undefined` TS2304/TS2552 = 0。

### 未处理（如实标注）

- 退出码语义（`3` = 零改动断言失败 / `2` = 参数或输入校验不过 / `5` = 缺字体）**未写进面向非技术使用者的说明** —— 属刻意取舍，技能文档里已有完整语义。
- `dsh-mermaid`（图表插件，第三方上游 npm 包 0.4.0）**在本仓库没有 tag/release** —— 文档未对外承诺「五个子插件随本仓库发版」，故本次只记录事实、不改口径。

## 1.1.8 — 2026-09-18（发布前中立性整改：随包件私有信息清零）

> 这是 **RELEASE-CHECKLIST 第二节「中立与隐私」** 的一次全面回归修复，**不改变任何功能行为**；同批处理五个模块，版本一律 +1 patch。

- **怎么发现的**：发布前对「随包件」（各模块 `package.json` 的 `files` 白名单）做私有信息扫描。清单第二节此前打勾基于 2026-09-13 的扫描，**此后新增的注释与说明文本未再复扫** → 本次补齐，并把「扫随包件、含注释与夹具」固化为每次发布的必跑项。
- **私有盘符路径清零**：随包文件里的私有工作区绝对路径归零 —— 随包 CHANGELOG 里的样张 / 备份路径改为 `<工作区>\…`；本体测试脚本的夹具路径改用通用占位（`E:/work` / `E:/vault` 等）。
- **私有称呼 → 「使用者」**：`scripts/basedeck-test.mjs` · `identity-test.mjs` · `settings-api-test.mjs` · `smoke-load.mjs`（注释与断言标题）与本文件历史条目。
- **私有助手名**：`defaults/AGENTS.zh-CN.md:37` 的私有名 → 「助手」。
- **模板里的条件分支去私有化**：`scripts/basedeck-test.mjs` 的「真实跨盘」正向断言原以「本机存在私有工作区目录」为运行条件 → 改为「Windows 且 `process.cwd()` 与系统临时目录**不同盘**」，改用运行期路径而非硬编码私有路径（覆盖不降反稳：CI/Linux 仍走跳过分支）。
- **`.gitignore` 修复**：第 23 行原是一条**非法 UTF-8 残行**（历史编码事故，`tools.read` 直接拒读该文件），已重建为可读中文注释。
- **保留的例外（有意为之，清单登记）**：三处测试脚本的私有名黑名单数组（`smoke-load.mjs:134` · `probe-test.mjs:550` · `defaults-test.mjs:44-47`）**不删** —— 它们是**反面断言**（"这些词不得出现在随包文案里"），删掉即失去守卫。
- **同批校对（文档-实现一致）**：本文件 1.1.7 段写的技巧正文条数「64 条」与实物不符 → 更正为 **72 条 / 8 类**（实测：`defaults/vault-tips.zh-CN.md` 条目编号 1–72、分类一~八）。
- **验证**：`node --check` 改动 JS **8/8** · JSON **5/5** · `py_compile` **4/4**；本体七套自测 **smoke 533 · probe 151 · install 244 · basedeck 500 · settings-api 112 · identity 73 · defaults 59**（全 0 失败）。
- **回退**：纯文本整改，回退即把版本号改回 1.1.7 并检回上一提交；无接口、无数据格式变化。

## 1.1.7 — 2026-09-18（知识库「工具/技能」自动写入随包技巧正文 + 全局记忆指针 + 随包路径修正）

> **同批修正（2026-09-18）**：指令层模板 `AGENTS.zh-CN.md` 与记忆种子 `global-memory.seed.md` 原放在**仓库根 `defaults/`**（在包外，`files` 白名单无法覆盖）——npm / 复制安装形态下 `agentsMd` 与 `memorySeed` 两项**实测 broken**（「找不到指令层模板 / 找不到记忆种子文件」）；本机因为是 junction 指回源码树才一直没暴露。已把两份文件 `git mv` 进**本模块 `defaults/`**（与说明文档、技巧正文同处），`lib/basedeck.js:943-946` 的两条默认路径改为 `join(moduleDir, 'defaults', …)`，并同步 `scripts/basedeck-test.mjs` 的 `realTpl` / `realSeed` 与 README / RELEASE-CHECKLIST / ARCHITECTURE 的路径口径。**收益：npm / 复制 / 仓库三种形态全部可用。**

**背景**：发布版使用者的知识库里，「工具/技能」目录此前只建空壳；而放在安装目录里的说明文档**不会被使用者发现**。使用者 2026-09-18 定：正文由**配置底座自动写入知识库「工具/技能」**，全局记忆里放一条**指针**。

- **新增随包正文** `defaults/vault-tips.zh-CN.md`（**72 条 / 8 类**）：每条标**来源性质**（官方规定 / 本机实测 / 本项目自研约定），版本敏感条目带 `⚠️ 版本敏感`；开篇固定四行元信息（版本基线 · 开发者预览与破坏性变更 · 安全说明要点 · 官方文档站）。内容按官方 master（`@deepseek-ai/dsh-root 0.1.6-alpha.2`，核对日 2026-09-18）逐条校正，**去本机私有**（盘符、称呼、代理端口一律不出现，路径用占位符）。
- **配置底座 step 5（`knowledgeDeck`）新增一个文件**：把上述正文写到 `<obsidianDir>/工具/技能/DSH与插件使用技巧.md`，复用既有「已存在即保留不覆盖」的幂等逻辑与严格读取/冲突判定；**未新增第九项、未改动 `BASEDECK_ITEMS` 的顺序与下标**（既有调用方按下标取项的行为不变）。
- **配置底座 step 3（`memorySeed`）新增一条指针**：`defaults/global-memory.seed.md` 追加「【工具与技能】…见知识库「工具/技能」目录下的 DSH与插件使用技巧.md」。指针先落盘、正文后落盘（step 3 → step 5），两者都幂等；中途失败**重跑一键配置即可自愈**；**指针文案不校验正文是否存在**。
- **测试**：`basedeck-test.mjs` 新增/改写断言 —— 干跑计划含新目标、落盘逐字节与 SHA256 与源一致、幂等（二次执行零字节）、同名位置被占用时 `broken` 且 apply 层拒写（中文原因）、`BASEDECK_ITEMS` 顺序与下标未变；种子条目断言按新增指针同步（3 → 4 条）。读数：**500 通过 / 0 失败**。
- **顺带修正**：`ARCHITECTURE.md` 中 `planKnowledgeDeck` / `fileExists` 等**行号引用按改动后实测更新**（原引用已有 ±20 行漂移）。

**回退**：删除 `defaults/vault-tips.zh-CN.md`；删除 `lib/basedeck.js` 的两个 `VAULT_TIPS_*` 常量与 `planKnowledgeDeck` 内的 tips 段；回退 `scripts/basedeck-test.mjs` 的对应断言；删除 `defaults/global-memory.seed.md` 的【工具与技能】指针；本文件删本段；版本改回 1.1.6。

## 1.1.6 — 2026-09-17（T5-4 配置收尾补一次镜像同步 · T5-5 导入卡复核提交）

- **T5-4「一键配置跑完镜像区仍为空」**：镜像同步（`syncMemoryToObsidian`）原本只在 work-memory 的三条写路径（remember / link / 冷召回转热）后触发，「一键配置」不经过它们，于是使用者跑完六步后知识库里的 `00_全局记忆` 仍是空的。现补一次收尾触发：
  - 新增 `lib/mirror-sync.js`：`syncMirrorBestEffort()` 在执行链**最后一步**（`POST /identity/save` 真写成功）后同步一次；`dryRun` 不触发；找不到实现 / 同步失败一律降级并回可读 reason，**不改变本次写入结果**。
  - **入口怎么选（实测三条路）**：不用裸包名 `import('dsh-work-memory')`（集成体零依赖，repo 直跑解析不到该包）；不导 `lib/index.js`（其顶层 import 宿主 peer `@deepseek-ai/dsh-tools`，集成体侧无法保证可解析，实测 `ERR_MODULE_NOT_FOUND`）；最终按候选目录（profile → repo → bundled）加载 `lib/backup.js` —— 该文件只用 node 内置，且与本体同仓库、同批次发布。
  - `lib/setup-state.js` 新增只读 `readObsidianSyncDir(ctx)`：取 `work-memory.obsidianSyncDir` 的**原值**。`/setup-state` 返回的 `obsidianDir` 是**反推出来的知识库根**（供页面展示），与同步函数要的镜像目录不是一个东西。
  - `POST /identity/save` 响应新增 `mirror` 字段（`{ok, skipped, source?, files?, pruned?, reason?}`；只回数值与枚举，不回路径）。
- **T5-5 导入卡（子代理交付，复核后随本版提交）**：`scripts/basedeck-test.mjs` 的 ⑫ 段改用独立夹具（修掉夹具复用导致的 CI 三条红），节号重排 `[25]`（T5-7 段改 `[26]`）；`scripts/smoke-load.mjs` 新增 `[21]` 导入卡端到端 20 条断言；路由计数口径 24 exact + 1 prefix = 25。
- **文档**：`ARCHITECTURE.md` 文件表补 `lib/mirror-sync.js`、`npm run check` 覆盖 13 → 14 文件、3.7 删去已落地的「旧知识库导入」与「记忆镜像的实际同步」两项。
- ⚠️ 需重启 DSH（`lib/**`、`client/**` 变更）。

## 1.1.5 — 2026-09-17（静态检查进 CI · profile 探针 · 目录布局识别 · 桌宠测试进 CI）

- **T5-2 未定义标识符静态检查**：新增 `tsconfig.checkjs.json` + `scripts/check-undefined.mjs`，补 `node --check` 抓不到的「引用了本文件既未声明、也未 import 的名字」（只认 TS2304 / TS2552）。只读、零第三方依赖；本机找不到 tsc 时**跳过放行**（不把没装 tsc 的人弄红），CI 用 `--require-tsc` 判失败。**上线当天即抓到两处真缺陷**——本轮 T5-7 开发中 `lib/basedeck.js` 少 `existsSync` import、`lib/api.js` 少 `detectVaultLayout` import，`node --check` 全部放行。`package.json` 加 `check:undefined`。
- **T5-3 profile 同步探针**：新增 `scripts/profile-sync-check.mjs`（按各模块 `files` 白名单逐文件 SHA256；Junction 判 LINK；退出码 0/1/2）与 `npm run profile:check`（刻意**不进** test 链——它依赖本机 profile）。
- **T5-7 目录布局识别**：新增 `detectVaultLayout()`（纯函数、可注入 fs 便于单测）：根下存在 `memory-data`/`obsidian-data` → `new`；根上直接有 `🏠 主页.md`/`00_全局记忆` → `legacy`；两者都有 → `mixed`。`GET /setup-state` 增 `vaultLayout` 字段，核心配置页在 `legacy`/`mixed` 时给出提示与搬迁指引。`basedeck-test` 新增 `[24]` 段 9 项断言。
- **CI 两步**：①「未定义标识符静态检查」（全局装 typescript + @types/node，用 `DSH_TSC_ROOT`/`--typeRoots` 指到全局）；②「workspace-tokenpet 独立测试」——实测该测试**不需要 tsx**（`node --test` 直接 exit 0，只用 node 内置 + `lib/skins.js`），故并入既有的「不装包」设计。
- **文档**：`dsh-experts` 三条口径滞后修正与私有路径脱敏（`docs/` 下 4 个文件，全 6 模块清零）；`workspace-tokenpet` 按实测修正版本基线 / 行数 / 体积口径（详见其 1.0.3 段与交接文档 §11.8）。
- ⚠️ 需重启 DSH（`lib/**`、`client/**`、`defaults/**` 变更）。

## 1.1.4 — 2026-09-17（随包说明补齐 · 文档-实现一致性修复 · 模块说明）

- **随包说明重写（面向使用者视角 · 2026-09-17 第二轮）**：使用者指出原稿偏技术、且安装缺「不想敲命令的人怎么装」这条路 → `install.zh-CN.md` 重写为**新用户指引**（88 → 211 行）：新增「先弄清楚装什么、装完能做什么」「动手前确认三件事」「**两种安装方式并列**」（方式一＝复制一段提示词交给 DSH、由它安装；方式二＝手动敲命令）、依赖与环境安装同样双路径（Python / 八个包 / WPS 各给两种）、装完六项自查表、七条排障；`use.zh-CN.md` 重写为**非技术读者版**（59 → 247 行）：每个能力给「以前怎么做 / 现在怎么做」对照与可直接照说的例句、按功能分组讲设置项、十二条 Q&A、数据留存与卸载。两份 HTML 由 `scripts/build-defaults-html.mjs` 重生成（`defaults-test` 59/0）。

- **随包说明补齐（第一轮）**：`defaults/use.zh-CN.md` 新增「四、目录与镜像」（存储根派生 / 目录选择三条路 / 导入卡只管知识库 / 镜像何时被填 / 工具目录只有框架）；`defaults/install.zh-CN.md` 新增「六、升级与排障」（子插件升级走临时目录+SHA256+原子替换 / 记忆库换目录免重启需 work-memory ≥1.0.6 / 七套自测脚本）；HTML 按 md 重生成（`defaults-test` 59/0）。

- **文档-实现一致性**（本轮核查逐条修）：`defaults/global-memory.seed.md` 的【专家库】条目仍写「常驻只有一位身份专家」→ 改「默认一位都不常驻」；`lib/index.js` 的 `SUB_PLUGINS` 同口径修正；`lib/api.js` 路由计数注释 17/18 → **22/23**（2026-09-17 复核）；`lib/basedeck.js` 注释「basedeck 自己不读 settings.yaml」与实现矛盾 → 改「两条口径并存」；`.github/workflows/ci.yml` 的通过数注释 → 指向 `TEST-MATRIX.md` 并写 2026-09-17 实测值。

- **新增**：`ARCHITECTURE.md`（维护者向：架构 / 数据流 / 对外接口 / 回退与恢复）；根 `TEST-MATRIX.md`；`package.json` 补 `test` 脚本。

- ⚠️ 需重启 DSH（`lib/**` 与 `defaults/**` 变更）。

## 1.1.3 — 2026-09-16（设置界面改版）· ⛔ **本版不发布**

> **发布状态（2026-09-17 使用者裁定）**：本版**不发布**。代码与文档已完成、七套脚本全绿，迭代过程中也做了真机验收，但使用者判定「目录模型这次只定义为测试」，本机不采用新布局、工作区整体重建留待另择时间做。
> **本节之下的内容按「已实现但未发布」读取**：接口与行为描述与代码一致（提交见 `git log`，`main` 分支未打 tag、未推送），只是不作为发布版对外。

### 变更

- **客户端四页签**：安装与检查 / 核心配置 / 配置 / 关于与致谢；「能力配置」改名「配置」（英文 Settings）；删掉四步进度条；首屏描述改写为「检查运行环境、安装五个子插件、完成首次配置，并集中调整各子插件的设置」。
- **安装与检查页**：「查看安装引导 / 使用说明」按钮组置顶；环境依赖 6 项 + 子插件 5 项；新增「依赖安装工具」卡（逐项 `POST /fix`、兜底 `POST /fix-all`、不可代执行项只给复制命令、WPS 许可提示）。主按钮的「N 项待处理」只计硬项（DSH 宿主 / Node.js / Python / Python 依赖 / WPS Office），Obsidian 标「可选」，未装不再计入待处理。
- **核心配置页（新）**：三项门禁 —— 记忆库子插件已装 · Python ≥ 3.10 · 8 个 pip 包（记忆库目录**不参与**判定）；不满足时整页灰化并逐项给出状态，满足后自动解锁。
  字段改为**存储根目录**（使用者唯一要先选的目录，唯一必填、带「浏览…」）+ **由它派生的**记忆库目录与 Obsidian 知识库目录（默认只读、标注「自动：存储根目录/」；点「单独指定」才可编辑，编辑后可点「跟随根目录」回到派生值）+ 工作岗位（5 个预置岗位 +「都不是（新建岗位…）」，无「通用职能」）。
  派生子目录名 `memory-data` / `obsidian-data` 由宿主 `lib/basedeck.js` 的 `ROOT_SUBDIR_MEMORY` / `ROOT_SUBDIR_VAULT` 定义，经 `GET /setup-state` 的 `rootSubdirs` 下发（客户端不硬编码）。既有配置若不是这套布局，根目录留空、两个目录原样显示为「已单独指定」，**绝不改写使用者路径**。
  点「保存配置并开始」执行**六步链**：可用性检查（只读 preflight）→ **迁移旧记忆库** → 建立记忆库目录（memoryDeck）→ 建立知识库目录（knowledgeDeck）→ 建立两者关联（写 `settings` 的 memoryDir 与 obsidianSyncDir=`<obsidianDir>/00_全局记忆`）→ 写入岗位身份。
  **迁移在建立结构之前**：迁移逐文件只补缺失、目标已有同名文件一律保留目标，先建库会先写出 `MEMORY.md` / `USER.md` / `GRAPH.json` / `PROJECTS/工作秘书.md`，迁移随即把这四个全部跳过（实测：目标为空 copies=4；先建库后 copies=1 / conflicts=3）。
  任一步失败停在该步、保留已完成成果、可幂等重试；六步全绿后出现**旧知识库**导入引导卡（该卡**只管知识库** —— 记忆体已在第 1 步自动迁完，卡上不再提，避免「记忆还要再搬一次」的错觉）。目录模型为「一个存储根目录 + `memory-data` / `obsidian-data` 两个兄弟目录」；**知识库只新建、不搬迁**（已有 vault 原样不动，要搬须使用者逐项指定对照；导入引导卡目前只有入口 + 纪律说明 + 清单占位），**只有记忆体自动迁移**。
- **配置页按决议 12.1 收窄**：记忆库 5 常显 + 8 高级、专家库 5 + 5、文档能力 4 + 5；**未放出的 22 键不再渲染**（仍在 `settings.yaml` 与 profile 覆盖层可配）。草稿与 409 保留输入的机制不变。
- **宿主侧新增能力**：
  - `lib/basedeck.js` 新增两个结构生成器 —— `memoryDeck`（记忆体结构：PROJECTS / DAILY / ARCHIVE 骨架 + `MEMORY.md` 的「使用者身份」占位 + USER.md / GRAPH.json + `PROJECTS/工作秘书.md` 四条）与 `knowledgeDeck`（知识库结构：🏠 主页.md + 00_全局记忆 + 工具/（`00_工具总览.md` + 技能 / 脚本 / MCP）+ .obsidian 最小配置；**`工具/` 本版只建目录与总览，未实现同步** —— 三个子目录现在是空的，总览里写的是预留用途，自动同步未立项，见仓库根 README）；只补缺失、不覆盖，写前备份、写后校验、失败回滚。
  - `GET|POST /work-personal-secretary/api/preflight`：可用性检查（只读）—— 环境就绪 / 两目录路径合法可写 / 同工作区 / 目标无冲突。**「目标无冲突」只提示、不阻断**（`block` → `warn`，与「跨盘」同口径，不参与 `ready` 判定）；按 `relationOf` 的三个方向分开给文案（`same` / `memory-in-obsidian` / `obsidian-in-memory`，另加相互独立的 `separate`），每条都写明后果与「不阻断」。执行链把 `warn` 项一并带进成功步骤的详情。
  - `GET /identity`、`POST /identity/save`：把岗位整条写入「使用者身份」条目（按正文前缀定位；命中 0 条追加、1 条改写并保留原 id、多于 1 条拒绝）；与 `dsh-work-memory` 共用 `.work-memory.lock`；改写按区间切片替换，写后逐字节校验其余内容未变；含「助手人设」的条目不动。
  - `GET /domain/list`、`POST /domain/generate`：5 段预置岗位身份正文 + 生成通道（`promptEnhancer` 优先 → 回退 `llm` + `agentDefaultModel` → 都没有时 503 可读提示，前端改为手填）；`purpose` 为 `work-personal-secretary-domain`。
  - `GET /setup-state`：核心配置页的宿主侧初值（既有 memoryDir / obsidianDir / domainId 等），并**反推「存储根目录」**（两个目录正好是同一父目录下的 `memory-data` / `obsidian-data` 时才给，推不出留空）；`rootSubdirs` 在这里下发。
  - `GET /dirs`、`POST /dirs/new`：目录浏览 —— `ctx.directoryPicker` 的 browse / native 能力分支代理；`GET` 列一层目录、`POST` 在父目录下建一层子目录；native / 缺服务 / 未知能力都是**可读降级**（不抛异常、不 500）。
  - `GET /docs`、`POST /open-doc`：随包说明 HTML 的取回与「用系统默认程序打开」（脚本白名单查表，**不接受路径入参**）。
  - `lib/md.js`：Markdown → HTML（零依赖、输出转义、链接白名单；拒绝 `javascript:` 与 `//` 协议相对地址）。
- **随包说明网页**：`GET /work-personal-secretary/guide`（安装引导）与 `/help`（使用说明）直出 HTML；正文与 `defaults/install.zh-CN.md`、`defaults/use.zh-CN.md` **单一真相源**（同一份 md 也写入 `PROJECTS/工作秘书.md` 的前两条）。新增 `?embed=1` 片段形态（无 html / head / body，样式作用域到 `.wps-doc`），供设置页页内展开；不带 `embed` 仍是完整文档。
- **行为变更（调用方注意）**：`GET/POST /work-personal-secretary/api/basedeck` 的 `items` 由 **5 项变为 8 项**（末尾追加 `memoryDeck` / `knowledgeDeck` / `migrateMemory`，既有五项顺序不变）；**不带 `ids` 的缺省调用现在会写 8 项**（旧行为只写 5 项）。若调用方依赖旧缺省集合，请显式传 `ids`。
- **同版审查返工**：身份写入的「其余条目逐字未变」校验不再恒真（改为区间切片 + 逐字节比对）；写记忆库目录的路径统一取 `.work-memory.lock`（含既有记忆种子写回）；所有落盘路径统一走写目标护栏（拒绝用户主目录 / 非绝对路径 / 不可写 / 同名文件占用）；`GET /identity` 补只读同源守卫并把可读范围限制为配置的记忆库目录或其子路径；临时文件加随机后缀；`md.js` 拒绝 protocol-relative；同步锁等待上限收紧到 1 秒并新增异步锁（等待时让出事件循环）。
- **桌面外壳兼容**：新增的 JSON 路由与 P4 三条能力配置路由已注册为**精确路由**（exact），桌面载体（合成 origin）的 fetch 桥下不再 404；**精确路由集合 22 条 + 1 条 prefix（`apply()` 注册总数 23）** —— 出处 `lib/api.js` 顶部注释：`API_PATHS`(7) + `PAGE_PATHS`(2) + `CORE_API_EXACT_PATHS`(10) + `SETTINGS_API_PATHS`(3)。属内部接线，接口路径与响应体均未变。

### 验证

- `node --check` **12 个文件 0 失败**（覆盖范围 = `package.json` 的 `scripts.check`：`lib/` 的 index · probe · api · install · basedeck · md · preflight · identity · domain · setup-state · dirs ＋ `client/index.js`）
- `scripts/smoke-load.mjs` **513 通过 / 0 失败** · `scripts/probe-test.mjs` **149 / 0** · `scripts/install-test.mjs` **244 / 0** · `scripts/basedeck-test.mjs` **415 / 0** · `scripts/settings-api-test.mjs` **112 / 0** · `scripts/identity-test.mjs` **64 / 0**（本版新增） · `scripts/defaults-test.mjs` **59 / 0**（本版新增，含随包说明的敏感过滤自检） · `modules/dsh-work-memory/scripts/regression.mjs` **87 / 0**
- 安装到 profile 后需**重启 DSH** 才加载宿主侧改动；客户端改动刷新页面即可。

> 注记：本段**之下**仍保留 `## 1.2.0 — 未发布` 段。**2026-09-17 定稿：1.1.3 与 1.2.0 均不发布**，版本脉络不再有争议；将来若要发布，先决定这两段如何合并或先后发布。

## 1.2.0 — 未发布（子模块独立化：桌宠 → `workspace-tokenpet`）

### 变更（破坏性）

- **子模块换名换 id**：`modules/dsh-token-pet` → `modules/workspace-tokenpet`；包名与插件运行时 id 统一为 `workspace-tokenpet`；版本 `0.2.1-lina.1` → `1.0.0`。安装器白名单（`SUB_PLUGIN_IDS`）、探针（`SUB_PLUGIN_NAMES`）、本体模块清单（`SUB_PLUGINS`）、客户端安装顺序与安装元数据、设置页跳转分区 id（`CFG_PET_SECTION`）同步更名。
- **运行时数据目录**：新址 `~/.dsh/data/workspace-tokenpet/skins/`（新址优先、只补缺失、绝不覆盖）；新增**旧址迁移** —— 新址缺套装而旧址 `~/.dsh/data/dsh-token-pet/skins/` 有同名套装时复制迁移，旧址数据保留、单套失败不影响安装结果。
- **`lib/install.js`**：`deployPetSkins()` 增加 `legacyDir` 入参与 `migrated[]` 结果字段，安装回显新增「已从旧址迁移 N 套」；`describePetSkins()` 一并展示。常量集中于 `lib/install.js` 与 `lib/basedeck.js`。
- **`lib/basedeck.js`**：`PET_SKINS_SUBDIR` 指向新址（配置底座报告/创建的素材目录随之更新）。
- **能力配置页**（`client/index.js`）：专家库小节新增 `expertInjectDetail`（下拉 auto / card / full）与 `expertInjectBudgetChars`（滑块 200–4000），中英文字典同步；`select` 渲染支持字段自带选项；`lib/settings-api.js` 的 `EXPERTS_CONFIG_FALLBACK` 补齐两键。
- **性质口径**：新增第三种性质「**独立项目模块**」（安装器 `kind`、客户端 `nature: 'standalone'` + `natureKey()` 第三态、中英文案与品牌色徽章），`workspace-tokenpet` 由「第三方」改标；`dsh-mermaid` 保持「第三方」（整包引入）。上游版权 / MIT 许可 / 致谢表述不变。

### 验证（2026-09-14）

- `scripts/install-test.mjs` **200 通过 / 0 失败**（新增 [9b] 节 9 项：旧址迁移 / 旧址数据保留 / 新址不覆盖 / 回显 / 二次安装不重复）
- `scripts/probe-test.mjs` 136/0 · `scripts/basedeck-test.mjs` 179/0 · `scripts/smoke-load.mjs` 337/0
- `scripts/settings-api-test.mjs` **109 / 0**（并行工作线为 `dsh-experts` 新增两项设置后本模块已同步：`EXP_SCHEMA` 夹具补齐两键、schema 键数断言 10 → 12、`EXPERTS_CONFIG_FALLBACK` 增加 `expertInjectDetail` / `expertInjectBudgetChars`）
- `modules/dsh-experts/scripts/regression.mjs` 27/0 · `injection-tier-test.mjs` 16/0 · `smoke-load.mjs` 18/0 · `coexist.mjs` 7/0
- `node --check` 覆盖全部改动的 JS；全模块 JS 语法自检通过（57 文件 0 失败）

### 契约对齐（2026-09-15 · dsh-experts 0.3.x）

CI「集成体本体自测」在 `scripts/settings-api-test.mjs` 停红（103 通过 / **6 失败**）：这 6 条断言仍是 dsh-experts **0.2.x** 口径 —— 旧 6 域（`presales`/`aftersales`）已重划为 5 个行业域 + 1 个通用职能域，打分 v3 删 `expertMinScore`、岗位先验降为「同证据时的排序」，身份退场（`identityExpert` 留空 = 不常驻）。**本次只改测试夹具与断言，不动任何产品逻辑。**

- **[9] 打分预览**：身份专家 id `presales-ics-security` → `infosec-ics-security`；命中专家 `aftersales-djbh`（0.7）→ `infosec-djbh` **0.95**（＝岗位域 0.35 + 关键词 0.6，打分 v3 实测）；`max=1↔2` 因果对照用有效 id 重放（`max=2` → `identity+1`，`max=1` → `identity+0`）；新增「身份留空 → 只注入关键词命中的 `infosec-djbh`（`top1`）」一条，锁住 0.3.0 的**身份退场 + 零命中不注入**。
- **[9] 夹具**：`EXP_SCHEMA` 与 mock 值对齐 0.3.2（`defaultDomain` `presales` → `infosec`、`expertInjectBudgetChars` 1400 → 2000、移除 0.3.0 已删除的 `expertMinScore`）；`config` 断言只核对仍在生效的 `expertInjectMax` / `expertSecondThreshold`。
- **[12] 静态核对**：experts schema 键数断言 **12 → 16**（目录段 / 纪律块 / 能力层指针四项已入 schema）；新增 `DEFAULTS.defaultDomain = 'infosec'`、`DEFAULTS.identityExpert = ''` 两条锚点；`limits.js` 的 clamp 断言由「正则匹配源码」改为**动态 import 行为刻度**（`0=不限` / 负数回落默认 2 / 硬上限 3）。
- **验证（2026-09-15 · 本机）**：`settings-api-test.mjs` **112 通过 / 0 失败**；本体五套（probe 136 · install 244 · basedeck · settings-api 112 · smoke 337）全 0 失败；experts 回归 46/0 · 注入分级 16/16 · 能力层 8/0 · 装载冒烟 18/18 · 共存 8/0；work-memory 回归 83/0；`node --check` 全量 JS 0 失败。
- **本次未修正（另挂待办）**：本体侧仍留 0.2.x 口径 —— `lib/settings-api.js` 的 `EXPERTS_CONFIG_FALLBACK`（`defaultDomain: 'presales'`、`expertInjectBudgetChars: 1400`、已废弃的 `expertMinScore: 0.35`）、能力配置页 `client/index.js`（岗位域下拉仍是旧 6 域、schema 镜像含 `expertMinScore`、提示文案写「默认 1400」「如 presales-ics-security」）与 `smoke-load.mjs` / `basedeck-test.mjs` 夹具里的旧 id。属「能力配置页契约对齐」单独一单，不在本次 CI 修复范围。

### 未执行（硬边界）

- 不 `git commit` / `git push`；不改本机 profile（`~/.dsh/profiles/desktop/` 的 `package.json` 与 `node_modules` 一律不动）。
- 换 id 的实际迁移由使用者执行：卸载旧 id → 安装新 id → 确认素材目录（见根 README 与本模块 3.7 节）。

## 1.1.2 — 2026-09-16（文档能力页的技能清单补上 media-gen）

- 「文档能力」组的落盘清单原为**硬编码四个**（office-word / office-excel / office-ppt / pdf-tools），漏了新技能 **media-gen** → 清单与标题改为**五个**（\`CFG_DOC_SKILLS\` + 中英文案 \`五技能落盘\` / \`Five skills on disk\` + 新标签 \`媒体素材\` / \`Media assets\`）
- 说明：该清单目前**只列名称**（自检结果由文档模块给出），本次仅补齐遗漏；「改成动态读自检结果」留作后续可选项
- 验证：\`node --check client/index.js\` · \`smoke-load\` **336/0** · 需重启 DSH 后可见

## 1.1.1 — 2026-09-16（能力配置页：文档能力组接入生图设置）

- **背景**：使用者反馈「文档能力」页看不到生图设置。该组原先只渲染自检面板，而集成体的设计意图本就是**把五个子插件的设置集中到这个分区**（见 §§client/index.js§§ 的 cfgLead）。
- **根因（三处）**：
  1. 宿主 ns 白名单只有 §§work-memory§§ / §§experts§§；
  2. 客户端 §§CFG_GROUPS§§ 没有 docs 的 ns 映射；
  3. 宿主写入校验**只接受顶层键**（原文"不接受嵌套路径"），而 dsh-doc-suite 当时用的是**嵌套** §§media.*§§。
- **本次改动**：
  - 宿主 §§lib/settings-api.js§§：ns 白名单加 §§dsh-doc-suite§§，标题加「文档能力」
  - 客户端：§§CFG_FIELD_META§§ 加 11 个媒体设置键元信息；新增 §§CFG_DOC_GROUPS§§（生图 / 生视频 / 密钥与端点三组）；§§CFG_GROUPS§§ / §§CFG_NS_TITLE_KEY§§ / §§CFG_NS_LEAD_KEY§§ / §§CFG_NS_LIST§§ 接入；docs tab 改为「**设置卡 + 自检面板**」两段；中英各补 21 条文案
  - 配套：§§dsh-doc-suite§§ **0.7.7** 把设置键**扁平化**（§§media.image.enabled§§ → §§mediaImageEnabled§§ 等），使写入校验**无需放宽**
- **安全边界不变**：ns 白名单仍**硬编码**（只是多一个固定 ns）；密钥字段沿用 §§redactSecrets§§ 脱敏；写入仍走 revision 栅栏 + 默认 dry-run
- **验证**：§§npm run check§§ / smoke / probe / install 全绿 · 使用者侧需**重启 DSH** 后可见

## 1.1.0 — 未发布（P1 · 安装与检查页）

设置分区「工作秘书」下的「安装与检查」由占位替换为真实页面。本次**不发版**：`package.json` 与客户端 BUILD 仍为 1.0.0，随集成体统一升版。

### 新增

- **环境清单（只读检测）**：进入页面自动 `GET /work-personal-secretary/api/check`，按固定顺序渲染七项 —— DSH 宿主 / Node.js / Python / Python 依赖 / WPS Office / Obsidian / 子插件；每项显示状态徽标（ok / warn / missing / skip）、证据值与补充说明，`detail` 中的官网链接渲染为可点击链接。
- **四步进度条**：环境检查（当前）→ 补齐依赖 → 安装子插件 → 初始化；后两步标注「后续版本」。
- **受控补齐（主路径＝逐项）**：可代执行项（Python 解释器 / Python 依赖 / WPS Office / Obsidian）带复选框且默认勾选；批量入口按客户端写死的固定顺序 python → pythonDeps → wps → obsidian **逐个** `POST /fix { id }`（只对选中项过滤，不改变相对顺序），每步完成立刻刷新该项「等待 / 执行中 / 成功 / 失败」并回显 command / exitCode / durationMs 与输出末尾 10 行，随后自动重新检测；清单行内另保留单项「补齐」按钮。
- **兜底路径**：`/fix-all` 不再是 UI 主路径，仅当逐个 `/fix` 在请求层失败且本次任务尚无任何成功响应（典型情形是宿主未注册该路由）时，整体回退 `POST /fix-all { ids }`，并按响应里的 `results` 数组逐项回填；`/fix-all` 也失败时整批标记失败并给出原因。
- **结论条与确认文案**：环境未就绪时顶部给出「一键补齐全部（N 项）」入口（语义＝依次补齐这 N 项，按钮旁标注「逐项依次执行」）；底部主按钮为「补齐选中项（N）」，执行中显示「补齐中 x/N」，并如实列出将安装的内容（Python 解释器 3.12 / Python 包 8 个 / WPS Office / Obsidian）。
- **安全边界**：客户端只上报 id，不拼接、不传递任何命令字符串；WPS Office 项显示第三方商业软件许可提示；不可代执行项提供「复制命令」；底部说明默认只读、命令来自内置白名单、不接受外部输入。
- **错误与空态**：接口不可达或返回 `ok:false` 时给出可读失败提示与「重试」，不白屏、不抛异常穿透；加载中显示「检测中…」。
- **按载体分档的宿主基址**：沿用一方 file-upload 的合成 origin 写法 —— Web 载体（origin 正常）走根相对路径，失败再退合成基址；桌面外壳下 `location.origin` 为字符串 "null"，**直接**走合成 origin `http://dsh.internal`，不再尝试必然失败的根相对路径（每个请求只发 1 次，避免拖慢与控制台红字噪音）。两档行为均有冒烟断言覆盖。

### 修复（2026-09-13 · 灰度测试驱动）

- **桌宠套装素材现在随安装自动部署**（`lib/install.js`）：桌宠运行时只读 `<dsh home>/data/dsh-token-pet/skins/`，模块内的 `skins/` **从不被读取**；此前安装器只复制模块、配置底座只建空目录，导致**灰度环境装完只剩客户端内置的 default 形象、两套自研套装不出现**（2026-09-13 灰度测试实锤，即待办里的「素材部署遗漏」）。新增 `deployPetSkins()`：安装 `dsh-token-pet` 成功后，把 `<repoRoot>/modules/dsh-token-pet/skins/<套装>` 按**只补缺失、绝不覆盖**部署到运行时目录。单套失败只清理该套半成品、**不影响插件安装结果**；源目录缺失（纯补丁形态）记为 `skipped` 不算错误。`lib/api.js` 的单项 / 批量安装路由把服务端解析的 DSH_HOME 传下去（`dshHome`），**不新增任何客户端入参**（源与目标路径仍全部由服务端拼接）。安装结果新增 `skins` 字段（非 token-pet 与失败分支恒为 `null`，形状稳定），安装回显多一行「桌宠素材：…」。

### 说明

- 宿主半（`lib/`）的 `check` / `fix` / `fix-all` 路由与命令白名单由并行工作线实现。客户端主路径只用 `POST /fix { id }`；`/fix-all` 仅作兜底，请求契约 `{ ok, results: [{ id, ok, command, exitCode, durationMs, output }], rejected, durationMs }`。路由缺失时页面给出可读错误，不会白屏。客户端文案键设计为 id 无关：接口把某项降级为 manual（`autoFixable:false`）时，该行自动由「补齐」切换为「复制命令」。

### 验证

- （2026-09-13 素材部署修复）`scripts/install-test.mjs` **191 通过 / 0 失败**（新增 22 项：[9] 节 —— 空 dsh home 部署 3 套 / 逐字节一致 / 重复安装全部跳过且**使用者改过的素材未被覆盖** / 源无 skins 时 skipped 且安装仍成功 / 非 token-pet 与失败分支 `skins=null` / `resolveDshHome` 三级解析）；另有**真实素材演练**：空 dsh home 部署 3 套 42 个文件、逐文件 SHA256 与源一致，二次部署全部跳过、使用者改动保留。同轮门禁：probe 136 · basedeck 179 · settings-api 109 · smoke 337 · experts 25/18/7 · work-memory 83，全绿。
- `node --check modules/work-personal-secretary/client/index.js` 通过；
- `node modules/work-personal-secretary/scripts/smoke-load.mjs`：原 20 项断言全绿；新增「安装与检查」页断言 48 条（七项骨架 / 四步进度 / 复选框默认勾选与只发选中项 / 固定顺序逐项 `POST /fix` / 逐项实时进度「补齐中 x/N + 执行中」/ `/fix-all` 仅兜底且容错解析 / 无 fetch 载体不抛错）与「载体分档」断言 4 条（桌面外壳 GET/POST 首次即合成基址且无相对路径尝试；Web 载体 GET/POST 走根相对路径），共 **72 项通过、0 失败**。

## 1.0.0 — 2026-09-13（正式版第一版 · P0 骨架）

集成体首次以**独立插件本体**的形态落地。此前仓库只有五个子插件与文档，没有本体代码。

### 新增

- **设置分区「工作秘书」**：通过 DSH 原生 `settings.section` 槽位在设置左侧注册独立分区（不占用宿主「插件配置」页 —— 那一页只列宿主平面插件，用户插件本来就进不去）。
- **分区内三个子页**：安装与检查 · 能力配置 · 关于与致谢。P0 先交付「关于与致谢」，其余两页显示开发中说明。
- **关于与致谢**：列出集成体版本、包含的五个子插件（记忆库 / 文档能力 / 专家库 / 思维链与图表 / 桌面形象）、第三方来源与许可、以及安全与法务类专家内容「未经专业复核」的免责边界。
- **宿主半骨架**：模块可加载、可被组合树识别；版本从自身 `package.json` 读取而非写死；零运行时依赖。
- **中性部署默认层**：`cordis.patch.yml` 不含任何个人路径或称呼。

### 说明

- 本版**尚未包含**安装器（环境检查 / 依赖补齐 / 子插件安装 / 配置底座）与能力配置页 —— 它们按集成体既定分期在后续版本交付。
- 子插件清单中的版本号**不写死**：P0 只展示标识与用途，版本探测随安装器一并提供。

### 验证

- `node --check` 覆盖 `lib/index.js` 与 `client/index.js`；
- 已安装到本机 desktop profile 并以 `dsh --profile desktop --dump-config` 验证组合树可加载。
