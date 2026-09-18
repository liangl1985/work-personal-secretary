# dsh-experts · 模块说明（维护者向）

本文件只描述**已在代码里实现**的行为，结论一律带出处。文内路径均**相对于本模块根目录**（`modules/dsh-experts/`），行号对应当前检出状态（`package.json` 版本 **0.5.12**，`package.json:3`）。

## 1. 架构

**这个模块是什么、替谁做什么**：一个 Cordis 宿主半插件，把「临场手写专家人设」变成「按需调用现成的专家定义」——每轮从任务文本匹配行业/职能专家，命中才注入 persona（默认只注入精简卡），派子代理时用 `expert_recall` 现取全文内联进 prompt（`lib/index.js:4-10`）。

### 模块组成与关键文件职责

| 路径 | 行数 | 职责 |
|---|---|---|
| `lib/index.js` | 466 | 宿主半入口。声明 `export const name` / `inject`（`lib/index.js:39-40`），`apply()` 装配四条通道并返回 disposer（`lib/index.js:176-445`） |
| `lib/store.js` | 223 | 索引与正文读取（真相源 `experts/`）。六域定义 `DOMAINS`（`lib/store.js:29-36`）、`readIndex()`（:57）、`activeExperts()`（:163）、`loadPersona()`（:183）、`identityExpertOf()`（:204） |
| `lib/match.js` | 201 | 匹配打分（纯函数、无副作用）。`WEIGHTS`（`lib/match.js:25-30`）、`scoreEntry()`（:47）、`rankExperts()`（:86）、`selectExperts()`（:111）、`pickWorkers()`（:193） |
| `lib/inject.js` | 355 | 注入文本组装。`parsePersonaSections()`（`lib/inject.js:119`）、`buildPersonaCard()`（:161）、`buildPersonaBlock()`（:197）、会话阶段常量 `PHASE_OPENING/PHASE_WORKING`（:224-225）、`buildInjection()`（:281）、`buildCatalog()`（:328） |
| `lib/settings.js` | 193 | 设置命名空间。`SETTINGS_NS='experts'`（`lib/settings.js:35`）、`DEFAULTS`（:41-62）、`EXPERTS_SETTINGS_SCHEMA`（:65-123）、`installSettings()`（:165） |
| `lib/limits.js` | 120 | 上限/预算/成本常量与夹取。`INJECT_MAX_HARD=4`（`lib/limits.js:12`）、`INJECT_BUDGET_DEFAULT=15000` 与 `INJECT_BUDGET_MAX=20000`（:76-80）、`DETAIL_MODES=['auto','card','full']`（:98）、`clampFullHitMax()`（:116） |
| `lib/discipline.js` | 188 | 交付层纪律块**只读**解析。`DISCIPLINE_MARK='【纪律块 v1】'`（`lib/discipline.js:30`）、记忆根解析 `resolveMemoryRoot()`（:88）、`loadDiscipline()`（:140）、`formatDiscipline()`（:178） |
| `lib/capability.js` | 157 | 能力层（技能指针）。`SKILL_HINTS` 表（`lib/capability.js:24-35`）、`routeCapabilities()`（:84）、异步预取技能源的 `createSkillSource()`（:122） |
| `experts/index.json` | — | 元数据真相源：`version: 2`、19 位专家，字段 `id/name/domain/role_tag/when_to_use/trigger_keywords/source/file`；`source` 含 `repo/path/license/adapted/review/origin/basis` |
| `experts/<域>/<id>.md` | — | 19 篇 persona 正文（纯 Markdown 四段结构：角色 / 工作方法 / 交付与自检 / 交付明细） |
| `experts/skills.auto.json` | 5.2 KB | 能力层**兜底**索引（宿主 skill 注册表不可用时使用，`lib/store.js:83`） |
| `scripts/*.mjs` | 7 个 | 自测与工具，全部不依赖宿主运行时（`README.md:206`） |
| `docs/` | — | 设计与运维文档：`design-v2.md`、`handover.md`、`pre-release-audit.md`、`optimization-log.md`、`optlog-*.md` |
| `cordis.patch.yml` | 41 | 组合挂载补丁（`insert` 挂 `experts` entry）与 base 层默认值（`cordis.patch.yml:18-41`） |

- **本模块没有** `client/`、`specs/`、`skills/` 目录（当前检出中不存在）——客户端无 UI，无 HTTP 路由。
- 域体系：5 个行业域 + `general` 通用职能域，共 19 位（infosec 4 · accounting 4 · coding 3 · finance 2 · hr 1 · general 5），与 `experts/index.json` 的 `note` 一致。
- 合规口径：persona 是上游开源件的**压缩改写**（`adapted: true`），来源逐条记录在 `source` 字段，汇总见 `NOTICE`（`NOTICE:4-6`）；`anthropics/skills` 属 **Proprietary**，只吸收通用方法要点、**不作为改写来源归因**（`NOTICE:68-76`）；11 位标 `review: "pending"`（infosec/accounting/finance/hr 四域），对外交付前须人工复核（`NOTICE:118-126`）。
- 许可义务：MIT 保留版权与许可文本、Apache-2.0 保留 NOTICE 并标注修改处；**来源缺失或不确定的条目不随发布件分发**（`NOTICE:105-115`）。

## 2. 数据流

### 主要入口 → 处理链路

1. **目录段（稳定通道）**：`systemPrompt.section`，`order 10150`（`lib/index.js:338-350`）→ `buildCatalog({domains, personas, skills})`（`lib/inject.js:328-350`）→ 返回六域成员 + 可用能力的稳定文本（上限 `CATALOG_MAX_CHARS=1000`，`lib/inject.js:315`）。内容刻意不依赖设置（除总开关），换任务时不改系统提示词文本。
2. **persona 注入（每轮通道）**：`systemPrompt.context`，`order 480`（`lib/index.js:247-331`）。链路：
   - 宿主事件 `agent/inbox/claimed`（`lib/index.js:191-198`）与 `agent/pre-step`（:203-210）把**使用者输入**文本写进按会话的 `taskTextCache`（`lib/index.js:62-135`，TTL 30 分钟，:63）；
   - `extractTaskText()` 读缓存（`lib/index.js:141-174`）；
   - `activeExperts(cfg)` 定候选池（`lib/store.js:163-176`）；
   - `selectExperts()` 打分选人（`lib/match.js:111-175`）；
   - 会话阶段判定：`openedSessions` 决定首轮全景 / 干活轮（`lib/index.js:244`、:278-281），干活轮用 `pickWorkers(selected, ranked, expertFullHitMax)` 按**证据序**取全文位（`lib/match.js:193-201`）；
   - `buildInjection()` → `planInjection()` 定形态（首轮全卡 / 干活轮 worker 给全文 / 身份专家恒给卡，`lib/inject.js:239-270`）→ `buildPersonaBlock()` 渲染（`lib/inject.js:197-217`）；
   - 预算只作上限：超 `expertInjectBudgetChars` **截断并标注**，不再降级（`lib/inject.js:262-268`）；
   - 注入文本按会话缓存（`injectCache`，`lib/index.js:241`、:304-311）。
   - **零命中不注入**：无关键词证据时返回空串（`lib/match.js:138-140`、`lib/index.js:294-297`）。
   - 能力层指针独立拼接（`lib/index.js:283-293` → `lib/capability.js:84-109`）。
3. **交付层纪律块（每轮通道）**：`systemPrompt.context`，`order 481`（`lib/index.js:356-372`）→ `resolveMemoryRoot()`（`lib/discipline.js:88-104`）→ `loadDiscipline()`（:140-167）→ `formatDiscipline()`（:178-188）。回调内 try/catch，异常不抛给宿主（`lib/index.js:366-369`）。
4. **工具入口**：`ctx.tools.register(expert_recall)`（`lib/index.js:375-437`），现取 persona 全文，不常驻上下文。
5. **设置入口**：`installSettings()` 调 `ctx.settings.register(SETTINGS_NS, schema, { base })` 并 `watch` 变更（`lib/settings.js:165-193`）；`apply` 内每轮 `cfg()` 实时读，**改设置免重启**（`lib/index.js:178-179`）；设置服务不可用时警告并退回组合配置（`lib/settings.js:178-181`）。

### 落盘位置（写哪些文件、写到哪）

- **本模块的 `lib/` 不写任何文件**：全模块 `lib/*.js` 中不存在 `writeFileSync / mkdirSync / appendFileSync / unlinkSync / rmSync`（全文件检索无命中）。
- 唯一的文件写入在构建/工具脚本：`scripts/skill-index.mjs` 生成 `experts/skills.auto.json`（`scripts/skill-index.mjs:149`）。
- 设置值由**宿主**设置服务落盘（本模块只 `register/get/watch`，不决定文件名与格式）；`cordis.patch.yml` 的 `config` 是部署默认层，解析序为「schema 默认 ← 本文件 base ← profile patch ← 设置页覆盖」（`cordis.patch.yml:4-7`）。
- 读取侧位置：`experts/index.json`（`lib/store.js:57-74`）、`experts/<entry.file>`（`lib/store.js:183-190`）、`experts/skills.auto.json`（`lib/store.js:83-108`）、记忆库 `<root>/PROJECTS/dsh-experts.md`（`lib/discipline.js:33`、:140-167）。
- 缓存失效口径：索引与能力索引按 **mtime**（`lib/store.js:51/65`、:76/91），纪律块按 **mtime+size 指纹**（`lib/discipline.js:149-151`），注入文本按 **会话 id**（`lib/index.js:241`）；persona 正文每次读取按 mtime 走 `readFileSync`（`lib/store.js:186`）。

## 3. 对外接口

### 工具

`expert_recall`（`lib/index.js:376-436`）

| 参数 | 类型 | 说明（引自 `lib/index.js:379-383`） |
|---|---|---|
| `id` | string | 专家 id（如 `infosec-bid-proposal`）；省略则用 `query` 匹配；支持省略域前缀的后缀匹配（`lib/store.js:138-147`） |
| `query` | string | 任务描述或关键词，用于选出最匹配的专家 |
| `list` | boolean | 仅列出可用专家清单（含域、一句话定位、激活状态） |

- `output`：`{ ok(required), kind, id, name, score, reasons[], text, error }`，`render` 输出 `text ?? error`（`lib/index.js:385-401`）；`isConcurrencySafe: () => true`（:402）。
- 分支：`list` → 清单文本（:405-407，`listText()` :448-465）；`id` → 全文，未找到给错误（:408-418）；否则按 `query` 打分取最高分（:419-435）。
- 取全文走 `buildManualInjection()`，**不受预算与形态影响**（`lib/inject.js:308-312`）。

### 命令 / 路由

- **命令：本版未注册任何命令。** 全库检索 `commands` 只有一处：`export const inject = ['systemPrompt','tools','commands','settings']`（`lib/index.js:40`），不存在 `ctx.commands.register(...)`；`/expert` 命令已于 0.3.0 移除（`README.md:69`）。**维护者注意**：`lib/index.js:463` 的清单文案与 `lib/inject.js:55` 的 `MANUAL_NOTE` 仍写「`/expert use` / `/expert off` / `/expert auto`」，属**过期文案**，运行时并无这些命令可用。
- **HTTP 路由：无**（无 `client/`、无路由注册）。
- 客户端页面：无。

### 设置命名空间与键

命名空间 `experts`（`lib/settings.js:35`）。`DEFAULTS` 共 **20 键**（`lib/settings.js:41-62`），其中 **schema 暴露 19 项**（`lib/settings.js:65-123`）——`injectOrder` 只在 `DEFAULTS` 与 `cordis.patch.yml` 中，设置页不提供（注释写明「改动需重启」，`cordis.patch.yml:23`）。

`expertsEnabled=true` · `expertCatalogEnabled=true` · `disciplineEnabled=true` · `disciplineMemoryDir=''` · `defaultDomain='infosec'` · `identityExpert=''` · `enabledDomains=''` · `enabledExperts=''` · `expertInjectMax=4` · `skillInjectEnabled=true` · `skillBudgetChars=300` · `expertInjectDetail='auto'` · `expertInjectBudgetChars=15000` · `expertFullHitMax=2` · `expertSecondThreshold=0.3` · `expertGeneralMax=1` · `expertGeneralMinEvidence=0.2` · `expertShowBanner=true` · `expertSetupDone=false`；另 `injectOrder=480`（`lib/settings.js:43`）。

`toConfig()` 对越界值统一夹取：`expertInjectMax`/detail/budget/skillBudget/fullHitMax/threshold/generalMax/generalMinEvidence（`lib/settings.js:137-156`），硬边界见 `lib/limits.js:12/76-80/110-116`。

### 模块导出的关键符号

- `lib/index.js`：`export const name = 'dsh-experts'`（:39）、`export const inject = [...]`（:40）、`export function apply(ctx, config)`（:176）。
- `lib/match.js`：`WEIGHTS`、`GENERAL_DOMAIN`、`keywordHits`、`scoreEntry`、`rankExperts`、`selectExperts`、`pickWorkers`（:25-201）。
- `lib/inject.js`：`PERSONA_MAX_CHARS=3600`（:42）、`PATH_HINT`/`IDENTITY_NOTE`/`MATCH_NOTE`/`MANUAL_NOTE`（:45-55）、`parsePersonaSections`、`buildPersonaCard`、`buildPersonaBlock`、`PHASE_OPENING/PHASE_WORKING`、`buildInjection`、`buildManualInjection`、`CATALOG_MAX_CHARS`、`buildCatalog`、`buildNone`（:281-355）。
- `lib/store.js`：`MODULE_ROOT`、`EXPERTS_ROOT`、`SKILLS_INDEX_FILE`、`DOMAINS`、`domainById`、`splitList`、`readIndex`、`readSkillsIndex`、`allExperts`、`kindOf`、`allPersonas`、`allSkills`、`findSkill`、`findExpert`、`activeExperts`、`loadPersona`、`identityExpertOf`、`groupByDomain`（:21-223）。
- `lib/settings.js`：`SETTINGS_NS`、`DEFAULTS`、`EXPERTS_SETTINGS_SCHEMA`、`installSettings`（:35-193）。
- `lib/limits.js`：`INJECT_MAX_HARD`、`INJECT_MAX_DEFAULT`、`clampInjectMax`、`COST_PERSONA_CARD`、`COST_SKILL_LINE`、`SKILL_BUDGET_*`、`clampSkillBudget`、`clampUnit`、`INJECT_BUDGET_*`、`clampBudget`、`DETAIL_MODES`、`normalizeDetail`、`FULL_HIT_MAX_*`、`clampFullHitMax`（:12-120）。
- `lib/discipline.js`：`DISCIPLINE_MARK`、`DISCIPLINE_FILE`、`DISCIPLINE_MAX_LINES`、`entryBody`、`parseDiscipline`、`resolveMemoryRoot`、`loadDiscipline`、`formatDiscipline`（:30-188）。
- `lib/capability.js`：`SKILL_HINTS`、`shorten`、`toCapabilityEntry`、`capabilityLine`、`routeCapabilities`、`estimateCapabilityCost`、`createSkillSource`（:24-157）。

### 自测脚本（`package.json:37` 的 `test`）

`regression.mjs` → `injection-tier-test.mjs` → `capability-test.mjs` → `coexist.mjs` → `smoke-load.mjs`（顺序执行）；另有 `test:inject`/`test:capability`/`smoke`/`coexist`/`card` 与语法检查 `check`（`package.json:36-44`）。`skill-index.mjs` 是索引生成器（不在 test 链中）。

## 4. 回退与恢复

### 版本回退

1. **改版本号 + 强制重装 + 重启**（README 的推荐顺序）：
   - 只改源码后直接 `dsh plugin add <路径>` 常报 `Already up to date` 而不同步，可靠顺序是**升 `package.json` 的补丁版本** → `dsh plugin --profile desktop install --force` → 仍不同步就删掉 profile 下的 `node_modules/dsh-experts` 再 `dsh plugin add`（`README.md:34`）；回退即把版本号改回目标版本后重复同一流程。
   - 同步后**逐文件比对 SHA256**（源码 ↔ profile 副本）确认一致，再**重启 DSH**（`README.md:35`）。
2. **`git revert`**：本模块所有代码与数据（`lib/`、`experts/`、`scripts/`、`cordis.patch.yml`）都在仓库内，可用 `git revert <commit>` 回到任一历史提交，再按上面的「升/改版本号 → install --force → 重启」流程同步；版本历史与每次改了什么见 `CHANGELOG.md`（顶部即最新版本条目，如 `CHANGELOG.md:5`）。
3. **重装**：卸载后按 `README.md:18-32` 的 `dsh plugin --profile desktop add file:<仓库目录>/modules/dsh-experts` 重新挂载；`dsh.bundle.patch` 指向 `./cordis.patch.yml`（`package.json:48-52`），`files` 白名单含 `lib`、`experts`、`scripts`、`cordis.patch.yml`（`package.json:26-35`）。
4. 改动 `cordis.patch.yml` 的 `injectOrder` 之类的**注册期**配置需重启；设置页项与 `experts/**` 内容免重启（`cordis.patch.yml:23`、`README.md:172`）。

### 数据备份与恢复

- **数据全在源码目录里**：`experts/index.json` + `experts/<域>/*.md`（19 篇）= 专家库真相源，随仓库版本管理；备份=复制 `experts/` 目录或依赖 git 历史。
- `experts/skills.auto.json` 是**可重建**的兜底索引：`node scripts/skill-index.mjs` 扫技能源后重写该文件（`scripts/skill-index.mjs:149`）；丢失不影响宿主 skill 注册表路径（`lib/store.js:78-107` 缺失时返回空池）。
- **设置值不在本模块**：由宿主设置服务持有与落盘；恢复设置需从宿主侧备份/还原对应 profile 的设置文件（本模块不写该文件）。
- 纪律块**只读，不备份也不可被本模块改写**：`loadDiscipline` 只 `readFileSync`（`lib/discipline.js:154`），`resolveMemoryRoot` 只解析路径（:88-104）。

### 不可逆操作与注意事项

- **本模块没有删除、覆盖或迁移用户数据的操作**：`lib/*.js` 无任何写文件调用；`scripts/coexist.mjs` 会在**临时目录**上 `rmSync`（`scripts/coexist.mjs:146`），不触碰真实记忆库。
- **不要用 PowerShell `Set-Content -Encoding utf8` 改 profile 的 JSON/设置文件**（会写 BOM，宿主 `JSON.parse` 直接失败）（`README.md:37`）。
- **写入路径的边界**：纪律块读取路径的兜底顺序是「本模块 `disciplineMemoryDir` → work-memory 设置 `memoryDir` → `$DSH_HOME/data/dsh-work-memory/memory` → `~/.dsh/data/dsh-work-memory/memory`」，另有扫描 `<base>/memories/*`（含 `PROJECTS` 子目录者）的兜底（`lib/discipline.js:88-127`）；配错只会「读不到」并打印一行明示，不会写坏记忆。
- **合规红线**：`review: "pending"` 的 11 位不能据其直接对外出专业结论（`NOTICE:118-126`）；来源未标注/不确定的条目不随发布件分发（`NOTICE:115`）。
- **已知文档-实现偏差（维护时留意，非功能缺陷）**：
  - `identityExpert`（**2026-09-17 复校：已一致**）：schema 描述现为「留空 = 不常驻任何身份专家」（`lib/settings.js:82`），与实现（`lib/store.js:204-213`）及 `README.md:124`、`cordis.patch.yml:28` 一致；先前的「描述写自动取岗位域第一位」已随描述修正消除。
  - `scripts/injection-tier-test.mjs` 头部注释第 4 条仍写「预算降级顺序……」（`scripts/injection-tier-test.mjs:9`），而同文件 :131 的断言已声明旧降级链删除、现测试的是截断（:135-169）——头部注释过期。
