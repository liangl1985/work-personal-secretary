/**
 * work-personal-secretary —— Web GUI API（环境检查 / 自动补齐）
 *
 * 路由前缀 /work-personal-secretary/api：
 *   GET  /check    —— 七项只读环境探针报告
 *   POST /fix      —— 按 id 执行**白名单固定命令**（同源保护）
 *   POST /fix-all  —— 批量补齐：服务端按固定依赖顺序串行执行（同源保护）
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
  PYTHON_MISSING_HINT,
} from './probe.js'

/** 路由前缀（接口契约定死） */
export const API_ROOT = '/work-personal-secretary/api'
/** 精确路由（桌面载体的 fetch 桥只认精确路由） */
export const API_PATHS = ['/check', '/fix', '/fix-all']

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
 * @returns {Function} disposer
 */
export function installApi(ctx, deps = {}) {
  const exec = typeof deps.exec === 'function' ? deps.exec : runFixCommand
  const doProbePython = typeof deps.probePython === 'function' ? deps.probePython : probePython
  const doResolvePython = typeof deps.resolvePython === 'function' ? deps.resolvePython : resolvePythonExecutable
  const doProbeWinget = typeof deps.probeWinget === 'function' ? deps.probeWinget : probeWinget
  const probeOptions = deps.probeOptions || {}
  const platform = deps.platform || process.platform

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

      // GET /check —— 七项只读环境检查
      if (req.method === 'GET' && (sub === '/check' || sub === '/check/')) {
        const report = await runProbes(probeOptions)
        return sendJson(res, 200, report)
      }

      // ---- 以下为写操作（同源保护） ----
      if (req.method === 'POST' && (sub === '/fix' || sub === '/fix/' || sub === '/fix-all' || sub === '/fix-all/')) {
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
