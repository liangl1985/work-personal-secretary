# work-personal-secretary

> **工作秘书集成体**（DeepSeek Harness 插件集合）：面向**通用工作者**的「工作助手 / 工作秘书」——不是通用聊天插件，而是**能替人干活的秘书**。
> 垂直方向：**技术售前 / 售后 / 会计 / 律师**（四类知识密集、文档密集、流程密集的职业）。
> 运行架构是**总控兼读制**：主对话只做拆解·派单·核对·监督·纠正·对外沟通，**重活交专家子代理执行**。

- 运行环境：**DSH Desktop 2.0.9** / host 运行时 **dsh 0.1.5-rc.1**（cordis bundle 体系）
- 设计目标：**一个包、一个设置入口、一个面板**；子项目可独立开发/验收，再由根层整合
- 发布姿态：**暂不发布 npm**；整合完成、验收通过后再议（发布前逐项核对 [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md)）

## 能力总览

| # | 能力 | 落点 | 状态 |
|---|---|---|---|
| 1 | **强记忆**：三级记忆模型（全局永不遗忘 / 热记忆按 TTL 转冷 / 冷归档被用到即转热）+ 转冷预审 + 会话原生注入 + 右侧边栏面板 + Obsidian 镜像 | `modules/dsh-work-memory` | ✅ v1.0.3 |
| 2 | **强文档处理**：Word（处理 + 比对/红线修订）/ Excel（处理 + 重算 + 透视）/ PPT（制作 + 排版）/ PDF（只读精确提取） | `modules/dsh-doc-suite`（Python 脚本 + DSH 原生技能；宿主半只提供 `/doc-doctor`） | ✅ v0.1.1 |
| 3 | **专家库**：20 位专家 / 6 域（售前 5 · 售后 4 · 会计财务 5 · 法务 2 · 文档 3 · 核查 1）；**常驻注入只有一位「身份专家」**，其余按**问题归属判断**补位或派子代理激活 | `modules/dsh-experts` | ✅ v0.1.1 |
| 4 | **桌面宠物形象**：小秘书两套形象（**纯欲乖巧＝默认** / 慵懒性感）各 12 动作；插件支持多套装切换 + 「设为默认形象」；动作做到 pingPong 闭环、抠图无紫边/绿边、无背景底色 | `modules/dsh-token-pet`（**三方插件 `dsh-token-pet` 的定制层**，上游 MIT，以补丁维护） | ✅ v0.2.1-lina.1 |
| 5 | **强思维链分析**（方法 + 在思维过程中以**流程图等形式展示**） | 候选评估中，见 `00_项目主页/插件关注列表.md` #7–#11（首选 `dsh-flowglass`） | ⏳ 待评估 |

## 子项目

| 子项目 | 包名 | 状态 | 说明 |
|---|---|---|---|
| [`modules/dsh-work-memory`](modules/dsh-work-memory) | `dsh-work-memory` | ✅ 可用（**v1.0.3**） | 执行层长期记忆：**三级记忆模型** + **转冷预审**（到期前先判：保留 / 自然转冷 / 待判断）+ 会话原生注入 + `remember`/`recall`/`link` 工具 + 右侧边栏面板 + Obsidian 镜像。运行时 id 为 `work-memory`（包名与 id 均已中性化） |
| [`modules/dsh-doc-suite`](modules/dsh-doc-suite) | `dsh-doc-suite` | ✅ 可用（**v0.1.1**） | 文档能力：**Word 处理+比对（红线修订）/ Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取**。实现是 Python 脚本 + DSH 原生技能，宿主半只提供 `/doc-doctor` 自检入口 |
| [`modules/dsh-experts`](modules/dsh-experts) | `dsh-experts` | ✅ 可用（**v0.1.1**） | 专家库：**20 位专家 / 6 域**。**常驻注入只有一位「身份专家」**（切合使用者岗位，设置项 `identityExpert`）；其余按**问题归属判断**补位（`expertInjectMax` 1–3，>1 提示占 TOKEN）或派子代理（`expert_recall` 把 persona 内联进 `subagent.prompt`）；未命中则原生处理。来源为成熟开源件压缩/组合改写（**MIT 17 · Apache-2.0+MIT 双许可 2 · Apache-2.0 1 · 自撰 1**，合计 20），逐条记于 `experts/index.json` + `NOTICE` |
| [`modules/dsh-token-pet`](modules/dsh-token-pet) | `dsh-token-pet` | ✅ 可用（**v0.2.1-lina.1**） | **三方插件定制层**（上游 MIT，基线 `cc49233` / v0.2.0）：**不 fork 整包、不 vendor 素材**，只以**补丁**保存改造——① **多形象套装**运行时化（宿主扫描 `~/.dsh/data/dsh-token-pet/skins/`，manifest 校验 + 路径穿越防护 + 客户端解析 + blob URL 桥 + 设置面板）；② **条带切帧修复**（宿主透传 `rows`，否则客户端回退内置模板的 2 行 → 宠物显示"两个细长人影"）；③ UI 清理（移除 `aura` 环绕光圈 / `meter` 脚底横条）；④ 默认形象 + 「设为默认形象」按钮。**形象素材为私有资产，不随包分发** |

后续候选（待定，需先确认许可证与必要性）：多代理团队引擎、思维链可视化（见关注列表）。

## 本机安装状态（desktop profile，2026-09-12）

| 插件 | 版本 | 来源 |
|---|---|---|
| `dsh-work-memory` | 1.0.3 | 本地（`file:node_modules/dsh-work-memory`） |
| `dshmarket` | 1.45.1 | npm（插件市场本体，**市场界面通常不列自己**） |
| `dsh-mermaid` | 0.4.0 | npm |
| `dsh-doc-suite` | 0.1.1 | 本地（`file:E:/lina/.../modules/dsh-doc-suite`） |
| `dsh-experts` | 0.1.1 | 本地（`file:E:/lina/.../modules/dsh-experts`） |
| `dsh-token-pet` | 0.2.1-lina.1 | 本地 `link:`（`E:/lina/_plugin_analysis/dsh-token-pet`；**定制层补丁在 `modules/dsh-token-pet`**，素材在 `~/.dsh/data/dsh-token-pet/skins/`） |

`dsh --profile desktop --dump-config` 退出码 **0**，上述条目均在组合树中且无 `disabled`。

> **`dsh-doc-suite` 的硬前置**（安装前必须满足，`/doc-doctor` 会逐项检测并给出修复命令）：
> **Python ≥ 3.10**（建议 3.12；Windows 一律用 `py -3`，不要用 `python`——它可能是 Microsoft Store 别名 stub）
> 与 **WPS Office**（比对 / 公式重算 / 透视 / 格式转换全部依赖其 COM，本机实测 ProgID 为 `KWPS.Application`）。
> **本集成体不会自动安装解释器或 WPS**。详见该子模块 README 第一节。

## 目录约定

```text
work-personal-secretary/
├── modules/<子项目>/            # 每个子项目是一个可独立测试/打包的单元
│   ├── dsh-work-memory/         #   记忆插件（lib/ + client/ + scripts/regression.mjs）
│   ├── dsh-doc-suite/           #   文档能力模块（Python 脚本 + skills/ + doctor.py）
│   ├── dsh-experts/             #   专家库（experts/ 专家数据 + lib/ 匹配与注入 + 三套自测）
│   └── dsh-token-pet/           #   桌宠定制层（三方插件补丁 + 应用脚本 + 回归测试；素材/构建产物不入库）
├── defaults/                    # 随包默认：全局记忆种子 + AGENTS 指令模板（中文）
├── .github/workflows/ci.yml     # 仓库级 CI：语法自检 + 遍历子项目跑回归 + 冒烟/共存 + 必需文件自检
├── RELEASE-CHECKLIST.md         # 发布检查清单（发布前逐项打勾）
└── README.md
```

**技能文档的路径约定**：`modules/dsh-doc-suite/skills/*/SKILL.md` 里的命令使用占位符
`<DOC_SUITE_SCRIPTS>`（= 该模块的 `scripts/` 目录），**不写死任何作者机器的绝对路径**。
解析方式：`py -3 <模块目录>\doctor.py --emit-skill-paths`（输出 JSON，含 `scriptsDir`）。

## 开发与验证

```bash
# 记忆模块：回归
node modules/dsh-work-memory/scripts/regression.mjs

# 专家库：回归 / 装载冒烟（mock ctx 真跑 apply）/ 与记忆插件共存契约
node modules/dsh-experts/scripts/regression.mjs
node modules/dsh-experts/scripts/smoke-load.mjs
node modules/dsh-experts/scripts/coexist.mjs

# 语法自检
node --check modules/dsh-work-memory/lib/index.js
node --check modules/dsh-experts/lib/index.js

# 文档模块：环境自检（Python 依赖 + WPS COM）与路径解析
py -3 modules/dsh-doc-suite/doctor.py
py -3 modules/dsh-doc-suite/doctor.py --emit-skill-paths
```

- **JS 子项目**（`dsh-work-memory`、`dsh-experts`）**零运行时依赖**（只用 node 内置模块；宿主 peer 缺失时自动降级），回归与自测脚本可直接执行，CI 不需要 `npm install`。
- **文档子模块**（`dsh-doc-suite`）的运行时依赖是 **Python 库 + WPS Office**，不经 npm；CI 只做语法自检（`py -3 -m py_compile`），环境就绪性交给使用者本机的 `doctor.py`。

## 默认约定（随包发布时同样生效）

> 这些是**产品默认行为**，不是可选项；发布/交付件必须做到"首装即适用"。发布前逐项核对 [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md)。

1. **语言：尽量使用简体中文回答与思维**——回答用简体中文；**推理痕迹也尽量用简体中文**（分析、判断、计划、自查都是中文）；代码、命令、路径、包名、API/字段名、日志与报错原文、专有名词**保留英文，不硬翻**。
   - 随包提供两样（`defaults/` 目录）：
     - [`defaults/global-memory.seed.md`](defaults/global-memory.seed.md) —— **全局记忆种子**（首次使用时写入全局记忆即可，让默认语言生效）；
     - [`defaults/AGENTS.zh-CN.md`](defaults/AGENTS.zh-CN.md) —— **工作区指令模板**（复制到工作区根目录；走 DSH 指令层，约束力强于记忆层）。
2. **总控兼读制**——主对话（对话本体）= 总控 + 读稿人：拆解、派单、核对、监督、纠正、对外沟通，**保持轻量**；绝大多数工作交**专家子代理**执行，主对话对成果负责。
3. **敏感行业例外（红线）**——军工 / 商密 / 烟草 / 数据安全类内容由主上下文直接处理，**不派子代理**。
4. **记忆纪律**——全局记忆永不遗忘；热记忆按 TTL 转冷；冷归档被用到即转热；转冷前先做预审，拿不准的由助手判定、不整批推给使用者。
5. **专家库使用流程**（装了 `dsh-experts` 时生效）——**常驻只有一位身份专家**（切合使用者岗位）；每轮**先判断问题归属**：命中单一专家 → 按该视角原生处理；跨领域多专家 / 需独立作业 → **派子代理**并把 persona 内联进 prompt；**未命中 → 原生处理**，不硬套专家视角。模板见 `defaults/AGENTS.zh-CN.md`。
6. **中立与隐私**——发布件**不含任何个人化身份**（私有助手名、私有称呼、个人账号）、不含私有路径（如 `E:\...`）、不含记忆数据；个性化只走设置页用户层；本地、明文、不联网、无遥测。
7. **第三方合规**——内置的专家 persona / 角色定义必须来自**许可允许再分发**的来源（MIT / Apache-2.0 等），逐条记录来源与许可（`experts/index.json` + `NOTICE`）；**无 LICENSE 的一律不收录**。

## 运维纪律（改代码/改配置后必看，2026-09-12 事故沉淀）

- **`file:` 依赖有缓存**：改了子模块源码后，`dsh plugin add <路径>` 常报 `Already up to date` 而**不同步**。可靠顺序：升 `package.json` 补丁版本 → `dsh plugin --profile <p> install --force` → 仍不同步就**删掉** `~/.dsh/profiles/<p>/node_modules/<模块>` 再 `dsh plugin add` → **逐文件 SHA256 比对**源码与副本；
- **必须重启 DSH**：新模块 / 新版本 / host 侧代码改动都要重启才加载（客户端 bundle 另需升版本号，渲染进程按 revision 缓存）；
- **别用 PowerShell 的 `Set-Content -Encoding utf8` 改 profile 的 JSON 或 `~/.dsh/settings.yaml`**：它会写 BOM，DSH 读 profile 时 `JSON.parse` 直接失败（`Unexpected token '\uFEFF'`），YAML 则报 `Nested mappings are not allowed in compact mappings`。这类文件一律用 **Node 的 `fs`**（明确 UTF-8、无 BOM）写。

## 许可

MIT（见各子项目 `LICENSE`）。第三方来源与许可见 `modules/dsh-experts/NOTICE` 与各模块 README。
