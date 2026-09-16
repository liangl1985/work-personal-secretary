# CHANGELOG

## 1.0.6 — 2026-09-16（默认路径迁移 + memoryDir 热生效）

- **行为修正（本单主线）**：记忆库根目录此前是 `apply()` 时算一次的常量（旧 `lib/index.js:65` 的
  `const root = cfg.memoryDir || …`），改设置页的 `memoryDir` 必须**重启 DSH** 才切过去。现改为**实时解析**：
  所有消费点（工具 / 命令 / 注入快照 / 面板与 API / 归档 / 备份 / 转冷预审）统一经实例内的 `memoryRoot()` 取值，
  改完设置下一次读写即落在新目录。
  - `settings.watch` 回调里会预建新目录（根 + `DAILY`/`PROJECTS`）并打 debug 日志
    `work-memory: 记忆库根目录已切换 <旧> → <新>`。
  - 新目录建不出来（非法路径 / 无权限）时只 **warn 并沿用上一可用目录**：不会把记忆写到不存在的地方，
    也不影响旧库；同一失败目标只 warn 一次（不刷日志）。
  - 一致性：每个消费点（每个工具调用 / 每条命令 / 每次 API 请求 / 每轮注入）**入口取一次根目录快照**，
    同一操作全程用同一目录，切换只发生在两次操作之间；各目录沿用各自的 `.work-memory.lock`，
    切换不做锁迁移（因此不会出现跨目录半写）。
- **默认路径变更**：`<DSH_HOME 或 ~/.dsh>/memories/work-memory` →
  **`<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory`**（DSH 标准插件数据目录；`data/` 下按包名分目录，
  与桌宠 `~/.dsh/data/workspace-tokenpet` 同规矩）。默认口径只保留**一份实现**：`lib/store.js` 的
  `defaultMemoryRoot()`（`index.js` 不再内联第二份表达式）。
  - **显式设过 `memoryDir` 的使用者行为完全不变**；只有未设置的新装 / 未配置场景落到新默认。
  - 升级提示：未显式配置、且旧库（`<DSH_HOME>/memories/work-memory`）里已有数据的使用者，
    请在设置页或 `~/.dsh/settings.yaml` 的 `work-memory` 段把 `memoryDir` 指回旧路径，数据即可零迁移。
- 同步口径三处：`settings.js` 的 `memoryDir` 描述、README「首次使用 / 卸载与数据留存」的默认值说明。
- 影响面：仅 host 半（`lib/`）；`client/` 未改动（不需要刷新前端缓存）。
  设置项键名与语义**一字未改**（schema 仍 24 键）。
- 回归：**86/86**（新增 3 条：默认落到新路径 / `memoryDir` 未设置时回落默认且显式值原样 / 热切换解析到新目录并建齐
  `DAILY`+`PROJECTS`）。另做过一次 host 级端到端验证（临时脚本，未随包发布：真实 `apply` + 模拟
  settings watch，12/12）——切换后 `memory_remember`/`memory_recall`、注入快照、面板 `/overview` 全部落到新目录，
  且旧目录不再被写；指回旧目录与「新目录非法」两条回退路径均按预期（后者仅 warn、不抛异常）。
- 来源：2026-09-16 使用者要求「记忆库目录改动要热生效，不能重启 DSH」，并拍定新默认位置。

## 1.0.5 — 2026-09-13（回归脚本时区 bug 修复）

- **修复**：`scripts/regression.mjs` 里 3 处用 `new Date().toISOString().slice(0, 10)` 取日期（**UTC**），而实现侧 `clock.js` 的 `todayStamp()` 取**本地日期**。在 Asia/Shanghai 的 00:00–08:00 窗口两者差一天，导致测试写的是 `DAILY/<UTC 日>.md`、查的是 `backup-<UTC 日>`，而插件实际用本地日 → 「快照：包含真实日志」「备份：全量复制成功」「备份：保留最近 N 份」在**这个时段必然误报失败**（80/83），白天则是 83/83。现改为与实现同源（`todayStamp()`）。
- **隐性风险一并消除**：同一窗口下「快照：过滤活动日志行」「备份：当日防抖 skipped」原为**假通过**（文件名错位导致"看起来过滤成功"），修复后才是真实校验。
- 影响面：**仅测试脚本**，运行时代码零改动，**无需重启 DSH**；设置项与记忆数据不变。
- 回归：83/83。
- 来源：2026-09-13 重启后核对发现（凌晨时段，本地 09-13 / UTC 09-12）。

## 1.0.4 — 2026-09-12（手动归档漏传分级 TTL 修复）

- **修复**：`/memory_archive` 手动归档只传了 `dailyRetentionDays`，并带了一个 `archive.js` 里**并不存在**的 `entryTtlDays`（分级 TTL 改造的遗留）。后果：**使用者在设置页自定义「项目 TTL / 偏好 TTL」后，手动归档仍按默认 30 / 90 天执行**。现改为传齐 `dailyRetentionDays` / `projectTtlDays` / `userTtlDays`（与自动归档一致）。
- 影响面：**仅手动** `/memory_archive`；自动归档（写库懒触发）一直正确。
- 回归：83/83。
- 来源：2026-09-12 集成体全面更新时由子代理核对 README 与实现时揪出。

本插件的版本历史。**1.0.3 起包名与运行时 id 全部中性化（`dsh-work-memory` / `work-memory`）**（1.0.0 是三级记忆模型定型的可发布终结版）。

## 1.0.3 — 2026-09-11（标识符中性化）

发布件不得携带任何私有标识，因此包名与运行时 id 一并改为中性：

- 包名 `dsh-lina-memory` → **`dsh-work-memory`**
- 插件运行时 id `lina-memory` → **`work-memory`**，随之统一：
  - settings 命名空间（设置页卡片键）、`/work-memory/api` 路由、`dsh-resource://work-memory/…` 协议、面板 tab id/kind、store 持久化键、快照 order 键、锁文件 `.work-memory.lock`
  - 默认记忆库目录 `~/.dsh/memories/work-memory`、默认备份目录 `~/.dsh/memories/work-memory-backup`
- **升级提示（老实例）**：
  1. profile 的 `dependencies` 键与 `dsh.profile.bundles` 同步改为 `dsh-work-memory`；
  2. 设置页用户层命名空间由 `lina-memory` 改为 `work-memory`（把原配置搬过去；未搬则回到默认值）；
  3. **重启 DSH** 生效；
  4. 记忆库数据本身不动——若用户层已显式指定 `memoryDir`，路径不变；未指定者请把 `memoryDir` 指回原有库，避免读到新的空目录。
- 客户端 bundle 有改动 → 版本 **1.0.3**（revision 缓存规则）。

## 1.0.2 — 2026-09-11（发布去个人化）

发布件不得夹带个人身份与私有路径（发布版不面向特定使用者），因此：

- **默认记忆库路径通用化**：原先的私有默认目录 → **`~/.dsh/memories/work-memory`**；默认备份目录改为 `~/.dsh/memories/work-memory-backup`，并**移除硬编码盘符路径**（Windows 上的 `E:\…` 候选会让非 Windows 平台建出怪目录）。
  - 升级提示：老用户请在**设置页用户层**显式指定 `memoryDir`（指向原有记忆库）与 `backupDir`，数据即可零迁移。
- **文案与注释去个人化**：面板引导描述（中/英）、设置项描述、快照里的「转冷待判断」提醒、工具输出与代码注释中的私有助手名/私有称呼一律改为**助手 / 使用者**通用表述；`LICENSE` 版权署名改为项目所有者。
- **转冷预审标记词补充通用叫法**：`DECISION_MARKERS` 增加「使用者定 / 使用者批准 / 用户要求 / 产品要求」，保留原有叫法以兼容既有条目。
- 客户端 bundle 有改动 → 版本号 **1.0.1 → 1.0.2**（bundle 按 revision 缓存，升版本才会被重新拉取）。

## 1.0.1 — 2026-09-11（包名定名）

- **包名 `（旧私有 scoped 包名）` → `dsh-work-memory`**（发布名与安装名统一）：同步改 `cordis.patch.yml` 的 bundle `name`、客户端 `__ModuleLoader__.load({ id })`、profile 的 `dependencies` 键与 `dsh.profile.bundles`。
  - 插件**运行时 id 仍是 `work-memory`**（`export const name` / settings 命名空间 / 面板 tab id / `/work-memory/api` 路由 / `dsh-resource://work-memory/…` 协议都不变）→ 记忆数据、设置用户层、Obsidian 镜像**零迁移**。
  - 客户端 bundle 有改动（id + BUILD 标记）→ 版本号必须升（bundle 按 revision 缓存）；面板页脚应显示 `v1.0.1`。
- `repository` / `homepage` 指向集成体仓库 `github.com/liangl1985/work-personal-secretary`（子目录 `modules/dsh-work-memory`），`author: liangl1985`。

## 1.0.0 — 2026-09-11（可发布终结版）

**三级记忆模型（本版核心）**
- 全局记忆（`MEMORY.md`）**永不遗忘**，不参与任何 TTL/归档。
- 热记忆到期**转冷**：DAILY **7 天**（改按周合并为 `ARCHIVE/daily-YYYY-Www.md`）、项目 **30 天**、偏好 **90 天**；`关键` 永不转冷。
- 冷记忆**被用到即转热**：`memory_recall(scope=archive)` 命中后按**原 id、原文**写回原范围（`ARCHIVE/.archive-index.json` 记录来源）。
- **访问跟踪**：`.access.json` 记录每条的最后使用时间与次数；归档判定取 `max(条目日期, 最近使用)`。
- **TTL 起始点定死（2026-09-11 提醒）**：基准日 = `max(写入日, 最后使用日)`；**TTL 天内（含第 TTL 天）用过即仍为热**，第 TTL+1 天才转冷。
  - "被用到" = `memory_recall` 命中返回、`memory_link` 建边两端（关联即使用）、冷转热写回；
  - **注入快照 / 面板浏览 / 巡检 / 保养都不算使用**（红线：否则注入即使用，TTL 永不生效）；
  - DAILY 以**文件**为单位：文件内任一条被用过，整个文件顺延（此前只看文件名日期，"用过的日志照样被合并"）。
- **周保养** `/memory_maintain`：到期转冷 + 未来 7 天到期清单 + 转热候选 + 分类巡检，并顺手清理 `.access.json` 里已不存在条目的记录（防无限增长）；距上次 >7 天在注入快照里提醒。
- **转冷预审（到期 ≠ 立即冷）**：到期（含到期前 7 天）先做一次辅助判断，再决定去留——
  - 自动保留：与近 7 天日志/全局记忆/同范围热记忆相关、含未完结或决策约定措辞、图谱有关联、被反复用过 → 记保留窗口 `.triage.json`（不改原文、不伪造"被使用"记录）；
  - 自然转冷：含完成/一次性信号、同主题已被更新条目取代 → 到期即冷；
  - 待判断：信号不足或矛盾 → 进队列，**由助手在保养时判定**（超 `triageGraceDays` 默认 7 天未判则自然转冷），只有助手也拿不准的才交用户；
  - 新增命令 `/memory_triage`（列出队列）/ `keep <id>` / `cold <id>`；新增设置 `triageEnabled`、`triageGraceDays`、`triageAskInSnapshot`。
- 新增 `/memory_promote <id>`：手动把冷记忆转回热。

**时间与日界**
- 全部日期/时间戳改为**本地时区**（日界 = 本地 00:00）：此前的 UTC 会让本地 08:00 前写的记忆落到"昨天"，归档排期也按 UTC 算。

**快照（注入）取舍规则**
- `snapshotMaxChars` 1200 → **4000**；分段上限 全局 20 / 偏好 12 / 项目 16 / 今日 8。
- 优先级：`关键` > `常规` > `临时`；**`敏感` 不自动注入**。
- 偏好/项目按最近更新倒序，**全局保持原顺序**（老的红线优先）。
- 截断从最低优先级段尾部开始，段尾标注 `（另有 N 条未注入，用 memory_recall 查）`——**绝不静默丢弃**。

**图谱：降级为"关系数据 + 局部呈现"**
- 去掉面板的 SVG 关系图（省去布局/避让/导轨维护与孤儿节点问题）。
- 改为：条目卡显示「**相关 N**」并可展开关系明细；`/memory_audit` 输出**枢纽（被关联最多）Top 10** 与**孤儿节点**。
- 图谱节点**在记忆落盘时登记**（此前只有 `memory_link` 才登记，导致各范围图谱为空）；删除条目时连带摘除节点与相关边。

**分类护栏**
- `memory_remember` 的 `scope` 默认 `auto`（有项目分支→project，无分支→daily）；**project 无 branch 直接报错，不再静默写入全局**；`global`/`user` 必须显式指定。
- 新增设置 `globalWarnCount`（默认 20）：全局超阈值时注入快照里出现整理提醒。
- 新增 `/memory_audit`：各范围条数 + 可疑条目（global 里含 URL/版本号/插件名/路径的）+ 关联枢纽/孤儿。

**修复（静默失效）**
- 归档：`withDirLock` 同进程重复抢锁 → 自旋 5 秒超时被吞（归档从未执行），且每次写库白等 5 秒 → 改为**同进程可重入**，懒任务移到锁外（5000ms → 8ms）。
- 备份：`backupDir: null` 顶掉默认值 → `join(null)` 抛错被吞（自动备份失效）→ 改用 `?? / ||` 兜底。
- 建议批准的 `project` 范围条目曾被错写进 DAILY → 改为按建议自身 scope 落地。

**发布工程**
- 插件自带 `cordis.patch.yml` 保持**中性**（无个人路径/称呼）；个性化改由**设置页用户层**承载。
- `memoryDir`、`personaLabel`、分段上限、分级 TTL、转冷预审等**全部进入设置页**（共 23 项）。
- README 补齐三段（安装 / 首次使用 / 卸载与数据留存）+ 隐私与边界（本地、明文、不联网、无遥测）。
- 回归从 14 → **80 用例**（新增：分级 TTL 与边界、DAILY 被用过则顺延、按周合并、全局永不归档、被用到顺延、关联即使用、注入不算使用、使用记录清理、**转冷预审三类判定与提前预审/宽限超期/已判冷**、转热写回、周保养标记、锁可重入、backupDir 空值、分类护栏矩阵、快照告警、图谱登记/摘除）。

## 0.5.0 — 2026-09-11
- 图谱按**范围**过滤（全局/偏好/项目各一张）；项目分类可**新建/归档**（`POST /project`）。
- 修复帧信封（`{ok:true,value}`）、桌面载体取数（`http://dsh.internal`）、客户端 bundle 版本缓存等一连串问题。

## 0.4.0 — 2026-09-11
- 分类护栏五道（scope 决策纯函数、写入侧分支推断、工具描述判据、全局规模告警、`/memory_audit`）。
- `entryTtlDays` 90 → 45（后被 1.0.0 的分级 TTL 取代）。

## 0.3.0 — 2026-09-11
- 按 DSH `0.1.5-rc.1` **原生架构重写**：右侧边栏面板（`sidebarRightTabs` + `sidebar.right.pane.tab`）、数据走 `client-resources`、状态走 `client-store`、配置走 `settings` 命名空间、文案走 `locale`。
- 修复：桌面载体取数、帧信封、`/entries` 行格式、`/write` 的 `match` 字段。

## 0.2.0 — 2026-08-17
- 规范化打包、归档机制、备份机制、Obsidian 镜像、子代理门控。

## 0.1.0 — 2026-08-16
- 首版：热记忆注入 + `memory_remember` / `memory_recall` / `memory_link` + Web 面板。
