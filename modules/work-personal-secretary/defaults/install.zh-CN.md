# 工作秘书 · 安装引导

本页由插件自带（不是外链）。按顺序做完，回到「设置 → 工作秘书 → 安装与检查」点一次「重新检测」。

> 先看结论：**Python 与 Python 依赖**是文档能力的硬前置，**WPS Office** 是比对、重算、透视与格式转换的执行环境；**Obsidian** 与**桌面形象**可选。子插件可只装需要的。

## 一、Python（3.10 以上，建议 3.12）

Windows 统一用 `py -3` 调用，不要用 `python`，它可能是应用商店的占位程序。

```
winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent
```

安装后新开一个窗口验证：

```
py -3 --version
```

若从官网下载安装，安装向导第一步要勾选「Add Python to PATH」。

## 二、Python 依赖（8 个包）

```
py -3 -m pip install python-docx openpyxl python-pptx PyMuPDF pdfplumber pypdf Pillow pywin32
```

| 包 | 用途 |
|---|---|
| `python-docx` / `openpyxl` / `python-pptx` | Word / Excel / PPT 读写与样式 |
| `PyMuPDF` / `pdfplumber` / `pypdf` | PDF 文本、表格与页操作 |
| `Pillow` | 图片处理（插图与导出） |
| `pywin32` | 调用 WPS COM（比对、重算、导出） |

网络不稳定时可在命令后加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`。

## 三、WPS Office

```
winget install -e --id Kingsoft.WPSOffice.CN --accept-source-agreements --accept-package-agreements --silent
```

装完无需额外配置。文档能力通过 COM 调用本机 WPS，实测 ProgID 为 `KWPS.Application`。

> 文档能力依赖 WPS 的商用许可，本集成体不做任何代理或破解动作。

## 四、Obsidian（可选）

只用于知识库与记忆镜像，不装不影响其他能力。

## 五、五个子插件

```
dsh plugin --profile desktop add <集成体目录>/modules/dsh-work-memory
dsh plugin --profile desktop add <集成体目录>/modules/dsh-doc-suite
dsh plugin --profile desktop add <集成体目录>/modules/dsh-experts
dsh plugin --profile desktop add <集成体目录>/modules/dsh-mermaid
dsh plugin --profile desktop add <集成体目录>/modules/workspace-tokenpet
```

或在「安装与检查」页逐个安装。**装完需要重启 DSH**。

## 六、升级与排障（容易踩的三条）

1. **子插件升级**：在「安装与检查」页点升级即可。插件内部会把新版本先落到临时目录、**逐文件校验 SHA256**、再原子替换，并同步更新 profile 的依赖登记；中途失败不会留下半成品。
2. **记忆库换目录想免重启**：需要 `dsh-work-memory` **≥ 1.0.6**；更低版本改目录后要重启 DSH 才生效。
3. **自测脚本**（在集成体根目录跑，均不依赖宿主运行时）：

```
node modules/work-personal-secretary/scripts/smoke-load.mjs      # 装载冒烟
node modules/work-personal-secretary/scripts/probe-test.mjs       # 探针
node modules/work-personal-secretary/scripts/install-test.mjs     # 安装器
node modules/work-personal-secretary/scripts/basedeck-test.mjs    # 配置底座
node modules/work-personal-secretary/scripts/settings-api-test.mjs
node modules/work-personal-secretary/scripts/identity-test.mjs
node modules/work-personal-secretary/scripts/defaults-test.mjs    # 本页与 md 同源
```

`node --check <文件>.js` 只查语法，不查未定义标识符。

## 七、自检

回到「安装与检查」点「重新检测」。六项依赖全绿、五个子插件全部「已装」即完成。

---

本页随插件分发，不含任何个人信息与外部跳转。
