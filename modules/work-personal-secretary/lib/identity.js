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
 *   4. 与 dsh-work-memory **共用同一把目录锁** .work-memory.lock（锁实现抄自
 *      dsh-work-memory/lib/store.js 的 withDirLock：同进程重入计数 + 陈旧锁清理 + 5s 超时）；
 *   5. 写前备份 → 同目录临时文件 + rename → 写后校验（其余条目逐字未变、含「助手人设」的条目逐字未变）
 *      → 任一失败回滚；
 *   6. **dryRun 默认 true**：只有显式 dryRun:false 才落盘。
 *
 * 发布件中立：本文件不含任何使用者信息、本机路径与凭据。
 *
 * @module work-personal-secretary/identity
 */

import { closeSync, mkdirSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { IDENTITY_PREFIX, DOMAIN_MAX_CHARS, normalizeDomainText } from './domain.js'
import { atomicWriteText, backupFile, readFileRaw, resolveIo, stamp } from './basedeck.js'

/** 条目分隔符（与 dsh-work-memory 的 store.js 一致） */
export const ENTRY_DELIMITER = '\n§\n'

/** 身份条目的 tag（设计定稿 §9：tag=关键） */
export const IDENTITY_TAG = '关键'

/** 助手人设条目的标记词（本模块**绝不改动**含它的条目） */
export const PERSONA_MARK = '助手人设'

/** 条目头部元数据（[id:…] / [YYYY-MM-DD…] / [branch:…] / [tag:…] 连续出现） */
const RE_ENTRY_META = /^(?:\[id:[^\]]*\]\s*|\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*|\[branch:[^\]]*\]\s*|\[tag:[^\]]*\]\s*)+/

/** 路径统一正斜杠（只用于回显，不用于文件操作） */
function posix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/')
}

/**
 * 拆条目 / 拼条目（与 work-memory 的口径一致）。
 * @param {string} text
 * @returns {string[]}
 */
export function parseEntries(text) {
  return String(text == null ? '' : text).split(ENTRY_DELIMITER).map((e) => e.trim()).filter((e) => e.length > 0)
}

/** 拼回文件文本（结尾一个换行，与 work-memory 的 serializeEntries 一致） */
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

/** 定位命中「使用者身份：」前缀的条目下标 */
export function locateIdentity(entries) {
  const hits = []
  const list = Array.isArray(entries) ? entries : []
  for (let i = 0; i < list.length; i++) {
    if (entryBody(list[i]).indexOf(IDENTITY_PREFIX) === 0) hits.push(i)
  }
  return hits
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

// ───────────────────── 目录锁（抄自 dsh-work-memory/lib/store.js 的 withDirLock） ─────────────────────

const STALE_LOCK_MS = 10 * 1000
const LOCK_TIMEOUT_MS = 5 * 1000
const LOCK_RETRY_MS = 25

/** 同进程重入计数：外层已持锁时，内层调用直接复用（不再抢同一把文件锁） */
const heldLocks = new Map()

/** 与 dsh-work-memory 共用 <记忆库目录>/.work-memory.lock */
export function withMemoryDirLock(dir, fn) {
  const key = String(dir)
  const depth = heldLocks.get(key) || 0
  if (depth > 0) {
    heldLocks.set(key, depth + 1)
    try {
      return fn()
    } finally {
      const next = (heldLocks.get(key) || 1) - 1
      if (next <= 0) heldLocks.delete(key)
      else heldLocks.set(key, next)
    }
  }
  mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, '.work-memory.lock')
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let acquired = false
  while (!acquired) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, String(process.pid), 'utf8')
      closeSync(fd)
      acquired = true
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true })
          continue
        }
      } catch (e) {
        continue
      }
      if (Date.now() > deadline) throw new Error('work-memory: lock timeout')
      const t = Date.now()
      while (Date.now() - t < LOCK_RETRY_MS) { /* spin */ }
    }
  }
  heldLocks.set(key, 1)
  try {
    return fn()
  } finally {
    heldLocks.delete(key)
    try { rmSync(lockPath, { force: true }) } catch (e) { /* best-effort */ }
  }
}

// ───────────────────── 读 / 计划 / 写 ─────────────────────

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
  const raw = readFileRaw(memoryFile)
  if (!raw) {
    return {
      ok: true, exists: false, count: 0, content: '', entry: '', entryId: '', memoryFile: posix(memoryFile), prefix: IDENTITY_PREFIX,
      message: '记忆库里还没有 MEMORY.md：保存时会新建并追加「使用者身份」条目',
    }
  }
  const entries = parseEntries(raw.text)
  const hits = locateIdentity(entries)
  const idx = hits.length === 1 ? hits[0] : -1
  const entry = idx >= 0 ? entries[idx] : ''
  const message = hits.length > 1
    ? '记忆库里有 ' + hits.length + ' 条以「' + IDENTITY_PREFIX + '」开头的条目，写入会被拒绝；请先手工合并为一条'
    : (idx >= 0 ? '已定位到唯一身份条目（id=' + (entryIdOf(entry) || '?') + '）' : '暂无身份条目：保存时会追加一条')
  return {
    ok: true, exists: true, count: hits.length,
    content: idx >= 0 ? entryBody(entry).slice(IDENTITY_PREFIX.length) : '',
    entry: entry, entryId: idx >= 0 ? entryIdOf(entry) : '',
    memoryFile: posix(memoryFile), prefix: IDENTITY_PREFIX, bom: raw.bom, entries: entries.length, message: message,
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
 * 身份写入的**唯一实现**（dryRun 默认 true）。
 * @param {object} options { memoryFile|memoryDir, content, now, dryRun, io, id }
 * @returns {object}
 */
export function applyIdentity(options = {}) {
  const dryRun = options.dryRun !== false
  const memoryFile = resolveMemoryFile(options)
  const io = resolveIo(options)
  const now = options.now
  const content = normalizeDomainText(options.content, DOMAIN_MAX_CHARS)
  const target = memoryFile ? posix(memoryFile) : ''
  const base = {
    ok: false, dryRun: dryRun, action: 'none', status: 'blocked', target: target,
    prefix: IDENTITY_PREFIX, count: 0, entryId: '', entryBefore: '', entryAfter: '',
    plannedBackup: '', backup: '', wouldWriteBytes: 0, bytesWritten: 0, wroteAny: false,
    entriesBefore: 0, entriesAfter: 0, personaUntouched: null, othersUntouched: null, detail: '',
  }
  if (!memoryFile) {
    return Object.assign(base, { detail: '没有可用的记忆库目录：请先在「核心配置」里填写记忆库目录' })
  }
  if (!content) {
    return Object.assign(base, { detail: '岗位正文为空：请先选择预置岗位、填写内容或点「自动生成」，再保存' })
  }

  const run = (write) => {
    const raw = readFileRaw(memoryFile)
    const text = raw ? raw.text : ''
    if (raw && raw.bom) {
      return Object.assign(base, { detail: 'MEMORY.md 带 ' + raw.bom + ' BOM，已拒绝写入；请先另存为 UTF-8 无 BOM' })
    }
    const entries = parseEntries(text)
    if (raw && text.trim() !== '' && entries.length === 0) {
      return Object.assign(base, { detail: 'MEMORY.md 存在但读不出任何条目，已拒绝写入（避免覆盖你的记忆库）' })
    }
    const hits = locateIdentity(entries)
    if (hits.length > 1) {
      return Object.assign(base, {
        count: hits.length,
        detail: '记忆库里有 ' + hits.length + ' 条以「' + IDENTITY_PREFIX + '」开头的条目，无法确定改哪一条，已拒绝写入；请先手工合并为一条后重试',
      })
    }
    const hadFile = Boolean(raw)
    const rewrite = hits.length === 1
    const idx = rewrite ? hits[0] : entries.length
    const before = rewrite ? entries[idx] : ''
    const id = rewrite ? (entryIdOf(before) || options.id || '') : (options.id || '')
    const entryAfter = makeIdentityEntry(content, { id: id || undefined, now: now })
    const next = entries.slice()
    if (rewrite) next[idx] = entryAfter
    else next.push(entryAfter)
    const body = serializeEntries(next)
    const bytes = Buffer.byteLength(body, 'utf8')
    const plannedBackup = hadFile ? memoryFile + '.bak-' + stamp(now) : ''

    const plan = {
      count: hits.length,
      status: rewrite ? 'rewrite' : 'append',
      action: rewrite ? '将整条改写「使用者身份」条目（保留原 id，日期更新为当天，tag=关键）' : '将追加一条「使用者身份」条目',
      entryId: entryIdOf(entryAfter),
      entryBefore: before,
      entryAfter: entryAfter,
      plannedBackup: plannedBackup ? posix(plannedBackup) : '',
      wouldWriteBytes: bytes,
      entriesBefore: entries.length,
      entriesAfter: next.length,
    }

    if (!write) {
      const how = rewrite
        ? '干跑：未写盘（将改写第 ' + (idx + 1) + ' 条，其余 ' + (entries.length - 1) + ' 条逐字保留，预计 ' + bytes + ' 字节'
        : '干跑：未写盘（将追加 1 条，现有 ' + entries.length + ' 条逐字保留，预计 ' + bytes + ' 字节'
      const bak = plannedBackup ? '，写前备份到 ' + posix(plannedBackup) : '，文件原本不存在无需备份'
      return Object.assign(base, plan, { ok: true, detail: how + bak + '）' })
    }

    // 真写：备份 → 临时文件 + rename → 写后校验 → 失败回滚
    let backup = ''
    try {
      mkdirSync(dirname(memoryFile), { recursive: true })
      backup = backupFile(memoryFile, io, now)
    } catch (err) {
      return Object.assign(base, plan, { ok: false, detail: '写前备份失败，已放弃写入：' + String(err && err.message ? err.message : err) })
    }
    try {
      atomicWriteText(memoryFile, body, io)
    } catch (err) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写入失败（已回滚）：' + String(err && err.message ? err.message : err) })
    }

    const verify = readFileRaw(memoryFile)
    if (!verify || verify.bom) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写后校验失败（已回滚）：文件读不到或带 BOM' })
    }
    const after = parseEntries(verify.text)
    if (after.length !== next.length || after[idx] !== entryAfter) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写后校验失败：目标条目与预期不一致（已回滚）' })
    }
    let othersOk = true
    for (let i = 0; i < entries.length; i++) {
      if (i === idx) continue
      if (after[i] !== entries[i]) { othersOk = false; break }
    }
    if (!othersOk) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写后校验失败：其余条目发生变化（已回滚）' })
    }
    let personaOk = true
    for (let i = 0; i < entries.length; i++) {
      if (i === idx) continue
      if (entries[i].indexOf(PERSONA_MARK) >= 0 && after[i] !== entries[i]) { personaOk = false; break }
    }
    if (!personaOk) {
      rollbackWrite(memoryFile, backup, io, hadFile)
      return Object.assign(base, plan, { ok: false, backup: posix(backup), detail: '写后校验失败：含「' + PERSONA_MARK + '」的条目被改动（已回滚）' })
    }

    const others = entries.length - (rewrite ? 1 : 0)
    return Object.assign(base, plan, {
      ok: true,
      backup: backup ? posix(backup) : '',
      bytesWritten: bytes,
      wroteAny: true,
      personaUntouched: true,
      othersUntouched: true,
      detail: (rewrite ? '已整条改写身份条目' : '已追加身份条目') + '（' + bytes + ' 字节；其余 ' + others + ' 条逐字未变，含「' + PERSONA_MARK + '」的条目未动）'
        + (backup ? '，备份 ' + posix(backup) : ''),
    })
  }

  if (dryRun) return run(false)
  try {
    return withMemoryDirLock(dirname(memoryFile), () => run(true))
  } catch (err) {
    return Object.assign(base, { detail: '写入被拒绝：' + String(err && err.message ? err.message : err) })
  }
}
