# 官方桌面版适配核对（OFFICIAL-DESKTOP-ADAPTATION）

> **状态**：待触发 —— 官方桌面版发布后启动
> **核对日期**：2026-09-25（第 2 次核对；第 1 次 2026-09-20；**当日读码后有 3 处更正，见 §5**）
> **配套读码笔记**：`OFFICIAL-SOURCE-NOTES.md`（官方源码读码：插件机制硬事实 · 改造点 · 维护判定）
> **基准文档**：`deepseek-ai/deepseek-harness` → `apps/desktop/README.zh.md`（对应 `dsh 0.1.7-rc.2`，47,422 字符）
> **官方桌面版状态**：**尚未发布** —— 最新 release `dsh-v0.1.7-rc.2` 仍为 Pre-release，且 **release assets = 0**（无任何安装包）
> **本文用途**：本仓库的官方桌面版适配基线。官方版发布后按 §8 启动清单逐项实测，并把结果回填本文。

## 0. 下一目标

**官方桌面版发布后：① 完成技术适配；② 向官方生态发包**（可选路径见 §6）。

本文是这条路径的起点与依据；未实测项一律标注「未确认」，不以推断代替证据。

## 1. 先分清对象：两个不同的桌面端

| 维度 | 官方桌面端 | 本仓库当前运行环境 |
|---|---|---|
| 仓库 | `deepseek-ai/deepseek-harness` → `apps/desktop` | `anywhere-labs/dsh-desktop` |
| 包名 | `@deepseek-ai/dsh-desktop` | `dsh-plugin-desktop` |
| 版本 | `0.1.7-rc.2`（`private: true`，**未发布**） | `2.0.11` |
| 与官方关系 | — | `isFork: false`、`parent: null` → **独立项目，非官方 fork** |
| 自述 | 官方 monorepo 的一环 | 「DSH Desktop 是社区维护的开源项目，并非 DeepSeek 官方产品」 |

**要点**：本仓库现有的安装形态（`file:` + Junction）与桌面壳适配，都是围绕 **anywhere-labs 版**形成的；官方版是另一个载体，不能假定其行为一致。

### 版本推进记录（官方）

| 日期 | 版本 | 备注 |
|---|---|---|
| 2026-09-17 | `dsh-v0.1.6-alpha.2` | 第 1 次核对的基准 |
| 2026-09-22 | `dsh-v0.1.7-alpha.1` / `alpha.2` | — |
| 2026-09-23 | `dsh-v0.1.7-rc.1` | — |
| **2026-09-24** | **`dsh-v0.1.7-rc.2`** | 当前最新，仍 Pre-release |

## 2. 官方约束（依据 `apps/desktop/README.zh.md` 原文）

| # | 约束（官方原文口径） | 对本仓库的含义 |
|---|---|---|
| 1 | production Desktop **使用与 dsh 完全相同的版本**（含 `alpha`/`beta`/`rc` 标识）；「即使桌面壳代码不变，升级 dsh 也必须发布新 Desktop 版本」 | 不能自选内核版本；当前对应 `0.1.7-rc.2` |
| 2 | 「打包应用运行编译后的 JavaScript 和预生成的 Typert 元数据，**不编译 TypeScript 插件**」 | 插件必须交付已编译 JS（本仓库满足） |
| 3 | **【2026-09-25 更正】**官方已删除旧版"清理 profile 核心包副本与回退链接"机制（`apps/desktop/src/profile-core-cleanup.ts` / `profile-packages.ts` 已不存在；见官方 note `2026-09-19-remove-desktop-profile-core-cleanup.zh.md`）。现行口径："启动 Host 前，Desktop 校验运行时描述符并准备 profile，**不改动已安装的包、依赖声明与锁文件**；只删除早期 Link 后端写下的 `.dsh-module-fallback` 投影，**启动从不运行 pnpm**" | 旧判据作废；但"自建写盘 vs 官方 profile 写锁"的新冲突仍存在（见 §5.1-1） |
| 4 | 原生恢复会禁用第三方 bundle，并把 profile 的 `cordis.patch.yml` **重命名为 `.bak-<timestamp>`**；**home 级 patch 不变** | 写在 profile patch 里的配置会被重置 |
| 5 | 包事务**独占** `$DSH_HOME/profiles/desktop/lock`；「共享模块回退辅助函数只删除其拥有的链接，保留 pnpm 管理的目录」 | 安装应走官方包管理器 |
| 6 | 插件管理走「主应用**插件页面** → 共享插件管理器 → **内置 pnpm**」，「无需 PATH 中存在 pnpm」；「CLI 不能启动或修改此 profile」 | 安装/升级路径需改走官方通道 |
| 7 | Desktop 自带独立 Python / Node / pnpm 运行时；`runtime/bin` **只进包安装进程，不入 agent shell 的 PATH**；Python 走 `load_workspace_dependencies` 返回**绝对路径**。默认注册 `office-docx` / `office-pptx` / `office-xlsx` | 依赖系统 PATH 解释器会失效；Office 技能与 `dsh-doc-suite` 重叠 |
| 8 | 发布目标仅 `mac-arm64` / `mac-x64` / `win-x64`，「**Linux 不是受支持的 Desktop 发布目标**」 | 多平台声明需收窄 |

> **关键词复核（2026-09-25，新版 47,422 字符全文）**：`systemPrompt`=0、`inject`=0、`ctx`=0、`settings`=0、`commands`=0、`file:`=0、`dsh.bundle`=0、`registry`=0；`preserve-symlinks`=1、`load_workspace_dependencies`=2、`office-docx`=1。
> ⇒ README 较第 1 次核对增补约 70%，新增内容为 `## 关闭窗口与退出`、`### 启动引导`、`### 欢迎窗口外观`、`## 更新`、`### 强制更新策略` 等章节；**插件 API 面依然未覆盖**（上列关键词全为 0）。插件 API 依据应取官方 `docs/cordis-primer.zh.md`、`docs/cordis-api/`、`docs/subsystems/`。

## 3. 官方插件安装机制（2026-09-25 新增，依据 `packages/boot/plugin-manager/README.zh.md`）

官方桌面端已具备完整的第三方插件安装能力，**这是「发包」的落地通道**。

**支持的安装来源（`inspect(spec)` 按形式分流）**

| 来源 | 判定机制 |
|---|---|
| 注册表包名 | 在 profile 目录运行 `pnpm view` 询问 registry |
| **本地绝对路径** | 读取其 `package.json` |
| **git 地址（如 GitHub）** | `git ls-remote` 预检仓库（默认超时 5000ms） |
| tarball URL | 只答复形式与拉取主机 |

**注册表机制**（决策见官方 `.agents/notes/implemented/architecture/2026-09-18-plugin-install-registries.zh.md`）：管理器问的是「注册表计划」而非单个注册表 —— `registry`（首发）+ `fallbackRegistries`（默认 **npmmirror**）；按序询问，只有「换注册表能改变的失败」（网络 / 超时 / not-found / 无匹配版本）才转下一个；**私有源永不回落公共源**；公开常量 `OFFICIAL_NPM_REGISTRY` 与 `NPMMIRROR_REGISTRY` 经 `@deepseek-ai/dsh-plugin-manager/registry` 导出。

**安装入口**：Web 侧边栏「插件」页；`plugin_manager` 工具（**Creator 模式**启用，需 `danger-full-access` 或逐次批准）。插件开关只改 profile `cordis.patch.yml` 中最后一条匹配覆盖项的 `disabled`；组合包开关改 `package.json` 的有序 `dsh.profile.bundles` 列表。失败 / 取消会恢复 `package.json` 与 `pnpm-lock.yaml`。

**`OPTIONAL_BUNDLES`**（`packages/boot/app-boot/src/profile.ts`）：被启动器点名的组合包为 `optional` —— **随官方安装包提供、默认关闭、由用户开启、永不可卸载**，且不被任何随附模板选中。

> **由此得出的事实**：官方**没有「插件提交审核入库」流程**（desktop README 中 `registry`=0，plugin-manager 文档亦无审核概念）。第三方插件是**开放安装**的。

## 4. 我们的现状（6 模块基线）

| 模块 | 版本 | 宿主服务（`inject`） | 客户端半 | `@deepseek-ai` 依赖 |
|---|---|---|---|---|
| `work-personal-secretary` | 1.1.9 | settings、webServer（+运行时 `ctx.get` 取 directoryPicker 等） | 有 | 6 peer / 1 实际（动态 schemastery） |
| `dsh-work-memory` | 1.0.9 | systemPrompt、tools、commands、settings、webServer | 有 | 9 peer / 3 实际 |
| `dsh-experts` | 0.5.13 | systemPrompt、tools、commands、settings（+skills） | 无 | 3 peer / 2 实际（均动态） |
| `dsh-doc-suite` | 0.7.17 | commands、settings | 无 | 3 peer / 1 实际 |
| `dsh-mermaid` | 0.4.0 | webServer | 有 | 0 |
| `workspace-tokenpet` | 1.0.4 | 顶层 `inject=[]`，运行时取 sessionPersistence、webServer | 有 | 6 peer / 1 实际（type-only） |

**安装现状**（宿主侧实测）：5 个子模块为 `file:node_modules/<id>` 实体副本；**集成体为源码绝对路径 + Junction 链接**。
**版本一致性**：源码 6 个 `package.json` 与已装副本逐一对齐，6/6 一致。

## 5. 差距与改造清单

### 5.1 P0 —— 不解决无法在官方桌面版运行

1. **安装通道改为受支持的官方插件事务**【2026-09-25 重写】
   原判据（"官方启动前清理 profile 副本与回退链接"）**已作废**（见 §2-3）。
   真实冲突：集成体 `modules/work-personal-secretary/lib/install.js:10-15` 自建原子替换，直接写 profile 的 `node_modules/<id>`、`package.json`、`cordis.patch.yml`（`:23-24`），**不取 profile 写锁、不动 `pnpm-lock.yaml`、不更新 `dsh.profile.bundles`**；而官方这些写入均受 profile 写锁保护并带 lockfile 快照恢复语义。
   → 落盘改走受支持通道（Desktop 内＝插件页／共享 service；Agent 内＝`plugin_manager` 工具，需 `danger-full-access` 或逐次批准），或改为"生成 patch + 依赖声明交给官方事务执行"。同时不再依赖 Junction／源码绝对路径（该形态不符合官方"实体包 + pnpm 管理"惯例）。

2. **Python 解释器改为可注入绝对路径**
   现状：`modules/dsh-doc-suite/lib/index.js:39` 默认 `pythonLauncher='py -3'`，`:62` 回退链为 `['py -3','python3','python']`；`modules/work-personal-secretary/lib/probe.js:345` 的 `pythonLauncher()` 为 PATH 解释器，`:243` 在缺失时引导用户自行安装。
   → 增加「优先取 `load_workspace_dependencies` 返回的绝对解释器路径」，`py -3` 降为兜底。

3. **`peerDependencies` 版本范围**【2026-09-25 已实测，风险后置】
   6 个模块的 peer 全部钉在 `^0.1.5-rc.1`（`dsh-tools` / `dsh-client-*` / `schemastery`；cordis `^4.0.2` / `^4.0.1`）。
   **实测**：`semver.satisfies('0.1.7-rc.2','^0.1.5-rc.1',{includePrerelease:true}) === true` ⇒ **当前不会被官方兼容门禁拒绝**。
   风险：官方进入 `0.2.x` 后该范围全部失效 → 6 个 bundle 会被列入 `skippedBundles` 并跳过。
   → 决策点：是否放宽范围（或改 `workspace:*`）；并把"官方升版 → 复跑 semver 核对"列入维护清单。

### 5.2 P1 —— 影响稳定性与体验

4. **客户端 origin 兜底增加 `dsh-app://` 分支**
   现状按 `file://` 写：`modules/work-personal-secretary/client/index.js:59-60` 与 `modules/dsh-work-memory/client/index.js:42-43` 判 `origin === 'null'` 才走兜底；`modules/workspace-tokenpet/client/client.js:5608-5609` 注释同口径。官方载入用 `dsh-app://app`，兜底分支**不会触发**。
   → 推断可通（官方 origin 白名单恰好放行 `dsh-app://app`），但需实测确认后续请求仍被正确转发。

5. **profile patch 的个性化配置外移**
   现在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 里写 `repoRoot` 等；官方恢复会整体改名重置。
   → 迁到 home 级 patch 或设置页。

6. **Office 技能取舍**
   官方 `office-docx` / `office-pptx` / `office-xlsx`（内置 Python 库）与本仓库 `office-word` / `office-excel` / `office-ppt`（WPS COM 口径）功能重叠、命名不同。
   → 需先定「谁默认生效」。

7. **`dsh-mermaid` 打包完整性**
   其 `check`/`build`/`prepare`/`prepack` 引用的 `scripts/`、`src/` 目录**在仓库中不存在**（仅有构建产物）→ 推断 `prepack` 会中断。该模块为第三方（MIT）。

8. **客户端声明与实际服务对齐**
   `work-personal-secretary` 客户端用了 `uiWorkspace` 但 `dsh.client.inject` 只列了 locale/settings；`dsh-work-memory` 客户端 `require('@deepseek-ai/dsh-client-store')` 但未列入 `dsh.client.inject`。

### 5.3 P2 —— 工程与发布

9. 官方更新单元 = 壳 + 匹配 dsh 运行时 + pnpm，**插件不在内** → 每次桌面更新等于换内核，需自建跨版本加载验证。
10. 发布目标收窄至 `mac-arm64` / `mac-x64` / `win-x64`。
11. 若跟随官方节奏，需接受「Desktop 版本 = dsh 版本」的同版发布纪律。

### 5.4 已兼容，无需改造

- **「精确路由桥」不成立**。官方 `apps/desktop/src/web-document.ts` 的 `forwardWebRequest` 只校验 origin（`origin !== null && origin !== 'dsh-app://app'` 才 403），`target.pathname = source.pathname` **原样透传，无路由白名单**；`apps/desktop/src/ipc.ts` 的 IPC 通道仅 9 个、无通用 fetch 桥。
- 本仓库本就**双注册** prefix 与 exact 路由（`modules/dsh-work-memory/lib/api.js:361-372`；`modules/workspace-tokenpet/lib/index.js:1167`、`:1205`），两个载体都能通。

## 6. 发包路径（三选项，待定）

官方对第三方插件**开放安装、无审核入库流程**，因此「进官方生态」有三条现实路径：

| 路径 | 做法 | 成本 | 官方即装即用 |
|---|---|---|---|
| **A. npm 公开包** | 发布到 npm registry（包名 + `dsh.bundle.patch`） | 中（需发版流程） | ✅ 官方对话框首选路径 |
| **B. GitHub 仓库** | 保持现有仓库，用户/Agent 用 git spec 安装 | 低（现状即可） | ✅ 官方支持 git spec，且带镜像回退 |
| **C. `OPTIONAL_BUNDLES`** | 随官方安装包分发、默认关闭、用户可开启 | 高（需官方接纳，属官方发行内容） | ✅ 但不由本仓库控制 |

> **建议（推断，待决策）**：先做 **A + B**（成本低、官方即装即用），把 **C** 作为长期争取。

## 7. 待决策

1. **发包路径**：上表 A / B / C 选哪条（或组合）？
2. **Office 技能**：与官方三件套共存、让位，还是合并？
3. **发布节奏**：是否跟随官方 Desktop 版本号？
4. **集成体定位**：它现在「接管 `work-memory`/`experts`/`dsh-doc-suite` 三个设置命名空间 + 统一安装 5 个子插件」，这套编排是否保留？

## 8. 官方版发布后的启动清单

1. 装官方桌面版，确认内核版本与 `$DSH_HOME` 布局。
2. **实测 `file:` / symlink / Junction 在打包版的行为**（§9 唯一硬未知）——决定 §5.1-1 的具体改法。
3. 实测 `peerDependencies` `^0.1.5-rc.1` 在官方内核（`0.1.7-rc.2` 及以上）下的解析（§5.1-3）。
4. 实测客户端 origin 走 `dsh-app://app` 时的请求转发（§5.2-4）。
5. 按 §5 清单出改造分支，逐项验证后更新本文与 `CHANGELOG.md`。

## 9. README 未覆盖 / 必须实测（不可推断）

| 未覆盖项 | 影响 |
|---|---|
| `file:` / symlink / Junction 在**打包版**的行为 | 决定 P0-1 的改法（全文 `file:` 0 命中） |
| 官方桌面端 origin 白名单的实测验证 | 决定 P1-4 是否需要改代码 |
| Electron 内置 Node 的 ABI | 原生模块适配（本仓库当前无原生模块） |
| 插件与强更 `40005` 阻塞期的交互细则 | 只知「拒绝后续插件修改」 |
| 插件是否随桌面更新重装 / 需重新激活 | 只知「保留已安装插件文件」 |

## 10. 官方源码获取（已实测可下载）

| 方式 | 地址 / 命令 | 备注 |
|---|---|---|
| git clone（推荐） | `git clone https://github.com/deepseek-ai/deepseek-harness.git` | 实测 `git ls-remote` 通；仓库约 **228.8 MB** |
| 指定 tag 检出 | `git clone --branch dsh-v0.1.7-rc.2 --depth 1 <url>` | tag `dsh-v0.1.7-rc.2` = `477b4f42` |
| tag 源码包 | `https://github.com/deepseek-ai/deepseek-harness/archive/refs/tags/dsh-v0.1.7-rc.2.tar.gz` | GitHub 自动生成 |
| master 源码包 | `https://github.com/deepseek-ai/deepseek-harness/archive/refs/heads/master.zip` | — |
| API 入口 | `gh api repos/deepseek-ai/deepseek-harness/tarball/dsh-v0.1.7-rc.2` | 返回 tarball 流 |

**许可证**：仓库为 **MIT**（`license.spdx_id = MIT`），`visibility = public`，默认分支 `master`。
**重要事实**：官方 release **`assets = 0`** —— 发行页**不提供任何安装包**，只有源码。故「官方桌面版未发布」在下载层面同样成立。

## 附录 A：核对方法与出处

- 官方基准：`gh api` 直取 `apps/desktop/README.zh.md` 原文（关键词全文计数 + 标题骨架 + 关键短语定位；**第 2 次核对未逐段精读全文**，第 1 次为全文精读）；另取 `apps/desktop/package.json`、`packages/boot/plugin-manager/README.zh.md`、`.agents/notes/.../2026-09-18-plugin-install-registries.zh.md`、release notes。
- 本仓库基线：6 个模块的 `package.json`、`cordis.patch.yml`、`lib/`、`client/` 静态审计（带 文件:行号）。
- 独立复核：官方 README 关键词计数两次核对一致。

## 附录 B：本次核对的局限

- 官方桌面版**未发布**，全部结论基于 README 与源码静态阅读，未经运行验证。
- **第 2 次核对时，47,422 字符的新版 README 只做了关键词全文统计、标题骨架与关键短语定位，未逐段精读**；§5 的 P0/P1 条目沿用第 1 次全文精读的结论，尚未按新版逐条复核。
- 未运行任何测试脚本；未做宿主副本的逐文件 SHA256 比对（仅比对 `package.json` 版本）。
- 官方 `docs/` 下的插件 API 文档（`cordis-primer`、`cordis-api/`、`subsystems/`）**尚未逐篇研读**——适配开工时应作为前置阅读补齐。
