# 发布检查清单（work-personal-secretary）

> ⛔ **本次不适用**：`v1.1.3` 及 `1.2.0` 经主人 2026-09-17 裁定**不发布**（原因见根 `/CHANGELOG.md` 的 1.1.3 段与 `modules/work-personal-secretary/CHANGELOG.md`）。本清单保留给**下一次真正发布**时使用；本次不做逐项打勾。

> 📌 **发布节奏（2026-09-17 主人定）**：此后一律**小步 patch、不再开大版本**；非必要不打 Release。当前对外发布版为 `v1.0.0`（Latest）；`v1.1.0` 草稿已于 2026-09-17 删除（tag 保留）；`v1.1.1`–`v1.1.3` 与 `1.2.0` 均不发布。
> 📌 **CI 状态（2026-09-17）**：远端 `main` 已追平本地 1.1.3；Linux runner 上的测试平台问题已修（见根 `CHANGELOG.md` 与 `modules/dsh-doc-suite/CHANGELOG.md` 的 0.7.10 段）。

> 每次发布/交付前逐项打勾；任何一项不满足就不发。宿主基线：**DSH Desktop 2.0.9 / host `dsh 0.1.5-rc.1`**（升 DSH 后先重跑本清单）。
>
> 集成体版本：**对外发布基线 `v1.0.0`**（见根 [`CHANGELOG.md`](CHANGELOG.md)）；**当前开发版 `1.1.3`**（按「不发布」收尾）。子模块**当前实际版本**（2026-09-17 实测，以各自 `package.json` 为准）：`dsh-work-memory` **1.0.6** · `dsh-doc-suite` **0.7.11** · `dsh-experts` **0.5.9** · `workspace-tokenpet` **1.0.1**（独立项目模块）· 第三方 `dsh-mermaid` 0.4.0。四者已实装本机 desktop。

## 一、默认约定必须随包生效（2026-09-11 定）

- [x] **语言**：默认「**尽量**使用简体中文回答与思维」（推理痕迹也尽量用简体中文；代码/命令/路径/包名/API/日志原文/专有名词保留英文，不硬翻）
  - [x] `defaults/global-memory.seed.md`（**全局记忆种子**）存在，含语言偏好条目
  - [x] `defaults/AGENTS.zh-CN.md`（**工作区指令模板**）存在，含《语言》段
  - [x] 根 README「默认约定」段写明该默认，并指向 `defaults/`
- [x] **运行架构**：总控兼读制写进默认约定（主对话轻量：拆解/派单/核对/监督/纠正/对外沟通；重活交专家子代理）
- [x] **敏感行业例外**：军工/商密/烟草/数据安全类内容由主上下文直接处理、不派子代理（红线，随包默认）

## 二、中立与隐私（发布件不得夹带私人信息/身份）

- [x] **不得出现任何个人化身份**：私有助手名（如本机自用名）、"主人/主人级"等私有称呼、个人邮箱/账号
  - 检索方式：`git grep -n -i -e '<私有名>' -e '主人'`，命中项须为通用表述（使用者/助手）
- [x] **不得出现私有路径**：`E:\...` / `E:/...`（**正反斜杠两种写法都要扫**）、`~/.dsh/memories/<私有名>`、私有工作区/知识库目录名、第三方克隆目录等；默认路径必须通用（如 `~/.dsh/data/dsh-work-memory/memory`）
  - 检索方式：`git grep -n -i -E 'E:[\\/]'`、`git grep -n -i -E '\.dsh/memories/'`、`git grep -n -i '<私有名>'`（含注释与测试夹具，不只文档）
- [x] `cordis.patch.yml` 及各模块默认配置**中性**：无个人路径、无称呼
- [x] 个性化只走**设置页用户层**（不写进包内默认层）
- [x] 包内**不含任何记忆数据**（首装记忆为空，人设由首轮对话填充）
- [x] README 写清：本地 / 明文 / 不联网 / 无遥测；安装、首次使用、卸载与数据留存三段齐全

## 三、工程门禁

- [x] 全部 JS `node --check` 通过
- [x] 全部 Python 脚本 `py -3 -m py_compile` 通过（`modules/dsh-doc-suite/`）
- [x] 各子项目回归全绿（`node modules/<模块>/scripts/regression.mjs`）
- [x] **`dsh-experts` 三套自测全绿**——三套**均不依赖宿主运行时**（缺 host peer 时自动降级），可脱离 DSH 独立跑：
  - [x] `node modules/dsh-experts/scripts/regression.mjs` —— **25 项**：索引完整性（20 位 / 6 域 / 字段齐全 / id 唯一 / 域合法）、persona 体量（正文存在、含三段固定标题、字数区间）、匹配打分（岗位先验 / 关键词 / 显式指定 / 跨域 Top-2 门槛 / 同域不叠加 / 阈值卡关）、注入组装（标题、超长截断并标注、空 persona 不产出）
  - [x] `node modules/dsh-experts/scripts/smoke-load.mjs` —— **18 项**：mock cordis ctx **真调 `apply()`**，验「注册了什么」与「注入回调返回什么」；`@deepseek-ai/schemastery` 缺失时**动态导入降级**（跳过设置命名空间注册并打印提示，其余功能照常）
  - [x] `node modules/dsh-experts/scripts/coexist.mjs` —— **7 项**：与 `dsh-work-memory` 挂同一 ctx 的**共存契约**（注入顺序 480 → 500、两条回调互不覆盖、合并上下文含「专家视角 + 记忆」、工具/命令不重名）；无宿主依赖时走**契约模拟**路径，且**明确打印所走路径**（不假装真加载）
- [x] CI 在 Node 22 与 24 双版本通过
- [x] 客户端有改动的模块**已升版本号**（DSH 客户端 bundle 按 revision 缓存）
- [x] **仓库根 `CHANGELOG.md` 存在**，且记录本次发布的变更（集成体版本与子模块版本解耦）
- [x] 打包白名单（`files`）覆盖 lib / client / scripts / skills / experts / cordis.patch.yml / CHANGELOG / LICENSE / NOTICE / README
- [x] `CHANGELOG.md` 记录本次变更（含破坏性变更与迁移说明）
- [x] **仓库根 `NOTICE` 存在**（聚合索引：随包内容与各模块版本 / 20 位 persona 来源与许可 / `review: pending` 免责 / 未随包分发清单）
- [x] **命中评估资产（2026-09-16 新增，同日移除）**：`hit-distribution.mjs` / `hit-false-positive.mjs` 与语料 `hit-corpus.json`(180) / `hit-corpus-real.json`(30) / `hit-negative.json`(105) / `hit-corpus-clean10.json`(10) —— 为「命中位数分布调优」而建；**2026-09-16 收尾时使用者决定移除**（专家库不再做大调整，评估门禁以五套回归为准），文件已从源码与 profile 副本删除。
  实测存档：真实语料 2+3 = 60% · 4 位 = 20% · 负样本 93.3% 干净；历史结论见 `记忆/02_分析笔记/49_专家库命中分布调优（180 条语料）.md` 与 `50_专家库真机验收（10 条子任务）.md`。
- [x] **CI 覆盖范围核对（2026-09-13 P5）**：语法自检已覆盖全量 `*.js` / `*.mjs`（含本体 `lib/settings-api.js`）；回归 / 装载冒烟 / 共存契约分别由 `*/scripts/regression.mjs`、`*/scripts/smoke-load.mjs`、`*/scripts/coexist.mjs` 覆盖；
      **本体四套自测**（`probe-test.mjs` 136 · `install-test.mjs` 200 · `basedeck-test.mjs` 179 · `settings-api-test.mjs` 109）原先**漏在 CI 范围之外**，本次新增 `*/scripts/*-test.mjs` 步骤纳入
- [x] **真机生效配置比对（2026-09-16 新增，事故沉淀）**：发布/同步后必须比对**真机实际生效值**的三处来源 —— ① `~/.dsh/settings.yaml` 的**用户覆盖层** ② profile 的 `cordis.patch.yml`（部署 base 层）③ 代码 `DEFAULTS` / schema 默认值。**优先级是 用户覆盖层 > profile patch > schema 默认**，前两者任一残留都会**静默压过**代码里的新默认。
  - 背景：`dsh-experts` 0.4.0 把 `expertSecondThreshold` 代码默认由 **0.8 调为 0.3**，但真机用户覆盖层里那行 `0.8` 从未删过 ⇒ **该调整连续两个版本未在真机生效**（2026-09-16 干净版验收时发现，已删行并复测：30 条真实语料 2+3 位由 46.7% 升至 60%、4 位由 6.7% 升至 20%）。
  - 自检做法：读 `~/.dsh/settings.yaml` 逐键比对（本次用 `read` 工具直接读；PowerShell 侧注意 `-Encoding utf8` 会写 BOM，见坑②），差异**不以「代码已改」为由放过**。
  - 附注：`@deepseek-ai/dsh-settings-file` 默认 `watch: true`（chokidar），**手改 settings.yaml 免重启**、热发布；已知限制是 watcher 漏事件要等下一个信号，异常时重启一次兜底。
- [x] **补入 CI 后首轮即暴露并修掉测试自身的平台缺陷**：`probe-test.mjs` 的 `/fix` 白名单断言未锁定 `platform`，在 Linux runner 上走「非 Windows 平台无 winget」分支（**9 项失败**）→ 锁定 `platform: 'win32'`、`pythonDeps` 真跑断言容忍「解释器在、pip 不可用」的降级形态、`maskUserPath` 断言做分隔符归一化，并**新增 2 条非 Windows 平台分支正向断言**（不再依赖宿主恰好是 Windows）；本机 win32 **136/136** · 伪装 linux **133/133** · CI `e4943c7` Node 22/24 双版本 **success**

## 三点五、文档模块硬前置与路径（2026-09-12 增）

- [x] README 明写 `dsh-doc-suite` 的两条**硬前置**：**Python ≥ 3.10**（建议 3.12，Windows 用 `py -3`）+ **WPS Office**（COM 通道）
- [x] 明确声明**不自动安装**解释器与 WPS；缺什么由 `doctor.py` 检测并打印可复制的修复命令
- [x] `modules/dsh-doc-suite/skills/*/SKILL.md` 中**不得出现作者机器绝对路径**（形如 `<盘符>:\<个人工作区>\scripts\...`）；
      统一使用占位符 `<DOC_SUITE_SCRIPTS>`，解析方式写进技能与 README（`doctor.py --emit-skill-paths`）
- [x] 技能含**子命令速查表**（位置参数 vs 选项参数易错点：`convert <src> <dst>` 无 `--to`、`merge/make` 输出在前等）
- [x] `doctor.py` 在本机跑通且结论为「环境就绪」（`/doc-doctor` 同源）

## 三点六、专家库模块（dsh-experts，2026-09-12 增）

### 来源与许可

- [x] `NOTICE` 齐备：列上游项目、许可证类型，并保留必要许可文本
- [x] `experts/index.json` **每条专家**都有 `source`（记 `repo` / `path` / `license` / `adapted`）——**无许可靠来源不得收录**
- [x] 自撰条目诚实标注 `source.origin: "self-authored"`（不假称来自上游）
- [x] 许可口径与索引一致（本机实核 20 条：MIT 17 · Apache-2.0+MIT 双许可 2 · Apache-2.0 1；自撰 1 条 `doc-office`）
- [x] Apache-2.0 来源随包保留版权与许可文本，并在改写处**声明已修改**（Apache-2.0 要求）

### `review: pending` 机制（待专业复核）

- [x] 安全域 6 位 + 法务 2 位，共 **8 条**保持 `source.review: "pending"`，**不得被表述为已复核**
- [x] README / NOTICE 说明 pending 的含义：**未经专业复核**——只作专业参考视角，**不得据此出具测评结论或法律意见**，对外交付前须人工复核
- [x] 复核通过后同时改 `index.json` 的 `review` 字段并记 `CHANGELOG`（禁止只改文档、不改数据）

### 工具与命令契约

- [x] `expert_recall` 工具定义符合官方契约：`parameters` 用 **DSH DSL** 声明；`output` = **`{ schema, render }`**（execute 返回结构化对象，`render` 负责显示）——不得沿用旧形态
- [x] `/expert` 命令返回体为 **`{ kind, text }`**（`kind` 覆盖 listing / persona / match / no-match / success / error）
- [x] 未知 id、persona 文件缺失时返回**结构化错误**（`ok:false` + 明确提示），**不抛异常**
- [x] persona 超长（`PERSONA_MAX_CHARS` = 3000）时**截断并标注**，不静默丢弃

### 身份专家与问题归属流程

- [x] **默认一位都不常驻**（0.3.0 身份退场）：`identityExpert` **留空 = 不注入**（身份由 work-memory 记忆承担）；显式填写才常驻一位——发布件不得写成"默认常驻身份专家"
- [x] 其余专家按**问题归属判断**补位：命中单一 → 按该专家视角原生处理；**跨领域/需独立作业 → 派子代理**（`expert_recall` 取 persona 后**内联进 `subagent.prompt`**）；未命中 → **原生处理**（宁缺勿滥，不硬套视角）
- [x] **匹配排序修复（0.1.4）**：排序改为「显式指定 > 任务实证 > 总分 > index 顺序」，`expertMinScore` 只卡零实证候选 —— 实测「这份采购合同的钱怎么算、税怎么处理」由投标策略师改为命中法务，上限 2 且无身份专家时「法务 + 会计」同时选中
- [x] **提示词注入分级（0.1.4）**：默认形态 `auto` 只注入**精简卡**（464–509 字符/位）；`expertInjectDetail`（auto / card / full，**full 可回退旧行为**）与 `expertInjectBudgetChars`（0.1.4 时默认 1400，0.3.x 起默认 **2000**，超预算按序降级并标注）；`expert_recall` 与派子代理仍取全文；实测单轮 3674 → 1218 字符
- [x] `enabledDomains` / `enabledExperts` 只**收窄**"参与自动匹配"的集合，不改变上述流程
- [x] 敏感行业（军工/商密/烟草/数据安全）仍**主上下文直接做、不派子代理**（与第一节红线一致）

### 注入上限与 TOKEN 提示

- [x] `expertInjectMax` **写死 4**（2026-09-15 主人定：设置页不再提供该项，`settings.js` DEFAULTS = 4 / schema default = 4 / `cordis.patch.yml` base = 4 **三处一致**）；`lib/limits.js` 的 `INJECT_MAX_HARD = 4` 为硬边界（越界 clamp 到 4，绝不静默超限）
- [x] `expertSecondThreshold`（默认 **0.3**，2026-09-15 由 0.8 调为 0.3）确实约束域专家第 2/3 位——其**任务证据** ≥ 第 1 位 × 该值才补位（0.3.0 起为纯证据比较；通用型专家另走 `expertGeneralMinEvidence` 绝对门槛）
- [x] **`expertMinScore` 已于 0.3.0 移除**（零命中不注入落地后无任何代码路径使用）
- [x] 设置项齐全且默认值正确（共 **19 项**，dsh-experts 0.5.1 schema 全量）：`expertsEnabled` / `expertCatalogEnabled` / `disciplineEnabled` / `disciplineMemoryDir` / `defaultDomain` / `identityExpert` / `enabledDomains` / `enabledExperts` / `expertInjectMax`（**写死 4，设置页不提供该项**）/ `expertSecondThreshold` / `expertGeneralMax` / `expertGeneralMinEvidence` / `skillInjectEnabled` / `skillBudgetChars` / `expertInjectDetail` / `expertInjectBudgetChars` / `expertShowBanner` / `expertSetupDone`（0.4.0 新增 `expertGeneralMax` / `expertGeneralMinEvidence` 两键，16 → 18；`expertSetupDone` 由安装引导自动写入）
- [x] 注入块标题：默认 **【处理路径】+【本轮命中·…】**（0.3.0 身份退场后不再有常驻【身份视角·…】；`identityExpert` 显式配置时才会出现）

## 三点七、桌面形象模块（workspace-tokenpet，2026-09-14 独立化）

> 形态：**独立项目模块**（源码 + 构建产物 + 文档 + 素材自持）。此前为三方插件 `dsh-token-pet` 的本地定制层；1.0.0 起独立化，对上游只保留致谢（上游版权与 MIT 许可文本保留在该模块 `LICENSE`）。

### 结构与命名

- [x] 模块结构齐备：`README.md` / `README.en.md` / `CHANGELOG.md` / `LICENSE` / `NOTICE` / `CONTRIBUTING.md` / `SECURITY.md` / `cordis.patch.yml` / `src/` / `lib/` / `client/` / `skins/` / `tests/`
- [x] 包名与插件运行时 id 一致为 `workspace-tokenpet`；版本 `1.0.0`
- [x] 目录为 `modules/workspace-tokenpet`（`git mv` 自 `modules/dsh-token-pet`，历史保留）
- [x] `LICENSE` 同时保留**上游 MIT 版权行**（Copyright (c) DSH Token Pet contributors）与本项目版权行
- [x] `NOTICE` 写明「本项目 + 致谢上游」（项目名 / 仓库 / 许可 / 基线 commit `cc49233`），上游版权与许可文本**未删除**
- [x] `package.json`：`bugs.url` 指向本仓库 issues、`repository.directory` = `modules/workspace-tokenpet`、`files` 不再含 `patches`
- [x] **补丁形态已清除**：`patches/**`、`scripts/apply-customizations.*`、`scripts/upstream/**` 均不存在；`package.json` 无相关失效 scripts
- [x] `cordis.patch.yml` 为**中性部署默认层**（不含个人路径 / 称呼），entry `id` / `name` = `workspace-tokenpet`
- [x] **性质口径**：安装页性质新增「**独立项目模块**」（安装器 `kind`、客户端 `nature: 'standalone'`、`natureKey()` 识别「独立 / standalone / independent」，中英文案与品牌色徽章）——`workspace-tokenpet` 由「第三方」改标；`dsh-mermaid` 仍为「第三方」（整包引入）；上游版权、MIT 许可与致谢表述不变
- [x] README 不再含「上游与基线 / 改造清单 / 补丁应用」三节；致谢独立成节

### 素材与数据目录

- [x] **形象素材随包完整**：`modules/workspace-tokenpet/skins/` 含三套（`default` + `lina-pure` + `lina-lazy`），每套 14 个文件（`manifest.json` + 12 条动作 + `preview.webp`），合计 **42 个文件**
- [x] 运行时目录为新址 `~/.dsh/data/workspace-tokenpet/skins/<套装id>/`；安装器**新址优先**、只补缺失、绝不覆盖
- [x] **旧址迁移**：新址缺套装而旧址 `~/.dsh/data/dsh-token-pet/skins/` 有同名套装时**复制迁移**（旧址数据保留、绝不覆盖新址已有内容、单套失败不影响安装结果）
- [x] 相关常量集中在 `lib/install.js`（`PET_SKINS_PLUGIN_ID` / `PET_SKINS_SUBDIR` / `LEGACY_PET_SKINS_SUBDIR`）与 `lib/basedeck.js`（`PET_SKINS_SUBDIR`），未散落他处
- [x] README / NOTICE 与仓库实际形态一致：素材随包分发（`default` 为上游 MIT；两套自有形象未经授权不得再分发）

### 验证

- [x] `tests/lina-skins.test.mjs` 8 项全绿（直接跑模块内 `lib/` 产物，**不再需要上游克隆**）
- [x] 集成体侧：`install-test.mjs` **200 通过 / 0 失败**（[9]/[9b] 节覆盖部署与旧址迁移）、`probe-test.mjs` 136/0、`basedeck-test.mjs` 179/0、`smoke-load.mjs` 337/0
- [x] `node --check` 覆盖全部改动的 JS（含 `client/client.js`）
- [x] 本机 profile 未改动；换 id 迁移步骤已写进根 README 与模块 CHANGELOG

## 三点八、P4 能力配置页与 UI 验收（2026-09-13 增）

> 契约：`01_需求与设计/17_P4 能力配置页（读写子插件设置）接口契约与安全边界`。两路实现：宿主半 `lib/settings-api.js`（并由 `lib/api.js` 接线）+ 客户端「能力配置」页。

### 宿主半（读写子插件设置）

- [x] `GET /settings` 白名单枚举：只暴露 work-memory（**24 键**）与 experts（**12 键**）两个 ns；非白名单 ns（如 workspace-tokenpet）不出现在响应里
- [x] `POST /settings/write` 双重白名单（ns + 顶层键，**按 ns 隔离**：work-memory 的键不能写进 experts）+ revision 冲突栅栏（旧 revision → **409** `error:"conflict"`，且原值不被破坏）
- [x] 默认 **dry-run**：不传 `dryRun` 一律只回填当前值、不写盘；`dryRun:false` 才走官方 `mutate`
- [x] 同源守卫：跨站 Origin / 缺 `application/json` / 缺 Origin → **403**，且被拦下的请求零写入
- [x] 复杂类型键降级只读（写入被拒）；嵌套路径被拒（只允许顶层键）；单次条数上限
- [x] 四类降级一律 **200 + `ok:false`**、不抛异常：`settings` 缺失 / `describe` 抛错 / 子插件未装 / 空 body
- [x] 错误信息**脱敏**：本机路径抹成 `<path>`；`source` 只给枚举、不外发路径
- [x] `GET /experts/preview` 动态载入子插件打分引擎：`max=2` 时身份专家 + 等保测评（`aftersales-djbh` **0.7**）都进名单；`max=1` 时 0.7 分的对口专家被挤掉（甲案因果归因）
- [x] 自测 `scripts/settings-api-test.mjs` **109 通过 / 0 失败**，含对真实 `settings.yaml` / 记忆库 / 工作区 / 子插件源码的**只读首尾快照比对**（证明零写入）
- [x] 路由注册口径不变：prefix 路由仍 1 条、`installApi` exact 仍 8 条（既有 probe / basedeck 断言不破）

### 客户端半（能力配置页）

- [x] 记忆库 24 键五小节 / 专家库 12 键 + 四滑块 + 一下拉 + **实时预览** / 文档能力自检面板 / 桌面形象状态跳转
- [x] 已覆盖标记、`unset`（清除覆盖回默认）、**409 冲突自动重读且不丢输入**；`ConfigFieldRow` 对不在 settings schema 的字段（如 `experts.injectOrder`）**早退不渲染**（否则用户一改必被宿主 400 拒绝）
- [x] 装载冒烟 `scripts/smoke-load.mjs` **330 通过 / 0 失败**（256 → 330）

### 甲案（`expertInjectMax` 默认值 1 → 2）三处一致

- [x] `lib/settings.js` 的 `DEFAULTS`、schema 默认值、**`cordis.patch.yml` 部署层 base config** 三处齐改 —— 只改前两处会被部署层 base **盖过**（实施时抓出的真缺陷；契约原文只写两处，已补正）
- [x] 模块版本 `0.1.2 → 0.1.3` 并补 `modules/dsh-experts/CHANGELOG.md`

### 真机验收（2026-09-13）

- [x] **能力配置页**：`expertInjectMax` 显示 **2** 且无「已覆盖」徽章（甲案生效）；24+12 键可读可写；写入两次 revision 实测递增（R1→R2）；`settings.yaml` 落盘新值且**原有键与注释逐字保留**、无 `.bak-`（官方原子写路径如此）；**免重启热生效**
- [x] **UI 打磨**（真机反馈驱动）：「重新读取」加读取中态 + 「最近读取 HH:MM:SS」（首次加载也算）；能力配置页改**插件级标签**（一次只渲染当前插件）；设置页跳转修正 —— 宿主左侧导航项实际叫 **「用量小宠物」且不本地化**，候选名收敛为 `["用量小宠物","workspace-tokenpet"]`（设置分区 id 随模块 id 更名），并修掉「硬依赖 `<nav>`」（真机面板非 nav 元素）→ **跳转真机验证成功**
- [x] **桌宠热区收敛**（`287000e`）：外层容器改 `pointerEvents:none` / `cursor:default`，新增精确热区层只覆盖形象渲染框（等高等宽），`stageChip` 移出热区；**主人刷新后实测**：左右空白不再响应点击/拖动、点形象仍能开合、拖动正常
- [x] **配置引导页两缺陷**（`28e398d`）：桌面版「浏览…」改走 `window.__DSH_DESKTOP_PICK_DIRECTORY__`（原走 host `pickDirectory` 必抛 native 能力错）；第 1 步「重新检查」按阶段刷新、不再自动跳步；「浏览…」按钮 `nowrap` 修竖排。**重启后主人复验通过**
- [x] 提交推送：`e388985`(P4) · `4a3afe7` · `287000e` · `24c16d0` · `219e11a`(experts 升版) · `d20a648`(NOTICE)

## 三点九、构建产物同轨门禁（2026-09-14 增）

> 背景：`workspace-tokenpet` 独立化时，`lib/**` 与 `client/client.js` 是用**与 `src/` 一一对应的确定性字符串替换**同步的（`287000e` 起还有一处注释只改了源码、产物手工补），存在「产物与源码不同轨」的风险。2026-09-14 做过一次真实重建核对，结论与门禁如下。

- [x] **构建输入齐备**：`src/client/pet-action-sheets.generated.ts`（22.5 MB）与 `src/client/pet-asset.generated.ts`（260 KB）已入库（此前从未入库 → 干净 clone 的 `npm install` 会因 `prepare → build` 直接失败）
- [x] **宿主产物一致**：`lib/**` **26/26**（13 `.js` + 13 `.d.ts`）与真实 `tsc` 产物**逐字节一致**
- [x] **客户端产物一致**：`client/client.js` 已换为真实 `npm run build`（tsdown v0.22.14）产物；与上一版仅差 1 处注释，剥离注释后等价文本 sha256 相同
- [x] 模块版本 **1.0.1**（构建完整性；无功能变化、无 API / 数据格式变化）
- [ ] **发布门禁（每次发版前必过）**：
  ```
  cd modules/workspace-tokenpet
  npm.cmd install --ignore-scripts --no-audit --no-fund
  npm.cmd run build
  git diff --exit-code -- lib client        # 必须为空
  ```
  说明：`tsdown` 配了 `clean:true`，**构建失败会先删掉 `client/`** —— 构建前确认两个 `*.generated.ts` 在位，避免产物丢失。

## 四、宿主兼容性

- [x] 仅使用当前 host 的**原生扩展点**（tools / commands / settings / resources / sidebarRightTabs / locale / skills），不用已弃用槽位
- [x] `dsh --profile <profile> --dump-config` 退出码 0，且能看到各模块条目
- [ ] 装到干净 profile 后**重启**验证：面板可开、工具可用、日志无报错 —— ⏳ 本机 desktop profile 已多次验证；**干净 profile** 未做（需另建 profile + 重启）
- [x] **真机重启后的专家库验收**（`dump-config` 退出码 0 只是前置，以下逐条实测）——**2026-09-13 全部 5/5 通过**（15:37 重启后复验 4 项 + 跨域补位真机实测）：
  - [x] `/expert status`：**身份专家**显示正确 —— ✅ 重启后复验：`settings.yaml` 的 `identityExpert: presales-ics-security` 与注入区【身份视角·工控安全售前】一致（= 设置 `identityExpert`；留空时应取岗位域第一位）
  - [x] 注入区含 **【处理路径】+【身份视角】** 两段 —— ✅ 重启后会话注入区即为该两段（身份视角即常驻的唯一一位）
  - [x] `expertInjectMax=2` 时，**跨域命中能补上第 2 位**专家（补位受 `expertSecondThreshold` 门槛约束）——✅ **2026-09-13 真机实测通过**（使用者 `/expert why` 截图）：任务「这份采购合同的钱怎么算、税怎么处理」→ 判定理由 **`identity+1`**，**注入名单 = `presales-ics-security`（身份专家）+ `legal-civil`（补位，0.25 证据分 / 「关键词·合同、标签·合同」）**；`finance-tax` 0.2 因 max=2 只补 1 位未入。配置层（解析值 2、无「已覆盖」徽章）与引擎级（0.1.3 三档对照 + `settings-api-test` §9）此前已验
  - [x] `/expert list` 列出 **20 位**专家、6 域齐全（售前 5 · 售后 4 · 会计财务 5 · 法务 2 · 文档 3 · 核查 1）——✅ 工具等价复验：返回 20 位，域分布 5/4/5/2/3/1 完全一致
  - [x] `/expert why <文本>` 的打分理由与实际命中一致（人工抽查 1–2 条）——✅ 复验：「客户要做三级等保测评，定级备案怎么走」→ `aftersales-djbh`（等保测评）score 0.7，理由「关键词·等保/测评/定级/备案/三级 + 标签·等保/测评」，与实际命中一致

## 五、第三方合规

- [x] 内置的第三方代码/资源**许可证允许再分发**（无 LICENSE 的组件只能列为可选依赖，不得打包）
- [x] 列为可选依赖的插件在 README 中标注来源与许可证
- [x] 保留必要的来源归属与许可证文本

## 六、已知坑与运维纪律（2026-09-12 事故沉淀，必留档）

- [x] **坑①：pnpm 对 `file:` 依赖有缓存** —— 改完 `modules/<模块>/` 源码后重装，`dsh plugin add` 可能报 `Already up to date` 而**不同步**（本机已踩：源码改了、跑起来的还是旧件）。
  - 处置三步，**缺一不可**：① **删掉 profile 内该模块目录**（`~/.dsh/profiles/<profile>/node_modules/<模块>`）后重装；② **逐文件 SHA256 比对**（源码 vs 已装件，至少覆盖 `lib/` + `experts/` + `cordis.patch.yml`）；③ **重启 DSH** 才生效。
  - 注意：`pnpm-lock.yaml` / `node_modules` 缓存不会因源码 mtime 变化自动失效，不能只凭"已经重装过了"下结论。
- [x] **坑②：禁止用 PowerShell 的 `Set-Content -Encoding utf8` 修改 profile 的 JSON / `~/.dsh/settings.yaml`** —— Windows PowerShell 的 `-Encoding utf8` 会写入 **BOM**。
  - 后果：DSH 读 profile 时 `JSON.parse` 失败；YAML 报 `Nested mappings are not allowed in compact mappings`。
  - 正确做法：这类文件一律用 **Node 的 `fs`** 写（`fs.writeFileSync(path, text, 'utf8')`，明确 UTF-8、**无 BOM**）。
  - 改完自检（同样用 Node，不用 PowerShell 文本重定向）：JSON 能 `JSON.parse`、YAML 能解析、文件首字节**无 `EF BB BF`**。
- [x] **坑③：测试脚本取"今天"不要用 `toISOString()`** —— 它给的是 **UTC 日期**，而实现侧（`clock.js todayStamp()`）用**本地日期**。在 Asia/Shanghai 的 **00:00–08:00** 两者差一天：测试写 `DAILY/<UTC 日>.md`、查 `backup-<UTC 日>`，插件实际用本地日 → 相关用例在该时段**必然失败**，白天却全绿（本机已踩：work-memory 80/83；改 `todayStamp()` 后 83/83，v1.0.5）。
  - 纪律：凡"今天"**一律 `todayStamp()`**；要对齐实现日期，先确认实现用的是哪个时区。
  - **假绿比失败更危险**：同一窗口下「快照：过滤活动日志行」「备份：当日防抖 skipped」曾因文件名错位而**假通过**——测试没报错不等于在被检验。
  - 自检手法：同一套回归**换 TZ 复跑**（`TZ=UTC node scripts/regression.mjs`）结果应不变；涉及日期/防抖/TTL 的用例尤其要跑。
- [x] 上述 SHA256 比对与 BOM 自检的结果记入本次发布/升级记录（出问题可回溯到具体文件）。

## 七、P5 发布收尾（2026-09-13）

- [x] 仓库根 `NOTICE` 已写（4398B：随包内容 / 第三方来源与许可 / 免责 / 未随包清单）
- [x] `dsh-experts` 升版 **0.1.3** + 模块 `CHANGELOG.md`（默认注入上限 1 → 2）
- [x] **CI 覆盖补全**：本体四套自测（probe / install / basedeck / settings-api）纳入 `*/scripts/*-test.mjs` 步骤；补入当轮即修掉探针测试的 9 项平台断言缺陷，CI `e4943c7` 双版本 success
- [x] 本清单更新（勾掉已验项 + 补 P4 / 桌宠热区 / 配置引导页 / 设置页跳转验收）
- [ ] **打 tag `v1.0.0` + GitHub Release** —— 对外动作，**等使用者确认**；Release 正文取根 `CHANGELOG.md` 的 v1.0.0 段
- [ ] **干净 profile 重启验证** —— 需另建 profile + 重启（本机 desktop profile 已多次验证）
- [x] **`expertInjectMax=2` 真机跨域补位观察** —— ✅ 通过（2026-09-13 真机截图：注入名单 `presales-ics-security` + `legal-civil`，理由 `identity+1`）
