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
 *   GET  /basedeck    —— 配置底座的**只读计划**（dry-run；八项：指令层 / 记忆种子 / 技能 / 设置 / 目录 /
 *                        记忆体结构 / 知识库结构 / 迁移旧记忆库）
 *   POST /basedeck    —— 配置引导一次性写入（同源保护；**dryRun 默认 true**，只有显式 false 才落盘）
 *   GET  /settings        —— 能力配置页：白名单 ns 设置**只读枚举**（P4）
 *   POST /settings/write  —— 能力配置页：写子插件设置**用户层**（同源保护；dryRun 默认 true + revision 栅栏）
 *   GET  /experts/preview —— 能力配置页：专家打分实时预览（动态加载子插件 match.js；只读）
 *
 * 1.1.3 新增（同样走本文件的 prefix handler，**不并入 API_PATHS**）：
 *   GET|POST /preflight       —— 可用性检查（只读）：环境就绪 / 两目录合法可写 / 同工作区 / 目标无冲突
 *   GET  /identity            —— 读「使用者身份」条目状态与正文（只读）
 *   POST /identity/save       —— 整条写入身份（同源保护；dryRun 默认 true）
 *   GET  /domain/list         —— 五个预置岗位的身份正文（只读）
 *   POST /domain/generate     —— 岗位正文生成（同源保护；promptEnhancer → llm → 503 手填）
 *   GET  /dirs[?path=]        —— 目录选择：列一层目录（ctx.directoryPicker 的 browse 原语代理；只读）
 *   POST /dirs/new            —— 目录选择：在父目录下建一个子目录（同源保护；只建一层）
 *   POST /import/scan         —— 旧知识库导入：列清单 + 逐项对照（**只读**，绝不落盘；同源保护）
 *   POST /import/apply        —— 旧知识库导入：按勾选只补缺失（同源保护；dryRun 默认 true；绝不覆盖）
 *
 * 1.1.3 随包网页（**路径冻结**，用 kind:'exact' 挂在 /work-personal-secretary 下）：
 *   GET  /work-personal-secretary/guide —— 安装引导页（text/html；正文来自 defaults/install.zh-CN.md）
 *   GET  /work-personal-secretary/help  —— 使用说明页（text/html；正文来自 defaults/use.zh-CN.md）
 *
 * 路由注册口径（1.1.3 起 · 桌面外壳已接线）：
 *   - 所有 JSON 路由都经本文件的 **prefix** handler 分发（浏览器载体 / Web GUI 的根相对 fetch 命中它）；
 *   - 桌面载体的 fetch 桥（合成 origin http://dsh.internal）**只认精确路由**，因此 prefix 之外另注册 exact：
 *       API_PATHS（7）            /check /fix /fix-all /plugins /install /install-all /basedeck
 *       PAGE_PATHS（2，另一前缀） /work-personal-secretary/guide、/help
 *       CORE_API_EXACT_PATHS（12）/preflight /identity /identity/save /domain/list /domain/generate
 *                                 /docs /open-doc /setup-state /dirs /dirs/new /import/scan /import/apply
 *       SETTINGS_API_PATHS（3）   /settings /settings/write /experts/preview
 *     → **exact 共 24 条**；加 1 条 prefix，`apply()` 注册的**路由总数 = 25**。
 *   - 前 19 条在本函数内注册（handler 是本地闭包）；P4 三条由文件末尾的 installSettingsExactRoutes
 *     注册，并在 lib/index.js 的 apply 里**已接线**（1.1.3 起按产品决策方案 A）。
 *   - 既有 7 条精确路由的集合与顺序一字不动；四条测试断言（probe-test / settings-api-test /
 *     basedeck-test / install-test）已同步为上述完整集合的**相等比较**，未放宽为 includes / >=。
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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
  MODULE_ID,
  SUB_PLUGIN_ID_LIST,
  isRepoRoot,
  listSubPlugins,
  installSubPlugin,
  readProfileRepoRoot,
  resolveRepoRoot,
  writeProfileRepoRoot,
  resolveInstallAllPlan,
} from './install.js'

import {
  BASEDECK_ID_LIST,
  BASEDECK_OUTPUT_LIMIT,
  applyBaseDeck,
  detectVaultLayout,
  planBaseDeck,
  publicPlan,
  resolveDeckContext,
  safeWorkspaceParam,
} from './basedeck.js'

import { SETTINGS_API_PATHS, createSettingsApi } from './settings-api.js'
// 1.1.3 新增能力的宿主侧实现（T6 可用性检查 / T7 身份写入 / T8 岗位生成 / T9 随包网页）
import { runPreflight } from './preflight.js'
import { readSetupState, resolveMigrateSource } from './setup-state.js'
import { applyIdentityAsync, readIdentity } from './identity.js'
import { DOMAIN_MAX_CHARS, DOMAIN_NAME_MAX_CHARS, DOMAIN_PRESETS, IDENTITY_PREFIX, generateDomainContent } from './domain.js'
import { renderFragment, renderMarkdown, renderPage } from './md.js'
// 目录选择后端（宿主 ctx.directoryPicker 的 browse / native 能力分支代理）
import { createChildDirectory, listDirectories } from './dirs.js'
// 旧知识库导入（清单 → 勾选 → 逐项对照写入；只补缺失、不覆盖）
import { applyImport, scanImport } from './import.js'

/** 路由前缀（接口契约定死） */
export const API_ROOT = '/work-personal-secretary/api'
/** 精确路由（桌面载体的 fetch 桥只认精确路由） */
export const API_PATHS = ['/check', '/fix', '/fix-all', '/plugins', '/install', '/install-all', '/basedeck']

/**
 * 两个**随包网页**的根与路径（1.1.3，T9）。
 * ⚠️ 路径**已冻结**：客户端会直接指向它们（window.open 或页内展开），不得改动。
 * 它们不是 JSON API，所以挂在 /work-personal-secretary 下、不并入 API_PATHS；
 * 用 kind:'exact' 注册（与 API 前缀路由互不干扰，见 dsh-host-webserver 的 match：先 exact 后最长前缀）。
 */
export const PAGE_ROOT = '/work-personal-secretary'
export const PAGE_PATHS = ['/guide', '/help']

/**
 * 1.1.3 新增 JSON 路由的**精确路径**（桌面载体的 fetch 桥只认精确路由）。
 * 它们的 handler 是 installApi 的闭包（依赖探针 / settingsApi / currentMemoryDir），
 * 所以在 installApi 内与 API_PATHS、PAGE_PATHS 一起注册；不含 P4 三条
 * （SETTINGS_API_PATHS 由 installSettingsExactRoutes 单独注册、由 lib/index.js 接线）。
 */
export const CORE_API_EXACT_PATHS = ['/preflight', '/identity', '/identity/save', '/domain/list', '/domain/generate', '/docs', '/open-doc', '/setup-state', '/dirs', '/dirs/new', '/import/scan', '/import/apply']

/**
 * 两个说明文档的**唯一映射**（单一真相源 = defaults 下的 md）：
 *   md   —— 真相源，网页渲染与记忆条目都取它；
 *   html —— **受校验的产物**，由 `node scripts/build-defaults-html.mjs` 用 lib/md.js 渲染生成，
 *           defaults-test 会逐字节比对「磁盘 html」与「现渲染结果」；
 *   title—— 页面标题。
 * PAGE_SPECS（网页路由）与 open-doc 的白名单都从这一张表派生，杜绝两处漂移。
 */
export const DOC_SPECS = {
  guide: { md: 'install.zh-CN.md', html: 'install.zh-CN.html', title: '工作秘书 · 安装引导' },
  help: { md: 'use.zh-CN.md', html: 'use.zh-CN.html', title: '工作秘书 · 使用说明' },
}

/**
 * 两个随包网页的路径映射（1.1.3 返工 R1-3，**接口已冻结**）。
 * ⚠️ 真机上浏览器直接导航这两个地址会拿到 403（宿主门禁 isTrustedApiRequest 不带 GUI 会话 cookie，
 * 见 node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:553-556）；
 * **主路径已改为 POST /open-doc 打开插件目录里的物理 HTML**，本映射只为兼容与页内取用而保留。
 *
 * 两种输出形态：
 *   不带 embed（默认）→ 完整 HTML 文档
 *   ?embed=1          → **片段**：无 <html>/<head>/<body>，样式全部作用域在 .wps-doc
 */
export const PAGE_SPECS = {
  '/guide': DOC_SPECS.guide,
  '/help': DOC_SPECS.help,
}

/**
 * 本体设置命名空间名（与 lib/settings.js 的 SETTINGS_NS 同值：= 本体包名）。
 * 这里直接用 MODULE_ID，避免为取一个字符串常量把 settings.js 的 top-level await 拉进依赖链。
 */
export const SETTINGS_NS = MODULE_ID

/** /repo-root 可接受的仓库目录字符串长度上限（防滥用；远超正常路径） */
export const REPO_ROOT_MAX_CHARS = 512

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

/** 直出 HTML（随包两个说明网页用；不做任何模板渲染，正文来自 defaults/*.md） */
function sendHtml(res, status, html) {
  const buf = Buffer.from(String(html == null ? '' : html), 'utf8')
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(buf.length) })
  res.end(buf)
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

/**
 * **只读路由**的同源守卫（GET 不带 content-type，不能复用 sameOriginGuard）：
 * 同源导航 / 同源 fetch 往往不带 Origin → 放行；**带了** Origin 且与 Host 不同源 → 拒绝（拦跨站读取）。
 * @returns {string|null} 拒绝原因，放行返回 null
 */
function sameOriginLooseGuard(req) {
  const host = String(req.headers.host || '')
  const origin = String(req.headers.origin || '')
  if (!origin) return null
  if (!host) return '缺少 Host 头'
  try {
    if (new URL(origin).host !== host) return '跨站请求已拒绝'
  } catch (e) {
    return '跨站请求已拒绝'
  }
  return null
}

/** 路径规范化（比较用：resolve + 正斜杠 + Windows 大小写不敏感） */
function pathKey(p) {
  const s = String(p == null ? '' : p).trim()
  if (!s) return ''
  let out = s
  try { out = resolve(s) } catch (e) { out = s }
  out = out.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/** child 是否等于 parent 或在其之下（用于把 GET /identity 的可读范围限制在记忆库目录内） */
function isPathWithin(child, parent) {
  const a = pathKey(child)
  const b = pathKey(parent)
  if (!a || !b) return false
  if (a === b) return true
  return a.indexOf(b + '/') === 0
}

/**
 * 用**系统默认程序**打开一个本地文件（不经过 Web 路由、不需要任何浏览器凭据）。
 *
 * 平台写法与依据：
 *   · Windows：`explorer.exe <绝对路径>` —— 等价于在资源管理器里双击该文件，交给文件关联决定用哪个程序；
 *     调用一律走 `execFile` + **参数数组**，**不经 shell**（不启用 child_process 的 shell 选项），
 *     路径不会被解释成命令或参数分隔符。
 *     ⚠️ `explorer.exe` 的退出码不可靠（成功也常返回 1），所以**只把「进程无法启动」
 *     （ENOENT / EACCES / EPERM）判为失败**，其余一律视为已交给系统。
 *   · macOS：`open <file>`；Linux：`xdg-open <file>`（同样只用参数数组）。
 *
 * @param {string} file 绝对路径（调用方已做白名单查表 + 存在性校验）
 * @param {object} [options] { platform, exec }（exec 仅供测试注入）
 * @returns {Promise<{ok:boolean, command:string, code:string, error:string}>}
 */
export function openWithSystem(file, options = {}) {
  const platform = options.platform || process.platform
  const run = typeof options.exec === 'function' ? options.exec : execFile
  const spec = platform === 'win32'
    ? { cmd: 'explorer.exe', args: [file] }
    : (platform === 'darwin' ? { cmd: 'open', args: [file] } : { cmd: 'xdg-open', args: [file] })
  const command = spec.cmd + ' ' + spec.args.join(' ')
  return new Promise((resolve) => {
    try {
      run(spec.cmd, spec.args, { windowsHide: true, timeout: 10000 }, (err) => {
        const code = err && err.code ? String(err.code) : ''
        if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
          resolve({ ok: false, command: command, code: code, error: '系统命令不可用（' + code + '）：' + spec.cmd })
          return
        }
        resolve({ ok: true, command: command, code: '', error: '' })
      })
    } catch (err) {
      resolve({ ok: false, command: command, code: String((err && err.code) || 'spawn-failed'), error: String(err && err.message ? err.message : err) })
    }
  })
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

  const currentProfileDir = () => profileDirOverride || resolveProfileDir(installEnv)

  // ── repoRoot 四种来源（2026-09-14 起的优先级） ──────────────────────────
  // ① 设置页设置值（settingsRepoRoot，用户层，免重启）② 部署配置层（repoRootConfig：
  //   组合配置 / cordis.patch.yml 经宿主注入的 config）③ profile 的 cordis.patch.yml 里
  //   显式写的 repoRoot（profileRepoRoot，宿主未注入 config 时兜底）④ 自动探测（祖先 / 常见位置）。
  const settingsHandle = (deps.settings && typeof deps.settings.read === 'function') ? deps.settings : null
  const settingsOf = () => (ctx && ctx.settings && typeof ctx.settings.describe === 'function') ? ctx.settings : null
  const sanitizeErr = (err) => {
    const s = String(err && err.message ? err.message : err).split('\n')[0]
    return s.length > 300 ? s.slice(0, 300) + '…' : s
  }
  /** 输出 POSIX 风格路径（JSON 里不出现转义反斜杠；与 install.js 的 posix 同口径） */
  const slash = (p) => String(p == null ? '' : p).replace(/\\/g, '/')

  /** 设置页里的 repoRoot（实时读；无设置服务 / 句柄缺失 → 空串） */
  function settingsRepoRoot() {
    if (!settingsHandle) return ''
    try {
      const v = settingsHandle.read()
      return v && typeof v.repoRoot === 'string' ? v.repoRoot.trim() : ''
    } catch (e) {
      return ''
    }
  }

  /** profile 的 cordis.patch.yml 里的 repoRoot（只读；读不到 → 空串） */
  function profileRepoRoot() {
    try {
      return readProfileRepoRoot(currentProfileDir())
    } catch (e) {
      return ''
    }
  }

  const currentRepoRoot = () => resolveRepoRoot({
    settingsRoot: settingsRepoRoot(),
    configRoot: repoRootConfig,
    profileRoot: '',
    profileDir: currentProfileDir(),
    moduleDir: installModuleDir,
    env: installEnv,
    commonCandidates: deps.commonCandidates,
  })

  /**
   * 把 repoRoot 写进**设置用户层**（免重启热生效）。写入前先 describe 取 revision（栅栏）。
   * 设置服务不可用 / ns 未注册 / 写入失败 → 返回可读错误（调用方决定是否退回写 patch）。
   * @returns {Promise<{ok:boolean, revision?:(number|null), code?:string, error?:string}>}
   */
  async function writeSettingsRepoRoot(value) {
    const settings = settingsOf()
    if (!settings || typeof settings.mutate !== 'function') {
      return { ok: false, code: 'settings-unavailable', error: '设置服务不可用（ctx.settings 缺失或只读）' }
    }
    let list = []
    try {
      const described = await settings.describe({ redactSecrets: true })
      list = Array.isArray(described) ? described : (described && Array.isArray(described.namespaces) ? described.namespaces : [])
    } catch (err) {
      return { ok: false, code: 'describe-failed', error: '读取设置失败：' + sanitizeErr(err) }
    }
    const target = list.filter((n) => n && n.ns === SETTINGS_NS)[0]
    if (!target || target.installed === false) {
      return { ok: false, code: 'ns-unavailable', error: '设置命名空间 ' + SETTINGS_NS + ' 未注册（本体设置服务未就绪）' }
    }
    const revision = Number.isInteger(target.revision) ? target.revision : 0
    try {
      await settings.mutate(SETTINGS_NS, [{ op: 'set', path: ['repoRoot'], value: value }], revision)
    } catch (err) {
      const code = (err && err.code) ? String(err.code) : 'write-failed'
      const extra = code === 'SETTINGS_CONFLICT' ? '（设置已被其它窗口改动，请重新读取后再写）' : ''
      return { ok: false, code: code, error: '写入设置失败' + extra + '：' + sanitizeErr(err) }
    }
    let after = null
    try {
      const described = await settings.describe({ redactSecrets: true })
      const l = Array.isArray(described) ? described : (described && described.namespaces) || []
      after = l.filter((n) => n && n.ns === SETTINGS_NS)[0] || null
    } catch (e) {
      after = null
    }
    return { ok: true, revision: (after && Number.isInteger(after.revision)) ? after.revision : null }
  }

  /**
   * 安装成功后：若仓库根此前**没有任何登记**（设置 / 部署配置 / profile patch 都空）而只靠自动
   * 探测命中，就把它写回（优先设置用户层，其次 profile 的 cordis.patch.yml —— 写前备份）。
   * **任何失败都只 warn，绝不改安装结果**（写回是便利，不是安装的前置条件）。
   * @returns {Promise<object|null>} null = 无需求（已有登记 / 非探测来源）
   */
  async function ensureRepoRootRecorded(repo) {
    try {
      const root = (repo && typeof repo.repoRoot === 'string') ? repo.repoRoot : ''
      if (!root) return null
      if (settingsRepoRoot() || repoRootConfig || profileRepoRoot()) return null
      const detail = repo.sourceDetail
      if (detail !== 'ancestor' && detail !== 'common') return null
      const how = detail === 'ancestor' ? '从本体模块位置逐级向上推导' : '从常见安装位置探测'
      const written = await writeSettingsRepoRoot(root)
      if (written.ok) {
        return {
          ok: true, written: 'settings', repoRoot: root, sourceDetail: detail, revision: written.revision,
          message: '安装器已把' + how + '出的集成体仓库目录写回设置（' + SETTINGS_NS + '.repoRoot），下次无需再填',
        }
      }
      const patch = writeProfileRepoRoot(currentProfileDir(), root, { now: installNow })
      if (patch.ok) {
        return {
          ok: true, written: 'patch', repoRoot: root, sourceDetail: detail,
          file: patch.file, backup: patch.backup, message: '安装器已把' + how
            + '出的集成体仓库目录写回 profile 配置（' + SETTINGS_NS + ' → repoRoot；改前已备份）',
        }
      }
      const why = written.error + '；' + patch.error
      ctx.logger?.warn?.('work-personal-secretary: repoRoot 自动写回失败（不影响安装）：' + why)
      return { ok: false, written: '', repoRoot: root, sourceDetail: detail, message: 'repoRoot 自动写回失败（不影响安装）：' + why }
    } catch (err) {
      const msg = sanitizeErr(err)
      ctx.logger?.warn?.('work-personal-secretary: repoRoot 自动写回异常（不影响安装）：' + msg)
      return { ok: false, written: '', message: 'repoRoot 自动写回异常（不影响安装）：' + msg }
    }
  }

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

  // ---- 随包说明文件（1.1.3 / T9b）：白名单查表 + 用系统默认程序打开 ----
  // doc → 固定文件名（绝不接受客户端传路径）；docsDir 只在测试里注入，运行期恒为 <模块>/defaults。
  const docsDir = (typeof deps.docsDir === 'string' && deps.docsDir) ? deps.docsDir : join(installModuleDir, 'defaults')
  const openDocImpl = typeof deps.openDoc === 'function' ? deps.openDoc : openWithSystem
  const docSpecOf = (doc) => DOC_SPECS[doc] || null
  const docFilePath = (doc) => { const s = docSpecOf(doc); return s ? join(docsDir, s.html) : '' }
  const fileIsFile = (p) => { try { return statSync(p).isFile() } catch (e) { return false } }

  /**
   * 当前记忆库目录（1.1.3）：从设置 / 工作区推导解析，**只读**。
   * 客户端未显式传 memoryDir 时用它兜底；解析不到返回空串（由调用方给可读错误）。
   */
  const currentMemoryDir = () => {
    try {
      const deck = resolveDeckContext({
        dshHome: basedeckDshHome,
        configWorkspace: basedeckWorkspaceConfig,
        env: installEnv,
        now: installNow,
        moduleDir: installModuleDir,
      })
      return deck.memoryDir || ''
    } catch (e) {
      return ''
    }
  }

  /** 统一失败响应：{ ok:false, error } 之外保留原字段（便于客户端定位） */
  const failBody = (result) => Object.assign({ error: String(result && result.detail ? result.detail : '操作失败') }, result)

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

      // ══ 1.1.3 新增（T6 可用性检查 / T7 身份读写 / T8 岗位生成）══
      // 全部走本 prefix handler（浏览器载体 / Web GUI 命中；不并入 API_PATHS）。

      // GET|POST /preflight —— 可用性检查（**只读**）：环境就绪 · 两目录路径合法可写 · 同工作区 · 目标无冲突
      //   GET  /preflight?memoryDir=&obsidianDir=&workspace=
      //   POST /preflight { memoryDir, obsidianDir, workspace }（同源保护）
      if (sub === '/preflight' || sub === '/preflight/') {
        const q = (name) => url.searchParams.get(name) || ''
        let body0 = {}
        if (req.method === 'POST') {
          const guard = sameOriginGuard(req)
          if (guard) return sendError(res, 403, guard)
          try { body0 = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        } else if (req.method !== 'GET') {
          return sendError(res, 405, 'preflight 只支持 GET（查询参数）与 POST（JSON）')
        }
        const pick = (key) => {
          const v = body0 && typeof body0[key] === 'string' ? body0[key] : ''
          return String(v || q(key)).trim().slice(0, 1024)
        }
        const workspaceRaw = pick('workspace')
        let workspace = ''
        if (workspaceRaw) {
          const check = safeWorkspaceParam(workspaceRaw)
          if (check.ok) workspace = check.workspace
        }
        const report = await runProbes(probeOptions)
        const result = runPreflight({
          report: report,
          memoryDir: pick('memoryDir'),
          obsidianDir: pick('obsidianDir'),
          workspace: workspace,
          env: installEnv,
        })
        return sendJson(res, 200, {
          ok: true, ready: result.ready, checks: result.checks, summary: result.summary, checkedAt: report.checkedAt,
        })
      }

      // GET /identity[?memoryDir=] —— 当前「使用者身份」条目状态与正文（只读）
      // 1.1.3 返工 R1-4：补只读同源守卫，并把可读范围限制为「配置里的记忆库目录或其子路径」
      if (req.method === 'GET' && (sub === '/identity' || sub === '/identity/')) {
        const guard = sameOriginLooseGuard(req)
        if (guard) return sendError(res, 403, guard)
        const dirParam = String(url.searchParams.get('memoryDir') || '').trim().slice(0, 1024)
        const allowedDir = currentMemoryDir()
        if (dirParam && !isPathWithin(dirParam, allowedDir)) {
          return sendError(res, 403, 'memoryDir 只能读取当前配置的记忆库目录或其子路径；已拒绝：' + dirParam)
        }
        return sendJson(res, 200, readIdentity({ memoryDir: dirParam || allowedDir }))
      }

      // POST /identity/save { content, memoryDir?, dryRun } —— 整条写入身份（同源保护；dryRun 默认 true）
      if (req.method === 'POST' && (sub === '/identity/save' || sub === '/identity/save/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const dirParam = typeof body.memoryDir === 'string' ? body.memoryDir.trim().slice(0, 1024) : ''
        // 用**异步**锁版本：等待 .work-memory.lock 时让出事件循环，不阻塞宿主进程
        const result = await applyIdentityAsync({
          memoryDir: dirParam || currentMemoryDir(),
          content: typeof body.content === 'string' ? body.content.slice(0, 4000) : '',
          now: installNow,
          dryRun: body.dryRun !== false,
          env: installEnv,
        })
        return sendJson(res, 200, result.ok ? result : failBody(result))
      }

      // GET /domain/list —— 五个预置岗位的正文（只读；客户端下拉直接取用）
      if (req.method === 'GET' && (sub === '/domain/list' || sub === '/domain/list/')) {
        return sendJson(res, 200, {
          ok: true,
          prefix: IDENTITY_PREFIX,
          maxChars: DOMAIN_MAX_CHARS,
          items: DOMAIN_PRESETS.map((p) => ({ id: p.id, label: p.label, content: p.content })),
          note: '预置正文不含「' + IDENTITY_PREFIX + '」前缀，由 POST /identity/save 统一加上；都不是（新建岗位）时可自填或调 POST /domain/generate 生成',
        })
      }

      // POST /domain/generate { name, content } —— 生成岗位身份正文（同源保护）
      // 通道与桌宠同构：promptEnhancer 优先 → llm + agentDefaultModel → 都没有 → 503 + 可读中文提示
      if (req.method === 'POST' && (sub === '/domain/generate' || sub === '/domain/generate/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, DOMAIN_NAME_MAX_CHARS) : ''
        const draft = typeof body.content === 'string' ? body.content.trim().slice(0, 2000) : ''
        if (!name && !draft) {
          return sendJson(res, 400, { ok: false, error: '岗位名称与岗位内容至少填一项，否则没有可生成的依据' })
        }
        // 会话路由可由客户端带入（桌宠同款做法：客户端从会话上下文取到后放进请求体；
        // 不传则回退 agentDefaultModel —— 设置分区插槽本身拿不到会话路由）
        const result = await generateDomainContent(ctx, {
          name: name,
          content: draft,
          provider: typeof body.provider === 'string' ? body.provider.trim().slice(0, 64) : '',
          model: typeof body.model === 'string' ? body.model.trim().slice(0, 64) : '',
        })
        if (result.ok) {
          return sendJson(res, 200, {
            ok: true, content: result.content, channel: result.channel,
            provider: result.provider, model: result.model,
            name: result.name || name, maxChars: DOMAIN_MAX_CHARS, nameMaxChars: DOMAIN_NAME_MAX_CHARS,
          })
        }
        return sendJson(res, result.code === 'no-model-service' ? 503 : 502, {
          ok: false, error: result.error, channel: result.channel, code: result.code,
          name: result.name || name, maxChars: DOMAIN_MAX_CHARS, nameMaxChars: DOMAIN_NAME_MAX_CHARS,
        })
      }

      // GET /docs —— 两个随包说明文件的存在性与绝对路径（只读；客户端据此判断可用性）
      if (req.method === 'GET' && (sub === '/docs' || sub === '/docs/')) {
        const items = Object.keys(DOC_SPECS).map((doc) => {
          const file = docFilePath(doc)
          return {
            doc: doc, title: DOC_SPECS[doc].title, file: DOC_SPECS[doc].html,
            path: slash(file), exists: fileIsFile(file),
          }
        })
        return sendJson(res, 200, {
          ok: true, dir: slash(docsDir), items: items, ready: items.every((it) => it.exists),
        })
      }

      // POST /open-doc { doc: 'guide' | 'help' } —— 用**系统默认程序**打开随包 HTML（同源保护）
      // doc 只做白名单查表（沿用 FIX_WHITELIST 的纪律：**绝不接受客户端传路径或命令**）
      if (req.method === 'POST' && (sub === '/open-doc' || sub === '/open-doc/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const doc = typeof body.doc === 'string' ? body.doc.trim().slice(0, 32) : ''
        const spec = docSpecOf(doc)
        if (!spec) {
          return sendJson(res, 400, {
            ok: false, doc: doc, code: 'unknown-doc',
            error: '只有 ' + Object.keys(DOC_SPECS).join(' / ') + ' 两个说明文件可打开；已拒绝：' + (doc || '（空）'),
          })
        }
        const file = docFilePath(doc)
        if (!fileIsFile(file)) {
          return sendJson(res, 200, {
            ok: false, doc: doc, path: slash(file), code: 'file-missing',
            error: '随包说明文件不存在（安装可能不完整）：' + slash(file) + '；可重装集成体，或改用页面内嵌说明',
          })
        }
        const opened = await openDocImpl(file, { platform: platform })
        if (!opened || opened.ok !== true) {
          return sendJson(res, 200, {
            ok: false, doc: doc, path: slash(file), command: (opened && opened.command) || '',
            code: (opened && opened.code) || 'open-failed',
            error: '无法用系统默认程序打开说明文件：' + ((opened && opened.error) || '未知原因') + '；可手动打开：' + slash(file),
          })
        }
        return sendJson(res, 200, {
          ok: true, doc: doc, title: spec.title, path: slash(file), command: opened.command,
        })
      }

      // GET /setup-state —— 核心配置页的「当前生效值」（**只读**；取值只走宿主设置服务 ctx.settings，
      // 绝不读 ~/.dsh/settings.yaml）。设置服务缺失 / 记忆库不可读 → 各字段按 none 降级 + 可读 note，不抛异常。
      if (req.method === 'GET' && (sub === '/setup-state' || sub === '/setup-state/')) {
        const state = await readSetupState(ctx, { env: installEnv, dshHome: basedeckDshHome })
        // T5-7：识别「新版目录模型 / 旧版知识库布局」，供客户端在核心配置页提示。
        // 判定对象优先用反推出来的存储根目录，其次用知识库目录；两者都空则 unknown。
        const layoutTarget = String((state.root && state.root.value) || (state.obsidianDir && state.obsidianDir.value) || '')
        return sendJson(res, 200, { ...state, vaultLayout: detectVaultLayout(layoutTarget) })
      }

      // ⑪ 目录选择后端（1.1.3 · 方案 A）—— 宿主的 ctx.directoryPicker 是**可判别能力**：
      //   browse → 用 list / createDirectory 两个原语在宿主文件系统上作答（本文件只做代理）；
      //   native → 由系统对话框完成选择，本接口明确告知（不假装支持）；
      //   服务缺失 / 能力未知 → 可读降级，**绝不抛异常、不 500**。
      // 服务一律运行时 ctx.get('directoryPicker') 取值，**绝不写进 inject**（缺该服务的环境不能让插件加载失败）。
      // GET /dirs[?path=<完全限定绝对路径>] —— 列一层目录（只读；**不传 path** 表示用宿主默认位置）
      if (req.method === 'GET' && (sub === '/dirs' || sub === '/dirs/')) {
        const guard = sameOriginLooseGuard(req)
        if (guard) return sendError(res, 403, guard)
        const result = await listDirectories(ctx, {
          // 区分「没传参数」与「传了空串」：后者是调用方给错了，400
          path: url.searchParams.has('path') ? String(url.searchParams.get('path') || '') : undefined,
          platform: platform,
        })
        return sendJson(res, result.status, result.body)
      }

      // POST /dirs/new { path, name } —— 在父目录下建一个子目录（同源保护；只建一层）
      if (req.method === 'POST' && (sub === '/dirs/new' || sub === '/dirs/new/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) {
          return sendJson(res, 400, { ok: false, code: 'bad-body', message: String(err && err.message ? err.message : err) })
        }
        const result = await createChildDirectory(ctx, { path: body.path, name: body.name, platform: platform })
        return sendJson(res, result.status, result.body)
      }

      // ⑫ 旧知识库导入（T5-5）：清单 → 勾选 → 逐项对照写入。
      //   POST /import/scan  { from, to }               —— **只读**列清单 + 逐项对照（同源保护）
      //   POST /import/apply { from, to, rels, dryRun } —— 按勾选只补缺失（同源保护；dryRun 默认 true）
      // 纪律（设计定稿 §3.4 与 §12 决议 8 / 13②）：只读源目录、只补还没有的文件、**绝不覆盖现有文件**；
      // 先列清单再由使用者勾选；已存在 / 冲突 / 被占用的条目一律保留目标，只有清单里 state='copy' 的条目才可能被写入。
      if (req.method === 'POST' && (sub === '/import/scan' || sub === '/import/scan/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        try { body = await readBody(req) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const result = scanImport({
          from: typeof body.from === 'string' ? body.from.trim().slice(0, 1024) : '',
          to: typeof body.to === 'string' ? body.to.trim().slice(0, 1024) : '',
          env: installEnv,
        })
        return sendJson(res, result.ok ? 200 : 400, result)
      }

      // POST /import/apply：只补缺失、不覆盖；dryRun 默认 true（不带 dryRun:false 绝不写盘）
      if (req.method === 'POST' && (sub === '/import/apply' || sub === '/import/apply/')) {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
        let body
        // 勾选清单可能很长（每条一个相对路径），上限放到 512KB
        try { body = await readBody(req, 512 * 1024) } catch (err) { return sendError(res, 400, String(err && err.message ? err.message : err)) }
        const result = applyImport({
          from: typeof body.from === 'string' ? body.from.trim().slice(0, 1024) : '',
          to: typeof body.to === 'string' ? body.to.trim().slice(0, 1024) : '',
          rels: Array.isArray(body.rels) ? body.rels.slice(0, 5000) : body.rels,
          dryRun: body.dryRun !== false,
          env: installEnv,
        })
        return sendJson(res, result.ok ? 200 : 400, result)
      }

      // GET /check —— 七项只读环境检查
      if (req.method === 'GET' && (sub === '/check' || sub === '/check/')) {
        const report = await runProbes(probeOptions)
        return sendJson(res, 200, report)
      }

      // GET /plugins —— 五个子插件的版本 / 安装模式清单（**只读**，不触发任何安装）
      // 2026-09-14 增补（只增不改）：items[] 增加 registered / bundleHit / dirPresent，
      // 顶层增加 settingsRepoRoot / configRepoRoot / profileRepoRoot / repoRootError。
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
          settingsRepoRoot: settingsRepoRoot() ? slash(settingsRepoRoot()) : null,
          configRepoRoot: repoRootConfig ? slash(repoRootConfig) : null,
          profileRepoRoot: profileRepoRoot() ? slash(profileRepoRoot()) : null,
        }
        const hints = []
        // 设置值非空但无效 → 显式回显（不静默），并继续用后面的来源
        if (repo.settingsError) {
          payload.repoRootError = repo.settingsError
          hints.push(repo.settingsError)
        }
        if (!listing.repoRoot) {
          hints.push('未找到集成体仓库目录：可在「设置 → 工作秘书 → 安装与检查」里填集成体仓库目录，或在该 profile 的 cordis.patch.yml 写 repoRoot')
        }
        if (!listing.profileDir) hints.push('未找到当前 profile 目录（可用 DSH_PROFILE_DIR / DSH_PROFILE 指定，默认 ~/.dsh/profiles/desktop）')
        if (hints.length > 0) payload.message = hints.join('；')
        return sendJson(res, 200, payload)
      }

      // GET /repo-root —— repoRoot 四种来源与当前解析结果（**只读**）
      // POST /repo-root { repoRoot } —— 写**设置用户层**（免重启）；设置服务不可用时退回写 profile 的
      //   cordis.patch.yml（写前备份）。非空但无效 → 400 可读错误且**绝不写盘**（不静默）。
      if (sub === '/repo-root' || sub === '/repo-root/') {
        const profileDirNow = currentProfileDir()
        if (req.method === 'GET') {
          const repo = currentRepoRoot()
          const payload = {
            ok: true,
            repoRoot: repo.repoRoot ? slash(repo.repoRoot) : null,
            repoRootSource: repo.source,
            repoRootSourceDetail: repo.sourceDetail,
            settingsRepoRoot: settingsRepoRoot() ? slash(settingsRepoRoot()) : null,
            configRepoRoot: repoRootConfig ? slash(repoRootConfig) : null,
            profileRepoRoot: profileRepoRoot() ? slash(profileRepoRoot()) : null,
            profileDir: profileDirNow ? slash(profileDirNow) : null,
            settingsAvailable: Boolean(settingsOf() && typeof settingsOf().mutate === 'function'),
            hint: '留空 = 自动探测（先读 profile 的 cordis.patch.yml，再从本体模块位置向上找含 modules/ 的目录）',
          }
          if (repo.settingsError) {
            payload.repoRootError = repo.settingsError
            payload.message = repo.settingsError
          }
          return sendJson(res, 200, payload)
        }
        if (req.method === 'POST') {
          const guard = sameOriginGuard(req)
          if (guard) return sendError(res, 403, guard)
          let body
          try {
            body = await readBody(req)
          } catch (err) {
            return sendError(res, 400, String(err && err.message ? err.message : err))
          }
          const rawValue = (body && typeof body.repoRoot === 'string') ? body.repoRoot.trim() : ''
          const value = rawValue.slice(0, REPO_ROOT_MAX_CHARS)
          if (value && !isRepoRoot(value)) {
            return sendJson(res, 400, {
              ok: false, error: 'repo-root-invalid', repoRoot: slash(value), written: '',
              message: '集成体仓库目录无效（应包含 modules/<id>/package.json）：' + slash(value) + '；未写盘',
            })
          }
          const written = await writeSettingsRepoRoot(value)
          if (written.ok) {
            const after = currentRepoRoot()
            return sendJson(res, 200, {
              ok: true, written: 'settings', repoRoot: value ? slash(value) : null,
              revision: written.revision,
              repoRootSource: after.source, repoRootSourceDetail: after.sourceDetail,
              message: value
                ? '已写入设置（' + SETTINGS_NS + '.repoRoot，免重启生效）'
                : '已清空设置里的 repoRoot（回到自动探测）',
            })
          }
          // 设置服务不可用 → 退回写 profile 配置（写前备份；写失败只回可读错误）
          if (value) {
            const patch = writeProfileRepoRoot(profileDirNow, value, { now: installNow })
            if (patch.ok) {
              return sendJson(res, 200, {
                ok: true, written: 'patch', repoRoot: slash(value), file: patch.file, backup: patch.backup,
                message: '设置服务不可用（' + written.error + '），已写回 profile 的 cordis.patch.yml（改前已备份）',
              })
            }
            return sendJson(res, 200, {
              ok: false, written: '', error: 'write-failed', repoRoot: slash(value),
              message: written.error + '；' + patch.error,
            })
          }
          return sendJson(res, 200, {
            ok: false, written: '', error: written.code || 'settings-unavailable',
            message: written.error + '（清空设置需要设置服务可用）',
          })
        }
        return sendError(res, 405, 'repo-root 只支持 GET（读取）与 POST（写入）')
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
        // 安装成功且仓库根此前没有任何登记 → 把探测结果写回设置 / patch（**失败不影响安装结果**）
        if (result && result.ok) {
          const recorded = await ensureRepoRootRecorded(repo)
          if (recorded) result.repoRootRecorded = recorded
        }
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
        if (results.some((r) => r.ok)) {
          const recorded = await ensureRepoRootRecorded(repo)
          if (recorded) payload.repoRootRecorded = recorded
        }
        if (plan.rejected.length > 0) payload.message = '已忽略不在白名单的 id：' + plan.rejected.join(' / ')
        return sendJson(res, 200, payload)
      }

      // ⑧ 迁移来源（旧记忆库目录）：只走宿主设置服务 + 两个默认位置的存在性判定，**只读、绝不抛**
      // 口径与回显见 setup-state.js 的 resolveMigrateSource（settings / legacy-default / new-default）
      const migrateSource = async () => {
        try {
          const st = await readSetupState(ctx, { env: installEnv, dshHome: basedeckDshHome })
          return resolveMigrateSource(st, { env: installEnv, dshHome: basedeckDshHome })
        } catch (err) {
          return { from: '', source: 'none' }
        }
      }

      // GET /basedeck —— 配置底座的**只读计划**（dry-run；绝不写盘）
      // ?workspace=<绝对路径> 可显式指定工作区；无效时回退服务端解析并在 message 里说明。
      if (req.method === 'GET' && (sub === '/basedeck' || sub === '/basedeck/')) {
        const wsParam = url.searchParams.get('workspace') || ''
        // 1.1.3：?obsidianDir=<知识库根> —— 显式指定知识库目录（知识库结构生成器用它）
        const vaultParam = String(url.searchParams.get('obsidianDir') || '').trim().slice(0, 1024)
        let workspaceOverride = ''
        let message = ''
        if (wsParam) {
          const check = safeWorkspaceParam(wsParam)
          if (check.ok) workspaceOverride = check.workspace
          else message = 'workspace 参数无效，已回退服务端解析：' + check.error
        }
        const queryOverrides = {}
        if (workspaceOverride) queryOverrides.workspace = workspaceOverride
        if (vaultParam) queryOverrides.obsidianDir = vaultParam
        const repo = currentRepoRoot()
        const mig = await migrateSource()
        const plan = planBaseDeck({
          // query 里的 workspace 是**客户端显式传值** → 走 overrides（source=client）
          overrides: queryOverrides,
          dshHome: basedeckDshHome,
          configWorkspace: basedeckWorkspaceConfig,
          repoRoot: repo.repoRoot,
          env: installEnv,
          now: installNow,
          moduleDir: installModuleDir,
          commonCandidates: deps.commonCandidates,
          migrateFrom: mig.from,
          migrateFromSource: mig.source,
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
            message: 'ids 必须是字符串数组（缺省 = 八项全部）',
          })
        }
        const rawOverrides = (body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)) ? body.overrides : {}
        const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 512) : '')
        const overrides = {
          defaultDomain: clean(rawOverrides.defaultDomain, 64),
          identityExpert: clean(rawOverrides.identityExpert, 64),
          memoryDir: clean(rawOverrides.memoryDir, 1024),
          obsidianSyncDir: clean(rawOverrides.obsidianSyncDir, 1024),
          // 1.1.3：知识库根目录（与 obsidianSyncDir 严格区分：前者是 vault 根，后者是镜像子目录）
          obsidianDir: clean(rawOverrides.obsidianDir, 1024),
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
        const mig = await migrateSource()
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
          migrateFrom: mig.from,
          migrateFromSource: mig.source,
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
          migrateFrom: applied.migrateFrom || '',
          migrateFromSource: applied.migrateFromSource || '',
          results: applied.results,
          rejected: applied.rejected,
          wroteAny: applied.wroteAny === true,
          stoppedAt: applied.stoppedAt || '',
          stopReason: applied.stopReason || '',
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

  // ── 两个随包网页（1.1.3 / T9；路径冻结，客户端直接指向） ──
  // 用 exact 注册在 PAGE_ROOT 下（不是 API 前缀下）：/work-personal-secretary/guide 与 /help。
  const pageHandler = async (req, res) => {
    const notFound = (code, text) => sendHtml(res, code,
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + text + '</title></head>'
      + '<body style="font-family:system-ui,sans-serif;padding:32px"><p>' + text + '</p></body></html>')
    try {
      const method = String(req.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') return notFound(405, '本页只支持 GET')
      const url = new URL(req.url || '/', 'http://dsh.internal')
      const subPath = url.pathname.indexOf(PAGE_ROOT) === 0 ? url.pathname.slice(PAGE_ROOT.length) : ''
      const spec = PAGE_SPECS[subPath]
      if (!spec) return notFound(404, '页面不存在')
      // embed=1 → 只回**片段**（无 html/head/body + 作用域化样式），供客户端注入宿主 GUI；
      // 不带 embed（默认）→ 完整文档，浏览器直接访问。
      const embed = String(url.searchParams.get('embed') || '') === '1'
      const raw = readFileSync(join(installModuleDir, 'defaults', spec.md), 'utf8')
      const body = renderMarkdown(raw)
      return sendHtml(res, 200, embed ? renderFragment(spec.title, body) : renderPage(spec.title, body))
    } catch (err) {
      const why = String(err && err.message ? err.message : err).replace(/[<>&]/g, '')
      ctx.logger?.warn?.('work-personal-secretary: 随包网页渲染失败：' + why)
      return notFound(500, '页面渲染失败：' + why)
    }
  }
  for (const p of PAGE_PATHS) {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: PAGE_ROOT + p, handler: pageHandler }))
    } catch (err) {
      ctx.logger?.warn?.('work-personal-secretary: 随包网页路由注册失败 ' + p + '：' + (err && err.message ? err.message : err))
    }
  }

  // ── 1.1.3 新增 JSON 路由的精确注册（桌面载体 fetch 桥只认精确路由） ──
  // 与上面 7 条 API 精确路由共用同一个 handler（它就是 prefix handler，按 sub 分发）。
  for (const p of CORE_API_EXACT_PATHS) {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: API_ROOT + p, handler: handler }))
    } catch (err) {
      ctx.logger?.warn?.('work-personal-secretary: 新增 JSON 路由精确注册失败 ' + p + '：' + (err && err.message ? err.message : err))
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
 * ✅ **已接线**：由 lib/index.js 的 apply 调用（1.1.3 起接线，方案 A：桌面外壳也要能调）。
 *   此前默认不接线，是因为既有测试把路由集合锁死了两条口径
 *   （`installApi` 的 exact 集合 === API_PATHS；`apply()` 的路由总数 === API_PATHS.length + 1）。
 *   本次连同四条断言一起改掉（probe-test / settings-api-test / basedeck-test / install-test），
 *   断言仍**逐条列出完整路径集合并用相等比较**，不放宽为 includes / >=。
 *
 * 当前**精确路由集合（共 24 条）**与路由总数（2026-09-17 复核）：
 *   API_PATHS（7）             /check /fix /fix-all /plugins /install /install-all /basedeck
 *   PAGE_PATHS（2，另一前缀）  /work-personal-secretary/guide、/help
 *   CORE_API_EXACT_PATHS（12）/preflight /identity /identity/save /domain/list /domain/generate
 *                              /docs /open-doc /setup-state /dirs /dirs/new /import/scan /import/apply（以上以本文件 CORE_API_EXACT_PATHS 常量为准）
 *   SETTINGS_API_PATHS（3）    /settings /settings/write /experts/preview（**本函数**注册）
 *   → 24 exact + 1 prefix = `apply()` 注册**总数 25 条**（数字以三个常量与各自测试断言为准）。
 *   本函数另由 scripts/settings-api-test.mjs 的 [11] 段单测覆盖。
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
