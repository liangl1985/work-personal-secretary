## 0.1.3 — 2026-09-12（移除 fontTools 可选依赖）

- **移除 `fontTools`**：它唯一的用途是 python-pptx 的 `fit_text()`，而该方法按空白断词、**对中文不可用**（见 0.1.2）；`autofit` 已改用 Pillow。
  查实依据：模块内**无任何代码 `import`**；**无任何依赖声明它**（`pip show fontTools` → `Required-by:` 为空；`pypdf` 仅在 extras `[fonts]`/`[full]` 下需要，未启用）。
- **整文件删除 `requirements-optional.txt`**（已无可选补强项），并清理全部引用：`package.json` 的 `files` 白名单、`doctor.py`（检查项 + 「Python ≥3.10 依据」表述）、`NOTICE`（许可条目）、`README`（安装步骤 + 依赖许可列表）、`requirements.txt` 与 `cordis.patch.yml` 的注释。
- **Python 门槛不变**：`>=3.10` 的依据改由必需依赖 **PyMuPDF 1.28+** 与 **Pillow 12+** 支撑（两者 `requires-python` 均为 `>=3.10`）。
- 本次只删**声明与检测项**，不会卸载本机已装的 fontTools（留着无害）。doctor 自检结论仍为「环境就绪」。
## 0.1.2 — 2026-09-12（PPT 自动缩字号 `autofit`）

- **新增 `ppt_tool.py autofit`**：文本框自动缩字号（文字溢出时逐磅下探到放得下）。
  - **刻意不用 python-pptx 的 `fit_text()`**：2026-09-12 实测它内部按空白断词（`pptx/text/layout.py` 的 `_LineSource` 用 `str.split()`），
    中文长句没有空格 → 整句被当成一个"词" → 永远超宽 → 二分查找返回 `None` → 抛 `TypeError: cannot unpack non-iterable NoneType`，**对中文不可用**。
  - 改为 **Pillow 自研测量 + 按字符断行**（中英文都算得准）；`--font-file` 可直接指定字体文件（最可靠），
    省略时按 `--font` / 文本框已有字体名映射到系统字体（微软雅黑 msyh.ttc / 黑体 simhei.ttf / 宋体 simsun.ttc / 等线 Deng.ttf 等）。
  - 参数：`--out`（另存，原文件不动）/ `--slide 1,3-5` / `--max-size 40` / `--min-size 8`（**下限保护**：到下限仍放不下则按下限写入并**告警**，提示拆页或精简文字）/ `--dry-run`；默认**就地修改并先备份**（`.bak-autofit-<时间戳>`）。
  - 退出码：缺 Pillow / 找不到可用字体 → **5**；`--font-file` 不存在 → **2**（中文单行错误，无堆栈）。
  - 实测：32 pt → 13 pt（5 行）；极端溢出框触发下限保护告警；就地修改生成备份、原文件可回溯。
- `fontTools` 由"解锁自动缩字号"降级为**保留项**（当前无子命令使用）；`requirements-optional.txt`、`doctor.py`、README 局限表、`skills/office-ppt/SKILL.md` 同步更正。
# Changelog · dsh-doc-suite

本模块遵循语义化版本。变更分三类：**新增** / **修复** / **变更（可能影响下游）**。

## 0.1.1 — 2026-09-12（当日夜间；安装后完整测试的修复轮）

### 修复（错误处理层，源自安装后完整测试的缺陷清单）

- **输入异常不再抛裸 Traceback**：新增 `scripts/cli_guard.py`（统一输入守卫 + 异常友好化），
  四个工具脚本全部接入。输入文件不存在/是目录 → 中文单行错误 + **exit 2**；
  WPS COM 错误（如 `com_error … '文档打开失败。' 3010`）→ 转成中文说明 + 可能原因提示。
  设 `DOC_SUITE_DEBUG=1` 可恢复完整堆栈（排障用）。
  修复前实测：14 个读取类子命令中 **12 个**抛裸 Traceback。
- **`excel read --sheet <不存在的表>`**：改为友好报错，并**列出该工作簿可用工作表名**（原来抛 `KeyError`）。
- **`pdf tables` 找不到表格**：由 `exit 1`（与真实失败同码）改为 **exit 0**，提示改走 stderr
  ——"没找到表"不是错误。
- **`pdf info` 增加 PDF 文件头校验**：非 PDF 文件（如误传 `.txt`）会告警"未检测到 %PDF 文件头"，
  不再静默给出误导性的"页数/元数据"。

### 变更（可能影响下游）

- **`excel chart` 的 `--sheet` 由必填改为可选**（缺省用第一张工作表），与 `summary`/`read` 行为一致。
  原来单表文件也必须显式传 `--sheet`，实测踩坑。
- **`pdf ocr` 改为退役墓碑**：OCR 通道已于 2026-09-12 退役。子命令保留（避免旧脚本静默跑偏），
  但只打印退役说明并 **exit 0**，不再本地 OCR、不再调用任何云端视觉 API。
  同时删除指向模块内**并不存在**的 `scripts/vision/describe_image.py`、`scripts/vision/ocr_tool.py`
  的死代码，以及 `lina_config`/`subprocess`/`tempfile` 等相关残留依赖。
- **`doctor.py --emit-skill-paths`（新增）**：输出 JSON（`moduleDir` / `scriptsDir` / `skillsDir` /
  `tools` / `skills`），供技能文档解析路径占位符。

### 文档

- 四个技能 `skills/*/SKILL.md`：
  - 新增**子命令速查表**（逐子命令用法 + 参数形态备注）；
  - 脚本路径由**作者机器绝对路径**改为占位符 **`<DOC_SUITE_SCRIPTS>`**，并写明解析方式；
  - `pdf-tools` 技能内残留的"扫描件走云端 OCR"指引全部改写为"转图片交基座原生识图"。
- README：新增「子命令速查」指引与高频坑提示；`files` 白名单补 `LICENSE`、`CHANGELOG.md`；
  已知局限表更新（技能路径问题标记为已解决，新增"脚本两份副本须同步"与非原生格式行为差异两条）。
- 集成体 README / RELEASE-CHECKLIST：同步本模块**硬前置**（Python ≥ 3.10 + WPS Office，不自动安装）
  与新增的文档模块发布门禁（Python 语法自检、技能不得含作者机器路径、必须含子命令速查表）。

### 验证

- `verify_fixes.py` 37/37 通过（含 15 项输入缺失友好化、表名提示、`--sheet` 可选、OCR 墓碑、
  无表 exit 0、非 PDF 提示、`DOC_SUITE_DEBUG`、以及 happy-path 回归与 `doctor` 回归）。
- 同步后三份副本（模块源码 / 工作区 `<workspace>/scripts` / 安装副本 `node_modules`）**SHA256 逐一一致**。

## 0.1.0 — 2026-09-12

- 首个版本：Word 处理+比对 / Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取。
- 宿主半只注册 `/doc-doctor`；能力实现在 Python 脚本 + DSH 原生技能。
- 安装后完整测试 14/14 通过（含 Word 字符级红线修订、KET 重算与真透视表、PPT→PDF→PNG、PDF 告警体系）。
