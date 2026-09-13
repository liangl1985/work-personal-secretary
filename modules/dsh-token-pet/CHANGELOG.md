# Changelog — dsh-token-pet 定制层

> 基线：上游 `cc49233`（v0.2.0）。补丁见 `patches/0001-lina-customizations.patch`。

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
