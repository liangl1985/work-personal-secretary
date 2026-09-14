# workspace-tokenpet

> **独立项目模块**：DSH（DeepSeek Harness）桌面宠物插件 —— 浏览器里的浮动小宠物 + 用量与上下文面板。
> 命名、包元数据、文档、源码、构建产物与形象素材**全部在本目录内自持**：不依赖任何上游仓库，
> 不需要应用补丁，也不需要按上游基线做同步。对原始来源 `dsh-token-pet` 只在第五节「致谢」中提及。

---

## 一、定位

一个**宿主半 + 浏览器半**的 DSH 插件：

- **宿主半**（`lib/`，由 `src/*.ts` 编译而来）：注册素材清单 / 单文件、用量聚合、终身账本、
  小时趋势维护、索引状态与提示词增强等精确路由；
- **浏览器半**（`client/client.js`，由 `src/client/**` 经 tsdown 打包）：渲染浮动宠物、播放动作条带、
  提供「桌面形象」设置分区与提示词面板；
- **形象可插拔**：宠物形象在**运行时**从素材目录发现，增删形象不需要重新构建、不需要重启。

## 二、功能清单

### 2.1 多形象套装（运行时）
- 宿主扫描 `~/.dsh/data/workspace-tokenpet/skins/<套装id>/`：读取 `manifest.json`，
  校验 schema、动作名白名单、**路径穿越**（`isSafeSkinId` / `isSafeSkinFile`）后才对外提供；
- 两条精确路由：`GET /workspace-tokenpet/skins`（清单）与 `GET /workspace-tokenpet/skins/file?id=&file=`（单文件），
  另有前缀形式以兼容开放 Web 载体；素材经客户端 fetch 桥取回转 **blob URL** 交给播放器
  （桌面载体只认 exact 路由，静态前缀路由实测 404）；
- `actionSpecs` prop 让条带来源「当前套装优先、内置兜底」；`rows` 字段**透传**给客户端——
  内置模板里有一个动作是 `cols:16 / rows:2`，缺 `rows` 会把单行条带按 720px 切错（表现为「两个细长人影」）。

### 2.2 动作播放
12 个动作（`idle / working / eating / digesting / warning / evolve / click / archive /
tool-success / tool-failure / prompt-enhancing / prompt-ready`），32 帧 / 100ms，
按 cell 裁切、脚底对齐、无 canvas 播放，支持左右镜像与 pingPong 闭环。

### 2.3 用量与上下文面板
- `GET /workspace-tokenpet/usage` 用量聚合；`POST /usage/reset`（清空）与 `POST /usage/restore`（恢复）；
- 终身账本 `GET /usage/lifetime`、`POST /usage/lifetime/clear-history`；
- 小时趋势：`GET /usage/trend`、`/usage/trend/status`、`/usage/trend/repair`、`/usage/trend/repair/cancel`
  （宿主缺 `listSnapshots()` 时由 `supportsSnapshots()` 守卫优雅降级，不刷错误日志）；
- 索引维护：`GET /index/status`、`POST /index/build`、`/index/sync`、`/index/cancel`。

### 2.4 提示词增强
`POST /workspace-tokenpet/prompt/enhance`：使用者主动触发，不改写、不记录完整提示词。

### 2.5 设置与默认形象
浏览器 localStorage（key `workspace-tokenpet.settings.v1`）保存偏好；「形象套装」面板列出可用套装、
显示动作数与预览，并提供「**设为默认形象**」（`defaultSkinId`，与「当前使用」分离）。

### 2.6 随包素材
`skins/` 下三套，共 **42 个文件**（每套 `manifest.json` + 12 条动作条带 + `preview.webp`）：

| 套装 | 来源 | 许可 |
|---|---|---|
| `default` | 上游内置形象 | MIT（署名见该套装 manifest.json 的 `author`） |
| `lina-pure` | 本项目自有形象 | 随本仓库分发，未经授权不得再分发或商用 |
| `lina-lazy` | 本项目自有形象 | 同上 |

## 三、安装

### 3.1 随集成体安装（推荐）
集成体 `work-personal-secretary` 的安装器把 `<repoRoot>/modules/workspace-tokenpet` 整体复制到
`<profile>/node_modules/workspace-tokenpet` 并写入 profile 的 `dsh.profile.bundles`
（原子替换 + 逐文件 SHA256 校验，失败即回滚）。

安装成功后安装器会**部署形象素材**到运行时目录：

- 目标：`~/.dsh/data/workspace-tokenpet/skins/<套装id>/`（**只补缺失、绝不覆盖**使用者改过的套装）；
- **数据目录迁移**：若新址缺某套装、而旧址 `~/.dsh/data/dsh-token-pet/skins/` 存在同名套装，
  安装器会从旧址**复制**到新址（旧址数据保留，不删除、不覆盖新址已有内容）；
- 单套失败只清理该套的半成品，**不影响插件安装结果**。

### 3.2 手动挂载（开发）
~~~powershell
dsh plugin --profile desktop add link:<本模块目录绝对路径>
~~~
宿主半改动需重启 DSH Desktop；只改客户端时刷新页面即可。

### 3.3 运行时目录
| 路径 | 用途 |
|---|---|
| `~/.dsh/data/workspace-tokenpet/skins/` | 形象套装（运行时读取；使用者可自行增删） |
| `~/.dsh/data/workspace-tokenpet/` | 用量账本 baseline 等运行时数据 |

## 四、开发与构建

~~~powershell
npm install
npm run typecheck      # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
npm run build          # build:host (tsc) + build:client (tsdown)
npm test               # 先 build:host，再 node --import tsx --test tests/*.test.mjs
~~~

- `src/**` 是**唯一真源**；`lib/**`（宿主产物）与 `client/client.js`（客户端产物）随包分发，装完即可用；
- `client/client.js` 由 `tsdown.config.mjs` 注入 banner
  `window.__ModuleLoader__.load({ id: "workspace-tokenpet", ... })`，宿主按该 id 装载客户端半；
- 目录约定：`src/` 宿主源码，`src/client/` 浏览器源码，`tests/` 单元测试，`skins/` 随包素材。

## 五、致谢

本模块由三方 DSH 插件 **dsh-token-pet** 独立化而来；上游的代码、形象与设计是本模块的基础，谨此致谢：

| 项 | 值 |
|---|---|
| 项目 | dsh-token-pet —— A bilingual floating pet for DeepSeek Harness |
| 仓库 | https://github.com/Jimmy0123-ux/dsh-token-pet |
| 许可 | MIT License, Copyright (c) DSH Token Pet contributors |
| 基线 commit | `cc49233f8d951dff7d979ee500ae74918497978e`（v0.2.0，独立化时的对应版本，仅供追溯） |

上游的版权与 MIT 许可文本**原样保留**在本目录 `LICENSE` 中（独立化不删除任何上游声明）；
更完整的归属说明见 `NOTICE`。独立化之后，本模块不再应用上游补丁、不再随上游升级。

## 六、许可

本项目以 **MIT** 许可发布 —— 见 `LICENSE`（同时包含上游版权行与本项目版权行）。
