# Changelog — workspace-tokenpet

> 本模块自 **1.0.0** 起是**独立项目模块**（源码、包元数据、文档与形象素材全部自持），
> 不再以上游三方插件 `dsh-token-pet` 的**本地定制层 / 补丁**形态存在；对上游只保留**致谢**
> （见 `NOTICE` 与 `README.md` 的致谢段，上游版权与 MIT 许可文本保留在 `LICENSE`）。
>
> 1.0.0 之前的条目**保留原文**：其中「补丁 / patches / 上游基线 / 定制层」等措辞属于当时的
> 历史形态记录，对应的文件已在 1.0.0 中删除。

## 1.0.3 — 死路由清理（2026-09-17）

- **删除 `/workspace-tokenpet/strips/`（prefix）遗留路由**：它读 `../assets/pet/action-sheets/`，
  而本模块**没有 `assets/` 目录**（2026-09-17 逐插件盘点实测），且 prefix 形态在桌面载体本就 404
  （`src/skins.ts:107-113` 的实测结论）。1.0.2 已用 exact 路由 `/workspace-tokenpet/builtin-strip`
  取代它，客户端从未调用过它，属彻底死代码。删除后 `src/index.ts` 1180 → 1151 行；
  **`STRIP_ACTIONS` 常量保留**（新路由仍在用）。
- `ARCHITECTURE.md` 的路由表与路由清单同步去掉该路由（两处）。
- 影响面：仅宿主半（`src/index.ts` → `lib/index.js` 已重建）；**客户端未改动**，不需刷新前端缓存。
- 门禁：`tsc -p tsconfig.json` 重建 exit 0 · `typecheck` exit 0 · `node --import tsx --test tests/lina-skins.test.mjs` exit 0。
- 来源：2026-09-17 主会话处理待办 **T6-⑤**（死路由处置）。

## 1.0.2 — 启动开销与用量索引（2026-09-17）

### 内置图集改为按需取（启动路径不再背 22.5 MB）
- `src/client/pet-action-sheets.generated.ts` 不再内嵌 12 段 WebP data URI：**22,510,039 B → 6,304 B**；
  12 条 spec 的 `sheet` 改为 `/workspace-tokenpet/builtin-strip?file=<name>`，**其余字段（frameW / frameH /
  bodyHeight / feetY / frames / cols / rows / delaysMs / loop / pingPong / totalMs）逐字保留**。
- 新增 **exact** 路由 `GET /workspace-tokenpet/builtin-strip?file=<action>.webp`：从包内 `skins/default/`
  读取，文件名白名单＝`STRIP_ACTIONS`（12 项），响应头 `image/webp` + `max-age=31536000, immutable`；
  未知文件名 404、非 GET 405。**必须 exact**：桌面载体只解析 exact 路由（`src/skins.ts:107-113` 记录的
  实测结论），prefix 形态会 404 —— 本模块既有的 `/workspace-tokenpet/strips/` prefix 路由因此始终不可用，本次未沿用。
- `client/client.js`：**22,992,786 B → 489,037 B**（−97.9%，gzip 254.69 kB）。
- 真机验证（DSH Desktop 2.0.10 · dsh-host-webserver 0.1.5-rc.2）：重启后启动卡顿消失；
  `skins/default/*.webp` 的 atime 在启动时刻被更新，证明新路由被真实调用；`npm test` 8/8 通过。

### 用量索引不再「每次重算」
- 此前 `session-usage-index.json` **从不自动生成**：`runAutoIndexSync`（`src/index.ts:633-643`）在无索引时
  只刷新 Lifetime，全量构建只在显式 `POST /index/build` 时发生 → 面板读取与 清空/恢复 每次都重新 fold
  全部 session 日志（本机实测 224 个 session、解压 738.3 MB 文本 ≈ 5.6 s）。
- 现在无索引时会在后台**自动建立一次**：单飞、共享 operation controller（`/index/cancel` 仍可中止）、
  `yieldEvery: 4` 让步；建立后 `persisted=true`，后续走既有增量路径。
- 真机验证：首次重启后生成 `session-usage-index.json`（63,179 B，149 个 session 已索引）。

### 回退
- 源码与 profile 旧版备份：`E:\lina\backup\tokenpet-2026-09-17\`（`index.ts.bak`、`pet-action-sheets.generated.ts.bak`、`profile-before/`）。
  `client/client.js` 是构建产物，**回退必须重新 `npm run build`** 并同步 profile 副本，不能只换源码。

## 1.0.1 — 构建完整性（2026-09-14）

### 补入两个构建输入（此前从未入库）
- `src/client/pet-action-sheets.generated.ts`（22,510,041 B）与 `src/client/pet-asset.generated.ts`（260,672 B）
  是 `tsc` / `tsdown` 的**必需输入**（被 `animation.ts` / `index.ts` / `pet-action-player.tsx` / `pet.tsx` / `skin.ts` 引用）。
  未入库时干净 clone 无法构建，且 `npm install` 会因 `prepare → build` 直接失败。
- **来源可核**：入库 bundle 内联 region 反提 + 上游 `Jimmy0123-ux/dsh-token-pet@cc49233f`（`NOTICE` 记录的 v0.2.0 基线）原文，
  双源交叉验证一致（12/12 action 的 sheet base64 与数值字段 deepEqual；`pet-asset` base64 sha256 相同）。

### `client/client.js` 改为真实构建产物
- 由 `npm run build`（tsdown v0.22.14 / rolldown）产出；与上一版**仅差 1 处注释**
  （`petHitbox` 的 3 行旧注释 → 9 行 JSDoc，与 `src/client/index.ts` 一致）。
- 剥离注释后两份等价文本长度与 sha256 相同（`9736e03b…`）；生成表 region / `pet-asset` base64 / region 顺序全部 deepEqual。

### `lib/**` 核对
- 26/26 文件（13 `.js` + 13 `.d.ts`）与真实 `tsc` 产物**逐字节一致** —— 独立化时的字符串替换恰好等价。

### 影响
- **无功能变化、无 API / 数据格式变化**；npm 发布物（`package.json` 的 `files` 白名单）不受影响（不含 `src/`）。
- 发布门禁新增：`npm run build` 后 `git diff --exit-code -- lib client` 必须为空（见仓库 `RELEASE-CHECKLIST.md` 三点九）。

## 1.0.0 — 独立化（2026-09-14）

### 破坏性变更
- **目录**：`modules/dsh-token-pet` → `modules/workspace-tokenpet`（`git mv`，历史保留）
- **包名**：`dsh-token-pet` → `workspace-tokenpet`；**版本**：`0.2.1-lina.1` → `1.0.0`
- **插件运行时 id**：统一为 `workspace-tokenpet` —— cordis.patch.yml 的 entry `id`/`name`、
  客户端 bundle 的 `__ModuleLoader__.load({ id })`、宿主与客户端 `export const name`、
  设置分区 id、shell.overlay / conversation dock 插槽 id、日志前缀、插件来源标识
- **路由前缀**：`/token-pet/...` → `/workspace-tokenpet/...`
  （skins 清单 / 单文件、usage、usage/reset、usage/restore、usage/trend 系列、usage/lifetime、
  index 系列、prompt/enhance、strips）
- **运行时数据目录**：`~/.dsh/data/dsh-token-pet/` → `~/.dsh/data/workspace-tokenpet/`
  （`skins/` 套装与 `baseline` 计数一并迁移；安装器**新址优先**，新址缺套装且旧址有同名套装时
  从 `~/.dsh/data/dsh-token-pet/skins/` **复制迁移**，旧数据保留、绝不覆盖使用者已有套装）
- **客户端本地状态键**：localStorage key `workspace-tokenpet.settings.v1`、
  IndexedDB 库名 `workspace-tokenpet`、事件名（settings-changed / preview-action）、
  样式标识属性同步重命名 —— **旧偏好不会自动继承**，迁移后需在「桌面形象」设置面板重新确认

### 移除
- `patches/`：`0001-lina-customizations.patch`、`0002-pet-hitbox.patch`、`UPSTREAM-BASE.txt`、
  `UPSTREAM-CHANGELOG.md`、`UPSTREAM-README.md` / `.en.md`、`upstream-docs/**`（含 media/）
- `scripts/apply-customizations.ps1` / `.sh`（补丁应用封装）与 `scripts/upstream/**`
  （上游脚本副本、素材生产流水线、`__pycache__` 编译缓存）
- package.json 中随之失效的 scripts（`smoke:runtime` / `audit:qpet-art` / `verify:published`）与
  `files` 里的 `patches`

### 法律与元数据
- `LICENSE`：**保留上游 MIT 版权行** `Copyright (c) DSH Token Pet contributors`，并新增本项目版权行
- `NOTICE`：改写为「本项目 + 致谢上游（项目名 / 仓库 / 许可 / 基线 commit）」；上游版权与许可文本未删除
- `package.json`：`bugs.url` 指向本仓库 issues；`repository.directory` = `modules/workspace-tokenpet`

### 文档
- `README.md` 重写为独立项目文档（定位 / 功能清单 / 安装 / 开发与构建 / 致谢）；
  `README.en.md` 同步为英文版

---

## 0.2.1-lina.2 — 未发布（文档口径修订 · 2026-09-13）

**只改文档，不改代码与素材**：`README.md` / `NOTICE` / `cordis.patch.yml` 注释与仓库实际形态对齐 ——
形象素材（`default` 上游内置 + `lina-pure` / `lina-lazy` 自有形象）**随本模块分发**，
此前误写「不入库 / 不随包分发 / 不随本目录分发」（那是纯补丁形态时期的措辞）；
同时说明安装器会把**缺失**的套装部署到 `~/.dsh/data/dsh-token-pet/skins/`（只补缺失、绝不覆盖）。
`package.json` 版本号本次不动（文档修订，随集成体统一升版）。

## 0.2.1-lina.1（2026-09-13）

### 新增
- **多形象套装（运行时）**：宿主扫描 `~/.dsh/data/dsh-token-pet/skins/`，manifest 校验 + 路径穿越防护 + 两条精确路由（清单 / 单文件）
- **客户端套装解析与播放**：`parseSkinPack` / `skinToActionSpecs` / `maxCellAspect`；`actionSpecs` prop；素材经 fetch 桥取回转 blob URL
- **「形象套装」设置面板**：列表走接口、显示动作数、目录说明与预览
- **「设为默认形象」按钮** + `defaultSkinId` 设置项（与"当前使用"分离）
- **单元测试** `tests/lina-skins.test.mjs`（8 项：路径穿越 / 坏 manifest / 未知动作 / 缺失目录等）

### 修复
- **条带切帧错误**：宿主未透传 `rows` 字段，客户端回退到内置模板的 rows（内置有一个动作是 `cols:16 / rows:2`）→ 单行条带被按每帧 720px 切，宠物显示"两个细长人影"。改为透传 `rows`。
- **趋势功能刷错误日志**：宿主缺 `listSnapshots()` 导致每次 durability fence 失败重试 → 新增 `supportsSnapshots()` 能力守卫，不支持时一次性提示并优雅降级。

### 变更
- 默认形象：`default`（内置）→ `lina-pure`（小秘书·纯欲乖巧版）；新增"从未主动选择过则回落到 `defaultSkinId`"逻辑（用户主动选过内置 `default` 亦被尊重）
- 移除两个 UI 装饰：`aura`（环绕人物绿色椭圆光圈）、`meter`（脚底饱食度横条）
- 版本号：`0.2.0` → `0.2.1-lina.1`

### 验证
- `tests/lina-skins.test.mjs` 8/8 通过
- `npm run typecheck` / `npm run build`（host + client）通过
- 真机实测：清单路由 200、12 条带全 200、路径穿越 404
- 配套形象素材经官方 `check_sprite.py` **ALL PASS**（两套 × 12 动作）

### 0.2.0 及更早（上游基线）
- 上游 `dsh-token-pet` v0.2.0（commit `cc49233f8d951dff7d979ee500ae74918497978e`）为本模块的历史基线；
  其变更记录见上游仓库。
