# general-typeset 强优化记录（2026-09-14）

> 原则：**保留底本骨架**，用新来源补要点、纠过时口径、把方法写得更可执行；不推翻重写。

## 来源（6 类文件 / 跨 5 库）
| # | 文件 | 许可 | 取用 |
|---|---|---|---|
| 1 | 本库归档底本 doc-report-typeset.md | 自撰 | 骨架：文种先行、版式模式、交付形态、一致性、边界声明 |
| 2 | linhut/gongwen-skill 的 SKILL.md + README.md | MIT | 29 项命令与路径分流、**check 的 P0/P1/P2 分级**、硬门控（执行前声明、写操作 --apply、只读优先）、聚合禁令（差异对比版是唯一交付物、多轮须穿插、不编造 reference、不静默失败）、OOXML 不支持旧 .doc |
| 3 | wzbwan/gongwen-format-skill 的 references/公文格式要求.md + 受控 Markdown 规范 v1.0 | MIT | **层次序数字体规则**（一、黑体 /（一）楷体_GB2312 / 1.、（1）仿宋_GB2312）、**页码规格**（4 号半角宋体、一字线距版心 7mm、单双页、空白页与版记页不编、附件连续）、**行距固定值 29**、主送机关与附件说明规格、**Markdown→公文受控协议**（编号由人显式写、每行=一段、只认行首 #、Front Matter 字段） |
| 4 | anthropics/skills 的 docx/SKILL.md + doc-coauthoring/SKILL.md | **Proprietary**（仅取要点） | 样式与大纲级别决定目录能否自动生成、版式保留、写完必须渲染成图逐页目视、协同起草三阶段 |
| 5 | agency-agents-zh 的 support-executive-summary-generator.md + design-brand-guardian.md | MIT | 结论先行的表达、视觉一致性 |
| 6 | 本机 00-WPS平台资料.md | 本机实测 | WPS 12.1.0.28043、**ProgID 只在 HKCU**（KWPS/KET/KWPP）、COM 全自动化无需 LibreOffice 路线、**COM 进程不会自动退出必须显式 Quit**、Windows-only、旧格式与导出更慢 |

## 轮次要点
- **R1 补要点**：新增方法 3（层次序数与字体成套）、方法 5（Markdown 受控协议）、方法 6（原生修订 + 差异对比版）；核验清单从 3 项扩到 9 类（版心/字体/行距/主送机关/附件说明/页码/一致性/不可自证项）。
- **R2 纠过时口径**：底本只写"三号仿宋、四级层次"，未写**字体成套规则**与**页码规格**；补齐。旧 .doc 明确标注**工具链不支持 OOXML 之外的旧格式**，须先转换。
- **R3 工具口径**：按 WPS 平台实测写死「python 库快 / WPS COM 慢且仅 Windows」的能力分层，并把 **ProgID 只在 HKCU、错用无 K 前缀 ProgID 会失败**写进方法。
- **R4 WPS 平台修正（新增）**：补方法 8「用 WPS COM 就必须管进程」——**COM 进程不会自动退出，必须显式 Quit + 释放对象**（最易踩的坑，已同时进"交付明细·工具与失败处理"作为自检项）；写明部分 VBA/COM 方法与 MS Office 行为不同、不照搬 Office 文档假设。
- **R5 卡契约收敛**：方法 1-3 首句压到 20 字内（"先定文种与场合""版式以现行国标为尺""层次序数与字体成套使用"）；**交付与自检压成两条各 ≤90 字**，细节全部下沉到独立的 ## 交付明细 段，用以消除 WARN。
- **R6 许可如实**：anthropics/skills 为 **Proprietary**，来源标注里明确"仅取操作要点、不复制内容"，不假称开源。

## 产出
- 正文：experts/general/general-typeset.md（本次覆盖）
- **最终实测：正文 2595 字符 · 卡 527 字符 · card-preview FAIL 0 · WARN 0 · OK 1**
- R7 收敛：初稿 3024 字符超出上限，压到 2595 —— 交付明细由 9 类并为 4 组、来源标注改为紧凑列名，要点未删。
- 提醒：本轮只改了源码仓库的 experts/general/general-typeset.md（未动 index.json / lib / profile），profile 侧需主会话统一同步。
- 卡：由 buildPersonaCard 确定性生成；卡契约由 scripts/card-preview.mjs 校验（FAIL 判据：方法 1-3 首句 >90）
