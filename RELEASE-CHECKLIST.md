# 发布检查清单（work-personal-secretary）

> 每次发布/交付前逐项打勾；任何一项不满足就不发。宿主基线：**DSH Desktop 2.0.9 / host `dsh 0.1.5-rc.1`**（升 DSH 后先重跑本清单）。
>
> 集成体含**四个子模块**：`dsh-work-memory` v1.0.3、`dsh-doc-suite` v0.1.1、`dsh-experts` v0.1.1（2026-09-12 新增）、`dsh-token-pet` v0.2.1-lina.1（2026-09-13 新增，**三方插件定制层**）；前三者已实装本机 desktop，桌宠为 `link:` 装机。

## 一、默认约定必须随包生效（2026-09-11 定）

- [ ] **语言**：默认「**尽量**使用简体中文回答与思维」（推理痕迹也尽量用简体中文；代码/命令/路径/包名/API/日志原文/专有名词保留英文，不硬翻）
  - [ ] `defaults/global-memory.seed.md`（**全局记忆种子**）存在，含语言偏好条目
  - [ ] `defaults/AGENTS.zh-CN.md`（**工作区指令模板**）存在，含《语言》段
  - [ ] 根 README「默认约定」段写明该默认，并指向 `defaults/`
- [ ] **运行架构**：总控兼读制写进默认约定（主对话轻量：拆解/派单/核对/监督/纠正/对外沟通；重活交专家子代理）
- [ ] **敏感行业例外**：军工/商密/烟草/数据安全类内容由主上下文直接处理、不派子代理（红线，随包默认）

## 二、中立与隐私（发布件不得夹带私人信息/身份）

- [ ] **不得出现任何个人化身份**：私有助手名（如本机自用名）、"主人/主人级"等私有称呼、个人邮箱/账号
  - 检索方式：`git grep -n -i -e '<私有名>' -e '主人'`，命中项须为通用表述（使用者/助手）
- [ ] **不得出现私有路径**：`E:\...`、`~/.dsh/memories/<私有名>`、个人 Obsidian 目录等；默认路径必须通用（如 `~/.dsh/memories/work-memory`）
- [ ] `cordis.patch.yml` 及各模块默认配置**中性**：无个人路径、无称呼
- [ ] 个性化只走**设置页用户层**（不写进包内默认层）
- [ ] 包内**不含任何记忆数据**（首装记忆为空，人设由首轮对话填充）
- [ ] README 写清：本地 / 明文 / 不联网 / 无遥测；安装、首次使用、卸载与数据留存三段齐全

## 三、工程门禁

- [ ] 全部 JS `node --check` 通过
- [ ] 全部 Python 脚本 `py -3 -m py_compile` 通过（`modules/dsh-doc-suite/`）
- [ ] 各子项目回归全绿（`node modules/<模块>/scripts/regression.mjs`）
- [ ] **`dsh-experts` 三套自测全绿**——三套**均不依赖宿主运行时**（缺 host peer 时自动降级），可脱离 DSH 独立跑：
  - [ ] `node modules/dsh-experts/scripts/regression.mjs` —— **25 项**：索引完整性（20 位 / 6 域 / 字段齐全 / id 唯一 / 域合法）、persona 体量（正文存在、含三段固定标题、字数区间）、匹配打分（岗位先验 / 关键词 / 显式指定 / 跨域 Top-2 门槛 / 同域不叠加 / 阈值卡关）、注入组装（标题、超长截断并标注、空 persona 不产出）
  - [ ] `node modules/dsh-experts/scripts/smoke-load.mjs` —— **18 项**：mock cordis ctx **真调 `apply()`**，验「注册了什么」与「注入回调返回什么」；`@deepseek-ai/schemastery` 缺失时**动态导入降级**（跳过设置命名空间注册并打印提示，其余功能照常）
  - [ ] `node modules/dsh-experts/scripts/coexist.mjs` —— **7 项**：与 `dsh-work-memory` 挂同一 ctx 的**共存契约**（注入顺序 480 → 500、两条回调互不覆盖、合并上下文含「专家视角 + 记忆」、工具/命令不重名）；无宿主依赖时走**契约模拟**路径，且**明确打印所走路径**（不假装真加载）
- [ ] CI 在 Node 22 与 24 双版本通过
- [ ] 客户端有改动的模块**已升版本号**（DSH 客户端 bundle 按 revision 缓存）
- [ ] 打包白名单（`files`）覆盖 lib / client / scripts / skills / experts / cordis.patch.yml / CHANGELOG / LICENSE / NOTICE / README
- [ ] `CHANGELOG.md` 记录本次变更（含破坏性变更与迁移说明）

## 三点五、文档模块硬前置与路径（2026-09-12 增）

- [ ] README 明写 `dsh-doc-suite` 的两条**硬前置**：**Python ≥ 3.10**（建议 3.12，Windows 用 `py -3`）+ **WPS Office**（COM 通道）
- [ ] 明确声明**不自动安装**解释器与 WPS；缺什么由 `doctor.py` 检测并打印可复制的修复命令
- [ ] `modules/dsh-doc-suite/skills/*/SKILL.md` 中**不得出现作者机器绝对路径**（形如 `<盘符>:\<个人工作区>\scripts\...`）；
      统一使用占位符 `<DOC_SUITE_SCRIPTS>`，解析方式写进技能与 README（`doctor.py --emit-skill-paths`）
- [ ] 技能含**子命令速查表**（位置参数 vs 选项参数易错点：`convert <src> <dst>` 无 `--to`、`merge/make` 输出在前等）
- [ ] `doctor.py` 在本机跑通且结论为「环境就绪」（`/doc-doctor` 同源）

## 三点六、专家库模块（dsh-experts，2026-09-12 增）

### 来源与许可

- [ ] `NOTICE` 齐备：列上游项目、许可证类型，并保留必要许可文本
- [ ] `experts/index.json` **每条专家**都有 `source`（记 `repo` / `path` / `license` / `adapted`）——**无许可靠来源不得收录**
- [ ] 自撰条目诚实标注 `source.origin: "self-authored"`（不假称来自上游）
- [ ] 许可口径与索引一致（本机实核 20 条：MIT 17 · Apache-2.0+MIT 双许可 2 · Apache-2.0 1；自撰 1 条 `doc-office`）
- [ ] Apache-2.0 来源随包保留版权与许可文本，并在改写处**声明已修改**（Apache-2.0 要求）

### `review: pending` 机制（待专业复核）

- [ ] 安全域 6 位 + 法务 2 位，共 **8 条**保持 `source.review: "pending"`，**不得被表述为已复核**
- [ ] README / NOTICE 说明 pending 的含义：**未经专业复核**——只作专业参考视角，**不得据此出具测评结论或法律意见**，对外交付前须人工复核
- [ ] 复核通过后同时改 `index.json` 的 `review` 字段并记 `CHANGELOG`（禁止只改文档、不改数据）

### 工具与命令契约

- [ ] `expert_recall` 工具定义符合官方契约：`parameters` 用 **DSH DSL** 声明；`output` = **`{ schema, render }`**（execute 返回结构化对象，`render` 负责显示）——不得沿用旧形态
- [ ] `/expert` 命令返回体为 **`{ kind, text }`**（`kind` 覆盖 listing / persona / match / no-match / success / error）
- [ ] 未知 id、persona 文件缺失时返回**结构化错误**（`ok:false` + 明确提示），**不抛异常**
- [ ] persona 超长（`PERSONA_MAX_CHARS` = 3000）时**截断并标注**，不静默丢弃

### 身份专家与问题归属流程

- [ ] 常驻注入**只有一位**「身份专家」（设置项 `identityExpert`；留空取岗位域第一位）——发布件不得写成"多位专家常驻"
- [ ] 其余专家按**问题归属判断**补位：命中单一 → 按该专家视角原生处理；**跨领域/需独立作业 → 派子代理**（`expert_recall` 取 persona 后**内联进 `subagent.prompt`**）；未命中 → **原生处理**（宁缺勿滥，不硬套视角）
- [ ] `enabledDomains` / `enabledExperts` 只**收窄**"参与自动匹配"的集合，不改变上述流程
- [ ] 敏感行业（军工/商密/烟草/数据安全）仍**主上下文直接做、不派子代理**（与第一节红线一致）

### 注入上限与 TOKEN 提示

- [ ] `expertInjectMax` 默认 **1**、可调 **2 / 3**（硬上限 3）；**>1 时设置页必须提示占用较多 TOKEN**
- [ ] `expertSecondThreshold`（默认 0.8）确实约束第 2/3 位——其分数 ≥ 第 1 位 × 该值才补位
- [ ] `expertMinScore`（默认 0.35）为命中下限，低于下限走原生处理
- [ ] 设置项齐全且默认值正确：`expertsEnabled` / `defaultDomain` / `identityExpert` / `enabledDomains` / `enabledExperts` / `expertInjectMax` / `expertSecondThreshold` / `expertMinScore` / `expertShowBanner`（另有一项 `expertSetupDone` 安装引导完成标记，由引导自动写入）
- [ ] 注入块标题固定为 **【处理路径】+【身份视角·…】**（命中/临时注入时另有【本轮命中·…】/【临时注入·…】）

## 三点七、桌宠定制层（dsh-token-pet，2026-09-13 增）

> 性质特殊：**不是自研模块，而是三方插件（MIT）的定制层**——以补丁维护，**不 vendor 整包、不 vendor 素材**。

### 结构与来源

- [ ] 模块结构齐备：`README.md` / `CHANGELOG.md` / `LICENSE` / `NOTICE` / `cordis.patch.yml` / `patches/` / `scripts/` / `tests/`
- [ ] `patches/0001-lina-customizations.patch` 存在，且 `patches/UPSTREAM-BASE.txt` 记录**基线 commit**（当前 `cc49233` / 上游 v0.2.0）
- [ ] `LICENSE` = 上游 MIT 全文（Copyright (c) DSH Token Pet contributors），**未经改动**
- [ ] `NOTICE` 写明上游项目与仓库、基线 commit、许可类型，以及**本定制层的改造边界**（只改源码；上游版权声明一律保留）
- [ ] 版本号与上游可区分：`0.2.1-lina.1`（形如 `<上游版本>-lina.<n>`）
- [ ] `cordis.patch.yml` 为**中性部署默认层**（不含个人路径/称呼）

### 补丁质量

- [ ] **补丁可干净应用**：`scripts/apply-customizations.ps1 -Target <克隆> -Check` 通过
- [ ] **应用后与装机工作区一致**（逐文件 SHA256 比对，防补丁漏文件）
- [ ] 补丁**不含个人绝对路径、称呼、凭据**（集成体第二节红线）
- [ ] `README.md` 的改造清单与补丁实际内容一致（当前 12 个文件）

### 素材与体积

- [ ] **形象素材不入库**：仓库内**不得**出现 `.webp` 条带、上游 `assets/` 素材、或 `src/client/*.generated.ts` 等内嵌素材生成物
- [ ] 模块体积与同级模块相当（当前 ≈ 82 KB；若骤增多为误加了素材/构建产物）
- [ ] README 写明素材位置 `~/.dsh/data/dsh-token-pet/skins/<套装id>/`，并声明**属私有资产、不随包分发**

### 验证与升级纪律

- [ ] 回归测试**在应用补丁并 build 后的克隆目录**执行（`node tests/lina-skins.test.mjs`，8 项）——依赖上游构建产物 `lib/skins.js`，**CI 不跑它**
- [ ] 集成体 CI 不因本模块失败（本模块不含 `scripts/regression.mjs` / `smoke-load.mjs` / `coexist.mjs`）
- [ ] 上游升级后**重新应用补丁并复跑测试**，冲突按补丁意图手工合并，同时更新 `UPSTREAM-BASE.txt` 与 `CHANGELOG`

## 四、宿主兼容性

- [ ] 仅使用当前 host 的**原生扩展点**（tools / commands / settings / resources / sidebarRightTabs / locale / skills），不用已弃用槽位
- [ ] `dsh --profile <profile> --dump-config` 退出码 0，且能看到各模块条目
- [ ] 装到干净 profile 后**重启**验证：面板可开、工具可用、日志无报错
- [ ] **真机重启后的专家库验收**（`dump-config` 退出码 0 只是前置，以下逐条实测）：
  - [ ] `/expert status`：**身份专家**显示正确（= 设置 `identityExpert`；留空时应取岗位域第一位）
  - [ ] 注入区含 **【处理路径】+【身份视角】** 两段（身份视角即常驻的唯一一位）
  - [ ] `expertInjectMax=2` 时，**跨域命中能补上第 2 位**专家（补位受 `expertSecondThreshold` 门槛约束）
  - [ ] `/expert list` 列出 **20 位**专家、6 域齐全（售前 5 · 售后 4 · 会计财务 5 · 法务 2 · 文档 3 · 核查 1）
  - [ ] `/expert why <文本>` 的打分理由与实际命中一致（人工抽查 1–2 条）

## 五、第三方合规

- [ ] 内置的第三方代码/资源**许可证允许再分发**（无 LICENSE 的组件只能列为可选依赖，不得打包）
- [ ] 列为可选依赖的插件在 README 中标注来源与许可证
- [ ] 保留必要的来源归属与许可证文本

## 六、已知坑与运维纪律（2026-09-12 事故沉淀，必留档）

- [ ] **坑①：pnpm 对 `file:` 依赖有缓存** —— 改完 `modules/<模块>/` 源码后重装，`dsh plugin add` 可能报 `Already up to date` 而**不同步**（本机已踩：源码改了、跑起来的还是旧件）。
  - 处置三步，**缺一不可**：① **删掉 profile 内该模块目录**（`~/.dsh/profiles/<profile>/node_modules/<模块>`）后重装；② **逐文件 SHA256 比对**（源码 vs 已装件，至少覆盖 `lib/` + `experts/` + `cordis.patch.yml`）；③ **重启 DSH** 才生效。
  - 注意：`pnpm-lock.yaml` / `node_modules` 缓存不会因源码 mtime 变化自动失效，不能只凭"已经重装过了"下结论。
- [ ] **坑②：禁止用 PowerShell 的 `Set-Content -Encoding utf8` 修改 profile 的 JSON / `~/.dsh/settings.yaml`** —— Windows PowerShell 的 `-Encoding utf8` 会写入 **BOM**。
  - 后果：DSH 读 profile 时 `JSON.parse` 失败；YAML 报 `Nested mappings are not allowed in compact mappings`。
  - 正确做法：这类文件一律用 **Node 的 `fs`** 写（`fs.writeFileSync(path, text, 'utf8')`，明确 UTF-8、**无 BOM**）。
  - 改完自检（同样用 Node，不用 PowerShell 文本重定向）：JSON 能 `JSON.parse`、YAML 能解析、文件首字节**无 `EF BB BF`**。
- [ ] **坑③：测试脚本取"今天"不要用 `toISOString()`** —— 它给的是 **UTC 日期**，而实现侧（`clock.js todayStamp()`）用**本地日期**。在 Asia/Shanghai 的 **00:00–08:00** 两者差一天：测试写 `DAILY/<UTC 日>.md`、查 `backup-<UTC 日>`，插件实际用本地日 → 相关用例在该时段**必然失败**，白天却全绿（本机已踩：work-memory 80/83；改 `todayStamp()` 后 83/83，v1.0.5）。
  - 纪律：凡"今天"**一律 `todayStamp()`**；要对齐实现日期，先确认实现用的是哪个时区。
  - **假绿比失败更危险**：同一窗口下「快照：过滤活动日志行」「备份：当日防抖 skipped」曾因文件名错位而**假通过**——测试没报错不等于在被检验。
  - 自检手法：同一套回归**换 TZ 复跑**（`TZ=UTC node scripts/regression.mjs`）结果应不变；涉及日期/防抖/TTL 的用例尤其要跑。
- [ ] 上述 SHA256 比对与 BOM 自检的结果记入本次发布/升级记录（出问题可回溯到具体文件）。
