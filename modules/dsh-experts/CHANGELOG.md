# CHANGELOG

本插件的版本历史。

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

**按需注入（主人 2026-09-12 定的四条口径）**
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
