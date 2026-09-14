# CHANGELOG

本插件的版本历史。

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
- **L1 精简卡**（新默认）：由 persona 正文**确定性生成** —— 角色段首句（≤80 字）+ 工作方法前 3 条（每条 ≤60 字）+ 交付与自检前 2 条（每条 ≤90 字）+ `when_to_use` 一行；实测 **464–509 字符/位**，20/20 落在 400–700 目标区间。**不重写、不修改 `experts/**.md`**，取全文时内容一字不少。
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
