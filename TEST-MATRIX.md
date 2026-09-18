# 测试矩阵（2026-09-18 实测）

> 口径：每条给「模块 → 命令 → 覆盖 → 最新读数」。读数只对**当时的提交**负责；改动后须重跑同一条命令再更新本表。
> 所有脚本**刻意不依赖宿主运行时**（不需要 DSH 在跑），CI 与本机都能执行。

## 一、一键跑

| 模块 | 命令 |
|---|---|
| 集成体本体 | `cd modules/work-personal-secretary && npm test`（7 套） |
| 文档能力 | `cd modules/dsh-doc-suite && npm test`（5 套）· `npm run spec:check`（规格校验）· `py -3 scripts/tests/test_python.py`（Python 单测） |
| 记忆体 | `cd modules/dsh-work-memory && npm test` |
| 专家库 | `cd modules/dsh-experts && npm test`（5 套） |
| 桌面形象 | `cd modules/workspace-tokenpet && npm test`（**需先 `npm install`**；CI 不装依赖故不进 CI） |

## 二、逐套明细（读数一律为 2026-09-18 本机实测）

### 集成体本体 `modules/work-personal-secretary/scripts/`

| 脚本 | 覆盖 | 读数 |
|---|---|---|
| `smoke-load.mjs` | 装载冒烟：mock ctx 真跑 `apply()`（注册/注入/命令/设置） | **513 / 0** |
| `probe-test.mjs` | 环境探针（依赖项识别与降级） | **149 / 0** |
| `install-test.mjs` | 子插件安装引擎（安装/升级/卸载/残留判定） | **244 / 0** |
| `basedeck-test.mjs` | 配置底座：目录生成、根目录派生与反推、迁移、导入引导 | **415 / 0** |
| `settings-api-test.mjs` | 设置 API：契约形状、ns 白名单、写入校验与脱敏 | **112 / 0** |
| `identity-test.mjs` | 身份写入（按正文前缀定位、逐字节校验其余内容未变） | **73 / 0** |
| `defaults-test.mjs` | 随包说明：md ↔ HTML 逐段逐字 + 逐字节同源、敏感串过滤、`?embed=1` 片段形态 | **59 / 0** |

### 文档能力 `modules/dsh-doc-suite/scripts/`

| 脚本 | 覆盖 | 读数 |
|---|---|---|
| `style-test.mjs` | A 线样式回归（规格结构、apply-style 零改动断言、extends 继承/循环检测） | **24 / 0** |
| `media-test.mjs` | 媒体链路（生图密钥来源与不泄露、图示运行时、落盘格式） | **19 / 0** |
| `ppt-render-test.mjs` | PPT 渲染器（manifest 校验、16 类页型、容量与缩字号、随包主题齐备可加载、导出 PDF） | **26 / 0** |
| `ppt-style-test.mjs` | PPT 存量美化（字体统一、内容零改动 exit 3 语义、`--spec report`） | **12 / 0** |
| `ppt-theme-test.mjs` | 主题库（list / inspect / import、对比度门禁） | **7 / 0** |
| `tests/test_python.py`（新增） | **Python 侧单测**：对比度计算、主题压暗达标、`deep_merge` 语义、规格校验正/负例（越界与缺 styles → `SystemExit(2)`）、全部内置规格校验通过、`report` 与 WPS 三套的 accent 与 pptx 几何 | **13 / 0** |
| `spec_sync.py --check` | 规格校验 + 对比度门禁（10 套规格） | **exit 0** |

### 记忆体 / 专家库

| 模块 | 脚本 | 覆盖 | 读数 |
|---|---|---|---|
| `dsh-work-memory` | `regression.mjs` | 三级记忆、转冷预审、镜像同步 | **87 / 0** |
| `dsh-experts` | `regression.mjs` | 索引完整性、persona 体量、匹配打分、注入装配 | **48 / 0** |
| `dsh-experts` | `injection-tier-test.mjs` | 注入两态（首轮全景 / 干活轮）与预算上限 | **20 / 0** |
| `dsh-experts` | `capability-test.mjs` | 能力层（工具/技能指针、预算守门） | **8 / 0** |
| `dsh-experts` | `coexist.mjs` | 与 `dsh-work-memory` 同 ctx 注册不冲突 | **8 / 0** |
| `dsh-experts` | `smoke-load.mjs` | 装载冒烟 | **19 / 0** |

### 桌面形象 `modules/workspace-tokenpet`

| 脚本 | 覆盖 | 读数 |
|---|---|---|
| `tests/lina-skins.test.mjs` | 形象套装与 manifest 校验 | **本轮未实测**（需 `npm install` 拉 `tsx`/`typescript`；命令：`cd modules/workspace-tokenpet && npm install --ignore-scripts && npm test`） |

## 三、CI 覆盖（`.github/workflows/ci.yml`）

按顺序：语法自检（全量 JS `node --check`）→ 子项目回归（`*/scripts/regression.mjs`）→ 装载冒烟与共存（`*/scripts/smoke-load.mjs`、`coexist.mjs`）→ **集成体本体自测**（`*/scripts/*-test.mjs`）→ Python 语法自检（`py_compile`）→ **Python 单元测试（dsh-doc-suite）**→ 子项目必需文件自检。

- **刻意不进 CI**：`workspace-tokenpet` 的 `npm test`（要装依赖）· 涉及 WPS COM / 网络 / 本机运行时的用例（脚本内部已 SKIP）· `ppt-render-test.mjs` 的「render → 导出 PDF」（守卫 = win32 + win32com + 注册表 `KWPP.Application`；本机真跑、CI SKIP）。
- CI 环境只装 Node 与 Python，不装 pip 包；因此依赖 Pillow / python-pptx 的用例在 CI 上是 **SKIP 而非 FAIL**（2026-09-17 修）。

## 四、已知缺口（如实标注，不含糊）

| # | 缺口 | 处理 |
|---|---|---|
| 1 | 桌面形象测试未实测（需装依赖） | 本机跑一次后回填读数 |
| 2 | `dsh-doc-suite` 的 Python 测试目前覆盖**纯函数**（对比度/压暗/合并/校验）；`word_style.py` / `excel_style.py` 这类需要 python-docx / openpyxl 的路径仍靠 `.mjs` 端到端回归覆盖 | 后续按需补 |
| 3 | 本体 `client/index.js`（前端）无独立测试，只由 `smoke-load.mjs` 间接覆盖 | 后续按需补 |
