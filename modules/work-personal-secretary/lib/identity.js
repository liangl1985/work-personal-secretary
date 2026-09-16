/**
 * work-personal-secretary —— 身份写入模块（「使用者身份」条目的整条改写）
 *
 * 背景（设计定稿 §6.4）：助手侧工具只有 memory_remember / memory_recall / memory_link，
 * **没有「按 id 改写条目」的工具**；7 个 memory_* 斜杠命令属运维动作，也不能编辑正文。
 * 所以「改写某一条」只能由集成体自己实现 —— 本文件就是那一块。
 *
 * 规则（设计定稿 §9）：
 *   1. 目标 = <记忆库目录>/MEMORY.md 里**唯一**一条正文以「使用者身份：」起头的条目；
 *   2. 命中 1 条 → 整条改写（保留原 id、日期更新为当天、tag=关键）；
 *   3. 命中 0 条 → 追加；命中 >1 条 → **拒绝**并报可读错误（绝不猜哪一条）；
 *   4. 与 dsh-work-memory **共用同一把目录锁** .work-memory.lock（实现只有一份，在 basedeck.js，
 *      本文件 re-export 同名导出；同步版 + 异步版，异步版等待时让出事件循环）；
 *   5. 写前备份 → 同目录临时文件 + rename → 写后校验 → 任一失败回滚；
 *   6. **dryRun 默认 true**：只有显式 dryRun:false 才落盘。
 *
 * 1.1.3 返工（R1-1）：**不再全量序列化**。定位目标条目的**区间**后只替换该区间，其余字节
 * 原样保留（含既有条目的首尾空白、文件尾随空白、CRLF 行尾）；写后校验按「目标区间以外的
 * 字节与写前完全相同」逐字节比对 —— 原来「parse 一遍再 serialize」的口径会静默规范化
 * 既有条目（例如吞掉尾随空格），使 othersUntouched 恒真。
 *
 * 发布件中立：本文件不含任何使用者信息、本机路径与凭据。
 *
 * @module work-personal-secretary/identity
 */

import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { IDENTITY_PREFIX, DOMAIN_MAX_CHARS, normalizeDomainText } from './domain.js'
import {
  LOCK_BUSY_MESSAGE,
  appendEntriesText,
  assertWritableDir,
  atomicWriteText,
  backupFile,
  readFileStrict,
  resolveIo,
  stamp,
  withMemoryDirLock,
  withMemoryDirLockAsync,
} from './basedeck.js'

// 锁实现只有一份（basedeck.js）；这里保持同名导出，调用方与既有测试不受影响。
export { LOCK_BUSY_MESSAGE, withMemoryDirLock, withMemoryDirLockAsync }

/** 条目分隔符（与 dsh-work-memory 的 store.js 一致） */
export const ENTRY_DELIMITER = '\n§\n'

/** 身份条目的 tag（设计定稿 §9：tag=关键） */
export const IDENTITY_TAG = '关键'

/** 助手人设条目的标记词（本模块**绝不改动**含它的条目） */
export const PERSONA_MARK = '助手人设'

/**
 * 条目分隔符的**宽松**形态：`\r?\n[ \t]*§[ \t]*\r?\n`。
 * 兼容 CRLF 行尾与「空行包裹」的分隔写法；只用于**切区间**，替换时原样保留，不会改写它们。
 */
const RE_ENTRY_SEP = /\r?\n[ \t]*§[ \t]*\r?\n/g

/** 条目头部元数据（[id:…] / [YYYY-MM-DD…] / [branch:…] / [tag:…] 连续出现） */
const RE_ENTRY_META = /^(?:\[id:[^\]]*\]\s*|\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*|\[branch:[^\]]*\]\s*|\[tag:[^\]]*\]\s*)+/

/** 路径统一正斜杠（只用于回显，不用于文件操作） */
function posix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/')
}

/** 末段空白长度（尾随空格 / 制表 / 换行） */
function trailingWsLen(s) {
  const m = /[ \t\r\n]*$/.exec(String(s == null ? '' : s))
  return m ? m[0].length : 0
}

/**
 * 按分隔符切出**条目区间**（保留原文，区间之间是分隔符本身）。
 * @param {string} text
 * @returns {{start:number, end:number}[]}
 */
export function splitEntryRanges(text) {
  const src = String(text == null ? '' : text)
  const re = new RegExp(RE_ENTRY_SEP.source, 'g')
  const ranges = []
  let cursor = 0
  let m
  while ((m = re.exec(src)) !== null) {
    ranges.push({ start: cursor, end: m.index })
    cursor = m.index + m[0].length
  }
  ranges.push({ start: cursor, end: src.length })
  return ranges
}

/**
 * 拆条目（保持既有签名与语义：trim 掉首尾空白的正文数组）。
 * @param {string} text
 * @returns {string[]}
 */
export function parseEntries(text) {
  const src = String(text == null ? '' : text)
  return splitEntryRanges(src).map((r) => src.slice(r.start, r.end).trim()).filter((e) => e.length > 0)
}

/** 拼回文件文本（结尾一个换行）——保留导出以兼容既有调用；写盘路径已不再使用它 */
export function serializeEntries(entries) {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

/** 去掉条目头部的元数据标记，得到正文 */
export function entryBody(entry) {
  return String(entry == null ? '' : entry).replace(RE_ENTRY_META, '')
}

/** 取条目 id（拿不到返回空串） */
export function entryIdOf(entry) {
  const m = /^\[id:([^\]]+)\]/.exec(String(entry == null ? '' : entry))
  return m ? m[1] : ''
}

/** 生成条目 id（12 位 hex，与 work-memory 的 genEntryId 同款） */
export function genIdentityId() {
  return createHash('sha256').update(randomUUID()).digest('hex').slice(0, 12)
}

/** 本地日期 YYYY-MM-DD（日界 = 本地 00:00，与 work-memory 的 clock 口径一致） */
export function todayStamp(date) {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** 定位命中「使用者身份：」前缀的条目下标（传入已拆分的条目数组） */
export function locateIdentity(entries) {
  const hits = []
  const list = Array.isArray(entries) ? entries : []
  for (let i = 0; i < list.length; i++) {
    if (entryBody(list[i]).indexOf(IDENTITY_PREFIX) === 0) hits.push(i)
  }
  return hits
}

/**
 * 在原文里定位命中前缀的**条目区间**（下标 + 字节区间）。
 * @param {string} text
 * @returns {{index:number, start:number, end:number, text:string}[]}
 */
export function locateIdentityRanges(text) {
  const src = String(text == null ? '' : text)
  const out = []
  const ranges = splitEntryRanges(src)
  for (let i = 0; i < ranges.length; i++) {
    const seg = src.slice(ranges[i].start, ranges[i].end)
    if (seg.trim() === '') continue
    if (entryBody(seg.trim()).indexOf(IDENTITY_PREFIX) === 0) {
      out.push({ index: i, start: ranges[i].start, end: ranges[i].end, text: seg })
    }
  }
  return out
}

/**
 * 拼一条身份条目：保留原 id（可空则新生成）、日期换当天、tag=关键。
 * @returns {string}
 */
export function makeIdentityEntry(content, options = {}) {
  const id = options.id || genIdentityId()
  const date = options.date || todayStamp(options.now)
  return '[id:' + id + '] [' + date + '] [tag:' + IDENTITY_TAG + '] ' + IDENTITY_PREFIX + content
}

// ───────────────────── 读 / 写 ─────────────────────

/** 由记忆库目录解析 MEMORY.md 路径（显式 memoryFile 优先） */
export function resolveMemoryFile(options = {}) {
  const explicit = typeof options.memoryFile === 'string' ? options.memoryFile.trim() : ''
  if (explicit) return explicit
  const dir = typeof options.memoryDir === 'string' ? options.memoryDir.trim() : ''
  return dir ? join(dir, 'MEMORY.md') : ''
}

/** 只读：当前身份条目的状态与正文（不写盘、不加锁） */
export function readIdentity(options = {}) {
  const memoryFile = resolveMemoryFile(options)
  if (!memoryFile) {
    return {
      ok: false, exists: false, count: 0, content: '', entry: '', entryId: '', memoryFile: '', prefix: IDENTITY_PREFIX,
      message: '没有可用的记忆库目录：请先在「核心配置」里填写记忆库目录',
    }
  }
  const strict = readFileStrict(memoryFile)
  if (strict.exists && !strict.readable) {
    return {
      ok: false, exists: true, readable: false, count: 0, content: '', entry: '', entryId: '',
      memoryFile: posix(memoryFile), prefix: IDENTITY_PREFIX, code: strict.code,
      message: 'MEMORY.md 存在但读不到（' + (strict.code || 'EACCES') + '）：请检查文件权限或占用后重试',
    }
  }
  if (!strict.exists) {
    return {
      ok: true, exists: false, count: 0, content: '', entry: '', entryId: '', memoryFile: posix(memoryFile), prefix: IDENTITY_PREFIX,
      message: '记忆库里还没有 MEMORY.md：保存时会新建并追加「使用者身份」条目',
    }
  }
  const hits = locateIdentityRanges(strict.text)
  const count = hits.length
  const one = count === 1 ? hits[0] : null
  const message = count > 1
    ? '记忆库里有 ' + count + ' 条以「' + IDENTITY_PREFIX + '」开头的条目，写入会被拒绝；请先手工合并为一条'
    : (count === 1 ? '已定位到唯一身份条目（id=' + (entryIdOf(one.text.trim()) || '?') + '）' : '暂无身份条目：保存时会追加一条')
  return {
    ok: true, exists: true, count: count,
    content: one ? entryBody(one.text.trim()).slice(IDENTITY_PREFIX.length) : '',
    entry: one ? one.text.trim() : '', entryId: one ? entryIdOf(one.text.trim()) : '',
    memoryFile: posix(memoryFile), prefix: IDENTITY_PREFIX, bom: strict.bom, entries: splitEntryRanges(strict.text).length, message: message,
  }
}

/** 回滚：有备份则复制回去；原本没有文件则删掉刚写的 */
function rollbackWrite(file, backup, io, hadFile) {
  try {
    if (backup) io.copyFileSync(backup, file)
    else if (!hadFile) io.rmSync(file, { force: true })
  } catch (e) { /* best-effort */ }
}

/**
 * 构造一次写入的执行器（applyIdentity 与 applyIdentityAsync 共用，逻辑只有一份）。
 * @returns {(write:boolean) => object}
 */
function buildIdentityRunner(options, base, io, memoryFile, content, now) {
  return function run(write) {
    const strict = readFileStrict(memoryFile)
    if (strict.exists && !strict.readable) {
      return Object.assign(base, {
        detail: 'MEMORY.md 存在但读不到（' + (strict.code || 'EACCES') + '）：已拒绝写入，未改动任何文件；请检查文件权限或占用后重试',
      })
    }
    const text = strict.readable ? strict.text : ''
    if (strict.readable && strict.bom) {
      return Object.assign(base, { detail: 'MEMORY.md 带 ' + strict.bom + ' BOM，已拒绝写入；请先另存为 UTF-8 无 BOM' })
    }
    const ranges = splitEntryRanges(text)
    const segments = ranges.map((r) => text.slice(r.start, r.end))
    const hits = []
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].trim() === '') continue
      if (entryBody(segments[i].trim()).indexOf(IDENTITY_PREFIX) === 0) hits.push(i)
    }
    if (hits.length > 1) {
      return Object.assign(base, {
        count: hits.length,
        detail: '记忆库里有 ' + hits.length + ' 条以「' + IDENTITY_PREFIX + '」开头的条目，无法确定改哪一条，已拒绝写入；请先手工合并为一条后重试',
      })
    }

    const hadFile = strict.exists
    const rewrite = hits.length === 1
    const idx = rewrite ? hits[0] : segments.length
    const beforeSeg = rewrite ? segments[idx] : ''
    const id = rewrite ? (entryIdOf(beforeSeg.trim()) || options.id || '') : (options.id || '')
    const entryAfter = makeIdentityEntry(content, { id: id || undefined, now: now })

    // ── 只做**切片替换**，绝不重新序列化整个文件 ──
    let next = ''
    let coreStart = 0
    let coreEnd = text.length
    let inserted = entryAfter
    if (rewrite) {
      const r = ranges[idx]
      const seg = segments[idx]
      const lead = seg.length - seg.replace(/^[ \t\r\n]*/, '').length
      const trail = trailingWsLen(seg)
      coreStart = r.start + lead
      coreEnd = r.end - trail
      if (coreEnd < coreStart) { coreStart = r.start; coreEnd = r.end }
      inserted = entryAfter
      next = text.slice(0, coreStart) + inserted + text.slice(coreEnd)
    } else {
      // 追加：插入点是「原文去掉尾随空白」处；插入内容含分隔符（空文件则不带分隔符）
      const cut = text.length - trailingWsLen(text)
      const head = text.slice(0, cut)
      if (head.trim() === '') {
        inserted = entryAfter + '\n'
        coreStart = 0
        coreEnd = 0
      } else {
        // 必须用**本文件**的常量：ENTRY_SEP 只定义在 basedeck.js（两者同为 '\n§\n'）。
        // 这里原来写成 ENTRY_SEP → 「库里已有内容但没有『使用者身份』条目」时直接抛
        // ReferenceError（链里没暴露：memoryDeck 会先写占位条目，走的永远是改写分支）。
        // 值也必须与 appendEntriesText 插入的完全一致（head + ENTRY_SEP + add + tail），
        // 否则写后「目标区间以外逐字节未变」的校验会误判。
        inserted = ENTRY_DELIMITER + entryAfter
        coreStart = cut
        coreEnd = cut
      }
      next = appendEntriesText(text, [entryAfter])
    }

    const bytes = Buffer.byteLength(next, 'utf8')
    const plannedBackup = hadFile ? memoryFile + '.bak-' + stamp(now) : ''
    const plan = {
      count: hits.length,
      status: rewrite ? 'rewrite' : 'append',
      action: rewrite ? '将整条改写「使用者身份」条目（保留原 id，日期更新为当天，tag=关键）' : '将追加一条「使用者身份」条目',
      entryId: entryIdOf(entryAfter),
      entryBefore: beforeSeg.trim(),
      entryAfter: entryAfter,
      plannedBackup: plannedBackup ? posix(plannedBackup) : '',
      wouldWriteBytes: bytes,
      entriesBefore: segments.filter((s) => s.trim() !== '').length,
      entriesAfter: segments.filter((s) => s.trim() !== '').length + (rewrite ? 0 : 1),
    }

    if (!write) {
      const how = rewrite
        ? '干跑：未写盘（将改写第 ' + (idx + 1) + ' 个条目区间，区间外 ' + (text.length - (coreEnd - coreStart)) + ' 字节逐字保留，预计 ' + bytes + ' 字节'
        : '干跑：未写盘（将追加 1 条，原文 ' + text.length + ' 字节逐字保留，预计 ' + bytes + ' 字节'
      const bak = plannedBackup ? '，写前备份到 ' + posix(plannedBackup) : '，文件原本不存在无需备份'
      return Object.assign(base, plan, { ok: true, detail: how + bak + '）' })
    }

    let backup = ''
    try {
      io.mkdirSync(dirname(memoryFile), { recursive: true })
      backup = backupFile(memoryFile, io, now)
    } catch (err) {
      return Object.assign(base, plan, { ok: false, detail: '写前备份失败，已放弃写入：' + String(err && err.message ? err.message : err) })
    }
    try {
      atomicWriteText(memoryFile, next, io)
    } catch (err) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写入失败（已回滚）：' + String(err && err.message ? err.message : err) })
    }

    const verifyStrict = readFileStrict(memoryFile)
    if (!verifyStrict.readable || verifyStrict.bom) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写后校验失败（已回滚）：文件读不到或带 BOM' })
    }
    const after = verifyStrict.text
    // ① 逐字节全等：写出的就是构造好的文本
    if (after !== next) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), othersUntouched: false, detail: '写后校验失败：文件内容与预期不一致（已回滚）' })
    }
    // ② 标签区间以外的字节与写前完全相同（独立证据，不依赖 ① 的构造假设）
    const prefixBefore = text.slice(0, coreStart)
    const suffixBefore = text.slice(coreEnd)
    const prefixAfter = after.slice(0, coreStart)
    const suffixAfter = after.slice(coreStart + inserted.length)
    if (prefixAfter !== prefixBefore || suffixAfter !== suffixBefore) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), othersUntouched: false, detail: '写后校验失败：目标区间以外的字节发生变化（已回滚）' })
    }
    // ③ 含「助手人设」的条目逐字节未变（目标区间之外的独立复核）
    const personaBefore = text.slice(0, coreStart) + text.slice(coreEnd)
    const personaAfterBody = after.slice(0, coreStart) + after.slice(coreStart + inserted.length)
    if (personaBefore.indexOf(PERSONA_MARK) >= 0 && personaAfterBody.indexOf(PERSONA_MARK) < 0) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), personaUntouched: false, detail: '写后校验失败：含「' + PERSONA_MARK + '」的条目被改动（已回滚）' })
    }

    const otherBytes = text.length - (coreEnd - coreStart)
    return Object.assign(base, plan, {
      ok: true,
      backup: backup ? posix(backup) : '',
      bytesWritten: bytes,
      wroteAny: true,
      personaUntouched: true,
      othersUntouched: true,
      detail: (rewrite ? '已整条改写身份条目' : '已追加身份条目') + '（' + bytes + ' 字节；区间外 ' + otherBytes + ' 字节逐字未变，含「' + PERSONA_MARK + '」的条目未动）'
        + (backup ? '，备份 ' + posix(backup) : ''),
    })
  }
}

function identityBase(dryRun, target) {
  return {
    ok: false, dryRun: dryRun, action: 'none', status: 'blocked', target: target,
    prefix: IDENTITY_PREFIX, count: 0, entryId: '', entryBefore: '', entryAfter: '',
    plannedBackup: '', backup: '', wouldWriteBytes: 0, bytesWritten: 0, wroteAny: false,
    entriesBefore: 0, entriesAfter: 0, personaUntouched: null, othersUntouched: null, detail: '',
  }
}

/** 入参预检：返回 { ok, memoryFile, io, content, base } 或 { ok:false, base } */
function prepareIdentity(options) {
  const dryRun = options.dryRun !== false
  const memoryFile = resolveMemoryFile(options)
  const target = memoryFile ? posix(memoryFile) : ''
  const base = identityBase(dryRun, target)
  if (!memoryFile) {
    return { ok: false, base: Object.assign(base, { detail: '没有可用的记忆库目录：请先在「核心配置」里填写记忆库目录' }) }
  }
  const content = normalizeDomainText(options.content, DOMAIN_MAX_CHARS)
  if (!content) {
    return { ok: false, base: Object.assign(base, { detail: '岗位正文为空：请先选择预置岗位、填写内容或点「自动生成」，再保存' }) }
  }
  return { ok: true, dryRun: dryRun, memoryFile: memoryFile, content: content, io: resolveIo(options), base: base }
}

/**
 * 身份写入（**同步版**，dryRun 默认 true）。供同步上下文与测试使用；
 * 宿主请求路径请用 applyIdentityAsync（等待锁时让出事件循环）。
 * @param {object} options { memoryFile|memoryDir, content, now, dryRun, io, id, env }
 * @returns {object}
 */
export function applyIdentity(options = {}) {
  const prep = prepareIdentity(options)
  if (!prep.ok) return prep.base
  const run = buildIdentityRunner(options, prep.base, prep.io, prep.memoryFile, prep.content, options.now)
  if (prep.dryRun) return run(false)
  // 护栏放在**取锁之前**：被拒的目标目录不该被创建锁文件（与「可用性检查」同口径）
  const guard = assertWritableDir(options.memoryDir || dirname(prep.memoryFile), '记忆库目录', options.env || process.env)
  if (!guard.ok) return Object.assign(prep.base, { detail: '已拒绝写入：' + guard.error })
  try {
    return withMemoryDirLock(dirname(prep.memoryFile), () => run(true))
  } catch (err) {
    return Object.assign(prep.base, { detail: '写入未执行（未改动任何文件）：' + String(err && err.message ? err.message : err) })
  }
}

/**
 * 身份写入（**异步版**）：与同步版同一份逻辑，只是等待锁时 await 让出事件循环。
 * @returns {Promise<object>}
 */
export async function applyIdentityAsync(options = {}) {
  const prep = prepareIdentity(options)
  if (!prep.ok) return prep.base
  const run = buildIdentityRunner(options, prep.base, prep.io, prep.memoryFile, prep.content, options.now)
  if (prep.dryRun) return run(false)
  const guard = assertWritableDir(options.memoryDir || dirname(prep.memoryFile), '记忆库目录', options.env || process.env)
  if (!guard.ok) return Object.assign(prep.base, { detail: '已拒绝写入：' + guard.error })
  try {
    return await withMemoryDirLockAsync(dirname(prep.memoryFile), () => run(true))
  } catch (err) {
    return Object.assign(prep.base, { detail: '写入未执行（未改动任何文件）：' + String(err && err.message ? err.message : err) })
  }
}
