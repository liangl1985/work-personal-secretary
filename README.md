# work-personal-secretary

> **私人秘书集成体**（DeepSeek Harness 插件集合）。一个仓库、多个子项目，逐步整合成一套"主人的私人秘书"能力，最终按 DSH 最新版要求以一体化插件形态交付。

- 运行环境：**DSH Desktop 2.0.9** / host 运行时 **dsh 0.1.5-rc.1**（cordis bundle 体系）
- 设计目标：**一个包、一个设置入口、一个面板**；子项目可独立开发/验收，再由根层整合
- 发布姿态：**暂不发布 npm**；整合完成、验收通过后再议

## 子项目

| 子项目 | 包名 | 状态 | 说明 |
|---|---|---|---|
| [`modules/dsh-work-memory`](modules/dsh-work-memory) | `dsh-work-memory` | ✅ 可用（v1.0.1） | 执行层长期记忆：**三级记忆模型**（全局永不遗忘 / 热记忆按 TTL 转冷 / 冷归档被用到即转热）+ **转冷预审** + 会话原生注入 + `remember`/`recall`/`link` 工具 + 右侧边栏面板 + Obsidian 镜像。运行时 id 为 `work-memory` |
| [`modules/dsh-doc-suite`](modules/dsh-doc-suite) | `dsh-doc-suite` | ✅ 可用（v0.1.0） | 文档能力：**Word 处理+比对（红线修订）/ Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取**。实现是 Python 脚本 + DSH 原生技能，宿主半只提供 `/doc-doctor` 自检入口 |
| [`modules/dsh-experts`](modules/dsh-experts) | `dsh-experts` | ✅ 可用（v0.1.0） | 专家库：**20 位专家 / 6 域**（售前 5 · 售后 4 · 会计财务 5 · 法务 2 · 文档 3 · 核查 1）。**常驻注入只有一位「身份专家」**（切合使用者岗位）；其余按**问题归属判断**补位，或派子代理（`expert_recall` 把 persona 内联进 prompt）激活；未命中则原生处理。来源为成熟开源件改写（MIT / Apache-2.0），逐条记于 `experts/index.json` + `NOTICE` |

后续候选（待定，需先确认许可证与必要性）：插件市场、多代理团队引擎。

> **`dsh-doc-suite` 的硬前置**（安装前必须满足，`/doc-doctor` 会逐项检测并给出修复命令）：
> **Python ≥ 3.10**（建议 3.12；Windows 一律用 `py -3`，不要用 `python`——它可能是 Microsoft Store 别名 stub）
> 与 **WPS Office**（比对 / 公式重算 / 透视 / 格式转换全部依赖其 COM，本机实测 ProgID 为 `KWPS.Application`）。
> **本集成体不会自动安装解释器或 WPS**。详见该子模块 README 第一节。

## 目录约定

```text
work-personal-secretary/
├── modules/<子项目>/            # 每个子项目是一个可独立测试/打包的单元
│   ├── dsh-work-memory/         #   记忆插件（含自己的 package.json / README / CHANGELOG / 回归）
│   ├── dsh-doc-suite/           #   文档能力模块（Python 脚本 + skills/ + doctor.py）
│   └── dsh-experts/             #   专家库（experts/ 专家数据 + lib/ 匹配与注入 + 三套自测）
├── .github/workflows/ci.yml     # 仓库级 CI：遍历所有子项目跑回归
└── README.md
```

**技能文档的路径约定**：`modules/dsh-doc-suite/skills/*/SKILL.md` 里的命令使用占位符
`<DOC_SUITE_SCRIPTS>`（= 该模块的 `scripts/` 目录），**不写死任何作者机器的绝对路径**。
解析方式：`py -3 <模块目录>\doctor.py --emit-skill-paths`（输出 JSON，含 `scriptsDir`）。

## 开发与验证

```bash
# 跑某个子项目的回归
node modules/dsh-work-memory/scripts/regression.mjs

# 专家库：回归 / 装载冒烟 / 与记忆插件共存契约（三套均不依赖宿主运行时）
node modules/dsh-experts/scripts/regression.mjs
node modules/dsh-experts/scripts/smoke-load.mjs
node modules/dsh-experts/scripts/coexist.mjs

# 语法自检
node --check modules/dsh-work-memory/lib/index.js

# 文档模块：环境自检（Python 依赖 + WPS COM）与路径解析
py -3 modules/dsh-doc-suite/doctor.py
py -3 modules/dsh-doc-suite/doctor.py --emit-skill-paths
```

- **JS 子项目**（`dsh-work-memory`、`dsh-experts`）**零运行时依赖**（只用 node 内置模块；宿主 peer 缺失时自动降级），回归与自测脚本可直接执行，CI 不需要 `npm install`。
- **文档子模块**（`dsh-doc-suite`）的运行时依赖是 **Python 库 + WPS Office**，不经 npm；CI 只做语法自检（`py -3 -m py_compile`），环境就绪性交给使用者本机的 `doctor.py`。
- 改客户端代码（`client/`）必须同步升该子项目的 `package.json` 版本：DSH 的客户端 bundle 按 revision 缓存，不升版本渲染进程不会重新拉取。
- 装到 DSH profile 的方式见各子项目 README（`dsh plugin add` + `dsh.profile.bundles`）。

## 默认约定（随包发布时同样生效）

> 这些是**产品默认行为**，不是可选项；发布/交付件必须做到"首装即适用"。发布前逐项核对 [`RELEASE-CHECKLIST.md`](RELEASE-CHECKLIST.md)。

1. **语言：尽量使用简体中文回答与思维**——回答用简体中文；**推理痕迹也尽量用简体中文**（分析、判断、计划、自查都是中文）；代码、命令、路径、包名、API/字段名、日志与报错原文、专有名词**保留英文，不硬翻**。
   - 随包提供两样（`defaults/` 目录）：
     - [`defaults/global-memory.seed.md`](defaults/global-memory.seed.md) —— **全局记忆种子**（首次使用时写入全局记忆即可，让默认语言生效）；
     - [`defaults/AGENTS.zh-CN.md`](defaults/AGENTS.zh-CN.md) —— **工作区指令模板**（复制到工作区根目录；走 DSH 指令层，约束力强于记忆层）。
2. **总控兼读制**——主对话（对话本体）= 总控 + 读稿人：拆解、派单、核对、监督、纠正、对外沟通，**保持轻量**；绝大多数工作交**专家子代理**执行，主对话对成果负责。
3. **敏感行业例外（红线）**——军工 / 商密 / 烟草 / 数据安全类内容由主上下文直接处理，**不派子代理**。
4. **记忆纪律**——全局记忆永不遗忘；热记忆按 TTL 转冷；冷归档被用到即转热；转冷前先做预审，拿不准的由助手判定、不整批推给使用者。
5. **中立与隐私**——发布件**不含任何个人化身份**（私有助手名、私有称呼、个人账号）、不含私有路径（如 `E:\...`）、不含记忆数据；个性化只走设置页用户层；本地、明文、不联网、无遥测。

## 许可

MIT（见各子项目 `LICENSE`）。
