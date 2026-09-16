---
name: media-gen
description: 为演示文稿生成图形素材：ARK（火山引擎方舟）生图、mermaid 图示本地渲染，以及 mermaid 运行时的安装与迁移。当需要配图/概念插图/装饰图、流程图与架构图，或需要安装 mermaid 运行时时使用。
---

# 媒体素材生成（media-gen）

> 定位：**PPT（B 线）的图形元素供给端**。策略是「**图形元素优先尝试生图，失败自动回退代码矢量绘制**」；
> 图示走**本机渲染**，不出网。

| 需求 | 工具 | 是否出网 |
|---|---|---|
| 概念插图 / 装饰图形 / 封面章节背景 | `gen_image.py`（ARK 生图） | **是**（prompt 会发送到云端 —— 必须显式告知使用者） |
| 流程 / 架构 / 时序 / 状态图 | `gen_diagram.py`（mermaid） | 否（本机 Node + Edge 渲染） |
| 数据图表 / 表格 | **不用这两个** | 走 `ppt_render.py` 的 chart / table 页（原生对象） |

## 一、gen_image.py（ARK 生图）

### 命令

| 子命令 | 用法 |
|---|---|
| `image` | `image --prompt <文本> --out <路径> [--ref <参考图>] [--size 1K] [--model <ID>] [--endpoint URL] [--timeout-ms 60000] [--retries 2] [--api-key KEY]` |
| `check` | `check [--endpoint URL]` —— 只报告配置状态，**不调用云端** |

**退出码**：`0` 成功 ｜ `2` 参数/输入错 ｜ **`4` = 云端不可用或调用失败（可回退：改用代码矢量 / mermaid / 公司素材）**

### 密钥与平台（口径）

- 密钥来源优先级：`--api-key` > 环境变量 `ARK_API_KEY` > 设置项 `media.ark.api_key`（设置 → 插件 → dsh-doc-suite）
- **默认值不含密钥**：发布件永不含密钥；脚本**不打印、不落日志、不进报错文本**（只报「已配置 / 未配置」）
- 平台默认**火山引擎（ARK）**；模型默认 `doubao-seedream-5-0-pro-260628`（Seedream 5.0 Pro）；端点默认北京区
- **无密钥时生图不可用**（`exit 4`），调用方应**自动回退**，不要报错给使用者看

### 红线（必须遵守）

1. 生图是**云端服务**：调用前**显式告知**使用者「prompt 将发送到该服务」
2. prompt **不含客户信息、报价、涉密内容**；产品实拍与拓扑图**用公司素材**，不要生图
3. 使用者的密钥不外传、不复述；报错信息里也**不得出现密钥**

```bat
:: 先看配置状态（不调用云端）
py -3 <DOC_SUITE_SCRIPTS>\media\gen_image.py check
:: 生成一张概念插图（失败 → exit 4，回退代码矢量）
py -3 <DOC_SUITE_SCRIPTS>\media\gen_image.py image --prompt "工业厂区网络拓扑的概念插画，扁平风格，深蓝主色" --out "素材\cover-ai.png" --size 1K
:: 带参考图（保身份/画风）
py -3 <DOC_SUITE_SCRIPTS>\media\gen_image.py image --prompt "同上风格，改为夜间厂区" --ref "素材\ref.png" --out "素材\b.png"
```

## 二、gen_diagram.py（mermaid 本地渲染）

### 命令

| 子命令 | 用法 |
|---|---|
| `render` | `render <in.mmd> <out.png\|svg> [--tools-dir DIR] [--scale 2] [--theme default] [--background white]` |
| `check` | `check [--tools-dir DIR]` —— 报告运行时与浏览器（不渲染） |

**退出码**：`0` 成功 ｜ `2` 参数错 ｜ **`4` = 运行时缺失或渲染失败（可回退：先导出 SVG 由人工插图）**

### 运行时查找顺序

1. `--tools-dir` 指定目录
2. 环境变量 `DSH_DOC_SUITE_MERMAID`
3. 标准位置 `~/.dsh/data/dsh-doc-suite/tools/mermaid`

> **本脚本不自动安装任何依赖**：找不到运行时 → 打印安装命令 + `exit 4`。

```bat
py -3 <DOC_SUITE_SCRIPTS>\media\gen_diagram.py check
py -3 <DOC_SUITE_SCRIPTS>\media\gen_diagram.py render "架构.mmd" "架构.png"
py -3 <DOC_SUITE_SCRIPTS>\media\gen_diagram.py render "架构.mmd" "架构.svg" --theme neutral --scale 2
```

**坑**：`.mmd` 文件**禁 BOM**（用 Python/Node 写，PowerShell 会带 BOM → mmdc 挂在 JSON.parse）；
mermaid-cli 需要一个浏览器：本机用 **Edge**（`puppeteer.json` 指向它），主版本不匹配时会渲染失败（`exit 4`）。

## 三、安装 / 迁移 mermaid 运行时

```powershell
# 体检（Node / npm / Edge / 运行时；默认只报告不安装）
powershell -ExecutionPolicy Bypass -File <DOC_SUITE_SCRIPTS>\media\setup_mermaid.ps1
# 在标准位置安装（不下载 Chromium，用本机 Edge）
powershell -ExecutionPolicy Bypass -File <DOC_SUITE_SCRIPTS>\media\setup_mermaid.ps1 -Install
# 把别处已有的运行时迁到标准位置
powershell -ExecutionPolicy Bypass -File <DOC_SUITE_SCRIPTS>\media\setup_mermaid.ps1 -MoveFrom "D:\某处\mermaid"
```

**为什么不进插件包**：`@mermaid-js/mermaid-cli` 与 `puppeteer` **不写进 `dependencies`、不进 ``files` 白名单** ——
puppeteer 的 postinstall 可能下载 Chromium，网络失败会**连累整个插件装不上**。安装命令里固定带 `PUPPETEER_SKIP_DOWNLOAD=1`。

## 四、Edge 大版本升级后图示失效的处置

**现象**：昨天还能渲染，今天 `render` 报 **exit 4** + 「mermaid 渲染失败」。

**原因（最常见）**：mermaid-cli 通过 puppeteer 驱动**本机 Edge**，puppeteer 对浏览器主版本有对应关系
（本机当前：puppeteer 25.11 ↔ Chrome/Edge **153**）。Edge 后台自动升级到新主版本后，协议可能不匹配。

**先确认（两条命令都会给出结论）**：

```bat
py -3 <DOC_SUITE_SCRIPTS>\media\gen_diagram.py check     :: 打印 Edge 版本 / puppeteer 期望版本 / 是否对齐
py -3 <DOC_SUITE_SCRIPTS>\..\doctor.py                    :: [4] 段同样给「对齐」结论
```

**三条处置（成本从低到高）**：

1. **退 SVG 人工插图**（当场可交付）：把 `.mmd` 交给人工画，或改用 `ppt_render` 的内置几何标记（cards 的 icon / 形状）
2. **指定匹配主版本的浏览器**：在运行目录写 `puppeteer.json` 指向本机另一份匹配主版本的 Chrome/Chromium（`{"executablePath":"<路径>"}`），再重跑 `render`
3. **装一份匹配的 Chrome for Testing**：在运行目录执行 `npx puppeteer browsers install chrome@<期望版本>` —— 这条会**下载浏览器**，与本模块「默认不下载 Chromium」的策略相反，属**使用者显式选择**

**预防**：Edge 升级后先跑一次 `check`；`doctor.py` 的 [4] 段也会给对齐结论（不一致时按本节处置）。

## 五、典型工作流

1. **给一册 deck 配图**：`gen_image.py check` 看有没有密钥 → 有则生图落盘 → 把图片路径写进 manifest 的 `image` 页或 `cards[].icon` → `ppt_render.py render`
2. **画流程图/架构图**：写 `.mmd`（Python/Node 落盘，无 BOM）→ `gen_diagram.py render` → PNG 进 manifest 的 `image` 页
3. **生图失败（exit 4）怎么办**：**不要报错**，按序回退 —— ① 代码矢量绘制（`ppt_render` 的内置标记/形状）② 用 mermaid 表达 ③ 用公司素材库图片
4. **装运行时**：先跑体检 → 确认 Node/Edge 就绪 → `-Install`；已有运行时用 `-MoveFrom` 迁入标准位置

## 六、注意事项

- **云端边界**：只有 `gen_image.py image` 会出网，且**仅在显式调用时**；默认无密钥 → 全程不出网
- mermaid 渲染在本机（Node + Edge），产物落盘路径由调用方指定
- 运行时不进包、不进依赖；`doctor.py` 的 [4] 段会报告它与浏览器的状态
- 密钥与 ``"媒体设置"``：见 `settings` 的 `media.*` 键（默认空密钥）；**修改设置项后重启 DSH 才在设置页可见**（lib 层变更）
