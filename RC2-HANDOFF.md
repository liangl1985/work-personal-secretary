# DSH 0.2.0-rc.2 适配 —— 交接文档（给新对话）

> **生成时间**：2026-09-30 晚 · **生成者**：莉娜（上一场对话）
> **用途**：新对话接手时先读本文件；它记录**已完成 / 未完成**、**关键机制**、**踩过的坑**与**验证命令**。
> **配套**：同目录 `RC2-ADAPTATION-PLAN.md`（方案与执行记录 §0.1 / §0.2 / §0.3）。

---

## 0. 一句话现状

6 个插件已**全部解封并在官方桌面端 0.2.0-rc.2 上跑起来**（peer 放宽 + profile 改 Junction + 设置迁移）；
**能力配置页已能读到子插件设置项**（今晚主目标达成）；
剩 **1 个真正影响功能的问题**（`workspace` 未配置导致 core 页误判 4 项，并会把 AGENTS.md/技能误写进知识库 vault）—— **该项已于 2026-09-30 晚修复，待主人重启复验** —— 与若干**功能级遗留**（密钥通道、岗位不持久化等）。

---

## 1. 环境事实（新对话必读）

| 项 | 值 |
|---|---|
| 运行时 | **DSH 官方桌面端 0.2.0-rc.2**（`<DSH 安装目录>`，asar 内版本串实测） |
| GUI | `http://127.0.0.1:19387` |
| DSH_HOME | `<DSH_HOME>` |
| profile | `desktop` → `<DSH_HOME>\profiles\desktop\` |
| profile 配置 | `profiles\desktop\cordis.patch.yml`（**15 条目**，含 `work-memory.memoryDir`） |
| 插件源码仓 | `<工作区>\DSH插件\src\work-personal-secretary\`（**git 仓库根在此**；`<工作区>\DSH插件` 不是仓库） |
| 模块目录 | 上面那个仓库下的 `modules\` |
| 记忆库 | `<存储根>\memory-data` |
| 知识库 vault | `<存储根>\obsidian-data` |
| 工作区 | `<工作区>`（`AGENTS.md` + `.dsh\skills` + `DSH插件` + `0.产出物`） |
| 备份 | `<工作区>\backup\2026-09-30-rc2修复前\`（5 个模块旧副本 + 旧 patch） |

### ⭐ 一个极其有用的新发现

**集成体的自定义路由可以匿名 HTTP 访问**（宿主根 `/` 才要 token）：

```powershell
curl.exe -s "http://127.0.0.1:19387/work-personal-secretary/api/basedeck"
# → 200 + 完整 JSON（含 items / summary / setupNeeded / workspace）
```

**新对话排查配置类问题时应优先用这条**，不要靠本地复算（本对话就是在这里栽过：本地复算传错 `workspace`，得出与实际相反的结论）。

**加强用法 —— 带参只读预演**（`GET /basedeck` 是 dry-run：`lib/basedeck.js:27` 红线「GET 与不带 `dryRun:false` 的 POST 都**绝不写盘**」）：

```powershell
curl.exe -s "http://127.0.0.1:19387/work-personal-secretary/api/basedeck?workspace=E%3A%2Flina"
# → 不改任何配置，直接看到「改完之后」的真实八项状态
# 可带参数：?workspace= / ?obsidianDir=（解析见 lib/api.js:1211-1225）
```

**价值**：判断某处 config 改动的收益时，先用带参预演拿真机结果，再决定改不改 —— 比"改完重启再看"快得多且零风险。2026-09-30 修 `workspace` 时正是靠它一次拿到改后状态（见 §3 P0 的更正）。

---

## 2. 已完成（逐项）

### 2.1 六个插件的 rc.2 兼容（peer 闸门）

| 模块 | 版本变化 | profile 形态 | 说明 |
|---|---|---|---|
| `dsh-work-memory` | 1.0.9 → **1.0.11** | Junction → 源码 | 含设置迁移 |
| `work-personal-secretary` | 1.1.9 → **1.1.12** | Junction → 源码 | 含设置迁移 + 桌面载体修复 |
| `workspace-tokenpet` | 1.0.4 → **1.0.5** | Junction → 源码 | 仅 peer |
| `dsh-experts` | 0.5.13 → **0.5.15** | Junction → 源码 | 含设置迁移 |
| `dsh-doc-suite` | 0.7.17 → **0.7.19** | Junction → 源码 | 含设置迁移 |
| `dsh-mermaid` | 0.4.0（未动） | 实体 | **无 `@deepseek-ai/dsh*` peer，天然免疫** |

- **peer 范围**：`^0.1.5-rc.1`（展开为 `>=0.1.5-rc.1 <0.2.0-0`，**拒绝 0.2.0-rc.2**）→ 统一改为 `>=0.1.5-rc.1 <0.3.0`。
- **Junction 的意义**：5 个模块的 profile 安装位由实体副本改为指向源码，**以后改源码即生效**，不会再出现「源码改了 profile 还是旧的」。

### 2.2 设置迁移（rc.2 的 Config + volatile）

rc.2 **只把「有具名导出 `Config` 且字段带 `.volatile()`」的插件纳入 `settings.describe()`**。四个模块已迁移：

| 模块 | 暴露字段 |
|---|---|
| 集成体 | `repoRoot`（1 项） |
| `dsh-work-memory` | **24 项全 volatile** |
| `dsh-experts` | 19 项中 **18 项**（`expertInjectMax` 按既有口径刻意不暴露） |
| `dsh-doc-suite` | **15 项**（DEFAULTS 由 11 → 15 键，补齐 patch 的 4 个键） |

**统一实现模式**（见 `modules/work-personal-secretary/lib/settings.js` 1.1.12 版为参考实现）：
1. `withVolatile(field)` 特性探测 —— volatile 是 schemastery **3.18.3** 才有的方法，而 peer 下界是 `^3.18.1`，schema 在**模块顶层求值**，裸调会 TypeError 致整个插件加载失败；
2. `export const Config = <schema>`，入口 `lib/index.js` 用 `export { Config } from './settings.js'` 透出；不可用时导 **`undefined`（不能是 null**，rc.2 判据 `'toJSON' in schema` 对 null 会抛）；
3. `unwrapValue()` 用官方同协议 `Symbol.for('cosmokit.volatile.write')` 解包（**不要**用 `typeof v.get === 'function'`，会误伤 `Map`）；
4. `installSettings` **双分支**：有 `ctx.settings.register` 走 0.1.x 老路；没有（rc.2）走 `mode='config'`，且 **`read()` 每次实时重算** —— rc.2 的 volatile 由 loader **就地更新**（`entry.ts:162-195` `_commitVolatile` → `updateVolatile`），不重跑 apply，缓存快照会立刻过期。

### 2.3 桌面载体两缺口（1.1.12）

| 问题 | 根因 | 修法 |
|---|---|---|
| 点「自动生成」报 **缺少 Origin 头** | `sameOriginGuard` 要求 POST 必带 `Origin`，而官方桌面壳 fetch 桥**不发 Origin** → 所有写操作 403 | 放宽为「**不带 Origin 放行；带了必须同源**」，保留 content-type 校验、`Origin: null` 仍拒 |
| 「保存仓库目录」失效 | `/repo-root` **不在** `CORE_API_EXACT_PATHS`，而桌面壳只认 exact 路由 | 加入该集合（12 → 13 条） |

**同批**：`dsh-work-memory` 的守卫也同步放宽（否则记忆体面板按钮在桌面端下 403）。

### 2.4 其他已完成

- **白名单对齐**：`SETTINGS_NS_WHITELIST` 由包名 `dsh-doc-suite` 改为 **entry id `doc-suite`**；并加 `SETTINGS_NS_ALIASES` **别名归并**，使 0.1.x（用包名注册）与 rc.2 都能命中。
- **`discipline.js` 记忆根通道**：原走 `ctx.settings.get()`（rc.2 **没有** `get`）→ 静默落到兜底，**实测会指到 `<DSH_HOME>\memories\lina`（错目录）**；已补 `describe()` 通道 + apply 预热（describe 异步 / 注入回调同步 → 同步读缓存 + 后台刷新）。
- **`mediaArkApiKey` 加 `role('secret')`**：不然密钥会明文出现在 `/settings` 响应与能力配置页；并加 `withSecretRole()` 特性探测（mock 无 `role` 时裸调会崩）。
- **回归**：集成体七套 + 子插件 12 脚本 = **失败总数 0**（截至 2026-09-30 21:26）。

---

## 3. 未完成（新对话接手清单，按优先级）

### ✅ P0（2026-09-30 晚已修，待重启复验）—— `workspace` 未配置，导致「核心配置」误判 4 项

> **当前状态**：profile patch 已写入 `workspace: '<工作区>'` → **待重启 DSH 后复验**。
> 修复前：`workspaceSource=derived`、`setupNeeded=true`；预演显示修复后：`workspaceSource=config`、`setupNeeded=false`。

**现象**：设置 →「工作秘书」顶部横幅显示「还差 4 项」。

**根因（已实测，非推断）**：

```
curl.exe -s "http://127.0.0.1:19387/work-personal-secretary/api/basedeck"
→ workspace = "<存储根>/obsidian-data"   workspaceSource = "derived"
  workspaceNote = "工作区由记忆镜像目录反推（…/00_全局记忆 的父目录），请确认"
  setupNeeded = true
  summary = { total:8, toWrite:3, upToDate:4, blocked:0, none:1 }
  [append]     agentsMd      :: 未发现标记块，将在文件末尾追加完整块
  [update]     memorySeed    :: 将追加 4 条种子条目
  [append]     skills        :: 共 5 个技能：一致 0 / 缺失 5 / 本地改过 0
  [up_to_date] settings / dirs / memoryDeck / migrateMemory
  [none]       knowledgeDeck :: 没有指定 Obsidian 知识库目录
```

`lib/basedeck.js:796-846` 的 `resolveWorkspace()` 五级优先级：
① query 显式 `workspace` → ② **`configWorkspace`（= 集成体 entry config 的 `workspace`）** → ③ 由记忆镜像目录**反推** → ④ cwd → ⑤ candidates。
真机 ①② 皆空 → 走 ③，推出 `<存储根>/obsidian-data`。
而 `:833` 的判定标准是「**像工作区（有 AGENTS.md / .dsh / .git）**」—— vault 目录不符合 → `agentsMd` / `skills` 被判「要新建 / 缺失」。

**修法·执行记录（2026-09-30 晚，已执行）**：

⚠️ 关键细节：该 patch 的**已有** `- id: work-personal-secretary` 块（`repoRoot` + `selfCheckOnStartup`）才是落点 —— 文件头写明「按 id 定向覆盖插件 config（**整块替换**，故字段写全）」，**不能新增第二个同名 entry**（会覆盖掉 `repoRoot`）。实际改动是**现有块内加 1 行**：

```yaml
- id: work-personal-secretary
  config:
    repoRoot: '<工作区>/DSH插件/src/work-personal-secretary'
    selfCheckOnStartup: false
    # 2026-09-30 修复：显式指定工作区，避免 /basedeck 由记忆镜像目录反推成知识库 vault
    #（反推目标 <存储根>/obsidian-data 会把 AGENTS.md 与技能写进真相源 vault）
    workspace: '<工作区>'          # ← 仅新增这一行
```

- 备份：`<工作区>\backup\2026-09-30-patch-workspace前\cordis.patch.yml.bak`
- 校验：`node -e "require('js-yaml').load(...)"` → **解析通过，entries=15**（仍是 15 条，未新增条目）
- 生效：**需重启 DSH**（`workspace` 是普通 entry config，非 volatile → 不会就地更新）

**⚠️ 预期收益更正（原文档此处写错两处，以真机预演为准）**：

| 原文档预期 | 真机预演实测 |
|---|---|
| `agentsMd` / `skills` 应变 `up_to_date` | 实为 `user_modified`：AGENTS.md 块内被手工改过、5 个技能里 3 个本地改过 → **系统拒绝自动覆盖**（保护行为，正确） |
| 横幅数字降到 **1**（只剩 `memorySeed`） | 不是"降到 1"，而是**横幅整个消失** —— 客户端只在 `setupNeeded===true` 时显示（`client/index.js:6396`），而 `computeSetupNeeded` 只看 `agentsMd==='append'` / settings 有 `action:'write'` / skills 有 `state:'missing'`（`lib/basedeck.js:1024-1042`），改后三者皆不成立 |

**⚠️ 严重性上修（原文档只写"误判"，实为误写风险）**：修复前 `agentsMd`/`skills` 的 `autoApplyable: true`，且 target 直指 vault（`<存储根>/obsidian-data/AGENTS.md`、`…\.dsh\skills`）—— 只要在 UI 点一次「自动生成」就会往**真相源 vault** 写文件。故本项不是显示问题，是污染风险；`workspace` 必配。

**决策留痕**：2026-09-30 晚主人批准执行。`workspace` 决定 basedeck **往哪个目录写 AGENTS.md 块与装技能**，系需用户拍板项。`<工作区>\AGENTS.md` 已有 wps 块，但块内正文与本版模板 **content-hash 不一致**（本机曾手工改过）→ 被判定 `user_modified`，**不会自动覆盖**，按既有的"只更新块内、写前备份"保护路径继续。

**⚠️ 注意区分两个概念**（本对话在这里连错两次）：
- **「存储根目录」= `rootDir`**（UI 里唯一那一项，`:261`）→ 应为 `<存储根>`（`memory-data` / `obsidian-data` 的父目录）；提交时只带 `memoryDir` / `obsidianDir` / `obsidianSyncDir`（`:3438/3476`）。
- **「工作区」= `workspace`** → 应为 `<工作区>`；**UI 里根本没有这一项**。

**真机只读预演对照（2026-09-30 取证，`?workspace=E%3A%2Flina`，零写入）**：

| 指标 | 修复前（不带参 = derived） | 预演修复后 |
|---|---|---|
| workspace / source | `<存储根>/obsidian-data` · **derived** | `<工作区>` · client（重启后为 config） |
| setupNeeded | **true** | **false** |
| summary | total 8 / toWrite 3 / upToDate 4 / blocked 0 / none 1 | total 8 / **toWrite 1** / upToDate 4 / **blocked 2** / none 1 |
| agentsMd | `append`（target 指向 vault） | `user_modified`（不自动覆盖） |
| skills | `append`（target 指向 vault） | `user_modified`（一致 2 / 本地改过 3） |

**另一项遗留口径澄清**：`knowledgeDeck: none` **无法用 profile patch 消除** —— 知识库根 `obsidianDir` 只接受 query / overrides 显式传入（`lib/basedeck.js:934-937` 注释明写"绝不从镜像目录反推"），**没有 config 键**；但它**有 UI 入口**（核心配置页 `coreFieldObsidianDir`，`client/index.js:3664`）→ 需在页面上填，不属本 patch 范围。

### 🟠 P1 —— `dsh-doc-suite` 的密钥通道（功能级）

`modules/dsh-doc-suite/scripts/media/gen_image.py` 读 `~/.dsh/settings.yaml` 取 ARK 密钥，而 **rc.2 首启已把该文件搬为 `settings.yaml.imported`** → 走设置页填的密钥读不到，只剩 `--api-key` / `ARK_API_KEY` 环境变量。
**修法方向**：改从 profile 的 `cordis.patch.yml`（entry `doc-suite` 的 `config.mediaArkApiKey`）读，或明确要求走环境变量。

### 🟠 P1 —— 自定义岗位不持久化

「新建岗位」的条目只存在**前端组件内存**（`client/index.js:3312` 的 `.concat(st.custom)`），重开即消失。
**注意**：**岗位正文没有丢** —— 它经 `POST /identity/save` 写进记忆库 `MEMORY.md` 的「使用者身份」条目（已核实 `MEMORY.md:27` 是主人最新填的内容）。
**修法方向**：给自定义岗位加存储（settings 键 + schema，或写 workspace 下文件）。

### 🟡 P2 —— 其他

| 项 | 说明 |
|---|---|
| `workspace` 无 UI 入口 | 「核心配置」页只能选 `rootDir`，没有任何地方能填 `workspace`，只能靠反推；反推错了界面上也看不出来。**设计缺口** |
| 「底座状态明细」不显示 | core 页只做检测不展示 8 项明细（`client/index.js` 注释写「五项底座计划」但 `BASEDECK_ITEMS` 实为 8 项）。用户看不到「还差几项」是哪几项 |
| `snapshotOrder` 等 | 标了 volatile（进表单）但消费点是 apply 时读取 → **改它仍需重启**（description 已注明） |
| `doc-suite` 的 `SETTINGS_NS` | 常量仍是包名 `dsh-doc-suite`（rc.2 不经过它；0.1.x 注册用它）。已用别名归并兜住，未改常量 |
| `expertInjectMax` 文案 | 已改为指向 profile patch；但它不 volatile → **rc.2 设置页看不到这条文案**（0.1.x 可见） |
| 代码未 git 提交 | 本批改动面大，主人此前定「其他会话改动复核后一起提」，**尚未提交** |

---

## 4. rc.2 关键机制备忘（三条硬规则）

1. **闸门**：`peerDependencies` 里匹配 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的项若不满足运行时版本，**整个 bundle 被跳过**（bundle 级 `skippedBundles` / 行级 disable）。
2. **设置只认 volatile**：`settings.describe()` 只投影带 `.volatile()` 的字段；整棵 schema 无 volatile 时**该 entry 不进设置页**（`schema.ts:37-47` + `index.ts:308-309`）。命名空间 = **profile entry id**（`index.ts:315,326`）。
3. **volatile 是就地更新**：`loader/config/entry.ts:162-195` 的 `_commitVolatile` → `updateVolatile(ref, source)`，**不重跑 apply、不重启 fiber** → 任何缓存了 config 的读取点都会过期。

---

## 5. 本对话踩过的坑（新对话请勿重蹈）

1. **不要用本地复算代替真机取证** —— 我传错 `workspace` 参数，得出「4 项里 3 项是误算」的结论，与真机（`append`，工作区错）**语义相反**，被主人当场指出。**先 `curl` 真机接口**。
2. **可选加固要先评估对夹具的影响** —— `verify` 建议把 `if (!host)` 提到 `if (!origin)` 前（它自己标"可选、非阻塞"），我实施了，结果**测试夹具不带 Host** → `basedeck-test` 抛 TypeError。已撤回。
3. **放宽匹配时要想两端** —— 白名单从包名改 entry id 修好了 rc.2，却**弄坏 0.1.x**（子插件在 0.1.x 用包名注册）。靠 `SETTINGS_NS_ALIASES` 别名归并收场。
4. **正则/字符串断言要跟着写法迁移** —— `countSchemaKeys` / `injection-tier-test` 的默认值正则都写死了 `key: z.`，被 `withVolatile(...)` 打破（先跑会红）。修法是**拍平包裹再匹配**，注意 `withVolatile\(([^)]*)\)` 会停在第一个右括号，应用允许一层嵌套的模式。
5. **`edit` 前必须先 `read`**（含重启后，读取记录会清空）；`team_task_update` 对 **blocked 任务不能 reassign**，必须先完成依赖或去掉 `blocked_by`。

---

## 6. 常用命令

```powershell
# 真机读配置底座状态（最有用的排查手段）
curl.exe -s "http://127.0.0.1:19387/work-personal-secretary/api/basedeck"

# 集成体七套（在 modules\work-personal-secretary 下）
foreach ($s in @('smoke-load','probe-test','install-test','basedeck-test','settings-api-test','identity-test','defaults-test')) { & node "scripts/$s.mjs" }

# 子插件
# work-memory: regression
# experts: regression / injection-tier-test / capability-test / coexist / smoke-load
# doc-suite: style-test / media-test / ppt-render-test / ppt-style-test / ppt-theme-test

# 环境探针（不依赖宿主）
node -e "import('./lib/probe.js').then(async m => console.log(JSON.stringify((await m.runProbes()).summary)))"
```

**注意**：本机 pwsh 直跑 `npm` 会被执行策略拦（`npm.ps1`），用 `cmd /c "npm run check"` 或直接 `node scripts/*.mjs`。

---

## 7. 回退口子

- `<工作区>\backup\2026-09-30-rc2修复前\` —— 5 个模块的旧副本 + `cordis.patch.yml.bak`
- `<工作区>\backup\2026-09-30-DSH重装前\` —— 2.3 GB 全量（含 sessions / attachments / data）
- 回退步骤：换回实体副本 → 恢复 patch → 重启（**Junction 直接删链即可，源码不受影响**）

---

## 8. 新对话开场建议

1. 先读本文件 + `RC2-ADAPTATION-PLAN.md` 的 §0.1 / §0.2 / §0.3；
2. **第一件事：`curl` 一次 `/basedeck`**，把真机状态拿在手上再讨论；
3. **P0 已修**（2026-09-30 晚 `workspace: '<工作区>'` 已进 profile patch）→ 新对话第一件事是**请主人重启 DSH，然后 `curl` 复验**：`setupNeeded` 应为 `false`、`workspaceSource` 应为 `config`、`agentsMd.target` 应指向 `<工作区>`；
4. 其余按第 3 节的优先级推进；**动 before-code 之前先跑回归**（第 6 节命令）。

---

## 9. 2026-09-30 深夜补记 —— 配置取值通道整改（本体 1.1.13，已真机验收）

> 这一节推翻了第 3 节原本的叙事框架：**问题不在 rc.2**，而在本体自己。

### 9.1 真根因：本体留了一条"直读宿主 settings.yaml"的旁路

| 位置 | 事实 |
|---|---|
| `lib/setup-state.js:4-7` | 本体自己写明的纪律：「取值**只走宿主设置服务**（`ctx.settings.describe`）……**绝不自己去读 `~/.dsh/settings.yaml`**」 |
| `lib/basedeck.js`（1.1.4 引入） | 但配置底座的计划器 `resolveDeckContext()` **直读**该文件（`readSettingsValues`），还自带一套 YAML 扫描 + 逐行改写引擎（`inspectSimpleYaml` / `planSettingsWrite`）**写**回它 |
| `ARCHITECTURE.md:120` | 本体文档自己把这条矛盾记成了「**两处取设置值的路径不同**（维护时要注意）」 |

rc.2 把 `settings.yaml` 搬迁为 `settings.yaml.imported` 后旁路断供 → `/basedeck` 八项**全判「待配置」**（记忆库回落默认目录、知识库 none、岗位读不到、setupNeeded=true）。旧进程有缓存，所以**重启才暴露**。

### 9.2 已做的整改（1.1.13）

1. **读通道统一**：新增 `options.settingsValues` 注入；api 层 `deckSettingsValues()` 经 `ctx.settings.describe` → `buildSettingsView` 取值后注入计划器（与 `/setup-state` 同源）。仅未注入时（脚本 / 单测 / 0.1.x）退回文件兜底并标 `settingsSource='file'`。**只注入「设置里确实存在」的键**，保住「没配过」与「配了空值」的区别。
2. **写通道统一**：`POST /basedeck` 落盘前先经 `ctx.settings.mutate` 写，再重算现值 → **不再碰宿主的 settings.yaml**。
3. **知识库路径进配置**：新增集成体配置键 `obsidianDir`（settings schema + `index.js` 透传 + api 注入 + README 表 + profile patch）。
4. **岗位信息落配置文件**：profile patch 新增 `experts` entry 覆盖层（**写全 20 键**，防「整块替换」把 `expertInjectMax` 等刻意档位打回默认）：`defaultDomain: infosec` / `identityExpert: ''` / `expertSetupDone: true`。

### 9.3 踩坑留痕（新对话请勿重蹈）

- **volatile 字段必须解包**：rc.2 下带 `.volatile()` 的 config 键是**引用对象**。`repoRoot` 解了包、`obsidianDir` 漏解 → 配置"看着配好却不生效"（`knowledgeDeck` 恒为 `none`）。现两者都走 `unwrapValue()`，且 api 层用 `currentObsidianDir()` 读**实时值**（与 repoRoot 的热更口径一致）。
- **不要再用文件兜底去验证配置**：判配置对不对，先看 `/basedeck` 的 `settings` 项 target 是否为「宿主设置（profile / 设置服务）」与各键的 `keepExisting`。

### 9.4 真机验收结论（2026-09-30 深夜，重启后实测）

```
workspace = <工作区> (config)      memoryDir = <存储根>/memory-data
setupNeeded = false               summary = {total:8, toWrite:0, upToDate:6, blocked:2, none:0}   ← 收尾后（种子已写、开局包已生成）
agentsMd      user_modified  -> <工作区>/AGENTS.md          （本地定制，不覆盖）
memorySeed    update         -> …/MEMORY.md                （真实缺口：4 条种子未写入）
skills        user_modified  -> <工作区>/.dsh/skills        （3 个本地改过，不覆盖）
settings      up_to_date     -> 宿主设置（profile / 设置服务）
dirs          update         -> 4 个目录全部存在；开局包 ready（16 文件 / 18 目录待写）
memoryDeck    up_to_date     -> <存储根>/memory-data
knowledgeDeck up_to_date     -> <存储根>/obsidian-data   （骨架登记 6 / 缺失 0）
migrateMemory up_to_date     -> 无需迁移
```

- `/setup-state`：`工作岗位：信息安全（预置岗位）`、`记忆库目录：来自设置`、`知识库目录：由记忆镜像目录反推`。
- 集成体七套回归全绿（probe 151 / install 246 / settings-api 115 / identity 73 / defaults 61 / basedeck 567 / smoke-load 533，失败 0）。
- 基线备份：`<工作区>\backup\2026-09-30-配置通道整改前\`（源码 1.1.12 + patch）。

### 9.5 使用者的两条后续指令（2026-09-30 深夜，均已执行并验证）

**① 种子写入 + 指令层去重**

- **写入 4 条种子**：走本体原生通道 `POST /basedeck {ids:["memorySeed"],dryRun:false}` → `MEMORY.md` 末尾追加 4 条（语言偏好 / 协作方式 / 专家库 / 工具与技能），**既有 16 条逐字节保留**，写前备份 `MEMORY.md.bak-20260930-221158-552`；`memorySeed` 项随即转 `up_to_date`。
- **指令层去重**：同一套措辞原先在「指令模板 + 记忆种子」两处，属重复维护。现由**记忆种子单一承担**：
  - 工作区 `<工作区>\AGENTS.md` **块内**删掉与种子重复的三节（语言 / 工作方式 / 专家库使用流程），178 → 150 行；**块外使用者的硬性版原样保留**（安装器不动块外）。
  - 随包模板 `modules/work-personal-secretary/defaults/AGENTS.zh-CN.md` 同步删除同三节，68 → 39 行，`template-version` **1 → 2**（模板头约定：措辞实质变更时 +1）。
  - `README.md` 的「默认约定」段改写为单一载体口径，并说明「若想让它们在**指令层**生效（约束力强于记忆层），请在使用者自己的 `AGENTS.md` 块外声明」。
  - `scripts/basedeck-test.mjs` 断言迁移：不再写死 `template-version === 1`（改为「可编译 + 版本是正整数」），并**新增 3 条护栏**——真实模板**不得**再含「语言（回答与思维）/ 工作方式（总控兼读制）/ 专家库使用流程」。
- ⚠️ **代价要说清**：语言与协作规则从「指令层」转为「记忆层」承担（DSH 每轮注入，但约束力弱于指令层，见模板头注释）。真机上 `agentsMd` 因此保持 `user_modified`——**块内被手工改过，集成体不覆盖**（这正是保留删改的机制）。

**② 开局包：写入新机器 + 已有值不覆盖（已实测）**

- 生成：`POST /basedeck {ids:["dirs"],dryRun:false}` → `<存储根>/开局/`（16 文件 / 18 目录；既有 4 个目录跳过、0 个新建）。
- **不含本机路径**：`后置优化包/清单.json` 的 `dst` 全用 `{{workspace}}` / `{{memoryDir}}` / `{{obsidianDir}}` / `{{backupDir}}` 占位符；实测 grep `<工作区>` 命中 **0**。
- **已有值不覆盖（实测）**：手工往 `开局/记忆库/MEMORY.md` 追加一行标记 → 重跑同一条命令 → `wroteAny=false`、detail「开局包已完整（16 个文件均在，未写盘）」、标记**原样保留**；验证后已把标记还原（残留 0）。
- **核查回路口径**（`verifyStarterPack`，`lib/basedeck.js:3404-3492`）：按清单逐项判 `missing / match / differs / broken`，`pending = missing+differs+broken > 0` → **`differs` 不会被静默覆盖，要人工确认保留**。

**收尾后的真机状态**：`{total:8, toWrite:0, upToDate:6, blocked:2, none:0}`，`setupNeeded=false`；剩 2 项 `user_modified`（`<工作区>\AGENTS.md` 块、`.dsh/skills`）是**本地定制保护**，非待办。

### 9.6 仍然待办

1. 代码**尚未 git 提交**（本轮 12 个文件 + 上一批 rc.2 适配遗留 4 个文件，提交时分列）。
2. 第 3 节 P2 的其余项（`workspace` 无 UI 入口、底座明细不展示、`snapshotOrder` 需重启、doc-suite 密钥通道）仍然有效。
