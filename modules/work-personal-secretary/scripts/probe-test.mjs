/**
 * work-personal-secretary —— 环境探针 / 白名单自测（不依赖宿主运行时）
 *
 * 用法：node scripts/probe-test.mjs
 *
 * 覆盖：
 *   [1] 探针形状：七项 id、status / fixKind 枚举、字段齐全、fixCommand 非空规则
 *   [2] 真实只读执行：node / python / pythonDeps 三项在本机真跑（wps 跳过，避免拉起办公软件）
 *   [3] 纯函数判定：python / pip list / wps / obsidian / subPlugins / semver range
 *   [4] /fix 白名单：四项固定命令逐字断言、未知 id 被拒、参数不含任何外部输入
 *   [5] /fix-all：ids 校验、固定执行顺序、未知 id 计入 rejected（**mock 执行器，绝不真跑安装**）
 *   [6] 端到端路由：GET /check 契约、POST /fix、同源保护
 *   [7] summary 一致性 / 子插件清单一致 / 发布件中立性
 *
 * 红线：本测试**绝不执行任何安装命令**（pip install / winget install 一律走 mock 断言）。
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import {
  PROBE_ORDER,
  STATUSES,
  FIX_KINDS,
  REQUIRED_PIP_PACKAGES,
  WINGET_FLAGS,
  WINGET_PACKAGE_IDS,
  WPS_LICENSE_NOTE,
  NO_WINGET_NOTE,
  NODE_ENGINE_RANGE,
  runProbes,
  summarize,
  satisfiesRange,
  interpretPython,
  interpretPipList,
  interpretWps,
  interpretObsidian,
  probeSubPlugins,
  probeHost,
  readAsarHeader,
  todayStampLocal,
  maskUserPath,
  findPythonCandidates,
  normalizePythonExec,
  pipInstallArgv,
} from '../lib/probe.js'

import { API_ROOT, API_PATHS, resolveFixCommand, resolveFixAllPlan, installApi } from '../lib/api.js'

import { SUB_PLUGINS, readVersion, apply as applyHost, inject as hostInject } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

/** 造一个「命令类」res（runCommand 的形状） */
function cmdRes(over) {
  return Object.assign({ code: 0, stdout: '', stderr: '', error: '', timedOut: false, durationMs: 1, command: '' }, over || {})
}

/** mock cordis ctx：记录注册的路由 */
function makeMockCtx() {
  const routes = []
  return {
    routes: routes,
    logger: { debug() {}, warn() {}, info() {} },
    webServer: {
      register(opts) { routes.push(opts); return () => {} },
    },
  }
}
function prefixHandler(ctx) {
  const r = ctx.routes.filter((x) => x.kind === 'prefix')[0]
  return r ? r.handler : null
}

/** 极简 req / res 替身 */
function makeReq(over) {
  const o = over || {}
  const raw = o.body === undefined || o.body === null ? null : Buffer.from(JSON.stringify(o.body), 'utf8')
  return {
    method: o.method || 'GET',
    url: o.url || '/',
    headers: o.headers || {},
    async *[Symbol.asyncIterator]() { if (raw) yield raw },
  }
}
function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writeHead(s, h) { this.status = s; this.headers = h || null },
    end(t) { this.body = t || '' },
  }
}
function sameOriginHeaders() {
  return { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }
}

const mockPythonOk = async () => ({ id: 'python', status: 'ok', value: '3.12.10', detail: '' })
const mockPythonMissing = async () => ({ id: 'python', status: 'missing', value: '', detail: '未找到 Python 启动器' })
const mockWingetOk = async () => ({ ok: true, value: '1.29.290', detail: '' })
const mockWingetMissing = async () => ({ ok: false, value: '', detail: NO_WINGET_NOTE })

// ═══════════════════════════ 主流程 ═══════════════════════════

// 默认跳过 wps（不拉起办公软件）；加 --full 做完整七项实测（含 WPS COM 实例化后立即退出）
const WITH_WPS = process.argv.indexOf('--full') >= 0
const report = await runProbes({ skip: WITH_WPS ? [] : ['wps'] })
const byId = {}
for (const it of report.items) byId[it.id] = it

section('[1] 探针形状（七项 / 枚举 / 字段）')
ok(report.ok === true, 'report.ok === true')
ok(report.items.length === 7, 'items 共七项：' + report.items.length)
ok(report.items.map((i) => i.id).join(',') === PROBE_ORDER.join(','), 'id 与顺序符合契约：' + PROBE_ORDER.join(', '))
ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(report.checkedAt), 'checkedAt 为本地 ISO：' + report.checkedAt)
let shapeBad = []
for (const it of report.items) {
  if (STATUSES.indexOf(it.status) < 0) shapeBad.push(it.id + '.status')
  if (FIX_KINDS.indexOf(it.fixKind) < 0) shapeBad.push(it.id + '.fixKind')
  if (typeof it.value !== 'string' || typeof it.detail !== 'string' || typeof it.label !== 'string' || !it.label) shapeBad.push(it.id + '.fields')
  if (typeof it.autoFixable !== 'boolean') shapeBad.push(it.id + '.autoFixable')
  if (it.fixKind === 'none' ? it.fixCommand !== '' : it.fixCommand.length === 0) shapeBad.push(it.id + '.fixCommand')
}
ok(shapeBad.length === 0, '字段齐全且自洽' + (shapeBad.length ? '（问题：' + shapeBad.join(', ') + '）' : ''))
ok(withWpsLabel(), withWpsLabel(true))
function withWpsLabel(detailOnly) {
  if (WITH_WPS) {
    return detailOnly
      ? 'wps 真实探测：' + byId.wps.status + ' / ' + (byId.wps.value || '-') + '（' + byId.wps.detail + '）'
      : byId.wps.status !== 'skip'
  }
  return detailOnly ? 'wps 已按测试要求跳过（不拉起办公软件）' : byId.wps.status === 'skip'
}

section('[2] 真实只读执行（本机）')
if (WITH_WPS) {
  console.log('  ℹ️  --full 七项实测：' + report.items.map((i) => i.id + '=' + i.status).join('  ') + '   ' + JSON.stringify(report.summary))
}
ok(byId.node.status === 'ok', 'node 项：' + byId.node.status + ' ' + byId.node.value + '（' + byId.node.detail + '）')
ok(byId.node.value === 'v' + process.version.replace(/^v/, ''), 'node 值与 process.version 一致')
ok(byId.host.status === 'ok' || byId.host.status === 'warn', 'host 项：' + byId.host.status + ' / ' + (byId.host.value || '-'))
console.log('     host detail: ' + (byId.host.detail || '-'))
ok(byId.python.status !== 'skip', 'python 项真执行：' + byId.python.status + ' / ' + (byId.python.value || '-'))
if (byId.python.status === 'ok') {
  ok(/^\d+\.\d+/.test(byId.python.value), 'python 版本可解析：' + byId.python.value)
  ok(byId.pythonDeps.status !== 'skip', 'pythonDeps 项真执行：' + byId.pythonDeps.status + ' / ' + byId.pythonDeps.value)
  ok(/^\d+\/8 就绪$/.test(byId.pythonDeps.value), 'pythonDeps 值形如 n/8 就绪：' + byId.pythonDeps.value)
} else {
  console.log('  ⚠️  本机未检测到 Python，跳过 pythonDeps 真跑断言（' + byId.python.detail + '）')
}
ok(byId.subPlugins.status === 'skip' ? byId.subPlugins.value === '' : /^\d\/5 已装$/.test(byId.subPlugins.value),
  'subPlugins 项可读：' + byId.subPlugins.status + ' / ' + (byId.subPlugins.value || '-') + ' / ' + byId.subPlugins.detail)

section('[3] 纯函数判定')
ok(satisfiesRange('22.19.0', NODE_ENGINE_RANGE) === true, 'semver: 22.19.0 满足 ' + NODE_ENGINE_RANGE)
ok(satisfiesRange('22.18.9', NODE_ENGINE_RANGE) === false, 'semver: 22.18.9 不满足')
ok(satisfiesRange('23.5.0', NODE_ENGINE_RANGE) === false, 'semver: 23.5.0 不满足（^22 上界）')
ok(satisfiesRange('24.0.0', NODE_ENGINE_RANGE) === true, 'semver: 24.0.0 满足')
ok(satisfiesRange('v25.1.2', NODE_ENGINE_RANGE) === true, 'semver: 25.1.2 满足')

const pyOk = interpretPython(cmdRes({ stdout: 'Python 3.12.10' }), ['py', '-3'], { ok: true })
ok(pyOk.status === 'ok' && pyOk.value === '3.12.10' && pyOk.fixKind === 'none', 'python ok：' + pyOk.value)
const pyOld = interpretPython(cmdRes({ stdout: 'Python 3.8.10' }), ['py', '-3'], { ok: true })
ok(pyOld.status === 'missing' && pyOld.fixKind === 'winget' && pyOld.autoFixable === true, 'python 3.8 → missing + winget 可代执行')
ok(pyOld.fixCommand === 'winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent',
  'python 修复命令逐字正确')
const pyStub = interpretPython(cmdRes({ code: 1, stderr: 'Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut.' }), ['py', '-3'], { ok: false })
ok(pyStub.status === 'missing' && /Microsoft Store/.test(pyStub.detail), '识别 Microsoft Store 别名 stub')
ok(pyStub.fixKind === 'manual' && pyStub.autoFixable === false && /未检测到 winget/.test(pyStub.detail), 'winget 缺失 → 降级 manual')
ok(pyStub.fixCommand === 'https://www.python.org/downloads/windows/', 'winget 缺失时给官网地址')
const pyNoExec = interpretPython(cmdRes({ code: null, error: 'spawn py ENOENT' }), ['py', '-3'], { ok: true })
ok(pyNoExec.status === 'missing' && /未找到 Python 启动器/.test(pyNoExec.detail), 'ENOENT → 未找到启动器')

const allEight = REQUIRED_PIP_PACKAGES.map((n, i) => ({ name: n, version: '9.0.' + i }))
const depsOk = interpretPipList(cmdRes({ stdout: JSON.stringify(allEight) }), ['py', '-3'])
ok(depsOk.status === 'ok' && depsOk.value === '8/8 就绪', 'pip list 全齐：' + depsOk.value)
const depsOne = interpretPipList(cmdRes({ stdout: JSON.stringify([{ name: 'pypdf', version: '5.0.0' }]) }), ['py', '-3'])
ok(depsOne.status === 'missing' && depsOne.value === '1/8 就绪', 'pip list 缺包计数：' + depsOne.value)
ok(/python-docx/.test(depsOne.detail) && /PyMuPDF/.test(depsOne.detail), '缺失清单可读')
ok(depsOne.fixCommand === 'py -3 -m pip install python-docx openpyxl python-pptx PyMuPDF pdfplumber pypdf Pillow pywin32',
  'pythonDeps 修复命令逐字正确')
ok(depsOne.autoFixable === true && depsOne.fixKind === 'pip', 'pythonDeps 可代执行')
const depsGarbage = interpretPipList(cmdRes({ stdout: 'bogus output' }), ['py', '-3'])
ok(depsGarbage.status === 'warn' && /无法解析/.test(depsGarbage.detail), 'pip list 非法输出 → warn 不崩')

const wpsOk = interpretWps(cmdRes({ stdout: 'WPS_OK' }), ['py', '-3'], { ok: true })
ok(wpsOk.status === 'ok' && wpsOk.detail.indexOf(WPS_LICENSE_NOTE) >= 0, 'wps ok 且 detail 含许可提示')
const wpsMiss = interpretWps(cmdRes({ code: 3, stdout: 'WPS_MISSING:Invalid class string' }), ['py', '-3'], { ok: true })
ok(wpsMiss.status === 'missing' && wpsMiss.fixKind === 'winget' && wpsMiss.autoFixable === true, 'WPS 未安装 → 可代执行安装')
ok(wpsMiss.fixCommand === 'winget install -e --id Kingsoft.WPSOffice.CN --accept-source-agreements --accept-package-agreements --silent',
  'wps 修复命令逐字正确')
ok(wpsMiss.detail.indexOf(WPS_LICENSE_NOTE) >= 0 && wpsMiss.detail.indexOf('第三方商业软件') >= 0, 'wps detail 含第三方许可提示')
const wpsMissNoWinget = interpretWps(cmdRes({ code: 3, stdout: 'WPS_MISSING:Invalid class string' }), ['py', '-3'], { ok: false })
ok(wpsMissNoWinget.fixKind === 'manual' && wpsMissNoWinget.autoFixable === false && /未检测到 winget/.test(wpsMissNoWinget.detail),
  'winget 缺失 → wps 降级 manual')
ok(wpsMissNoWinget.fixCommand === 'https://www.wps.cn/', 'wps 降级后给官网地址')
const wpsNoPywin = interpretWps(cmdRes({ code: 2, stdout: 'PYWIN32_MISSING:No module named win32com' }), ['py', '-3'], { ok: true })
ok(wpsNoPywin.status === 'missing' && wpsNoPywin.fixKind === 'pip' && wpsNoPywin.autoFixable === false, 'pywin32 缺失与 WPS 未安装可区分')

ok(interpretObsidian([{ kind: 'registry' }], { ok: true }).status === 'ok', 'obsidian 注册表命中 → ok')
const obsMiss = interpretObsidian([], { ok: true })
ok(obsMiss.status === 'warn', 'obsidian 检测不到 → warn（不报 error）')
ok(obsMiss.fixKind === 'winget' && obsMiss.autoFixable === true && obsMiss.fixCommand === 'winget install -e --id Obsidian.Obsidian --accept-source-agreements --accept-package-agreements --silent',
  'obsidian 修复命令逐字正确')
const obsMissNoWinget = interpretObsidian([], { ok: false })
ok(obsMissNoWinget.fixKind === 'manual' && obsMissNoWinget.fixCommand === 'https://obsidian.md/', 'obsidian 降级给官网地址')

const tmpProfile = mkdtempSync(join(tmpdir(), 'wps-probe-'))
mkdirSync(join(tmpProfile, 'node_modules', 'dsh-work-memory'), { recursive: true })
writeFileSync(join(tmpProfile, 'node_modules', 'dsh-work-memory', 'package.json'), JSON.stringify({ name: 'dsh-work-memory', version: '9.9.9' }), 'utf8')
const subOne = probeSubPlugins({ profileDir: tmpProfile })
ok(subOne.status === 'warn' && subOne.value === '1/5 已装', 'subPlugins 部分安装 → warn：' + subOne.value)
ok(/dsh-work-memory@9.9.9/.test(subOne.detail), 'subPlugins 读到版本')
ok(/dsh-doc-suite/.test(subOne.fixCommand), 'subPlugins 修复提示列出缺失项')
rmSync(tmpProfile, { recursive: true, force: true })
ok(probeSubPlugins({ profileDir: null }).status === 'skip', 'subPlugins 推不出 profile → skip')

section('[3b] host 多来源探测（注入式，绝不读本机私有目录）')
const tmpDir = mkdtempSync(join(tmpdir(), 'wps-probe-'))

/** 造一个最小 asar（pickle 头 + JSON 目录表 + 数据区），用于验证只读 header 解析 */
function writeMiniAsar(asarPath, versions) {
  const pkgBuf = Buffer.from(JSON.stringify({ name: 'dsh-plugin-desktop', version: versions.desktop }), 'utf8')
  const rtBuf = Buffer.from(JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: versions.runtime }), 'utf8')
  const files = {
    'package.json': { size: pkgBuf.length, offset: 0 },
    node_modules: {
      files: {
        '@deepseek-ai': {
          files: { 'dsh-tools': { files: { 'package.json': { size: rtBuf.length, offset: pkgBuf.length } } } },
        },
      },
    },
  }
  const headerBuf = Buffer.from(JSON.stringify({ files }), 'utf8')
  const pre = Buffer.alloc(16)
  pre.writeUInt32LE(4, 0)
  pre.writeUInt32LE(headerBuf.length + 8, 4)
  pre.writeUInt32LE(headerBuf.length + 4, 8)
  pre.writeUInt32LE(headerBuf.length, 12)
  mkdirSync(dirname(asarPath), { recursive: true })
  writeFileSync(asarPath, Buffer.concat([pre, headerBuf, pkgBuf, rtBuf]))
}

const asarPath = join(tmpDir, 'install', 'resources', 'app.asar')
writeMiniAsar(asarPath, { desktop: '9.9.9', runtime: '0.7.7' })
const asarRead = readAsarHeader(asarPath)
ok(Boolean(asarRead) && Boolean(asarRead.header && asarRead.header.files), 'asar header 只读解析成功')
const hAsar = probeHost({ env: {}, execPath: join(tmpDir, 'install', 'DSH Desktop.exe'), appDataDir: join(tmpDir, 'none'), profileDir: null })
ok(hAsar.status === 'ok' && hAsar.value === '9.9.9 / dsh 0.7.7', 'asar 来源（宿主 + 内置运行时）：' + hAsar.status + ' / ' + hAsar.value)
ok(/app\.asar/.test(hAsar.detail), 'detail 标注 asar 来源')

const appdata = join(tmpDir, 'appdata')
mkdirSync(join(appdata, 'logs'), { recursive: true })
writeFileSync(join(appdata, 'Preferences'), JSON.stringify({ desktop: { version: '8.8.8' } }), 'utf8')
const hPref = probeHost({ env: {}, execPath: join(tmpDir, 'nope.exe'), appDataDir: appdata, profileDir: null })
ok(hPref.status === 'ok' && hPref.value === '8.8.8' && /Preferences/.test(hPref.detail), 'Preferences 来源：' + hPref.value)

const appdata2 = join(tmpDir, 'appdata2')
mkdirSync(join(appdata2, 'logs'), { recursive: true })
writeFileSync(join(appdata2, 'logs', 'dsh-' + todayStampLocal() + '.log'),
  'boot\n--- dsh-plugin-desktop DSH Desktop 7.7.7 win32 node v24.18.1 run 1 ---\n', 'utf8')
const hLog = probeHost({ env: {}, execPath: join(tmpDir, 'nope.exe'), appDataDir: appdata2, profileDir: null })
ok(hLog.status === 'ok' && hLog.value === '7.7.7' && /logs/.test(hLog.detail), 'logs 启动行来源：' + hLog.value)

const prof = join(tmpDir, 'prof')
mkdirSync(join(prof, 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true })
writeFileSync(join(prof, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'),
  JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.5.5' }), 'utf8')
const hRt = probeHost({ env: {}, execPath: join(tmpDir, 'nope.exe'), appDataDir: join(tmpDir, 'none'), profileDir: prof })
ok(hRt.status === 'ok' && hRt.value === 'dsh 0.5.5', 'profile node_modules 运行时来源：' + hRt.value)

const hEnv = probeHost({ env: { DSH_APP_VERSION: '2.0.9', DSH_RUNTIME_VERSION: '0.1.5-rc.1' }, execPath: join(tmpDir, 'nope.exe'), appDataDir: join(tmpDir, 'none'), profileDir: null })
ok(hEnv.status === 'ok' && hEnv.value === '2.0.9 / 0.1.5-rc.1', 'DSH_* 环境变量来源：' + hEnv.value)

const hNone = probeHost({ env: {}, execPath: join(tmpDir, 'nope.exe'), appDataDir: join(tmpDir, 'empty'), profileDir: null })
ok(hNone.status === 'warn' && /版本来源不可用/.test(hNone.value), '全部来源不可用 → warn（不再是 skip）：' + hNone.value)

section('[3c] Python 解释器解析（固定候选 / 脱敏 / 固定参数）')
const envPy = { LOCALAPPDATA: join(tmpDir, 'local'), ProgramFiles: join(tmpDir, 'pf') }
for (const v of ['Python311', 'Python312']) mkdirSync(join(envPy.LOCALAPPDATA, 'Programs', 'Python', v), { recursive: true })
writeFileSync(join(envPy.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'), '', 'utf8')
mkdirSync(join(envPy.ProgramFiles, 'Python310'), { recursive: true })
writeFileSync(join(envPy.ProgramFiles, 'Python310', 'python.exe'), '', 'utf8')
const cands = findPythonCandidates('win32', envPy)
ok(cands.length === 2, '候选只列真实存在的解释器：' + cands.length)
ok(/Python312/.test(cands[0].cmd) && /%LOCALAPPDATA%/.test(cands[0].masked), 'LOCALAPPDATA 候选优先且版本从高到低：' + cands[0].masked)
ok(cands[1].masked === '%ProgramFiles%\\Python310\\python.exe', 'ProgramFiles 作为次选：' + cands[1].masked)
ok(maskUserPath(cands[0].cmd, envPy) === cands[0].masked, 'maskUserPath 与候选 masked 一致')
ok(maskUserPath(cands[0].cmd, envPy).indexOf(envPy.LOCALAPPDATA) < 0, '脱敏后不含真实 LOCALAPPDATA 路径')
const fakeExec = { cmd: 'D:\\somewhere\\Python312\\python.exe', args: [], command: 'D:\\somewhere\\Python312\\python.exe' }
const normExec = normalizePythonExec(fakeExec)
ok(normExec.cmd === fakeExec.cmd && normExec.args.length === 0, 'normalizePythonExec 保留解释器路径')
const pipExec = pipInstallArgv('win32', fakeExec)
ok(pipExec.command === fakeExec.cmd + ' -m pip install ' + REQUIRED_PIP_PACKAGES.join(' '), 'pip 命令前缀=实际解释器、参数固定')
ok(pipExec.args.join(' ') === '-m pip install ' + REQUIRED_PIP_PACKAGES.join(' '), 'pip 参数只来自固定包清单')
const pFixExec = resolveFixCommand('pythonDeps', { platform: 'win32', pythonOk: true, pythonExec: fakeExec })
ok(pFixExec.ok === true && pFixExec.command === pipExec.command, '/fix pythonDeps 回显实际解释器')

section('[4] /fix 白名单（固定命令 / 未知 id / 无外部输入）')
const EXPECTED_FIX = {
  python: 'winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent',
  pythonDeps: 'py -3 -m pip install python-docx openpyxl python-pptx PyMuPDF pdfplumber pypdf Pillow pywin32',
  wps: 'winget install -e --id Kingsoft.WPSOffice.CN --accept-source-agreements --accept-package-agreements --silent',
  obsidian: 'winget install -e --id Obsidian.Obsidian --accept-source-agreements --accept-package-agreements --silent',
}
const ALLOWED_ARGS = new Set(['install', '-e', '--id', '-m', 'pip', '-3'].concat(WINGET_FLAGS, Object.values(WINGET_PACKAGE_IDS), REQUIRED_PIP_PACKAGES))
for (const id of Object.keys(EXPECTED_FIX)) {
  const p = resolveFixCommand(id, { pythonOk: true, wingetOk: true })
  ok(p.ok === true && p.command === EXPECTED_FIX[id], id + ' → ' + (p.command || p.reason))
  ok(p.args.length > 0 && p.args.every((a) => ALLOWED_ARGS.has(a)), id + ' 参数全部来自固定集合（无外部输入）')
}
const EVIL = ['pythonDeps; calc', 'pythonDeps extra', 'pythonDeps && shutdown /s', '../../etc/passwd', 'PYTHONDEPS', 'a'.repeat(200), '', '   ', null, 123, {}, [], 'python' + String.fromCharCode(0)]
let evilBad = []
for (const e of EVIL) {
  const p = resolveFixCommand(e, { pythonOk: true, wingetOk: true })
  const cmd = p.command + ' ' + p.args.join(' ')
  if (p.ok !== false || p.command !== '' || p.args.length !== 0) evilBad.push(JSON.stringify(e))
  const injected = typeof e === 'string' && e.trim() !== '' && (cmd.indexOf(e) >= 0)
  if (injected) evilBad.push('注入:' + JSON.stringify(e))
}
ok(evilBad.length === 0, '非白名单 id 一律拒绝且不产出命令' + (evilBad.length ? '（问题：' + evilBad.join(', ') + '）' : ''))
for (const id of ['host', 'node', 'subPlugins']) {
  const p = resolveFixCommand(id, { pythonOk: true, wingetOk: true })
  ok(p.ok === false && /不支持自动补齐|手动/.test(p.reason), id + ' 属于只读项，拒绝代执行')
}
const pNoPy = resolveFixCommand('pythonDeps', { pythonOk: false, wingetOk: true })
ok(pNoPy.ok === false && /Python/.test(pNoPy.reason), 'Python 缺失时 pythonDeps 拒绝代执行')
const pNoWinget = resolveFixCommand('python', { pythonOk: true, wingetOk: false })
ok(pNoWinget.ok === false && /未检测到 winget/.test(pNoWinget.reason), 'winget 缺失时 python 拒绝代执行')

section('[5] /fix-all（ids 校验 / 固定顺序 / rejected，mock 执行）')
const plan1 = resolveFixAllPlan(['wps', 'python', 'obsidian'])
ok(plan1.order.join(',') === 'python,wps,obsidian', '忽略传入顺序，按 python → wps → obsidian：' + plan1.order.join(','))
const plan2 = resolveFixAllPlan(['obsidian', 'pythonDeps', 'obsidian'])
ok(plan2.order.join(',') === 'pythonDeps,obsidian', '去重且按固定顺序：' + plan2.order.join(','))
const plan3 = resolveFixAllPlan(['python', 'host', 'node', 'subPlugins', 'nope', 123, null])
ok(plan3.order.join(',') === 'python', '只保留白名单项')
ok(plan3.rejected.join('|') === 'host|node|subPlugins|nope|123|', '未知 id 全部计入 rejected：' + JSON.stringify(plan3.rejected))
const plan4 = resolveFixAllPlan('python')
ok(plan4.order.length === 0 && plan4.rejected.length === 0, 'ids 非数组 → 空计划（不抛错）')

section('[6] 端到端路由（mock ctx + mock 执行器）')
const calls = []
const mockExec = async (cmd, args) => {
  calls.push(cmd + ' ' + args.join(' '))
  return { exitCode: 0, stdout: 'mock-stdout:' + cmd, stderr: '' }
}
const ctx = makeMockCtx()
const mockResolvePyLauncher = async () => ({ cmd: 'py', args: ['-3'], command: 'py -3', masked: 'py -3' })
installApi(ctx, {
  exec: mockExec,
  platform: 'win32',
  probeWinget: mockWingetOk,
  probePython: mockPythonOk,
  resolvePython: mockResolvePyLauncher,
  probeOptions: { skip: ['wps'] },
})
const handler = prefixHandler(ctx)
ok(typeof handler === 'function', 'prefix 路由已注册：' + API_ROOT)
const exacts = ctx.routes.filter((r) => r.kind === 'exact').map((r) => r.path).sort()
ok(exacts.join(',') === API_PATHS.map((p) => API_ROOT + p).sort().join(','),
  'exact 路由与 API_PATHS 一一对应：' + exacts.join(', '))

const resCheck = makeRes()
await handler(makeReq({ method: 'GET', url: API_ROOT + '/check' }), resCheck)
ok(resCheck.status === 200 && resCheck.headers['content-type'].indexOf('application/json') === 0, 'GET /check → 200 JSON')
const checkData = JSON.parse(resCheck.body)
ok(checkData.ok === true && checkData.items.length === 7, 'GET /check 返回七项')
ok(checkData.items.map((i) => i.id).join(',') === PROBE_ORDER.join(','), 'GET /check 顺序符合契约')
ok(JSON.stringify(checkData.summary) === JSON.stringify(summarize(checkData.items)), 'GET /check summary 与 items 一致：' + JSON.stringify(checkData.summary))

calls.length = 0
const resFixUnknown = makeRes()
await handler(makeReq({ method: 'POST', url: API_ROOT + '/fix', headers: sameOriginHeaders(), body: { id: 'not-a-real-id' } }), resFixUnknown)
const fixUnknown = JSON.parse(resFixUnknown.body)
ok(resFixUnknown.status === 200 && fixUnknown.ok === false && fixUnknown.command === '' && fixUnknown.exitCode === null,
  'POST /fix 未知 id → ok:false + 无命令')
ok(/未知检查项/.test(fixUnknown.output), 'POST /fix 未知 id 给出提示：' + fixUnknown.output)
ok(calls.length === 0, 'POST /fix 未知 id 未执行任何命令')

const resFixDeps = makeRes()
await handler(makeReq({ method: 'POST', url: API_ROOT + '/fix', headers: sameOriginHeaders(), body: { id: 'pythonDeps' } }), resFixDeps)
const fixDeps = JSON.parse(resFixDeps.body)
ok(fixDeps.ok === true && fixDeps.command === EXPECTED_FIX.pythonDeps && fixDeps.exitCode === 0 && typeof fixDeps.durationMs === 'number',
  'POST /fix pythonDeps → 执行固定命令并回显')
ok(typeof fixDeps.output === 'string' && fixDeps.output.length <= 8000, 'POST /fix output 已截断 <= 8000')
ok(calls.length === 1 && calls[0] === EXPECTED_FIX.pythonDeps, 'mock 执行器收到固定命令：' + calls[0])

const resCross = makeRes()
await handler(makeReq({
  method: 'POST', url: API_ROOT + '/fix',
  headers: { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://evil.example' },
  body: { id: 'pythonDeps' },
}), resCross)
ok(resCross.status === 403 && JSON.parse(resCross.body).ok === false, '跨站 POST → 403')
const resNoJson = makeRes()
await handler(makeReq({ method: 'POST', url: API_ROOT + '/fix', headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }, body: { id: 'python' } }), resNoJson)
ok(resNoJson.status === 403, '非 application/json → 403')
ok(calls.length === 1, '被拒绝的写请求未执行任何命令')

calls.length = 0
const ctxAll = makeMockCtx()
installApi(ctxAll, { exec: mockExec, platform: 'win32', probeWinget: mockWingetOk, probePython: mockPythonOk })
const handlerAll = prefixHandler(ctxAll)
const resAll = makeRes()
await handlerAll(makeReq({
  method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(),
  body: { ids: ['wps', 'obsidian', 'python', 'nope', 'host'] },
}), resAll)
const allData = JSON.parse(resAll.body)
ok(allData.results.map((r) => r.id).join(',') === 'python,wps,obsidian', 'POST /fix-all 按固定依赖顺序执行：' + allData.results.map((r) => r.id).join(','))
ok(allData.rejected.join('|') === 'nope|host', 'POST /fix-all rejected 收录未知 id：' + JSON.stringify(allData.rejected))
ok(allData.results.every((r) => r.ok === true && r.exitCode === 0), 'POST /fix-all 每项返回 ok/exitCode')
ok(allData.results.map((r) => r.command).join('|') === [EXPECTED_FIX.python, EXPECTED_FIX.wps, EXPECTED_FIX.obsidian].join('|'),
  'POST /fix-all 逐项命令均为白名单固定命令')
ok(calls.join('|') === allData.results.map((r) => r.command).join('|'), 'mock 执行器调用序列与返回一致')
ok(allData.ok === true && typeof allData.durationMs === 'number', 'POST /fix-all 汇总 ok / durationMs')

const ctxAllNoWinget = makeMockCtx()
installApi(ctxAllNoWinget, { exec: mockExec, platform: 'win32', probeWinget: mockWingetMissing, probePython: mockPythonOk })
const handlerNoWinget = prefixHandler(ctxAllNoWinget)
calls.length = 0
const resNoWinget = makeRes()
await handlerNoWinget(makeReq({ method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(), body: { ids: ['python', 'wps'] } }), resNoWinget)
const noWingetData = JSON.parse(resNoWinget.body)
ok(noWingetData.results.every((r) => r.ok === false && r.exitCode === null && r.command === ''), 'winget 缺失时不产出可执行命令')
ok(/未检测到 winget/.test(noWingetData.results[0].output), '给出「未检测到 winget」提示')
ok(calls.length === 0, 'winget 缺失时一步都没执行')

const ctxOnlyDeps = makeMockCtx()
installApi(ctxOnlyDeps, {
  exec: mockExec, platform: 'win32', probeWinget: mockWingetOk, probePython: mockPythonMissing,
  resolvePython: async () => null,
})
const handlerDeps = prefixHandler(ctxOnlyDeps)
calls.length = 0
const resDepsMissingPy = makeRes()
await handlerDeps(makeReq({ method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(), body: { ids: ['pythonDeps'] } }), resDepsMissingPy)
const depsMissingPy = JSON.parse(resDepsMissingPy.body)
ok(depsMissingPy.results[0].ok === false && /Python/.test(depsMissingPy.results[0].output), 'Python 缺失时 pythonDeps 明确失败')
ok(calls.length === 0, 'Python 缺失时未执行 pip')

const resAllBad = makeRes()
await handlerAll(makeReq({ method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(), body: { ids: 'python' } }), resAllBad)
const allBad = JSON.parse(resAllBad.body)
ok(resAllBad.status === 200 && allBad.ok === false && allBad.results.length === 0 && /ids 必须是/.test(allBad.message), 'ids 非数组 → 明确拒绝')

section('[6c] /fix pythonDeps 解释器解析（mock，绝不真跑 pip）')
const installedExec = { cmd: 'D:\\py\\Python312\\python.exe', args: [], command: 'D:\\py\\Python312\\python.exe', masked: 'D:\\py\\Python312\\python.exe' }
const ctxExec = makeMockCtx()
installApi(ctxExec, {
  exec: mockExec, platform: 'win32', probeWinget: mockWingetOk, probePython: mockPythonOk,
  resolvePython: async () => installedExec,
})
const handlerExec = prefixHandler(ctxExec)
calls.length = 0
const resExec = makeRes()
await handlerExec(makeReq({ method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(), body: { ids: ['pythonDeps'] } }), resExec)
const execData = JSON.parse(resExec.body)
ok(execData.results[0].ok === true, 'pythonDeps 用解析出的解释器执行成功')
ok(execData.results[0].command === installedExec.cmd + ' -m pip install ' + REQUIRED_PIP_PACKAGES.join(' '),
  'command 回显实际解释器：' + execData.results[0].command)
ok(calls.length === 1 && calls[0] === execData.results[0].command, 'mock 执行器收到同一命令')

const ctxNoExec = makeMockCtx()
installApi(ctxNoExec, {
  exec: mockExec, platform: 'win32', probeWinget: mockWingetOk, probePython: mockPythonMissing,
  resolvePython: async () => null,
})
const handlerNoExec = prefixHandler(ctxNoExec)
calls.length = 0
const resNoExec = makeRes()
await handlerNoExec(makeReq({ method: 'POST', url: API_ROOT + '/fix-all', headers: sameOriginHeaders(), body: { ids: ['pythonDeps'] } }), resNoExec)
const noExecData = JSON.parse(resNoExec.body)
ok(noExecData.results[0].ok === false && noExecData.results[0].exitCode === null && noExecData.results[0].command === '',
  '解释器解析失败 → 明确失败且不产出命令')
ok(/请先补齐 Python 解释器/.test(noExecData.results[0].output), '提示「请先补齐 Python 解释器」')
ok(noExecData.results[0].output.indexOf('D:\\') < 0, '失败 output 不含磁盘绝对路径（候选已脱敏）')
ok(calls.length === 0, '解释器缺失时未执行 pip')

section('[6b] 宿主半 apply（有 / 无 webServer）')
ok(hostInject.indexOf('settings') >= 0 && hostInject.indexOf('webServer') >= 0, 'inject 含 settings + webServer：' + hostInject.join(', '))
const ctxHost = makeMockCtx()
const disposeHost = applyHost(ctxHost, {})
ok(ctxHost.routes.length === API_PATHS.length + 1 && typeof disposeHost === 'function',
  'apply 注册 prefix + ' + API_PATHS.length + ' exact 并返回 disposer（' + ctxHost.routes.length + ' 条）')
let disposeErr = null
try { disposeHost() } catch (e) { disposeErr = e }
ok(disposeErr === null, 'disposer 可安全调用')
const hostLogs = []
const ctxNoServer = { logger: { debug() {}, warn(m) { hostLogs.push(String(m)) }, info() {} } }
let hostThrew = false
let disposeNo = null
try { disposeNo = applyHost(ctxNoServer, {}) } catch (e) { hostThrew = true }
ok(hostThrew === false && typeof disposeNo === 'function', '无 webServer 时降级不抛并返回 disposer')
ok(hostLogs.some((l) => /Web API 安装失败/.test(l)), '降级时日志说明原因：' + String(hostLogs[0] || '').slice(0, 70))
if (typeof disposeNo === 'function') disposeNo()

section('[7] 一致性与中立性')
ok(SUB_PLUGINS.map((p) => p.name).join(',') === ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'dsh-token-pet'].join(','),
  'index.js SUB_PLUGINS 与探针清单一致')
const pkgVersion = JSON.parse(readFileSync(join(MODULE_DIR, 'package.json'), 'utf8')).version
ok(readVersion() === pkgVersion, 'readVersion 与 package.json 一致：v' + pkgVersion)
const banned = ['莉娜', '主人', '天地和兴', '知识库-天地', 'lina', 'C:\\Users']
for (const rel of ['lib/probe.js', 'lib/api.js', 'lib/index.js', 'lib/install.js', 'lib/basedeck.js']) {
  const src = readFileSync(join(MODULE_DIR, rel), 'utf8')
  const hit = banned.filter((k) => src.indexOf(k) >= 0)
  ok(hit.length === 0, rel + ' 无私有信息' + (hit.length ? '（命中：' + hit.join(', ') + '）' : ''))
}
const probeSrc = readFileSync(join(MODULE_DIR, 'lib/probe.js'), 'utf8')
const probeImport = /import\s*\{([^}]*)\}\s*from\s*'node:child_process'/.exec(probeSrc)
ok(Boolean(probeImport) && probeImport[1].trim() === 'execFile', 'probe.js 只从 child_process 导入 execFile')
ok(/execFile\(/.test(probeSrc) && !/execSync|shell:\s*true/.test(probeSrc), 'probe.js 无 execSync / shell:true')
const apiSrc = readFileSync(join(MODULE_DIR, 'lib/api.js'), 'utf8')
const apiImport = /import\s*\{([^}]*)\}\s*from\s*'node:child_process'/.exec(apiSrc)
ok(Boolean(apiImport) && apiImport[1].trim() === 'execFile', 'api.js 只从 child_process 导入 execFile')
ok(/execFile\(/.test(apiSrc) && !/execSync|shell:\s*true/.test(apiSrc), 'api.js 无 execSync / shell:true')
ok(/\.join\(' '\)/.test(apiSrc) && apiSrc.indexOf('child_process') >= 0, 'api.js 回显命令用数组 join（不拼 shell 字符串）')

rmSync(tmpDir, { recursive: true, force: true })

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
process.exit(fail === 0 ? 0 : 1)
