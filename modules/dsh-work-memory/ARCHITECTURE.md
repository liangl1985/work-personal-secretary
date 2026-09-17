# dsh-work-memory · 模块说明（维护者向）

本文件只描述**已在代码里实现**的行为，结论一律带出处。文内路径均**相对于本模块根目录**（`modules/dsh-work-memory/`），行号对应当前检出状态（`package.json` 版本 **1.0.6**，`package.json:3`）。
文档（README / schema description）与代码不一致处已单独标注，冲突时以代码为准。

---

## 1. 架构

### 1.1 一句话定位

`dsh-work-memory` 是 DSH 的**执行层长期记忆插件**：把"全局永不遗忘 / 热记忆到期转冷 / 冷记忆被用到即转热"的三级模型做成 **host 半**（每轮注入 + 3 个工具 + 7 个命令 + HTTP API + 设置命名空间）与 **client 半**（右侧边栏「记忆库」面板），并可把整库**单向镜像**到 Obsidian 目录。

- 出处：`lib/index.js:4-9`（五条核心能力：注入 / 工具 / 命令 / Web API / 原生设置）；
- 出处：`lib/archive.js:4-7`（三级记忆模型的权威定义）；
- 出处：`package.json:4`（包描述）；
- 替谁做什么：替模型在跨会话之间保存与召回状态（身份、偏好、项目经验、当日流水），并保证热区不会被旧数据无限膨胀——通过"被用到才算热"的 TTL 顺延与转冷预审。

### 1.2 目录与关键文件职责

| 位置 | 职责 | 出处 |
|---|---|---|
| `lib/index.js`（521 行） | 插件入口：`apply()`；注入快照；组装 3 工具；注册 7 命令；安装 Web API；`memoryRoot()` 热解析 | `lib/index.js:30-33`、`76-92`、`116-155`、`158-190`、`192-508`、`510-515` |
| `lib/settings.js`（153 行） | 设置命名空间 `work-memory`：`DEFAULTS`（24 键）、`MEMORY_SETTINGS_SCHEMA`、`installSettings` | `lib/settings.js:18`、`24-49`、`52-97`、`126-153` |
| `lib/store.js`（224 行） | 存储层：`MemoryStore`（原子写 / drift 防护）、条目解析与序列化、目录级文件锁 | `lib/store.js:10-15`、`97-156`、`167-212` |
| `lib/context.js`（168 行） | **注入快照**生成（分段上限、优先级、截断标注）；`memoryFiles()`；`sanitize()` | `lib/context.js:4-14`、`59-150`、`153-163`、`166-168` |
| `lib/tools.js`（381 行） | `createTools()`：3 个工具的实现与 schema；分类护栏、去重、子代理门控、写后懒触发 | `lib/tools.js:25-28`、`89-148`、`150-226`、`228-251`、`270-380` |
| `lib/scope.js`（51 行） | 写入范围的**纯函数**判定（`auto/global/user/project/daily`）+ 分类判据文本 | `lib/scope.js:15`、`18`、`30` |
| `lib/archive.js`（478 行） | 冷热分层主逻辑：`runArchive`、`promoteEntry`、`keepEntry`、`archiveEntryById`、TTL 起始点 | `lib/archive.js:33-38`、`53-67`、`123-311`、`344-397`、`419-478` |
| `lib/triage.js`（330 行） | **转冷预审**：信号标记、打分 `judgeEntry`、上下文收集、`.triage.json` 读写 | `lib/triage.js:33-51`、`116`、`179`、`233-331` |
| `lib/access.js`（95 行） | `.access.json`："被用到"的判定与刷新（**红线**：注入/面板/巡检不算） | `lib/access.js:4-14`、`23`、`53-67` |
| `lib/graph.js`（118 行） | `GRAPH.json` 关系图：`registerEntry` / `linkEntries` / `pruneEntity` | `lib/graph.js:21-26`、`71`、`101`、`116` |
| `lib/backup.js`（147 行） | 每日全量备份 `backupMemory`；**Obsidian 镜像** `syncMemoryToObsidian` | `lib/backup.js:2-8`、`37-77`、`104-147` |
| `lib/clock.js`（72 行） | 本地时区时间工具（日界 = 本地 00:00） | `lib/clock.js:2-7`、`13`、`23`、`48`、`60` |
| `lib/api.js`（382 行） | Web GUI API：13 条路由 + 前缀路由；同源保护；`.api-access.log` | `lib/api.js:18`、`47-59`、`82-359`、`361-376`、`74-80` |
| `client/index.js`（743 行） | 客户端：resource protocol + 右侧边栏 tab + 「记忆库」面板 + zh/en 词条 | `client/index.js:26`、`83-129`、`183-243`、`265-302`、`689-714` |
| `scripts/regression.mjs`（585 行） | 回归测试（`npm test` / `npm run check` / `prepack`） | `scripts/regression.mjs:1-5`、`package.json:33-37` |
| `cordis.patch.yml` | bundle patch：`insert` entry `work-memory`，config 为**中性部署默认层** | `cordis.patch.yml:8-29` |

### 1.3 三级记忆模型

| 层 | 载体 | 规则 | 出处 |
|---|---|---|---|
| 全局 | `MEMORY.md` | **永不遗忘**，不进入任何 TTL 列表 | `lib/archive.js:5`、`190` |
| 热 | `USER.md` / `PROJECTS/*.md` / `DAILY/*.md` | 到期转冷；`关键` 条目永不转冷 | `lib/archive.js:6`、`212-213` |
| 冷 | `ARCHIVE/` | 不注入、可检索；**被用到即转热**（按原 id、原文写回原范围） | `lib/archive.js:7`、`16-17`、`344-397` |

**TTL 与起始点**（规则定死，易被误解）：

- 周期：DAILY 7 天（**按文件**为单位、按周合并进 `ARCHIVE/daily-YYYY-Www.md`）、项目 30 天、偏好 90 天、`关键` 永不 —— `lib/archive.js:9-14`；
- **基准日 = max(写入日, 最后使用日)**；转冷条件是 `今天 − 基准日 > TTL`，即 **TTL 天内（含第 TTL 天）仍算热**，第 TTL+1 天才转冷 —— `lib/archive.js:40-58`、`60-67`；
- DAILY 以文件为单位判到期：基准日 = max(文件名日期, 文件内任一条目的最后使用日) —— `lib/archive.js:145-159`。

**"什么算被用到"（红线）**：

- 算：`memory_recall` 命中返回、`memory_link` 建边两端、冷转热写回 —— `lib/access.js:7-10`；
- **不算**：每轮注入快照、面板浏览、`/memory_audit` 巡检、`/memory_maintain` 自身 —— `lib/access.js:12-14`（并明确"注入若算使用，TTL 永不生效"）；注入侧不刷新访问记录 —— `lib/context.js:13-14`。

### 1.4 转冷预审（到期 ≠ 立即冷）

- 提前量：`NOTICE_DAYS = 7`（到期前 7 天先判一遍）—— `lib/archive.js:37-38`；
- 三种判定：`keep`（自动保留并顺延一个 TTL）/ `cold`（到期即冷）/ `ask`（信号不足进**待判断队列**）—— `lib/archive.js:239-283`；
- 判定输入：近 7 天日志、全局与热记忆文本、图谱度数、访问次数 —— `lib/archive.js:240-249`、`lib/triage.js:179`；
- **待判断由助手判定**（`/memory_triage keep|cold <id>`），超宽限（默认 7 天）未判则自然转冷 —— `lib/index.js:406-414`、`lib/archive.js:259-276`；
- 判定只写 `.triage.json`，**不删不改任何记忆条目** —— `lib/triage.js:249`、`lib/archive.js:299-305`。

### 1.5 并发与一致性

- 同进程重入计数 + 目录级文件锁 `.work-memory.lock`（`wx` 独占创建、10 秒判陈旧、5 秒超时、25ms 重试）—— `lib/store.js:158-212`；
- 写盘为"写临时文件 `.tmp.<pid>` → `rename` 覆盖"；写入前做 drift 检查，发现外部改动则把当前文件改名为 `.bak.<时间戳>` 并抛错 —— `lib/store.js:142-155`；
- 锁按本地文件系统设计（网络盘 / 同步盘上可能退化）—— `README.md:95`。

---

## 2. 数据流

### 2.1 入口 → 处理链路

**入口 1：每轮注入（`ctx.systemPrompt.context`）**

```
ctx.systemPrompt.context({ name:'work-memory:snapshot', order: cfg.snapshotOrder, text })   lib/index.js:116-119
  → if (!cfg.injectMemory) return ''                                                        lib/index.js:120
  → dailyLog()：自动写一条今日活动日志（10 分钟防抖）                                        lib/index.js:103-115
  → branch = 会话 cwd 的最后一段路径（推断项目名）                                            lib/index.js:123-131
  → buildSnapshot({ root, maxChars, branch, limits, maintainDays, triageAsk, globalWarnCount })   lib/index.js:132-146
  → 返回 '【' + personaLabel + '】\n' + snapshot；内容不变时返回上次文本（保持缓存稳定）        lib/index.js:149-153
```

快照组装规则（`lib/context.js:4-14`、`59-150`）：

- 分段上限默认 全局 20 / 偏好 12 / 项目 16 / 今日 8，总字符 4000；优先级 `关键 > 常规 > 临时`，**`敏感` 不自动注入**（`lib/context.js:47-52`、`24`）；
- 偏好 / 项目按"最近更新"倒序，**全局保持原顺序** —— `lib/context.js:33-44`、`75`；
- 今日日志**过滤自动活动行**（前缀 `对话进行中`），取最近若干条 —— `lib/context.js:93-100`、`lib/store.js:12`；
- 超上限时按 今日 → 项目 → 偏好 → 全局 顺序砍尾；全局段的 `关键` 条目受保护；被砍段尾补"（另有 N 条未注入，用 memory_recall 查）" —— `lib/context.js:120-149`；
- 附加提醒：全局超阈值（默认 20）告警、距上次周保养超期提醒、**转冷待判断 N 条**提醒 —— `lib/context.js:78-80`、`102-106`、`108-116`。

**入口 2：工具（`memory_remember` / `memory_recall` / `memory_link`）**

```
memory_remember(content, tag, scope, branch)
  → handleRemember()                                                     lib/tools.js:89-148
  → resolveWriteScope({requested, explicitBranch, sessionBranch})        lib/tools.js:97-104 → lib/scope.js:30
  → 子代理门控：subagent 不可写 global/user                               lib/tools.js:107-109
  → memoryFiles(root,{branch}) 定目标文件                                 lib/tools.js:111-116 → lib/context.js:153-163
  → withDirLock：去重 → tag=关键 进 SUGGESTIONS.jsonl（不落库）→ 否则 store.add + registerEntry   lib/tools.js:119-139
  → 锁外懒触发：maybeArchive() → maybeBackup() → maybeSync()              lib/tools.js:142-146、42-63
```

`memory_recall`：

- `scope=archive` 走冷区：命中即**逐条 `promoteEntry` 转热**（写回原范围）+ `touchAccess` + `maybeSync` —— `lib/tools.js:159-183`；
- 其它范围按 global/user/daily/**全部 PROJECTS 文件**检索，`关键` 优先排序，返回前 `limit`（1–20 封顶）条并 `touchAccess` —— `lib/tools.js:185-225`。

`memory_link`：在锁内按片段定位两端条目 → `linkEntries` 建边 → `maybeSync` —— `lib/tools.js:228-251`。

**入口 3：命令（7 个）与实际落盘动作**

| 命令 | 链路 | 出处 |
|---|---|---|
| `/memory_review` | 读 `SUGGESTIONS.jsonl` 逐行 JSON 解析展示 | `lib/index.js:193-212` |
| `/memory_archive` | `runArchive(root, {dailyRetentionDays, projectTtlDays, userTtlDays})` | `lib/index.js:215-240` |
| `/memory_backup` | `backupMemory(root, {backupDir, keep})` | `lib/index.js:243-259` |
| `/memory_audit` | 统计各范围条数 + 可疑条目正则 + 图谱枢纽/孤儿 + 预审状态 | `lib/index.js:262-346` |
| `/memory_maintain` | `runArchive(force:true)` + `markMaintain` + 访问记录清理 + 转热候选 | `lib/index.js:349-438` |
| `/memory_promote <id>` | `promoteEntry(root, id)` | `lib/index.js:441-456` |
| `/memory_triage [keep\|cold <id>]` | `listPending` / `keepEntry` / `archiveEntryById` | `lib/index.js:459-508` |

**入口 4：HTTP API（面板与外部前端）**

```
client（resource protocol 轮询）→ fetch /work-memory/api/*
  → lib/api.js handler：logAccess → 前缀判定 → 路由分派                lib/api.js:82-90
  → 写操作先过 sameOriginGuard（必须 application/json + Origin 同 host）  lib/api.js:222-225、47-59
  → 落盘走 MemoryStore + withDirLock；新增条目同步 registerEntry           lib/api.js:259-279
```

路由注册为**前缀 + 精确两套**：prefix 供浏览器 HTTP，exact 供桌面载体的精确路由桥 —— `lib/api.js:361-376`。

**入口 5：设置变更**

```
ctx.settings.register('work-memory', SCHEMA, { base })               lib/settings.js:132
settings.watch(next => { cfg = next; Object.assign(liveArchiveCfg/liveBackupCfg); memoryRoot() })   lib/index.js:47-65
```

- `memoryDir` 热切换：`memoryRoot()` 每次取值重新解析，新目录建得出来才切换，建不出来则 warn 并沿用旧目录（同一失败目标只 warn 一次）—— `lib/index.js:72-92`；
- `order` 在注册期固定，改 `snapshotOrder` 需重启；其余键免重启 —— `lib/index.js:97-98`、`README.md:46`。

### 2.2 落盘位置（写哪些文件、写到哪）

记忆库根目录：`<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory`（`memoryDir` 可覆盖）—— `lib/store.js:22-26`、`33-35`。

| 文件 / 目录 | 内容 | 出处 |
|---|---|---|
| `MEMORY.md` / `USER.md` | 全局记忆 / 用户偏好 | `lib/context.js:156-157` |
| `PROJECTS/<项目>.md` | 项目记忆（项目名经 `sanitize`，非法字符替换并截断 60 字） | `lib/context.js:159`、`166-168` |
| `DAILY/<YYYY-MM-DD>.md` | 今日日志（含 `对话进行中（HH:MM）` 自动行） | `lib/context.js:158`、`lib/index.js:109-114` |
| `GRAPH.json` | 关系图（entities / edges） | `lib/context.js:161`、`lib/graph.js:21-26` |
| `SUGGESTIONS.jsonl` | `tag=关键` 的待确认队列（逐行 JSON） | `lib/context.js:160`、`lib/index.js:176-185` |
| `.access.json` | `id → {last, count}` 访问记录 | `lib/access.js:23`、`53-67` |
| `.work-memory.lock` | 目录锁 | `lib/store.js:182` |
| `<库内任意 .md>.tmp.<pid>` | 写盘中间文件（成功后 rename 覆盖） | `lib/store.js:151-155` |
| `<库内任意 .md>.bak.<时间戳>` | drift 检测命中时的现场备份 | `lib/store.js:144-148` |
| `ARCHIVE/entries.md` | 条目级冷归档 | `lib/archive.js:34`、`296` |
| `ARCHIVE/daily-YYYY-Www.md` | DAILY 按周合并 | `lib/archive.js:166-172` |
| `ARCHIVE/.archive-index.json` | `id → {scope,file,archivedAt,reason}`，转热据此写回原范围 | `lib/archive.js:35`、`287-288`、`357-363` |
| `ARCHIVE/.last-run` | 归档检查当日防抖标记 | `lib/archive.js:132-139` |
| `ARCHIVE/.last-maintain` | 上次周保养日期 | `lib/archive.js:36`、`110-115` |
| `.triage.json` | 预审状态：`kept` / `pending` / `cold`（写在记忆库根目录） | `lib/triage.js:30`、`233-251` |
| `.api-access.log` | 极简访问日志（超 256KB 清空） | `lib/api.js:72-80` |
| `<...>/data/dsh-work-memory/backup/backup-YYYY-MM-DD/` | 每日全量备份（保留 `backupKeep` 份） | `lib/backup.js:25-29`、`45-46`、`68-76` |
| `obsidianSyncDir/` | 可选：记忆库单向镜像 | `lib/backup.js:104-147` |

### 2.3 Obsidian 镜像**何时**被同步（重点）

`syncMemoryToObsidian()` **不是定时任务、也不在每轮注入时执行**；只在以下三处被调用：

1. `memory_remember` **成功写库之后**（`handleRemember` 的锁外懒任务，与归档/备份同批）—— `lib/tools.js:142-146`、`57-63`；
2. `memory_link` 建边成功之后（锁内直接调用）—— `lib/tools.js:243-249`；
3. `memory_recall(scope=archive)` 命中并转热之后（`promoted.length > 0` 才同步）—— `lib/tools.js:171-174`。

同步语义（`lib/backup.js:90-147`）：

- 同步范围 `names = ['MEMORY.md','USER.md','GRAPH.json','PROJECTS','DAILY','ARCHIVE']`（**含冷归档**，为的是"迁走镜像即完整迁走记忆"）—— `lib/backup.js:92-94`、`108`；
- **`prune` 默认开**：镜像里多出来、主库已不存在的文件会被删掉，但**只在上述名字范围内**清理，镜像目录里其它内容（如手工维护的历史归档）不动 —— `lib/backup.js:95-96`、`128-145`；
- 与主库同名回填无损；`obsidianSyncDir` 为空即不同步 —— `lib/backup.js:97`、`59`。
- 注意：`README.md:75` 描述镜像范围为"`MEMORY.md / USER.md / PROJECTS/ / DAILY/ / GRAPH.json`"，**未提到 ARCHIVE**，与代码不一致；以 `lib/backup.js:108` 为准。

面板浏览、`/memory_audit`、`/memory_backup`、`/memory_archive`、`/memory_maintain`、`/memory_triage` **都不触发镜像同步**（这些路径未调用 `maybeSync`/`syncMemoryToObsidian`）。

---

## 3. 对外接口

### 3.1 DSH 工具（3 个，`ctx.tools.register`）

注册方式为官方 `defineTool` DSL；`inject` 声明为 `['systemPrompt','tools','commands','settings','webServer']` —— `lib/index.js:31`、`158-190`、`lib/tools.js:9`。

| 名称 | 参数（name: type，required） | 输出 schema 要点 | 并发安全 | 出处 |
|---|---|---|---|---|
| `memory_remember` | `content: string`(必)、`tag: 关键\|常规\|临时\|敏感`、`scope: auto\|global\|user\|project\|daily`、`branch: string` | `{ok, queued?, duplicate?, message?, file?, tag?, error?}` | `false` | `lib/tools.js:271-304`、`278-299` |
| `memory_recall` | `query: string`(必)、`scope: all\|global\|user\|project\|daily\|archive`、`limit: number`、`branch: string` | `{ok, count, total, results[{scope,entry}]}` | `true` | `lib/tools.js:306-343` |
| `memory_link` | `from: string`(必)、`to: string`(必)、`relation: string`(默认"相关")、`branch: string` | `{ok, edge{from,to,relation}, error?}` | `false` | `lib/tools.js:345-379` |

行为约束（对外承诺）：

- `tag=关键` 进待确认队列、内容重复不重复写入（条目正文或队列内相同即跳过）—— `lib/tools.js:122-133`、`74-87`；
- `scope=project` 无 branch 直接报错（**不再静默写进全局**）；`global/user` 必须显式指定 —— `lib/scope.js:30`、`lib/tools.js:97-104`；
- 子代理（`header.origin==='subagent'` 或 `delegationDepth>0`）不能写 `global/user` —— `lib/tools.js:31-39`、`107-109`。

### 3.2 DSH 命令（7 个）

| 命令 | 参数 | 出处 |
|---|---|---|
| `memory_review` | 无 | `lib/index.js:193-196` |
| `memory_archive` | 无 | `lib/index.js:215-218` |
| `memory_backup` | 无 | `lib/index.js:243-246` |
| `memory_audit` | 无 | `lib/index.js:262-265` |
| `memory_maintain` | 无 | `lib/index.js:349-352` |
| `memory_promote` | `<条目id>`（`rawInput` 第一段） | `lib/index.js:441-446` |
| `memory_triage` | 无 / `keep <id> [理由]` / `cold <id> [理由]` | `lib/index.js:459-470` |

### 3.3 HTTP 路由（`ctx.webServer.register`）

根路径 `API_ROOT = '/work-memory/api'`；**同时注册 prefix 与该前缀下的 13 条 exact 路径** —— `lib/api.js:18`、`365-376`。

| 方法 | 路径 | 说明 | 出处 |
|---|---|---|---|
| GET | `/overview` | 各范围条数 + 待确认数 + 项目/日志文件数与条目总量 | `lib/api.js:93-117` |
| GET | `/entries?scope=&name=` | 读某范围条目（scope: global/user/daily/project） | `lib/api.js:120-133` |
| GET | `/lists?kind=projects\|dailies` | 项目 / 日期文件列表 | `lib/api.js:136-142` |
| GET | `/graph` | 关系图（补全缺 label 的节点、清洗元信息前缀） | `lib/api.js:145-197` |
| GET | `/backup` | 备份目录 + 备份列表 | `lib/api.js:200-203` |
| GET | `/archive` | 归档文件与条数 | `lib/api.js:206-209` |
| GET | `/suggestions` | 待确认队列（逐行 JSON 解析） | `lib/api.js:212-219` |
| POST | `/backup/run` | 手动备份（无参） | `lib/api.js:228-235` |
| POST | `/archive/run` | 手动归档（无参） | `lib/api.js:238-245` |
| POST | `/write` | `{scope, name, action: add\|remove, content\|match}` | `lib/api.js:248-282` |
| POST | `/suggestions/approve` | `/suggestions/reject` | `{index}`；批准按建议自身 scope 落地 | `lib/api.js:285-325` |
| POST | `/project` | `{action: create\|archive, name}`；归档=整文件 rename 进 `ARCHIVE/` | `lib/api.js:330-353` |

写操作（POST/PUT/DELETE）必须通过 `sameOriginGuard`：`Content-Type: application/json` + `Origin` 与 `Host` 同源，否则 403 —— `lib/api.js:47-59`、`222-225`。请求体上限 128KB（`lib/api.js:30`）。

### 3.4 设置命名空间与键（`work-memory`，24 键）

注册：`ctx.settings.register(SETTINGS_NS, MEMORY_SETTINGS_SCHEMA, { base })`，`SETTINGS_NS='work-memory'` —— `lib/settings.js:18`、`132`。

| 键 | 默认 | 出处 |
|---|---|---|
| `memoryDir` | `''`（→ 默认目录，热生效） | `lib/settings.js:25`、`53-54` |
| `personaLabel` | `'记忆'` | `lib/settings.js:26`、`55-56` |
| `injectMemory` | `true` | `lib/settings.js:27`、`57-58` |
| `snapshotOrder` | `500`（**需重启**） | `lib/settings.js:28`、`59-60` |
| `snapshotMaxChars` | `4000` | `lib/settings.js:29`、`61-62` |
| `snapshotLimitGlobal/User/Project/Daily` | `20 / 12 / 16 / 8` | `lib/settings.js:30-33`、`63-66` |
| `reviewEnabled` | `true` | `lib/settings.js:34`、`67-68` |
| `dailyAutoLog` | `true`（10 分钟防抖） | `lib/settings.js:35`、`69-70` |
| `maintainWarnDays` | `7` | `lib/settings.js:36`、`71-72` |
| `archiveEnabled` | `true` | `lib/settings.js:37`、`73-74` |
| `dailyRetentionDays` | `7` | `lib/settings.js:38`、`75-76` |
| `projectTtlDays` | `30` | `lib/settings.js:39`、`77-78` |
| `userTtlDays` | `90` | `lib/settings.js:40`、`79-80` |
| `triageEnabled` | `true` | `lib/settings.js:41`、`81-82` |
| `triageGraceDays` | `7` | `lib/settings.js:42`、`83-84` |
| `triageAskInSnapshot` | `true` | `lib/settings.js:43`、`85-86` |
| `globalWarnCount` | `20` | `lib/settings.js:44`、`87-88` |
| `backupEnabled` | `true` | `lib/settings.js:45`、`89-90` |
| `backupDir` | `''`（→ 默认备份目录） | `lib/settings.js:46`、`91-92` |
| `backupKeep` | `7` | `lib/settings.js:47`、`93-94` |
| `obsidianSyncDir` | `''`（留空 = 不同步） | `lib/settings.js:48`、`95-96` |

`cordis.patch.yml:11-29` 只列了其中 17 个键作为**部署默认层（base）**，未列出的键走 schema 默认值；解析优先级为"schema 默认 ← 本文件 base ← profile patch ← 设置页用户覆盖" —— `cordis.patch.yml:4-7`。

### 3.5 客户端页面（client 半）

- 包导出：`"./client": "./client/index.js"`；`package.json` 的 `dsh.client.inject` 声明 4 个客户端包（conversation / sidebar-right / resources / locale），`platform: web` —— `package.json:20`、`45-53`；
- 插件形态：`{ apply, inject: ['slots'] }` —— `client/index.js:741`；
- 数据层：`ctx.resources.register({ protocol, open })` 异步帧协议（成功必须 yield `{ok:true,value}`），轮询宿主 `/work-memory/api` —— `client/index.js:265-302`、`281-284`；
- 面板位：`sidebarRightTabs.register({ id, kind, title, guide })` + 槽位 `slots.inject('sidebar.right.pane.tab', ...)` 挂载 `MemoryPanel` —— `client/index.js:689-714`；
- 本地化：`locale.register(NS,'zh'|'en')`，词条含 `tab.title`/`guide.title`/`panel.title` 等 —— `client/index.js:83-129`、`720-726`；
- 面板功能：统计四格、范围切换、项目与日期选择器（可**新建/归档项目**）、检索、条目增删、待确认批准/拒绝、「相关 N」关系明细 —— `client/index.js:361-686`、`README.md:44`。

### 3.6 模块导出的关键符号

`lib/index.js`：`name = 'work-memory'`、`inject`、`apply(ctx, config)` —— `lib/index.js:30-33`。

| 模块 | 关键 export | 出处 |
|---|---|---|
| `lib/store.js` | `ENTRY_DELIMITER`、`DAILY_ACTIVITY_PREFIX`、`defaultMemoryRoot`、`resolveMemoryRoot`、`ensureMemoryRoot`、`genEntryId`、`extractEntryId`、`stripEntryId`、`parseEntries`、`serializeEntries`、`extractEntryDate`、`parseEntryTag`、`makeEntry`、`MemoryStore`、`withDirLock`、`listDailyFiles`、`listProjectFiles` | `lib/store.js:10-12`、`22-26`、`33-35`、`41`、`47-97`、`167`、`214-224` |
| `lib/context.js` | `buildSnapshot`、`memoryFiles`、`sanitize` | `lib/context.js:59`、`153`、`166` |
| `lib/tools.js` | `createTools(deps)` | `lib/tools.js:25` |
| `lib/scope.js` | `WRITE_SCOPES`、`SCOPE_CRITERIA`、`resolveWriteScope` | `lib/scope.js:15`、`18`、`30` |
| `lib/archive.js` | `ARCHIVE_DIR`、`ARCHIVE_ENTRIES`、`NOTICE_DAYS`、`ttlRef`、`daysUntilCold`、`runArchive`、`listArchive`、`archiveEntries`、`promoteEntry`、`keepEntry`、`archiveEntryById`、`listPending`、`daysSinceMaintain`、`markMaintain` | `lib/archive.js:33-38`、`53`、`61`、`98-123`、`314-344`、`419-443` |
| `lib/triage.js` | `judgeEntry`、`gatherTriageContext`、`readTriage`、`writeTriage`、`keepUntil`、`markKept`、`markPending`、`coldVerdict`、`markCold`、`pruneTriage` | `lib/triage.js:116`、`179`、`233-322` |
| `lib/access.js` | `readAccess`、`writeAccess`、`touchAccess`、`lastAccessOf`、`latestAccessOf`、`pruneAccess` | `lib/access.js:30-87` |
| `lib/graph.js` | `graphPath`、`readGraph`、`writeGraph`、`registerEntry`、`linkEntries`、`pruneEntity` | `lib/graph.js:21-116` |
| `lib/backup.js` | `defaultBackupDir`、`backupMemory`、`listBackups`、`syncMemoryToObsidian` | `lib/backup.js:25`、`37`、`80`、`104` |
| `lib/clock.js` | `todayStamp`、`nowHHMM`、`localIso`、`addDays`、`diffDays`、`weekKey`、`dateOf` | `lib/clock.js:13-60` |
| `lib/api.js` | `installApi(ctx, deps)` | `lib/api.js:67` |
| `lib/settings.js` | `SETTINGS_NS`、`DEFAULTS`、`MEMORY_SETTINGS_SCHEMA`、`installSettings` | `lib/settings.js:18`、`24`、`52`、`126` |

### 3.7 数据格式（与外部工具互操作时需要）

- 条目 = 一行文本，元信息前缀 `[id:xxxxxxxxxxxx] [YYYY-MM-DD] [branch:..] [tag:..]`；条目之间用 `\n§\n` 分隔 —— `lib/store.js:10`、`51-58`、`90`；
- id 为 sha256(uuid) 前 12 位十六进制 —— `lib/store.js:47-49`；
- 面板写入条目时 `registerEntry` 立刻登记图谱节点，与 `memory_remember` 一致 —— `lib/api.js:266-267`。

---

## 4. 回退与恢复

### 4.1 版本回退

- **本模块 CHANGELOG 未设逐版「回退」小节**（对比 `CHANGELOG.md` 每版都有）；可用的回退流程为集成体运维纪律：**升/改回 `package.json` 版本号 → `dsh plugin --profile <p> install --force` → 仍不同步就删掉 profile 的 `node_modules/<模块>` 再 `dsh plugin add` → 逐文件 SHA256 比对 → 重启 DSH** —— 集成体根 `README.md:184-185`；
- `git revert` 对应提交同样可行（本仓库为源码仓库，无二进制产物）—— `package.json:24-32`（`files` 只有 `lib/client/scripts` 与文档）；
- **重启要求**：host 侧 `lib/**` 与客户端 `client/**` 改动都需重启 DSH；客户端 bundle 按 revision 缓存，**改动客户端须升版本号**（`package.json:3`、集成体根 `README.md:185`）。

### 4.2 升级注意（1.0.6 默认路径变更）

- 默认记忆库路径由 `<base>/memories/work-memory` 改为 **`<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory`** —— `lib/store.js:17-26`、`CHANGELOG.md:16-20`；
- **未显式配置 `memoryDir` 且旧库已有数据**的使用者，升级后请在设置页或 `~/.dsh/settings.yaml` 的 `work-memory` 段把 `memoryDir` 指回旧路径，数据即可零迁移 —— `CHANGELOG.md:21-22`；
- 显式设过 `memoryDir` 的行为完全不变 —— `CHANGELOG.md:20`；
- 设置键名与语义在该版未变（仍 24 键）—— `CHANGELOG.md:24-25`。

### 4.3 数据备份与恢复

- **自动备份**：写库路径懒触发，**每天至多一次**（目标目录 `backup-YYYY-MM-DD` 已存在即跳过），全量复制记忆库、跳过 `.tmp`/`.lock`，只保留最近 `backupKeep` 份 —— `lib/backup.js:5-7`、`45-48`、`52-76`；
- **手动备份**：`/memory_backup` 命令或面板 `POST /backup/run`；列表见 `GET /backup` —— `lib/index.js:243-259`、`lib/api.js:200-203`、`228-235`；
- **清单查询**：`listBackups()` 只列 `backup-YYYY-MM-DD` 目录、按名倒序 —— `lib/backup.js:80-88`；
- **恢复**：备份是"与记忆库同名的完整目录树"（`lib/backup.js:52-66` 的 `copyTree`），把 `backup-YYYY-MM-DD/` 下的内容拷回记忆库根目录即可（结构一一对应）。**README / CHANGELOG 未写恢复命令**，此步骤为按结构的说明，属"未知是否有官方脚本"一栏；
- **Obsidian 镜像用于迁移/恢复**：注释明确"用于整体迁移/恢复"、"镜像与主库同名，回填无损" —— `lib/backup.js:91-97`；镜像目录应**当只读参考**（手改会在下次同步被覆盖）—— `README.md:75`。

### 4.4 不可逆操作与注意事项

| 项 | 说明 | 出处 |
|---|---|---|
| 条目删除 | `POST /write` 的 `action:'remove'` 会真正从文件中移除该条目（同时从图谱摘掉节点） | `lib/api.js:270-277` |
| 项目"归档" | 用 `renameSync` 整体移入 `ARCHIVE/project-<name>-<日期>.md`，**不物理删除**、可恢复 | `lib/api.js:327-350` |
| 转冷 | 条目从热区文件移出（`rmSync` 空文件 / `_writeGuarded` 重写），追加进 `ARCHIVE/entries.md`；**原文与 id 保留**，可 `/memory_promote` 或 `memory_recall(scope=archive)` 取回 | `lib/archive.js:284-297`、`344-397`、`458-476` |
| DAILY 合并 | 过期日志文件被删除，内容按周并入 `ARCHIVE/daily-YYYY-Www.md` | `lib/archive.js:166-175` |
| 备份清理 | 超过 `backupKeep` 的旧备份目录被 `rmSync` 删除 | `lib/backup.js:68-76` |
| 镜像 prune | 默认删除镜像里"主库已不存在"的文件（仅限同步范围） | `lib/backup.js:95-96`、`128-145` |
| drift 现场 | 检测到文件被外部改动时，当前文件改名为 `.bak.<时间戳>` 后抛错（写入中止） | `lib/store.js:142-148` |
| 锁残留 | 陈旧锁超过 10 秒可被自动清除；锁超时 5 秒会抛 `lock timeout` | `lib/store.js:13-15`、`193-200` |
| `memoryDir` 切换 | 新目录建不出来则**沿用旧目录并 warn**，不会把记忆写到不存在的位置 | `lib/index.js:85-90` |
| 明文存储 | 记忆以纯 Markdown/JSON 落盘；`tag=敏感` **不加密不脱敏**，仅"不自动注入" | `README.md:94`、`lib/context.js:48` |
| 本地假定 | 跨进程文件锁按本地文件系统设计，网络盘/同步盘上可能退化 | `README.md:95` |
| 卸载 | 从 `dsh.profile.bundles` 与 `dependencies` 移除包名 → `dsh plugin install` → 重启；**不会删除记忆数据**；彻底清空需手动删目录（先备份） | `README.md:85-89` |

### 4.5 自检与门禁

- `node scripts/regression.mjs`（`npm test`）覆盖存储层、归档、转热、快照过滤、备份、锁、分类护栏、图谱、访问跟踪、TTL 起始点、转冷预审、根目录热解析、子代理门控 —— `scripts/regression.mjs:1-5`、`42`、`60`、`155`、`181`、`205`、`250`、`285`、`311`、`370`、`503`、`540`；
- `node --check lib/index.js && node --check client/index.js`（`npm run check`）；`prepack` 自动跑回归作为发布前闸门 —— `package.json:35`、`36`、`README.md:100-104`。

### 4.6 本版未实现 / 未知

- **无逐版回退记录**（见 4.1）；
- **无备份一键恢复命令**：`/memory_backup` 只做备份，恢复需手工拷贝（4.3 已标注）；
- `README.md:75` 的镜像范围描述未含 `ARCHIVE`，与 `lib/backup.js:108` 不一致（以代码为准）。
