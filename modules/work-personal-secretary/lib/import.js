/**
 * work-personal-secretary —— 旧知识库导入（清单 → 勾选 → 逐项对照写入）
 *
 * 设计依据（不要在本文件里另立语义）：
 *   - 设计定稿 §3.4：`[浏览… 选择知识库文件夹]`；纪律 = **只读源目录、只补还没有的文件、
 *     不覆盖现有文件、先给预览再逐项对照确认后才落盘**；
 *   - 设计定稿 §12 决议 8：归类策略 = **先列清单 → 由使用者勾选**；
 *   - 设计定稿 §12 决议 13②：知识库**只新建、不搬迁**，要搬必须由使用者指定后**逐项对照**；
 *   - 设计定稿 §12.1：导入本机旧内容时命中敏感模式的条目**先列出、由使用者确认后才写入**；
 *   - 设计定稿 §11 技术纪律：默认 dry-run；只补缺失、不覆盖已有；写后校验、失败回滚。
 *
 * 本模块**只管知识库**（决议 13③）：记忆体不在这里搬 —— 它在执行链第 1 步已自动迁移完。
 *
 * 三条硬纪律（与 basedeck 的迁移同一套口径）：
 *   1. **只读源目录**：全程只 readdir / stat / readFile，绝不写、删、改源目录里的任何东西；
 *   2. **只补缺失**：目标已有的同名文件一律保留目标内容（相同则跳过、不同则冲突），**绝不覆盖**；
 *   3. **逐项对照**：落盘前必须有一份清单，且只有清单里 state='copy' 的条目才可能被勾选写入；
 *      路径一律相对、由服务端把 rel 拼回目标根（客户端传绝对路径无效）。
 *
 * 与「记忆库迁移」的差别：知识库不取记忆库锁（目标不是记忆体，写它不该被记忆写入阻塞），
 * 取而代之的是**落盘前逐个再确认目标仍不存在**（existsSync）——等价于「不覆盖」的二次防护。
 *
 * @module work-personal-secretary/import
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { posix } from './install.js'
import {
  assertWritableDir,
  isMigrateNoise,
  normalizePath,
  resolveIo,
  sameFsPath,
  sha256Of,
} from './basedeck.js'

/** 清单条数上限：超过就截断（先列可补的，再列冲突，最后列已一致的），并在回执里说明 */
export const IMPORT_LIST_LIMIT = 500

/** 敏感扫描只读文件前这么多字节（大文件不整读，性能与内存都稳） */
export const IMPORT_TEXT_SCAN_BYTES = 64 * 1024

/**
 * 敏感模式（判据出自设计定稿 §12.1「不得出现个人路径、称呼姓名、凭据与密钥、客户/项目名称、业绩数字」）。
 * ⚠️ 命中**只标记、不拦截**：按决议 8 与 §12.1，命中条目不预勾选、由使用者自己确认后才写入。
 * 这里只回传**标签 + 行号**，不回传命中原文（少一份把敏感内容抄进回执的机会）。
 */
export const IMPORT_SENSITIVE_RULES = [
  { id: 'user-path', label: '用户目录绝对路径', re: /[A-Za-z]:[\\/]{1,2}Users[\\/][^\\/\s"'<>]+/ },
  { id: 'home-path', label: '家目录绝对路径', re: /(?:^|[\s"'(])\/(?:home|Users)\/[^/\s"'<>]+/ },
  {
    id: 'credential',
    label: '疑似凭据（密钥 / 口令 / 令牌）',
    re: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|password|passwd|bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{12,})/i,
  },
  { id: 'email', label: '电子邮箱', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: 'phone', label: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { id: 'id-card', label: '身份证号', re: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/ },
  { id: 'business-figure', label: '业绩 / 金额数字', re: /(?:业绩|营收|合同额|中标额|回款|毛利|利润|销售额)[^\n]{0,12}\d/ },
]

/** 四条可勾选性：copy 可写、same 无需写、conflict / occupied 一律保留目标（不可勾选） */
export const IMPORT_ITEM_STATES = ['copy', 'same', 'conflict', 'occupied']

/**
 * 清单排序优先级：**可补的排最前**（那是使用者唯一要做决定的一组），
 * 之后是冲突（要使用者看见「目标保留了、没覆盖」）、已一致、被占用。
 * ⚠️ 用对象查表而不用 `rank || 9`：copy 的 0 会被 `||` 吃掉。
 */
export const IMPORT_STATE_RANK = { copy: 0, conflict: 1, same: 2, occupied: 3 }

function statQuiet(p) {
  try { return statSync(p) } catch (e) { return null }
}

function errText(err) {
  return String(err && err.message ? err.message : err)
}

function emptyStats() {
  return { total: 0, copy: 0, same: 0, conflict: 0, occupied: 0, sensitive: 0, noise: 0, bytes: 0, listed: 0 }
}

/** 相对路径合法性：只接受源目录内的普通相对路径（拒绝盘符、绝对路径、.. 越界、空段） */
export function isSafeImportRel(rel) {
  const s = String(rel == null ? '' : rel)
  if (!s || s.length > 512) return false
  if (s.indexOf(':') >= 0) return false
  if (s[0] === '/' || s[0] === '\\') return false
  const parts = s.split('/')
  for (const p of parts) {
    if (!p || p === '.' || p === '..') return false
  }
  return true
}

/** a 是否等于 b 或在 b 之下（路径比较用：normalize + 正斜杠 + Windows 大小写不敏感） */
export function isPathInside(a, b) {
  const x = posix(normalizePath(a)).replace(/\/+$/, '')
  const y = posix(normalizePath(b)).replace(/\/+$/, '')
  if (!x || !y) return false
  const xn = process.platform === 'win32' ? x.toLowerCase() : x
  const yn = process.platform === 'win32' ? y.toLowerCase() : y
  return xn === yn || xn.indexOf(yn + '/') === 0
}

/**
 * 递归列源目录下的**普通文件**（相对路径一律 / 分隔）。
 * 只读；不跟随符号链接（可能是环，也可能指到库外）；运行时噪声（锁 / 备份 / 临时文件）只计数不列出。
 * @throws 读目录失败时抛可读错误，由调用方转成 ok:false
 */
export function walkImportFiles(root, rel = '', out = [], noise = []) {
  const dir = rel ? join(root, rel) : root
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error('读取源目录失败：' + posix(dir) + '（' + errText(err) + '）')
  }
  const byName = new Map()
  for (const e of entries) byName.set(e.name, e)
  const names = entries.map((e) => e.name).sort()
  for (const name of names) {
    const ent = byName.get(name)
    const childRel = rel ? rel + '/' + name : name
    if (isMigrateNoise(name)) { noise.push(childRel); continue }
    if (ent && typeof ent.isSymbolicLink === 'function' && ent.isSymbolicLink()) { noise.push(childRel); continue }
    if (ent && typeof ent.isDirectory === 'function' && ent.isDirectory()) {
      walkImportFiles(root, childRel, out, noise)
      continue
    }
    const st = statQuiet(join(root, childRel))
    if (st && st.isFile()) out.push({ rel: childRel, path: join(root, childRel), bytes: st.size })
  }
  return out
}

/** 读文件的文本前段（超过上限只读前段；含 NUL 视为二进制，返回空串 = 不做文本扫描） */
function textSampleOf(file) {
  try {
    const buf = readFileSync(file)
    const slice = buf.length > IMPORT_TEXT_SCAN_BYTES ? buf.subarray(0, IMPORT_TEXT_SCAN_BYTES) : buf
    for (let i = 0; i < slice.length; i++) if (slice[i] === 0) return ''
    return slice.toString('utf8')
  } catch (e) {
    return ''
  }
}

/**
 * 敏感模式检测（纯函数，便于单测）：返回最多 8 条去重后的 { id, label, line }。
 * 只给标签与行号，不给命中原文。
 */
export function detectSensitiveText(text) {
  const s = String(text == null ? '' : text)
  if (!s) return []
  const out = []
  const seen = {}
  for (const rule of IMPORT_SENSITIVE_RULES) {
    const flags = rule.re.flags.indexOf('g') >= 0 ? rule.re.flags : rule.re.flags + 'g'
    const re = new RegExp(rule.re.source, flags)
    let m = null
    let n = 0
    while ((m = re.exec(s)) !== null && n < 3) {
      const line = s.slice(0, m.index).split('\n').length
      const key = rule.id + ':' + line
      if (!seen[key]) {
        seen[key] = true
        out.push({ id: rule.id, label: rule.label, line: line })
      }
      n += 1
      if (m.index === re.lastIndex) re.lastIndex += 1
      if (out.length >= 8) return out
    }
  }
  return out
}

/**
 * 只读扫描 + 逐项对照（**绝不落盘**）。返回清单，供使用者勾选。
 *
 * 条目形状：`{ rel, bytes, state, sensitive: [{id,label,line}] }`
 *   state = copy     目标没有同名文件 → 可补（默认勾选）
 *           same     目标已有同名字节相同的文件 → 无需写（不可勾选）
 *           conflict 目标已有同名但内容不同的文件 → 保留目标（不可勾选）
 *           occupied 目标位置是目录 → 保留目标（不可勾选）
 * sensitive 非空的条目**不预勾选**（§12.1：先列出、由使用者确认后才写入）。
 *
 * @param {object} o
 * @param {string} o.from 旧知识库文件夹（绝对路径，只读）
 * @param {string} o.to   Obsidian 知识库目录（必须已存在，由一键配置建立）
 * @param {object} [o.env]
 * @returns {object} { ok, code, error, from, to, items, stats, truncated, message }
 */
export function scanImport(o = {}) {
  const src = typeof o.from === 'string' ? o.from.trim() : ''
  const dst = typeof o.to === 'string' ? o.to.trim() : ''
  const env = o.env || process.env
  const fail = (code, error) => ({
    ok: false, code: code, error: error, from: src, to: dst, items: [], stats: emptyStats(), truncated: false, message: '',
  })

  if (!src) return fail('bad-from', '请先选择要导入的旧知识库文件夹')
  if (!isAbsolute(normalizePath(src))) return fail('bad-from', '源目录必须是绝对路径：' + src)
  const srcStat = statQuiet(src)
  if (!srcStat || !srcStat.isDirectory()) return fail('bad-from', '源目录不存在或不是文件夹：' + posix(src))
  if (!dst) return fail('bad-to', '还没有知识库目录：请先完成上面的「保存配置并开始」，建立结构后再导入')
  const guard = assertWritableDir(dst, '知识库目录', env)
  if (!guard.ok) return fail('bad-to', guard.error)
  const dstStat = statQuiet(dst)
  if (!dstStat || !dstStat.isDirectory()) {
    return fail('bad-to', '知识库目录不存在：请先完成「保存配置并开始」建立结构，再回来导入（' + posix(dst) + '）')
  }
  if (sameFsPath(src, dst)) return fail('same-dir', '源目录与知识库目录是同一个，无需导入：' + posix(dst))
  if (isPathInside(src, dst) || isPathInside(dst, src)) {
    return fail('nested', '源目录与知识库目录互相包含（导入会写到自身）：' + posix(src) + ' ↔ ' + posix(dst))
  }

  const walked = []
  const noise = []
  try {
    walkImportFiles(src, '', walked, noise)
  } catch (err) {
    return fail('unreadable', errText(err) + '：已拒绝导入，未改动任何文件')
  }

  const items = []
  for (const f of walked) {
    const target = join(normalizePath(dst), f.rel)
    const st = statQuiet(target)
    if (st && st.isDirectory()) {
      items.push({ rel: f.rel, bytes: f.bytes, state: 'occupied', sensitive: [] })
      continue
    }
    if (st && st.isFile()) {
      const srcSha = sha256Of(f.path)
      if (srcSha && st.size === f.bytes && sha256Of(target) === srcSha) {
        items.push({ rel: f.rel, bytes: f.bytes, state: 'same', sensitive: [] })
      } else {
        items.push({ rel: f.rel, bytes: f.bytes, state: 'conflict', sensitive: [] })
      }
      continue
    }
    // 只有**将要写入**的缺失项才做敏感扫描（其余项不会落盘，扫了也没用）
    const sensitive = detectSensitiveText(textSampleOf(f.path))
    items.push({ rel: f.rel, bytes: f.bytes, state: 'copy', sensitive: sensitive })
  }

  // 排序：先列可补的（使用者要做决定的就是这些），再列冲突、已一致、被占用；组内按相对路径
  const rank = (state) => (typeof IMPORT_STATE_RANK[state] === 'number' ? IMPORT_STATE_RANK[state] : 9)
  items.sort((a, b) => {
    const d = rank(a.state) - rank(b.state)
    if (d !== 0) return d
    return a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0)
  })

  const stats = {
    total: items.length,
    copy: items.filter((x) => x.state === 'copy').length,
    same: items.filter((x) => x.state === 'same').length,
    conflict: items.filter((x) => x.state === 'conflict').length,
    occupied: items.filter((x) => x.state === 'occupied').length,
    sensitive: items.filter((x) => x.state === 'copy' && x.sensitive.length > 0).length,
    noise: noise.length,
    bytes: items.filter((x) => x.state === 'copy').reduce((acc, x) => acc + (x.bytes || 0), 0),
    listed: Math.min(items.length, IMPORT_LIST_LIMIT),
  }
  const truncated = items.length > IMPORT_LIST_LIMIT
  const listed = truncated ? items.slice(0, IMPORT_LIST_LIMIT) : items
  stats.listed = listed.length

  const message = stats.total === 0
    ? '源目录里没有可导入的文件（空目录，或只有运行时噪声文件）'
    : '源目录 ' + posix(src) + ' → 知识库 ' + posix(dst)
      + '：可补 ' + stats.copy + ' 个缺失文件（' + stats.bytes + ' 字节）'
      + '；已存在且一致 ' + stats.same + ' 个（跳过）'
      + '；同名但内容不同 ' + stats.conflict + ' 个（保留目标，不覆盖）'
      + (stats.occupied > 0 ? '；同名位置被目录占用 ' + stats.occupied + ' 个（保留目标）' : '')
      + (stats.sensitive > 0 ? '；其中 ' + stats.sensitive + ' 个命中敏感模式（未预勾选，需你确认）' : '')
      + (stats.noise > 0 ? '；运行时噪声 ' + stats.noise + ' 个（锁 / 备份 / 临时文件，不列出）' : '')
      + (truncated ? '；清单较长，只列前 ' + IMPORT_LIST_LIMIT + ' 项' : '')

  return {
    ok: true, code: 'ok', error: '',
    from: posix(src), to: posix(dst),
    items: listed, stats: stats, truncated: truncated, message: message,
    listLimit: IMPORT_LIST_LIMIT,
  }
}

/** 记录式建目录：从最上层逐个建（回滚时按空目录删，不误删使用者的原有目录） */
function ensureDirsTracked(dir, io, created) {
  const pending = []
  let cur = dir
  for (let i = 0; i < 64; i++) {
    if (!cur || existsSync(cur)) break
    pending.unshift(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  for (const p of pending) {
    io.mkdirSync(p, { recursive: true })
    created.push(p)
  }
}

/**
 * 按勾选落盘（**只补缺失、绝不覆盖**；dryRun 默认 true）。
 *
 * 安全口径：
 *   - rels 必须来自刚扫出的清单，且只有 state='copy' 的条目会被写入；其余进 rejected（不写、可读回执）；
 *   - 路径一律相对：含盘符 / 绝对 / `..` / 空段的一律 rejected（不拼路径）；
 *   - 落盘前**逐个再确认目标仍不存在**（扫描后有人新建了同名文件 → 跳过，保留对方内容）；
 *   - 写后逐文件校验大小 + SHA256，任一不符即回滚本轮复制（删除新文件与本轮新建目录）。
 *
 * @param {object} o
 * @param {string} o.from
 * @param {string} o.to
 * @param {string[]} o.rels 勾选条目的相对路径
 * @param {boolean} [o.dryRun] 默认 true
 * @param {object} [o.env]
 * @param {object} [o.io] 可注入 IO（测试用）
 */
export function applyImport(o = {}) {
  const io = resolveIo({ io: o.io })
  const dryRun = o.dryRun !== false
  const scan = scanImport({ from: o.from, to: o.to, env: o.env })
  const base = {
    dryRun: dryRun, from: scan.from || '', to: scan.to || '',
    planned: [], copied: [], skipped: [], rejected: [], bytesWritten: 0,
  }
  if (!scan.ok) {
    return Object.assign({}, base, { ok: false, code: scan.code, error: scan.error })
  }
  if (!Array.isArray(o.rels)) {
    return Object.assign({}, base, { ok: false, code: 'bad-rels', error: 'rels 必须是字符串数组（勾选条目的相对路径）' })
  }

  const byRel = new Map()
  for (const it of scan.items) byRel.set(it.rel, it)

  const want = []
  const rejected = []
  const seen = {}
  for (const raw of o.rels) {
    const rel = typeof raw === 'string' ? raw.trim().replace(/\\/g, '/') : ''
    if (!rel) { rejected.push({ rel: String(raw == null ? '' : raw), reason: 'empty' }); continue }
    if (seen[rel]) continue
    seen[rel] = true
    if (!isSafeImportRel(rel)) { rejected.push({ rel: rel, reason: 'bad-path' }); continue }
    const it = byRel.get(rel)
    if (!it) { rejected.push({ rel: rel, reason: 'not-in-list' }); continue }
    if (it.state !== 'copy') { rejected.push({ rel: rel, reason: it.state }); continue }
    want.push(it)
  }

  const srcDir = normalizePath(scan.from)
  const toDir = normalizePath(scan.to)
  const planned = want.map((it) => ({
    rel: it.rel, from: posix(join(srcDir, it.rel)), to: posix(join(toDir, it.rel)), bytes: it.bytes,
  }))

  if (want.length === 0) {
    return Object.assign({}, base, {
      ok: true, code: 'nothing-to-copy',
      rejected: rejected,
      detail: scan.stats.copy === 0
        ? '没有可补的文件：目标已有的同名文件一律保留，不覆盖'
        : '勾选的条目里没有「缺失可补」的文件（已存在 / 冲突 / 被占用的条目一律保留目标，不覆盖）',
    })
  }

  const bytesTotal = want.reduce((acc, x) => acc + (x.bytes || 0), 0)
  if (dryRun) {
    return Object.assign({}, base, {
      ok: true, code: 'ok',
      planned: planned,
      rejected: rejected,
      detail: '干跑：未写盘（将补 ' + want.length + ' 个文件，共 ' + bytesTotal + ' 字节；同名已存在的一律不覆盖）',
    })
  }

  const wroteGuard = assertWritableDir(toDir, '知识库目录', o.env)
  if (!wroteGuard.ok) {
    return Object.assign({}, base, { ok: false, code: 'bad-to', error: '已拒绝写入：' + wroteGuard.error })
  }

  // 落盘前逐个再确认：扫描之后目标若出现同名文件，本轮一律跳过（绝不覆盖）
  const skipped = []
  const todo = []
  for (const it of want) {
    const target = join(toDir, it.rel)
    if (existsSync(target)) { skipped.push({ rel: it.rel, reason: 'exists' }); continue }
    todo.push(it)
  }
  if (todo.length === 0) {
    return Object.assign({}, base, {
      ok: true, code: 'nothing-to-copy', skipped: skipped, rejected: rejected,
      detail: '目标已出现同名文件，本轮未写入任何文件（同名一律保留目标，不覆盖）',
    })
  }

  const createdDirs = []
  const copied = []
  const rollbackAll = () => {
    for (const rec of copied.slice().reverse()) {
      try { io.rmSync(rec.to, { force: true }) } catch (e) { /* best-effort */ }
    }
    for (const d of createdDirs.slice().reverse()) {
      // 只删本轮**新建**的目录（里面的文件已在上一步删掉）；fs.rmSync 对目录必须带 recursive
      try { io.rmSync(d, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
    }
  }

  for (const it of todo) {
    const from = join(srcDir, it.rel)
    const target = join(toDir, it.rel)
    const sha = sha256Of(from)
    try {
      ensureDirsTracked(dirname(target), io, createdDirs)
      io.copyFileSync(from, target)
      copied.push({ rel: it.rel, to: target, bytes: it.bytes, sha256: sha })
    } catch (err) {
      rollbackAll()
      return Object.assign({}, base, {
        ok: false, code: 'copy-failed',
        error: '复制失败（已回滚本轮已复制的文件，源目录未改动）：' + posix(it.rel) + '（' + errText(err) + '）',
      })
    }
  }

  // 写后校验：大小 + SHA256 必须与源一致
  for (const rec of copied) {
    const st = statQuiet(rec.to)
    if (!st || !st.isFile() || st.size !== rec.bytes) {
      rollbackAll()
      return Object.assign({}, base, { ok: false, code: 'verify-failed', error: '复制后大小不一致（已回滚）：' + posix(rec.to) })
    }
    if (rec.sha256 && sha256Of(rec.to) !== rec.sha256) {
      rollbackAll()
      return Object.assign({}, base, { ok: false, code: 'verify-failed', error: '复制后 SHA256 不一致（已回滚）：' + posix(rec.to) })
    }
  }

  return Object.assign({}, base, {
    ok: true, code: 'ok',
    planned: planned,
    copied: copied.map((x) => ({ rel: x.rel, to: posix(x.to), bytes: x.bytes })),
    skipped: skipped,
    rejected: rejected,
    bytesWritten: bytesTotal,
    detail: '已补 ' + copied.length + ' 个文件（' + bytesTotal + ' 字节）到 ' + posix(toDir)
      + '；写后大小 + SHA256 校验通过'
      + (skipped.length > 0 ? '；落盘前发现 ' + skipped.length + ' 个同名文件已出现，跳过未覆盖' : '')
      + (rejected.length > 0 ? '；' + rejected.length + ' 个勾选项不可写已忽略' : '')
      + '；源目录只读，全程未改动',
  })
}
