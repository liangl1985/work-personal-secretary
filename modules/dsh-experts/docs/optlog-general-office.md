# general-office 优化日志（文档与表格处理）

## WPS 平台修正（2026-09-14，吸收 experts-research/00-WPS平台资料.md）

- **新增方法 10「WPS COM 用完必须显式退出」**：COM 进程不会自动退出，不 Quit + 释放对象会残留进程、文件被占用、下次打不开——本机最易踩的坑；
- **自检条新增 ④**「涉及 WPS COM 的操作已确认进程退出与文件句柄释放」；
- **新增「交付明细 · WPS COM 专项」**：本机 WPS Office 12.1.0.28043；ProgID 用 KWPS.Application / KET.Application / KWPP.Application，**只注册在 HKCU**（管理员会话可能拿不到），无 K 前缀的三个未注册不要用；有完整 COM 自动化（Documents.Add / Workbooks.Add / Presentations.Add、SaveAs2 / ExportAsFixedFormat），不需要 LibreOffice --headless 中间格式；宏模块可能需单独启用；不做跨平台承诺；
- **方法 9 补「能力分层」**：.docx / .xlsx / .pptx 走 python 库（快），旧格式与导出走 WPS COM（慢、仅 Windows、必须已装 WPS）；
- **方法 4 新增「多路径处理」**（来自 Anthropic 官方 docx 技能）：新建走生成、改现有走就地编辑、改稿留痕走文档比对、只读走提取；
- 来源新增：本机 WPS 平台实测资料。

> **WPS 口径核对（2026-09-14）**：本机办公套件是 **WPS**，不是 Microsoft Office。已核对正文：工具指代统一为 WPS（方法 5「旧格式 .xls/.et 与公式重算、透视、导出走 **WPS COM**，比 .xlsx 慢」），能力实现走 dsh-doc-suite 技能链，对使用者表述统一说 WPS；正文无 Office / Microsoft / PowerPoint 客户端等错误指代，未建议安装 Office。**核对通过，无需改文。**

## 来源（4 个，跨 3 类素材）
| 代号 | 素材 | 许可 | 取用 |
|---|---|---|---|
| A | 归档底本 retired-20260914/doc/doc-office.md | 本库自撰 | 主骨架：认格式先行、取真值、结构优先、可回溯、命名规范、交付自检八条 |
| B | 本机 dsh-doc-suite 技能 office-word / office-excel / office-ppt / pdf-tools 的 SKILL.md | 本机模块 | **能力边界与实测坑**（只写"走哪个技能"，不搬命令表） |
| C | 归档底本 doc/doc-ppt.md（可选融入） | 本库改写 | 演示场景"说清楚比好看重要"的取舍意识 |
| D | agency-agents-zh/engineering/engineering-technical-writer.md | MIT | 读者视角与准确性纪律（烂文档就是产品 bug） |

- **R1 起草**：以 A 为骨架，保留其七条方法与中国办公语境（对内稿/对外件、约定目录）。
- **R2 专业口径（本轮实质增量）**：
  - 从 B 补入**两条实测坑**：① Excel **公式未重算的格读到旧缓存或空值**——先 recalc 再 read；透视/图表源区必须非空且含表头；旧格式（.xls/.et）与重算、透视、导出走 WPS COM，**比 .xlsx 慢**，时间预期要提前说。② **pdf-tools 的 OCR 通道已于 2026-09-12 退役**——扫描件改为"转 PNG 交基座原生识图"，且必须如实声明能读到什么程度。底本原写"不悄悄走云端 OCR"，本轮按现状更新为"OCR 通道已退役 + 转图识图"的明确路径。
  - 补齐四格式清单与"PDF 分文本型/扫描件型"的分叉。
  - 工具链按**技能名 + 能力**描述（office-word 提取/生成/替换/比对/转换；office-excel 读写/合并/重算/透视/图表；office-ppt 生成/提取/导出/逐页出图/自动缩字号；pdf-tools 文本与表格提取/合并拆分/页面转图），**不抄子命令表**——命令属于技能文档，persona 只负责"选对技能、给对参数、定标准、核结果"。
- **R3 结构契约**：方法 1-3 重写为 **≤47 字自成句**且不含超 3 项枚举（首版方法 1 把四类格式塞进首句，会在 60 字处截断；已把格式清单下沉到第二句）。文末来源标注改用 **## 来源与许可** 标题，避免被 listItems 并入交付行。
- **R4 语言与可执行**：动作化（"先重算，再读数""先跑样张再全量"）；技术名词保留英文（WPS COM、PDF、PNG、.xlsx）；全文中文引号。去 AI 味，删空话。
- **R5 精简去重**：与 **general-typeset（排版成文）** 划界——本专家管"文件本身的提取/生成/改写/重排/转换/核对"，排版规范与公文格式交排版专家；与 **dsh-doc-suite 技能**划界——persona 不重复命令表。正文约 1810 字符。

## 产出
- 正文：experts/general/general-office.md
- L1 卡：由 buildPersonaCard 确定性生成（实测见下）
- index.json 条目：**待父代理统一追加**（未改索引）

## 卡实测
见本次汇报。
