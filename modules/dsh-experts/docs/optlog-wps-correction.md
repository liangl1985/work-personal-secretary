# WPS 平台口径修正 · 记录（2026-09-14）

> 依据：E:/lina/临时任务文件夹/experts-research/00-WPS平台资料.md（本机实测 + 外部参考）
> 范围：general 域全部文档 / 呈现类专家
> 触发：主人明确"本机 Word / Excel / PPT 处理走 **WPS**，不是 Microsoft Office"

## 一、本机实测事实（已写进 persona）

| 项 | 值 |
|---|---|
| 版本 | WPS Office **12.1.0.28043**（用户目录安装） |
| 主程序 | wps.exe（文字）/ et.exe（表格）/ wpp.exe（演示）/ wpspdf.exe（PDF） |
| COM ProgID | **KWPS.Application（文字）/ KET.Application（表格）/ KWPP.Application（演示）** |
| 注册位置 | **仅 HKCU**（HKLM 含 WOW6432Node 查不到）；WPS.Application / ET.Application / WPP.Application **未注册，不要用** |
| 自动化 | Documents.Add / Workbooks.Add / Presentations.Add；SaveAs2 / ExportAsFixedFormat（有完整 COM，无需 LibreOffice 式中间格式） |
| **必踩坑** | **WPS 的 COM 进程不会自动退出** → 必须显式 Quit + 释放对象，否则残留进程、文件被占用、下次打不开 |
| 能力分层 | .docx / .xlsx / .pptx 走 python 库（快）；.doc / .xls / .et / .wps 旧格式与导出 PDF、逐页出图走 WPS COM（慢） |
| 平台 | Windows-only，且须已装 WPS；部分 VBA/COM 行为与 MS Office 不同，不照搬 Office 文档假设 |

## 二、落实位置

| 专家 | 落实内容 |
|---|---|
| **general-office** | WPS 三件套口径；WPS COM 与旧格式的时间代价；自检加"涉及 WPS COM 的操作已确认进程退出与文件句柄释放" |
| **general-typeset** | 结构落到 **WPS 文字** 的标题样式与大纲级别；边界核对在**目标 WPS** 下进行；交付明细含 WPS COM 的 Quit 与句柄释放 |
| **general-slides** | 生成 / 导出 / 逐页出图走 office-ppt（**WPS 演示**）；.ppt / .dps 与导出走 WPS COM，比 .pptx 慢要提前说 |
| general-designer | 经查为纯视觉判断，不涉及工具指代 → 无需改 |
| general-fact-check | 同上 → 无需改 |

## 三、同期发现的合规点

**anthropics/skills 的许可是 Proprietary（专有）**，不是 MIT/Apache。处理方式：
- **仅吸收方法要点**（多路径处理、零公式错误门槛、公式与值分读、版式与导出、修订与批注、样式与大纲级别），**不复制其文本**；
- 来源标注**写明 license**（已补进 general-office / general-typeset / general-slides，designer 亦可后续统一）。

## 四、验证

`node scripts/card-preview.mjs --all` → **FAIL 0 · WARN 14 · OK 5**

| 专家 | 正文 | L1 卡 |
|---|---|---|
| general-fact-check | 2456 | 507 |
| general-typeset | 2595 | 527 |
| general-office | 2872 | 502 |
| general-slides | 2130 | 545 |
| general-designer | 2363 | 555 |

general 域 **5/5 全部 OK**；WARN 14 属其他域（infosec / accounting / coding / finance / hr），不在本次范围。

_本文件由 general 域强优化执行者落盘；方法条首句判据已按主人要求放宽至 90（代码常量 CARD_METHOD_MAX_CHARS 与 card-preview 判据一致）。_
