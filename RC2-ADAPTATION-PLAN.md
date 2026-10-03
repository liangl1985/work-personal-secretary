# DSH 0.2.0-rc.2 适配改造方案

> 生成日期：2026-09-30
> 基准版本：官方 `dsh-v0.2.0-rc.2`（tag commit `639ed01`，发布 2026-09-29T09:42:36Z，**pre-release**）
> 复核方式：7 路后台静态复核（6 个模块 + 1 路加载与安装路径专项）+ 主对话逐条交叉复核（MD5 哈希级 diff、源码原文直读、子代理矛盾裁决）
> 性质：**DSH 插件项目内部技术方案**，非对外交付文档
> 配套：`HANDOFF-0.2.0-RECHECK.md`（会话交接）、`OFFICIAL-SOURCE-NOTES.md`（源码读记 §13 = rc.1 难度表）、`OFFICIAL-DESKTOP-ADAPTATION.md`（桌面适配清单）

---

## 0. 结论速览

1. 官方**仍是 rc**：`dsh-v0.2.0-rc.2`（prerelease=True），正式版 0.2.0 未发布；npm `@deepseek-ai/dsh` 的 `latest`/`next` 均已指向 rc.2；`@deepseek-ai/dsh-desktop` **不发 npm、GitHub release assets 也为空**，但**官网已开放桌面端下载**（2026-09-30 主人告知，本机实测页面确认）。
2. **两个破坏性变更在 rc.2 一字未变** —— 兼容性闸门（`plugin-compatibility.ts`）与设置服务（`settings/src/index.ts`）在 rc.1↔rc.2 **逐字节相同**，rc.1 的复核结论可直接沿用。
3. **"能装上"的最小修法只有一条**：5 个模块（除 `dsh-mermaid`）把 `@deepseek-ai/dsh*` 的 peer 从 `^0.1.5-rc.1` 改为 `>=0.1.5-rc.1 <0.3.0`。
4. **"设置页能用"的正解不是找 `register` 的替代物**，而是插件**具名导出 `export const Config`** + 逐字段 `.volatile()`；设置命名空间变成 **profile entry id**。
5. 最耗时、风险最高的是**集成体 `lib/install.js` 与官方 `plugin-manager` 的写盘冲突**（无锁并发写 + 官方失败恢复回滚）。
6. 工时：**第一批（peer 放宽）1–2 h 可交付；全量适配 45–75 h**。

---

## 0.1 第一批执行记录（2026-09-30，已完成）

主人裁定：**第一批开工，优先保障「记忆体」与「集成体」可运转**；其余插件由主人在新架构下自行修复。

| 模块 | 版本 | peer 改动 | 其他改动 | 自测 |
|---|---|---|---|---|
| `dsh-work-memory` | `1.0.9 → 1.0.10` | 7 条 `@deepseek-ai/dsh*` → `>=0.1.5-rc.1 <0.3.0` | `client/index.js:31` `BUILD` `v1.0.3 → v1.0.10`；CHANGELOG 加 1.0.10 段 | `scripts/regression.mjs` **87 通过 / 0 失败** |
| `work-personal-secretary` | `1.1.9 → 1.1.10` | 4 条 `@deepseek-ai/dsh*` → `>=0.1.5-rc.1 <0.3.0` | `client/index.js:45` `BUILD` `v1.1.9 → v1.1.10`；`ARCHITECTURE.md:6` 版本基线同步；CHANGELOG 加 1.1.10 段 | 七脚本：`smoke-load` **533 / 0**、`probe-test` 151 / 0、`install-test` 244 / 0、`identity-test` 73 / 0、`defaults-test` 61 / 0、`basedeck-test` 与 `settings-api-test` 均 exit 0 |

**闸门判定复现（本机 semver 7.8.5）**：新范围 `>=0.1.5-rc.1 <0.3.0` 对 `0.2.0-rc.2` → **true**、对 `0.1.5-rc.2` → **true**；旧范围 `^0.1.5-rc.1` 对 `0.2.0-rc.2` → **false**（证实原问题成立）。

**踩坑记录**：升版本后 `smoke-load` 报 1 处失败 —— `客户端 BUILD 常量 === "v" + package.json.version`（实测 `BUILD=v1.1.9` / `pkg=1.1.10`）。`BUILD` 由 `client/index.js` 常量硬编码，**升版本必须同步改**（`dsh-work-memory` 亦同：其 `BUILD` 自 1.0.3 起就一直落后于包版本）。

**尚未做**：① 未重装到 profile、未重启（本机仍跑 `0.1.5-rc.2`）；② 未在官方 0.2.0-rc.2 桌面端做真机验证；③ 第二批（`Config` + `.volatile()` 设置迁移）未动；④ 其余 4 个插件未改（主人自修）。

---

## 0.2 rc.2 实机抢修记录（2026-09-30，已完成）

**背景**：主人删除旧桌面端、安装**官方桌面端** `<DSH 安装目录>`（运行时经 asar 版本串确认 = **0.2.0-rc.2**；GUI 端口 19387）。

**症状**：记忆体不可用 —— 会话工具目录里**没有** `memory_recall` / `memory_remember`。

**根因（两条，均实机证实）**：

| # | 根因 | 证据 |
|---|---|---|
| 1 | profile 里的 `dsh-work-memory` 是 **v1.0.9 实体副本**，7 条 peer 全为 `^0.1.5-rc.1` → 对 0.2.0-rc.2 判 false → **被兼容性闸门拒绝** | `semver.satisfies('0.2.0-rc.2','^0.1.5-rc.1')` = false；改成 Junction 重启后工具即回归 |
| 2 | rc.2 首启把 `~/.dsh/settings.yaml` 搬为 `.imported`，**`work-memory.memoryDir` 未迁入** profile patch（该 entry 无 `.volatile()` 字段 → 不在可配置列表） | `cordis.patch.yml` 里官方 15 个条目都自动迁入了，**唯独没有 `work-memory`**；默认根 `~/.dsh/data/dsh-work-memory/memory` 为空目录 |

> 第 2 条正是本文档 §2.2 预言的机制，本次被实机证实。

**修复**：
1. `…\profiles\desktop\node_modules\dsh-work-memory` → **Junction** 指向源码 v1.0.10；
2. `…\profiles\desktop\cordis.patch.yml` 追加 `- id: work-memory` + `memoryDir: '<存储根>/memory-data'`（js-yaml 校验通过，共 15 条目）。

**验证（全过）**：工具回归 → `memory_recall("记忆库")` 命中 **3/15 条真实条目** → `memory_remember` 写入落到 `<存储根>\memory-data\DAILY\2026-09-30.md` → 默认根未被创建 → 集成体设置页出现「**工作秘书**」分区（主人截图确认）。

**备份（回退用）**：`<工作区>\backup\2026-09-30-rc2修复前\`（旧 v1.0.9 副本 + `cordis.patch.yml.bak`）。

**遗留 —— 主人 2026-09-30 定：暂不修，等假期优惠期再继续**：

1. **第二批** `Config` + `.volatile()` 迁移：记忆体 31 个字段 / 集成体 `repoRoot`；集成体的「工作秘书」设置页目前**能显示但读写可能降级**（未实测）；
2. **`dsh-experts` / `dsh-doc-suite` / `workspace-tokenpet`** 仍是**旧 peer 实体副本** → 仍被闸门拒；修法与记忆体完全相同（改 Junction + peer 放宽），每个约 10 分钟；
3. `dsh-mermaid` 无 `@deepseek-ai/dsh*` peer → 不受闸门影响，应已正常加载。

---

## 0.3 第二批：设置迁移（Config + volatile）—— 2026-09-30 完成

**目标**：rc.2 的设置系统只把「有具名导出 `Config` 且字段带 `.volatile()`」的插件纳入 `describe()`。集成体本体已在 1.1.11 迁移；本批迁移三个子插件，使集成体「能力配置」页能读到它们、**「核心配置」的 4 项（`memoryDir` / `obsidianSyncDir` / `defaultDomain` + 身份）能取到值**。

| 模块 | 版本 | 迁移内容 |
|---|---|---|
| `dsh-work-memory` | 1.0.10 → **1.0.11** | 24 字段全 volatile + `Config` + 双分支 + 事件驱动 watch |
| `dsh-experts` | 0.5.14 → **0.5.15** | 19 字段中 **18 个** volatile（`expertInjectMax` 按既有「设置页不提供」口径保留） |
| `dsh-doc-suite` | 0.7.18 → **0.7.19** | DEFAULTS 11 → **15 键**，全 volatile |

**集成体侧连带改动（1.1.12）**：
- 白名单 ns 由**包名** `dsh-doc-suite` 改为 **entry id `doc-suite`**（rc.2 的 ns = profile entry id）；并新增 `SETTINGS_NS_ALIASES` 做**别名归并**，使 0.1.x（子插件以包名注册）与 rc.2 都能命中 —— 避免「修好 rc.2 就坏 0.1.x」；
- `settings-api-test` / `smoke-load` / `injection-tier-test` 的断言适配 `withVolatile(...)` 包裹写法。

**团队分工**：`impl`（记忆体）、`impl2`（专家库 + 文档能力）、`verify`（两轮独立审计）。

**`verify` 两轮审计的关键发现（均已处置）**：
1. 三模块的 `Config` 透出 / volatile 覆盖 / `read()` 实时性 / `Config=undefined` 兜底 / 键面对齐 —— 用 unpkg 真实 `schemastery@3.18.4` + `cosmokit@1.8.5` 沙箱**实测通过**；
2. 🔴 `injection-tier-test.mjs` 的正则从源码提取 schema 默认值，被 `withVolatile(...)` 打破 → 已改为「先拍平包裹再跑原正则」；
3. 🟡 **白名单改动破坏了 0.1.x**（Lead 造成）→ 用别名归并修复；
4. 🟡 `mediaArkApiKey` 缺 `role('secret')` → 密钥明文回显 → 已补，并加 `withSecretRole()` 特性探测（该 mock 无 `role` 会让模块顶层裸调抛错，与 `.volatile()` 同坑）；
5. 🟡 `experts/lib/discipline.js` 的 `ctx.settings.get()` 在 rc.2 不存在 → 纪律块的记忆根会指到 `<DSH_HOME>\memories\lina`（错目录，实测）→ 已补 `describe()` 通道 + apply 预热（describe 是异步、注入回调是同步，故「同步读缓存 + 后台刷新」）。

**最终回归**：集成体七套 + 子插件 12 脚本 = **失败总数 0**。

**待第三批**：
- `dsh-doc-suite` 的 Python 侧仍读 `~/.dsh/settings.yaml` 取 ARK 密钥，而 rc.2 首启已把该文件搬为 `.imported` → **密钥通道硬伤**；
- `snapshotOrder` 等「改后需重启」的消费点（volatile 只保证进表单与热更值）；
- rc.2 真机端到端验证（等重启）。

---

## 0.4 第三批：指令层改「授权式」（2026-10-03，本体 1.1.28，**尚未提交**）

**起因（使用者 2026-10-02 定）**：`<workspace>/AGENTS.md` 是**使用者的私人指令文件**。集成体此前会直接往里写标记块（追加 / 只替换块区间 / 手改另存候选三条路径）——这属于**替使用者改他的文件**。新口径：**使用者的文件不直接改**；记忆体 / 知识库 / 技能 / 设置是集成体自己的文件，仍可直接写。

**机制（三态闭环）**：

| 环节 | 行为 | 出处 |
|---|---|---|
| 计划 | 目标**已有**标记块（命中 `<!-- wps:begin -->`）→ `up_to_date`（`autoApplyable:false`）；**没有** → `update`，`target` 指向 `<memoryDir>/PROJECTS/工作秘书.md` | `lib/basedeck.js:1161-1192` |
| 写入 | 不碰 AGENTS.md，只把**自描述引导条目** `[id:12位] [日期] [tag:关键] 【待注入·工作区指令层】` 追加进项目记忆（atomicWriteText + 无 BOM + 写后校验）；已有未完成引导 → 不重复写 | `lib/basedeck.js` 的 `applyAgentsMd` / `buildAgentsPendingEntry` |
| 消费 | 引导条目随 work-memory 的 `PROJECTS/<branch>.md` **每轮注入** → 助手读到后**先征得使用者同意**，再读随包模板的标记块注入 AGENTS.md，并把标题改成 `【已注入·工作区指令层】` | 条目正文自描述（目标文件 / 模板来源 / 注入方法 / 完成标记） |

**三个设计细节（与最初提议的差异，均有理由）**：

1. **完成判据「标题 + tag」双认** —— 最初提议只用 `tag:已完成`；但引导正文里就写着「把 tag:关键 改为 tag:已完成」，整文件搜 tag 会**自我命中**。落地为：判定按 `§` 分段后的**单条**比对，标题改成 `【已注入·工作区指令层】` **或**该条 `[tag:关键]` 改成 `[tag:已完成]` 都算完成；正文里只写裸的 `tag:已完成`（不带方括号），不再自我命中。
2. **`computeSetupNeeded` 同时认 `append` 与 `update`** —— 只认 `append` 会让「其余项已就绪、只差指令层」的机器不出现首用引导，闭环断掉（`lib/basedeck.js:1033-1040`）。
3. **「直接写」保留为可选开关**（使用者 2026-10-03 定）：设置项 `agentsMdDirectWrite`（volatile，进设置页；默认 `false`）。开启时 `planAgentsMd` / `applyAgentsMd` 走旧路径（按七状态判定追加 / 只替换块区间 / 手改另存候选，BOM 仍阻塞）；关闭（默认）时同一目录**一字未动**。旧代码不再是死代码，由开关启用。

**明确的取舍（不是 bug）**：写完引导后 AGENTS.md 仍无标记块 → 计划仍是 `update`、`setupNeeded` 仍为 `true`；**只有真正注入标记块后才转 `up_to_date` 且 `setupNeeded=false`**。即：使用者点完「自动生成」，横幅不会立刻消失 —— 因为指令层确实还没注入。测试里对这条闭环有正向断言（注入后转 false）。

**回归**：七套 **1784 / 0**（basedeck 598 · smoke 540 · install 246 · probe 151 · settings-api 115 · identity 73 · defaults 61）；`npm run check` 通过。子插件未涉及，未重跑。

**版本与文案**：`package.json` / `client/index.js` 的 `BUILD` → `1.1.28`；`CHANGELOG.md` 加 1.1.28 段；`initSafety`（中英）、`defaults/AGENTS.zh-CN.md` 头部、`README.md`（`workspace` / P3）口径同步。

**收尾（2026-10-03 使用者授权「全部按推荐来」后执行）**：① 代码与本文件**随本次提交入库**（提交信息分列「本场实现」与「复核依据」）；② 「直接写」可选开关**已实现**（默认关闭 = 授权式）；③ 真机复验**已完成**（2026-10-03 重启后实测）：`agentsMd` 由 `user_modified` 转 **`up_to_date`**、`summary` 由 `upToDate 6 / blocked 2` 变为 **`7 / 1`**、`setupNeeded=false`、`workspace=E:/lina (config)` —— 与预测一致。

---

## 0.5 第四批：核心配置页「看得见」+ 工作区可配置（2026-10-03，本体 1.1.29，已提交）

对应另两条 P2 遗留（原 `RC2-HANDOFF.md` §3 P2）：`workspace` 无 UI 入口、底座状态明细不展示。

1. **工作区进设置页**：新增 volatile 设置项 `workspace`，优先级 = **设置用户层 > 部署配置（profile patch `config.workspace`）> 按镜像目录反推 > 进程目录**；`lib/api.js` 的 `settingsWorkspace()` / `currentWorkspace()` 与既有 `currentObsidianDir()` 同构（实时读 → 改后即时生效），三处计划器注入点由静态常量改为函数。
2. **核心配置页「配置底座状态」卡**：只读 `GET /basedeck`（dry-run，绝不写盘），展示工作区当前值与来源、8 项状态 / 落点 / 说明、汇总与「重新检测」。

**回归**：七套 **1790 / 0**（basedeck 600 · smoke 544 · install 246 · probe 151 · settings-api 115 · identity 73 · defaults 61）+ `npm run check`。

**1.1.30（同日补丁）**：修 1.1.29 的显示缺陷 —— 底座状态卡汇总行误用 `fill()`（单占位符）导致显示 `共 {total} 项 …` 字面；改用 `fillAll()` + 数值兜底，`smoke-load` 补 3 条断言。

---

## 1. 版本与基准

| 项 | 值 | 来处 |
|---|---|---|
| 最新 release | `dsh-v0.2.0-rc.2`，pre-release，2026-09-29T09:42:36Z，assets=[] | `gh api .../releases` |
| npm `@deepseek-ai/dsh` | `latest: 0.2.0-rc.2`、`next: 0.2.0-rc.2` | registry.npmjs.org |
| npm `@deepseek-ai/dsh-desktop` | **404**（不发 npm） | 同上 |
| 桌面端**官方分发** | `https://www.deepseek.com/harness/` → `https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe`、`dsh-latest-macos-arm64.dmg` | 官网实测 2026-09-30 |
| 本机现装桌面端 | `<DSH 安装目录>\DSH Desktop.exe`（包名 `dsh-plugin-desktop` 2.0.11，repo `anywhere-labs/deepseek-harness-desktop`，**非**官方包） | 本机 `package.json` |
| 本机源码 | `<工作区>\ref\deepseek-harness-0.2.0-rc.2\`（31.28 MB tarball，经 `gh api tarball` 获取） | 本机 |
| rc.1 参照 | `<工作区>\ref\deepseek-harness-0.2.0-rc.1\` | 本机 |
| 本机当前运行时 | `@deepseek-ai/dsh 0.1.5-rc.2`（`<DSH 安装目录>\resources\app\package.json`） | 本机 |

rc.1 → rc.2 规模：**187 commits**；`packages/**/src + package.json` 共 7,776 → 7,831 文件（新增 57 / 删除 2 / 大小变化 354）。

---

## 2. 共性结论（六模块通用）

### 2.1 兼容性闸门是**两级**的（修正 `HANDOFF §2.1` 的表述）

| 级别 | 位置 | 后果 |
|---|---|---|
| **bundle 级** | `packages/boot/app-boot/src/profile.ts:675` → `:680-682` `skippedBundles` | 该 bundle 被跳过；若是 patch 层 bundle，则**整层 patch 不加载** |
| **行级** | `packages/boot/app-boot/src/compatibility-preflight.ts:74-118`（`:105` 判定、`:115` `row.disabled = true`、`:82` stderr 报告） | **只 disable 那一行**，其余照常；stderr 打 `dsh: disabling profile plugin "…": …` |

判定函数：`evaluatePluginCompatibility(manifest, exemptions)`，只检查 `peerDependencies` 中名字匹配 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项，用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`。

**豁免机制**：`<profileDir>/compatibility.json`（`app-boot/src/profile-compatibility.ts:10,113-140`），经 CLI `dsh plugin allow-version --accept-risk` 写入。

> 依据：`packages/boot/app-boot` 在 rc.1↔rc.2 **整目录仅 package.json 的 version 变化**，`src/` 全部逐字节相同 → 行级闸门在 0.2.0-rc.1 就已存在。

### 2.2 `ctx.settings.register` 已移除；正解 = `export const Config` + `.volatile()`

**事实**（主对话复核）：`packages/settings/settings/src/index.ts` 在 rc.1↔rc.2 逐字节相同，`SettingsForms` 只有 `configure:266` / `prepareDocument:296` / `describe:302` / `update:347` / `replace:357` / `mutate:367`。

**替代路径**（主对话复核）：
1. Cordis 在注册时把 `plugin.Config` 捕获进 runtime —— `vendor/cordis/src/registry.ts:326`；
2. 设置侧从 `entry.fiber.runtime.Config` 派生表单 —— `settings/src/index.ts:425-428`；
3. 官方规范要求 function plugin 具名导出 `name`/`inject`/`Config`/`apply`，且**不得混用 default export** —— `packages/AGENTS.md`（Plugin exports）；全树 **98 处** `export const Config` 为实践印证。

**`.volatile()` 是硬闸门，不只是写时校验**（主对话复核）：
- `volatileForm(schema)` 只挑 volatile 字段/子树，整棵无 volatile 返回 `undefined` —— `settings/src/schema.ts:37-47`；
- `describe()` 遇 `undefined` **直接 `return []`** —— `settings/src/index.ts:308-309` → **该 entry 在设置页根本不出现**；
- 写入侧的拒绝更靠后：`has no volatile fields` / `is not volatile` —— `settings/src/index.ts:385-389`；
- 另：volatile 字段的值被 `createVolatile(value)` 包装（`vendor/schemastery/src/index.ts:521-530`），**`apply(ctx, config)` 收到的是包装对象**，必须解包：官方姿势见 `settings/src/schema.ts:10-17`（`isVolatile(v) ? plainConfig(v.get()) : v`，`isVolatile` 来自 `@deepseek-ai/cosmokit`）。
- `.volatile()` 重复包裹 / 嵌套 volatile 会 **throw**（`vendor/schemastery/src/index.ts:480-483`、`:493-496`）。

### 2.3 设置命名空间 = **profile entry id**

`settings/src/index.ts:315,326`：`ns: entry.options.id as SettingsNamespace`。
→ 我方的自定义 ns（`experts` / `work-memory` / `dsh-doc-suite`）必须改为 **entry id**（`dsh-experts` / `dsh-work-memory` / `doc-suite` 等，以 `cordis.patch.yml` 的 `id` 为准）；集成体白名单 `work-personal-secretary/lib/settings-api.js:36` 同步。

### 2.4 rc.1 → rc.2：我们依赖的 API 面基本冻结（主对话 MD5 哈希级复核）

**IDENTICAL（未变）**：`core/system-prompt`、`core/tools`、`core/agent`、`core/session`、`core/agent-default-model`、`skill/skill`、`interaction/commands`、`settings/settings`、`api/settings-controller`、`boot/app-boot`、`boot/plugin-manager`、`boot/cmdline`、`host/webserver`、`host/directory-picker`、`host/directory-picker-browse`、`client/ui-slots`、`client/store`、`client/locale`、`client/connection`、`client/resources`、`client/ui-settings`、`client/ui-directory-picker-native`、`llm/llm`、`llm/token-meter`、`session/session-persistence`、`session/session-stats`、`session-query/session-query`、`subagent/subagent`、`attachment/attachment`、`fs/fs`、`storage/storage`。

**CHANGED（与我们相关者）**：`api/remotes/src/client/index.ts`、`api/gateway/{index,types}.ts`、`client/ui-sidebar-right/{service.ts,shell/SidebarRight.tsx,index.ts}`、`client/ui-conversation/{ConversationMainPanel.tsx,locales.ts}`、`client/ui-tool`（8/48，含 `contract/slots.ts`）、`client/ui-renderer/src/client/scoped-slots.tsx`、`client/ui-chat`（20/115）、`client/ui-plugin-manager`（5/14）、`extensions/{cordis-host-runner,cordis-client-runner,tool-cordis}`、`interaction/user-questions`、`ui-workspace/src/client/shortcuts.ts`。

### 2.5 我方"私有扩展点"清单（官方 rc.2 全树 0 命中，主对话复核）

| 我方依赖 | 性质 | 后果 |
|---|---|---|
| `ctx.get('promptEnhancer')` | 非官方服务 | 集成体 / tokenpet 的"首选增强通道"永久降级 |
| `contextTimeline` / `todayUsageBuckets` 投影 | 非官方投影键 | tokenpet 趋势面板两个数据源无供给方 |
| `window.__DSH_DESKTOP_PICK_DIRECTORY__` / `__DSH_OPEN_SETTINGS_SECTION__` | 现役 Desktop 私有桥 | 集成体桌面桥在官方 Desktop 下失效 |
| `sessionPersistence.listSnapshots()` | 官方只有 `list`/`stat` | tokenpet 小时趋势**恒走降级告警**（rc.1 亦然，非 rc.2 回归） |
| `messages[].source` | rc.2 类型上 `readonly source?: never`（`llm/llm/src/types.ts:491`） | 集成体 `lib/domain.js:203` 需删 |
| `GenerateOptions.purpose` 自定义值 | rc.2 仅 `'compaction' \| 'session-title'`（`types.ts:552`） | tokenpet `src/index.ts:817` 需删 |
| slot `label` 传 ReactElement | rc.2 `SlotLabel = string \| (() => string)`（`ui-slots/src/index.ts:758`） | tokenpet 3 处注册需改 |

> 归因提示：`client/ui-slots`、`session/session-persistence`、`llm/llm` 在 rc.1↔rc.2 **均 IDENTICAL** → 上述后三条**不是 0.2.0 适配工作，而是历史遗留问题**，应单独立项、不与本次适配混算。

---

## 3. 逐模块改造方案

### 3.1 `dsh-mermaid` v0.4.0 —— **零功能改动** ✅

- **peer**：该模块**完全没有 `peerDependencies`** → 闸门 `plugin-compatibility.ts:68` 直接 `return undefined`，不进 `skippedBundles`；**不新增、不修改 peer**（新增反而把它拉进闸门，收益为负）。
- **`settings.register`**：无调用点。
- **代码**：`lib/index.js` / `lib/client.js` / `cordis.patch.yml` 全不动。
- **可做**：`README.md:30`、`README.zh-CN.md:30` 验证版本改 `0.2.0-rc.2`；`CHANGELOG.md:5-7` 加一条；可选升 `0.4.0 → 0.4.1`。
- **工时**：0.5–2 h（文档 + 真机冒烟 + 回退演练）。
- **证据**：rc.1↔rc.2 与本模块相关的 **20 个宿主文件 SHA256 逐字节相同**。
- ⚠️ 本副本无 `src/`、`scripts/`，`package.json:39` 的 `npm run check` / `npm test` **必然失败，勿用**。
- ⚠️ 验证命令里的 `dsh plugin --profile web add -w --save-exact <模块路径>`：见 §4.2 的 CLI 口径修正。

### 3.2 `dsh-work-memory` v1.0.9

- **peer（7 条）** ×1：`@deepseek-ai/dsh-tools`、`dsh-client-ui-conversation`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-slots`、`dsh-client-resources`、`dsh-client-store`、`dsh-client-locale` → 全部改 `>=0.1.5-rc.1 <0.3.0`（`package.json:55-66`）。`cordis`/`schemastery`/`react` 不改。可选清理：`dsh-client-ui-conversation` 在 client 侧无引用。
- **设置**：唯一调用点 `lib/settings.js:132`（+ `:133-136` `scope.get/watch`；`installSettings` 在 `:126-153`）→ 改为具名导出 `Config`，**31 个字段逐个判定是否加 `.volatile()`**；`lib/index.js:28-31` 增 `export { Config }`、`inject` 去掉 `settings`；`lib/index.js:42-72` 改用 `apply(ctx, config)` 入参，`settings.watch` 段改为监听 config 重载。
- **版本**：`1.0.9 → 1.0.10`（或 `1.1.0`）；`client/index.js:31` 的 `BUILD='v1.0.3'` 与包版本脱节，一并更新。
- **工时**：6–9 h（31 个字段判定 2–3 h + 重构 1.5–2 h + 回归与真机 1.5–2 h）。
- ⚠️ **作废一项**：`work-memory` 复核曾建议"去掉 `context?.agent?.session` 分支推断（因为 `AssembleContext` 无 `agent`）"——**该结论错误，已由主对话裁决推翻**：`agent` 由 `core/agent/src/runtime-types.ts:17-23` 的**声明合并**补进 `AssembleContext`，运行时由 `core/agent/src/dispatch.ts:174-176` 的 `assembleContextFor()` 实际塞入（`return { agent, scope: agent, … }`）。**branch 推断有效，不要删。**

### 3.3 `dsh-experts` v0.5.13

- **peer（1 条）**：`@deepseek-ai/dsh-tools@^0.1.5-rc.1` → `>=0.1.5-rc.1 <0.3.0`（`package.json:55`）。
- **设置**：唯一调用点 `lib/settings.js:172`（`register` + `:173-175` `get` + `:174,186` `watch`；schema 在 `:65-123`）→ 同上改为具名导出 `Config`；`lib/index.js:39-40` 增导出、移除未被调用的 `commands` inject。
- **附带**：`lib/discipline.js:92` 的 `ctx.settings.get('work-memory')` 在 rc.2 静默返回 `undefined`（有 try/catch），记忆库根会退到 `$DSH_HOME/data/dsh-work-memory/memory`（`:98-103`）→ 需改用 `describe()` 按 entry id 取值，或文档化降级。
- **版本**：`0.5.13 → 0.5.14`。
- **工时**：完整 6–13 h（中位 ~9 h）；仅降级（删 `register`、不导 `Config`）2–4 h，代价是设置页不可编辑。
- **兼容面**：`systemPrompt`/`tools`/`commands`/事件通道/`skills` **全部兼容**；`AssembleContext.agent` 可用（见 3.2 裁决）。

### 3.4 `dsh-doc-suite` v0.7.17

- **peer（1 条）**：`@deepseek-ai/dsh-tools` → `>=0.1.5-rc.1 <0.3.0`（`package.json:49`）。
- **设置**：唯一调用点在 `lib/settings.js:95`（`installSettings` `:88-109` 已被 try/catch 包住）→ 改 `export const Config = SETTINGS_SCHEMA`；⚠️ **`Config` 必须覆盖 patch 里全部键**（`cordis.patch.yml:13-17` 的 `pythonLauncher`/`docsRoot`/`wpsRequired`/`doctorOnStartup` + media* 11 键），只导 media* 会漏。
- **⚠️ 密钥通道断点（本模块独有硬伤）**：`settings/src/index.ts:238-258` 的 `importLegacyDocument()` 会把 `~/.dsh/settings.yaml` **改名成 `settings.yaml.imported`**；而 `scripts/media/gen_image.py:51,54-83` 与 `doctor.py:202` 正是直接读该文件取 ARK 密钥 → **rc.2 下必然失效**（仅剩 `--api-key` / `ARK_API_KEY`）。需改为读 profile patch（`~/.dsh/profiles/*/cordis.patch.yml` 的 `doc-suite` entry `config`）。
- **volatile 解包坑**：`toConfig()`（`lib/settings.js:75-80`）浅合并后 media* 值是包装对象 → `lib/index.js:47` 字符串拼接会出 `[object Object]`，`mediaSummary()` 的 `!!cfg.mediaArkApiKey` 恒真。需加解包。
- **建议**：`mediaArkApiKey` 加 `.role('secret')`（`settings/src/schema.ts:23` + `index.ts:323-330` 的 `redactSecrets`），避免描述符回明文（与 volatile 并存合法性未验证）。
- **版本**：`0.7.17 → 0.7.18`；文档口径需同步 `README.md:164`、`ARCHITECTURE.md`、`skills/media-gen/SKILL.md:30,32`。
- **工时**：8.5–17 h。
- **既有正面依据**：我方 `{{ }}` 用法全在 JSDoc 与自有模板，非注入文本；`commands`/`webServer` 面兼容。

### 3.5 `work-personal-secretary`（集成体）v1.1.9

- **peer（4 条）**：`dsh-tools`、`dsh-client-locale`、`dsh-client-ui-settings`、`dsh-client-ui-slots` → 全部改 `>=0.1.5-rc.1 <0.3.0`（`package.json:66-69`）。可选 B 方案：删 3 条 `dsh-client-*` peer，仅留 `dsh.client.inject` + devDependencies（对齐官方客户端插件只留 `cordis` 的做法）。
- **设置**：调用点 `lib/settings.js:79-82`，入口 `lib/index.js:75` `installSettings(ctx, {})` → 改 `export const Config` + `repoRoot` 加 `.volatile()`（`lib/settings.js:39-45`），`lib/index.js:75` 传 config，`lib/index.js:85`/`settings.js:59-63` 兼容 `Volatile`（`typeof v.get === 'function'` 时取值）。
- **客户端**：`client/index.js:6508` 的 `props.initialTab` **在 rc.2 无来源**（`ui-settings/src/client/contract/slots.ts:86,97,103,115` 标注 owner props "intentionally empty"）→ 去掉或容错；`client/index.js:6517` 的 `inject` 补 `'locale'`。
- **其他**：`lib/domain.js:149-162` 的 `promptEnhancer` 分支保留降级并改注释；`lib/domain.js:203` 删 `messages[].source`（`llm/llm/src/types.ts:491`）。
- **版本**：`1.1.9 → 1.2.0`。
- **工时**：4–8 h（核心改动集中 `lib/settings.js` 104 行 + `lib/index.js` 121 行；`lib/api.js` 1440 行、`settings-api.js` 601 行已是 `describe/mutate` 风格，无需重写）。
- **注意**：`lib/api.js` 注册 **25 条 webServer 路由**（含 1 条 prefix）；rc.2 的 `webserver/src/index.ts:169` 对重复 path **抛错** → 需确认不与官方或其它插件撞。

### 3.6 `workspace-tokenpet` v1.0.4

- **peer（5 条）**：`dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-settings`、`dsh-client-ui-slots` → `>=0.1.5-rc.1 <0.3.0`（`package.json:68-72`）；`cordis ^4.0.1` 不动。
- **设置**：**不使用 `ctx.settings`**（0 命中）→ 设置改造**零影响**；现状走 localStorage + `settings.section` 槽位。
- **API 迁移（历史遗留，非 0.2.0 适配）**：
  - `src/hourly-trend-index.ts:15` 与 `src/index.ts:181,204,226,227,256,283,341` 共 7 处 `listSnapshots(signal?)` → `list({ signal })`；`src/index.ts:136-137` 的能力探测字段同步（`session-persistence/src/index.ts:194,201`）。
  - `src/client/index.ts:1093-1094,1101-1102,1107-1108` 的 `label` 从 ReactElement 改为返回字符串。
  - `src/index.ts:817` 的 `purpose: 'workspace-tokenpet-prompt-enhance'` 删除。
  - `src/client/index.ts:531,533` 的 `contextTimeline` / `todayUsageBuckets` 无官方供给方，核实后删或保留 host 路由回退。
- **版本**：`1.0.4 → 1.0.5`（若判为行为变更则 `1.1.0`）。
- **工时**：**8–16 h**，其中"0.2.0 适配"仅 peer 0.5–1 h，其余为历史遗留修复。

---

## 4. 集成体与官方 plugin-manager 的冲突（专项）

### 4.1 官方写盘与加锁机制（已证实）

- 官方 `PluginManager` inject `['loader','profileContext']`（`boot/plugin-manager/src/index.ts:176-177`），工具 `plugin_manager`（`src/tools.ts:13,20`），默认挂载于 base bundle（`bundle/base/cordis.patch.yml:20-21`）。
- 写盘：profile `package.json`（`operations.ts:84-86` writeFileAtomic、`index.ts:715-733`、`operations.ts:88-113,522` reconcile）、profile `cordis.patch.yml`（`src/patch.ts:14-42`）、`pnpm-workspace.yaml`（`src/build-approval.ts:39-49`）、`compatibility.json`；失败按快照恢复 `package.json`/`pnpm-lock.yaml`（`index.ts:79,697-713`、`operations.ts:500-520`）。
- **不是事务**，是「**跨进程文件锁 + 原子写 + 失败恢复**」：`withFileLock(join(profile.dir,'package.json'), …, { waitMs: lockWaitMs })`（`index.ts:767-791`，默认 120000 ms），锁文件为 `<file>.lock`（`wx` 创建、记 PID、默认等 2 s；`util/atomic-write/src/index.ts:196,211-229,235-267`）。

### 4.2 CLI 口径修正（重要）

- `apps/cli/src/args.ts:187-198`：`dsh plugin --profile <p> <args…>`，`--profile` **必填**，**其余参数原样转发 pnpm**。
- DSH **自有**子命令只有三个：`allow-version`（须 `--accept-risk`）、`revoke-version`、`version-exemptions`（`apps/cli/src/plugin.ts:17-62`）。
- 因此 `install` / `list` / `add` **不是 DSH 子命令，而是 pnpm 动词**；`dsh plugin --profile desktop install --force` 实际执行的是「在 profile 目录跑 `pnpm install --force`」——写法不算错，但**不要把它当成官方插件 API**，且**没有 `--force` 之外的 DSH 语义**。
- rc.2 新增：`requireDesktopProfile`（`plugin.ts:10-14`）、`manageDesktopProfile` 门（`args.ts:143,195`）、desktop 写锁包裹（`plugin.ts:92-96`，120000 ms）。**若 Desktop 载体以 `manageDesktopProfile: true` 调用，则 desktop profile 的 CLI 写入被收口到 desktop 单实例锁内**（未通读 `apps/desktop/src/command-*.ts`，见 §7）。

### 4.3 与我方 `lib/install.js` 的冲突点（逐条）

| # | 冲突 | 依据 | 后果 |
|---|---|---|---|
| ① | **同文件无锁并发写** | 我方 `install.js:1014` `fsio.writeFileSync`、`:591-593` 写 patch，均不取锁；官方在 `package.json.lock` 内「读—改—原子写」 | 交错时互相覆盖 `dsh.profile.bundles` / `dependencies` |
| ② | **被官方失败恢复回滚** | 官方安装失败/取消按快照恢复（`index.ts:697-713`） | 我方在窗口期写入的登记被抹掉 |
| ③ | **双方都改 bundles，语义不同** | 官方只改 bundles（`index.ts:730-733`）；我方同时改 dependencies + bundles（`install.js:999-1009`） | 正常情况不会剔除我方条目，但**顺序与去重由官方决定** |
| ④ | **pnpm 生态面不同步** | 官方原子重写 `pnpm-workspace.yaml`、恢复 `pnpm-lock.yaml`；我方不写也不感知 | 版本/工作区配置可能失配 |
| ⑤ | **`node_modules/<id>` 归属** | 我方直接放 `node_modules/<id>` 并写 `file:node_modules/<id>` | pnpm install/update 是否清理该目录**未验证** |

**能否改走官方入口**（推断，未实现）：`pluginManager.setBundleEnabled(name, enabled)`（`index.ts:443`）、`installBundle(spec)`（`:462`）为 @Remote，可复用其锁/reconcile/豁免检查；但官方**没有"写任意 dependencies 条目"的公开入口**，我方"仓库 `modules/` → profile `node_modules`"的搬运仍需自行完成，可收敛的是 `package.json` 登记环节。

### 4.4 放宽 peer 之外的门槛（已逐一核实，我方 6 模块**均不触发**）

- bundle 侧：缺 `dsh.bundle`（`profile.ts:671-673`）、`patch` 类型非法（`:58-64`）、patch 文件缺失或 YAML 顶层非数组（`index.ts:335-343,357-369`）、包解析不到（`:630-641`）→ 我方 6 个 `package.json` 均为 `dsh.bundle.patch = './cordis.patch.yml'`，patch 顶层是 `insert` 数组，合法。
- client 侧：`dsh.client` 字段类型校验（`client/modules/src/client/manifest.ts:144-174`）、`platform !== 'web'` 不成 row（`src/index.ts:841-844`）、有 `dsh.client` 但 `exports` 无 `./client` 抛错（`:845-848`）→ 我方 4 个有 client 声明的模块均有 `./client` 导出，**6 个都没有 `external` 字段**，不触发。
- 其它：官方 `protectedModules` 只保护自身 18 个包（`plugin-manager/src/index.ts:66-76`），我方不在名单；settings 的 schema 投影只在设置页读写时发生，**不构成加载门槛**。

---

## 5. 施工顺序建议

| 批次 | 内容 | 依赖 | 工时 |
|---|---|---|---|
| **第一批 · 能装上** | 5 个模块（除 mermaid）的 `@deepseek-ai/dsh*` peer 改 `>=0.1.5-rc.1 <0.3.0`，各模块升 patch 版本 + CHANGELOG | 无 | **1–2 h** |
| **第二批 · 设置能用** | experts / doc-suite / 集成体 / work-memory 的 `Config` + `.volatile()` 迁移（含 ns → entry id、volatile 解包） | 第一批 | **20–35 h** |
| **第三批 · 密钥与数据通道** | doc-suite 的 `settings.yaml` → profile patch 迁移；集成体 `discipline.js` 的 work-memory 取值 | 第二批 | **4–8 h** |
| **第四批 · 集成体安装方式** | `lib/install.js` 对齐官方 `plugin-manager`（加锁 / 走 `setBundleEnabled` / 处理失败恢复） | 需先做安全设计 | **8–16 h** |
| **第五批 · 历史遗留** | tokenpet 的 `listSnapshots`/`label`/`purpose`、集成体 `messages[].source`、`props.initialTab` | 独立 | **8–16 h** |
| **收尾** | 各模块 README/CHANGELOG/文档口径、真机重装回归、回退演练 | — | **8–12 h** |

> **建议**：第一、二批先做（收益明确、风险低）；第三批的密钥通道是**功能性硬伤**，应尽早做；第四批涉及并发写盘，**动工前必须先补一份并发安全设计**，不要直接改。

---

## 6. 总工时

| 口径 | 工时 |
|---|---|
| 仅"能装上"（第一批） | **1–2 h** |
| 能装上 + 设置可用（一、二批） | **21–37 h** |
| 全量适配（一~五批 + 收尾） | **49–89 h**（中位 ~65 h） |
| 只做降级（不导 `Config`，设置页放弃） | 各模块 2–4 h，合计约 **12–20 h** |

---

## 7. 未验证项汇总（**动工前应先验证**）

1. **本机运行时版本**：现在跑的是 `0.1.5-rc.2`（`<DSH 安装目录>\resources\app\package.json`）；rc.2 的真机行为**全部未跑**。
2. **改 peer 后是否真的脱离 `skippedBundles`**：机制已读码，**未真机验证**（这是第一批的验收点）。
3. **`Config` + `.volatile()` 的完整链路**：注册后 `describe()` 是否返回该 ns、`apply` 收到的 config 是否为 `Volatile` 包装、设置页写入是否触发 fiber 重载（`app-boot/src/index.ts:289,300` → `vendor/loader/src/config/entry.ts:115-116` 仅写 "restart as needed"）—— 均**未实测**。
4. **`settings.yaml.imported` 搬迁在实际 profile 上的行为**（文件是否存在、段名映射、失败 warn）—— 未实测。
5. **`dsh plugin` 在 desktop profile 下是否被 desktop 写锁收口**：rc.2 新增 `apps/desktop/src/command-*.ts` **未通读**。
6. **`install.js` 与官方 `pluginManager` 真实并发时的丢更新**：仅静态推出机制，**未运行时复现**。
7. **pnpm install/update 是否会清理 `node_modules/<id>`** 中的本地目录。
8. **`compatibility.json` 豁免流程**：本机 profile 尚未出现该文件（目录清单已确认），rc.2 实际效果未实测。
9. **25 条 webServer 路由**是否与官方/其它插件 path 冲突（`webserver:169` 重复即 throw）。
10. **`volatile()` 与 `role('secret')` 可否共存**及调用顺序语义；`createVolatile` 包装对象是否另有 `valueOf`/`toJSON`。
11. **tokenpet 的 `contextTimeline` / `todayUsageBuckets` 真实供给方**（官方全树 0 命中，可能是外部插件）；`client/client.js` 的 `__ModuleLoader__` banner 与 rc.2 前端模块表兼容性。
12. **`dsh-desktop` 仍未发布**：桌面 profile 与 web profile 的差异未验证；本方案只覆盖 web profile 的静态结论。

---

## 8. 方法与局限

**方法**：7 路后台子代理并行静态复核（每路只读、要求 `文件:行号` 依据、区分已证实/推断/未验证），主对话对关键机制逐条交叉复核（源码原文直读 + MD5 哈希级 diff），并对子代理之间的矛盾做裁决。

**已裁决的矛盾（1 处）**：`AssembleContext.agent` 是否存在 —— 判 `dsh-experts` 正确、`work-memory` 错误（见 §3.2 的作废说明）。

**局限**：

1. ⚠️ **`read` 工具对超过 2000 字符的长行会静默截断**（实测：`dsh-mermaid/lib/client.js` 真实 23,466 字符，只返回 10,666）。我们 6 个模块的 `lib/client.js`、`lib/index.js` 多为打包压缩的单行长文件 → **凡以 `read` 得出"某 API 0 命中"的结论都存在假阴性风险**。本方案中涉及客户端 bundle 的"未使用/0 命中"断言，建议**用 `grep` 或原始文本再确认一次**。
2. 全部结论为**静态读码**，未运行任何构建/安装/测试/真机命令（刻意遵守只读纪律）。
3. 行号基于本机 `ref/deepseek-harness-0.2.0-rc.2` 副本（tag commit `639ed01`）；官方若已移动 master，行号可能漂移。
4. 官方**未为 0.2.0 提供 upgrade guide**（`docs/upgrade-guide/` 下只有 `v0.1.7-rc.2`），故破坏性变更清单由我方读码得出，非官方声明。
5. 工时为"1 人、熟悉本模块"口径的粗估，含真机重装与回归。
