# dsh-experts 设计 v2.1 · 专家库的分类、分层与域体系

> 状态：**批一（内容层）+ 批二（架构层）均已实施**（2026-09-14，差异见第 20 节）；本文件保留为设计依据。
> 日期：2026-09-14（v2.1 冻结域体系）
> 目标版本：0.1.4 -> 0.2.0（架构级重构）
> 依据：与使用者的设计讨论（2026-09-14）+ DSH 官方机制核验
> 源码：<工作区>/DSH插件/src/work-personal-secretary/modules/dsh-experts

---

## 0. 摘要

专家库从"每轮注入 2 位专家的 persona"升级为一个**匹配与注入引擎**，管理三类性质不同的东西：

| 类别 | 本质 | 体量 | 由谁承担 | 生命周期 |
|---|---|---|---|---|
| 人（视角型 persona） | 方法、取舍、验收标准 | 重（约 500 字符/条） | 专家库 | 随任务命中，任务期粘性 |
| 能力（工具/技能） | 工具导航、命令入口 | 轻（约 100 字符/条） | 专家库（能力轴，无域） | 每轮都查，可缓存 |
| 身份（谁在说话） | 使用者岗位、莉娜身份 | 中 | work-memory 记忆 | 长久不变 |

四条核心机制：
1. **kind 分池**：persona 与 skill 两类条目，各自排序、各自守门；
2. **通道分工**：稳定的"专家库目录段"走 systemPrompt.section，本轮动态注入走 systemPrompt.context；
3. **能力轴正交**：能力条目不属任何行业域，只注入"做法指针"，有则带、无则建、指纹复核；
4. **阶段控制详略**：理解/执行/交付三阶段裁剪，自检红线落"交付层"、永不丢弃。

---

## 1. 设计出发点：三种东西被塞进了同一个壳

- **身份专家常驻** 与 work-memory 每轮注入的使用者画像重复；
- **doc-office** 与 office-* 技能重复；其正文方法 3 本就写着"选对技能、给对参数"；
- **按"个数"配额** 用同一个"2 位"卡 500 字符的人与 100 字符的技能，标准不统一。

修正起点：先分类，再谈配额。

---

## 2. 分层架构

   层 0  记忆层      身份 / 画像 / 待办 / 偏好        <- work-memory，专家库只读、不重复注入
   层 1  判断层      这轮是什么问题、归谁管           <- 不注入正文（目录段可见）
   层 2  视角层      命中的领域 persona（精简卡）      <- 专家库·按需
   层 3  能力层      工具/技能专家（一行指针）         <- 专家库·无域，每轮都查
   层 4  交付层      产出物规范 / 自检红线 / review 标注 <- 跟随每轮，永不丢弃
   ------------------------------------------------------------------
   层 5  阶段切面    理解 -> 执行 -> 交付             <- 控制层 2-4 的详略（横向）

---

## 3. 官方机制依据（已核验）

来源：https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/system-prompt

| 官方机制 | 语义 | 本设计用法 |
|---|---|---|
| systemPrompt.section(PromptSection) | 有序系统提示词段落；渲染未变则系统节点不动 | 放"专家库目录段"（稳定） |
| systemPrompt.context(PromptContext) | 动态运行时上下文，缓存安全；仅在完整当前快照变化时记录在保留历史之后 | 放本轮命中卡 + 能力指针 |
| 空文本不贡献 | provider 返回空串即等于不注入 | 阶段"丢弃"的最轻实现 |
| suppressRuntimeContext() | 抑制本作用域全部动态上下文 | 整体关闭的备用手段 |
| 前缀复用与 in-history | 未变则复用；变化则从首个变化 token 起失效 | 目录段保持稳定 |
| 段落位 personaPrefix(0) / harness 源码(10000) / Web(10100) / personaSuffix(10200) | 第一方段落顺序 | 目录段建议取 10150（自定义 order 需自填） |

---

## 4. 条目模型

    {
      "id": "office-ppt",
      "kind": "skill",              // persona | skill；缺省即 persona（向后兼容）
      "domain": "doc",              // persona 必填；skill 不填（能力轴正交）
      "name": "PPT 工具",
      "when_to_use": "制作/修改/阅读 pptx、导出 PDF、逐页出图时",
      "trigger_keywords": ["pptx", "幻灯片", "演示文稿", "导出PDF", "转图片"],
      "skill": "office-ppt",
      "source": { "origin": "dsh-doc-suite", "fingerprint": { } }
    }

- persona 保留现有字段：id / name / domain / role_tag / when_to_use / trigger_keywords / file / source；
- skill 条目由能力层自动生成到 experts/skills.auto.json（可重建、可入库）；
- source.review = "pending" 表示未经专业复核（当前 8 条，退场后按新库重算）。

---

## 5. 注入通道分工

| 通道 | 内容 | 变化频率 |
|---|---|---|
| systemPrompt.section（name: dsh-experts:catalog，order 10150） | 专家库目录段：5 个行业域 -> 成员 + 一句话；单列「可用能力」节 | 仅在专家库自身变动时变 |
| systemPrompt.context（name: dsh-experts:persona，order 480，沿用） | 本轮命中 persona 精简卡 + 能力指针行 + 交付层纪律块 | 每轮按任务变 |

目录段独立小预算（建议不超过 400 字符），与 context 预算分开核算。

---

## 6. 匹配与动态装填

成本模型（替代"个数"配额）：

| 条目 | 成本常量 |
|---|---|
| persona 精简卡 | COST_PERSONA_CARD 约 500 字符 |
| 技能指针行 | COST_SKILL_LINE 约 100 字符 |

装填规则：
1. persona 池排序（显式 > 任务实证 > 总分 > 索引顺序）；
2. skill 池独立排序（不依赖 persona 命中，每轮都跑）；
3. 按成本依次装入总预算（expertInjectBudgetChars 建议 1400 -> 2000）；
4. 阈值守门：persona 不低于 expertMinScore（0.35）；skill 按开放命中，靠强信号入选；
5. 降级顺序：mixed -> persona 卡 + 指针 -> 丢指针 -> persona 卡 -> 只留自检红线行；任何降级与截断都写明。

**去重粒度（关键改动）**：由 domain 改为 role_tag[0]（职能键）。原因：域变粗为"行业"后，infosec 一域含多个职能，按域去重会把多视角锁成一位。冻结后 infosec 的四个职能键两两不同（售前 / 销售 / 投标 / 测评），可同轮并存。

设置项调整：
- expertInjectMax 降级为 persona 软上限（默认 2，0 = 不限），技能不占该配额；
- 新增 skillInjectEnabled（默认 true）、skillBudgetChars（默认 300）；
- expertInjectBudgetChars 默认 1400 -> 2000；
- limits.js / settings.js / README 三处默认值必须一致（injection-tier-test.mjs 专门检查）。

---

## 7. 能力层（能力轴）：工具/技能专家

**定位**：与"域"正交的第二条轴。无论本轮代入哪位专家，都先去找能力条目——有则带上、无则创建。

**为什么不放 general 域**：① 8+ 条会撑爆"general 只留 1-2 条"的约束；② 会吃到无关的行业先验分（技能命中应靠动作与格式信号）；③ 会被 enabledDomains 收窄误伤。

**为什么不做成"一个独立专家条目"**：一个条目管全部技能=退回静态路由表，失去按需精确命中，且仍占注入预算。

| 函数 | 职责 |
|---|---|
| discoverSources() | 盘点技能源：工作区 .dsh/skills、全局 skills、插件内置（含 dsh-doc-suite） |
| buildIndex() | 扫 SKILL.md frontmatter（name / description）-> 生成技能条目 -> 写 skills.auto.json |
| fingerprint() | 源目录 mtime + 每个 SKILL.md 的 mtime/size + 插件 package.json 版本 |
| ensure(skill) | lazy create：任务需要但索引没有 -> 从源创建；源也没有 -> 记"本机无此能力" |
| route() | 返回本轮命中的技能指针行 |

指针格式（只放指针，不放做法原文）：

    【工具·office-ppt】演示文稿读写 / 导出 / 逐页出图 · skill 加载

**语义澄清**：lazy create 创建的是条目（路由记录），不是能力本身。本机确实没有该技能时只能如实不注入，不得编造。

**已核实**：本机工作区技能 9 个，会话可见 10 个（多一个 vibe）-> 技能源不唯一，必须先盘点。

---

## 8. 交付层：纪律块（自检红线的新家）

- 内容来源：项目记忆（最终落盘处）。专家库只读 + 指纹，不修改记忆文件；
- 注入：每轮随动态块走，永不丢弃（执行阶段也保留）；
- 格式：项目记忆中以独立段标记纪律条目，实施时与 work-memory 对齐；
- 读不到时不静默：输出一行"纪律红线未加载（项目记忆不可读）"。

---

## 9. 阶段与任务粘性

命令：/expert phase understand | execute | deliver（会话级内存态，与现有 tempState 同处）。

| 阶段 | 视角层 | 能力层 | 交付层 |
|---|---|---|---|
| understand | persona 卡 | 指针 | 保留 |
| execute | 丢方法行，留自检红线 | 保留并强化 | 保留 |
| deliver | 只留"交付与自检" | 保留 | 强化 |

任务清单粘性：要做。清单由主对话维护，插件只读状态；清单确认后锁定 persona 集合，任务结束释放。前置核实：插件能否读到会话 todo（读不到则退化为显式置位）。

必须说明：丢弃不等于抹除历史；context 变空只是后续轮不再注入，历史中的卡仍在模型历史里。

---

## 10. 域体系与配额（冻结 2026-09-14）

**五行业域 + 一通用职能域**；**行业域**每域最多 4 个、最少 1 个；**general 域为特例，上限 8**（核查 / 排版 / 文档 / 演示 / 设计等跨行业职能自然聚集于此）；能力轴不占域。

> 实施更新（2026-09-14）：实际落地 **19 位** —— infosec 4 / accounting 4 / coding 3 / finance 2 / hr 1 / **general 5**。

| 域 id | 中文 | 定位 | 配额 | 实际 |
|---|---|---|---|---|
| infosec | 信息安全 | 工控/网络安全、等保、销售与方案 | 4 | 4 |
| accounting | 财务 | 企业会计口径：记账/税务/分析/内控 | 4 | 4 |
| hr | 人力资源 | 劳动关系 | 4 | 1 |
| coding | 代码编程 | 软件工程 / DSH 插件 / 代码审查 | 4 | 3 |
| finance | 金融 | 量化策略 / 投资研究 | 4 | 2 |
| general | 通用（兜底，**特例**） | 跨行业职能：核查 / 排版 / 文档 / 演示 / 设计 | **8** | 5 |

**命名口径**：财务用 accounting，金融用 finance（原 finance 域内容迁往 accounting，腾出 finance 给金融）。

**id 前缀统一**：与域保持一致（本批一并做，避免长期前缀与域不符）。

---

## 11. 冻结后的完整名单（19 位）

### infosec 信息安全（4）
| 新 id | 名称 | 来源 | 处置 |
|---|---|---|---|
| infosec-ics-security | 工控安全售前 | presales-ics-security | 改名（前缀） |
| infosec-sales-engineer | 工控安全销售工程师 | presales-sales-engineer | 改名 + 改定位 + 补工控关键词 |
| infosec-bid-proposal | 投标/方案策略师 | presales-bid-proposal | 改名 + 第一标签调为"投标" |
| infosec-djbh | 等保测评 | aftersales-djbh | 改名 + 第一标签调为"测评" |

职能键（role_tag[0]）：售前 / 销售 / 投标 / 测评 —— 两两不同，可同轮并存。

### accounting 财务（4）
| 新 id | 名称 | 来源 |
|---|---|---|
| accounting-accountant | 会计师 | finance-accountant |
| accounting-tax | 税务师 | finance-tax |
| accounting-analyst | 财务分析师 | finance-analyst |
| accounting-compliance | 财务/内控合规分析师 | finance-compliance |

### hr 人力资源（1，新增）
| id | 名称 | 定位 |
|---|---|---|
| hr-labor-law | 劳动关系与劳动法 | 劳动合同、社保、争议处理 |

### coding 代码编程（3，新增）
| id | 名称 | 定位 |
|---|---|---|
| coding-engineer | 软件工程师 | 架构、实现、调试、重构 |
| coding-dsh-plugin | DSH 插件开发 | Cordis 插件模型、设置命名空间、回归测试 |
| coding-review | 代码审查与质量 | 审查、边界检查、发布前自检 |

### finance 金融（2，新增）
| id | 名称 | 定位 |
|---|---|---|
| finance-quant | 量化策略 | 回测、因子、风控、代码规范 |
| finance-research | 投资研究 | 公司/财报/宏观 |

### general 通用职能（5，特例上限 8）
| 新 id | 名称 | 来源 | 处置 |
|---|---|---|---|
| general-fact-check | 事实核查与溯源 | general-fact-check | 保留 |
| general-typeset | 报告与方案排版 | doc-report-typeset | 换域 + 改名 |
| general-office | 文档与表格处理 | doc-office | **归档后恢复**（使用者补充需求） |
| general-slides | 演示与汇报设计 | doc-ppt | **归档后恢复**（使用者补充需求） |
| general-designer | 视觉与界面设计师 | 外部 design 类 | 新增 |

---

## 12. 硬退场名单（10 位）

| 原 id | 原因 |
|---|---|
| presales-cyber-security | infosec 配额 4，第 4 位选了销售侧 |
| presales-gov-digital | 五域无"政务" |
| aftersales-ics-support | infosec 配额 4 |
| aftersales-cyber-support | infosec 配额 4 |
| aftersales-pentest | infosec 配额 4 |
| finance-cashier | 与个人金融/售前场景不匹配 |
| doc-office | 被 office-* 技能完全替代 |
| doc-ppt | general 只留 2 位，选了核查与成文 |
| legal-civil | 五域无法务域 |
| legal-criminal | 五域无法务域且无使用场景 |

硬退场 = 删除条目与正文（不留软退场）。

**后续修订（2026-09-14）**：使用者补充需求后，doc-office 与 doc-ppt 已从归档恢复为 general-office（文档与表格处理）与 general-slides（演示与汇报设计），并另新增 general-designer（视觉与界面设计）。原"演示视角与排版视角不再有专家"的代价说明作废；general 域因此达 5 位，配额特例上限 8。

---

## 13. 新增名单（6 位，需撰文）

hr-labor-law · coding-engineer · coding-dsh-plugin · coding-review · finance-quant · finance-research

另需改造 2 位：infosec-sales-engineer（改定位）、general-typeset（换域改名）。

---

## 14. 能力轴（无域，自动生成，目录段单列）

office-word · office-excel · office-ppt · pdf-tools（dsh-doc-suite）
knowledge-base · web-fetch · workflow-authoring · skill-management（工作区 .dsh/skills）
待盘：会话可见但工作区没有的 vibe；全局 skills 目录。

---

## 15. 变更清单（改动点）

| # | 改动 | 文件 | 类型 | 依赖 |
|---|---|---|---|---|
| 1 | 条目模型加 kind，persona / skill 分池 | experts/index.json、lib/store.js | 新增 | - |
| 2 | 交付层纪律块（只读项目记忆 + 指纹） | 新增 lib/discipline.js | 新增 | 1 |
| 3 | 专家库目录段走 section | lib/inject.js、lib/index.js | 新增 | 1 |
| 4 | 能力层：指针 + lazy create + 指纹 | 新增 lib/capability.js、experts/skills.auto.json | 新增 | 1 |
| 5 | 动态装填 + 去重粒度改 role_tag[0] | lib/limits.js、lib/inject.js、lib/match.js、lib/settings.js、README.md | 修改 | 1 |
| 6 | 阶段 + 任务清单粘性 | lib/index.js、lib/inject.js | 新增 | 3 |
| 7 | 域重划 + id 改名 + 退场 + 新增专家 | experts/**、experts/index.json | 修改 | - |

顺带修复：lib/index.js 的 lastKey / lastText 是 apply 级闭包、不按会话，多会话会互相顶掉缓存 -> 改为按 sessionId 存。

---

## 16. 验收口径

| # | 怎么算通过 |
|---|---|
| 1 | 老 index.json（无 kind）仍能正常匹配；技能条目出现在 skills.auto.json |
| 2 | 项目记忆改一行红线，下一轮注入即变；记忆不可读时有明示、不静默 |
| 3 | 切换命中专家时 system 节点不动；目录段只在增删专家/技能时变 |
| 4 | 删掉一个技能后自动降级、不报错；指纹未变时有日志证明未重扫描 |
| 5 | expertInjectMax 保持 2 时技能仍能注入；降级链不会把技能整条吃掉；三处默认值一致 |
| 6 | /expert phase execute 后方法行消失、红线行保留；多会话缓存不串 |
| 7 | 16 位专家全部落在 6 个域内且每域不超过 4；10 位退场条目已删；不越权尾注可见 |

---

## 17. 回归用例

| 脚本 | 增改 |
|---|---|
| scripts/regression.mjs | +kind 分池、目录段生成、成本装填、降级新序、域配额校验 |
| scripts/injection-tier-test.mjs | 默认值三处一致（新预算 2000 / skillBudget 300） |
| scripts/smoke-load.mjs | +section 注册、/expert phase、能力层调用 |
| scripts/coexist.mjs | 与 work-memory 的 section / context order 不冲突 |
| 新增 capability-test.mjs | 源盘点、指纹命中/失效、lazy create、源缺失降级 |
| 新增 phase-test.mjs | 三阶段裁剪 + 红线保留 |

---

## 18. 实施顺序与分批

顺序：1 -> 5 -> 3 -> 7 -> 2 -> 4 -> 6

**批一（内容层，可见效果、可回退）**：域重划 + id 统一 + 硬退 10 位 + 新增 6 位 + 改造 2 位 + match.js 去重粒度一处小改（去重必须同批，否则 infosec 的 4 位互相锁死）。

**批二（架构层）**：kind 分池、能力层、section 目录段、交付层、阶段、身份退场。

版本：0.1.4 -> 0.2.0，在源码仓建 feature 分支；改完跑全套回归，升 patch 版本 -> dsh plugin --profile desktop install --force -> 比对 SHA256 -> 重启。

| 风险 | 缓解 |
|---|---|
| 技能开放命中带来噪声 | 强信号 + 预算守门 + skillInjectEnabled 一键关 |
| 交付层读记忆文件引入耦合 | 只读 + 指纹；读不到时明示 |
| 目录段进 system 会打断前缀缓存 | 只在专家库自身变动时变 |
| 三处默认值不一致 | 改完先跑 injection-tier-test.mjs |
| 需要旧行为 | expertInjectDetail = full 保留旧注入 |

---

## 19. 待决事项

1. 纪律块在项目记忆中的格式约定（与 work-memory 对齐）；
2. 目录段 order 实测取值（建议 10150）；
3. id 前缀统一是否扩到 accounting / general（本稿按"一并统一"处理）。

---

## 附录 A · 原库现状（2026-09-14，20 位）

presales 5（bid-proposal / sales-engineer / gov-digital / cyber-security / ics-security）
aftersales 4（cyber-support / ics-support / djbh / pentest）
finance 5（accountant / tax / cashier / analyst / compliance）
legal 2（civil / criminal）
doc 3（office / report-typeset / ppt）
general 1（fact-check）

src 与 profile 副本 hash 一致（A5F2B0FA...），版本 0.1.4。

---

## 附录 B · 冻结结果对照（20 -> 16）

保留并改名 5：ics-security、sales-engineer（改造）、bid-proposal、djbh、report-typeset（换域改名）
保留原名 5：accountant、tax、analyst、compliance、fact-check
新增 6：hr-labor-law、coding-engineer、coding-dsh-plugin、coding-review、finance-quant、finance-research
硬退 10：cyber-security、gov-digital、aftersales-ics-support、aftersales-cyber-support、aftersales-pentest、cashier、doc-office、doc-ppt、legal-civil、legal-criminal

核对：10 保留 + 6 新增 = 16；20 - 10 = 10 保留位；账目一致。

---

_本文件为冻结稿；第 19 节待决事项已落地（见第 20 节）。_ 

---

## 20. 实施记录与差异（2026-09-14）

**批一（内容层）**：域体系收敛为 5 行业域 + general 特例；19 位专家重建（每位 5 轮优化 + L1 精简卡）；id 前缀与域统一；去重粒度改 `role_tag[0]`；L1 卡契约 clip 90 + 卡友好结构。详见 CHANGELOG「0.2.0」。

**批二（架构层）**：kind 分池 · 成本装填 · section 目录段 · 交付层纪律块 · 能力层技能指针 · 阶段切面 · 多会话缓存按 sid。详见 CHANGELOG「十一、批二·架构层」与 `docs/handover.md` 4.10。

**与设计稿的三处实施差异**：

| 设计稿 | 实施 | 理由 |
|---|---|---|
| 能力层 `discoverSources()` 自扫技能源 + `ensure()` lazy create | **首选宿主 `ctx.skills` 注册表**（异步预取 + 同步读缓存）；`experts/skills.auto.json` 降级为兜底 + 可入库审计（由 `scripts/skill-index.mjs` 生成） | 调研实测宿主注册表已做合并 / 重名裁决 / 热监视 / 缓存，比自扫更准更省；其 `list()/snapshot()` 是 async 而注入回调是同步的 → 预取进缓存。注册表总是最新，**lazy create 不再需要** |
| 第 19 节待决 1：纪律块格式约定 | 采「**一条标准记忆条目 + 固定前缀 `【纪律块 v1】` + 列表行**」，`tag=关键` | 调研实测 work-memory 只认 `\n§\n` 分条，`## 标题` 会被并入相邻条目正文；`tag=关键` 永不转冷 |
| 第 9 节：任务清单粘性「清单确认后锁定 persona 集合」 | **只用于推断阶段**（有未完成 → execute，全完成 → deliver），不锁定 persona 集合；自建 10 分钟时间窗缓存兜底 | 宿主每轮 `turn/start` 会把 `todos` projection 清零，跨轮锚点不可靠；锁定集合会让任务中途无法换视角 |

**第 19 节待决事项的落地结果**：① 纪律块格式 → 见上表第 2 行；② 目录段 order → **实测取 10150**（宿主 `SECTION_ORDERS` 中 10100 与 10200 之间无占用）；③ id 前缀统一 → 批一已全库统一。

**验收（2026-09-14）**：`regression 41/0` · `injection-tier 17/0` · `capability-test 8/0` · `phase-test 6/0` · `smoke-load 22/0` · `coexist 8/0` · `card-preview --all` FAIL 0 · WARN 0 · OK 19 · INFO 3 · src ↔ profile 哈希全一致。

---

## 21. 0.3.0 修订（2026-09-14 晚）：命中链路修复 · 打分简化 · 移除命令

**一、命中链路（本设计的隐含前提曾被证伪）**：第 6 节假定"插件能拿到任务文本"，但宿主 `systemPrompt.assemble` 只传 `{ agent, scope, signal }`（`@deepseek-ai/dsh-agent/lib/types/dispatch.js:92`），原 `extractTaskText` 的 5 条路径在该宿主上全部失效 → 打分输入恒空 → 每轮退化为岗位先验兜底（与第 6 节"按任务实证装填"完全相悖，且掩盖了两个版本的故障）。修法：接住 `agent/inbox/claimed`（claim 早于 assemble：`dsh-agent-loop:889 → :107 → :890`）作主通道，`agent/pre-step` 的 `messages` 作备通道，两者**只读缓存**、不写 `decision.messages`。

**二、身份退场落地**（第 1/2/18 节要求、批二漏做）：`identityExpertOf` 留空返回 `null`，不再回退"岗位域第一位"。

**三、打分 v3**（第 6 节简化）：只留"任务实证（关键词命中）决定是否注入"，岗位先验降为**同证据时的排序**；删 `branch` / `explicit` 两个死信号；`role_tag` 退出打分、只作职能去重键；删设置项 `expertMinScore`（落地"零命中不注入"后已无路径使用）；补位门槛改纯证据比较。

**四、第 9 节阶段切面作废**：阶段原先只由 `/expert phase` 驱动，命令移除后 `resolveStage` / todo 投影读取 / `inject.js` 的 stage 裁剪全部下掉。

**五、命令通道移除**：宿主命令模型只有单行 `input.hint`、**无结构化子命令候选**（官方 `/goal`、`/plan` 亦然），实际使用频率低；能力由「自动命中 + `expert_recall` + 设置页」承担。需要临时切视角时在对话里直接说一句即可。

**验收（0.3.0）**：`regression 46/0` · `injection-tier 16/0` · `capability 8/0` · `coexist 8/0` · `smoke-load 18/0` · `card-preview --all` FAIL 0 · WARN 0 · OK 19 · src ↔ profile 哈希一致。
