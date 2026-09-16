## 0.2.4 — 2026-09-16（③a 第二批：8 类页型几何真值 + 3 个组件）

### 一、这一步做了什么

**核心 11 类页型的几何真值已齐**（②a 三类 + 本批八类）：`toc` · `section` · `compare` · `data` · `chart` · `table` · `quote` · `closing`；组件新增 **`kpi`**（数据卡）· **`toc_item`**（目录条目）· **`compare_panel`**（对比面板）。

| 页型 | 结构 | 关键几何（容量按实测行高 1.228） |
|---|---|---|
| `toc` | 骨架 + 单列条目网格（槽 11.7333×0.52） | 最多 8 条：8×0.52 + 7×0.08 = 4.72 ≤ 4.75 |
| `section` | 深色底（**不继承骨架**）+ 编号 + 40pt 标题 + 短线 + 深底页码 | 标题单行 0.921 ≤ 1.0 |
| `compare` | 骨架 + 两个等宽面板（槽 5.6916×4.6、间距 0.35） | 2×5.6916 + 0.35 = 11.7332 ≤ 版心 |
| `data` | 骨架 + 4 个 KPI（槽 2.7083×1.6）+ 说明要点 5 行 + 来源 | 4×2.7083 + 3×0.3 = 11.7332；说明 2.858 ≤ 2.9 |
| `chart` | 骨架 + 图表区（区域/类型/图例/数据标签；系列色走 `color_roles.chart_series`）+ 来源 | 区域底 6.4 与来源行 6.95 不重叠 |
| `table` | 骨架 + 表格区（字号引用 `table_header`/`table_cell`）+ 来源 | 同上 |
| `quote` | **不继承骨架**（引文页无页标题）+ 居中引文 28pt + 短线 + 出处 + 页码 | 3 行 1.862 ≤ 2.4 |
| `closing` | 深色底 + 居中 40pt 致谢 + 短线 + 可选副标题 + 深底页码 | 单行 0.921 ≤ 1.0 |

字号新增：`quote` 28 · `kpi_value` 36 · `table_header` 14 · `table_cell` 14。
**role ↔ manifest 字段映射约定**写入 `_note_geometry` ⑨：默认同名（title / subtitle / kicker / index / source / text / attribution / value / label / page），仅两处例外（bullets 页要点字段 `bullets` → role body；data 页说明字段 `body` → role body）；grid 槽位内字段取自对应条目的同名字段。

### 二、目检抓出并修掉的问题

`quote` 页引文最初 role 写作 `quotation`（与 manifest 字段 `text` 不同名）→ 按字段取值取空、**引文不显示**；改为 `role: "text"` 后正常 —— 这条正是把「role 默认等于字段名」固化成约定的原因。

### 三、验证

- `spec_sync --check` **0**（11 类页型 + 7 个组件全部通过几何校验：页内不越界、引用不悬空、容量自洽、网格不超区、extends 合并后仍校验）
- `style-test` **24 / 0**
- 几何预览样张 8 页（`E:\lina\.dsh\tmp\b-line-render\png-geom8-v2\`，源 `samples\geom-8-v2.pptx`）逐页目检通过

### 四、未做（③a 继续）

- **渲染实现**：`ppt_render.py` 目前只画 cover / bullets / cards；本批八类的绘制（chart/table 的原生对象、toc/compare/data 的组件槽位）待实现
- 组件 `chip` / `bar` / `ring`（`ring` 待小样验证）
- `ppt-render-test.mjs` ≥15 例；`assets/` 最小集与 `files` 白名单（⑤ 步）

### 五、回退

版本改回 **0.2.3** 或 `git revert` 本提交；profile 同步一次即可。

## 0.2.3 — 2026-09-16（③a 第一步：几何容量口径统一）

### 一、这一步做了什么

把 ②a 定稿的几何从「设计口径」改成「WPS 实测口径」：**行高 = 字号 ÷ 72 × 1.228 × 行距**（1.228 = ②b 出图像素实测的单倍行高系数），三处口径统一并加门禁。

- `specs/standard.json` 逐项重算（对照脚本 `diag_geom.py`），修正 7 处：
  - `layouts.cover.title` box.h 1.72 → **1.74**（2 行 @44pt×1.15 = 1.7274）
  - `layouts.cover.subtitle` box.h 0.90 → **0.98**（2 行 @22pt×1.3 = 0.9758）
  - `layouts.bullets.body` max_lines 9 → **8**（8 行 × 0.4605 + 7 × 0.1389 = 4.656 ≤ 4.85；9 行 = 5.255 放不下）
  - `layouts.bullets.source` / `layouts.cards.source` box.h 0.30 → **0.33**（单行 14pt = 0.3223）
  - `components.card.title` box.h 0.40 → **0.46**（单行 22pt×1.2 = 0.4503）
  - `components.card.body` y 1.28 → **1.32**、max_lines 3 → **2**（2 行 @16pt×1.25 = 0.682 ≤ 0.86；3 行 = 1.0233 放不下）
  - `_note_geometry` 与各页型 `_note` 同步写明新口径与实测依据
- `scripts/spec_sync.py`：新增常量 `SINGLE_LINE_EM`，容量判据与「无 autofit 单行」检查同口径
- `scripts/style-test.mjs`：两处容量断言改口径，并**新增用例「行高口径三处一致」**（读 `spec_sync.py` 与 `ppt_render.py` 的常量与自身比对，防口径漂移）→ 23 → **24 例**
- `scripts/office/ppt_render.py`：常量注释补「三处一致」

### 二、为什么改（依据）

②b 出图目检 + 像素实测：20pt / 行距 1.35 时相邻段起点间距 57px = 行高 44.2px（0.4605 in）+ 段距 10pt；19pt 同段两行间距 42px = 0.4375 in。旧口径「字号 × 行距 ÷ 72」对 19pt 只有 0.3563 in，**低约 23%** —— 会让「放不下的文本被判成放得下」。详见 0.2.2 段与 58 号第九节。

### 三、验证

- 容量对照脚本逐元素复核：**违规 0 项**（12 个文本元素全部自洽）
- `spec_sync --check` **0** · `style-test` **24 / 0**
- 样张重出（`E:\lina\.dsh\tmp\b-line-render\png-v6\`）：四页字号决策与 v5 一致（cover 44/22/14/14、bullets 20、cards 22/16、超容量页 20→18pt），卡片页视觉与 v5 一致（正文仅下移 0.04 in）
- 仓库 ↔ profile 逐文件 SHA256 一致

### 四、未做（③a 继续）

- 核心 11 类中剩余的 8 类页型（toc / section / compare / data / chart / table / quote / closing）
- 组件 `chip` / `kpi` / `bar`（`ring` 待小样验证）
- `ppt-render-test.mjs` ≥15 例；`assets/` 最小集与 `files` 白名单（⑤ 步）

### 五、回退

版本改回 **0.2.2** 或 `git revert` 本提交（几何与门禁同批回滚）；profile 同步一次即可。

## 0.2.2 — 2026-09-16（B 线施工 ②b：ppt_render.py 最小版 + ②c 样张验收）

### 一、这一步做了什么

把几何真值变成**可调用的渲染能力**：新增 `scripts/office/ppt_render.py`（manifest → pptx）与 `specs/ppt-manifest.schema.json`（manifest 字段规范）；②b 先覆盖 cover / bullets / cards 三类页型。

命令面：`render <manifest> <out.pptx> [--theme] [--assets] [--dry-run]` · `validate <manifest>` · `list-layouts [--theme]`；退出码 `0` 成功 / `2` 参数或 manifest 校验失败 / `5` 缺 Pillow 或字体文件。

- **manifest 契约（AI → 渲染器的唯一交接）**：`specs/ppt-manifest.schema.json` 是 JSON Schema（draft 2020-12），`validate` 由它驱动；**零新增依赖**（自写子集校验器：type / required / properties / items / allOf / if-then / $ref）。兼容规则：未知 layout → 退化为 bullets 并告警；未知字段 → 忽略；缺必填 → exit 2 并指明页号（`manifest.slides[N].xxx`）；超 `limits.max_slides` → 保留首页 + 中段 + 末页。
- **渲染**：完全读 `pptx` 几何（不写死尺寸 / 字号 / 色值）；`inherits: content_page` 先画骨架、本页元素随后覆盖；`elements` 顺序即 z 序；`optional` 元素按 manifest 是否给值决定画不画；`chrome.page_number` 的 `show` / `skip_layouts` / `format` 生效；`notes` 数组按索引写入演讲者备注（单页 `notes` 优先）。
- **自动缩字号**：Pillow 按**字符**换行（python-pptx 的 `fit_text()` 对中文不可用）；超容量按整磅下探到 `autofit.min_size_pt`，到下限仍放不下则**告警**（不静默丢字）。
- **卡片**：网格 ≤3 单行 / 4 张 2×2 / 5–6 张 3×2（`valign: middle` 垂直居中）；超容量省略并告警；图标槽位 = 素材 PNG 优先 → **内置几何标记**（坐标画，天然同心）→ 使用者显式单字符仍走文本。

### 二、两处口径修正（②b 出图目检实测，均有像素证据）

| # | 问题 | 依据（本机实测） | 修正 |
|---|---|---|---|
| 1 | **行高口径偏乐观约 23%**：几何与 `spec_sync` 用「字号 × 行距 ÷ 72」当行高；WPS 实际行高是「字号 × **1.228**（单倍行高）× 行距」 | 96 px/in 出图量得：20pt / 行距 1.35 → 相邻段起点间距 57px（行高 44.2px + 段距 10pt）；19pt / 1.35 → 同段两行间距 42px = 0.4375 in | 渲染器改用实测行高判定（更保守，宁缩不溢）；常量 `SINGLE_LINE_EM = 1.228` 处附实测数据与换字体重校准方法 |
| 2 | **项目符号圆点未对齐首行**：原按「整段中线」定位，多行段的圆点落到段中部 | 出图目检 + 像素量（4 个圆点中心与对应文本带中心差 0.5~3.5px） | 改为对齐**每段首行中线**，与容量判定共用同一行高 |

**同时处置的边界**：`box.h` 是按旧口径设计的，比 WPS 实际行高小 1~3pt —— 若一律按真实行高收缩，会把 ②a 已确认的设计字号系统性压小（实测会出现来源行 14→13pt、卡标题 22→19pt）。故规定：**单段单行元素只校验宽度、不因行高收缩**（溢出量 ≤0.06 in，不会压到相邻元素）；多段或需要换行的文本严格判定。

### 三、图标同心度修正（②c 主人目检提出）

字体符号字符由 WPS 自行排版，实测白色字符 ink 中心比圆盘中心偏左上 1~2px（卡 3 的方形符号偏下 4.8px），放大到大屏可见。改为**几何形状标记**（`ICON_MARKS`：shield→菱形 / eye→圆环 / lock→圆角方块 / chart·doc→方块 / gear·net→六边形 / flag·bolt→三角，未知名兜底菱形；边长 = 槽位 × 0.42），同心度由坐标保证 —— 复核 **Δx ≤ 0.16px、Δy ≤ 0.10px**。

### 四、验证

- `spec_sync --check` **0**（新增 `*.schema.json` 跳过规则：字段规范不参与样式规格校验，但仍随 `specs/` 同步到 profile）
- `style-test.mjs` **23 / 0**（A 线零回归）
- ②b 自测 **17/17**：缺必填（指名页号）· 未知 layout 退化 · 未知字段忽略 · JSON 带 BOM 拒绝 · 非法 JSON · `max_slides` 裁剪 · `notes` 写备注 · 自动缩字号 · 缩到下限告警 · cards 超 6 张拒收 · 文件不存在 · 样张 4 页
- ②c 样张：`render` → WPS COM 出图 4 页（cover / bullets / cards / bullets 超容量自动缩 20→18pt），**主人目视验收通过（2026-09-16）**；行内与段间距、圆点对齐、无溢出均经像素复核
- 仓库 ↔ profile 逐文件 SHA256 一致

### 五、踩坑记录

- WPS COM 出图仍会留下进程（`wpp` + `wps`），按**启动时间**甄别清理；使用者自己开着的 WPS 绝不碰
- JSON 一律用 Python/Node 写：PowerShell 带 BOM，渲染器会直接拒绝（并给中文提示）

### 六、未做（下一步 ③a / ③b）

- 其余 13 类页型（toc / section / compare / data / chart / table / quote / closing / image / process / timeline / case / qa）
- 组件 `chip` / `kpi` / `bar`（`ring` 待小样验证）；`assets/` 最小集与 `files` 白名单（⑤ 步）；生图 / 图示链路（⑥ 步）；`ppt_style.py` 存量美化（④ 步）
- **几何容量口径统一**：`specs` 声明的 `max_lines` 与单行框高按旧口径反算，比 WPS 实际乐观约 23%。建议 ③a 第一件事按 1.228 系数重算一遍几何容量（属 ②a 已定稿内容，需主人点头后动）
- `ppt-render-test.mjs` ≥15 例（③a 验收项）；对比度门禁（②a 遗留）

### 七、回退

1. 版本改回 **0.2.1**（或 `git revert` 本提交）
2. `dsh plugin --profile desktop install --force`（profile 里是 `file:` 副本，不重装不生效）
3. 重启 DSH —— 本次只改 `scripts/**.py` 与 `specs/*.json` 且新增 `scripts/office/ppt_render.py`，**免重启**
4. ②b 主体是纯新增文件（`ppt_render.py` / `ppt-manifest.schema.json`），删除即回到 ②a 状态；`cli_guard.py` 与 `spec_sync.py` 各只改 2 行，可单独 `git checkout --` 回滚

## 0.2.1 — 2026-09-16（B 线施工 ②a：PPT 几何真值落笔）

### 一、这一步做了什么

把 PPT 从"设计"推进到"有真值可渲染"：`specs/standard.json` 的 `pptx` 段补齐 **cover / bullets / cards 三类页型的真实几何**（英寸、原点左上、页面坐标系），并新增内容页共用骨架与卡片组件。

- **`content_page`（新增）**：内容页共用骨架（页标题 32pt / 分隔线 / 页码），`layouts.*` 以 `"inherits":"content_page"` 引用 —— 避免 13 类内容页各抄一遍标题几何，真值唯一。
- **`layouts.cover`**：深色封面（全幅 panel_dark + 左侧 44pt 大标题 + kicker/副标题/meta 三个可选位 + 装饰分隔线）。
- **`layouts.bullets`**：标题骨架 + 单栏要点区（20pt、行距 1.35、自绘圆点、悬挂缩进 0.32）+ 可选来源行。
- **`layouts.cards`**：标题骨架 + 3 列 × 最多 2 行网格（列宽 3.6778 / 行高 2.35 / 间距 0.35、行优先、`valign: middle` 单行垂直居中）+ 槽位渲染 `components.card`。
- **`components.card`**：相对坐标卡片（surface_alt 底 + 细边框 + 圆角 + 顶部装饰色带 + 图标/标题/正文）。

### 二、口径（后续页型照此办理）

- 坐标一律**英寸**（与 `margin` 同单位）、`box={x,y,w,h}`、`elements` 顺序即 z 序、`"optional":true` 由 manifest 是否给值决定画不画。
- 文本元素只引用 `sizes_pt` / `color_roles` 的键，**不写死字号与色值** —— 换主题只改色角色。
- `color_roles` 的值允许是**顶层 `colors` 的键**（`primary` / `accent_decor` / `neutral.light` …）；解析链 hex → color_roles → colors。
- `autofit = {min_size_pt, max_lines}`：渲染器用 Pillow 按字符测量，超容量缩到下限，仍放不下则**告警**（不静默丢字）。
- 配色对比度按 WCAG 2.1 AA 实测：浅底正文 10.37:1 · 页码 7.00:1 · 深底标题 8.66:1 · 深底次要字 6.14:1 · 卡片标题 7.74:1；**accent_decor(ED7D31) 两底均 <4.5:1，只作装饰不作文字色**（项目符号圆点因此用 accent B45309，白底 5.02:1）。

### 三、新增校验（几何真值的守护）

`scripts/spec_sync.py` 对**凡带 `pptx` 段的规格**做全量几何校验，错误一律**中文单行 + 具体数值 + exit 2**：

- 页面/元素**越界**（含相对坐标的卡内元素超出卡框）、box 宽高非正
- 引用悬空：`sizes_pt` 字号键、`color_roles`/顶层 `colors` 色角色、`inherits` 指向的段、`grid.slot` 指向的组件
- `autofit.min_size_pt` 大于所引用字号；网格 `cols×col_w + 间距` 超出网格区
- `render_doc` 同步补上 **pptx 段展示**（此前规格展示文档缺该段，属 58 号遗留 #1）

### 四、验证

- `spec_sync --check` **0**；`style-test.mjs` **21 → 23 通过 / 0 失败**（新增两条：①「三类页型齐全且在页内」并带**容量自洽 / 页脚带不重叠 / 色角色存在**断言；②「越界 / 悬空引用 / 缺页型 / 容量不实 / 空页型 / extends 子层越界必须被拒」——15 组负例与正例）
- 几何可视化核验：按 `pptx` 段原样渲染 3 页（cover/bullets/cards）并经 WPS COM 出图目检 → 抓出并修正 **2 处真实缺陷**：① `components.card` 正文框 0.66 in 装不下自称的 3 行（16pt×1.25 需 0.83 in）；② cards 页单行卡片顶部对齐导致下方留白 2.7 in（改 `valign: middle` 垂直居中）
- 仓库 ↔ profile 逐文件 SHA256 一致（`specs/standard.json` `7e3096ce…`）

### 五、独立复核与修订（2026-09-16 · 代码审查视角，只读复核）

一次独立复核（几何反算表 + 17 组校验探针 + 对比度全量复算）判为「**需修后合并**」：无安全/数据损坏类问题，但几何本身有 1 处容量矛盾、1 处页内框相交，且新校验对 `extends` 自定义层完全不生效。逐条修订：

| # | 复核发现（级别） | 修订 |
|---|---|---|
| 1 | **阻塞**：`bullets.body` 声称 `max_lines=12`，按自己的字号（20pt×1.35）+ 10pt 段距只能放 **9 行**（10 行 = 5.000 in > 4.85） | 改 `max_lines: 9`；并按 55 号第十三章 #3「正文 20（下限 18）」把 `min_size_pt` 16 → **18**（18pt 下同框可容 10 行） |
| 2 | **建议（最大缺口）**：`extends` 派生规格**完全绕过** pptx 校验（实测塞 `box.w=99` + 悬空字号 + 错色值全放行），而主题一律 extends 派生 → 新校验对真实自定义主题形同虚设 | `spec_sync` 新增 `deep_merge` / `_merge_chain`：继承件**先合并基座再校验**，基座缺失或成环明确报错。探针实测：子层只改 `colors.primary` 放行；子层几何越界 / 超容量被拦 |
| 3 | 建议：缺 box.h ↔ max_lines 容量检查（阻塞 1 未被拦住的根因） | 新增容量判据 `max_lines×字号×行距÷72 + (max_lines−1)×段距 ≤ box.h`；并对**无 autofit** 的文本元素加「单行也必须放得下」检查 |
| 4 | 建议：`cards.grid` 底 6.85 与 `source` 顶 6.72 **重叠 0.13 in**（2 行卡片时框线穿来源行） | `source` 统一下移到 y=6.95，与页码同处页脚带（x 不重叠） |
| 5 | 建议：`card.icon` 28pt×1.35 = 0.525 in > box.h 0.48（可容 0 行且无 autofit） | icon 显式 `line_spacing: 1.0`（0.389 ≤ 0.48）+ `autofit{min 20, max_lines 1}` |
| 6 | 建议：色角色白名单未过滤 `_` 前缀与 dict 值 → `fill="_note"` / `fill="chart_series"` 实测放行（渲染器会崩） | `allowed` 只收字符串值键；dict 值改为「父.子」子键（`chart_series.s1` 放行、`chart_series` 拒绝） |
| 7 | 建议：`cover.elements=[]` / 空骨架静默通过 | 三类页型与 `content_page` 的 `elements` 必须是**非空数组** |
| 8 | 小改：`col_w_in 3.6778` → need_w 11.7334 微超网格区宽 11.7333 | 改 **3.6777**（卡内宽同步 3.1177） |
| 9 | 小改：`card.line.color` 写死 hex；`text.size` 非字符串会抛 TypeError；`inherits` 指向后声明段会误报；`page_number` 的 `show` 与 `chrome` 重复 | 分别改为色角色 `card_line`、显式类型报错、**两阶段**校验、删冗余字段 |
| 10 | 存疑：封面页码（全局 `show` 而 cover 无页码元素） | `chrome.page_number.skip_layouts: ["cover"]` 显式声明封面不画页码 |
| 11 | 存疑：`gap_after_pt` 是否含最后一段 | 新增 `bullet.gap_between_only: true`，校验公式用 `(n−1)×gap`，渲染器同口径 —— 否则 12 行也才勉强 4.5 in，与 gap=10 直接冲突 |
| 12 | 存疑：对比度无门禁 | 写入 `_note_geometry` ⑧ 并列入本节遗留（②b/③ 补自测） |
| 13 | 小改：`specs/*.bak-*` untracked 且 `.gitignore` 无规则 | 仓库根 `.gitignore` 加 `*.bak-*`（该文件为**混合编码**，按字节追加、既有内容零改动） |

**自证**：把上述复核项写成 14 组校验探针（`E:\lina\.dsh\tmp\b-line-spec\probe_validate.py`，临时不入库），**19 项全部符合预期**。探针还抓出复核未发现的一处口径不一致 —— 校验器把「未写 `line_spacing`」默认成 1.0，而渲染约定应回退 `pptx.spacing.line_spacing`（1.35），会让 `card.icon` 这类元素蒙混过关；已统一口径并在 `style-test.mjs` 中固化为门禁。

**复核确认成立、无需改的**：几何反算逐项、`_note_geometry` 的 9 项对比度数字（独立复算全部吻合）、贴版心余量、`compact` 主题对比度（6.89 / 7.71）、A 线 21 条零回归、异常路径不偏离 exit 2、回滚备份 `standard.json.bak-20260916-143128`（②a 前版本、无 pptx 段）可用。

### 六、踩坑记录（对后续样张环节有用）

- **WPS COM 导出同名文件会返回上一次的缓存画面**：重渲染同名 pptx 后导出的 PNG 与旧图逐字节相同；改用新文件名即正常。出样张时务必换名，或确认图与源同批。
- WPS COM `Quit` 后进程可能残留（本次 `wpp`/`wps` 各一），需按**启动时间**甄别后清理 —— 不要盲杀使用者自己打开的 WPS。

### 七、未做（下一步）

- `ppt_render.py` 最小版（②b）与样张（②c）—— 当前几何只是**真值**，尚无可调用命令
- 其余 13 类页型（③a/③b）、`chip`/`kpi`/`bar`/`ring` 组件、主题库（后置）
- **对比度门禁**：目前只靠人工实测，规格校验不拦截（55 号第九章列为验收项）

## 0.2.0 — 2026-09-15（编号层级与 Markdown 解析修复；新增 5 级标题）

### 一、缺陷来源（真实、可复现）

四组对照测试（同一份火电方案，唯一变量＝专家注入数）中，**A / B / C 三个独立子代理各自撞上同一批工具缺陷**，D 组则被迫改正文规避：

| 组 | 现象 | 实测规模 |
|---|---|---|
| A | `create` 四级标题连井号落成正文；`apply-style` 把正文「（一）」「1、」误升为标题 | 33 处四级标题；36 处误判 |
| B | `apply-style` 编号纠正打乱层级 | 20 处（dry-run） |
| C | 同上 + `**加粗**` 星号进文档 | 46 处误判；16 处四级标题 + 105 段加粗 |
| D | 被迫把正文行首「（1）」改成「1）」以规避误升 | **改动了正文 56 处** |

三组**都因此弃用 `apply-style`**，改用自制版式脚本 —— 核心链路在真实长文档上不可直接用。

### 二、修了什么

**1. 编号层级按深度精确映射**（原：一律压成二级）
- `1` → h1 · `1.1` → h2 · `1.2.1` → **h3** · `1.2.3.4` → h4 · `1.2.3.4.5` → **h5**（封顶 5 级）
- 原实现把 1.1 / 1.1.2 / 1.1.2.3 **全部**判为 `heading_2`

**2. 加标题性判据**（原：编号模式无条件压过命名样式）
- 长度 ≤ 40 字 · 不以句末标点收尾 · 不含句子级标点 → 正文里的编号引导句（「（1）本项目…，…。」）不再被误升
- 编号后必须跟 `、` / `.` / 空格作分隔 → `2020.08.21 修订`、`2020年08月` 等日期行不再被误判（每段限 1–3 位数字）

**3. 新增文档级编号体系判定 `detect_numbering_scheme()`**
- 数字点体系（1 / 1.1 / 1.1.1）：`1.` → h1
- 公文体（一、/（一）/ 1. / （1））：`1.` → **h3**、`（1）` → h4
- 同一形态在两套体系里层级不同，逐段猜会判错，故按整篇口径统一

**4. 「编号模式 vs 命名样式」只在相差 1 级时纠正**
- 相差 1 级 → 判为原文标错并纠正（保留原能力：青海成峰「五、」被标成 Heading 2 → 一级）
- 相差 ≥2 级 → 判为**两套编号体系并存**，尊重原文命名样式（实测消除 C 组稿 9 段整章错位）

**5. Markdown 解析（`create`）**
- 支持 **1–6 级标题**（原只认 1–3 级，`####` 连井号落成正文）
- `**加粗**` 按标记切 run 落成**真加粗**、星号不落盘（原星号直接写进文档）

**6. 新增开关 `roles.level_fix`**：`always`（默认）/ `style`（只纠正已有 Heading 样式的段落）/ `off`（完全按命名样式）

### 三、新增 5 级标题能力（主人 2026-09-15：最多用到 5 级）

- `specs/standard.json` **v1.2 → v1.3**：新增 `Heading 5`（**五号 10.5pt**、加粗、左对齐、`outline_level=4`）；`compact` 经 `extends` 自动继承
- `doc_roles.py`：`MAX_HEADING_LEVEL = 5`、`_STYLE_ALIASES` 补 heading_5；`word_style.py`：`_ROLE_TO_STYLE` 补 `heading_5 → Heading 5`；`word_tool.py`：`read_docx` 前缀映射补 `#### `/`##### `

### 四、验收（实测）

- `style-test.mjs` **19 → 21 通过 / 0 失败**（新增「A2.4 编号层级」「A2.4 Markdown 解析」；`standard` 样式数断言 5 → 6）
- 端到端：`source.docx`（298 段）编号标题判定 **10 → 7**，3 条 CEMS 备注正文不再被误升；`1、全面安全风险评估` 恢复识别；日期行排除
- 对 C 组稿 `apply-style --dry-run`：错位由 46 段降至 9 段（余下为无样式段落的体系固有歧义）
- experts `regression` **46/0**；本机 profile 4 个文件 SHA256 一致

### 五、已知局限（如实记录）

- **混合编号体系的无样式段落**仍有歧义：文档同时存在 `1.1` 与 `（一）` 时，无样式段落里的 `1、` 按数字点体系判为一级（实际可能在「（一）」之下）。可用 `level_fix: "style"` 收紧，或先给原文补齐 Heading 样式再套版式。
- `read_docx` 导出的 Markdown 不还原 `**加粗**`（往返会丢加粗标记），待后续对齐。

## 0.1.9 — 2026-09-15（A2.3：Word 字体统一 —— 全文单一「仿宋」）

- **根因（实测，两处）**：
  1. **命名样式覆盖不全** —— 规格只列 Normal / Heading 1-3，文档实际还用了 `Title` / `List Bullet` / `List Number` / `List Paragraph`，其字体仍是原文的「仿宋」，与正文的「仿宋_GB2312」**是两个不同字体名、视觉不一致**；
  2. **表格内 run 的直接字体未清** —— `_strip_run_fonts` 只遍历 `doc.paragraphs`，而 **python-docx 的 `doc.paragraphs` 不含表格内段落**（实测四属性全量统计 1564 处，其中表格 334 处 run 保留了直接格式）。
- **修复**：
  1. 新增 `iter_all_paragraphs()`：遍历正文 + 表格（**含嵌套表格**）内全部段落；`_strip_run_fonts` 改用它，并**同时清理段落级 `pPr/rPr` 的 rFonts/sz**；
  2. 新增**样式族 `style_families`（规格可配）**：把文档里**实际存在但 `styles` 段未逐条列出**的样式按角色族统一字体 —— body 族（Normal / Body Text / List* / Table Grid / Normal Table / No Spacing …，含前缀匹配）与 heading 族（Heading 1-9 / Title / Subtitle）；**只改字体，不动字号与段落格式**；
  3. **字体口径（主人 2026-09-15 定）**：全文**只允许「仿宋」一种** —— 英文/数字/汉字、正文与标题、表格与表头一律仿宋，`w:rFonts` **四属性(ascii/hAnsi/eastAsia/cs) 全 = 仿宋**；层级只靠**字号 + 加粗 + 对齐**区分；**不做字体优先级/回退链**；弃用「仿宋_GB2312」（多数机器未装、有回退风险）；
  4. 新增 `all_font_names()`（四属性统计）+ **落盘前字体统一性校验**：出现规格外字体（`allowed_fonts = ["仿宋"]`）即**拒绝产出**。
- **实测（原件副本）**：

  | 样本 | 修复前字体集合 | 修复后 |
  |---|---|---|
  | 青海成峰开票对账说明 | `{仿宋}`（正文/标题/表格曾混用多字体名，视觉不统一） | **`{仿宋}`** |
  | 羊曲水电站治安反恐防范简介 | `{仿宋, 黑体}`（标题黑体） | **`{仿宋}`** |

  内容零改动断言均通过（逐段 + 逐单元格，差异 0）。
- **回归 16 → 19 例**：新增「规格口径（allowed_fonts 单一）」「实现齐备（样式族 + 表格/段落清理 + 四属性断言）」「端到端：字体集合恒为 `{仿宋}`（样本含表格/英文/数字/直接格式污染）」。
- 顺带：`word_style.py` 内 `Times New Roman` / `Arial` / `黑体` / `仿宋_GB2312` 兜底默认值全部移除，统一为仿宋。
- **字号 / 加粗定案（主人 2026-09-15 选 A 方案）**：`Heading 2`（14pt）与 `Heading 4`（12pt）由**不加粗 → 加粗** —— 原实现下 h4 与正文完全同规格（同字号 / 同字重 / 同对齐），**层级丢失**；同时补上 `Heading 4` 的完整定义（此前只有标题键、无正文）。
- **字号改用中文标识**（主人 2026-09-15）：规格同时保存 `size_name`（人类可读）与 `size_pt`（实现值）—— `Heading 1` = **小三 15pt**、`Heading 2` = **四号 14pt**、`Heading 3`/`Heading 4` = **小四 12pt**、正文 `Normal` = **小四 12pt**。（0.1.6 过程值 h1 = 16pt/三号，按主人口径改为**小三 15pt**。）
- **Excel 字体与 Word 统一**（主人 2026-09-15）：`excel.font` 由 `宋体 11pt` → **仿宋 小四 12pt**（`name=仿宋` / `size=12` / `size_name=小四`）。
- **新增规格运维工具 `scripts/spec_sync.py`**（**零新增依赖**；**不含任何使用者私有路径** —— 展示文档输出走 `--doc-out`，缺省打印到标准输出）：一条命令完成「**校验** `specs/*.json` → **同步** profile 运行副本（逐文件 SHA256 校验）→ **生成**规格展示 Markdown」。`--check` 只校验不写盘（可进 CI）；退出码 **0 成功 / 2 规格或输入错误 / 3 同步后哈希不一致**；`extends` 继承件按**部分规格**放宽校验。
- **技能文档口径更正**：`skills/office-word|office-excel/SKILL.md` 里的过时描述（「页边距 2.54/3.17 + 黑体标题」「宋体 11」）已改为最新规格（「上下 3.17 / 左右 2.54 + 全文仿宋 + 小三/四号/小四」「仿宋 小四 12pt」），并在**仓库 / profile / 工作区 `.dsh/skills` 三处同步一致**（逐文件 SHA256）。

## 0.1.8 — 2026-09-15（A3：色板可读性修正 + 第二套内置风格 compact + extends 继承 + 自定义层样例）

- **色板修正：文字色与装饰色分离**（依据 `39_多套文档风格方案` 的 WCAG 本机实测）：
  - `colors.accent`：`ED7D31`（对白底 **2.77:1**，作文字不达标）→ **`B45309`（5.02:1）**；新增 `colors.accent_decor = ED7D31`，保留原亮色供**底纹/边框/图形**等装饰场景使用。
  - `colors.semantic.warn`：`BF9000`（**2.91:1**）→ **`8A6A00`（5.07:1）**；新增 `warn_decor = BF9000`。
  - 规格内加 `colors._note` 写明取用规则：**文字类属性取 `accent` / `warn`；非文字类（底纹/边框/图形）取 `*_decor`**。
- **规格支持 `extends` 继承**（`style_spec._load_by_id`）：派生风格只需写差异键，递归继承基座并带**循环保护**；加载顺序仍为「内置 → 使用者自定义层同名覆盖 → extends 链」。
- **新增第二套内置风格 `specs/compact.json`（内部纪要）**：`extends = standard`，按 39 号方案 2.3 —— 页边距 **2.2 / 2.2 / 2.0 / 2.0 cm**、Normal **10.5pt + 行距 1.15**、标题 **14 / 12 / 10.5pt**（整体降一档）、表格中性浅灰细线（`BFBFBF` / 2）、主色改**灰蓝 `44546A` / `5A6478`**。用法：`--spec compact`。
- **自定义层样例 `report`（汇报报告）**：写入 `~/.dsh/data/dsh-doc-suite/templates/report.json`（**使用者自定义层，非发布件**）：章节标题左对齐、表头底纹 `BDD7EE`、边框 4→6、强调色 `B45309`。用法：`--spec report`。
- **回归 14 → 16 例**：新增「`compact` / `report` 可加载且 `extends` 生效」「色板修正断言」。
- **零新增依赖**（规格仍为 JSON）；内容零改动红线不变。

## 0.1.7 — 2026-09-15（A2.2：表格宽度 / 列宽自适应）

- **表格撑满版心**（`word.table.width_mode = "full"`，默认）：`table-style` 设 `w:tblW` = 版心宽度
  （页宽 − 左/右页边距，dxa）、`w:tblLayout = fixed`（**关键** —— 不设 fixed 时 Word/WPS 会按内容重算列宽，
  设置等于无效），并清零 `w:tblInd`。
- **列宽自适应（两阶段分配）**：
  1. **先给「表头不折行」保底**：每列 ≥ 表头显示宽度 × 110 twips + 230（单元格内边距近似），
     按 `w:tblGrid/w:gridCol` 与每格 `w:tcPr/w:tcW` 写回（按 `w:gridSpan` 正确合计跨列宽）；
  2. 剩余宽度按权重分配：权重 = max(表头显示宽度, 数据平均宽度, **数据最大宽度 × 0.8**)，
     再按 `min_col_chars`(4) / `max_col_chars`(40) 夹取 —— **全角算 2、半角算 1**。
- **优先级（实测确定）**：① **表头必须一行**（主人明确要求）→ ② 数据短值尽量不折行 →
  ③ 超长数据允许折行（19 位发票号在 6 列表格中属版心物理限制，强行不折行会反过来挤压表头）。
- **规格新增**：`word.table.width_mode` / `min_col_chars` / `max_col_chars`（`auto` 可关闭宽度自适应）。
- **回归新增 1 例（共 14 例）**：断言 `tblW = 版心宽`、`tblLayout = fixed`、`ΣgridCol = 版心宽`、
  且**每个表头列的列宽 ≥ 其不折行所需宽度**。
- **零新增依赖**；内容零改动红线不变（落盘前逐段 + 逐单元格断言，差异即 exit 3）。

## 0.1.6 — 2026-09-15（A2.1：文档角色识别 + 表格列对齐；默认模板按主人真实投标文件校准）

- **新增文档角色识别**（`scripts/office/doc_roles.py`）—— 依据 `02_分析笔记/36_投标文件格式画像` 实测：
  - **双信号**：命名样式（heading 1-4 / 标题 / toc）**优先**；**编号模式兜底**（正文未套样式时唯一可用）：
    `N.` → heading_1、`N.M` → heading_2、`（N）` → heading_3、`A：`/`B:` → heading_4；
    居中 + 无编号 + 文首区（默认前 30 段）+ ≤40 字 → **doc_title**（封面大标题）。
  - 命中编号模式但未套命名样式的段落，**赋对应 Heading 命名样式**（只改样式、不改文本）；doc_title 用直接格式，不新建样式以免污染样式表。
  - **可回溯**：`apply-style --dry-run` 报告含各角色计数与样本（段落序号 / 角色 / 判定依据 / 文本前 40 字）。
- **规格 v1.1**（`specs/standard.json`，按主人真实投标文件校准）：
  - 页边距改为 **上下 3.17 / 左右 2.54 cm**（原为上下 2.54 / 左右 3.17，与投标文件相反）；
  - 标题字号：**主人 2026-09-15 对比两版样张后拍板为 B 方案** —— `Heading 1` = **16pt 黑体加粗居中**、`Heading 2` = **14pt 黑体**、`Heading 3` = **12pt 加粗**，新增 `Heading 4`（过程值曾按投标文件取 14/12pt，已按拍板改回）；
  - 新增 `word.doc_title` 段（封面大标题，居中加粗；字号阶梯 cover 36 / subtitle 22 / project 18 / party 16 / code 14pt，可配）；
  - 新增 `roles` 段（编号模式声明 + title_zone / title_max_chars）。
- **表格列对齐**（主人 2026-09-15：「标题、序号居中，其他右对齐」）：
  - 表头行 → 居中；**序号列**（序号 / 编号 / 项次 / No.）→ 居中；**数值列** → **右对齐**；纯文本列 → `text_align_default`（默认 **left** —— 长中文右对齐极难阅读；要「一律右对齐」改一个键即可）。
  - Word `table-style` 与 Excel `apply-style` **同步生效**；数值判定阈值 `numeric_ratio` 默认 0.6，可配。
- **零新增依赖**：仍只用标准库 + python-docx / openpyxl。
- 回归 `scripts/style-test.mjs` 扩充覆盖角色识别与列对齐。

## 0.1.5 — 2026-09-15（A 线：给【已有文件】套样式的能力）

- **新增三个样式化子命令**（设计规格见 `02_分析笔记/28_文档设计系统 v1（Word_Excel）.md`）：
  - `word_tool.py apply-style` —— 对**已有** docx 套版式：页面（A4 纵向、页边距 上下 2.54 / 左右 3.17cm）、命名样式（Normal / Heading 1-3）、
    **字体四属性**（`w:rFonts` 的 ascii / hAnsi / eastAsia / cs 全设 —— 只设 `font.name` 时中文会回落到默认东亚字体）、行距 **1.5 倍**、正文首行缩进 2 字符、标题大纲级别。
  - `word_tool.py table-style` —— 表头底纹 + 加粗 + 居中、边框、**跨页重复表头**、表内字号 10.5pt。
  - `excel_tool.py apply-style` —— 宋体 11、表头底纹 + 加粗 + 居中 + **冻结首行**、thin 边框、按**表头关键词**匹配数字格式与列宽、A4 纵向 + 缩放 1 页宽。
- **内容零改动红线（落盘前强制断言）**：Word 逐段 + 逐表格单元格、Excel 逐表逐单元格（含**公式原文**）比对，
  **任何差异 → 拒绝产出、exit 3、原文件不动**（实现为先写临时文件，断言通过才原子就位）。
  依据：34 号隔离试跑实测 gongwen-skill 会吞正文空格（`3,242,802.00 元` 变 `3,242,802.00元`），该类事故必须在工具层堵死。
- **两层规格、零新增依赖**：规格用标准库 `json`（**不引入 pyyaml**）；内置 `specs/standard.json`，
  使用者自定义层 `~/.dsh/data/dsh-doc-suite/templates/<id>.json` 深度覆盖（同 DSH 原生设置的「默认 ← base ← 用户覆盖」）。
  `package.json` 的 `files` 白名单新增 `specs`。
- **新增回归 `scripts/style-test.mjs`**（8 用例；零依赖、CI 可跑，缺 Python 库时自动 SKIP）：
  规格契约 / 四属性字体 / 子命令注册 / 端到端内容不变 / 公式保留。
- **本机实测**：青海成峰对账说明（366 项内容差异 **0**）、羊曲简介（差异 0）、石嘴山选型表（**13 条公式全保留**）、合同发票对账表（5 张表差异 0）。

## 0.1.4 — 2026-09-13（发布前中立性修复）

- **删除 0.1.1 条目中提及、但当时漏删的遗留私有配置脚本**（位于 `scripts/` 下）：原文件名含私有助手标识，
  文件内注释写死作者机器绝对路径，并在环境变量覆盖表中定义了 6 个私有环境变量。经全模块复核，
  **模块内无任何代码 `import` 它**，属死代码；其 `__pycache__` 编译产物一并清除。
- **发布件不再含任何私有标识**：模块目录内已无私有文件名、作者机器绝对路径或私有环境变量前缀残留。
- **工具脚本、技能与运行时行为零变化**：本次只移除未被引用的死代码，全部子命令、技能文档与既有环境变量行为均不受影响。

## 0.1.3 — 2026-09-12（移除 fontTools 可选依赖）

- **移除 `fontTools`**：它唯一的用途是 python-pptx 的 `fit_text()`，而该方法按空白断词、**对中文不可用**（见 0.1.2）；`autofit` 已改用 Pillow。
  查实依据：模块内**无任何代码 `import`**；**无任何依赖声明它**（`pip show fontTools` → `Required-by:` 为空；`pypdf` 仅在 extras `[fonts]`/`[full]` 下需要，未启用）。
- **整文件删除 `requirements-optional.txt`**（已无可选补强项），并清理全部引用：`package.json` 的 `files` 白名单、`doctor.py`（检查项 + 「Python ≥3.10 依据」表述）、`NOTICE`（许可条目）、`README`（安装步骤 + 依赖许可列表）、`requirements.txt` 与 `cordis.patch.yml` 的注释。
- **Python 门槛不变**：`>=3.10` 的依据改由必需依赖 **PyMuPDF 1.28+** 与 **Pillow 12+** 支撑（两者 `requires-python` 均为 `>=3.10`）。
- 本次只删**声明与检测项**，不会卸载本机已装的 fontTools（留着无害）。doctor 自检结论仍为「环境就绪」。
## 0.1.2 — 2026-09-12（PPT 自动缩字号 `autofit`）

- **新增 `ppt_tool.py autofit`**：文本框自动缩字号（文字溢出时逐磅下探到放得下）。
  - **刻意不用 python-pptx 的 `fit_text()`**：2026-09-12 实测它内部按空白断词（`pptx/text/layout.py` 的 `_LineSource` 用 `str.split()`），
    中文长句没有空格 → 整句被当成一个"词" → 永远超宽 → 二分查找返回 `None` → 抛 `TypeError: cannot unpack non-iterable NoneType`，**对中文不可用**。
  - 改为 **Pillow 自研测量 + 按字符断行**（中英文都算得准）；`--font-file` 可直接指定字体文件（最可靠），
    省略时按 `--font` / 文本框已有字体名映射到系统字体（微软雅黑 msyh.ttc / 黑体 simhei.ttf / 宋体 simsun.ttc / 等线 Deng.ttf 等）。
  - 参数：`--out`（另存，原文件不动）/ `--slide 1,3-5` / `--max-size 40` / `--min-size 8`（**下限保护**：到下限仍放不下则按下限写入并**告警**，提示拆页或精简文字）/ `--dry-run`；默认**就地修改并先备份**（`.bak-autofit-<时间戳>`）。
  - 退出码：缺 Pillow / 找不到可用字体 → **5**；`--font-file` 不存在 → **2**（中文单行错误，无堆栈）。
  - 实测：32 pt → 13 pt（5 行）；极端溢出框触发下限保护告警；就地修改生成备份、原文件可回溯。
- `fontTools` 由"解锁自动缩字号"降级为**保留项**（当前无子命令使用）；`requirements-optional.txt`、`doctor.py`、README 局限表、`skills/office-ppt/SKILL.md` 同步更正。
# Changelog · dsh-doc-suite

本模块遵循语义化版本。变更分三类：**新增** / **修复** / **变更（可能影响下游）**。

## 0.1.1 — 2026-09-12（当日夜间；安装后完整测试的修复轮）

### 修复（错误处理层，源自安装后完整测试的缺陷清单）

- **输入异常不再抛裸 Traceback**：新增 `scripts/cli_guard.py`（统一输入守卫 + 异常友好化），
  四个工具脚本全部接入。输入文件不存在/是目录 → 中文单行错误 + **exit 2**；
  WPS COM 错误（如 `com_error … '文档打开失败。' 3010`）→ 转成中文说明 + 可能原因提示。
  设 `DOC_SUITE_DEBUG=1` 可恢复完整堆栈（排障用）。
  修复前实测：14 个读取类子命令中 **12 个**抛裸 Traceback。
- **`excel read --sheet <不存在的表>`**：改为友好报错，并**列出该工作簿可用工作表名**（原来抛 `KeyError`）。
- **`pdf tables` 找不到表格**：由 `exit 1`（与真实失败同码）改为 **exit 0**，提示改走 stderr
  ——"没找到表"不是错误。
- **`pdf info` 增加 PDF 文件头校验**：非 PDF 文件（如误传 `.txt`）会告警"未检测到 %PDF 文件头"，
  不再静默给出误导性的"页数/元数据"。

### 变更（可能影响下游）

- **`excel chart` 的 `--sheet` 由必填改为可选**（缺省用第一张工作表），与 `summary`/`read` 行为一致。
  原来单表文件也必须显式传 `--sheet`，实测踩坑。
- **`pdf ocr` 改为退役墓碑**：OCR 通道已于 2026-09-12 退役。子命令保留（避免旧脚本静默跑偏），
  但只打印退役说明并 **exit 0**，不再本地 OCR、不再调用任何云端视觉 API。
  同时删除指向模块内**并不存在**的 `scripts/vision/describe_image.py`、`scripts/vision/ocr_tool.py`
  的死代码，以及一个遗留私有配置脚本与 `subprocess`/`tempfile` 等相关残留依赖。
- **`doctor.py --emit-skill-paths`（新增）**：输出 JSON（`moduleDir` / `scriptsDir` / `skillsDir` /
  `tools` / `skills`），供技能文档解析路径占位符。

### 文档

- 四个技能 `skills/*/SKILL.md`：
  - 新增**子命令速查表**（逐子命令用法 + 参数形态备注）；
  - 脚本路径由**作者机器绝对路径**改为占位符 **`<DOC_SUITE_SCRIPTS>`**，并写明解析方式；
  - `pdf-tools` 技能内残留的"扫描件走云端 OCR"指引全部改写为"转图片交基座原生识图"。
- README：新增「子命令速查」指引与高频坑提示；`files` 白名单补 `LICENSE`、`CHANGELOG.md`；
  已知局限表更新（技能路径问题标记为已解决，新增"脚本两份副本须同步"与非原生格式行为差异两条）。
- 集成体 README / RELEASE-CHECKLIST：同步本模块**硬前置**（Python ≥ 3.10 + WPS Office，不自动安装）
  与新增的文档模块发布门禁（Python 语法自检、技能不得含作者机器路径、必须含子命令速查表）。

### 验证

- `verify_fixes.py` 37/37 通过（含 15 项输入缺失友好化、表名提示、`--sheet` 可选、OCR 墓碑、
  无表 exit 0、非 PDF 提示、`DOC_SUITE_DEBUG`、以及 happy-path 回归与 `doctor` 回归）。
- 同步后三份副本（模块源码 / 工作区 `<workspace>/scripts` / 安装副本 `node_modules`）**SHA256 逐一一致**。

## 0.1.0 — 2026-09-12

- 首个版本：Word 处理+比对 / Excel 处理+重算+透视 / PPT 制作+排版 / PDF 只读精确提取。
- 宿主半只注册 `/doc-doctor`；能力实现在 Python 脚本 + DSH 原生技能。
- 安装后完整测试 14/14 通过（含 Word 字符级红线修订、KET 重算与真透视表、PPT→PDF→PNG、PDF 告警体系）。
