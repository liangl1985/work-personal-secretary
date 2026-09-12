# dsh-experts · 专家库模块

> `work-personal-secretary` 集成体的专家库子模块：把"每次临场手写专家人设"变成"按需调用现成专家定义"。
> **默认每轮只注入 1 位专家**（可调到 2/3，调大时设置页会提示占用较多 TOKEN），
> 其余专家按需**临时注入**，绝不全部加载。

## 它解决什么

子代理工具只有 `description` / `prompt`，没有"专家类型"入参。于是：
- 主对话只能临场手写人设 → 每次重写、质量不稳；
- 换个人用（例如会计岗同事）→ 拿到的是通用助手，**不会自动从会计角度拆解任务**。

本模块提供 20 位专家的**使用提示词**（persona），按「显式指令 > 岗位先验 ≈ 任务关键词 > 会话域」自动匹配注入，
让任务天然从对应专业角度被理解与拆解。

## 安装

```bash
dsh plugin --profile desktop add github:liangl1985/work-personal-secretary#modules/dsh-experts
# 或随集成体整包安装后，本模块由 dsh.profile.bundles 自动挂载
```

> **改了源码，怎么让 DSH 用上新版**（踩过两次坑）：
> 1. pnpm 对 `file:` 依赖有缓存 —— 只改源码后 `dsh plugin add <路径>` 常报 `Already up to date` 而**不同步**。可靠顺序是：**升 `package.json` 的补丁版本** → `dsh plugin --profile desktop install --force` → 仍不同步就删掉 `~/.dsh/profiles/<profile>/node_modules/dsh-experts` 再 `dsh plugin add`；
> 2. 同步后**逐文件比对 SHA256**（源码 ↔ profile 副本）确认一致，再**重启 DSH**（新模块/新版本必须重启才加载）。
>
> **别用 PowerShell 的 `Set-Content -Encoding utf8` 改 profile 的 JSON/设置文件**：它会写 BOM，DSH 读 profile 时 `JSON.parse` 会直接失败；`settings.yaml` 也应用 Node 的 `fs`（明确 UTF-8、无 BOM）来写。

## 使用流程（核心机制）

**常驻注入的只有一位** —— 切合使用者身份的「身份专家」（`identityExpert`；留空取本人岗位域第一位）。
其余专家**不常驻**：每轮先做**问题归属判断**，再决定处理路径：

| 判断结果 | 处理路径 |
|---|---|
| 命中单一专家 | 按该专家视角**原生处理**（主对话直接用注入的视角） |
| 跨领域多专家 / 需要独立作业 | **派子代理**：`expert_recall({ id })` 取 persona → 内联进 `subagent.prompt`（**跨域首选，不占主对话上下文**） |
| 未命中任何专家 | **原生处理**，不硬套专家视角（宁缺勿滥） |

需要临时在主对话切视角：`/expert use <id>`（本会话生效）· `/expert off` · `/expert auto` · `/expert list` · `/expert status` · `/expert why <任务文本>` · `/expert setup [<域> [<身份专家id>]]`。

> 建议把这条流程同时写进会话工作区的 `AGENTS.md`（**指令层每轮生效**，约束力强于插件自身）——集成体已带通用模板：`defaults/AGENTS.zh-CN.md`。

首次启用建议先跑一次安装引导：

```
/expert setup                                # 列出可选方向与候选身份专家
/expert setup presales presales-ics-security # 写岗位 + 指定常驻身份专家
```

> 岗位决定打分先验；**身份专家是常驻注入的唯一一位**（留空取该域第一位）。
> 给他人用（例：会计岗同事）把域改成 `finance` 即可，**无需改代码**。

## 设置项（设置 → 插件 → experts）

| 键 | 默认 | 说明 |
|---|---|---|
| `expertsEnabled` | `true` | 总开关 |
| `defaultDomain` | `presales` | **本人岗位默认域** —— 权重最高的先验，决定任务优先从哪个专业角度被拆解 |
| `identityExpert` | 空 | **常驻注入的唯一身份专家**（id，如 `presales-ics-security`）；留空 = 取岗位域第一位 |
| `enabledDomains` | 空 | 把匹配范围**收窄**到这些域；留空 = 全量参与（「本人岗位」只作打分先验，**不作白名单**） |
| `enabledExperts` | 空 | 把匹配范围**收窄**到这些专家 id；范围外的专家不参与自动匹配，仍可临时注入 |
| `expertInjectMax` | `1` | 每轮最多注入几位：**1 / 2 / 3**；⚠️ >1 会占用较多 TOKEN（每位 persona 约 1.3–1.8 千字，UTF-8 约 3.3–4.9KB） |
| `expertSecondThreshold` | `0.8` | 第 2/3 位门槛：分数 ≥ 第 1 位 × 该值，且须**跨域** |
| `expertMinScore` | `0.35` | 低于此分不注入（宁缺勿滥） |
| `expertShowBanner` | `true` | 注入时显示「当前专家视角」标识 |
| `expertSetupDone` | `false` | 安装引导是否已完成（问过「你的工作方向是？」并写入 `defaultDomain`）；重置为关可让引导下次再问一次 |

## 目录结构

```
dsh-experts/
├── experts/
│   ├── index.json          # 元数据（id/域/关键词/文件/来源与许可）
│   ├── presales/ aftersales/ finance/ legal/ doc/ general/   # 正文（纯 Markdown，约 1.3–1.8 千字）
├── lib/
│   ├── index.js            # 宿主半：注入 + expert_recall 工具 + /expert 命令
│   ├── match.js            # 匹配打分（纯函数，可单测）
│   ├── store.js            # 索引与 persona 读取（按 mtime 失效缓存）
│   ├── inject.js           # 注入文本组装
│   ├── limits.js           # 注入上限与阈值归一化（硬上限 / 夹取）
│   └── settings.js         # 设置命名空间（10 项，免重启）
├── scripts/                # 自测：regression / smoke-load / coexist（不依赖宿主运行时）
└── NOTICE                  # 来源与许可（MIT / Apache-2.0 / 自撰）
```

## 新增一位专家

1. 写正文 `experts/<域>/<新id>.md`（三段：`## 角色` / `## 工作方法（拆解任务的默认角度）` / `## 交付与自检`，1200–2000 字）；
2. 在 `experts/index.json` 的 `experts` 数组加一条（`id/name/domain/role_tag/when_to_use/trigger_keywords/file/source`）；
3. `source` 必须写清来源与许可；自撰的写 `{"origin":"self-authored"}`；**改写过的写 `"adapted": true`**。

无需重启：`.md` 与 `index.json` 按 mtime 失效缓存，改完即生效（设置项改动同样免重启）。

## 来源与许可

专家内容为**成熟开源件的压缩改写**（英文源按中国口径改写），来源与许可逐条记录在
`experts/index.json` 的 `source` 字段，汇总见 [NOTICE](./NOTICE)。改写一律标注 `adapted: true`，**不假称原样**。

## 隐私边界

- 全部数据（索引 + persona + 设置）**只在本机**，不联网、无遥测；
- persona 会进入对话上下文（这是它的用途），但**不包含**任何客户资料、凭据或记忆内容；
- 未在 `index.json` 标注来源与许可的条目**不随发布件分发**。

## 复核状态

安全域 6 位与法务 2 位（网络安全/工控安全的售前与技术支持、等保测评、渗透测试、民法、刑法）在 `index.json` 中标 `source.review: "pending"` —— 这些内容涉及等保流程、渗透合规边界、法条适用等**专业准确性**，建议由使用者本人或对口同事过一遍后再对外使用（内部日常使用不受影响）。

## 自测

```bash
node scripts/regression.mjs   # 25 项：索引 / persona 体量 / 匹配打分 / 注入组装
node scripts/smoke-load.mjs   # 18 项：mock ctx 真跑 apply()（命令与工具）
node scripts/coexist.mjs      # 7 项：与 dsh-work-memory 同 ctx 共存的契约测试
```

三套都不依赖宿主运行时（`schemastery` / `dsh-tools` 缺失时自动降级），可直接在本机或 CI 跑；CI 已包含回归 + 装载冒烟 + 共存契约。
