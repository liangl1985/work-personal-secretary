# dsh-work-memory · DSH 记忆插件

> 为 **DeepSeek Harness（DSH）** 打造的**执行层长期记忆**插件：三级记忆模型 + 会话原生热注入 + remember/recall/link 工具 + 右侧边栏管理面板 + Obsidian 镜像。
> 零运行时依赖（只用 `node:fs`），全程**本地**、**不联网**、**无遥测**。

---

## 一、三级记忆模型

| 层 | 载体 | 规则 |
|---|---|---|
| **全局记忆** | `MEMORY.md` | **永不遗忘**、不参与任何 TTL。只放跨模块且不随项目变的根本内容（助手身份/性格/红线/长期工作约定） |
| **热记忆** | `USER.md` / `PROJECTS/*.md` / `DAILY/*.md` | 有生命周期，到期**转冷**：DAILY 7 天（按周合并）、项目 30 天、偏好 90 天；`关键` 永不转冷 |
| **冷记忆** | `ARCHIVE/` | 不注入、可检索；**被取出使用时转热**（`memory_recall` 查归档命中即按原 id、原文写回原范围） |

- **"被用到才算热"**：归档判定的**起始点**是 `基准日 = max(写入日, 最后使用日)`——
  - **写入日** = 条目元信息里的 `[YYYY-MM-DD]`（本地日界）；
  - **最后使用日** = `.access.json` 里该条最后被"用到"的日期；
  - **算"被用到"**：`memory_recall` 命中并返回、`memory_link` 建边两端、冷转热写回；
  - **不算"被用到"**（红线）：每轮**注入快照**、面板浏览、巡检与保养——否则注入即等于使用，TTL 永不生效；
  - **转冷条件**：`今天 − 基准日 > TTL`，即 **TTL 天内（含第 TTL 天）都仍算热**，第 TTL+1 天才转冷（DAILY 7 天：09-01 的日志到 09-08 仍是最后一天，09-09 归档）；
  - DAILY 以**文件**为单位：只要文件里有任一条 7 天内被用过，整个文件顺延、不按周合并。
- **周保养**：`/memory_maintain` 一次完成「到期转冷 + 未来 7 天到期清单 + 转热候选 + 分类巡检」；距上次保养 >7 天会在注入快照里提醒。

### 转冷预审（到期 ≠ 立即冷）

条目**到期后不直接转冷**，先过一遍辅助判断（可关：`triageEnabled`）：

| 判定 | 依据 | 处理 |
|---|---|---|
| **自动保留** `keep` | 与近 7 天日志/全局记忆/同范围热记忆主题相关；含未完结、决策约定类措辞；图谱有关联；被反复用过 | 记入保留清单 `.triage.json`，顺延一个 TTL 周期（**不改条目原文、不伪造"被使用"记录**） |
| **自然转冷** `cold` | 含完成/一次性信号（已完成、已装、已发布…）；同主题已有更新条目（被取代） | 到期即转冷（未到期只记"预判自然转冷"） |
| **待判断** `ask` | 信号不足或互相矛盾 | 进待判断队列（注入快照出现 `⏳`），**由助手在保养时逐条判定**，只有助手也拿不准的才问用户；超过 `triageGraceDays`（默认 7 天）未判 → 自然转冷 |

- **提前量**：到期前 **7 天**就开始预审，所以判定发生在"还需要它"的时候，而不是冷掉之后。
- **判定入口**：`/memory_triage`（列出队列）→ `/memory_triage keep <id> [理由]`（保留并顺延）、`/memory_triage cold <id> [理由]`（到期即冷，未到期则记判定、到期静默转冷，不再反复询问）。
- 所有判定只写 `.triage.json`，**不删不改任何记忆条目**；冷条目仍可 `memory_recall(scope=archive)` 检索，命中即转热。

## 二、功能

**注入**：每轮对话把记忆快照作为 runtime 上下文注入（标题词可配，默认「记忆」）。
**工具**：`memory_remember`（分类护栏 + 去重 + 关键进确认队列 + 子代理门控）、`memory_recall`（global/user/project/daily/archive）、`memory_link`（建立关联）。
**命令**：`/memory_review`、`/memory_archive`、`/memory_backup`、`/memory_audit`（分类巡检 + 关联枢纽/孤儿 + 预审状态）、`/memory_maintain`（周保养 + 预审）、`/memory_triage`（转冷预审判定）、`/memory_promote <id>`（冷转热）。
**面板**（右侧边栏 →「记忆库」）：统计四格 / 范围切换 / 项目与日期选择器（项目分类可**新建**与**归档**）/ 检索 / 条目增删 / 待确认批准 / 「相关 N」关系明细。
**镜像**：可把记忆库单向同步到 Obsidian vault（`obsidianSyncDir`），用于迁移与人工翻阅。
**配置**：设置 → 插件 → 插件配置 → `work-memory`（23 项，除 `snapshotOrder` 外**免重启生效**）。

## 三、安装（DSH 插件标准方式）

```powershell
# 1) 安装到 profile（<包名> 换成 npm 包名或本地路径）
dsh plugin --profile desktop add <包名>

# 2) 在 profile 的 package.json 里把包名加入 dsh.profile.bundles
#    ~/.dsh/profiles/desktop/package.json → dsh.profile.bundles: [..., "<包名>"]

# 3) 收起依赖图
dsh plugin --profile desktop install

# 4) 重启 DSH 生效
```
> 本包自带 `cordis.patch.yml`（声明于 `dsh.bundle.patch`），由 bundle 机制自动挂载 entry；**不要**手动往主 profile patch 里插 entry。
> 个性化（标题词 / Obsidian 目录 / 备份目录）请写在**设置页用户层**（或 `~/.dsh/settings.yaml` 的 `work-memory` 段）——注意 profile 的 `id` 定向 `config` 是**整块替换**，会顶掉插件自带默认值，不推荐。

**依赖**：只有 peer（由 DSH 宿主运行时提供）：`@deepseek-ai/dsh-tools`、`cordis`、`schemastery`、若干 `@deepseek-ai/dsh-client-*`、`react@18`。**没有运行时依赖**。

## 四、首次使用

1. 装好后重启 DSH；打开右侧边栏 → 引导页里点「**记忆库**」，面板即出现。
2. **填两份画像**（建议第一条就做，它们决定注入质量）：
   - **使用者画像** → 写入 `scope: user`（称呼、职业、目标、技术偏好、作息与协作习惯）
   - **助手画像** → 写入 `scope: global`（身份、性格、保密红线、协作铁律、长期工作约定）
   可以说：「记住：我是……（scope=user）」「记住：你是我的……助手，性格……（scope=global）」
3. **建议配合 Obsidian**：把 `obsidianSyncDir` 指向 vault 里的一个目录（如 `<vault>/00_全局记忆`），插件会把 `MEMORY.md / USER.md / PROJECTS/ / DAILY/ / GRAPH.json` 单向镜像过去，便于人工翻阅与灾难恢复。**镜像目录请当只读参考**（手改会在下次同步被覆盖，要改请用工具或面板）。
4. **分类可增删改**：范围（全局/偏好/项目/日志/归档）固定，但**项目分类**可随时新建与归档（面板「项目」范围里）；条目可增删；`tag` 取 关键/常规/临时/敏感（**敏感条目不自动注入**，只在显式 `memory_recall` 时返回）。
5. 记忆库位置：默认 `~/.dsh/memories/<命名空间>`，可用 `memoryDir` 改；结构：
   ```
   MEMORY.md  USER.md  GRAPH.json  .access.json
   PROJECTS/<项目>.md   DAILY/<日期>.md
   ARCHIVE/entries.md  ARCHIVE/daily-YYYY-Www.md  ARCHIVE/.archive-index.json
   SUGGESTIONS.jsonl（关键记忆待确认队列）
   ```

## 五、卸载与数据留存

- 卸载：从 `dsh.profile.bundles` 与 `dependencies` 移除包名 → `dsh plugin install` → 重启 DSH。
- **卸载不会删除记忆数据**：记忆库在 `~/.dsh/memories/<命名空间>`（另有 `backupDir` 里的每日备份与 Obsidian 镜像），随时可重新装回继续用。
- 想彻底清空：手动删除上述目录（建议先备份）。

## 六、隐私与边界（必读）

- **全程本地**：只读写本机文件，**不发起任何网络请求、无遥测、无云端同步**。
- **明文存储**：记忆以纯 Markdown/JSON 落盘（"可读、可迁移、可人工恢复"的设计取舍）；`tag=敏感` **不做加密或脱敏**，请自行保证本机与备份目录的访问安全。
- **假定本地磁盘**：跨进程文件锁按本地文件系统设计（网络盘/同步盘上可能退化）——本插件面向本地落盘场景。
- **发布包不含任何记忆数据**：插件只带代码与中性默认配置；使用者的记忆只存在于其本机。

## 七、开发与自检

```powershell
node scripts/regression.mjs   # 回归（存储/归档/转热/快照/备份/锁/分类护栏/图谱/访问跟踪）
node --check lib/index.js     # 语法
```
`prepack` 会自动跑回归，作为发布前闸门。

## 八、许可

MIT
