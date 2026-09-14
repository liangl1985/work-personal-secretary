# dsh-experts 发布前核对 · 偏差清单

> 日期：2026-09-14 | 标准：**现实可用**（A 工具可达性 / B 知识时效性 / C 边界正确性）
> 方法：按域派核对子代理逐个读正文；**只记偏差**，证据须具体（实测输出 / 文件行 / 标准号对比）；拿不准的标"待核"
> 分级：**A 类** = 工具或 API 不真实（必改）｜**B 类** = 知识过期或法条错（尽快改）｜**C 类** = 边界/表述/来源不全（酌情）

---

## finance + hr 域（核对者 49301c40）

| 专家 | 位置 | 偏差 | 证据 | 建议 | 级别 |
|---|---|---|---|---|---|
| finance-research | 角色段第 4 行 | **港股笼统写成"按中国企业会计准则与披露规则读报表"**，且与同段后半句"境外市场按当地准则但要说明口径差异"**自相矛盾**（港股属境外市场） | 港股发行人编制基础不唯一：HKFRS/IFRS、H 股常见 CAS 并附调节表、亦有 US GAAP；会计准则委员会《2024 年中国内地与香港企业会计准则保持持续趋同》——**趋同≠等同**；中金固收《港股上市公司财报怎么看：CAS、IFRS 和 US GAAP 的异同》证多准则并存 | 改为"A 股按 CAS；港股**先确认发行人编制基础**（HKFRS/IFRS，H 股常见 CAS+调节），并说明口径差异" | **B** |
| hr-labor-law | 工作方法第 2 条 + 交付明细·关键口径（两处） | **把"试用期工资"说成有法定上限、"超出即违法"**——上限下限写反 | 《劳动合同法》**第 20 条**是"**不得低于**本单位相同岗位最低档工资或合同约定工资的 80%，并**不得低于**当地最低工资标准"（**下限**义务）；**第 19 条**规定的才是**期限上限** | 改为"试用期**长度**有法定上限（第 19 条）、试用期**工资**有法定下限（第 20 条），**低于**即违法" | **B** |
| hr-labor-law | 来源与许可（第 28 行） | 正文多处提"五险一金/公积金"，来源只列《劳动合同法》《社会保险法》 | 住房公积金依据是**《住房公积金管理条例》**，不由《社会保险法》调整 | 来源补《住房公积金管理条例》 | **C** |
| finance-quant | 角色段第 4 行 | "A 股与国内期货口径…要按 **T+1** 和真实交易时段撮合"把 A 股特有的 T+1 与期货并列，**易读成期货也 T+1** | 国内期货是 **T+0**（当日可平仓），A 股才是 T+1；同句列举的复权/停牌/T+1 均为 A 股特征 | 明确"A 股 T+1；期货 T+0、按合约乘数与保证金" | **C** |

**核对者另注（不构成偏差）**：
- finance-research 方法 3 只泛称"年报/公告/官方统计"，未点名具体权威源（巨潮资讯网、港交所披露易、国家统计局）→ **建议补实名源**（不可验证）。
- finance-quant 来源标注仍含 crypto-analyst / crypto-risk-manager，但**正文已无任何加密/美股残留**（无 crypto / DeFi / 链上 / US GAAP 字样），口径已换为 A 股与国内期货。
- finance-quant / finance-research / hr-labor-law **均未写死易变数字**（无税率、无估值倍数、无社保基数硬编码）✓。
- hr-labor-law 其余法条口径准确（仲裁前置+时效一年、竞业限制三看、经济补偿每满一年一个月、违法解除二倍、规章制度民主程序）；未越权（明示不替代律师意见）；已声明社保公积金属地差异 ✓。

**finance-quant**：无实质偏差。**finance-research**：1 条实质（B）。**hr-labor-law**：1 条实质（B）+ 1 条来源不全（C）。

---

## coding 域（核对者 8f46fea9）

| 专家 | 位置 | 偏差 | 证据 | 建议 | 级别 |
|---|---|---|---|---|---|
| coding-dsh-plugin | 方法 5 | 正文称 patch 的 config「只放中性默认值」，但该 patch 实际含**本部署的岗位默认** `defaultDomain: 'infosec'` ——「中性」与实际不符 | `cordis.patch.yml:21` = `defaultDomain: 'infosec'`；同文件第 4 行注释自称「保持**中性**（不含任何个人路径/称呼）」 | 把「中性」限定为"不含个人路径/称呼"，或写明"部署默认层可含本岗默认域" | **C** |
| coding-engineer | — | **无偏差** | 全文无 API / 脚本 / 命令 / 路径引用；无过窄技术栈；无编造 | — | — |
| coding-review | — | **无偏差** | 圈复杂度 10 / 覆盖率 80% / 500 行属工程惯例，且已留"超了要说清理由"余地，非易变事实数字 | — | — |

**A 类逐项实测为真（无编造，覆盖度可查）**：
- `inject` 声明 → `lib/index.js:37`
- `ctx.systemPrompt.context()` → `lib/index.js:120`（dsh-work-memory:91 同）
- `ctx.systemPrompt.section()` → **宿主真实**：`@deepseek-ai/dsh-system-prompt/lib/index.js:238`；官方插件 dsh-persona:37 / dsh-plan-mode:172 / dsh-tool-bash:256 均在用 → "稳定的走 section、逐轮变化的走 context"成立
- `ctx.settings.register(ns, schema, { base })` + get/watch → `lib/settings.js:136/138`；dshmarket、dsh-work-memory 同签名
- `ctx.tools.register()` + `defineTool` → `lib/index.js:191` 与 28–34 行（`try { defineTool = await import(...) } catch { defineTool = null }` + `asTool` 退回）→ 与正文方法 6「依赖要能降级」**逐字对应**
- 参数 DSL「属性内 required: true，不是 JSON Schema 数组」→ 与 `lib/index.js` 注释及 `asTool` 实现一致
- `cordis.patch.yml` + package.json 的 `dsh.bundle.patch` + `- insert:` → `cordis.patch.yml:15`
- `dsh plugin --profile <p> install --force` → **命令真实**：检出 `lib/desktop-cli.js:22`、`lib/pnpm-policy-*.js:18`、`lib/pnpm.js:94`
- 四套脚本 import **只含 node:* 与相对路径**，无 `@deepseek-ai/*` → 「刻意不依赖宿主运行时」成立
- 宿主包真实存在：`@deepseek-ai/dsh-tools@0.1.5-rc.2`、`@deepseek-ai/schemastery@3.18.2`；profile 侧无 `@deepseek-ai` 目录

**B 类**：coding 域无任何法规/标准/税率引用 → 无时效风险。**C 类**：无跨平台承诺、无越权；engineer（作者自测）与 review（审查者验证）角色不冲突。

---

## accounting 域（核对者 5ae5a7f3）

| 专家 | 位置 | 偏差 | 证据 | 建议 | 级别 |
|---|---|---|---|---|---|
| accounting-accountant | 方法 2「科目先对表，不自造」 | 写"企业准则版**约 167 个**"科目 —— **与权威来源不符** | 致同研究《应用指南汇编提示（37）：会计科目列表》：原指南附录列举 **156 项**；《企业会计准则应用指南汇编 2024》补充更新为 **171 个**。167 与两者都不符 | 改为"原指南附录 156 项；2024 汇编更新为 171 个"，或删数字改"以《企业会计准则应用指南》科目表为准" | **B** |
| accounting-accountant | 方法 2 | 写"小企业准则版**约 66 个**"——**未能证实** | 厦门大学法规库《小企业会计准则—会计科目…》（财会〔2011〕17号）可提取 72–75 个科目编号（页面噪音致无法精确计数）；公开来源对"66"无一致权威口径 | 标"待核"或删数字，改"以《小企业会计准则》附录科目表为准" | **待核** |
| accounting-accountant | 方法 4 | 与 accounting-tax 方法 3 都提"递延所得税"（角度不同：会计计提 vs 税会差异），非错误 | — | 若求严，accountant 侧注明"税会差异口径见税务师" | **C** |
| accounting-tax / analyst / compliance | — | **无偏差** | — | — | — |

**A 维度**：4 位均未引用任何技能名/脚本/命令/API/路径 → 无工具类偏差。
**但有一处缺失（非偏差）**：4 位**都没给"报表取数 / 文档生成"的工具路径**（如 dsh-doc-suite 的 office-excel）——做表类任务时没有技能指引，属"现实可用"角度的可补项。

**已核实为正确（供判断，非偏差）**：
- 《增值税法》**2026-01-01 施行** ✓ 属实；"年应征增值税销售额 500 万元" ✓ 与法律一致；"待认证进项税额" ✓ 与财会〔2016〕22号科目名一致；
- 《企业内部控制基本规范》及配套指引 ✓ 现行（财会〔2008〕7号 + 2010 配套指引）；内控五要素、缺陷三级 ✓；资产减值一经确认不得转回 ✓；
- **未写死任何税率 / 基数 / 优惠额度** ✓（tax 明确"不臆造条款号与税率"、优惠"有明确到期日"）；
- 四位边界声明均正确（accountant"会计按准则、税务按税法调"；tax"票货分离的安排我不接"；analyst"不做账也不报税"；compliance"不出法律意见、不下违法定论"）。

---

## general 域（核对者 e749d8c2）

| 专家 | 位置 | 偏差 | 证据 | 建议 | 级别 |
|---|---|---|---|---|---|
| **general-typeset** | 角色段第 2 段 | **把 gongwen-skill 当作"本工作区的执行工具链"，但本机并未安装该技能** —— 使用者照做会**调用失败** | 实测 E:/lina/.dsh/skills 仅 9 项（image-vision、knowledge-base、office-word/excel/ppt、pdf-tools、skill-management、web-fetch、workflow-authoring）；全局 ~/.dsh/skills 为空；dsh-doc-suite/skills 仅 office-* + pdf-tools。gongwen-skill 只存在于研究目录 experts-research/src/gongwen-skill（163 文件，**未安装**） | 改为"由 dsh-doc-suite 技能执行"；若保留 gongwen 口径须写明"尚未安装、需先安装" | **A** |
| general-typeset | 方法 2 | **把实现参数写成标准条文**：GB/T 9704—2012 只规定"一般每面排 22 行，每行排 28 个字，并撑满版心"，**没有行距数值**；29pt 是为达成 22 行的实现值（版心高 225mm≈637.8pt ÷ 22 ≈ 29pt）；"段前段后 0"亦非标准条文 | 甘肃省政协办公厅官方解读引标准原文，无"行距"条 | 改为"行距取可实现每面 22 行的固定值（常用 29 磅）"，条文与实现参数分开 | **B** |
| general-office | 方法 5 / 方法 9 | 断言"旧格式与**公式重算**走 WPS COM"，但技能文档明确 **recalc 对 .xls 未实测** | office-excel/SKILL.md:68 "旧格式 .xls/.et 的读取与 PDF 导出走 WPS COM…；**recalc 对 .xls 未实测**" | 拆开：读取/导出可走 COM；**.xls 的公式重算标"未实测"** | **B** |
| general-fact-check | 方法 8（中文权威源清单） | 未说明**访问门槛**：知网/万方需机构订阅；裁判文书网自 2021 年起检索大幅限缩（需登录、大量文书下架）。写"优先查"会让人以为一定拿得到 | 公开事实；本机无任何订阅凭证。实测巨潮资讯网 HTTP 200、裁判文书网首页 200（检索受限）；国家标准全文公开系统因跨源重定向未能实测（工具限制） | 补门槛说明：拿不到全文时降级为摘要并标"未见原文" | **C** |
| general-typeset | 来源与许可段 | 分隔符缺失：删除 anthropics 归因后，两段之间少了"·" | 正文第 29 行原样 | 补"·" | **C** |
| general-slides | — | **无偏差** | office-ppt 的 autofit（含 --min-size 到限告警→建议拆页）在 SKILL.md:22/62 与 ppt_tool.py:290/423 落实；旧格式与导出走 WPS COM、较 pptx 慢，与技能文档一致 | — | — |
| general-designer | — | **无偏差** | 无工具调用（纯方法论）；"不小于五号(10.5pt)"正确；gongwen-format-skill 是**改写来源归因**（仓库确在研究目录），非工具调用 | 低优先：来源归因引了排版类来源，与 typeset 略有重叠 | — |

**已实测与正文一致（不必再查）**：
- **pdf-tools OCR 退役属实**：SKILL.md:3/8/10/11 与 pdf_tool.py:11/17/23/338/347 均写"2026-09-12 退役、转 PNG 交基座原生识图"，与 general-office 方法 7 一致；
- office-excel 的 recalc / pivot 落实（SKILL.md:19/24/25/61/62、excel_tool.py:258/312/513）；pivot 源区必须含表头非空、空区 exit 4，与 general-office 方法 6 一致；
- **WPS COM 口径属实**：doctor.py 实测 KWPS.Application 可实例化；ProgID 仅注册在 HKCU；wps_com.py:25-27 映射 word→KWPS / excel→KET / ppt→KWPP；
- **GB/T 9704—2012 逐条与权威解读一致**：编号名称、A4 幅面、天头 37mm±1、订口 28mm±1、版心 156mm×225mm、每面 22 行每行 28 字、标题二号小标宋、层次序数字体（一、黑体 /（一）楷体 / 1. 与（1）仿宋）、页码 4 号半角宋体·一字线距版心 7mm·单双页空字·空白页与版记页不编·附件连续。

**结论**：5 位中 3 位有偏差、2 位无偏差；**无一条属"承诺跨平台 / 承诺无 WPS 也能导出 / 给法律结论"这类硬越界**。最需先改的是 **general-typeset 的 gongwen 工具链不可达**（真会让人照做而失败）。

---

## infosec 域（核对者 52e9a392）

| 专家 | 位置 | 偏差 | 证据 | 建议 | 级别 |
|---|---|---|---|---|---|
| infosec-ics-security | 方法 5（第 11 行） | 把 **OPC UA** 与 Modbus/TCP、DNP3、S7comm 并列，称"多数工业协议**原生缺少认证与加密**"——**不成立**：OPC UA 原生带安全模型（SecurityPolicy：None / Sign / SignAndEncrypt） | 外部 ACM 论文原文；本机知识库 `石化_油气管网网络安全防护解决方案.txt:60` 讲的是 **OPC（Classic）** 无安全设计，非 OPC UA | 改为"…IEC 60870-5-104、**OPC Classic** 等原生缺少认证与加密"；OPC UA 另起一句"原生支持签名/加密，但现场常被配成 None，因此同样不能假定其安全" | **B** |
| infosec-djbh | 方法 5（第 11 行） | "各安全域**按权重计分并设及格线**…才判基本符合"——与官方判定规则不符，实际按**符合率** | 本机知识库 `政策法规/等级保护/_OCR文本/1846号函.txt:20` 官方答复原文："符合率高于 60%、低于 90% 判定为**基本符合**……低于 60% 判定为**不符合**" | 删"按权重计分设及格线"，改"按**符合率**与风险判定（60%–90% 基本符合；<60% 不符合），一票否决项另计" | **B** |
| infosec-djbh | 方法 2（第 8 行） | "三级**增设**安全管理中心等要求"——暗示二级无此要求 | 本机知识库 `_work/03_批注提取.txt:407`：等保 2.0 是"**一个中心、三重防护**"**通用**结构（非三级专属） | **待核**：对照 GB/T 22239-2019 第 8/9 章；若二级已含，改"三级对安全管理中心要求更严" | 待核 |
| infosec-sales-engineer | 方法 3/4/5 | 与 infosec-ics-security 在"摸底 / POC / 选型"三处交叠 | — | 视角不同（销售管客户约束与组织、售前管技术方案）；建议双方角色段各加一句"谁主导、谁的产出为准" | **C** |
| infosec-bid-proposal | 方法 6 | 与 sales-engineer 方法 7 同为竞争定位方法 | — | 场景不同（书面标书 vs 现场对话）；建议各自注明使用场景 | **C** |

**A 维度**：grep 实测 4 位**不引用任何**技能名/脚本/命令/API/路径/WPS COM → 无工具不可达问题。
**B 维度（标准编号逐项正确）**：GB/T 22239-2019 · GB/T 28448-2019 · GB/T 25070-2019 · GB/T 25058-2019 · 公通字〔2007〕43号 · IEC 62443-3-3 FR1–FR7 · IEC 62443-4-2 · NIST SP 800-82**r3**（2023-09）· 结论口径"符合/基本符合/不符合"；《招标投标法》《政府采购法》表述无问题；未写死易变数字。
**贯穿性**："绝不在运行中的生产网做主动扫描、探测、写入"在角色段、方法 5、自检① **三处一致**，无一处放松。

**两处未能完成核实（如实说明）**：
1. ~~**NIST SP 800-82 是否已有 r4** —— 未能确认~~ → ✅ **已核实（2026-09-14 主会话补查）**：`SP 800-82 Rev.4` 目前仍是 **Pre-Draft Call for Comments（草案阶段）**，**r3（2023-09）为现行最终版**，正文标注 **r3 正确**。来源：NIST CSRC `pubs/sp/800/82/r4/iprd`；NIST 2023-09 发布公告（SecurityWeek 报道）。
2. **GB/T 22239-2019 / 28448-2019 标准原文不在本机**（知识库无全文）——条款级判断基于官方答复函与间接材料，**未逐条对照原文**。

---

# 偏差总表（5 域 19 位 · 2026-09-14）

**A 类 · 工具不可达（必改，1 条）**
| 专家 | 偏差 |
|---|---|
| `general-typeset` | 把 **gongwen-skill 当成本工作区执行工具链**，但本机**未安装**（仅在研究目录）→ 照做会调用失败 |

**B 类 · 知识 / 法条错误（尽快改，7 条）**
| 专家 | 偏差 |
|---|---|
| `hr-labor-law` | 试用期**工资**被说成有法定上限（应为：第 19 条=期限上限、第 20 条=**工资下限**） |
| `infosec-ics-security` | **OPC UA** 被列入"原生缺少认证与加密"（OPC UA 原生带 Sign/SignAndEncrypt） |
| `infosec-djbh` | 判定规则写成"按权重计分设及格线"（官方按**符合率**：60–90% 基本符合、<60% 不符合） |
| `accounting-accountant` | "企业准则版约 **167** 个"科目（权威：原指南 **156**、2024 汇编 **171**） |
| `finance-research` | 港股被写成"按中国企业会计准则读报表"，且与同段自相矛盾 |
| `general-typeset` | "行距固定值 29" 被写成 GB/T 9704 条文（标准无行距条，29pt 是 22 行的实现值） |
| `general-office` | 称旧格式**公式重算**走 WPS COM（技能文档明写 **recalc 对 .xls 未实测**） |

**待核（2 条）**
| 专家 | 待核点 |
|---|---|
| `accounting-accountant` | "小企业准则版约 66 个"科目 —— 查无实据（可提取 72–75 个，无一致口径） |
| `infosec-djbh` | "三级**增设**安全管理中心" —— 等保 2.0"一个中心、三重防护"疑为通用结构 |

**C 类 · 边界 / 来源 / 表述（9 条）**
| 专家 | 偏差 |
|---|---|
| `general-fact-check` | 中文权威源清单未说明访问门槛（知网/万方需订阅、裁判文书网 2021 起限缩） |
| `finance-quant` | "A 股与国内期货…按 T+1"并列（期货实为 T+0） |
| `finance-research` | 数据来源未点名权威源（巨潮 / 披露易 / 统计局） |
| `hr-labor-law` | 来源缺《住房公积金管理条例》 |
| `accounting-accountant` | 与 accounting-tax 都提递延所得税（角度不同，可保留） |
| `coding-dsh-plugin` | patch 的 config 称"中性"，实际含本岗默认 `defaultDomain` |
| `general-typeset` | 来源段分隔符缺失（少一个"·"） |
| `infosec-sales-engineer` | 与 ics-security 摸底/POC/选型交叠，未注明谁主导 |
| `infosec-bid-proposal` | 与 sales-engineer 竞争定位方法重叠，未注明使用场景 |

**无偏差（9 位）**：`coding-engineer` `coding-review` `coding-dsh-plugin`(除 1 条 C) `accounting-tax` `accounting-analyst` `accounting-compliance` `finance-quant`(实质) `general-slides` `general-designer`

**整体可信度结论**：**无一条"硬越界"**（没有承诺跨平台、没有承诺无 WPS 也能导出、没有给法律结论）；错误集中在**精确数字与条款归属**；**全库未写死税率/基数/优惠** ✓；**API 无编造** ✓。

---

# 修正状态（2026-09-14 全部落地）

**A 类（1/1）**
- ✅ `general-typeset` 角色段：gongwen-skill → **dsh-doc-suite**（不可达问题消除）

**B 类（7/7）**
- ✅ `hr-labor-law`：试用期"长度上限（第 19 条）+ **工资下限（第 20 条）**，低于即违法"
- ✅ `infosec-ics-security`：**OPC UA 移出"原生缺加密"**（改 OPC Classic）+ 补"OPC UA 原生支持 Sign/SignAndEncrypt，现场常配 None，不能假定其安全"
- ✅ `infosec-djbh`：判定规则改**符合率**（>60% 且 <90% 基本符合、<60% 不符合）
- ✅ `accounting-accountant`：科目数改 **156 项 / 2024 汇编 171 个**
- ✅ `finance-research`：港股改"**先确认发行人编制基础**（HKFRS/IFRS、H 股常见 CAS+调节表）"
- ✅ `general-typeset`：行距 29 磅标为**实现参数而非标准条文**（方法 2 + 交付明细两处）
- ✅ `general-office`：拆开——旧格式**读取/导出**走 WPS COM；**xls 公式重算未实测**

**待核（2/2，按"不确定就写不确定"处理）**
- ✅ `accounting-accountant`："66 个"**删数字** → "以《小企业会计准则》附录科目表为准"
- ✅ `infosec-djbh`："三级增设安全管理中心" → "三级要求更严（**具体差异以 GB/T 22239-2019 相应章节原文为准**）"

**C 类（9/9）**
- ✅ `general-fact-check`：权威源分"通常可直取 / 有门槛"，补"拿不到全文标'未见原文'"
- ✅ `finance-quant`：明确 **A 股 T+1 / 国内期货 T+0**
- ✅ `finance-research`：补实名源（巨潮资讯网 / 港交所披露易 / 国家统计局）
- ✅ `hr-labor-law`：来源补《住房公积金管理条例》
- ✅ `accounting-accountant`：补递延所得税交叉指引（"见税务师"）
- ✅ `coding-dsh-plugin`："中性" → "不含个人路径与称呼；部署层可含本岗默认域"
- ✅ `general-typeset`：来源段补回分隔符 "·"
- ✅ `infosec-sales-engineer`：补职责边界（选型口径以 ics-security 为准）
- ✅ `infosec-bid-proposal`：三区定位注明"用于标书文本"

**复验（2026-09-14）**：`card-preview --all` = **FAIL 0 · WARN 0 · OK 19 · INFO 3**；回归 **regression 32/0 · injection-tier 16/0 · smoke-load 18/0 · coexist 7/0**；src ↔ profile 哈希一致。

**遗留（不属缺陷，供后续决定）— 已于 2026-09-14 补完**
- ✅ `infosec` 两条 C 类「边界重叠」改为**双侧对称加注**：`infosec-ics-security` 角色段补「客户约束、决策链与商务推进由 `infosec-sales-engineer` 负责——技术选型口径由我出，商务承诺不由我下」；`infosec-sales-engineer` 方法 7 补场景限定「（现场口头交流；书面标书文本的竞争定位交投标侧）」，与 `infosec-bid-proposal` 方法 6 的「用于标书文本」对称。
- ✅ 会计 4 位 + 金融 2 位在 `## 交付明细` 末（**不进 L1 卡**、零卡面风险）补 `**工具路径**`：`dsh-doc-suite` 的 `office-excel` 取数 / 重算 / 透视 + `office-word` 成文，统一 **WPS** 口径，旧格式 `.xls/.et` 走 WPS COM 较慢，并写明「公式先重算再读数」（避免读到旧缓存或空值）。
- 补后复验（2026-09-14）：`card-preview --all` = **FAIL 0 · WARN 0 · OK 19 · INFO 3**；`regression 32/0 · injection-tier 16/0 · smoke-load 18/0 · coexist 7/0`；src ↔ profile 哈希一致（仅 `docs/` 不入发布件）。

