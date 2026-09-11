/**
 * lina-memory — memory storage layer.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { todayStamp as localTodayStamp } from './clock.js'

export const ENTRY_DELIMITER = '\n§\n'
/** 每日自动活动日志条目的内容前缀（快照/面板可据此过滤） */
export const DAILY_ACTIVITY_PREFIX = '对话进行中'
const STALE_LOCK_MS = 10_000
const LOCK_TIMEOUT_MS = 5_000
const LOCK_RETRY_MS = 25

export function defaultMemoryRoot() {
  const dshHome = process.env.DSH_HOME?.trim()
  const base = dshHome && dshHome.length > 0 ? dshHome : join(homedir(), '.dsh')
  return join(base, 'memories', 'lina-memory')
}

export function genEntryId() {
  return createHash('sha256').update(randomUUID()).digest('hex').slice(0, 12)
}

export function extractEntryId(entry) {
  const match = /^\[id:([a-f0-9]+)\]/.exec(entry)
  return match ? match[1] : null
}

export function stripEntryId(entry) {
  return entry.replace(/^\[id:[a-f0-9]+\]\s*/, '')
}

export function todayStamp(date = new Date()) {
  // 本地时区（日界 = 本地 00:00），不再用 UTC 的 toISOString
  return localTodayStamp(date)
}

export function parseEntries(text) {
  return String(text ?? '').split(ENTRY_DELIMITER).map((e) => e.trim()).filter((e) => e.length > 0)
}

export function serializeEntries(entries) {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

export function extractEntryDate(entry) {
  const match = /^\[(\d{4}-\d{2}-\d{2})/.exec(stripEntryId(entry))
  return match ? match[1] : null
}

export function parseEntryBranches(entry) {
  const match = /(?:^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*)?\[branch:([^\]]*)\]\s*/.exec(entry)
  if (!match) return null
  const branches = match[1].split(',').map((b) => b.trim()).filter(Boolean)
  return branches.length > 0 ? branches : null
}

export function parseEntryTag(entry) {
  const match = /\[tag:([^\]]+)\]/.exec(entry)
  return match ? match[1].trim() : null
}

export function makeEntry(content, { id = genEntryId(), date = todayStamp(), branch = null, tag = null } = {}) {
  const parts = ['[id:' + id + ']', '[' + date + ']']
  if (branch) parts.push('[branch:' + branch + ']')
  if (tag) parts.push('[tag:' + tag + ']')
  return parts.join(' ') + ' ' + content
}

export class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath
    this.dir = dirname(filePath)
  }
  ensure() {
    mkdirSync(this.dir, { recursive: true })
    return this
  }
  entries() {
    if (!existsSync(this.filePath)) return []
    return parseEntries(readFileSync(this.filePath, 'utf8'))
  }
  raw() {
    if (!existsSync(this.filePath)) return ''
    return readFileSync(this.filePath, 'utf8')
  }
  add(entry) {
    this.ensure()
    const existing = this.raw()
    if (existsSync(this.filePath) && parseEntries(existing).length === 0) {
      throw new Error('refusing add: ' + this.filePath + ' exists but reads as empty')
    }
    // 读全部条目 → 追加 → 用 serializeEntries 重写（避免字符串拼接导致分隔符错乱）
    const entries = this.entries()
    const next = [...entries, entry]
    this._write(serializeEntries(next))
    return { ok: true, file: this.filePath }
  }
  replace(match, newEntry) {
    const entries = this.entries()
    const idx = entries.findIndex((e) => e.includes(match))
    if (idx < 0) return { ok: false, reason: 'not-found' }
    entries[idx] = newEntry
    this._writeGuarded(entries)
    return { ok: true, file: this.filePath }
  }
  remove(match) {
    const entries = this.entries()
    const idx = entries.findIndex((e) => e.includes(match))
    if (idx < 0) return { ok: false, reason: 'not-found' }
    entries.splice(idx, 1)
    this._writeGuarded(entries)
    return { ok: true, file: this.filePath }
  }
  _writeGuarded(entries) {
    const current = this.raw()
    if (current.length > 0 && parseEntries(current).join('\u0000') !== this.entries().join('\u0000')) {
      const backup = this.filePath + '.bak.' + Date.now()
      renameSync(this.filePath, backup)
      throw new Error('drift detected; backed up to ' + backup)
    }
    this._write(serializeEntries(entries))
  }
  _write(text) {
    const tmp = this.filePath + '.tmp.' + process.pid
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, this.filePath)
  }
}

/**
 * 同进程重入计数：外层已持锁时，内层调用直接复用（不再抢同一把文件锁）。
 *
 * 为什么必须有：写库路径是 `withDirLock(root, () => { …; maybeArchive() })`，
 * 而 `runArchive()` 自己也要 `withDirLock(root, …)` —— 文件锁对同一进程不区分持有者，
 * 内层会 EEXIST → 自旋到 5 秒超时 → 抛错被静默吞掉（归档因此从未真正执行）。
 */
const heldLocks = new Map()

export function withDirLock(dir, fn) {
  const key = String(dir)
  const depth = heldLocks.get(key) ?? 0
  if (depth > 0) {
    heldLocks.set(key, depth + 1)
    try {
      return fn()
    } finally {
      const next = (heldLocks.get(key) ?? 1) - 1
      if (next <= 0) heldLocks.delete(key)
      else heldLocks.set(key, next)
    }
  }

  mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, '.lina-memory.lock')
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
      } catch { continue }
      if (Date.now() > deadline) throw new Error('lina-memory: lock timeout')
      const t = Date.now()
      while (Date.now() - t < LOCK_RETRY_MS) { /* spin */ }
    }
  }
  heldLocks.set(key, 1)
  try {
    return fn()
  } finally {
    heldLocks.delete(key)
    rmSync(lockPath, { force: true })
  }
}

export function listDailyFiles(root) {
  const dir = join(root, 'DAILY')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse()
}

export function listProjectFiles(root) {
  const dir = join(root, 'PROJECTS')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md'))
}
