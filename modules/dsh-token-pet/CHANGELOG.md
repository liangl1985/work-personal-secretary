# Changelog — dsh-token-pet 定制层

> 基线：上游 `cc49233`（v0.2.0）。补丁见 `patches/0001-lina-customizations.patch`。

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
- **修复：`scripts/apply-customizations.ps1` 在 Windows PowerShell 5.1 下解析失败** —— 脚本含中文提示却为**无 BOM 的 UTF-8**，5.1 按 ANSI 代码页读取 → `Unexpected token '鉁?棰勬閫氳繃" -ForegroundColor Green`、退出码 1（pwsh 7 下正常）。已用 Node `fs` 为该文件补 **UTF-8 BOM**（`EF BB BF`）：行尾保持原样（纯 LF）、内容除 BOM 外逐字节不变；修复后 5.1 下 `-Target <干净基线克隆> -Check` **退出码 0 并打印「✓ 预检通过」**。补丁 `patches/0001-lina-customizations.patch` 不包含该脚本，故不影响补丁校验；同仓「坑②」的无 BOM 纪律只约束 profile JSON / `settings.yaml`，不适用于需 5.1 解释的 `.ps1`。**本条为集成体正式发布前修订，版本号不变。**
