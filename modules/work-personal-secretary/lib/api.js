/**
 * work-personal-secretary —— Web GUI API（环境检查 / 自动补齐）
 *
 * 路由前缀 /work-personal-secretary/api：
 *   GET  /check       —— 七项只读环境探针报告
 *   POST /fix         —— 按 id 执行**白名单固定命令**（同源保护）
 *   POST /fix-all     —— 批量补齐：服务端按固定依赖顺序串行执行（同源保护）
 *   GET  /plugins     —— 五个子插件的版本 / 安装模式清单（**只读**）
 *   POST /install     —— 安装单个子插件（同源保护；来源路径由服务端拼接）
 *   POST /install-all —— 批量安装：服务端按固定顺序串行（同源保护）
 *   GET  /basedeck    —— 配置底座的**只读计划**（dry-run；五项：指令层 / 记忆种子 / 技能 / 设置 / 目录）
 *   POST /basedeck    —— 配置引导一次性写入（同源保护；**dryRun 默认 true**，只有显式 false 才落盘）
 *   GET  /settings        —— 能力配置页：白名单 ns（work-memory / experts）设置**只读枚举**（P4）
 *   POST /settings/write  —— 能力配置页：写子插件设置**用户层**（同源保护；dryRun 默认 true + revision 栅栏）
 *   GET  /experts/preview —— 能力配置页：专家打分实时预览（动态加载子插件 match.js；只读）
 *
 * 路由注册口径（P4 起）：
 *   - 上述三条走本文件的 **prefix** handler（浏览器载体 / Web GUI 的根相对 fetch 命中它），
 *     **不并入 API_PATHS** —— 既有 7 条精确路由的集合与顺序一字不动；
 *   - 桌面载体需要的**精确路由**已有实现（见文件末尾 installSettingsExactRoutes），但**默认不接线**：
 *     probe-test 断言「installApi 的 exact 集合 === API_PATHS」且「apply 的路由总数 === API_PATHS.length + 1」，
 *     一接线这两条就会红。启用前须先确认并同步放宽该断言（详见该函数文档）。
 *
 * 安全红线（本文件是唯一会执行安装动作的地方）：
 * 1. id 必须命中服务端白名单表 → 映射到**固定命令 + 固定参数数组**；
 *    **绝不接受客户端传入的命令字符串或参数**，id 只用于查表。
 * 2. 命令一律 execFile + 参数数组，不用 shell；带超时与输出上限（8000 字符）。
 * 3. 写操作（POST）走同源保护：Content-Type 必须是 application/json + Origin 必须同源。
 * 4. 发布件中立：不含任何使用者信息、本机绝对路径。
 *
 * @module work-personal-secretary/api
 */

import { URL } from 'node:url'
import { execFile } from 'node:child_process'
import {
  FIX_WHITELIST,
  FIX_EXECUTION_ORDER,
  AUTO_FIXABLE_IDS,
  PROBE_ORDER,
  NO_WINGET_NOTE,
  pipInstallArgv,
  wingetInstallArgv,
  pythonLauncher,
  truncate,
  runProbes,
  probePython,
  probeWinget,
  resolvePythonExecutable,
  resolveProfileDir,
  PYTHON_MISSING_HINT,
} from './probe.js'

import {
  MODULE_DIR,
  SUB_PLUGIN_ID_LIST,
  listSubPlugins,
  installSubPlugin,
  resolveRepoRoot,
  resolveInstallAllPlan,
} from './install.js'

import {
  BASEDECK_ID_LIST,
  BASEDECK_OUTPUT_LIMIT,
  applyBaseDeck,
  planBaseDeck,
  publicPlan,
  safeWorkspaceParam,
} from './basedeck.js'

import { SETTINGS_API_PATHS, createSettingsApi } from './settings-api.js'

/** 路由前缀（接口契约定死） */
export const API_ROOT = '/work-personal-secretary/api'
/** 精确路由（桌面载体的 fetch 桥只认精确路由） */
export const API_PATHS = ['/check', '/fix', '/fix-all', '/plugins', '/install', '/install-all', '/basedeck']

/** 安装类命令的超时上限（15 分钟：winget / pip 都可能较慢） */
export const FIX_TIMEOUT_MS = 900000
/** 返回输出上限（契约：截断到 8000 字符） */
export const FIX_OUTPUT_LIMIT = 8000

// ───────────────────────────── HTTP 小工具 ─────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message })
}

async function readBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    throw new Error('invalid JSON body')
  }
}

/** 预览字符串按行截断（preview.sampleLines 契约是字符串） */
function trimSample(s, n) {
  return String(s == null ? '' : s).split('\n').slice(0, n).join('\n')
}

/** 配置底座计划的输出裁剪：超限时逐级缩减预览行，保证响应体不超过上限 */
function trimPlanPayload(payload, limit = BASEDECK_OUTPUT_LIMIT) {
  if (JSON.stringify(payload).length <= limit) return payload
  for (const it of payload.items || []) {
    if (it.preview) it.preview.sampleLines = trimSample(it.preview.sampleLines, 6)
  }
  if (JSON.stringify(payload).length <= limit) return payload
  for (const it of payload.items || []) {
    if (it.preview) it.preview.sampleLines = trimSample(it.preview.sampleLines, 2)
    if (Array.isArray(it.files)) it.files = it.files.map((f) => ({ name: f.name, state: f.state }))
    if (Array.isArray(it.dirs)) it.dirs = it.dirs.map((d) => ({ key: d.key, state: d.state, dir: d.dir }))
  }
  payload.truncated = true
  return payload
}

/** 同源保护：写操作必须由本机 Web UI 发起（沿用 work-memory 的做法） */
function sameOriginGuard(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') return '请求必须为 application/json'
  const host = String(req.headers.host || '')
  const origin = String(req.headers.origin || '')
  if (origin === '') return '缺少 Origin 头'
  try {
    if (new URL(origin).host !== host) return '跨站请求已拒绝'
  } catch (e) {
    return '跨站请求已拒绝'
  }
  return null
}

// ───────────────────────────── 白名单解析（纯函数，可单测） ─────────────────────────────

function knownProbeId(id) {
  return PROBE_ORDER.indexOf(id) >= 0
}

/**
 * 把请求里的 id 解析成**固定命令**。
 * 只做查表；返回的 cmd / args 与入参 id 之外的一切输入无关。
 * @param {string} id
 * @param {{platform?:string, pythonOk?:boolean, wingetOk?:boolean}} [options]
 * @returns {{ok:boolean, id:string, command:string, cmd:string, args:string[], reason:string}}
 */
export function resolveFixCommand(id, options = {}) {
  const platform = options.platform || process.platform
  const pythonOk = options.pythonOk !== false
  const wingetOk = options.wingetOk !== false
  const safeId = typeof id === 'string' ? id.slice(0, 64) : ''
  const spec = FIX_WHITELIST[safeId]
  if (!spec) {
    const reason = knownProbeId(safeId)
      ? '该项不支持自动补齐，请按环境检查给出的提示手动处理'
      : '未知检查项：可代执行的 id 只接受 ' + AUTO_FIXABLE_IDS.join(' / ')
    return { ok: false, id: safeId, command: '', cmd: '', args: [], reason: reason }
  }
  if (spec.requiresWinget && platform !== 'win32') {
    return { ok: false, id: safeId, command: '', cmd: '', args: [], reason: '当前平台不支持 winget，请手动安装：' + spec.manual }
  }
  if (spec.requiresWinget && !wingetOk) {
    return { ok: false, id: safeId, command: '', cmd: '', args: [], reason: NO_WINGET_NOTE + '，请手动安装：' + spec.manual }
  }
  if (spec.requiresPython && !pythonOk) {
    return {
      ok: false, id: safeId, command: '', cmd: '', args: [],
      reason: '未检测到可用的 Python 解释器，无法执行 pip 安装（若刚装完 Python，请重启 DSH 后再补齐依赖）；也可手动执行：' + spec.manual,
    }
  }
  let argv
  if (safeId === 'pythonDeps') {
    // 解释器由服务端只读解析得到（固定候选），这里只负责拼接固定参数
    const pip = pipInstallArgv(platform, options.pythonExec || null)
    argv = [pip.cmd].concat(pip.args)
  } else {
    argv = wingetInstallArgv(safeId)
  }
  return { ok: true, id: safeId, command: argv.join(' '), cmd: argv[0], args: argv.slice(1), reason: '' }
}

/**
 * 批量补齐计划：过滤白名单、去重，并按**服务端固定依赖顺序**排列（忽略传入顺序）。
 * @returns {{order:string[], rejected:string[]}}
 */
export function resolveFixAllPlan(ids, options = {}) {
  const platform = options.platform || process.platform
  const input = Array.isArray(ids) ? ids : []
  const accepted = new Set()
  const rejected = []
  for (const raw of input) {
    const s = typeof raw === 'string' ? raw.slice(0, 64) : String(raw == null ? '' : raw).slice(0, 32)
    if (FIX_EXECUTION_ORDER.indexOf(s) >= 0) accepted.add(s)
    else if (rejected.indexOf(s) === -1 && rejected.length < 50) rejected.push(s)
  }
  const order = FIX_EXECUTION_ORDER.filter((id) => accepted.has(id))
  return { order: order, rejected: rejected }
}

// ───────────────────────────── 命令执行 ─────────────────────────────

/** 默认执行器（可被 installApi 的 deps.exec 覆盖，便于测试 mock） */
export function runFixCommand(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, Array.isArray(args) ? args : [], {
      timeout: options.timeoutMs || FIX_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      })
    })
  })
}

// ───────────────────────────── 路由安装 ─────────────────────────────

/**
 * 安装 Web API 路由。
 * @param {object} ctx cordis context（需 webServer）
 * @param {object} [deps]
 * @param {Function} [deps.exec] 命令执行器（测试注入 mock；默认 execFile）
 * @param {Function} [deps.probePython] Python 探测（测试注入 mock）
 * @param {Function} [deps.resolvePython] Python 解释器解析（测试注入 mock）
 * @param {Function} [deps.probeWinget] winget 探测（测试注入 mock）
 * @param {object} [deps.probeOptions] /check 的探针选项（仅供测试）
 * @param {string} [deps.repoRoot] 设置项里的集成体仓库根（可空；空则走相对 / 常见位置探测）
 * @param {string} [deps.profileDir] 当前 profile 目录（测试注入；默认由 DSH_HOME / DSH_PROFILE_DIR 解析）
 * @param {object} [deps.env] 环境变量来源（测试注入）
 * @param {Function|Date} [deps.now] 时间来源（测试注入；影响备份时间戳）
 * @param {string} [deps.moduleDir] 本体模块目录（测试注入；相对探测起点）
 * @param {string[]} [deps.commonCandidates] 常见位置候选（测试注入）
 * @param {string} [deps.workspace] 设置项里的默认工作区（可空；空则 /basedeck 显式返回 workspaceSource=none 或做默认探测）
 * @param {string} [deps.dshHome] DSH_HOME（测试注入；默认取环境变量 DSH_HOME，再退到 ~/.dsh）
 * @returns {Function} disposer
 */
export function installApi(ctx, deps = {}) {
  const exec = typeof deps.exec === 'function' ? deps.exec : runFixCommand
  const doProbePython = typeof deps.probePython === 'function' ? deps.probePython : probePython
  const doResolvePython = typeof deps.resolvePython === 'function' ? deps.resolvePython : resolvePythonExecutable
  const doProbeWinget = typeof deps.probeWinget === 'function' ? deps.probeWinget : probeWinget
  const probeOptions = deps.probeOptions || {}
  const platform = deps.platform || process.platform

  // ---- 子插件安装（安装器第三步）：仓库根与 profile 只由服务端解析 ----
  // repoRoot 来自设置项（可为空）；来源路径一律由服务端从 repoRoot 拼接，**绝不接受客户端传入路径**。
  const repoRootConfig = typeof deps.repoRoot === 'string' ? deps.repoRoot : ''
  const profileDirOverride = typeof deps.profileDir === 'string' ? deps.profileDir : ''
  const installEnv = deps.env || process.env
  const installNow = deps.now
  const installModuleDir = deps.moduleDir || MODULE_DIR
  // 配置底座的默认工作区（设置项 workspace，可空；空则由 basedeck 显式返回 none 或做默认探测）
  const basedeckWorkspaceConfig = typeof deps.workspace === 'string' ? deps.workspace : ''
  // 配置底座的 DSH_HOME 只由服务端解析（deps.dshHome → 环境变量 DSH_HOME）；**绝不接受客户端传入**
  const basedeckDshHome = typeof deps.dshHome === 'string' && deps.dshHome
    ? deps.dshHome
    : (String(installEnv.DSH_HOME || '').trim() || '')

  const currentRepoRoot = () => resolveRepoRoot({
    configRoot: repoRootConfig,
    moduleDir: installModuleDir,
    env: installEnv,
    commonCandidates: deps.commonCandidates,
  })
  const currentProfileDir = () => profileDirOverride || resolveProfileDir(installEnv)

  // ---- P4 能力配置页（契约《17_P4 能力配置页接口契约与安全边界》§4）：三条路由 ----
  // 走本文件的 prefix handler（浏览器载体）；HTTP 小工具与路径解析器直接复用本文件的，
  // 保证同源守卫与错误响应格式与既有 8 条**完全一致**（契约 §5.5）。
  // 桌面载体的精确路由见文件末尾的 installSettingsExactRoutes。
  const settingsApi = createSettingsApi(ctx, {
    sendJson: sendJson,
    sendError: sendError,
    readBody: readBody,
    sameOriginGuard: sameOriginGuard,
    resolveProfileDir: currentProfileDir,
    resolveRepoRoot: currentRepoRoot,
    moduleDir: installModuleDir,
  })

  /** 执行单个白名单步骤：前置条件现场判定，命令只来自白名单 */
  const runStep = async (id) => {
    const started = Date.now()
    const spec = FIX_WHITELIST[id]
    if (!spec) {
      // 未知 / 只读项：文案与 /fix 的判定保持一致，且绝不产出命令
      const unknown = resolveFixCommand(id, { platform: platform })
      return {
        id: typeof id === 'string' ? id.slice(0, 64) : '',
        ok: false,
        command: '',
        exitCode: null,
        durationMs: 0,
        output: unknown.reason,
      }
    }
    let wingetOk = true
    let pythonOk = true
    let pythonExec = null
    if (spec.requiresWinget) {
      const w = await doProbeWinget({ platform: platform })
      wingetOk = Boolean(w && w.ok)
    }
    if (spec.requiresPython) {
      // 执行前解析解释器：py -3 → 固定安装目录候选（新装 Python 未刷新 PATH 时仍可用）
      const p = await doProbePython({ platform: platform, launcher: pythonLauncher(platform) })
      pythonExec = await doResolvePython({ platform: platform, launcher: pythonLauncher(platform), pythonItem: p })
      pythonOk = Boolean(pythonExec)
      if (!pythonOk) {
        return {
          id: id, ok: false, command: '', exitCode: null,
          durationMs: Date.now() - started, output: PYTHON_MISSING_HINT,
        }
      }
    }
    const plan = resolveFixCommand(id, { platform: platform, pythonOk: pythonOk, wingetOk: wingetOk, pythonExec: pythonExec })
    if (!plan.ok) {
      return { id: id, ok: false, command: '', exitCode: null, durationMs: Date.now() - started, output: plan.reason }
    }
    let result
    try {
      result = await exec(plan.cmd, plan.args, { timeoutMs: FIX_TIMEOUT_MS })
    } catch (err) {
      const why = String(err && err.message ? err.message : err).slice(0, 200)
      return { id: id, ok: false, command: plan.command, exitCode: null, durationMs: Date.now() - started, output: '执行失败：' + why }
    }
    const exitCode = result && typeof result.exitCode === 'number' ? result.exitCode : 1
    const output = truncate(String(result && result.stdout ? result.stdout : '')
      + (result && result.stderr ? '\n' + String(result.stderr) : ''), FIX_OUTPUT_LIMIT)
    return {
      id: id,
      ok: exitCode === 0,
      command: plan.command,
      exitCode: exitCode,
      durationMs: Date.now() - started,
      output: output,
    }
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://dsh.internal')
      const path = url.pathname
      if (path.indexOf(API_ROOT) !== 0) {
        res.writeHead(404)
        res.end()
        return
      }
      const sub = path.slice(API_ROOT.length)

      // ---- P4 能力配置页三条路由：GET /settings、POST /settings/write、GET /experts/preview ----
      // 不匹配时返回 false，交回下面的既有路由（8 条行为一字不变）。
      if (await settingsApi.handle(req, res, url, sub)) return

      // GET /check —— 七项只读环境检查
      if (req.method === 'GET' && (sub === '/check' || sub === '/check/')) {
        const report = await runProbes(probeOptions)
        return sendJson(res, 200, report)
      }

      // GET /plugins —— 五个子插件的版本 / 安装模式清单（**只读**，不触发任何安装）
      if (req.method === 'GET' && (sub === '/plugins' || sub === '/plugins/')) {
        const repo = currentRepoRoot()
        const listing = listSubPlugins({ repoRoot: repo.repoRoot, profileDir: currentProfileDir() })
        const payload = {
          ok: true,
          repoRoot: listing.repoRoot,
          repoRootSource: repo.source,
          repoRootSourceDetail: repo.sourceDetail,
          profileDir: listing.profileDir,
          items: listing.items,
          summary: listing.summary,
        }
        const hints = []
        if (!listing.repoRoot) hints.push('未找到集成体仓库目录，请在设置里指定集成体仓库目录')
        if (!listing.profileDir) hints.push('未找到当前 profile 目录（可用 DSH_PROFILE_DIR / DSH_PROFILE 指定，默认 ~/.dsh/profiles/desktop）')
        if (hints.length > 0) payload.message = hints.join('；')
        return sendJson(res, 200, payload)
      }

      // ---- 以下为写操作（同源保护） ----
      if (req.method === 'POST' && (sub === '/fix' || sub === '/fix/' || sub === '/fix-all' || sub === '/fix-all/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
      }

      // POST /install、POST /install-all 同样走同源保护（只新增，不改动 /fix 的判定）
      if (req.method === 'POST' && (sub === '/install' || sub === '/install/' || sub === '/install-all' || sub === '/install-all/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
      }

      // POST /fix { id } —— 执行单个白名单固定命令
      if (req.method === 'POST' && (sub === '/fix' || sub === '/fix/')) {
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''
        const result = await runStep(id)
        return sendJson(res, 200, {
          ok: result.ok,
          id: result.id,
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          output: result.output,
        })
      }

      // POST /fix-all { ids: [] } —— 按固定依赖顺序串行补齐；单项失败继续后续项
      if (req.method === 'POST' && (sub === '/fix-all' || sub === '/fix-all/')) {
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        if (!Array.isArray(body.ids)) {
          return sendJson(res, 200, { ok: false, results: [], rejected: [], durationMs: 0, message: 'ids 必须是非空字符串数组' })
        }
        const plan = resolveFixAllPlan(body.ids, { platform: platform })
        if (plan.order.length === 0) {
          return sendJson(res, 200, {
            ok: false, results: [], rejected: plan.rejected, durationMs: 0,
            message: '没有可执行的 id（可代执行的 id：' + AUTO_FIXABLE_IDS.join(' / ') + '）',
          })
        }
        const startedAll = Date.now()
        const results = []
        for (const id of plan.order) {
          results.push(await runStep(id))
        }
        const totalMs = Date.now() - startedAll
        const payload = {
          ok: results.length > 0 && results.every((r) => r.ok),
          results: results,
          rejected: plan.rejected,
          durationMs: totalMs,
        }
        if (plan.rejected.length > 0) payload.message = '已忽略不在白名单的 id：' + plan.rejected.join(' / ')
        return sendJson(res, 200, payload)
      }

      // POST /install { id } —— 安装单个子插件（id 只用于查表 → <repoRoot>/modules/<id>）
      if (req.method === 'POST' && (sub === '/install' || sub === '/install/')) {
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const id = typeof body.id === 'string' ? body.id.trim().slice(0, 64) : ''
        const repo = currentRepoRoot()
        const result = installSubPlugin(id, {
          repoRoot: repo.repoRoot, profileDir: currentProfileDir(), now: installNow, dshHome: basedeckDshHome,
        })
        return sendJson(res, 200, result)
      }

      // POST /install-all { ids: [] } —— 按固定顺序串行安装；未知 id 计入 rejected 且不执行
      if (req.method === 'POST' && (sub === '/install-all' || sub === '/install-all/')) {
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        if (!Array.isArray(body.ids)) {
          return sendJson(res, 200, { ok: false, results: [], rejected: [], durationMs: 0, message: 'ids 必须是非空字符串数组' })
        }
        const plan = resolveInstallAllPlan(body.ids)
        if (plan.order.length === 0) {
          return sendJson(res, 200, {
            ok: false, results: [], rejected: plan.rejected, durationMs: 0,
            message: '没有可安装的 id（可安装的 id：' + SUB_PLUGIN_ID_LIST.join(' / ') + '）',
          })
        }
        const startedAll = Date.now()
        const repo = currentRepoRoot()
        const profileDir = currentProfileDir()
        const results = []
        for (const id of plan.order) {
          results.push(installSubPlugin(id, {
            repoRoot: repo.repoRoot, profileDir: profileDir, now: installNow, dshHome: basedeckDshHome,
          }))
        }
        const payload = {
          ok: results.every((r) => r.ok),
          results: results,
          rejected: plan.rejected,
          durationMs: Date.now() - startedAll,
        }
        if (plan.rejected.length > 0) payload.message = '已忽略不在白名单的 id：' + plan.rejected.join(' / ')
        return sendJson(res, 200, payload)
      }

      // GET /basedeck —— 配置底座的**只读计划**（dry-run；绝不写盘）
      // ?workspace=<绝对路径> 可显式指定工作区；无效时回退服务端解析并在 message 里说明。
      if (req.method === 'GET' && (sub === '/basedeck' || sub === '/basedeck/')) {
        const wsParam = url.searchParams.get('workspace') || ''
        let workspaceOverride = ''
        let message = ''
        if (wsParam) {
          const check = safeWorkspaceParam(wsParam)
          if (check.ok) workspaceOverride = check.workspace
          else message = 'workspace 参数无效，已回退服务端解析：' + check.error
        }
        const repo = currentRepoRoot()
        const plan = planBaseDeck({
          // query 里的 workspace 是**客户端显式传值** → 走 overrides（source=client）
          overrides: workspaceOverride ? { workspace: workspaceOverride } : {},
          dshHome: basedeckDshHome,
          configWorkspace: basedeckWorkspaceConfig,
          repoRoot: repo.repoRoot,
          env: installEnv,
          now: installNow,
          moduleDir: installModuleDir,
          commonCandidates: deps.commonCandidates,
        })
        const payload = publicPlan(plan)
        if (message) payload.message = message
        return sendJson(res, 200, trimPlanPayload(payload))
      }

      // POST /basedeck { ids, dryRun, overrides } —— 配置引导一次性写入（同源保护）
      // **dryRun 默认 true**：不带 dryRun:false 时绝不写盘；overrides 携带引导填值：
      //   { workspace, defaultDomain, identityExpert, memoryDir, obsidianSyncDir }
      if (req.method === 'POST' && (sub === '/basedeck' || sub === '/basedeck/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const dryRun = body.dryRun !== false
        const ids = body.ids === undefined || body.ids === null ? BASEDECK_ID_LIST : body.ids
        if (!Array.isArray(ids)) {
          return sendJson(res, 200, {
            ok: false, dryRun: dryRun, results: [], rejected: [], durationMs: 0,
            message: 'ids 必须是字符串数组（缺省 = 五项全部）',
          })
        }
        const rawOverrides = (body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)) ? body.overrides : {}
        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 512) : '')
        const overrides = {
          defaultDomain: clean(rawOverrides.defaultDomain, 64),
          identityExpert: clean(rawOverrides.identityExpert, 64),
          memoryDir: clean(rawOverrides.memoryDir, 1024),
          obsidianSyncDir: clean(rawOverrides.obsidianSyncDir, 1024),
        }
        const wsRaw = clean(rawOverrides.workspace, 1024)
        if (wsRaw) {
          const check = safeWorkspaceParam(wsRaw)
          if (!check.ok) {
            return sendJson(res, 200, {
              ok: false, dryRun: dryRun, results: [], rejected: [], durationMs: 0,
              message: 'overrides.workspace 无效：' + check.error,
            })
          }
          overrides.workspace = check.workspace
        }
        const repo = currentRepoRoot()
        const opts = {
          dryRun: dryRun,
          // overrides.workspace 是**客户端表单值** → source=client；设置项走 configWorkspace
          overrides: overrides,
          dshHome: basedeckDshHome,
          configWorkspace: basedeckWorkspaceConfig,
          repoRoot: repo.repoRoot,
          env: installEnv,
          now: installNow,
          moduleDir: installModuleDir,
          commonCandidates: deps.commonCandidates,
        }
        const applied = applyBaseDeck(ids, opts)
        const payload = {
          ok: applied.ok,
          dryRun: applied.dryRun,
          workspace: applied.workspace,
          workspaceSource: applied.workspaceSource,
          workspaceNote: applied.workspaceNote || '',
          libraryName: applied.libraryName || '',
          memoryRoot: applied.memoryRoot || '',
          memoryDir: applied.memoryDir || '',
          results: applied.results,
          rejected: applied.rejected,
          wroteAny: applied.wroteAny === true,
          durationMs: applied.durationMs,
          setupNeeded: planBaseDeck(opts).setupNeeded,
        }
        if (applied.rejected.length > 0) payload.message = '已忽略不在白名单的 id：' + applied.rejected.join(' / ')
        return sendJson(res, 200, payload)
      }

      return sendError(res, 404, 'not found')
    } catch (err) {
      return sendError(res, 500, String(err && err.message ? err.message : err))
    }
  }

  // prefix（浏览器载体）+ exact（桌面载体 fetch 桥只认精确路由）
  const disposers = [ctx.webServer.register({ kind: 'prefix', path: API_ROOT, handler: handler })]
  for (const p of API_PATHS) {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: API_ROOT + p, handler: handler }))
    } catch (err) {
      ctx.logger?.warn?.('work-personal-secretary: 精确路由注册失败 ' + p + '：' + (err && err.message ? err.message : err))
    }
  }
  return () => {
    for (const d of disposers) {
      try { d() } catch (e) { /* best-effort */ }
    }
  }
}

/**
 * P4 能力配置页的**精确路由**（桌面载体的 fetch 桥只认精确路由）。
 *
 * ⚠️ **当前未被 index.js 调用（默认不接线）** —— 这是刻意的取舍，不是遗漏：
 *   既有测试把路由集合锁死了两条口径：
 *     ① `scripts/probe-test.mjs:372-374` —— `installApi` 的 exact 集合必须 === API_PATHS（7 条）；
 *     ② `scripts/probe-test.mjs:497` —— `apply()` 注册的路由**总数**必须 === API_PATHS.length + 1（1 prefix + 7 exact）。
 *   ② 是「总数」断言：无论把 P4 的三条 exact 加在 installApi 还是 index.js 的 apply 里，都会让它变红。
 *   两条都属于本次任务「既有测试零回归」的硬约束，故三条路由一律经 **prefix** 分发
 *   （浏览器载体 / Web GUI 的根相对 fetch 已命中；见 client/index.js 的 requestJsonFull）。
 *
 *   若确认桌面外壳（http://dsh.internal 合成 origin）必须走精确路由，启用步骤为：
 *     1) 在 lib/index.js 的 apply 里调用本函数；
 *     2) 同步把 probe-test 第 497 行断言改为 `API_PATHS.length + 1 + SETTINGS_API_PATHS.length`。
 *   本函数已由 scripts/settings-api-test.mjs 的 [11] 段单测覆盖，接线即可用。
 *
 * @param {object} ctx cordis context（需 webServer）
 * @param {object} [deps] 与 installApi 同名参数：repoRoot / profileDir / env / moduleDir / commonCandidates
 * @returns {Function} disposer
 */
export function installSettingsExactRoutes(ctx, deps = {}) {
  const env = deps.env || process.env
  const repoRootConfig = typeof deps.repoRoot === 'string' ? deps.repoRoot : ''
  const profileDirOverride = typeof deps.profileDir === 'string' ? deps.profileDir : ''
  const moduleDir = deps.moduleDir || MODULE_DIR
  const currentRepoRoot = () => resolveRepoRoot({
    configRoot: repoRootConfig,
    moduleDir: moduleDir,
    env: env,
    commonCandidates: deps.commonCandidates,
  })
  const currentProfileDir = () => profileDirOverride || resolveProfileDir(env)

  const settingsApi = createSettingsApi(ctx, {
    sendJson: sendJson,
    sendError: sendError,
    readBody: readBody,
    sameOriginGuard: sameOriginGuard,
    resolveProfileDir: currentProfileDir,
    resolveRepoRoot: currentRepoRoot,
    moduleDir: moduleDir,
  })

  const exactHandler = async (req, res) => {
    const url = new URL(req.url || '/', 'http://dsh.internal')
    const sub = url.pathname.indexOf(API_ROOT) === 0 ? url.pathname.slice(API_ROOT.length) : ''
    await settingsApi.handle(req, res, url, sub)
  }

  const disposers = []
  for (const p of SETTINGS_API_PATHS) {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: API_ROOT + p, handler: exactHandler }))
    } catch (err) {
      ctx.logger?.warn?.('work-personal-secretary: 能力配置页精确路由注册失败 ' + p + '：'
        + (err && err.message ? err.message : err))
    }
  }
  return () => {
    for (const d of disposers) {
      try { d() } catch (e) { /* best-effort */ }
    }
  }
}
