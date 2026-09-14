# CHANGELOG · work-personal-secretary（集成体本体）

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

### 未执行（硬边界）

- 不 `git commit` / `git push`；不改本机 profile（`~/.dsh/profiles/desktop/` 的 `package.json` 与 `node_modules` 一律不动）。
- 换 id 的实际迁移由主人执行：卸载旧 id → 安装新 id → 确认素材目录（见根 README 与本模块 3.7 节）。

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
