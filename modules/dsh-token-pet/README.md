# dsh-token-pet（小秘书定制层）

> **定位**：三方插件 `dsh-token-pet` 的**本地定制层**。不 fork 整包、不 vendor 素材，
> 只以**补丁**形式保存我们对上游的改造；上游升级时重新应用即可（见第四节）。
> 上游为 **MIT** 许可，本目录保留其 `LICENSE` 与 `NOTICE`。

---

## 一、上游与基线

| 项 | 值 |
|---|---|
| 上游仓库 | `https://github.com/Jimmy0123-ux/dsh-token-pet` |
| 基线 commit | `cc49233f8d951dff7d979ee500ae74918497978e`（v0.2.0） |
| 许可 | MIT |
| 定制后版本 | `0.2.1-lina.1` |
| 补丁 | `patches/0001-lina-customizations.patch`（12 文件 / 约 64 KB） |

> 基线 commit 另存于 `patches/UPSTREAM-BASE.txt`，供升级时比对。

---

## 二、改造清单（相对基线，共 12 个文件）

### 2.1 多形象套装：让"换皮肤"真正生效
上游只有一套**编译期内嵌**素材，`skinId` 是"半成品开关"（选了也不换装）。本次改造把素材来源改为**运行时可解析**：

| 文件 | 改动 |
|---|---|
| `src/skins.ts` | **新增**：套装目录扫描、manifest 校验、路径穿越防护、按请求读文件、清单 URL 重写 |
| `src/index.ts` | 注册 2 条路由（`/token-pet/skins` 清单 + `/token-pet/skins/file` 单文件）；新增 `supportsSnapshots()` 能力守卫（宿主无 `listSnapshots` 时趋势功能优雅降级） |
| `src/client/skin.ts` | 新增 `SkinPackManifest` / `parseSkinPack` / `skinToActionSpecs` / `maxCellAspect`，把 manifest 转成播放器 spec |
| `src/client/pet.tsx` | 新增 `actionSpecs` prop：条带来源由"写死内嵌"改为"当前套装优先、内置兜底" |
| `src/client/pet-action-player.tsx` | `MAX_CELL_ASPECT` 由模块常量改为可传入（套装 cell 比例不同也能正确裁切） |
| `src/client/index.ts` | 拉取 `/token-pet/skins`；套装素材经 fetch 桥取回转 **blob URL** 交给播放器 |
| `src/client/host-url.ts` | **新增**：宿主 URL 解析辅助 |
| `src/client/skin-panel.tsx` | 重写为「形象套装」选择器（列表走接口、显示动作数、目录说明） |
| `tests/lina-skins.test.mjs` | **新增**：8 项单元测试（路径穿越 / 坏 manifest / 未知动作 / 缺失目录等） |

> 为什么素材走 fetch 桥而不是 `<img src>`：桌面载体的 host **只认 exact 路由**，静态前缀路由实测 404。

### 2.2 条带切帧修复（关键 bug）
| 文件 | 改动 |
|---|---|
| `src/skins.ts` | `SkinActionSpec` 补 `rows` 字段并在解析时透传 |

**原因**：host 端原本丢弃 `rows`，客户端 `skinToActionSpecs` 读不到就**回退内置模板的 rows**——内置恰好有一个动作是 `frameW:660 / cols:16 / rows:2`，于是单行条带被按每帧 720px 切，一格里出现两个单元（表现为"宠物显示两个细长人影、颜色错乱"）。

### 2.3 UI 清理与默认形象
| 文件 | 改动 |
|---|---|
| `src/client/pet.tsx` | 删除两个装饰：`aura`（环绕人物的绿色椭圆光圈）与 `meter`（脚底饱食度横条）——二者无条件渲染且与素材无关 |
| `src/client/settings.ts` | 默认 `skinId` 改 `lina-pure`；新增 `defaultSkinId`（与"当前使用"分离）；"从未主动选择过"时回落到默认形象 |
| `src/client/skin-panel.tsx` | 新增「**设为默认形象**」按钮 + 默认形象提示（下拉只切"当前使用"，按钮才定"默认"） |

---

## 三、安装（本机 desktop profile）

```powershell
# 1) 取上游基线
git clone https://github.com/Jimmy0123-ux/dsh-token-pet
cd dsh-token-pet
git checkout cc49233f8d951dff7d979ee500ae74918497978e

# 2) 应用定制补丁（本目录的脚本封装了这一步）
pwsh modules/dsh-token-pet/scripts/apply-customizations.ps1 -Target <克隆目录>
#   *nix:  bash modules/dsh-token-pet/scripts/apply-customizations.sh <克隆目录>

# 3) 安装依赖并构建
npm install
npm run build            # build:host (tsc) + build:client (tsdown)

# 4) 挂进 profile
dsh plugin --profile desktop add link:<克隆目录绝对路径>
#   改完 host 侧需重启 DSH Desktop；只改 client 时刷新页面即可
```

**形象素材随模块分发**：三套套装就在 `skins/<套装id>/`（`manifest.json` + `<action>.webp` 条带，
共 42 个文件）；安装 `dsh-token-pet` 时安装器会把**缺失**的套装部署到
`~/.dsh/data/dsh-token-pet/skins/`（只补缺失、**绝不覆盖**使用者改过的套装）。
目录为空时宠物回退到插件内置素材，不会报错。

---

## 四、升级（跟随上游）

```powershell
git fetch && git log --oneline <新commit>          # 看上游改了什么
git checkout <新commit>
pwsh scripts/apply-customizations.ps1 -Target .    # 重新应用（有冲突时按补丁意图手工合并）
npm install && npm run build
```

**升级前建议**：先跑 `node tests/lina-skins.test.mjs` 确认改造层完好。

---

## 五、许可与归属

- 上游代码：**MIT**，Copyright (c) DSH Token Pet contributors —— 全文见 `LICENSE`；
- 本定制层的改动同样以 MIT 提供，归属与边界见 `NOTICE`；
- **形象素材**：`default` 为上游内置形象（MIT）；小秘书两套形象（`lina-pure` / `lina-lazy`）为使用者自有资产，**随本模块分发**（见 `skins/`），未经授权不得再分发或商用；运行时由安装器部署到 `~/.dsh/data/dsh-token-pet/skins/`。

---

## 六、验证

> ⚠️ 本模块的回归测试 import 的是**上游构建产物** `../lib/skins.js`，
> 因此**必须在上游克隆目录（已应用补丁 + 已 `npm run build`）里执行**，不能在集成体内直接跑。
> 集成体 CI 也不会跑它——CI 只遍历约定的 `scripts/regression.mjs` / `smoke-load.mjs` / `coexist.mjs`，本模块不含这些文件。

```powershell
# 以下命令均在上游克隆目录（已应用补丁）执行
node tests/lina-skins.test.mjs     # 单元测试 8 项：路径穿越 / 坏 manifest / 未知动作 / 缺失目录 …
npm run typecheck                  # 类型检查（host + client）
npm run build                      # 构建（tsc + tsdown）
```

**补丁自检**（可在集成体内跑，验证补丁能否干净应用到基线）：

```powershell
pwsh modules/dsh-token-pet/scripts/apply-customizations.ps1 -Target <克隆目录> -Check
```

本机实测结论（2026-09-13）：清单路由 200 · 12 条带全 200 · 路径穿越 404 · 单元测试 8/8 · typecheck 与构建通过 · 两套形象官方素材校验 ALL PASS · 补丁在基线 `cc49233` 上**预检通过且应用后与工作区逐文件 SHA256 一致**。

---

*小秘书 · 2026-09-13 · 定制层整理入集成体*
