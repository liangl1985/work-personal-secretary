/**
 * work-personal-secretary —— 集成体本体（宿主半）
 *
 * 定位：本集成体的**第一大功能是安装器**（环境检查 → 依赖补齐 → 子插件安装 → 配置底座），
 * 第二大功能是把 DSH 底层配置（指令层 / 记忆种子 / 技能 / 设置）落地。
 * 本文件是宿主半：已接入安装器四步的宿主侧——只读环境探针（lib/probe.js）、
 * 子插件安装引擎（lib/install.js）、配置底座引擎（lib/basedeck.js：指令层 / 记忆种子 / 技能 / 设置 / 目录）
 * 与 Web API（lib/api.js：GET /check、POST /fix、POST /fix-all、GET /plugins、POST /install、POST /install-all、
 * GET /basedeck、POST /basedeck）。配置底座的形态是**配置引导**：GET 只给计划，POST 默认 dry-run，
 * 只有 dryRun:false 才落盘（见 lib/basedeck.js 的红线说明）。
 *
 * P4 起另接**能力配置页**宿主侧（lib/settings-api.js：GET /settings、POST /settings/write、
 * GET /experts/preview）——把子插件设置收进集成体设置分区的「能力配置」页：只读枚举走
 * 官方 settings 服务的 describe（白名单裁剪），写入走 mutate（ns/path 白名单 + revision 栅栏，
 * dryRun 默认 true），专家阈值预览动态加载子插件 match.js。
 * 三条路由经 installApi 的 **prefix** 路由分发（浏览器载体 / Web GUI 已覆盖）；
 * 桌面载体（合成 origin）的 fetch 桥只认精确路由，故 1.1.3 起**已接线**（按产品决策方案 A）：
 * installApi 内注册 API_PATHS + PAGE_PATHS + CORE_API_EXACT_PATHS（共 21 条 exact），
 * 本文件再调用 installSettingsExactRoutes 补上 P4 三条（SETTINGS_API_PATHS），
 * 合计 24 条 exact + 1 条 prefix = **25 条路由**（见 lib/api.js 的「路由注册口径」）。
 *
 * 设计约束（沿用集成体纪律）：
 * - **零运行时依赖**（只用 node 内置模块），宿主 peer 缺失时不影响加载；
 * - 设置命名空间作为**部署默认层**，个性化只走设置页用户层；
 * - 不在这里写死任何使用者信息（发布件中立性红线）。
 *
 * @module work-personal-secretary
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installApi, installSettingsExactRoutes } from './api.js'
import { runProbes } from './probe.js'
import { installSettings } from './settings.js'

export const name = 'work-personal-secretary'

/** 需要的宿主服务：settings 注册命名空间；webServer 提供环境检查 / 自动补齐路由 */
export const inject = ['settings', 'webServer']

/** 本模块目录（读自身 package.json 用） */
const HERE = dirname(fileURLToPath(import.meta.url))

/** 读取自身包版本（不在代码里写死版本号，避免与 package.json 漂移） */
export function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/**
 * 集成体自带的五个子插件。
 * 只列**标识与用途**，不写版本号（版本随使用者安装情况而变，由后续的安装器探测）。
 */
export const SUB_PLUGINS = [
  { name: 'dsh-work-memory', zh: '记忆库', purpose: '执行层长期记忆：三级记忆模型 + 转冷预审 + 侧边栏面板' },
  { name: 'dsh-doc-suite', zh: '文档能力', purpose: 'Word / Excel / PPT / PDF 四格式处理与精确提取' },
  { name: 'dsh-experts', zh: '专家库', purpose: '按岗位关联的专家 persona：任务命中关键词才注入对口专家（默认不常驻）' },
  { name: 'dsh-mermaid', zh: '思维链与图表', purpose: '把 Mermaid 代码块渲染成流程图 / 时序图（第三方，MIT）' },
  { name: 'workspace-tokenpet', zh: '桌面形象', purpose: '桌面宠物外观与动作（独立项目模块，MIT）' },
]

export function apply(ctx, config = {}) {
  const version = readVersion()
  ctx.logger?.debug?.('work-personal-secretary: 集成体本体已挂载 v' + version + '（客户端提供设置分区「工作秘书」）')

  // ---- 设置命名空间（本体自己）：repoRoot 可在设置页读写，免重启热生效（2026-09-14） ----
  // base 层**故意留空**：组合配置里的 repoRoot（cordis.patch.yml / bundle 配置）由 installApi 的
  // configRoot 单独承载，这样「设置值 / 部署配置 / patch / 自动探测」四种来源在响应里可区分，
  // 不会被 base 层伪装成「设置值」。设置服务缺失时本调用降级为空设置（repoRoot 走自动探测）。
  const settings = installSettings(ctx, {})

  // ---- 安装器宿主半：环境检查（只读）、自动补齐（服务端白名单）与子插件安装 ----
  // 服务缺失（无 webServer）时降级：只装设置分区，路由不可用并在日志里说明。
  // 配置项 repoRoot（可选）：集成体仓库目录；留空则服务端做相对探测 / 常见位置探测。
  // 配置项 workspace（可选）：配置底座的目标工作区；留空则 /basedeck 走默认探测，解析不出显式返回 none。
  // 两者都属于「部署默认层」的自定义入口，个性化可在该 profile 的 cordis.patch.yml 或设置页用户层里覆盖。
  let disposeApi = null
  try {
    disposeApi = installApi(ctx, {
      repoRoot: config && typeof config.repoRoot === 'string' ? config.repoRoot : '',
      workspace: config && typeof config.workspace === 'string' ? config.workspace : '',
      // 设置句柄（repoRoot 的实时读取源；写入走 ctx.settings.mutate，见 /repo-root 路由）
      settings: settings,
    })
  } catch (err) {
    ctx.logger?.warn?.('work-personal-secretary: Web API 安装失败，环境检查 / 补齐路由不可用（降级为仅设置分区）：'
      + (err && err.message ? err.message : err))
  }

  // ---- P4 能力配置页的三条**精确路由**：桌面载体 fetch 桥只认精确路由，这里接线 ----
  // 与 installApi 的 21 条 exact 合计 24 条 exact（+1 prefix = 25）。无 webServer 时同样降级。
  let disposeExact = null
  try {
    disposeExact = installSettingsExactRoutes(ctx, {
      repoRoot: config && typeof config.repoRoot === 'string' ? config.repoRoot : '',
    })
  } catch (err) {
    ctx.logger?.warn?.('work-personal-secretary: 能力配置页精确路由接线失败（能力配置页在桌面载体下可能不可用）：'
      + (err && err.message ? err.message : err))
  }

  // 可选：启动时做一次只读环境探测并写日志（cordis.patch.yml 的 selfCheckOnStartup，默认关闭）
  if (config && config.selfCheckOnStartup) {
    void runProbes().then((report) => {
      const line = report.items.map((it) => it.id + '=' + it.status).join(' ')
      ctx.logger?.info?.('work-personal-secretary 环境自检：' + line + '（' + JSON.stringify(report.summary) + '）')
    }).catch((err) => {
      ctx.logger?.warn?.('work-personal-secretary 环境自检失败：' + (err && err.message ? err.message : err))
    })
  }

  return () => {
    try { if (disposeApi) disposeApi() } catch (e) { /* best-effort */ }
    try { if (disposeExact) disposeExact() } catch (e) { /* best-effort */ }
  }
}
