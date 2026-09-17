# CHANGELOG · work-personal-secretary（集成体本体）

## 1.1.4 — 2026-09-17（随包说明补齐 · 文档-实现一致性修复 · 模块说明）

- **随包说明重写（面向使用者视角 · 2026-09-17 第二轮）**：主人指出原稿偏技术、且安装缺「不想敲命令的人怎么装」这条路 → `install.zh-CN.md` 重写为**新用户指引**（88 → 211 行）：新增「先弄清楚装什么、装完能做什么」「动手前确认三件事」「**两种安装方式并列**」（方式一＝复制一段提示词交给 DSH、由它安装；方式二＝手动敲命令）、依赖与环境安装同样双路径（Python / 八个包 / WPS 各给两种）、装完六项自查表、七条排障；`use.zh-CN.md` 重写为**非技术读者版**（59 → 247 行）：每个能力给「以前怎么做 / 现在怎么做」对照与可直接照说的例句、按功能分组讲设置项、十二条 Q&A、数据留存与卸载。两份 HTML 由 `scripts/build-defaults-html.mjs` 重生成（`defaults-test` 59/0）。

- **随包说明补齐（第一轮）**：`defaults/use.zh-CN.md` 新增「四、目录与镜像」（存储根派生 / 目录选择三条路 / 导入卡只管知识库 / 镜像何时被填 / 工具目录只有框架）；`defaults/install.zh-CN.md` 新增「六、升级与排障」（子插件升级走临时目录+SHA256+原子替换 / 记忆库换目录免重启需 work-memory ≥1.0.6 / 七套自测脚本）；HTML 按 md 重生成（`defaults-test` 59/0）。

- **文档-实现一致性**（本轮核查逐条修）：`defaults/global-memory.seed.md` 的【专家库】条目仍写「常驻只有一位身份专家」→ 改「默认一位都不常驻」；`lib/index.js` 的 `SUB_PLUGINS` 同口径修正；`lib/api.js` 路由计数注释 17/18 → **22/23**（2026-09-17 复核）；`lib/basedeck.js` 注释「basedeck 自己不读 settings.yaml」与实现矛盾 → 改「两条口径并存」；`.github/workflows/ci.yml` 的通过数注释 → 指向 `TEST-MATRIX.md` 并写 2026-09-17 实测值。

- **新增**：`ARCHITECTURE.md`（维护者向：架构 / 数据流 / 对外接口 / 回退与恢复）；根 `TEST-MATRIX.md`；`package.json` 补 `test` 脚本。

- ⚠️ 需重启 DSH（`lib/**` 与 `defaults/**` 变更）。

## 1.1.3 — 2026-09-16（设置界面改版）· ⛔ **本版不发布**

> **发布状态（2026-09-17 主人裁定）**：本版**不发布**。代码与文档已完成、七套脚本全绿，迭代过程中也做了真机验收，但主人判定「目录模型这次只定义为测试」，本机不采用新布局、工作区整体重建留待另择时间做。
> **本节之下的内容按「已实现但未发布」读取**：接口与行为描述与代码一致（提交见 `git log`，`main` 分支未打 tag、未推送），只是不作为发布版对外。

### 变更

- **客户端四页签**：安装与检查 / 核心配置 / 配置 / 关于与致谢；「能力配置」改名「配置」（英文 Settings）；删掉四步进度条；首屏描述改写为「检查运行环境、安装五个子插件、完成首次配置，并集中调整各子插件的设置」。
- **安装与检查页**：「查看安装引导 / 使用说明」按钮组置顶；环境依赖 6 项 + 子插件 5 项；新增「依赖安装工具」卡（逐项 `POST /fix`、兜底 `POST /fix-all`、不可代执行项只给复制命令、WPS 许可提示）。主按钮的「N 项待处理」只计硬项（DSH 宿主 / Node.js / Python / Python 依赖 / WPS Office），Obsidian 标「可选」，未装不再计入待处理。
- **核心配置页（新）**：三项门禁 —— 记忆库子插件已装 · Python ≥ 3.10 · 8 个 pip 包（记忆库目录**不参与**判定）；不满足时整页灰化并逐项给出状态，满足后自动解锁。
  字段改为**存储根目录**（使用者唯一要先选的目录，唯一必填、带「浏览…」）+ **由它派生的**记忆库目录与 Obsidian 知识库目录（默认只读、标注「自动：存储根目录/」；点「单独指定」才可编辑，编辑后可点「跟随根目录」回到派生值）+ 工作岗位（5 个预置岗位 +「都不是（新建岗位…）」，无「通用职能」）。
  派生子目录名 `memory-data` / `obsidian-data` 由宿主 `lib/basedeck.js` 的 `ROOT_SUBDIR_MEMORY` / `ROOT_SUBDIR_VAULT` 定义，经 `GET /setup-state` 的 `rootSubdirs` 下发（客户端不硬编码）。既有配置若不是这套布局，根目录留空、两个目录原样显示为「已单独指定」，**绝不改写使用者路径**。
  点「保存配置并开始」执行**六步链**：可用性检查（只读 preflight）→ **迁移旧记忆库** → 建立记忆库目录（memoryDeck）→ 建立知识库目录（knowledgeDeck）→ 建立两者关联（写 `settings` 的 memoryDir 与 obsidianSyncDir=`<obsidianDir>/00_全局记忆`）→ 写入岗位身份。
  **迁移在建立结构之前**：迁移逐文件只补缺失、目标已有同名文件一律保留目标，先建库会先写出 `MEMORY.md` / `USER.md` / `GRAPH.json` / `PROJECTS/工作秘书.md`，迁移随即把这四个全部跳过（实测：目标为空 copies=4；先建库后 copies=1 / conflicts=3）。
  任一步失败停在该步、保留已完成成果、可幂等重试；六步全绿后出现**旧知识库**导入引导卡（该卡**只管知识库** —— 记忆体已在第 1 步自动迁完，卡上不再提，避免「记忆还要再搬一次」的错觉）。目录模型为「一个存储根目录 + `memory-data` / `obsidian-data` 两个兄弟目录」；**知识库只新建、不搬迁**（已有 vault 原样不动，要搬须使用者逐项指定对照；导入引导卡目前只有入口 + 纪律说明 + 清单占位），**只有记忆体自动迁移**。
- **配置页按决议 12.1 收窄**：记忆库 5 常显 + 8 高级、专家库 5 + 5、文档能力 4 + 5；**未放出的 22 键不再渲染**（仍在 `settings.yaml` 与 profile 覆盖层可配）。草稿与 409 保留输入的机制不变。
- **宿主侧新增能力**：
  - `lib/basedeck.js` 新增两个结构生成器 —— `memoryDeck`（记忆体结构：PROJECTS / DAILY / ARCHIVE 骨架 + `MEMORY.md` 的「使用者身份」占位 + USER.md / GRAPH.json + `PROJECTS/工作秘书.md` 四条）与 `knowledgeDeck`（知识库结构：🏠 主页.md + 00_全局记忆 + 工具/（`00_工具总览.md` + 技能 / 脚本 / MCP）+ .obsidian 最小配置；**`工具/` 本版只建目录与总览，未实现同步** —— 三个子目录现在是空的，总览里写的是预留用途，自动同步未立项，见仓库根 README）；只补缺失、不覆盖，写前备份、写后校验、失败回滚。
  - `GET|POST /work-personal-secretary/api/preflight`：可用性检查（只读）—— 环境就绪 / 两目录路径合法可写 / 同工作区 / 目标无冲突。**「目标无冲突」只提示、不阻断**（`block` → `warn`，与「跨盘」同口径，不参与 `ready` 判定）；按 `relationOf` 的三个方向分开给文案（`same` / `memory-in-obsidian` / `obsidian-in-memory`，另加相互独立的 `separate`），每条都写明后果与「不阻断」。执行链把 `warn` 项一并带进成功步骤的详情。
  - `GET /identity`、`POST /identity/save`：把岗位整条写入「使用者身份」条目（按正文前缀定位；命中 0 条追加、1 条改写并保留原 id、多于 1 条拒绝）；与 `dsh-work-memory` 共用 `.work-memory.lock`；改写按区间切片替换，写后逐字节校验其余内容未变；含「助手人设」的条目不动。
  - `GET /domain/list`、`POST /domain/generate`：5 段预置岗位身份正文 + 生成通道（`promptEnhancer` 优先 → 回退 `llm` + `agentDefaultModel` → 都没有时 503 可读提示，前端改为手填）；`purpose` 为 `work-personal-secretary-domain`。
  - `GET /setup-state`：核心配置页的宿主侧初值（既有 memoryDir / obsidianDir / domainId 等），并**反推「存储根目录」**（两个目录正好是同一父目录下的 `memory-data` / `obsidian-data` 时才给，推不出留空）；`rootSubdirs` 在这里下发。
  - `GET /dirs`、`POST /dirs/new`：目录浏览 —— `ctx.directoryPicker` 的 browse / native 能力分支代理；`GET` 列一层目录、`POST` 在父目录下建一层子目录；native / 缺服务 / 未知能力都是**可读降级**（不抛异常、不 500）。
  - `GET /docs`、`POST /open-doc`：随包说明 HTML 的取回与「用系统默认程序打开」（脚本白名单查表，**不接受路径入参**）。
  - `lib/md.js`：Markdown → HTML（零依赖、输出转义、链接白名单；拒绝 `javascript:` 与 `//` 协议相对地址）。
- **随包说明网页**：`GET /work-personal-secretary/guide`（安装引导）与 `/help`（使用说明）直出 HTML；正文与 `defaults/install.zh-CN.md`、`defaults/use.zh-CN.md` **单一真相源**（同一份 md 也写入 `PROJECTS/工作秘书.md` 的前两条）。新增 `?embed=1` 片段形态（无 html / head / body，样式作用域到 `.wps-doc`），供设置页页内展开；不带 `embed` 仍是完整文档。
- **行为变更（调用方注意）**：`GET/POST /work-personal-secretary/api/basedeck` 的 `items` 由 **5 项变为 8 项**（末尾追加 `memoryDeck` / `knowledgeDeck` / `migrateMemory`，既有五项顺序不变）；**不带 `ids` 的缺省调用现在会写 8 项**（旧行为只写 5 项）。若调用方依赖旧缺省集合，请显式传 `ids`。
- **同版审查返工**：身份写入的「其余条目逐字未变」校验不再恒真（改为区间切片 + 逐字节比对）；写记忆库目录的路径统一取 `.work-memory.lock`（含既有记忆种子写回）；所有落盘路径统一走写目标护栏（拒绝用户主目录 / 非绝对路径 / 不可写 / 同名文件占用）；`GET /identity` 补只读同源守卫并把可读范围限制为配置的记忆库目录或其子路径；临时文件加随机后缀；`md.js` 拒绝 protocol-relative；同步锁等待上限收紧到 1 秒并新增异步锁（等待时让出事件循环）。
- **桌面外壳兼容**：新增的 JSON 路由与 P4 三条能力配置路由已注册为**精确路由**（exact），桌面载体（合成 origin）的 fetch 桥下不再 404；**精确路由集合 22 条 + 1 条 prefix（`apply()` 注册总数 23）** —— 出处 `lib/api.js` 顶部注释：`API_PATHS`(7) + `PAGE_PATHS`(2) + `CORE_API_EXACT_PATHS`(10) + `SETTINGS_API_PATHS`(3)。属内部接线，接口路径与响应体均未变。

### 验证

- `node --check` **12 个文件 0 失败**（覆盖范围 = `package.json` 的 `scripts.check`：`lib/` 的 index · probe · api · install · basedeck · md · preflight · identity · domain · setup-state · dirs ＋ `client/index.js`）
- `scripts/smoke-load.mjs` **513 通过 / 0 失败** · `scripts/probe-test.mjs` **149 / 0** · `scripts/install-test.mjs` **244 / 0** · `scripts/basedeck-test.mjs` **415 / 0** · `scripts/settings-api-test.mjs` **112 / 0** · `scripts/identity-test.mjs` **64 / 0**（本版新增） · `scripts/defaults-test.mjs` **59 / 0**（本版新增，含随包说明的敏感过滤自检） · `modules/dsh-work-memory/scripts/regression.mjs` **87 / 0**
- 安装到 profile 后需**重启 DSH** 才加载宿主侧改动；客户端改动刷新页面即可。

> 注记：本段**之下**仍保留 `## 1.2.0 — 未发布` 段。**2026-09-17 定稿：1.1.3 与 1.2.0 均不发布**，版本脉络不再有争议；将来若要发布，先决定这两段如何合并或先后发布。

## 1.2.0 — 未发布（子模块独立化：桌宠 → `workspace-tokenpet`）

### 变更（破坏性）

- **子模块换名换 id**：`modules/dsh-token-pet` → `modules/workspace-tokenpet`；包名与插件运行时 id 统一为 `workspace-tokenpet`；版本 `0.2.1-lina.1` → `1.0.0`。安装器白名单（`SUB_PLUGIN_IDS`）、探针（`SUB_PLUGIN_NAMES`）、本体模块清单（`SUB_PLUGINS`）、客户端安装顺序与安装元数据、设置页跳转分区 id（`CFG_PET_SECTION`）同步更名。
- **运行时数据目录**：新址 `~/.dsh/data/workspace-tokenpet/skins/`（新址优先、只补缺失、绝不覆盖）；新增**旧址迁移** —— 新址缺套装而旧址 `~/.dsh/data/dsh-token-pet/skins/` 有同名套装时复制迁移，旧址数据保留、单套失败不影响安装结果。
- **`lib/install.js`**：`deployPetSkins()` 增加 `legacyDir` 入参与 `migrated[]` 结果字段，安装回显新增「已从旧址迁移 N 套」；`describePetSkins()` 一并展示。常量集中于 `lib/install.js` 与 `lib/basedeck.js`。
- **`lib/basedeck.js`**：`PET_SKINS_SUBDIR` 指向新址（配置底座报告/创建的素材目录随之更新）。
- **能力配置页**（`client/index.js`）：专家库小节新增 `expertInjectDetail`（下拉 auto / card / full）与 `expertInjectBudgetChars`（滑块 200–4000），中英文字典同步；`select` 渲染支持字段自带选项；`lib/settings-api.js` 的 `EXPERTS_CONFIG_FALLBACK` 补齐两键。
- **性质口径**：新增第三种性质「**独立项目模块**」（安装器 `kind`、客户端 `nature: 'standalone'` + `natureKey()` 第三态、中英文案与品牌色徽章），`workspace-tokenpet` 由「第三方」改标；`dsh-mermaid` 保持「第三方」（整包引入）。上游版权 / MIT 许可 / 致谢表述不变。

### 验证（2026-09-14）

- `scripts/install-test.mjs` **200 通过 / 0 失败**（新增 [9b] 节 9 项：旧址迁移 / 旧址数据保留 / 新址不覆盖 / 回显 / 二次安装不重复）
- `scripts/probe-test.mjs` 136/0 · `scripts/basedeck-test.mjs` 179/0 · `scripts/smoke-load.mjs` 337/0
- `scripts/settings-api-test.mjs` **109 / 0**（并行工作线为 `dsh-experts` 新增两项设置后本模块已同步：`EXP_SCHEMA` 夹具补齐两键、schema 键数断言 10 → 12、`EXPERTS_CONFIG_FALLBACK` 增加 `expertInjectDetail` / `expertInjectBudgetChars`）
- `modules/dsh-experts/scripts/regression.mjs` 27/0 · `injection-tier-test.mjs` 16/0 · `smoke-load.mjs` 18/0 · `coexist.mjs` 7/0
- `node --check` 覆盖全部改动的 JS；全模块 JS 语法自检通过（57 文件 0 失败）

### 契约对齐（2026-09-15 · dsh-experts 0.3.x）

CI「集成体本体自测」在 `scripts/settings-api-test.mjs` 停红（103 通过 / **6 失败**）：这 6 条断言仍是 dsh-experts **0.2.x** 口径 —— 旧 6 域（`presales`/`aftersales`）已重划为 5 个行业域 + 1 个通用职能域，打分 v3 删 `expertMinScore`、岗位先验降为「同证据时的排序」，身份退场（`identityExpert` 留空 = 不常驻）。**本次只改测试夹具与断言，不动任何产品逻辑。**

- **[9] 打分预览**：身份专家 id `presales-ics-security` → `infosec-ics-security`；命中专家 `aftersales-djbh`（0.7）→ `infosec-djbh` **0.95**（＝岗位域 0.35 + 关键词 0.6，打分 v3 实测）；`max=1↔2` 因果对照用有效 id 重放（`max=2` → `identity+1`，`max=1` → `identity+0`）；新增「身份留空 → 只注入关键词命中的 `infosec-djbh`（`top1`）」一条，锁住 0.3.0 的**身份退场 + 零命中不注入**。
- **[9] 夹具**：`EXP_SCHEMA` 与 mock 值对齐 0.3.2（`defaultDomain` `presales` → `infosec`、`expertInjectBudgetChars` 1400 → 2000、移除 0.3.0 已删除的 `expertMinScore`）；`config` 断言只核对仍在生效的 `expertInjectMax` / `expertSecondThreshold`。
- **[12] 静态核对**：experts schema 键数断言 **12 → 16**（目录段 / 纪律块 / 能力层指针四项已入 schema）；新增 `DEFAULTS.defaultDomain = 'infosec'`、`DEFAULTS.identityExpert = ''` 两条锚点；`limits.js` 的 clamp 断言由「正则匹配源码」改为**动态 import 行为刻度**（`0=不限` / 负数回落默认 2 / 硬上限 3）。
- **验证（2026-09-15 · 本机）**：`settings-api-test.mjs` **112 通过 / 0 失败**；本体五套（probe 136 · install 244 · basedeck · settings-api 112 · smoke 337）全 0 失败；experts 回归 46/0 · 注入分级 16/16 · 能力层 8/0 · 装载冒烟 18/18 · 共存 8/0；work-memory 回归 83/0；`node --check` 全量 JS 0 失败。
- **本次未修正（另挂待办）**：本体侧仍留 0.2.x 口径 —— `lib/settings-api.js` 的 `EXPERTS_CONFIG_FALLBACK`（`defaultDomain: 'presales'`、`expertInjectBudgetChars: 1400`、已废弃的 `expertMinScore: 0.35`）、能力配置页 `client/index.js`（岗位域下拉仍是旧 6 域、schema 镜像含 `expertMinScore`、提示文案写「默认 1400」「如 presales-ics-security」）与 `smoke-load.mjs` / `basedeck-test.mjs` 夹具里的旧 id。属「能力配置页契约对齐」单独一单，不在本次 CI 修复范围。

### 未执行（硬边界）

- 不 `git commit` / `git push`；不改本机 profile（`~/.dsh/profiles/desktop/` 的 `package.json` 与 `node_modules` 一律不动）。
- 换 id 的实际迁移由主人执行：卸载旧 id → 安装新 id → 确认素材目录（见根 README 与本模块 3.7 节）。

## 1.1.2 — 2026-09-16（文档能力页的技能清单补上 media-gen）

- 「文档能力」组的落盘清单原为**硬编码四个**（office-word / office-excel / office-ppt / pdf-tools），漏了新技能 **media-gen** → 清单与标题改为**五个**（\`CFG_DOC_SKILLS\` + 中英文案 \`五技能落盘\` / \`Five skills on disk\` + 新标签 \`媒体素材\` / \`Media assets\`）
- 说明：该清单目前**只列名称**（自检结果由文档模块给出），本次仅补齐遗漏；「改成动态读自检结果」留作后续可选项
- 验证：\`node --check client/index.js\` · \`smoke-load\` **336/0** · 需重启 DSH 后可见

## 1.1.1 — 2026-09-16（能力配置页：文档能力组接入生图设置）

- **背景**：使用者反馈「文档能力」页看不到生图设置。该组原先只渲染自检面板，而集成体的设计意图本就是**把五个子插件的设置集中到这个分区**（见 §§client/index.js§§ 的 cfgLead）。
- **根因（三处）**：
  1. 宿主 ns 白名单只有 §§work-memory§§ / §§experts§§；
  2. 客户端 §§CFG_GROUPS§§ 没有 docs 的 ns 映射；
  3. 宿主写入校验**只接受顶层键**（原文"不接受嵌套路径"），而 dsh-doc-suite 当时用的是**嵌套** §§media.*§§。
- **本次改动**：
  - 宿主 §§lib/settings-api.js§§：ns 白名单加 §§dsh-doc-suite§§，标题加「文档能力」
  - 客户端：§§CFG_FIELD_META§§ 加 11 个媒体设置键元信息；新增 §§CFG_DOC_GROUPS§§（生图 / 生视频 / 密钥与端点三组）；§§CFG_GROUPS§§ / §§CFG_NS_TITLE_KEY§§ / §§CFG_NS_LEAD_KEY§§ / §§CFG_NS_LIST§§ 接入；docs tab 改为「**设置卡 + 自检面板**」两段；中英各补 21 条文案
  - 配套：§§dsh-doc-suite§§ **0.7.7** 把设置键**扁平化**（§§media.image.enabled§§ → §§mediaImageEnabled§§ 等），使写入校验**无需放宽**
- **安全边界不变**：ns 白名单仍**硬编码**（只是多一个固定 ns）；密钥字段沿用 §§redactSecrets§§ 脱敏；写入仍走 revision 栅栏 + 默认 dry-run
- **验证**：§§npm run check§§ / smoke / probe / install 全绿 · 使用者侧需**重启 DSH** 后可见

## 1.1.0 — 未发布（P1 · 安装与检查页）

设置分区「工作秘书」下的「安装与检查」由占位替换为真实页面。本次**不发版**：`package.json` 与客户端 BUILD 仍为 1.0.0，随集成体统一升版。

### 新增

- **环境清单（只读检测）**：进入页面自动 `GET /work-personal-secretary/api/check`，按固定顺序渲染七项 —— DSH 宿主 / Node.js / Python / Python 依赖 / WPS Office / Obsidian / 子插件；每项显示状态徽标（ok / warn / missing / skip）、证据值与补充说明，`detail` 中的官网链接渲染为可点击链接。
- **四步进度条**：环境检查（当前）→ 补齐依赖 → 安装子插件 → 初始化；后两步标注「后续版本」。
- **受控补齐（主路径＝逐项）**：可代执行项（Python 解释器 / Python 依赖 / WPS Office / Obsidian）带复选框且默认勾选；批量入口按客户端写死的固定顺序 python → pythonDeps → wps → obsidian **逐个** `POST /fix { id }`（只对选中项过滤，不改变相对顺序），每步完成立刻刷新该项「等待 / 执行中 / 成功 / 失败」并回显 command / exitCode / durationMs 与输出末尾 10 行，随后自动重新检测；清单行内另保留单项「补齐」按钮。
- **兜底路径**：`/fix-all` 不再是 UI 主路径，仅当逐个 `/fix` 在请求层失败且本次任务尚无任何成功响应（典型情形是宿主未注册该路由）时，整体回退 `POST /fix-all { ids }`，并按响应里的 `results` 数组逐项回填；`/fix-all` 也失败时整批标记失败并给出原因。
- **结论条与确认文案**：环境未就绪时顶部给出「一键补齐全部（N 项）」入口（语义＝依次补齐这 N 项，按钮旁标注「逐项依次执行」）；底部主按钮为「补齐选中项（N）」，执行中显示「补齐中 x/N」，并如实列出将安装的内容（Python 解释器 3.12 / Python 包 8 个 / WPS Office / Obsidian）。
- **安全边界**：客户端只上报 id，不拼接、不传递任何命令字符串；WPS Office 项显示第三方商业软件许可提示；不可代执行项提供「复制命令」；底部说明默认只读、命令来自内置白名单、不接受外部输入。
- **错误与空态**：接口不可达或返回 `ok:false` 时给出可读失败提示与「重试」，不白屏、不抛异常穿透；加载中显示「检测中…」。
- **按载体分档的宿主基址**：沿用一方 file-upload 的合成 origin 写法 —— Web 载体（origin 正常）走根相对路径，失败再退合成基址；桌面外壳下 `location.origin` 为字符串 "null"，**直接**走合成 origin `http://dsh.internal`，不再尝试必然失败的根相对路径（每个请求只发 1 次，避免拖慢与控制台红字噪音）。两档行为均有冒烟断言覆盖。

### 修复（2026-09-13 · 灰度测试驱动）

- **桌宠套装素材现在随安装自动部署**（`lib/install.js`）：桌宠运行时只读 `<dsh home>/data/dsh-token-pet/skins/`，模块内的 `skins/` **从不被读取**；此前安装器只复制模块、配置底座只建空目录，导致**灰度环境装完只剩客户端内置的 default 形象、两套自研套装不出现**（2026-09-13 灰度测试实锤，即待办里的「素材部署遗漏」）。新增 `deployPetSkins()`：安装 `dsh-token-pet` 成功后，把 `<repoRoot>/modules/dsh-token-pet/skins/<套装>` 按**只补缺失、绝不覆盖**部署到运行时目录。单套失败只清理该套半成品、**不影响插件安装结果**；源目录缺失（纯补丁形态）记为 `skipped` 不算错误。`lib/api.js` 的单项 / 批量安装路由把服务端解析的 DSH_HOME 传下去（`dshHome`），**不新增任何客户端入参**（源与目标路径仍全部由服务端拼接）。安装结果新增 `skins` 字段（非 token-pet 与失败分支恒为 `null`，形状稳定），安装回显多一行「桌宠素材：…」。

### 说明

- 宿主半（`lib/`）的 `check` / `fix` / `fix-all` 路由与命令白名单由并行工作线实现。客户端主路径只用 `POST /fix { id }`；`/fix-all` 仅作兜底，请求契约 `{ ok, results: [{ id, ok, command, exitCode, durationMs, output }], rejected, durationMs }`。路由缺失时页面给出可读错误，不会白屏。客户端文案键设计为 id 无关：接口把某项降级为 manual（`autoFixable:false`）时，该行自动由「补齐」切换为「复制命令」。

### 验证

- （2026-09-13 素材部署修复）`scripts/install-test.mjs` **191 通过 / 0 失败**（新增 22 项：[9] 节 —— 空 dsh home 部署 3 套 / 逐字节一致 / 重复安装全部跳过且**使用者改过的素材未被覆盖** / 源无 skins 时 skipped 且安装仍成功 / 非 token-pet 与失败分支 `skins=null` / `resolveDshHome` 三级解析）；另有**真实素材演练**：空 dsh home 部署 3 套 42 个文件、逐文件 SHA256 与源一致，二次部署全部跳过、使用者改动保留。同轮门禁：probe 136 · basedeck 179 · settings-api 109 · smoke 337 · experts 25/18/7 · work-memory 83，全绿。
- `node --check modules/work-personal-secretary/client/index.js` 通过；
- `node modules/work-personal-secretary/scripts/smoke-load.mjs`：原 20 项断言全绿；新增「安装与检查」页断言 48 条（七项骨架 / 四步进度 / 复选框默认勾选与只发选中项 / 固定顺序逐项 `POST /fix` / 逐项实时进度「补齐中 x/N + 执行中」/ `/fix-all` 仅兜底且容错解析 / 无 fetch 载体不抛错）与「载体分档」断言 4 条（桌面外壳 GET/POST 首次即合成基址且无相对路径尝试；Web 载体 GET/POST 走根相对路径），共 **72 项通过、0 失败**。

## 1.0.0 — 2026-09-13（正式版第一版 · P0 骨架）

集成体首次以**独立插件本体**的形态落地。此前仓库只有五个子插件与文档，没有本体代码。

### 新增

- **设置分区「工作秘书」**：通过 DSH 原生 `settings.section` 槽位在设置左侧注册独立分区（不占用宿主「插件配置」页 —— 那一页只列宿主平面插件，用户插件本来就进不去）。
- **分区内三个子页**：安装与检查 · 能力配置 · 关于与致谢。P0 先交付「关于与致谢」，其余两页显示开发中说明。
- **关于与致谢**：列出集成体版本、包含的五个子插件（记忆库 / 文档能力 / 专家库 / 思维链与图表 / 桌面形象）、第三方来源与许可、以及安全与法务类专家内容「未经专业复核」的免责边界。
- **宿主半骨架**：模块可加载、可被组合树识别；版本从自身 `package.json` 读取而非写死；零运行时依赖。
- **中性部署默认层**：`cordis.patch.yml` 不含任何个人路径或称呼。

### 说明

- 本版**尚未包含**安装器（环境检查 / 依赖补齐 / 子插件安装 / 配置底座）与能力配置页 —— 它们按集成体既定分期在后续版本交付。
- 子插件清单中的版本号**不写死**：P0 只展示标识与用途，版本探测随安装器一并提供。

### 验证

- `node --check` 覆盖 `lib/index.js` 与 `client/index.js`；
- 已安装到本机 desktop profile 并以 `dsh --profile desktop --dump-config` 验证组合树可加载。
