# dsh-doc-suite —— 文档能力模块（Word / Excel / PPT / PDF）

> `work-personal-secretary` 集成体的文档能力子模块。**能力的实现是 Python 脚本 + DSH 原生技能**；宿主半只提供"环境自检入口"，不在 Node 侧重复造轮子。

## 一、它提供什么（四格式，按使用方定义）

| 格式 | 范围 | 关键能力 |
|---|---|---|
| **Word** | 处理 + **比对** | 读取（全文/表格/样式，含"带修订文档拒绝裸读"保护）、生成、编辑、转 PDF；**比对**：文本 diff + HTML 对照 + **可用 Word/WPS 打开的"红线修订版"**（字符级） |
| **Excel** | 处理 | 读写、公式写入、**重算读值**（KET `CalculateFull`）、**数据透视**、条件格式、图表、合并、批量 |
| **PPT** | **制作 + 排版** | 生成、模板/母版/版式套用、占位符填充、EMU 级坐标与字号、图表/表格/图片、演讲者备注、批量生成；**排版上限取决于模板预制程度** |
| **PDF** | **只读精确提取** | 文字、表格（**带 bbox**）、图片、书签/元数据；**旋转页/合并单元格/扫描件主动告警**（不做 PDF 制作、不做本地 OCR） |

## 二、硬前置（安装前必须满足）

| 前置 | 要求 | 为什么 |
|---|---|---|
| **Python** | **>= 3.10**（建议 3.12） | 由 `PyMuPDF 1.28+` 与 `fontTools 4.65+` 的 `requires_python: >=3.10` 决定（其余依赖只要求 >=3.8/3.9） |
| **WPS Office** | 已安装且 COM 可实例化 | **比对 / 公式重算 / 透视 / 页码目录**全部依赖 WPS COM；`doctor.py` 会自动探测可用 ProgID（本机实测为 `KWPS.Application`） |
| Windows 调用约定 | 一律 `py -3`，**不要用 `python`** | `python` 可能是 Microsoft Store 别名 stub（报 "Python was not found"，exit 9009） |

> **本模块不会自动安装 Python 解释器或 WPS Office**：装解释器属系统级操作（需管理员、可能受企业网络策略限制），WPS 是商业软件。二者都由 `doctor.py` 检测并在缺失时**给出可复制的修复命令**，由使用者确认后执行。

## 三、安装与自检

```powershell
# 1) 装依赖（必需）
py -3 -m pip install -r requirements.txt

# 2) 可选补强（解锁 PPT 自动缩字号）
py -3 -m pip install -r requirements-optional.txt

# 3) 自检（唯一入口；缺什么它告诉你补什么）
py -3 doctor.py            # 人类可读报告
py -3 doctor.py --json     # 供插件 /doc-doctor 解析
py -3 doctor.py --fix      # 显式确认后才执行 pip 安装（不装解释器）
```

内网/离线环境：用 `py -3 -m pip download -r requirements.txt --platform win_amd64 --python-version 312 -d vendor/wheels` 预先取包，再用 `--no-index --find-links vendor/wheels` 安装（本机 `pip cache` 为空，不能依赖缓存）。

## 四、插件侧

```powershell
# 装进 profile（与集成体其他子模块一致）
dsh plugin --profile desktop add <本模块路径或包名>
```

- 宿主半只注册一个命令：**`/doc-doctor`** —— 执行环境自检并回报结论与修复命令。
- 配置项（中性默认层，可在设置页用户层覆盖）：`pythonLauncher`（默认 `py -3`）、`docsRoot`、`wpsRequired`、`doctorOnStartup`。

## 五、已知局限（重要，别踩）

| # | 局限 | 说明 |
|---|---|---|
| 1 | **页眉差异不参与红线修订** | WPS `CompareDocuments` 的 `Revisions` 只覆盖正文/表格，且 `RejectAll` 回退不了页眉。工具已就页眉差异主动告警；正式断言口径 = **正文 + 表格** |
| 2 | **修订作者名** | `app.UserName` 改不动 `CompareDocuments` 的作者（且赋值会污染 WPS 全局配置）→ 已改为**在产物 OOXML 层改写** `w:ins/w:del` 的 `w:author`，默认取系统用户名，`--author` 可覆盖 |
| 3 | **WPS COM 不认相对路径** | `SaveAs` 传相对路径会报 3011；模块内已用 `resolve()` 处理，**其他脚本调用 WPS 时注意同一坑** |
| 4 | PDF 硬边界 | 合并单元格表格与旋转页表格**必然失真且不报错** → 已改为**主动告警**；图片提取到的是内嵌版（非原件）；加密 PDF 需口令且 `pypdf` 提中文乱码（PyMuPDF 正常） |
| 5 | PPT 无自动排版 | `fit_text()` 依赖 fontTools；无动画 API、页码无 API；**排版靠模板预制** |
| 6 | Excel | `recalc` 对 `.xls` 旧格式未实测；`pivot` 不做小计行识别（源区域含"合计"行会被当行项目） |
| 7 | **技能里的脚本路径** | 当前 `skills/*/SKILL.md` 中的命令指向工作区绝对路径（本机 `E:\lina\scripts\...`）。**对外分发前需改为模块内相对路径**（计划由 `doctor.py --emit-skill-paths` 生成） |

## 六、许可与归属

- 本模块代码：MIT（见 `LICENSE` 与 `NOTICE`）。
- 依赖库许可：python-docx(MIT) / openpyxl(MIT) / python-pptx(MIT) / PyMuPDF(**AGPL-3.0 或商业许可**，注意分发口径) / pdfplumber(MIT) / pypdf(BSD-3) / Pillow(**HPND**，MIT-CMU 系) / fontTools(MIT) / pywin32(PSF) —— **随包分发时需复核 PyMuPDF 的 AGPL 口径**（本模块只"依赖"而不"内置"其代码，通常按依赖声明处理，但对外发布前请确认）。
- **WPS Office 不随包**，需使用者自行安装并遵守其许可。
