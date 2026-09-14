# infosec 域优化日志（4 位）

> 样板 infosec-sales-engineer 的完整 5 轮记录见 optimization-log.md；本文件补齐同域其余 3 位
> 共同约束：至少 3 个不同来源交叉；三段式（角色 / 工作方法 / 交付与自检）；为 L1 卡而写（方法前 60 字自成一句）

---

## infosec-bid-proposal（投标/方案策略师）｜正文 1518 字符 · 卡 468 字符

**来源（3 个）**：agency-agents-zh/sales/sales-proposal-strategist.md（MIT，赢标主题 / 三幕叙事 / 执行摘要技艺）· agency-agents-zh/sales/sales-deal-strategist.md（MIT，赢区-胶着区-输区）· 本库既有 presales-bid-proposal.md（中国招投标口径）

- **R1**：以本库成品为骨架（它已含评标办法、废标红线、偏离表），补入源A 的"执行摘要五段收口""把甲方名称换掉仍通顺就不是为这个项目写的"两条检验，与源B 的三区定位。
- **R2**：核对《招标投标法》《政府采购法》口径；保留"低于成本价中标是饮鸩止渴""不承诺保中标"等底线表述。
- **R3**：方法 8 条全部改成"短标题 + 前 60 字自成一句"；交付物行压到 90 字内。
- **R4**：动作化（"先读评标办法，再读技术需求"），删掉"赋能/闭环"类词。
- **R5**：与 infosec-sales-engineer 划界（本专家管标书与评分，不碰客户关系与 POC 商务）；与 infosec-ics-security 划界（不写技术方案架构，只做技术应答组织）。

## infosec-ics-security（工控安全售前）｜正文 2019 字符 · 卡 497 字符

**来源（3 个 + 官方标准）**：本库既有 presales-ics-security.md（上游 daemon-blockint / Masriyan / nxl801，MIT）· agency-agents-zh/security/security-architect.md（MIT，对抗式思维）· awesome-subagents-cn/.../04-quality-security/compliance-auditor.md（MIT，证据与持续合规）

- **R1**：保留底本的工控专业内核（Purdue/ISA-95、Zone/Conduit/SL、生产连续性优先），这是外部库没有的内容。
- **R2**：新增**对抗式思维四问**（什么会被滥用 / 失效时会怎样 / 谁会获益 / 爆炸半径多大）作为独立方法条；补《关键信息基础设施安全保护条例》与 NIST SP 800-82r3 口径。
- **R3**：方法重排为"先影响后风险"打头，8 条前 60 字自成一句。
- **R4**：术语与现场叫法并列（上位机 / 操作站 / 历史站 / 工程师站 / 集控）。
- **R5**：与 sales-engineer 划界（本专家出方案与应答内容，不做客户关系与商务）；红线自检保留"绝不在运行中的生产网做主动扫描、探测、写入"。

## infosec-djbh（等保测评）｜正文 2018 字符 · 卡 483 字符

**来源（3 个）**：本库既有 aftersales-djbh.md（上游 openocta/openocta_skills，MIT）· agency-agents-zh/security/security-compliance-auditor.md（MIT）· agency-agents-zh/support/support-legal-compliance-checker.md（MIT）

- **R1**：保留底本六阶段流程与三维取证框架。
- **R2（纠错）**：**结论口径修正** —— 底本写"符合 / 部分符合 / 不符合"，等保测评的标准结论是"**符合 / 基本符合 / 不符合**"；已改，并补数据安全法、密码法。方法条里新增源A 的**审计师思维**：反推"测评方会怎么抽样、要什么原始记录、证明的是今天存在还是全周期有效"，以及"抽样要保证任何一台被抽到都能过""例外必须写清谁批准/为什么/何时到期/补偿措施"。
- **R3**：方法 8 条按卡契约重排；法规清单保留"未核对的不写条款编号"。
- **R4**：动作化（"发现真实入侵迹象立即停止并转应急流程"）。
- **R5**：与 infosec-ics-security 划界（测评不出具结论、售前不替客户定级，互为边界）；与 sales-engineer 划界（不碰商务）。

---

_汇总：infosec 域 4 位完成，正文 1518–2019 字符，卡 468–512 字符，均在规则区间内。_
