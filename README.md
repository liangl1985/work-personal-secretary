# work-personal-secretary

> **工作秘书集成体**（DeepSeek Harness 插件集合）：面向**通用工作者**的「工作助手 / 工作秘书」——不是通用聊天插件，而是**能替人干活的秘书**。
> 垂直方向：**技术售前 / 售后 / 会计 / 律师**（四类知识密集、文档密集、流程密集的职业）。
> 运行架构是**总控兼读制**：主对话只做拆解·派单·核对·监督·纠正·对外沟通，**重活交专家子代理执行**。

- 运行环境：**DSH Desktop 2.0.9** / host 运行时 **dsh 0.1.5-rc.1**（cordis bundle 体系）
- 设计目标：**一个包、一个设置入口、一个面板**；子项目可独立开发/验收，再由根层整合
- 版本：集成体 **正式版第一版 `v1.0.0`**（集成体自身的语义化版本，与子模块版本解耦；子模块另打 `dsh-work-memory@1.0.5` 形式的 tag）；变更记录见 [`CHANGELOG.md`](CHANGELOG.md)，发布前逐项核对 [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md)

## 能力总览

| # | 能力 | 落点 | 状态 |
|---|---|---|---|
| 1 | **强记忆**：三级记忆模型（全局永不遗忘 / 热记忆按 TTL 转冷 / 冷归档被用到即转热）+ 转冷预审 + 会话原生注入 + 右侧边栏面板 + Obsidian 镜像 | `modules/dsh-work-memory` | ✅ v1.0.5 |
| 2 | **强文档处理**：Word（处理 + 比对/红线修订）/ Excel（处理 + 重算 + 透视）/ PPT（制作 + 排版）/ PDF（只读精确提取） | `modules/dsh-doc-suite`（Python 脚本 + DSH 原生技能；宿主半只提供 `/doc-doctor`） | ✅ v0.2.0 |
| 3 | **专家库**：19 位专家 / 6 域（信息安全 4 · 财务 4 · 人力资源 1 · 代码编程 3 · 金融 2 · 通用职能 5）；**任务命中关键词才注入**对口专家（注入上限 **写死 4**、设置页不提供该项，**零命中不注入**；身份由记忆承担，默认不常驻）；默认注入**精简卡**（L1，约 0.4–0.7 千字符/位，`expertInjectDetail=full` 可切回全文），其余派子代理激活 | `modules/dsh-experts` | ✅ v0.4.0 |
| 4 | **桌面宠物形象**：小秘书两套形象（**纯欲乖巧＝默认** / 慵懒性感）各 12 动作；插件支持多套装切换 + 「设为默认形象」；动作做到 pingPong 闭环、抠图无紫边/绿边、无背景底色 | `modules/workspace-tokenpet`（**独立项目模块**，MIT；来源致谢见模块 `NOTICE`） | ✅ v1.0.0 |
| 5 | **强思维链分析**（方法 + 在思维过程中以**流程图等形式展示**） | 候选评估中，见 `00_项目主页/插件关注列表.md` #7–#11（首选 `dsh-flowglass`） | ⏳ 待评估 |

## 子项目

| 子项目 | 包名 | 状态 | 说明 |
|---|---|---|---|
| [`modules/dsh-work-memory`](modules/dsh-work-memory) | `dsh-work-memory` | ✅ 可用（**v1.0.5**） | 执行层长期记忆：**三级记忆模型** + **转冷预审**（到期前先判：保留 / 自然转冷 / 待判断）+ 会话原生注入 + `remember`/`recall`/`link` 工具 + 右侧边栏面板 + Obsidian 镜像。运行时 id 为 `work-memory`（包名与 id 均已中性化） |
| [`modules/dsh-doc-suite`](modules/dsh-doc-suite) | `dsh-doc-suite` | ✅ 可用（**v0.2.0**） | 文档能力：**Word 处理+比对（红线修订）/ Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取**。实现是 Python 脚本 + DSH 原生技能，宿主半只提供 `/doc-doctor` 自检入口 |
| [`modules/dsh-experts`](modules/dsh-experts) | `dsh-experts` | ✅ 可用（**v0.4.0**） | 专家库：**19 位专家 / 6 域**。**默认一位都不常驻**：任务命中关键词才注入对口 persona（`expertInjectMax` **写死 4**、设置页不提供该项，零命中不注入），可调配置层范围，>1 提示占 TOKEN）或派子代理（`expert_recall` 把 persona 内联进 `subagent.prompt`）；未命中则原生处理。来源为成熟开源件压缩/组合改写（**MIT 17 · Apache-2.0+MIT 双许可 2 · Apache-2.0 1 · 自撰 1**，合计 20），逐条记于 `experts/index.json` + `NOTICE` |
| [`modules/workspace-tokenpet`](modules/workspace-tokenpet) | `workspace-tokenpet` | ✅ 可用（**v1.0.0**） | **独立项目模块**（源码 / 构建产物 / 文档 / 素材全部自持；由三方插件独立化，对上游只保留致谢，上游 MIT 版权与许可文本保留在模块 `LICENSE`）：**不依赖上游仓库、无需应用补丁**。① **多形象套装**运行时化（宿主扫描 `~/.dsh/data/workspace-tokenpet/skins/`，manifest 校验 + 路径穿越防护 + 客户端解析 + blob URL 桥 + 设置面板）；② **条带切帧修复**（宿主透传 `rows`，否则客户端回退内置模板的 2 行 → 宠物显示"两个细长人影"）；③ UI 清理（移除 `aura` 环绕光圈 / `meter` 脚底横条）；④ 默认形象 + 「设为默认形象」按钮。**随包提供三套形象素材**（`default` 上游内置 + 两套自有形象），安装时自动部署到运行时目录（只补缺失、不覆盖；新址缺套装时自旧址复制迁移） |

后续候选（待定，需先确认许可证与必要性）：多代理团队引擎、思维链可视化（见关注列表）。

## 安装 / 首次使用 / 卸载与数据留存

### 安装

前置：**DSH Desktop 2.0.9**（host 运行时 `dsh 0.1.5-rc.1`）。

**整体安装（推荐：先装入口，再由它引导安装子模块）**

```bash
git clone https://github.com/liangl1985/work-personal-secretary.git
dsh plugin --profile desktop add <克隆目录>/modules/work-personal-secretary   # profile 名换成你自己的
# 重启 DSH → 设置 → 工作秘书 → 「安装与检查」→ 按需安装各子模块（页面内可指定仓库目录）
```

> `dsh plugin` 是 `pnpm` 的代理（在 profile 目录下执行），所以 `add` 接受**目录路径**，落盘后 `dependencies` 记为 `file:<目录>`；子模块之间零运行时依赖，无需 `npm install`。

**只装某一个子模块**（命令形态与上面一致）：

```bash
dsh plugin --profile <profile> add <模块目录或包名>
```

| 子模块 | 额外前置 |
|---|---|
| `dsh-work-memory` | 无（零运行时依赖，只用 node 内置模块） |
| `dsh-experts` | 无（零运行时依赖） |
| `dsh-doc-suite` | **Python ≥ 3.10**（建议 3.12；Windows 用 `py -3`）+ **WPS Office** —— **两者都不会被自动安装**，由 `/doc-doctor` 检测并给出修复命令 |
| `workspace-tokenpet` | 无（零运行时依赖：宿主半只用 node 内置模块，客户端为预构建产物；`npm install` 只在开发/重建时需要） |

宿主侧代码改动需**重启 DSH** 才加载；仅客户端改动刷新页面即可（客户端 bundle 按 revision 缓存，故每次改动都会升版本号）。

### 首次使用

1. **让默认约定生效**（二选一）：把 `defaults/global-memory.seed.md` 的语言偏好写入全局记忆；或把 `defaults/AGENTS.zh-CN.md` 复制到会话工作区根目录作 `AGENTS.md`（**指令层**，约束力强于记忆层）。
2. **确认岗位**：装了 `dsh-experts` 时执行 `/expert setup <域>` 写入「身份专家」；`/expert list` 查看全部专家，`/expert why <任务文本>` 看打分理由。
3. **自检文档环境**：`/doc-doctor`（等价于 `py -3 modules/dsh-doc-suite/doctor.py`）逐项检测 Python 依赖与 WPS COM 通道。
4. **记忆库首装为空**：人设、偏好与业务记忆由使用者自己写入，**包内不含任何记忆数据**。

### 卸载与数据留存

- 卸载插件：`dsh plugin --profile <profile> remove <包名>`，随后重启 DSH。
- **记忆数据不随插件卸载而删除**：默认位于 `~/.dsh/memories/work-memory/`（Markdown 正文 + 索引/状态文件），默认备份目录 `~/.dsh/memories/work-memory-backup/`。需要彻底清除时手动删除这两个目录。
- **外部知识库镜像**（如已配置）是一份可读的 Markdown 副本，卸载后保留，可继续当资料使用。
- 桌宠**形象素材**位于 `~/.dsh/data/workspace-tokenpet/skins/`，属使用者自有资产，卸载插件不受影响（模块内 `skins/` 是随包副本，运行时用的是部署后的那一份；安装器只补缺失、不覆盖你改过的套装）。**旧目录 `~/.dsh/data/dsh-token-pet/skins/` 的数据不删除**：装新模块时新址缺哪套就从旧址**复制**哪套（旧数据保留、新址已有内容不覆盖）。
- 全部数据**本地存放、明文、不联网、无遥测**；除使用者自己配置的模型服务外，本集成体不向外发送任何内容。

## 已验证的安装形态（desktop profile，2026-09-13）

| 插件 | 版本 | 来源 |
|---|---|---|
| `dsh-work-memory` | 1.0.5 | 本地（`file:node_modules/dsh-work-memory`） |
| `dshmarket` | 1.45.1 | npm（插件市场本体，**市场界面通常不列自己**） |
| `dsh-mermaid` | 0.4.0 | npm |
| `dsh-doc-suite` | 0.2.0 | 本地（`file:<集成体仓库>/modules/dsh-doc-suite`） |
| `dsh-experts` | 0.4.0 | 本地（`file:<集成体仓库>/modules/dsh-experts`） |
| `workspace-tokenpet` | 1.0.0 | 本地（`file:<集成体仓库>/modules/workspace-tokenpet`；素材随安装部署到 `~/.dsh/data/workspace-tokenpet/skins/`） |

> **本机 desktop profile 尚需一次迁移**（旧 id `dsh-token-pet@0.2.1-lina.1` → 新 id `workspace-tokenpet@1.0.0`）：卸载旧 id → 安装新 id → 确认素材目录；步骤见 [`modules/workspace-tokenpet/CHANGELOG.md`](modules/workspace-tokenpet/CHANGELOG.md) 1.0.0 段。本次未改动本机 profile。

`dsh --profile desktop --dump-config` 退出码 **0**（2026-09-14 独立化后复核：退出码仍为 0；本机换 id 之前，组合树中的桌宠条目仍显示旧 id `token-pet` / `dsh-token-pet`，迁移后应为 `workspace-tokenpet`）。

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
│   └── workspace-tokenpet/      #   桌面形象（独立项目模块：src/ 源码 + lib/ 产物 + client/ 预构建 + skins/ 三套素材）
├── defaults/                    # 随包默认：全局记忆种子 + AGENTS 指令模板（中文）
├── CHANGELOG.md                 # 集成体版本历史（正式版第一版 v1.0.0）
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

- **JS 子项目**（`dsh-work-memory`、`dsh-experts`）**零运行时依赖**（只用 node 内置模块；宿主 peer 缺失时自动降级），回归与自测脚本可直接执行，CI 不需要 `npm install`。`workspace-tokenpet` 的宿主半同样零运行时依赖（`lib/` 只用 node 内置模块，`client/client.js` 为预构建产物）。
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
