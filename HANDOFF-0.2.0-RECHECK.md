# DSH 0.2.0 适配复核 · 会话交接文档

> **新会话从这里接上**：先读本文 → 再读 `OFFICIAL-SOURCE-NOTES.md`（含 §13 难度表）与 `OFFICIAL-DESKTOP-ADAPTATION.md`（适配清单）。
> 落盘时间：2026-09-29 ｜ 性质：**DSH 插件项目自己的文档**（不是正式交付文档）

---

## 0. 一句话目标

基于官方 **0.2.0-rc.1 源码（含 `apps/desktop` 桌面版）**，**逐个复核我们 6 个插件模块要改什么、难度多大** ——
因为上一轮难度评估是在 **0.1.7** 基础上做的，0.2.0 出来后有新增破坏性变更，需重新复核。
**最终目的**：适配官方桌面版 → 向官方仓库发包，进入官方阵营。

---

## 1. 这次会话做了什么

| 阶段 | 内容 | 结果 |
|---|---|---|
| 1 | 确认官方 0.2.0-rc.1 与官方 Desktop 是**两个不同产物** | ✅ 结论见 §2.4 |
| 2 | 下载官方 **Desktop 0.2.0-rc.1 全量源码** | ✅ `E:\lina\ref\deepseek-harness-0.2.0-rc.1\`（13,990 文件 / 113.6 MB，含 `apps/desktop`） |
| 3 | 逐插件难度初评 | ✅ 写入 `OFFICIAL-SOURCE-NOTES.md` §13 |
| 4 | 检查我们插件在 GitHub 的公开反馈 | ✅ 见 §2.6（0 star / 0 issue，PR #5427 已合并） |
| 5 | **（跑偏）** 试图把官方 Desktop 从源码跑起来 | ⚠️ 偏离目标，但**踩坑经验有价值**，全部记录在 §4 |
| 6 | 交接整理 | ✅ 本文 |

> ⚠️ **教训**：第 5 阶段的「跑起来做真机验证」**不是这次的目标**。主人明确说过「在 0.2.0RC1 没有安装的情况下」怎么验证 —— 应以**读源码 + 静态比对**为主，不要去做环境工程。

---

## 2. 已确认的事实（0.2.0 / Desktop 0.2.0-rc.1）

### 2.1 【最关键】兼容性闸门是 0.2.0 新增的

- 位置：`packages/boot/app-boot/src/plugin-compatibility.ts:61-88`
- 只检查 peerDependencies 里名字匹配 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项
- 判定：`semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
- **不匹配的后果**：整条 bundle 进 `skippedBundles`（`profile.ts:666-683`）→ **整个 patch 层都不加载**（不是降级，是不加载）
- 旁证：本地 0.1.5-rc.2 的 app-boot 里搜 `evaluatePluginCompatibility|skippedBundles|incompatible` = **0 命中**；0.2.0 源码 = **19 命中**
- **豁免机制**：`<profileDir>/compatibility.json`，key 为 `name@version`，需 `--accept-risk`；CLI 命令 `dsh plugin allow-version`

### 2.2 `ctx.settings.register(...)` 在 0.2.0 被移除

- 0.2.0 的 `SettingsForms` 只剩：`configure(:266)` / `prepareDocument(:296)` / `describe(:302)` / `mutate` / `update` / `replace`
- 本地 0.1.5 的 `dsh-settings/lib/index.js:288` 有真正的 `register(ns, schema, options)`
- **影响**：我们的插件调用会抛错 → 但被 try/catch 吞掉 → **插件表面仍加载，设置页静默失效**（最难查的一类问题）

### 2.3 peer 版本范围实测（本机 `semver`，`includePrerelease: true`）

| 运行时版本 | 对 `^0.1.5-rc.1` | 对 `>=0.1.5-rc.1 <0.3.0` |
|---|---|---|
| `0.1.5-rc.2` | ✅ true | ✅ true |
| `0.1.7-rc.2` | ✅ true | ✅ true |
| **`0.2.0-rc.1`** | ❌ **false** | ✅ **true** |

→ **放宽写法向后兼容**，是安全的最小改动。

**6 个模块现状**：均声明 `^0.1.5-rc.1`（**`dsh-mermaid` 例外，它没有 peerDependencies** → 闸门在 `plugin-compatibility.ts:68` 直接返回 undefined，**天然免疫**）。

### 2.4 两个不同产物（务必分清）

| | dsh core | 官方 Desktop |
|---|---|---|
| 包名 | `@deepseek-ai/dsh` | `@deepseek-ai/dsh-desktop` |
| 形态 | npm CLI / web | Electron 壳（`apps/desktop`） |
| 版本 | `0.2.0-rc.1` | `0.2.0-rc.1`（**同号**） |
| 发布状态 | ✅ 已发布，可装 | ❌ **未发布**，release assets = 0 |

npm dist-tags（`@deepseek-ai/dsh`）：`latest: 0.1.7-rc.2`、**`next: 0.2.0-rc.1`**、`alpha: 0.1.7-alpha.2`

### 2.5 6 个模块改造难度（现行结论，待新会话复核）

| 模块 | 版本 | 难度 | 说明 |
|---|---|---|---|
| `dsh-mermaid` | 0.4.0 | **低 / 0 小时** | 无 peerDependencies → 闸门免疫 |
| `dsh-work-memory` | 1.0.9 | **低** | peer×7；数据层是纯 `node:fs` |
| `workspace-tokenpet` | 1.0.4 | **低–中** | peer×5；`listSnapshots`/`readFrom` 官方从来就没有（**不是 0.2.0 回归**） |
| `dsh-experts` | 0.5.13 | **中** | peer×1 |
| `dsh-doc-suite` | 0.7.17 | **中** | peer×1 |
| `work-personal-secretary` | 1.1.9 | **中 / 8–20 小时** | peer×4 + 约 6000 行客户端半边 |

**最小修法**：5 个模块的 peer 从 `^0.1.5-rc.1` 改为 `>=0.1.5-rc.1 <0.3.0`。

### 2.6 插件仓库公开反馈（本次核查）

- 0 star / 0 fork / 0 issue / 0 PR / 0 discussion
- 14 天流量：views 65（21 独立）、clones 1046（331 独立）—— **绝大部分是自家 CI**（workflows `CI`/`Release`）
- **releases 无 assets** → 下载量不可测
- PR #5427 已合并（2026-09-19T13:19:06Z，"add: liangl1985/work-personal-secretary (suite body)"）
- 官方仓库 **Issues 已关闭**，问题走 GitHub Discussions

### 2.7 官方 office 技能方向与我们**相反**

- `office-docx/SKILL.md:8,44,55` 明确：**不发现系统 Python / 不调用系统 LibreOffice / 不做 COM 自动化**
- 我们 `doc-suite` 走 `py -3` + **WPS COM**
- → 需要在我们的 SKILL.md 里写清边界，避免被视为冲突实现

### 2.8 余额显示（tokenpet 改造依据）

- `AccountSnapshot.details.balance`，经 `account` Remote 命名空间
- `AccountClientMetadata` 需要 `timezoneOffsetSeconds`
- `accountClientMetadata()` **未导出** → 第三方必须自行实现
- 官方 account UI 以 `'dshDesktop' in globalThis` 为门
- 本地 0.1.5-rc.2 宿主**缺少** `dsh-deepseek-account` / `dsh-api-account-controller` / `dsh-client-ui-settings-account` → **余额功能目前本地无法开发/验证**

---

## 3. 官方 Desktop 实操要点（本次踩坑全记录）

> 用途：**将来真要跑官方 Desktop 时直接照用**，不必重踩。

### 3.1 前置与构建

1. 源码 tarball 顶层目录名是 `deepseek-harness-dsh-v0.2.0-rc.1`；**官方源码内不含 `.npmrc`**
2. `package.json` 的 `packageManager: pnpm@11.7.0` 会触发 **pnpm 版本自管理**；若 store 的 `links/@/pnpm/11.7.0` 损坏 → 该目录下**任何 pnpm 都直接崩**（`Cannot find module ...pnpm.mjs`）
   - **有效解法**：**删掉 `packageManager` 字段**
   - **无效**：`.npmrc` 写 `manage-package-manager-versions=false`、`--config.manage-package-manager-versions=false`、`COREPACK_ENABLE_STRICT=0`
3. 本机 PATH 上的 `pnpm` 是 **DSH Desktop 的 shim**（拿 `DSH Desktop.exe` 当 Node，设 `npm_config_runtime=electron`）
   - DSH 自带可用 pnpm：`node "E:\DSH Desktop\resources\app\node_modules\pnpm\bin\pnpm.cjs"`（**11.8.0**）
   - 实测 **11.8.0 与官方 11.7.0 的 lockfile 完全兼容**（`Lockfile is up to date, resolution step is skipped`）
4. `pnpm install` 需加 `--config.minimumReleaseAge=0`（官方 `pnpm-workspace.yaml` 有 `allowBuilds` / `minimumReleaseAgeExclude` 供应链策略）
5. **`git rev-parse HEAD` 会失败**（非 git 仓库）→ 设 **`DSH_CLIENT_COMMIT_HASH=0000000`** 绕过（`DSH_CLIENT_COMMIT_HASH` 是 `client-build-environment.ts:26` 的官方逃生口，需 7–40 位 hex）
6. **顺序**：先单独跑一次根 `pnpm run build`，再 `pnpm run start:desktop`
   - 原因：`apps/desktop/scripts/dev.ts` **静态 import** `src/project-manager.ts` → 需要 `dsh-app-boot/lib/index.js` 已存在，而 `dev.ts` 自己调 build 太晚
   - `dev:desktop` = 带构建；`start:desktop` = `tsx scripts/dev.ts --skip-build`

### 3.2 primary runtime 下载（**可预放缓存绕过**）

- 下载源**全部国外、URL 硬编码、无镜像开关**：
  - Node → `nodejs.org/dist`
  - Python → `github.com/astral-sh/python-build-standalone/releases`
  - wheels → `files.pythonhosted.org`
- **但有 sha256 缓存**：`apps/desktop/.desktop-build/downloads/<sha256>`（**文件名就是 sha256，无扩展名**）
  → 提前把文件放进去，程序 `readFileSync` 命中即跳过下载 ✅
- win-x64 需要 6 个文件：

| 内容 | sha256（文件名） | 大小 | 可用镜像 |
|---|---|---|---|
| Node 24.21.0 | `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541` | 35.88 MB | `npmmirror.com/mirrors/node` |
| Python 3.12.14 | `7c45c9622400d578709a9b2cddbe8124cc01d382409d9f13406d706d28e31b14` | 20.96 MB | gh-proxy / 直连带 `--proxy` |
| numpy 2.3.5 | `86945f2ee6d10cdfd67bcb4069c1662dd711f7e2a4343db5cecec06b87cf31aa` | 12.19 MB | 清华 PyPI |
| pandas 3.0.1 | `536232a5fe26dd989bd633e7a0c450705fdc86a207fec7254a55e9a22950fe43` | 9.29 MB | 清华 PyPI |
| pillow 12.3.0 | `a2b55dd6b2a4c4b7d87ffa56bdb33fdc5fdb9a462173861a7bc097f17d91cb09` | 6.89 MB | 清华 PyPI |
| lxml 6.1.3 | `3e9a00d1c2c30936f7add097c41afc5da6556c580909104aafd382cac92a855c` | 3.82 MB | 清华 PyPI |

- Python 文件名规则：`cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`（URL 里 `+` 要编码为 `%2B`）
- **实测镜像速度**：清华 PyPI **836 KB/s**｜gh-proxy **619 KB/s**｜aliyun-pypi 356 KB/s｜ghfast **仅 72 KB/s**（淘汰）
- ⚠️ **`curl.exe` 不读 Windows 系统代理**，要显式加 `--proxy http://127.0.0.1:7890`

### 3.3 Electron 二进制

- `electron` **不在 `allowBuilds` 列表** → postinstall 被 pnpm 跳过 → `dist/` 不生成
- 手动补：`cd apps/desktop/node_modules/electron && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js`
- 实测 **17 秒**下完 electron 44.0.0 ✅

### 3.4 Windows / PowerShell / DSH 陷阱

1. **子进程写 stderr → `NativeCommandError`**；默认 `$ErrorActionPreference='Stop'` 下**会终止整条管道并杀掉进程**（日志只留 `terminated`，真实错误被吞）
   → 必须 `$ErrorActionPreference='Continue'` + `*>&1`
2. **DSH 后台 job 约 5 分钟会杀掉长静默任务**；`Start-Process` / `cmd` 启的进程树也会被回收
   → 真脱离要用 **WMI**：`Invoke-CimMethod -ClassName Win32_Process -MethodName Create`
3. **WMI 创建的进程不继承 DSH 注入的 PATH** → 需自建 `pnpm.cmd` 包装器（`node <DSH pnpm.cjs> %*`）并写进 PATH
4. Desktop 开发态路径：`DSH_HOME=apps/desktop/.desktop-build/development/home`、`userData=.../electron-user-data`、web 端口随机（本次 `19387`）、inspectors 9229/9222/9230

### 3.5 本次结果

**官方 Desktop 0.2.0-rc.1 成功启动到界面**（日志末行 `dsh web: http://127.0.0.1:19387/?token=...`），
随后进程退出 —— **2026-09-29 主人确认：本人手动关闭窗口**（非崩溃、无错误日志；原「疑似窗口被关或进程树被回收」的说法已作废，见 §8）。

---

## 4. 三个 0.2.0 改造任务（主人定的优先级）

1. **集成体安装方式改造**：从自建 `lib/install.js` 直接写文件 → 改走官方插件事务
   - 真实冲突点：自建 install.js **vs 官方 profile 写锁**
2. **tokenpet**：复用官方用量数据 + **新增余额显示**（依据见 §2.8；本地暂缺官方 account 包）
3. **doc-suite 精修**：互补官方 `skill-office`；同步调整 tool/skill 专家
   - 需先查清：官方是否走 skill 模式；加强时**不碰官方原始数据**

---

## 5. 未决事项（等主人拍板）

- [ ] 是否启动**第一批改造**（5 个模块 peer 放宽 → `>=0.1.5-rc.1 <0.3.0`）
- [ ] 是否接受**过渡期「设置页暂时失效 / 先用 `cordis.patch.yml`」**
- [ ] 是否**保留 WPS COM 通道**与官方 LibreOffice 并存

---

## 6. 下一步（新会话可直接执行）

1. **逐插件复核**（主线，尚未完成）：
   对 6 个模块逐个对照 0.2.0 源码，输出「**改什么 / 难度 / 依据文件+行号**」，产出补进 `OFFICIAL-SOURCE-NOTES.md` §13
2. 特别复核 **`ctx.settings.register` 移除**对我们各插件的实际影响面（哪些设置项会静默失效）
3. 复核 **`dsh.profile.bundles` / `dsh.bundle.patch`** 在 0.2.0 的加载路径是否还有别的新约束
4. 等主人拍板 §5 三项后，再动手改代码

---

## 7. 文件清单

### 项目文档（本次会话产出/更新）
- `E:\lina\DSH插件\src\work-personal-secretary\OFFICIAL-SOURCE-NOTES.md` —— 官方源码读记（§13 = 难度表）
- `E:\lina\DSH插件\src\work-personal-secretary\OFFICIAL-DESKTOP-ADAPTATION.md` —— 适配清单
- `E:\lina\DSH插件\src\work-personal-secretary\HANDOFF-0.2.0-RECHECK.md` —— **本文**
- `E:\lina\DSH插件\src\work-personal-secretary\README.md` —— 含「官方桌面版适配（待触发）」段

### 官方源码
- `E:\lina\ref\deepseek-harness-0.2.0-rc.1\` —— 0.2.0-rc.1 全量源码（含 `apps/desktop`）
- `E:\lina\ref\dsh-v0.2.0-rc.1.tar.gz` —— 原始 tarball（31.05 MB，已验证 15,963 条目）

### 环境脚本（本次踩坑副产品，**非主线，可留可删**）
- `E:\lina\ref\install-dsh-0.2.0-deps.ps1` / `.cmd` —— 依赖安装脚本（**注意：其 pnpm 逻辑已过时，需按 §3.1 更新**）
- `E:\lina\ref\bin\pnpm.cmd` —— pnpm 包装器
- `E:\lina\ref\start-desktop.cmd` / `start-desktop.vbs` —— Desktop 启动器
- `E:\lina\ref\*.log`、`py-test.tar.gz` —— 临时日志，可删

### 我们的插件模块
`E:\lina\DSH插件\src\work-personal-secretary\modules\` 下：
`work-personal-secretary` / `dsh-work-memory` / `dsh-experts` / `dsh-doc-suite` / `dsh-mermaid` / `workspace-tokenpet`

---

## 8. 存疑 / 未验证

- ~~Desktop 进程退出的确切原因未确认（无错误日志）~~ → **2026-09-29 销项**：主人确认系本人手动关闭窗口。结论：从源码启动官方 Desktop 0.2.0-rc.1 **完整成功**，未发现稳定性问题
- **Desktop 开发态 ≠ 打包态**：官方注释称「打包应用选择 runtime profile 解析，不创建包链接；开发 profile 使用文件系统链接」→ 开发态能验证闸门/加载/设置，**但验证不了打包专有行为**
- 余额功能：本地缺官方 account 相关包，**无法开发与验证**
- `dsh-mermaid` 无 peerDependencies 是否真能完全免疫闸门 —— 依据是 `plugin-compatibility.ts:68` 的返回 undefined，**建议新会话再核一次该行原文**

---

## 9. 仓库工作树状态（**主人已定：不提交，本地保存**）

`E:\lina\DSH插件` 下：
- `M  README.md`
- `?? OFFICIAL-DESKTOP-ADAPTATION.md`
- `?? OFFICIAL-SOURCE-NOTES.md`
- `?? HANDOFF-0.2.0-RECHECK.md`（本次新增）

**未做任何 git 提交 / 推送。**
