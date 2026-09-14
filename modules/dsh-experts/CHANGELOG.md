# CHANGELOG

本插件的版本历史。

## 0.2.0 — 2026-09-14（域体系按行业重划 · 专家重建为 19 位）

### 一、域体系重划：职能域 → 行业域

- 旧 6 域（presales / aftersales / finance / legal / doc / general，本质是**职能**）重划为 **5 个行业域 + 1 个通用职能域**：
  infosec 信息安全 · accounting 财务 · hr 人力资源 · coding 代码编程 · finance 金融 · general 通用职能。
- **命名口径**：财务用 accounting、金融用 finance（原 finance 域内容迁往 accounting，腾出 finance 给金融）。
- **配额**：行业域每域最多 4 位、最少 1 位；**general 为特例，上限 8**（跨行业职能自然聚集：核查 / 排版 / 文档 / 演示 / 设计）。
- **id 前缀与域统一**：infosec-ics-security、accounting-tax、general-office 等。

### 二、专家重建：20 位 → 19 位

- 全部按 **5 轮优化**（起草 / 专业口径 / 卡契约 / 语言 / 精简去重）重写，每位 **至少 3 个不同来源交叉**；正文 1202–2024 字符，L1 卡 375–602 字符（方法条 clip 90）。
- **新增 9 位**：hr-labor-law、coding-engineer、coding-dsh-plugin、coding-review、finance-quant、finance-research、general-office、general-slides、general-designer。
- **硬退场 8 位**（归档于 backup/dsh-experts/retired-20260914）：presales-cyber-security、presales-gov-digital、aftersales-ics-support、aftersales-cyber-support、aftersales-pentest、finance-cashier、legal-civil、legal-criminal。
- doc-office 与 doc-ppt 先随域重划退场，后按使用者需求从归档恢复为 general-office（文档与表格处理）与 general-slides（演示与汇报设计）。

### 三、匹配与去重

- **去重粒度由 domain 改为 role_tag[0]（职能键）**：域划粗为行业后，同一行业域内含多个职能（infosec 就有售前 / 销售 / 投标 / 测评四个），按域去重会把多视角锁成一位。现 19 个职能键两两不同，可同轮并存。
- **补位污染修复**：补位比较此前用总分，导致"只沾岗位先验（evidence=0）"的专家被补进无关任务（实测"插件的设置命名空间怎么注册"会补出 infosec-ics-security）。现规则：基准有任务实证时，纯先验候选不补位。

### 四、L1 卡契约（实测固化，写进 docs/handover.md 4.5 节）

- 方法 **1-3 首句必须 ≤90 字符**（2026-09-14 由 60 放宽：太短会丢条件、产生偏差），且**不含超过 3 项枚举**（枚举下沉到方法 4-8）；
- 交付段只取前 2 条、每条 ≤90 字；
- 正文末尾来源标注**必须另起 ## 标题**，用 --- 分隔线会被 listItems 并入交付行；
- 正文一律用**中文引号**（避免精确匹配失败）。

### 五、设置变化

- defaultDomain：presales → **infosec**；
- identityExpert：presales-ics-security → **空**（身份由 work-memory 记忆承担，专家库不再重复常驻）；
- expertInjectBudgetChars：1400 → **2000**（方法条 clip 由 60 放宽到 90，卡长涨到 375–602 后旧预算恰在临界线，稍大即降级丢掉命中专家）；
- L1 卡方法条 clip：60 → **90**（方法首句标准同步放宽，避免太短丢条件）。

### 六、卡友好结构（消除卡面截断）

L1 卡只取「交付与自检」**前 2 条、每条 clip(90)**，长清单必然被截。全库按统一结构改写：

- 「`## 交付与自检`」压成**两条各 ≤90 字的概括**（一条交付物、一条自检）；
- 完整清单下沉到紧随其后的独立段 **`## 交付明细`**——**必须放在「`## 交付与自检`」之后**（解析器 `pick(['交付','自检'])` 取第一个命中标题，放前面会把明细当成交付段）；
- 结果：**19/19 位 card-preview FAIL 0 · WARN 0**（此前 WARN 19）。

### 七、开发者工具与质量门禁

- **新增 `scripts/card-preview.mjs`**：L1 卡验收工具 —— `--all` 审计全库、单查 `"<正文>" <id> <name> [when]`、`CARD_SHOW=1` 打印卡面；判据分级 **FAIL**（方法 1-3 首句 >90 字符，或卡为空）/ **WARN**（交付段前 2 条 >90、卡长越出 500–620）；退出码 0/1 可接 CI；**不依赖宿主运行时**（缺 `@deepseek-ai/schemastery` 时自动降级）。
- **测试全绿**：`regression` **32/32**（新增：file 真实存在 / 域配额（行业 ≤4、general ≤8、每域 ≥1、计数自洽）/ 职能键去重 / 同域不同职能可同轮并存 / 补位不污染 / `DOMAINS` 覆盖 index.json 实际域 / **review 域级断言**（高风险域必标、coding 与 general 不标））· `injection-tier-test` **16/16** · `smoke-load` **18/18** · `coexist` **7/7**。

### 八、来源许可红线与平台口径

- **`anthropics/skills` 是 Proprietary**（每个 skill 目录带 `LICENSE.txt`：© Anthropic, PBC，受其 Consumer / Commercial Terms 约束）——**只吸收方法要点（事实性知识 / 流程 / 判断规则），不复制其文本、代码或提示词原文，且不作为"改写来源"归因**；全库 5 处 Anthropic 归因已移除。对照：`anthropics/knowledge-work-plugins` 为 Apache-2.0，`agency-agents-zh` / `awesome-subagents-cn` / VoltAgent 系列为 MIT。
- **本机文档工具是 WPS，不是 Microsoft Office**：persona 统一写 WPS（WPS 文字 / 表格 / 演示、WPS COM）；`.docx/.xlsx/.pptx` 走 python 库（快），旧格式（`.doc/.xls/.et/.wps`）与导出 PDF / 逐页出图走 **WPS COM**（慢、仅 Windows、须已装 WPS）；**WPS 的 COM 进程不会自动退出**，必须显式 Quit + 释放句柄（已进各文档类专家的自检条）。WPS COM ProgID = `KWPS.Application` / `KET.Application` / `KWPP.Application`（**只注册在 HKCU**，且 `dsh-doc-suite` 的 doctor 正是用 ProgID 实例化检测，不依赖安装路径）。
- **`review` 判据改为域级**：`infosec` / `accounting` / `finance` / `hr` 全标 `pending`（共 11 位），`coding` / `general` 不标。

### 九、发布前核对（「现实可用」标准，5 域 19 位）

按 **A 工具可达性 / B 知识时效性 / C 边界正确性** 逐位核对，发现并修正 **19 条偏差**（A 类 1 + B 类 7 + 待核 2 + C 类 9），台账见 `docs/pre-release-audit.md`：

- **A 类 1**：`general-typeset` 把未安装的 gongwen-skill 当执行工具链 → 改 `dsh-doc-suite`；
- **B 类 7**：`hr-labor-law` 试用期工资上下限写反（第 19 条期限上限 / 第 20 条工资下限）· `infosec-ics-security` OPC UA 误列「原生缺认证加密」（改 OPC Classic，补「OPC UA 常被配成 None」）· `infosec-djbh` 判定规则改**符合率**（>60% 且 <90% 基本符合、<60% 不符合）· `accounting-accountant` 科目数 167 → **原指南 156 项 / 2024 汇编 171 个** · `finance-research` 港股改「先确认发行人编制基础」· `general-typeset` 行距 29 磅标为**实现参数非标准条文** · `general-office` 拆开：旧格式**读取/导出**走 WPS COM、**`.xls` 公式重算未实测**；
- **待核 2**（按「不确定就写不确定」）：删「小企业准则 66 个科目」数字 → 「以附录科目表为准」；等保「三级增设安全管理中心」→ 「三级要求更严，具体差异以 GB/T 22239-2019 原文为准」；
- **C 类 9**：权威源访问门槛（知网/万方需订阅、裁判文书网限缩）· A 股 T+1 / 国内期货 T+0 · 实名数据源（巨潮 / 披露易 / 统计局）· 来源补《住房公积金管理条例》· 递延所得税交叉指引 · patch「中性」限定为「不含个人路径与称呼」· 来源段分隔符 · 销售与售前职责边界 · 投标竞争定位场景。
- **教训**：错误高度集中在「**精确数字与条款归属**」——具体数字要么实测 / 查原文，要么不写；拿不准的一律写「以某某原文为准」。

### 十、遗留补齐（2026-09-14 收口）

- **infosec 边界重叠改为双侧对称加注**：`infosec-ics-security` 角色段补「客户约束、决策链与商务推进由 `infosec-sales-engineer` 负责——技术选型口径由我出，商务承诺不由我下」；`infosec-sales-engineer` 方法 7 补场景限定「（现场口头交流；书面标书文本的竞争定位交投标侧）」，与 `infosec-bid-proposal` 方法 6 的「用于标书文本」对称。
- **会计 4 位 + 金融 2 位补工具路径**：在 `## 交付明细` 末（**不进 L1 卡**、零卡面风险）补 `**工具路径**` 一条——`dsh-doc-suite` 的 `office-excel` 取数 / 重算 / 透视 + `office-word` 成文；统一 **WPS** 口径，旧格式 `.xls/.et` 走 WPS COM 较慢，并写明「**公式先重算再读数**」（避免读到旧缓存或空值）。
- 补后复验：`card-preview --all` **FAIL 0 · WARN 0 · OK 19 · INFO 3** · `regression 32/0` · `injection-tier 16/0` · `smoke-load 18/0` · `coexist 7/0` · src ↔ profile 哈希一致。

### 十一、批二·架构层（2026-09-14，0.2.0 内含）

design-v2 第 15/18 节的架构层改造落地（实施顺序 1 → 5 → 3 → 2 → 4 → 6）：

- **kind 分池**：条目分 persona / skill 两池（`kind` 缺省即 persona，向后兼容）；新增 `readSkillsIndex()` / `kindOf()` / `allPersonas()` / `allSkills()` / `findSkill()`，自动匹配与注入只走 persona 池，能力条目走能力轴。
- **专家库目录段**（`systemPrompt.section`，name `dsh-experts:catalog`，order **10150**）：六域成员 + 「可用能力」，≤400 字符；**稳定段** —— 只在专家库增删专家/技能时变，不打断系统提示词前缀复用（宿主 README.zh.md:149）。
- **交付层·纪律块**（`systemPrompt.context`，name `dsh-experts:delivery`，order 481）：自检红线的新家。只读记忆库 `PROJECTS/dsh-experts.md` 的 `【纪律块 v1】` 条目（`mtime+size` 指纹缓存，**绝不写记忆**）；`absent` 静默 / `unreadable` 明示一行（不静默）；与 persona 段分开注册 → **不参与**预算降级、阶段裁剪时不丢。判定采「**正文以 `【纪律块 v1】` 开头**」而非「包含」—— 否则别的记忆条目只要在正文里提到这个词，就会被误当成红线内容（2026-09-14 实测踩到并已修正）；记忆根解析为 设置项 → work-memory 的 `memoryDir` → `$DSH_HOME/memories/*` 中含 `PROJECTS` 的目录。
- **能力层**（`lib/capability.js`）：工具 / 技能专家。数据源**首选宿主 `ctx.skills` 注册表**（异步预取 + 同步读缓存，TTL + cwd 变化刷新），拿不到时退回 `experts/skills.auto.json`（由新增 `scripts/skill-index.mjs` 离线生成，本轮已入库 **10 条**）；只注入**指针行**（≈100 字符/条），做法原文交给 `skill` 工具；**开放命中**（只看强信号），**不占** `expertInjectMax`、**不受** `enabledDomains` 收窄。
- **成本装填**：新增 `COST_PERSONA_CARD` / `COST_SKILL_LINE` / `SKILL_BUDGET_DEFAULT|MIN|MAX` / `clampSkillBudget`；`expertInjectMax` 降级为 **persona 软上限（0 = 不限）**。
- **阶段切面（层 5）**：`/expert phase understand|execute|deliver|auto`（会话级）。understand = 完整卡；execute = 丢方法行、保留角色与交付、能力指针上限 3 → 5；deliver = 只留「交付与自检」。阶段也可由**任务清单**推断（只读 `sessionProjections` 的 `todos`；宿主在 `turn/start` 会清零，插件自建 10 分钟时间窗缓存兜底，读不到则退化为显式阶段）。
- **顺带修复**：注入文本缓存由 apply 级闭包 `lastKey/lastText` 改为 **`Map` 按 sessionId 分槽** —— 多会话交替时不再互相顶掉缓存（原实现每次会话切换都重算、缓存命中率退化；因缓存键含选中集合与设置，**内容本身不会错配**）。
- 新增设置项：`expertCatalogEnabled` / `skillInjectEnabled` / `skillBudgetChars` / `disciplineEnabled` / `disciplineMemoryDir`（schema / DEFAULTS / patch base **三处一致**，已进注入分级测试）。
- 验收（2026-09-14）：`regression 41/0` · `injection-tier 17/0` · **`capability-test 8/0`** · **`phase-test 6/0`** · `smoke-load 22/0` · `coexist 8/0` · `card-preview --all` **FAIL 0 · WARN 0 · OK 19 · INFO 3** · **src ↔ profile 哈希全一致**（发布件 43 个文件）。
- 新增开发工具：`scripts/capability-test.mjs`（能力层：映射 / 指针行 / 开放命中 / 预算守门 / 指纹不重扫 / 兜底索引）、`scripts/phase-test.mjs`（阶段矩阵：全库四态裁剪 + 卡长单调 + 红线保留 + full 不裁剪），均不依赖宿主运行时、退出码 0/1 可接 CI。

---

## 0.1.4 — 2026-09-14（匹配排序修复 + 提示词注入分级）

### 一、修「跨域单关键词任务被岗位域先验压过」（排序口径）

**症状**：每域只沾一个词的跨域任务拿不到对口专家。实测「这份采购合同的钱怎么算、税怎么处理」（期望：法务 + 会计）排序第一是 `presales-bid-proposal`（总分 0.35，理由只有「岗位域·presales」、证据分 0），而对口专家 `legal-civil` 只有 0.25、`finance-tax` 只有 0.2 —— 岗位先验给本域每位专家都加同样的 0.35，跨域专家天然吃亏。

**修法**（`lib/match.js`，两处）：
- `rankExperts` 排序键改为 **显式指定 > 任务实证（evidence）> 总分 > index.json 顺序**：有实证的排前面，「只沾岗位域」的退后面；同档内仍按总分降序。显式指定（`/expert use`、消息点名）单独占最高优先级。
- `selectExperts` 的 `expertMinScore` 门槛只卡**零实证**的候选：`evidence > 0` 说明任务确实指向它，分低也注入；纯靠岗位先验兜底的才受阈值约束。

**效果**：同一任务排序第一变为 `legal-civil`；上限 2、无身份专家时「法务 + 会计」可同时选中（有身份专家时仍按「身份专家恒选」占一位，需 `expertInjectMax=3` 才能再补第二位 —— 分级注入后单轮预算已足够）。空任务仍由岗位先验兜底，短任务行为不变。

### 二、提示词注入分级（L0 目录 / L1 精简卡 / L2 全文）

**问题**：每轮把 persona **正文全文**注入 `systemPrompt.context`（默认 2 位，约 4.5–5.2KB 中文），叠加记忆快照后单轮固定开销约 8–9KB，纯属常驻成本。

**修法**：
- **L1 精简卡**（新默认）：由 persona 正文**确定性生成** —— 角色段首句（≤80 字）+ 工作方法前 3 条（每条 ≤90 字，2026-09-14 由 60 放宽）+ 交付与自检前 2 条（每条 ≤90 字）+ `when_to_use` 一行；实测 **464–509 字符/位**，20/20 落在 400–700 目标区间。**不重写、不修改 `experts/**.md`**，取全文时内容一字不少。
- **L0 目录**：未命中的专家不进上下文（既有行为），索引靠 `expert_recall` / `/expert list` 现取。
- **L2 全文**：`/expert use`、`expert_recall`、派子代理内联 —— 一切照旧。
- **新设置两项**（默认值三处一致：schema 默认 / `DEFAULTS` / `cordis.patch.yml` 部署层 base）：
  - `expertInjectDetail`：`auto`（默认，按预算降级）/ `card`（全部精简卡）/ `full`（**全文，旧行为，可一键回退**）；
  - `expertInjectBudgetChars`：默认 **1400**（下限 200 / 上限 20000），超预算按序降级：命中专家全文 → 命中专家精简卡 → 只留身份专家精简卡 → 截断；**任何降级与截断都写明，绝不静默超限**。
- 兼容：`buildPersonaBlock` / `buildInjection` 不传 `detail` 时行为与旧版**逐字等价**（`full`）；`/expert use` 固定全文；注入缓存的 key 纳入形态与预算（改设置免重启即生效）。

**实测（auto，默认预算 1400，含 208 字符处理路径提示）**：

| 任务 | 选中 | 旧（全文） | 新（auto） |
|---|---|---|---|
| 写投标方案 | `presales-ics-security` | 1951 字符 | **660 字符** |
| 这份采购合同的钱怎么算、税怎么处理 | `presales-ics-security` + `legal-civil` | 3674 字符 | **1218 字符** |
| 帮我看看这个 | `presales-ics-security` | 1951 字符 | **660 字符** |

专家部分降 **65–77%**（约合每轮省 1.5–2.5k TOKEN）；要完整视角时把 `expertInjectDetail` 改 `full` 或调大预算即可。

**测试**：回归 **27/27**（新增 2 项：证据优先排序、法务+会计同时选中）· 新增 `scripts/injection-tier-test.mjs` **16/16**（卡确定性 / 三态 / 预算降级 / 默认值三处一致 / 旧行为等价）· 装载冒烟 **18/18** · 共存 **7/7**。

## 0.1.3 — 2026-09-13（默认注入上限 1 → 2）

**变更**：`expertInjectMax` 默认值 **1 → 2**。原先 `max=1` 时「身份专家恒选」会先占掉唯一名额，紧接着循环 `break`，导致**排行榜第一的对口专家被挤掉** —— 实测「客户要做三级等保测评，定级备案怎么走」用例里 `aftersales-djbh` 得 **0.7** 分却进不来，实际只注入了 0.35 分的身份专家；改为 2 后补位机制正常工作（`presales-ics-security` + `aftersales-djbh`）。跨域用例同样受益（「这份采购合同的钱怎么算、税怎么处理」→ 补入 `legal-civil`）。

改动**三处，缺一不可** —— 解析顺序是 `schema 默认 ← 部署层 base ← profile patch ← 用户覆盖`：
- `lib/settings.js` 的 `DEFAULTS`
- `lib/settings.js` 的 schema（`z.natural().default(2)`）
- **`cordis.patch.yml` 的部署层 base config** —— 这里原先写死 `expertInjectMax: 1`，会**盖过** schema 默认值；只改前两处等于白改（实施时发现）
同步 `cordis.patch.yml` 与 `lib/settings.js` 里「默认 1 位」的说明文案。

**代价**：每轮多注入 1 位 persona（约 1.3–1.8 千字，UTF-8 约 3.3–4.9KB TOKEN）。使用者可在设置页把 `expertInjectMax` 调回 1。

**测试**：引擎级三档对照实测（max=1 只注入身份专家 / max=2 补入对口专家 / max=3 再补一位）；集成体侧五套门禁全绿（probe 134 · install 169 · basedeck 179 · settings-api 109 · smoke 337）。

## 0.1.2 — 2026-09-13（发布前中立性修复）

发布件中立性清理：移除发布件中的**私有称呼、私有路径与私有业务背景**注释，使其不绑定任何具体使用者环境。

- **私有称呼**：注释与文档文案中的私有称呼统一改为通用表述（需求/产品口径、使用者、本产品、项目），保留「谁定的、何时定的」语义；
- **私有路径**：自测夹具（`scripts/coexist.mjs`、`scripts/smoke-load.mjs`）的会话 `cwd` 改用通用路径，不再引用私有工作区目录；
- **私有业务背景**：`lib/match.js` 的「会话目录 → 域」映射说明改为通用岗位域描述，不含私有助手名与具体公司名；**同时把该映射表 `BRANCH_DOMAIN_HINTS` 的键从私有工作区目录名换成通用岗位/业务目录名**（售前 / 投标 / 财务 / 法务 / 文档 / 笔记 …），映射机制与权重不变。

**行为影响**：除上述**域提示词表**外，运行时行为、匹配逻辑、字段名、默认值与其余字符串常量均未改动。词表换名后，目录名命中不到时 `branchDomain` 为 `null`，退化为只按岗位域与任务信号打分 —— `branch` 只是 0.15 的弱先验，且与岗位域先验取较大者而非相加，其余匹配不受影响。

**测试**：回归 25/25 · 装载冒烟 18/18 · 共存 7/7；`node --check` 覆盖模块全部 .js/.mjs 通过。

## 0.1.1 — 2026-09-12（工具契约修复 · 真机加载失败）

**症状**：真机启动报 `dsh-plugin-desktop: plugin tree failed to load: failed to apply loader entry experts (dsh-experts): tool "expert_recall" must declare output { schema, render, presentationMeta? }`。

**修复**
- **工具定义改为官方结构**：`parameters` 用官方 **DSL**（属性内 `required: true`），不再是 JSON Schema 的 `properties` / `required` 数组；`output` 改为 `{ schema, render }`；`execute` 返回**结构化对象**（`{ ok, kind, id, name, score, reasons, text, error }`），由 `render` 负责呈现（官方 "lossless JSON" 要求）。
- **改用官方 `defineTool()` 辅助**（`@deepseek-ai/dsh-tools`）；无宿主依赖时自动降级为等价普通对象，本地自测照跑。
- **命令 handler 宽容解构**：`async (input, exec)`，会话信息依次从 `input.session` / `exec.agent.session` / `exec.session` 取，取不到则退化为全局状态。
- **冒烟测试补官方契约校验**：mock 的 `tools.register` 现在会像真机一样拒绝不合规的 `output` 与 JSON-Schema 式 `parameters` —— 这类错误以后在本地就会被拦下。

**顺带修正（打分调参）**
- `keywordEach` 0.12 → **0.20**、`keywordCap` 0.48 → **0.60**：修掉"岗位先验把单关键词命中抬过跨域密集命中"的偏差。例：`expert_recall` 查「客户要做三级等保测评」原先返回本域的**网络安全售前**，现正确返回**等保测评**。

**测试**：回归 25/25 · 装载冒烟 18/18 · 共存 7/7；另加"profile 副本加载校验"（对实际安装副本按官方契约做加载校验，仅本机排查用）。

## 0.1.0 — 2026-09-12（首发）

专家库模块首次落地：把"每次临场手写专家人设"变成"按需调用现成专家定义"。

**20 位专家 / 6 域**
- 售前 5：投标/方案策略师、销售工程师（技术售前）、政务数字化售前顾问、网络安全售前、工控安全售前
- 售后 4：网络安全技术支持、工控安全技术支持、等保测评、渗透测试服务
- 会计财务 5：会计师、税务师、出纳、财务分析师、财务/内控合规分析师
- 法务 2：民法法律咨询、刑法法律咨询
- 文档 3：文档处理专家、报告与方案排版、PPT 专家
- 核查 1：事实核查与溯源

**来源与许可**
- 19 位为成熟开源件的压缩改写（MIT 17 条 · Apache-2.0+MIT 双许可 2 条 · Apache-2.0 1 条），1 位自撰（`doc-office`，与本集成体 `dsh-doc-suite` 能力精确对齐）；
- 逐条记录在 `experts/index.json` 的 `source`，汇总见 `NOTICE`；改写一律标 `adapted: true`，**不假称原样**；
- 财务 / 法务 / 安全域按**中国口径**改写（企业会计准则、增值税、发票管理办法、民法典/刑法、GB/T 22239-2019 等保 2.0）；**SOX / GAAP 等美国口径不保留**；
- 上游无成品、由组合改写补齐的 6 位：网络安全售前、工控安全售前、工控安全技术支持、出纳、财务/内控合规分析师、事实核查。

**按需注入（产品口径 2026-09-12 定）**
- 默认每轮只注入 Top-1；`expertInjectMax` 可调 **1 / 2 / 3**，调大时设置页提示「占用较多 TOKEN」；
- 第 2/3 位须**跨域**且达到门槛；无匹配或分数不足 → 不注入（宁缺勿滥，保持通用助手行为）；
- 未注入的专家走**临时注入**：`/expert use <id>` 或工具 `expert_recall`（现取现用，不常驻上下文）。

**身份专家 + 问题归属流程（2026-09-12 二次确认，本轮机制升级）**
- **常驻注入的只有一位**：切合使用者身份的「身份专家」（新设置项 `identityExpert`；留空取本人岗位域第一位）。它**恒选注入、不参与阈值淘汰** —— 哪怕本轮问题不在它的方向（它是"我是谁"的默认视角，不是本轮答案）。
- **其余专家按问题归属补位**：仅当 `expertInjectMax ≥ 2` 且**跨域**时才补；未命中就不注入（宁缺勿滥）。
- 注入文本开头带**处理路径提示**：命中专家 → 按该视角原生处理，或派子代理（`expert_recall` 把 persona 内联进 `subagent.prompt`）；未命中 → 用通用能力原生处理。
- 标题分型，一眼看清来源：`【身份视角·…】` / `【本轮命中·…】` / `【临时注入·…】`。
- **指令层落地**（"真正起效"的关键）：工作区 `AGENTS.md` 与集成体模板 `defaults/AGENTS.zh-CN.md` 均新增「专家库使用流程」段 —— 指令层每轮生效，约束力强于插件自身的注入。

**补位判定用「证据分」**（本地实现细节）
- 总分决定主角（岗位先验 + 关键词 + 会话域 + 显式指令）；补位比的是**任务实证强度**；
- 这样避免"岗位先验给本域每位专家都加分"抬高分母，使「这份合同的钱怎么算、税怎么处理」这类跨域任务补不上第二位。

**设置与安装引导（8 项，全部免重启）**
- `defaultDomain`（本人岗位，`/expert setup <域>` 写入）、`enabledDomains` / `enabledExperts`（全局激活集合）、`expertInjectMax`（1–3）、`expertSecondThreshold`、`expertMinScore`、`expertShowBanner`、`expertsEnabled`。

**使用路径**
自动注入 · `/expert list|use|off|auto|status|why` · 工具 `expert_recall`（派子代理时把 persona 内联进 `subagent.prompt`）。

**复核标记**
安全域 6 位（网络安全售前、工控安全售前、网络安全技术支持、工控安全技术支持、等保测评、渗透测试服务）与法务 2 位在 `experts/index.json` 标 `source.review: "pending"` —— 涉及等保流程、渗透合规边界、法条适用等专业准确性，经使用者或对口同事复核后才算"对外可用"。

**安装引导**
`expertSetupDone` 为假时，注入内容末尾附一行提示（引导跑一次 `/expert setup <域>`），确认岗位后不再出现；`/expert setup <域>` 在设置服务支持写入时直接落盘。

**自测（三套，全绿）**
- `node scripts/regression.mjs` —— 索引完整性、persona 体量（900–3000 字 + 三段标题）、文档域与 `dsh-doc-suite` 分工声明、复核标记、匹配打分与注入组装，共 **22 项**；
- `node scripts/smoke-load.mjs` —— mock ctx 真跑 `apply()`：注册（注入/工具/命令/设置）、注入回调、`/expert` 各子命令、临时注入状态机，共 **15 项**；
- `node scripts/coexist.mjs` —— 与 `dsh-work-memory` 同 ctx 共存的**契约测试**（顺序 480→500、互不覆盖、合并内容、工具与命令无重名），共 **7 项**；能加载 memory 模块时真跑，纯 node 环境自动退回等价契约模拟（脚本会打印走的是哪条路径）。

三套均不依赖宿主运行时（`schemastery` / `dsh-tools` 缺失时自动降级），可直接在本机或 CI 运行；CI 已加入装载冒烟与共存契约两步。
