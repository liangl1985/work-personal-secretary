/**
 * work-personal-secretary —— 只读环境探针（安装器第一步：环境检查）
 *
 * 七项探针，顺序固定：host / node / python / pythonDeps / wps / obsidian / subPlugins。
 * 每项返回统一形状（见 makeItem）：{ id, label, status, value, detail, fixKind, fixCommand, autoFixable }。
 *
 * 红线（本文件）：
 * 1. **只读**：只执行查询类命令（--version / list / reg query / COM 实例化后立即退出），
 *    绝不安装、不修改任何东西；唯一会写系统的路径在 api.js 的 /fix 与 /fix-all（服务端白名单）。
 * 2. 命令一律 execFile + **固定参数数组**，不拼 shell 字符串；单项 10s 超时（WPS / Obsidian / winget 20s）。
 * 3. 单项失败 / 超时不让整份报告失败：统一转成对应状态的 item，并在 detail 说明原因。
 * 4. 发布件中立：不写死任何使用者信息、本机绝对路径、版本号。
 *
 * @module work-personal-secretary/probe
 */

import { execFile } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  fstatSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** 七项探针的稳定 id，顺序即展示顺序（接口契约定死） */
export const PROBE_ORDER = ['host', 'node', 'python', 'pythonDeps', 'wps', 'obsidian', 'subPlugins']

/** 中文短名 */
export const PROBE_LABELS = {
  host: 'DSH 宿主',
  node: 'Node 运行时',
  python: 'Python 解释器',
  pythonDeps: 'Python 依赖库',
  wps: 'WPS Office',
  obsidian: 'Obsidian',
  subPlugins: '子插件',
}

/** 合法枚举 */
export const STATUSES = ['ok', 'warn', 'missing', 'skip']
export const FIX_KINDS = ['none', 'pip', 'winget', 'manual']

/** 引擎要求（与 package.json engines 一致，不写死具体版本号） */
export const NODE_ENGINE_RANGE = '^22.19.0 || >=24.0.0'
/** Python 最低版本（由 PyMuPDF / Pillow 的 requires_python 决定） */
export const MIN_PYTHON = '3.10'
export const RECOMMENDED_PYTHON = '3.12'

/** 八个必需 pip 包（顺序即 pip install 的参数顺序，固定不变） */
export const REQUIRED_PIP_PACKAGES = [
  'python-docx',
  'openpyxl',
  'python-pptx',
  'PyMuPDF',
  'pdfplumber',
  'pypdf',
  'Pillow',
  'pywin32',
]

/** 五个子插件（与 lib/index.js 的 SUB_PLUGINS 同名，测试脚本会校验二者一致） */
export const SUB_PLUGIN_NAMES = [
  'dsh-work-memory',
  'dsh-doc-suite',
  'dsh-experts',
  'dsh-mermaid',
  'workspace-tokenpet',
]

/** WPS COM ProgID（只实例化 + 退出，**不打开任何文档**） */
export const WPS_PROGID = 'KWPS.Application'

/** WPS 许可提示（契约要求：wps 项的 detail 必须包含） */
export const WPS_LICENSE_NOTE = 'WPS Office 为第三方商业软件，安装即表示接受其许可协议'

/** winget 安装包 id（四项可代执行里的三个 winget 包） */
export const WINGET_PACKAGE_IDS = {
  python: 'Python.Python.' + RECOMMENDED_PYTHON,
  wps: 'Kingsoft.WPSOffice.CN',
  obsidian: 'Obsidian.Obsidian',
}

/** winget 静默安装固定开关（不接受任何外部参数） */
export const WINGET_FLAGS = ['--accept-source-agreements', '--accept-package-agreements', '--silent']

/**
 * 自动补齐白名单（服务端唯一定义处）。
 * key = 探针 id；argv = **固定命令 + 固定参数数组**，任何时候都不接受客户端传入的命令或参数。
 * requiresWinget / requiresPython 是执行前置条件；manual 是前置不满足时的兜底提示。
 */
export const FIX_WHITELIST = {
  python: {
    requiresWinget: true,
    requiresPython: false,
    manual: 'https://www.python.org/downloads/windows/',
  },
  pythonDeps: {
    requiresWinget: false,
    requiresPython: true,
    manual: 'pip install ' + REQUIRED_PIP_PACKAGES.join(' ') + '（Python 就绪后执行）',
  },
  wps: {
    requiresWinget: true,
    requiresPython: false,
    manual: 'https://www.wps.cn/',
  },
  obsidian: {
    requiresWinget: true,
    requiresPython: false,
    manual: 'https://obsidian.md/',
  },
}

/** 服务端固定执行顺序（/fix-all 忽略传入顺序，按此串行） */
export const FIX_EXECUTION_ORDER = ['python', 'pythonDeps', 'wps', 'obsidian']

/** 可代执行的 id 集合（其余一律走手动） */
export const AUTO_FIXABLE_IDS = Object.keys(FIX_WHITELIST)

/** winget 安装命令（argv 数组，固定） */
export function wingetInstallArgv(id) {
  return ['winget', 'install', '-e', '--id', WINGET_PACKAGE_IDS[id]].concat(WINGET_FLAGS)
}

/** winget 安装命令（回显字符串） */
export function wingetInstallCommand(id) {
  return wingetInstallArgv(id).join(' ')
}

// ─────────────── Python 解释器解析（固定候选，只读） ───────────────

/**
 * 解析可用的 Python 解释器（**固定候选，不接受任何外部输入**）：
 *   ① py -3（由调用方先探测）② %LOCALAPPDATA%\Programs\Python\Python3xx\python.exe（版本从高到低）
 *   ③ %ProgramFiles%\Python3xx\python.exe
 * @returns {Array<{cmd:string, masked:string, source:string}>}
 */
export function findPythonCandidates(platform = process.platform, env = process.env) {
  const source = env || {}
  const out = []
  if (platform === 'win32') {
    const local = String(source.LOCALAPPDATA || '').trim()
    const pf = String(source.ProgramFiles || '').trim()
    const roots = []
    if (local) roots.push({ dir: join(local, 'Programs', 'Python'), masked: '%LOCALAPPDATA%\\Programs\\Python' })
    if (pf) roots.push({ dir: pf, masked: '%ProgramFiles%' })
    for (const root of roots) {
      const dirs = readdirSafe(root.dir)
        .filter((n) => /^Python3\d+$/.test(n))
        .sort((a, b) => Number(b.slice(6)) - Number(a.slice(6)))
      for (const d of dirs) {
        const cmd = join(root.dir, d, 'python.exe')
        try {
          if (existsSync(cmd)) out.push({ cmd: cmd, masked: root.masked + '\\' + d + '\\python.exe', source: 'install-dir' })
        } catch (e) { /* best-effort */ }
      }
    }
  } else {
    for (const cmd of ['/usr/bin/python3', '/usr/local/bin/python3']) {
      try {
        if (existsSync(cmd)) out.push({ cmd: cmd, masked: cmd, source: 'install-dir' })
      } catch (e) { /* best-effort */ }
    }
  }
  return out
}

/** 归一化解释器描述（数组 / {cmd,args} 都接受） */
export function normalizePythonExec(value, platform = process.platform) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.cmd) {
    const args = Array.isArray(value.args) ? value.args.slice() : []
    const command = String(value.command || [String(value.cmd)].concat(args).join(' '))
    return {
      cmd: String(value.cmd),
      args: args,
      command: command,
      masked: String(value.masked || maskUserPath(command)),
      source: String(value.source || 'resolved'),
    }
  }
  const launcher = Array.isArray(value) ? value : pythonLauncher(platform)
  return {
    cmd: launcher[0],
    args: launcher.slice(1),
    command: launcher.join(' '),
    masked: launcher.join(' '),
    source: 'launcher',
  }
}

/**
 * pip 补齐命令（**固定参数**：八个必需包），解释器前缀来自 normalizePythonExec。
 * 参数永远只来自 REQUIRED_PIP_PACKAGES 常量，不接受任何外部输入。
 */
export function pipInstallArgv(platform = process.platform, pythonExec = null) {
  const exec = normalizePythonExec(pythonExec, platform)
  const args = exec.args.concat(['-m', 'pip', 'install']).concat(REQUIRED_PIP_PACKAGES)
  return {
    cmd: exec.cmd,
    args: args,
    command: [exec.cmd].concat(args).join(' '),
    masked: exec.masked,
  }
}

/**
 * 解析要用于 pip 的解释器：先看探测结果（py -3），再退回固定安装目录候选。
 * 全部找不到返回 null（调用方据此报「请先补齐 Python 解释器」）。
 */
export async function resolvePythonExecutable(options = {}) {
  const platform = options.platform || process.platform
  const launcher = options.launcher || pythonLauncher(platform)
  const py = options.pythonItem || await probePython(Object.assign({}, options, { platform: platform, launcher: launcher }))
  if (py && py.status === 'ok' && (!options.pythonItem || /--version/.test(String(py.detail || '')))) {
    const res = await runCommand(launcher[0], launcher.slice(1).concat(['--version']), {
      timeoutMs: 10000, maxBytes: 500, env: pyEnv(),
    })
    const v = parseVersion(String(res.stdout || '') + ' ' + String(res.stderr || ''))
    if (res.code === 0 && v) return normalizePythonExec(launcher, platform)
  }
  for (const c of findPythonCandidates(platform, options.env || process.env)) {
    const res = await runCommand(c.cmd, ['--version'], { timeoutMs: 10000, maxBytes: 500, env: pyEnv() })
    const v = parseVersion(String(res.stdout || '') + ' ' + String(res.stderr || ''))
    if (res.code === 0 && v) {
      return normalizePythonExec({ cmd: c.cmd, args: [], command: c.cmd, masked: c.masked, source: c.source }, platform)
    }
  }
  return null
}

/** 手动兜底提示（winget 缺失 / 平台不支持时） */
export const PYTHON_MANUAL_URL = 'https://www.python.org/downloads/windows/'
export const WPS_MANUAL_URL = 'https://www.wps.cn/'
export const OBSIDIAN_MANUAL_URL = 'https://obsidian.md/'
export const NODE_UPGRADE_HINT = '升级 DSH Desktop 至最新版（Node 运行时随宿主提供，需满足 ' + NODE_ENGINE_RANGE + '）'
export const NO_WINGET_NOTE = '本机未检测到 winget'
export const PYTHON_MISSING_HINT = '未找到可用的 Python 解释器（固定候选：py -3、%LOCALAPPDATA%\\Programs\\Python\\Python3xx、%ProgramFiles%\\Python3xx）；请先补齐 Python 解释器'

/** asar 头部读取上限（只读头部区域，绝不整包读入 / 不解包 / 不写盘） */
const ASAR_HEADER_MAX = 64 * 1024 * 1024
/** 日志文件只读尾部这么多字节 */
const LOG_TAIL_BYTES = 64 * 1024

/** 探针单次默认超时（毫秒） */
const DEFAULT_ITEM_TIMEOUT = 10000
const WINGET_TIMEOUT = 20000
const WPS_TIMEOUT = 20000
const OBSIDIAN_TIMEOUT = 20000
const TOTAL_TIMEOUT = 60000

// ───────────────────────────── 基础工具 ─────────────────────────────

/** 本地时间 ISO（带时区偏移，如 2026-09-13T17:05:00+08:00） */
export function localIso(date = new Date()) {
  const pad = (n, w) => String(n).padStart(w || 2, '0')
  const off = -date.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
}

/** 本地日期 YYYY-MM-DD（日志文件名用） */
export function todayStampLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** 输出截断（默认 8000 字符，与 /fix 契约一致） */
export function truncate(text, max = 8000) {
  const s = String(text == null ? '' : text)
  if (s.length <= max) return s
  return s.slice(0, max) + '\n…（输出已截断，原始 ' + s.length + ' 字符）'
}

function firstLine(text) {
  const s = String(text == null ? '' : text).trim()
  const i = s.indexOf('\n')
  return (i === -1 ? s : s.slice(0, i)).trim()
}

function joinDetail() {
  const parts = []
  for (let i = 0; i < arguments.length; i++) {
    const p = String(arguments[i] == null ? '' : arguments[i]).trim()
    if (p) parts.push(p)
  }
  return parts.join('；')
}

/**
 * 把使用者目录脱敏成环境变量占位形式（detail 回显用）。
 * 例：%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe → %LOCALAPPDATA%\Programs\Python\Python312\python.exe
 */
export function maskUserPath(p, env = process.env) {
  let s = String(p == null ? '' : p)
  const pairs = [
    [env && env.LOCALAPPDATA, '%LOCALAPPDATA%'],
    [env && env.APPDATA, '%APPDATA%'],
    [env && env['ProgramFiles(x86)'], '%ProgramFiles(x86)%'],
    [env && env.ProgramFiles, '%ProgramFiles%'],
    [env && env.USERPROFILE, '%USERPROFILE%'],
    [homedir(), '%USERPROFILE%'],
  ]
  for (const pair of pairs) {
    const from = pair[0] ? String(pair[0]) : ''
    if (!from) continue
    if (s.toLowerCase().indexOf(from.toLowerCase()) === 0) s = pair[1] + s.slice(from.length)
  }
  s = s.replace(/[A-Za-z]:\\Users\\[^\\/]+/gi, '%USERPROFILE%')
  return s
}

/** 构造统一 item（status / fixKind 只允许契约枚举） */
export function makeItem(id, status, value, detail, fixKind, fixCommand, autoFixable) {
  return {
    id: id,
    label: PROBE_LABELS[id] || id,
    status: STATUSES.indexOf(status) >= 0 ? status : 'warn',
    value: String(value == null ? '' : value),
    detail: String(detail == null ? '' : detail),
    fixKind: FIX_KINDS.indexOf(fixKind) >= 0 ? fixKind : 'none',
    fixCommand: String(fixCommand == null ? '' : fixCommand),
    autoFixable: Boolean(autoFixable),
  }
}

/** summary 计数（与 items 实际状态一致） */
export function summarize(items) {
  const out = { ok: 0, warn: 0, missing: 0, skip: 0 }
  for (const it of items || []) {
    if (it && Object.prototype.hasOwnProperty.call(out, it.status)) out[it.status] += 1
  }
  return out
}

/** Python 启动器：Windows 一律 py -3（python 可能是 Microsoft Store 别名 stub） */
export function pythonLauncher(platform = process.platform) {
  return platform === 'win32' ? ['py', '-3'] : ['python3']
}

/** 版本号解析为 [major, minor, patch] */
export function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text == null ? '' : text))
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)]
}

function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

function caretUpper(p) {
  if (p[0] > 0) return [p[0] + 1, 0, 0]
  if (p[1] > 0) return [0, p[1] + 1, 0]
  return [0, 0, p[2] + 1]
}

/**
 * 极简 semver range 判断（只支持本集成体用到的子集：^ / >= / > / <= / < / 精确，空格=与，||=或）。
 * 不引第三方依赖，避免给宿主增加负担。
 */
export function satisfiesRange(version, range) {
  const v = parseVersion(version)
  if (!v) return false
  const groups = String(range || '').split('||').map((s) => s.trim()).filter(Boolean)
  for (const group of groups) {
    const parts = group.split(/\s+/).filter(Boolean)
    let all = parts.length > 0
    for (const part of parts) {
      let hit = false
      if (part.charAt(0) === '^') {
        const p = parseVersion(part.slice(1))
        hit = p ? (cmpVersion(v, p) >= 0 && cmpVersion(v, caretUpper(p)) < 0) : true
      } else if (part.indexOf('>=') === 0) {
        const p = parseVersion(part.slice(2))
        hit = p ? cmpVersion(v, p) >= 0 : true
      } else if (part.indexOf('<=') === 0) {
        const p = parseVersion(part.slice(2))
        hit = p ? cmpVersion(v, p) <= 0 : true
      } else if (part.charAt(0) === '>') {
        const p = parseVersion(part.slice(1))
        hit = p ? cmpVersion(v, p) > 0 : true
      } else if (part.charAt(0) === '<') {
        const p = parseVersion(part.slice(1))
        hit = p ? cmpVersion(v, p) < 0 : true
      } else {
        const p = parseVersion(part)
        hit = p ? cmpVersion(v, p) === 0 : true
      }
      if (!hit) { all = false; break }
    }
    if (all) return true
  }
  return false
}

/**
 * 执行外部命令。**固定命令 + 固定参数数组**，永不拼接 shell 字符串。
 * 任何失败（不存在 / 超时 / 非零退出）都 resolve 成结果对象，不 reject。
 * @returns {Promise<{ok:boolean, code:(number|null), stdout:string, stderr:string, error:string, timedOut:boolean, durationMs:number, command:string}>}
 */
export function runCommand(cmd, args, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_ITEM_TIMEOUT
  const maxBytes = options.maxBytes || 4000
  const started = Date.now()
  const argv = Array.isArray(args) ? args : []
  return new Promise((resolve) => {
    let done = false
    const finish = (payload) => {
      if (done) return
      done = true
      resolve(payload)
    }
    try {
      execFile(cmd, argv, {
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        env: options.env || process.env,
      }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
        finish({
          ok: !err,
          code: code,
          stdout: truncate(stdout || '', maxBytes),
          stderr: truncate(stderr || '', maxBytes),
          error: err ? String(err.message || err) : '',
          timedOut: Boolean(err && (err.killed || err.signal)),
          durationMs: Date.now() - started,
          command: cmd + ' ' + argv.join(' '),
        })
      })
    } catch (err) {
      finish({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        error: String(err && err.message ? err.message : err),
        timedOut: false,
        durationMs: Date.now() - started,
        command: cmd + ' ' + argv.join(' '),
      })
    }
  })
}

/** Python 子进程统一用 UTF-8 输出，避免中文错误信息变成乱码 */
function pyEnv() {
  return Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
}

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return null
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch (e) {
    return []
  }
}

/** winget 探测结果（只在需要生成修复建议时查询） */
export async function probeWinget(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'win32') return { ok: false, value: '', detail: '非 Windows 平台无 winget' }
  const res = await runCommand('winget', ['--version'], {
    timeoutMs: options.timeoutMs || WINGET_TIMEOUT,
    maxBytes: 500,
  })
  const out = (String(res.stdout || '') + ' ' + String(res.stderr || '')).trim()
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(out)
  if (res.code === 0 && m) return { ok: true, value: m[1], detail: '' }
  return { ok: false, value: '', detail: NO_WINGET_NOTE + '（' + String(firstLine(out) || res.error || '无输出').slice(0, 60) + '）' }
}

/**
 * 先按「winget 可用性未知」算一次；只有需要给修复建议时才真去查 winget 再算第二次。
 * compute(winget) 必须是纯函数。
 */
async function withWingetDecision(options, compute) {
  const known = options.winget || null
  const first = compute(known)
  if (known || first.status === 'ok') return first
  const winget = await probeWinget(options)
  return compute(winget)
}

// ───────────────────────────── 1. host ─────────────────────────────

const HOST_VERSION_KEYS = [
  'DSH_APP_VERSION',
  'DSH_DESKTOP_VERSION',
  'DSH_PRODUCT_VERSION',
  'DSH_HOST_VERSION',
  'DSH_RUNTIME_VERSION',
  'DSH_VERSION',
  'DSH_BUILD_VERSION',
]

// ───────────── app.asar 头部读取（只读 header，不解包、不写盘） ─────────────

/**
 * 读 asar 头部目录表：pickle 头 + JSON 目录表。
 * 只读文件头部若干 MB（header JSON 通常几 MB；安装包可能有 100MB+，绝不整包读入）。
 * @returns {{header:object, base:number, path:string}|null}
 */
/**
 * 在「禁用 Electron asar 补丁」的窗口内执行 fs 操作。
 * 桌面载体把 app.asar 当作目录（statSync 给出 isDirectory、openSync 直接 ENOENT），
 * 必须临时置 process.noAsar 才能按真实文件读取；普通 Node 下该属性无副作用。
 */
function withNoAsar(fn) {
  const proc = process
  const had = Object.prototype.hasOwnProperty.call(proc, 'noAsar')
  const prev = proc.noAsar
  try { proc.noAsar = true } catch (e) { /* best-effort */ }
  try {
    return fn()
  } finally {
    try {
      // 原样恢复：本来没有该属性就删掉，避免往宿主 process 上留下痕迹
      if (had) proc.noAsar = prev
      else delete proc.noAsar
    } catch (e) { /* best-effort */ }
  }
}

/** 循环读满（同步读可能短读；Electron 下 asar 的 stat 也不一定可信） */
function readFully(fd, length, position) {
  const buf = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    let n = 0
    try {
      n = readSync(fd, buf, done, length - done, position + done)
    } catch (e) {
      return null
    }
    if (!(n > 0)) break
    done += n
  }
  return done === length ? buf : null
}

function readAsarHeaderInner(asarPath) {
  if (!asarPath) return null
  let fd = null
  try {
    fd = openSync(asarPath, 'r')
  } catch (e) {
    return null
  }
  try {
    // 不依赖 statSync().size：桌面载体（Electron）可能把 app.asar 视作目录而给出 0 大小
    let fileSize = null
    try {
      const st = fstatSync(fd)
      if (st && st.size > 0) fileSize = st.size
    } catch (e) { /* size 未知也能继续 */ }
    const probeLen = 64
    const head = Buffer.alloc(probeLen)
    const got = (() => {
      try { return readSync(fd, head, 0, probeLen, 0) } catch (e) { return 0 }
    })()
    if (!(got >= 12)) return null
    const brace = head.indexOf(0x7B) // '{'
    const candidates = []
    if (brace >= 4) {
      for (const back of [4, 8, 12]) {
        if (brace - back >= 0 && brace - back + 4 <= probeLen) {
          candidates.push({ offset: brace, length: head.readUInt32LE(brace - back) })
        }
      }
    }
    if (got >= 8) candidates.push({ offset: 8, length: head.readUInt32LE(4) })
    if (got >= 12) candidates.push({ offset: 12, length: head.readUInt32LE(8) })
    const seen = {}
    for (const c of candidates) {
      const key = c.offset + ':' + c.length
      if (seen[key]) continue
      seen[key] = true
      if (!(c.length > 2 && c.length <= ASAR_HEADER_MAX)) continue
      if (fileSize !== null && c.offset + c.length > fileSize) continue
      const buf = readFully(fd, c.length, c.offset)
      if (!buf) continue
      let json = null
      try {
        json = JSON.parse(buf.toString('utf8'))
      } catch (e) {
        continue
      }
      if (json && json.files && typeof json.files === 'object') {
        return { header: json, base: c.offset + c.length, path: asarPath }
      }
    }
    return null
  } catch (e) {
    return null
  } finally {
    try { closeSync(fd) } catch (e) { /* best-effort */ }
  }
}

/** 读 asar 头部目录表（桌面载体下自动临时禁用 asar 补丁） */
export function readAsarHeader(asarPath) {
  return withNoAsar(() => readAsarHeaderInner(asarPath))
}

/** 从 asar 目录表里取一个小文件（如 package.json）的内容 */
function readAsarEntryFileInner(asar, entryPath) {
  if (!asar || !asar.header) return null
  try {
    // 从 header 根开始（header.files 即顶层目录表）
    let cur = asar.header
    const parts = String(entryPath).split('/')
    for (const p of parts) {
      if (!cur || !cur.files) return null
      cur = cur.files[p]
    }
    if (!cur || cur.offset == null || cur.size == null) return null
    const size = Number(cur.size)
    if (!(size > 0 && size <= 4 * 1024 * 1024)) return null
    const fd = openSync(asar.path, 'r')
    try {
      const buf = readFully(fd, size, asar.base + Number(cur.offset))
      return buf ? buf.toString('utf8') : null
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    return null
  }
}

/** 读 asar 内的一个小文件（桌面载体下自动临时禁用 asar 补丁） */
export function readAsarEntryFile(asar, entryPath) {
  return withNoAsar(() => readAsarEntryFileInner(asar, entryPath))
}

/** 推断 app.asar 路径（进程安装目录 / resourcesPath） */
export function inferAsarPath(options = {}) {
  const res = options.resourcesPath || process.resourcesPath
  const exe = options.execPath || process.execPath
  const cands = []
  if (res) cands.push(join(String(res), 'app.asar'))
  if (exe) {
    const dir = dirname(String(exe))
    cands.push(join(dir, 'resources', 'app.asar'))
    cands.push(join(dir, 'app.asar'))
  }
  for (const c of cands) {
    try {
      if (existsSync(c)) return c
    } catch (e) { /* best-effort */ }
  }
  return null
}

// ───────────── 宿主版本多来源探测 ─────────────

/** 从 DSH_* 托管环境变量收集版本（最高优先来源） */
export function collectEnvHostVersions(env = process.env) {
  const source = env || {}
  const keys = Object.keys(source).filter((k) => k.indexOf('DSH_') === 0)
  const versionKeys = keys.filter((k) => /VERSION|_VER$|BUILD/.test(k.toUpperCase()))
  versionKeys.sort((a, b) => {
    const ia = HOST_VERSION_KEYS.indexOf(a)
    const ib = HOST_VERSION_KEYS.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  return versionKeys
    .map((k) => ({ key: k, value: String(source[k] == null ? '' : source[k]).trim() }))
    .filter((r) => r.value)
}

/** 桌面应用数据目录（Windows：%APPDATA%\DSH Desktop） */
export function appDataDir(env = process.env, platform = process.platform) {
  const source = env || {}
  if (platform === 'win32') {
    const appdata = String(source.APPDATA || '').trim()
    if (appdata) return join(appdata, 'DSH Desktop')
    return join(homedir(), 'AppData', 'Roaming', 'DSH Desktop')
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'DSH Desktop')
  return join(homedir(), '.config', 'DSH Desktop')
}

/** 递归找版本字段（Preferences 之类结构不定的 JSON） */
export function pickVersionField(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return null
  const keys = Object.keys(obj)
  for (const k of keys) {
    if (/^(version|appVersion|desktopVersion|dshVersion|productVersion|buildVersion)$/i.test(k)) {
      const v = obj[k]
      if (typeof v === 'string' && /^\d+\.\d+/.test(v.trim())) return v.trim()
      if (v && typeof v === 'object') {
        const inner = pickVersionField(v, depth + 1)
        if (inner) return inner
      }
    }
  }
  for (const k of keys) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      const inner = pickVersionField(v, depth + 1)
      if (inner) return inner
    }
  }
  return null
}

/** 选宿主日志：优先今天，其次最新的 dsh-*.log（排除 .error.log） */
export function pickHostLogFile(logDir, now = new Date()) {
  const today = join(logDir, 'dsh-' + todayStampLocal(now) + '.log')
  try {
    if (existsSync(today)) return today
  } catch (e) { /* best-effort */ }
  let best = null
  let bestMs = -1
  for (const name of readdirSafe(logDir)) {
    if (!/^dsh-.*\.log$/.test(name) || /\.error\.log$/.test(name)) continue
    const p = join(logDir, name)
    try {
      const ms = statSync(p).mtimeMs
      if (ms > bestMs) { bestMs = ms; best = p }
    } catch (e) { /* best-effort */ }
  }
  return best
}

/** 从日志尾部找启动行的宿主版本（--- dsh-plugin-desktop DSH Desktop 2.0.9 win32 node v24 ... ---） */
export function readHostVersionFromLog(logFile) {
  if (!logFile) return null
  try {
    const size = statSync(logFile).size
    const start = Math.max(0, size - LOG_TAIL_BYTES)
    const len = size - start
    if (!(len > 0)) return null
    const fd = openSync(logFile, 'r')
    let text = ''
    try {
      const buf = Buffer.alloc(len)
      const read = readSync(fd, buf, 0, len, start)
      text = buf.slice(0, read).toString('utf8')
    } finally {
      closeSync(fd)
    }
    const hits = []
    const re = /DSH Desktop\s+(\d+\.\d+\.\d+)/g
    let m = re.exec(text)
    while (m) {
      hits.push({ version: m[1], index: m.index })
      m = re.exec(text)
    }
    if (hits.length === 0) return null
    hits.sort((a, b) => a.index - b.index)
    return hits[hits.length - 1].version // 最后一条启动行
  } catch (e) {
    return null
  }
}

/**
 * DSH Desktop 版本（只读多来源，按优先级）：
 * ① resources/app.asar 顶层 package.json ② %APPDATA%\DSH Desktop\Preferences
 * ③ %APPDATA%\DSH Desktop\logs\dsh-<今天>.log 的最后一条启动行
 */
export function detectDesktopVersion(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const asar = Object.prototype.hasOwnProperty.call(options, 'asar')
    ? options.asar
    : readAsarHeader(options.asarPath || inferAsarPath(options))
  if (asar) {
    const txt = readAsarEntryFile(asar, 'package.json')
    if (txt) {
      try {
        const pkg = JSON.parse(txt)
        const v = String((pkg && pkg.version) || '').trim()
        if (v) return { version: v, source: 'app.asar' }
      } catch (e) { /* fallthrough */ }
    }
  }
  const dir = options.appDataDir || appDataDir(env, platform)
  const pref = readJsonSafe(join(dir, 'Preferences'))
  const pv = pickVersionField(pref)
  if (pv) return { version: pv, source: 'Preferences' }
  const logFile = Object.prototype.hasOwnProperty.call(options, 'logFile')
    ? options.logFile
    : pickHostLogFile(join(dir, 'logs'), options.now || new Date())
  const lv = readHostVersionFromLog(logFile)
  if (lv) return { version: lv, source: 'logs' }
  return null
}

/** 读 profile 里某个运行时包版本（兼容 pnpm .pnpm 布局） */
export function readModuleVersion(profileDir, pkgName) {
  if (!profileDir) return null
  const direct = readJsonSafe(join(profileDir, 'node_modules', '@deepseek-ai', pkgName, 'package.json'))
  if (direct && direct.version) return String(direct.version).trim()
  const pnpmDir = join(profileDir, 'node_modules', '.pnpm')
  const prefix = '@deepseek-ai+' + pkgName + '@'
  const hits = readdirSafe(pnpmDir).filter((n) => n.indexOf(prefix) === 0).sort().reverse()
  for (const h of hits) {
    const pkg = readJsonSafe(join(pnpmDir, h, 'node_modules', '@deepseek-ai', pkgName, 'package.json'))
    if (pkg && pkg.version) return String(pkg.version).trim()
  }
  return null
}

/**
 * dsh 运行时版本（只读多来源，按优先级）：
 * ① profile node_modules\@deepseek-ai\{dsh-tools,cordis,dsh-base}
 * ② 宿主内置：app.asar 内 node_modules\@deepseek-ai\{同名包}
 */
export function detectRuntimeVersion(options = {}) {
  const env = options.env || process.env
  const pkgs = ['dsh-tools', 'cordis', 'dsh-base']
  const profileDir = Object.prototype.hasOwnProperty.call(options, 'profileDir')
    ? options.profileDir
    : resolveProfileDir(env)
  for (const name of pkgs) {
    const v = readModuleVersion(profileDir, name)
    if (v) return { version: v, source: 'profile @deepseek-ai/' + name }
  }
  const asar = Object.prototype.hasOwnProperty.call(options, 'asar')
    ? options.asar
    : readAsarHeader(options.asarPath || inferAsarPath(options))
  if (asar) {
    for (const name of pkgs) {
      const txt = readAsarEntryFile(asar, 'node_modules/@deepseek-ai/' + name + '/package.json')
      if (!txt) continue
      try {
        const v = String(JSON.parse(txt).version || '').trim()
        if (v) return { version: v, source: 'app.asar @deepseek-ai/' + name }
      } catch (e) { /* best-effort */ }
    }
  }
  return null
}

/**
 * DSH 宿主版本：多来源只读探测。
 * 全部来源都不可用时报 warn（不再是 skip）——「已探测到宿主运行中，但版本来源不可用」。
 */
export function probeHost(options = {}) {
  const env = options.env || process.env
  const opts = Object.assign({}, options, { env: env })
  const asar = readAsarHeader(options.asarPath || inferAsarPath(opts))
  const withAsar = Object.assign({}, opts, { asar: asar })
  const runtime = detectRuntimeVersion(withAsar)
  const envVers = collectEnvHostVersions(env)

  if (envVers.length > 0) {
    const parts = envVers.map((v) => v.value)
    if (runtime) parts.push('dsh ' + runtime.version)
    const detail = ['来源环境变量：' + envVers.map((v) => v.key).join('、')]
    if (runtime) detail.push('dsh 运行时来源：' + runtime.source)
    return makeItem('host', 'ok', parts.join(' / '), detail.join('；'))
  }

  const desktop = detectDesktopVersion(withAsar)
  const parts = []
  const srcs = []
  if (desktop) {
    parts.push(desktop.version)
    srcs.push('宿主版本来源：' + desktop.source)
  }
  if (runtime) {
    parts.push('dsh ' + runtime.version)
    srcs.push('dsh 运行时来源：' + runtime.source)
  }
  if (parts.length === 0) {
    return makeItem('host', 'warn', '已探测到宿主运行中，但版本来源不可用',
      'DSH_* 环境变量、resources/app.asar、Preferences、logs 与 profile node_modules 均未能读出宿主版本')
  }
  return makeItem('host', 'ok', parts.join(' / '), srcs.join('；'))
}

// ───────────────────────────── 2. node ─────────────────────────────

/** Node 运行时：process.version 与引擎要求比对（Node 由宿主随包提供，本集成体不代执行） */
export function probeNode(version = process.version, range = NODE_ENGINE_RANGE) {
  const v = String(version == null ? '' : version).replace(/^v/, '').trim()
  if (!v) return makeItem('node', 'skip', '', '无法读取 Node 版本')
  if (satisfiesRange(v, range)) {
    return makeItem('node', 'ok', 'v' + v, '满足引擎要求 ' + range)
  }
  return makeItem('node', 'missing', 'v' + v, '不满足引擎要求 ' + range, 'manual', NODE_UPGRADE_HINT)
}

// ───────────────────────────── 3. python ─────────────────────────────

function pythonFix(detail, winget) {
  const w = winget || { ok: false }
  if (w.ok) {
    return makeItem('python', 'missing', '', detail, 'winget', wingetInstallCommand('python'), true)
  }
  return makeItem('python', 'missing', '', joinDetail(detail, NO_WINGET_NOTE), 'manual', PYTHON_MANUAL_URL, false)
}

/** 解释检测输出（纯函数，便于自测；不执行命令） */
export function interpretPython(res, launcher, winget) {
  const cmd = (launcher || pythonLauncher()).join(' ')
  const out = String(res && res.stdout ? res.stdout : '') + '\n' + String(res && res.stderr ? res.stderr : '')
  if (res && res.timedOut) {
    return pythonFix(cmd + ' --version 超时（10s）', winget)
  }
  if (res && res.error && /ENOENT/i.test(res.error) && !res.code) {
    return pythonFix('未找到 Python 启动器：' + cmd, winget)
  }
  if (/Microsoft Store|Python was not found|Python 未找到/i.test(out)) {
    return pythonFix('命中的是 Microsoft Store 别名 stub（不是真解释器）：' + firstLine(out).slice(0, 80), winget)
  }
  const ver = parseVersion(out)
  if (!ver) {
    const why = firstLine(out) || (res && res.error) || '（无输出）'
    return pythonFix(cmd + ' --version 输出无法解析：' + String(why).slice(0, 80), winget)
  }
  const verText = ver.join('.')
  const min = parseVersion(MIN_PYTHON)
  if (cmpVersion(ver, min) < 0) {
    return pythonFix('版本低于 ' + MIN_PYTHON + '（由 PyMuPDF / Pillow 的 requires_python 决定），来源：' + cmd, winget)
  }
  return makeItem('python', 'ok', verText, '来源：' + cmd + ' --version（建议 ' + RECOMMENDED_PYTHON + '）')
}

/**
 * Python 解释器探针（Windows：py -3 --version）。
 * py -3 不可用时**回退到固定安装目录候选**（winget 装完未刷新 PATH 的常见情形）：
 * 命中则以安装目录解释器为准，detail 里的路径已脱敏。
 */
export async function probePython(options = {}) {
  const platform = options.platform || process.platform
  const launcher = options.launcher || pythonLauncher(platform)
  const res = await runCommand(launcher[0], launcher.slice(1).concat(['--version']), {
    timeoutMs: options.timeoutMs || DEFAULT_ITEM_TIMEOUT,
    maxBytes: 2000,
    env: pyEnv(),
  })
  const primary = await withWingetDecision(options, (winget) => interpretPython(res, launcher, winget))
  if (primary.status === 'ok' || options.fallbackInstalls === false) return primary

  const min = parseVersion(MIN_PYTHON)
  for (const c of findPythonCandidates(platform, options.env || process.env)) {
    const r2 = await runCommand(c.cmd, ['--version'], { timeoutMs: 10000, maxBytes: 500, env: pyEnv() })
    const v = parseVersion(String(r2.stdout || '') + ' ' + String(r2.stderr || ''))
    if (!(r2.code === 0 && v)) continue
    if (cmpVersion(v, min) < 0) continue
    return makeItem('python', 'ok', v.join('.'),
      '来源：安装目录的解释器 ' + maskUserPath(c.cmd, options.env || process.env) + '（py -3 不可用，PATH 可能未刷新；建议重启 DSH）')
  }
  return primary
}

// ───────────────────────────── 4. pythonDeps ─────────────────────────────

/**
 * 解析 pip list --format=json 输出（纯函数，便于自测）。
 * fixCommand 用**实际解析到的解释器**回显（pythonExec 可为 {cmd,args} 或启动器数组）。
 */
export function interpretPipList(res, pythonExec, platform = process.platform) {
  const fixCmd = pipInstallArgv(platform, pythonExec).command
  const text = String(res && res.stdout ? res.stdout : '').trim()
  const errText = String(res && res.stderr ? res.stderr : '')
  if (res && res.timedOut) {
    return makeItem('pythonDeps', 'warn', '', 'pip list 超时（10s）', 'pip', fixCmd, true)
  }
  let list = null
  try {
    list = JSON.parse(text)
  } catch (e) {
    const s = text.indexOf('[')
    const t = text.lastIndexOf(']')
    if (s >= 0 && t > s) {
      try { list = JSON.parse(text.slice(s, t + 1)) } catch (e2) { list = null }
    }
  }
  if (!Array.isArray(list)) {
    const why = firstLine(text) || firstLine(errText) || (res && res.error) || '（无输出）'
    return makeItem('pythonDeps', 'warn', '', 'pip list 输出无法解析：' + String(why).slice(0, 80), 'pip', fixCmd, true)
  }
  const installed = new Set()
  for (const row of list) {
    if (row && row.name) installed.add(String(row.name).toLowerCase())
  }
  const missing = REQUIRED_PIP_PACKAGES.filter((n) => !installed.has(n.toLowerCase()))
  const ready = REQUIRED_PIP_PACKAGES.length - missing.length
  const value = ready + '/' + REQUIRED_PIP_PACKAGES.length + ' 就绪'
  if (missing.length === 0) {
    return makeItem('pythonDeps', 'ok', value, '八个必需包全部就绪')
  }
  return makeItem('pythonDeps', 'missing', value, '缺失：' + missing.join('、'), 'pip', fixCmd, true)
}

/**
 * Python 依赖库探针：**先解析可用解释器**（py -3 → 固定安装目录候选），
 * 再用该解释器执行 -m pip list --format=json；解析不到解释器则明确报「请先补齐 Python 解释器」。
 */
export async function probePythonDeps(pythonItem, options = {}) {
  const platform = options.platform || process.platform
  const launcher = options.launcher || pythonLauncher(platform)
  let py = pythonItem
  if (!py || py.id !== 'python') py = await probePython(options)
  if (py.status !== 'ok') {
    return makeItem('pythonDeps', 'skip', '', 'Python 不可用（' + (py.value || py.status) + '），跳过依赖检测', 'none', '', false)
  }
  const exec = options.pythonExec || await resolvePythonExecutable(Object.assign({}, options, {
    platform: platform, launcher: launcher, pythonItem: py,
  }))
  if (!exec) {
    return makeItem('pythonDeps', 'warn', '', PYTHON_MISSING_HINT, 'none', '', false)
  }
  const args = exec.args.concat(['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'])
  const res = await runCommand(exec.cmd, args, {
    timeoutMs: options.timeoutMs || DEFAULT_ITEM_TIMEOUT,
    maxBytes: 512 * 1024,
    env: pyEnv(),
  })
  return interpretPipList(res, exec, platform)
}

// ───────────────────────────── 5. wps ─────────────────────────────

/**
 * WPS COM 探测脚本：只做「实例化 + 退出」，**不打开任何文档**。
 * 用 base64 传给 py -3 -c —— 全程 ASCII，规避 Windows 命令行引号 / 换行 / 编码的坑。
 */
const WPS_PROBE_PY = [
  'import sys',
  'try:',
  '    import win32com.client as _wc',
  '    import pythoncom',
  'except Exception as _e:',
  '    print("PYWIN32_MISSING:" + str(_e)[:120])',
  '    sys.exit(2)',
  'try:',
  '    pythoncom.CoInitialize()',
  'except Exception:',
  '    pass',
  'try:',
  '    _app = _wc.Dispatch("KWPS.Application")',
  'except Exception as _e:',
  '    print("WPS_MISSING:" + str(_e)[:160])',
  '    sys.exit(3)',
  'try:',
  '    _app.Quit()',
  'except Exception:',
  '    pass',
  'print("WPS_OK")',
  'sys.exit(0)',
  '',
].join('\n')

/** base64 包装（导出便于自测确认不含外部输入） */
export function wpsProbeRunner() {
  const b64 = Buffer.from(WPS_PROBE_PY, 'utf8').toString('base64')
  return 'import base64;exec(base64.b64decode("' + b64 + '").decode("utf-8"))'
}

/**
 * 解析 WPS COM 探测输出（纯函数）：区分「pywin32 缺失」与「WPS 未安装」。
 * pythonExec 可为 {cmd,args} 或启动器数组；pywin32 的 pip 提示会带上实际解释器。
 */
export function interpretWps(res, pythonExec, winget) {
  const exec = normalizePythonExec(pythonExec)
  const w = winget || { ok: false }
  const out = String(res && res.stdout ? res.stdout : '') + '\n' + String(res && res.stderr ? res.stderr : '')
  if (res && res.timedOut) {
    return makeItem('wps', 'warn', '', joinDetail('WPS COM 探测超时（20s）', WPS_LICENSE_NOTE), 'manual', WPS_MANUAL_URL, false)
  }
  if (/WPS_OK/.test(out)) {
    return makeItem('wps', 'ok', WPS_PROGID + ' 可实例化', joinDetail('只做实例化与退出，未打开任何文档', WPS_LICENSE_NOTE))
  }
  if (/PYWIN32_MISSING/.test(out)) {
    return makeItem('wps', 'missing', '',
      joinDetail('pywin32 未安装，无法调用 WPS COM（可先补齐 pythonDeps，其固定命令包含 pywin32）', WPS_LICENSE_NOTE),
      'pip', exec.command + ' -m pip install pywin32', false)
  }
  if (/WPS_MISSING/.test(out)) {
    const m = /WPS_MISSING:([^\r\n]*)/.exec(out)
    const why = m && m[1] ? m[1].trim().slice(0, 90) : 'WPS 未安装或 COM 组件未注册'
    if (w.ok) {
      return makeItem('wps', 'missing', '',
        joinDetail('WPS COM 不可用：' + why, WPS_LICENSE_NOTE),
        'winget', wingetInstallCommand('wps'), true)
    }
    return makeItem('wps', 'missing', '',
      joinDetail('WPS COM 不可用：' + why, WPS_LICENSE_NOTE, NO_WINGET_NOTE),
      'manual', WPS_MANUAL_URL, false)
  }
  const why = firstLine(out) || (res && res.error) || '（无输出）'
  return makeItem('wps', 'warn', '',
    joinDetail('COM 探测结果不明：' + String(why).slice(0, 90), WPS_LICENSE_NOTE),
    'manual', WPS_MANUAL_URL, false)
}

/** WPS 探针（Windows only；非 Windows 报 skip）；用解析出的解释器执行 COM 探测 */
export async function probeWps(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'win32') {
    return makeItem('wps', 'skip', '', joinDetail('非 Windows 平台：WPS COM 探测不适用（比对 / 重算等能力仅在 Windows 可用）', WPS_LICENSE_NOTE))
  }
  const launcher = options.launcher || pythonLauncher(platform)
  const py = options.pythonItem || await probePython(options)
  if (py.status !== 'ok') {
    return makeItem('wps', 'skip', '', joinDetail('Python 不可用，无法探测 WPS COM（先解决 python 项）', WPS_LICENSE_NOTE))
  }
  const exec = options.pythonExec || await resolvePythonExecutable(Object.assign({}, options, {
    platform: platform, launcher: launcher, pythonItem: py,
  }))
  if (!exec) {
    return makeItem('wps', 'skip', '', joinDetail('未能解析可用的 Python 解释器，无法探测 WPS COM', WPS_LICENSE_NOTE))
  }
  const args = exec.args.concat(['-c', wpsProbeRunner()])
  const res = await runCommand(exec.cmd, args, {
    timeoutMs: options.timeoutMs || WPS_TIMEOUT,
    maxBytes: 4000,
    env: pyEnv(),
  })
  return withWingetDecision(options, (winget) => interpretWps(res, exec, winget))
}

// ───────────────────────────── 6. obsidian ─────────────────────────────

/** 常见安装路径（只读 existsSync；不执行安装类命令） */
export function obsidianPathCandidates(platform = process.platform, env = process.env) {
  const source = env || {}
  const out = []
  if (platform === 'win32') {
    const local = String(source.LOCALAPPDATA || '').trim()
    const pf = String(source.ProgramFiles || '').trim()
    const pf86 = String(source['ProgramFiles(x86)'] || '').trim()
    if (local) {
      out.push(join(local, 'Obsidian', 'Obsidian.exe'))
      out.push(join(local, 'Programs', 'Obsidian', 'Obsidian.exe'))
    }
    if (pf) out.push(join(pf, 'Obsidian', 'Obsidian.exe'))
    if (pf86) out.push(join(pf86, 'Obsidian', 'Obsidian.exe'))
  } else if (platform === 'darwin') {
    out.push('/Applications/Obsidian.app')
  } else {
    out.push('/usr/bin/obsidian')
    out.push('/usr/local/bin/obsidian')
    out.push('/opt/Obsidian/obsidian')
    out.push('/var/lib/flatpak/exports/bin/md.obsidian.Obsidian')
  }
  return out
}

/** 判定 Obsidian 检测结果（纯函数）：可选组件，检测不到只报 warn，不报 error */
export function interpretObsidian(hits, winget) {
  if (hits && hits.length > 0) {
    const viaRegistry = hits.some((h) => h && h.kind === 'registry')
    return makeItem('obsidian', 'ok', viaRegistry ? '已安装（协议已注册）' : '已安装',
      '可选组件：用于知识库镜像，缺失不影响核心能力')
  }
  const w = winget || { ok: false }
  if (w.ok) {
    return makeItem('obsidian', 'warn', '未检测到',
      '未检测到安装痕迹（可选组件：知识库镜像用，缺失不影响核心能力）',
      'winget', wingetInstallCommand('obsidian'), true)
  }
  return makeItem('obsidian', 'warn', '未检测到',
    joinDetail('未检测到安装痕迹（可选组件：知识库镜像用，缺失不影响核心能力）', NO_WINGET_NOTE),
    'manual', OBSIDIAN_MANUAL_URL, false)
}

/** Obsidian 探针：安装路径 + Windows 的 obsidian:// 协议注册（都只读） */
export async function probeObsidian(options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const hits = []
  for (const p of obsidianPathCandidates(platform, env)) {
    try {
      if (existsSync(p)) hits.push({ kind: 'path', where: p })
    } catch (e) { /* best-effort */ }
  }
  if (platform === 'win32' && options.skipRegistry !== true) {
    const res = await runCommand('reg', ['query', 'HKCU\\Software\\Classes\\obsidian', '/ve'], {
      timeoutMs: options.timeoutMs || OBSIDIAN_TIMEOUT,
      maxBytes: 2000,
    })
    if (res.code === 0 && /obsidian/i.test(res.stdout)) hits.push({ kind: 'registry', where: 'HKCU\\Software\\Classes\\obsidian' })
  }
  return withWingetDecision(options, (winget) => interpretObsidian(hits, winget))
}

// ───────────────────────────── 7. subPlugins ─────────────────────────────

/** 推断当前 profile 目录（从环境变量或默认 ~/.dsh/profiles/desktop） */
export function resolveProfileDir(env = process.env) {
  const source = env || {}
  const home = String(source.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  const candidates = []
  const explicit = String(source.DSH_PROFILE_DIR || '').trim()
  if (explicit) candidates.push(explicit)
  const profileName = String(source.DSH_PROFILE || '').trim()
  if (profileName) candidates.push(join(home, 'profiles', profileName))
  candidates.push(join(home, 'profiles', 'desktop'))
  for (const c of candidates) {
    try {
      if (existsSync(join(c, 'node_modules'))) return c
    } catch (e) { /* best-effort */ }
  }
  return null
}

/** 读单个子插件在 profile 里的已装版本（null = 未安装） */
export function readSubPluginVersion(profileDir, name) {
  const dir = join(profileDir, 'node_modules', name)
  try {
    if (!existsSync(dir)) return null
  } catch (e) {
    return null
  }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const v = String(pkg && pkg.version ? pkg.version : '').trim()
    return v || '已安装'
  } catch (e) {
    return '已安装'
  }
}

/** 子插件探针：读 profile 的 node_modules/<name>/package.json（子插件安装不代执行） */
export function probeSubPlugins(options = {}) {
  const env = options.env || process.env
  const profileDir = Object.prototype.hasOwnProperty.call(options, 'profileDir')
    ? options.profileDir
    : resolveProfileDir(env)
  if (!profileDir) {
    return makeItem('subPlugins', 'skip', '', '未找到 profile 的 node_modules（可用 DSH_PROFILE_DIR / DSH_PROFILE 指定，默认 ~/.dsh/profiles/desktop）')
  }
  const rows = SUB_PLUGIN_NAMES.map((name) => ({ name: name, version: readSubPluginVersion(profileDir, name) }))
  const missing = rows.filter((r) => r.version === null)
  const value = (rows.length - missing.length) + '/' + rows.length + ' 已装'
  const listing = rows.map((r) => r.name + (r.version === null ? '（未安装）' : '@' + r.version)).join('、')
  if (missing.length === 0) {
    return makeItem('subPlugins', 'ok', value, listing)
  }
  const fixCommand = 'dsh plugin --profile <profile> add ' + missing.map((r) => r.name).join(' ')
  if (missing.length === rows.length) {
    return makeItem('subPlugins', 'missing', value, '全部未安装：' + listing, 'manual', fixCommand)
  }
  // detail 始终列出五项各自的已装版本 / 未安装（面板要能一眼看全清单）
  return makeItem('subPlugins', 'warn', value,
    '缺失：' + missing.map((r) => r.name).join('、') + '；当前：' + listing, 'manual', fixCommand)
}

// ───────────────────────────── 汇总 ─────────────────────────────

/** 超时包装：到点返回兜底 item，不让单项拖死整份报告 */
function withTimeout(promise, ms, onTimeout) {
  let timer = null
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(onTimeout()), ms)
      if (timer && typeof timer.unref === 'function') timer.unref()
    }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

/**
 * 跑七项只读探针。
 * @param {object} [options]
 * @param {string[]} [options.skip] 跳过的 id（跳过项仍返回 item，status=skip；仅供测试使用）
 * @param {object} [options.env] 环境变量来源（默认 process.env）
 * @param {string} [options.platform] 平台覆盖（默认 process.platform）
 * @param {number} [options.totalTimeoutMs] 整份报告超时上限
 * @returns {Promise<{ok:boolean, checkedAt:string, items:object[], summary:object}>}
 */
export async function runProbes(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const launcher = options.launcher || pythonLauncher(platform)
  const skip = new Set(Array.isArray(options.skip) ? options.skip : [])
  const itemTimeout = options.itemTimeoutMs || DEFAULT_ITEM_TIMEOUT
  const deadline = Date.now() + (options.totalTimeoutMs || TOTAL_TIMEOUT)

  const budget = (max) => Math.max(0, Math.min(max, deadline - Date.now()))
  const skipped = (id, why) => makeItem(id, 'skip', '', why || '已跳过')

  const runOne = async (id, fn, maxMs) => {
    if (skip.has(id)) return skipped(id, '已跳过（调用方指定）')
    const b = budget(maxMs)
    if (b <= 0) return skipped(id, '整份探测超时上限已到，未执行该项')
    try {
      return await withTimeout(
        Promise.resolve().then(fn),
        b,
        () => makeItem(id, 'warn', '', '探测超时（' + Math.round(maxMs / 1000) + 's）'),
      )
    } catch (err) {
      const why = String(err && err.message ? err.message : err).slice(0, 120)
      return makeItem(id, 'warn', '', '探测失败：' + why)
    }
  }

  // winget 只读可用性检测：整份报告只查一次，结果传给需要它的三项（Python / WPS / Obsidian）
  let winget = options.winget || null
  if (!winget) {
    try {
      winget = await withTimeout(probeWinget({ platform: platform }), budget(WINGET_TIMEOUT),
        () => ({ ok: false, value: '', detail: 'winget 检测超时' }))
    } catch (e) {
      winget = { ok: false, value: '', detail: 'winget 检测失败' }
    }
  }

  const byId = {}
  byId.host = await runOne('host', () => probeHost({ env: env }), 5000)
  byId.node = await runOne('node', () => probeNode(options.nodeVersion), 2000)
  byId.python = await runOne('python', () => probePython({
    platform: platform, launcher: launcher, winget: winget, env: env,
  }), itemTimeout)
  // 解释器只解析一次，pythonDeps 与 wps 复用（避免重复探测）
  let pythonExec = null
  if (byId.python.status === 'ok') {
    try {
      pythonExec = await withTimeout(resolvePythonExecutable({
        platform: platform, launcher: launcher, env: env, pythonItem: byId.python,
      }), budget(itemTimeout), () => null)
    } catch (e) {
      pythonExec = null
    }
  }
  byId.pythonDeps = await runOne('pythonDeps', () => probePythonDeps(byId.python, {
    platform: platform, launcher: launcher, env: env, pythonExec: pythonExec,
  }), itemTimeout)
  byId.wps = await runOne('wps', () => probeWps({
    platform: platform, launcher: launcher, env: env, pythonItem: byId.python, pythonExec: pythonExec, winget: winget,
  }), WPS_TIMEOUT)
  byId.obsidian = await runOne('obsidian', () => probeObsidian({ platform: platform, env: env, winget: winget }), OBSIDIAN_TIMEOUT)
  byId.subPlugins = await runOne('subPlugins', () => probeSubPlugins({ env: env }), 5000)

  const items = PROBE_ORDER.map((id) => byId[id] || skipped(id, '未执行'))
  return {
    ok: true,
    checkedAt: localIso(options.now instanceof Date ? options.now : new Date()),
    items: items,
    summary: summarize(items),
  }
}
