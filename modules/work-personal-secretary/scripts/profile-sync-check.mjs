/**
 * work-personal-secretary —— 源码 vs profile 副本一致性探针（T5-3）
 *
 * 用法：node scripts/profile-sync-check.mjs [--profile desktop] [--module <id>] [--verbose]
 *
 * 回答一个问题：本机 DSH profile 里装的模块，与仓库源码是不是同一份。
 *   · 本体（work-personal-secretary）在 profile 里通常是 Junction，指向仓库本体目录；
 *   · 其余子模块是安装时拷进去的真实副本（file: 依赖）。
 *   两种形态都要能判：链接且指向源码 → LINK（视同一致）；真实副本 → 逐文件比 SHA256。
 *
 * 判定口径：
 *   · 「应装文件」= 该模块 package.json 的 files 白名单（文件或目录名，目录递归展开）；
 *     不在白名单里的源文件（ARCHITECTURE.md、tests、tsconfig 等）不参与判定，不算缺失。
 *   · package.json 视为隐式应装（打包语义，恒随包）。
 *   · node_modules 与 Python 字节码缓存（__pycache__ / *.pyc）不参与比对（安装产物 / 解释器派生，不是源码内容）。
 *   · MATCH=内容一致；DIFF=存在但内容不同；MISSING=白名单文件在副本里没有；
 *     EXTRA=副本里有而白名单里没有的文件；LINK=该模块在 profile 里是指向源码的链接。
 *
 * 退出码：0 全部一致（EXTRA 不影响）；1 有任何 DIFF/MISSING；2 找不到 profile 目录或参数错误。
 * 纪律：只用 node: 内置模块；只读，不写任何文件；不联网。
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')
const REPO_ROOT = join(MODULE_DIR, '..', '..')
const MODULES_DIR = join(REPO_ROOT, 'modules')
const SELF_NAME = 'work-personal-secretary'
/** 递归时跳过：不作为包内容的安装产物（node_modules / .git）与 Python 字节码缓存（__pycache__ / *.pyc——随解释器版本变，比它没有意义） */
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])
function skipFile(name) { return name.slice(-4).toLowerCase() === '.pyc' }

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

// ───────────────────── 参数 ─────────────────────
function parseArgs(argv) {
  const opt = { profile: 'desktop', modules: [], verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile') { const v = argv[++i]; if (!v) throw new Error('--profile 缺少取值'); opt.profile = v }
    else if (a === '--module') { const v = argv[++i]; if (!v) throw new Error('--module 缺少取值'); opt.modules.push(...v.split(',').map((s) => s.trim()).filter(Boolean)) }
    else if (a === '--verbose' || a === '-v') opt.verbose = true
    else if (a === '--help' || a === '-h') opt.help = true
    else throw new Error('未知参数：' + a)
  }
  return opt
}

let OPT
try { OPT = parseArgs(process.argv.slice(2)) } catch (e) { console.error('参数错误：' + e.message); process.exit(2) }
if (OPT.help) {
  console.log('用法：node scripts/profile-sync-check.mjs [--profile <name>] [--module <id>]... [--verbose]')
  console.log('  --profile   profile 名（默认 desktop），也接受 node_modules 的绝对路径')
  console.log('  --module    只检查指定模块（包名或目录名，可重复/逗号分隔）')
  console.log('  --verbose   列出差异文件名')
  process.exit(0)
}

const PROFILE_NM = resolveProfileNodeModules(OPT.profile)

function resolveProfileNodeModules(name) {
  const p = isAbsolute(name) ? name : join(homedir(), '.dsh', 'profiles', name, 'node_modules')
  // 容错：传进来的是 profile 目录而不是它的 node_modules
  if (existsSync(p) && !p.endsWith('node_modules') && existsSync(join(p, 'node_modules'))) return join(p, 'node_modules')
  return p
}

// ───────────────────── 工具 ─────────────────────
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { __error: e.message } }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function realpathSafe(p) { try { return realpathSync(p) } catch (e) { return null } }

function samePath(a, b) {
  if (!a || !b) return false
  const na = resolve(a), nb = resolve(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** junction / symlink 的展示用目标：去掉 Windows 的 \\?\ 与 \??\ 前缀，相对目标按链接所在目录解析 */
function readLinkTarget(linkPath) {
  let raw
  try { raw = readlinkSync(linkPath) } catch (e) { return null }
  let t = String(raw).replace(/^\\\\\?\\/, '').replace(/^\\\?\?\\/, '')
  return isAbsolute(t) ? t : resolve(dirname(linkPath), t)
}

/** 列出一个目录下的全部文件（posix 相对路径）；不跟随符号链接目录，避免环 */
function listFiles(root) {
  const out = []
  const walk = (rel) => {
    const abs = rel ? join(root, rel) : root
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch (e) { return }
    for (const ent of entries) {
      const child = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(child) }
      else if (!skipFile(ent.name)) out.push(child)
    }
  }
  walk('')
  return out.sort()
}

/** 白名单展开：目录递归展开成文件清单；白名单项在源码里不存在 → 告警（不算缺失） */
function expandWhiteList(srcDir, pkg) {
  const files = new Set()
  const warnings = []
  const listed = Array.isArray(pkg.files) ? pkg.files : []
  if (listed.length === 0) warnings.push('package.json 没有 files 白名单（按空集处理）')
  for (const raw of listed) {
    const rel = String(raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!rel) continue
    if (rel.indexOf('*') >= 0) { warnings.push('白名单含通配符，本探针按字面处理：' + raw); }
    const abs = join(srcDir, rel)
    let st = null
    try { st = lstatSync(abs) } catch (e) { st = null }
    if (!st) { warnings.push('白名单项在源码里不存在：' + rel); continue }
    if (st.isDirectory()) { for (const f of listFiles(abs)) files.add(rel + '/' + f) }
    else files.add(rel)
  }
  // 打包语义：package.json 恒随包，不受白名单控制
  files.add('package.json')
  return { files: Array.from(files).sort(), warnings }
}

/** 比对两个同名文件；一致返回 null，不一致返回可读原因 */
function compareFile(srcFile, copyFile) {
  let sa, sb
  try { sa = statSync(srcFile); sb = statSync(copyFile) } catch (e) { return 'stat 失败：' + e.message }
  if (sa.isDirectory() !== sb.isDirectory()) return '类型不同（源 ' + (sa.isDirectory() ? '目录' : '文件') + ' / 副本 ' + (sb.isDirectory() ? '目录' : '文件') + '）'
  if (sa.isDirectory()) return null
  if (sa.size !== sb.size) return '大小不同（源 ' + sa.size + ' / 副本 ' + sb.size + ' 字节）'
  if (sha256(srcFile) !== sha256(copyFile)) return '内容不同（同为 ' + sa.size + ' 字节，SHA256 不一致）'
  return null
}

// ───────────────────── 模块发现 ─────────────────────
/** 以 modules/ 下每个含 package.json 的目录为一个模块；本体排最前，其余按目录名排序 */
function discoverModules() {
  const found = []
  let entries = []
  try { entries = readdirSync(MODULES_DIR, { withFileTypes: true }) } catch (e) { return found }
  for (const ent of entries) {
    if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
    const dir = join(MODULES_DIR, ent.name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) continue
    const pkg = readJson(pkgFile)
    if (pkg.__error) continue
    found.push({ dirName: ent.name, dir, pkg, name: String(pkg.name || ent.name), version: String(pkg.version || '?') })
  }
  found.sort((a, b) => {
    if (a.name === SELF_NAME) return -1
    if (b.name === SELF_NAME) return 1
    return a.dirName < b.dirName ? -1 : a.dirName > b.dirName ? 1 : 0
  })
  return found
}

// ───────────────────── 单模块比对 ─────────────────────
function checkModule(mod) {
  const src = mod.dir
  const copy = join(PROFILE_NM, mod.name)
  const wl = expandWhiteList(src, mod.pkg)
  const expected = wl.files
  const expectedSet = new Set(expected)
  const res = {
    name: mod.name, version: mod.version, dirName: mod.dirName, source: src, target: copy,
    counts: { MATCH: 0, DIFF: 0, MISSING: 0, EXTRA: 0, LINK: 0 },
    details: { missing: [], diff: [], extra: [] },
    warnings: wl.warnings.slice(), isLink: false, linkTarget: null, status: '', notes: [],
  }

  let st = null
  try { st = lstatSync(copy) } catch (e) { st = null }

  if (!st) {
    res.status = 'MISSING'
    res.counts.MISSING = expected.length
    res.details.missing = expected.slice()
    res.notes.push('profile 里没有这个模块目录：' + copy)
    return res
  }

  if (st.isSymbolicLink()) {
    res.isLink = true
    res.linkTarget = readLinkTarget(copy)
    res.counts.LINK = 1
    const same = samePath(realpathSafe(copy), realpathSafe(src))
    if (same) {
      // 链接就指向源码目录本身，两者不可能不一致：视同全部匹配，不逐字节再比一遍
      res.status = 'LINK'
      res.counts.MATCH = expected.length
      res.notes.push('链接指向源码目录本身，视同全部一致（不再逐字节比对）')
      return res
    }
    res.notes.push('链接目标不是源码目录（' + (res.linkTarget || '未知') + '），按副本继续比对')
  }

  if (!st.isDirectory() && !st.isSymbolicLink()) {
    res.status = 'DIFF'
    res.counts.DIFF = 1
    res.details.diff.push({ file: '<模块根>', reason: 'profile 里不是目录' })
    return res
  }

  const actual = listFiles(copy)
  const actualSet = new Set(actual)
  for (const rel of expected) {
    if (!actualSet.has(rel)) { res.details.missing.push(rel); continue }
    const reason = compareFile(join(src, rel), join(copy, rel))
    if (reason) res.details.diff.push({ file: rel, reason })
    else res.counts.MATCH++
  }
  for (const rel of actual) if (!expectedSet.has(rel)) res.details.extra.push(rel)

  res.counts.MISSING = res.details.missing.length
  res.counts.DIFF = res.details.diff.length
  res.counts.EXTRA = res.details.extra.length
  if (res.counts.MISSING > 0) res.status = 'MISSING'
  else if (res.counts.DIFF > 0 || res.isLink) res.status = 'DIFF'
  else if (res.counts.EXTRA > 0) res.status = 'EXTRA'
  else res.status = 'MATCH'
  return res
}

function summaryLine(r) {
  const c = r.counts
  return '[' + r.status.padEnd(7) + '] ' + r.name.padEnd(26) + ' v' + r.version.padEnd(8)
    + ' MATCH=' + c.MATCH + ' DIFF=' + c.DIFF + ' MISSING=' + c.MISSING + ' EXTRA=' + c.EXTRA + ' LINK=' + c.LINK
}

function printDetails(r) {
  console.log('        形式    ' + (r.isLink ? 'Junction/Symlink → ' + (r.linkTarget || '?') : '真实副本'))
  console.log('        目标    ' + r.target)
  for (const f of r.details.missing) console.log('        · MISSING ' + f)
  for (const d of r.details.diff) console.log('        · DIFF    ' + d.file + '（' + d.reason + '）')
  for (const f of r.details.extra) console.log('        · EXTRA   ' + f)
  for (const w of r.warnings) console.log('        · WARN    ' + w)
  for (const n of r.notes) console.log('        · NOTE    ' + n)
}

// ───────────────────── 主流程 ─────────────────────
console.log('profile-sync-check · 源码 vs profile 副本一致性（T5-3）')
console.log('  仓库源码：' + MODULES_DIR)
console.log('  profile ：' + PROFILE_NM + (OPT.verbose ? '' : '（--verbose 看差异文件名）'))

section('[1] profile 目录')
const profileOk = existsSync(PROFILE_NM) && statSync(PROFILE_NM).isDirectory()
ok(profileOk, 'profile 的 node_modules 目录存在：' + PROFILE_NM)
if (!profileOk) {
  console.error('\n找不到 profile 目录：' + PROFILE_NM + '（--profile <name> 或直接给 node_modules 绝对路径）')
  process.exit(2)
}

section('[2] 模块清单')
const all = discoverModules()
const wanted = OPT.modules.length > 0 ? all.filter((m) => OPT.modules.indexOf(m.name) >= 0 || OPT.modules.indexOf(m.dirName) >= 0) : all
ok(all.length > 0, '仓库里发现 ' + all.length + ' 个模块：' + all.map((m) => m.name).join(' / '))
if (OPT.modules.length > 0) {
  const missingIds = OPT.modules.filter((id) => !all.some((m) => m.name === id || m.dirName === id))
  ok(missingIds.length === 0, '--module 过滤命中 ' + wanted.length + ' 个' + (missingIds.length ? '（仓库里没有：' + missingIds.join(' / ') + '）' : ''))
  if (missingIds.length > 0) process.exit(2)
}
if (wanted.length === 0) { console.error('\n没有可检查的模块'); process.exit(2) }

section('[3] 逐模块比对（MATCH / DIFF / MISSING / EXTRA / LINK）')
const results = []
for (const mod of wanted) {
  const r = checkModule(mod)
  results.push(r)
  const consistent = r.status !== 'DIFF' && r.status !== 'MISSING'
  ok(consistent, summaryLine(r))
  if (OPT.verbose) printDetails(r)
}

const total = { MATCH: 0, DIFF: 0, MISSING: 0, EXTRA: 0, LINK: 0 }
for (const r of results) for (const k of Object.keys(total)) total[k] += r.counts[k]
const dirty = results.filter((r) => r.status === 'DIFF' || r.status === 'MISSING')

section('[4] 总计')
console.log('  同步完成：MATCH=' + total.MATCH + ' DIFF=' + total.DIFF + ' MISSING=' + total.MISSING + ' EXTRA=' + total.EXTRA + ' LINK=' + total.LINK)
ok(dirty.length === 0, dirty.length === 0
  ? '所有模块与源码一致（' + results.length + ' 个模块；LINK ' + total.LINK + ' 个）'
  : '有 ' + dirty.length + ' 个模块不一致：' + dirty.map((r) => r.name + '(' + r.status + ')').join(' / '))
const extraMods = results.filter((r) => r.status === 'EXTRA')
if (extraMods.length > 0) console.log('  提示：EXTRA 不影响退出码——' + extraMods.map((r) => r.name).join(' / ') + ' 的副本里含白名单外的文件（多为安装方式带进去的，不是发布缺口）')

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' profile-sync-check：' + pass + ' 通过 / ' + fail + ' 失败；退出码 ' + (dirty.length === 0 ? 0 : 1))
process.exitCode = dirty.length === 0 ? 0 : 1