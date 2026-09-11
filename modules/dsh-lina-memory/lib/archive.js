/**
 * lina-memory — 冷热分层（归档 / 转热）
 *
 * 2026-09-11 使用者定：**三级记忆模型**
 *   - 全局记忆（MEMORY.md）：**永不遗忘**，不参与任何 TTL；
 *   - 热记忆（USER.md / PROJECTS / DAILY）：到期转冷；
 *   - 冷记忆（ARCHIVE/）：不注入、可检索，**被取出使用时转热**（写回原范围）。
 *
 * 周期（按"每周处理一次"的节拍；起始点见下面的 `ttlRef`）：
 *   - DAILY：7 天 → 按**周**合并进 `ARCHIVE/daily-YYYY-Www.md`
 *     （**以文件为单位**，基准日 = max(文件名日期, 文件内任一条目的最后使用日)）
 *   - 项目条目（PROJECTS）：30 天
 *   - 偏好条目（USER.md）：90 天
 *   - 任何 `关键` 条目：永不
 *
 * 归档时在 `ARCHIVE/.archive-index.json` 记录 `id → {scope,file,archivedAt}`，
 * 转热时据此**按原 id、原文**写回原范围（这也是"冷记忆拿出来处理时转为热记忆"的落点）。
 *
 * @module lina-memory/archive
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ENTRY_DELIMITER, MemoryStore, extractEntryDate, extractEntryId, parseEntryTag, withDirLock } from './store.js'
import { memoryFiles } from './context.js'
import { addDays, todayStamp, weekKey } from './clock.js'
import { registerEntry, readGraph } from './graph.js'
import { readAccess, lastAccessOf, latestAccessOf } from './access.js'
import {
  gatherTriageContext, judgeEntry, keepUntil, markKept, markPending, pendingDays, pruneTriage, readTriage, writeTriage, coldVerdict, markCold,
} from './triage.js'

export const ARCHIVE_DIR = 'ARCHIVE'
export const ARCHIVE_ENTRIES = 'entries.md'
const INDEX_FILE = '.archive-index.json'
const MAINTAIN_MARK = '.last-maintain'
/** 到期前多少天开始预审（"转冷前先判断"的提前量） */
export const NOTICE_DAYS = 7

/**
 * 「到期基准日」= TTL 的**起始点**（2026-09-11 特别指出要把这条讲清楚）。
 *
 *     基准日 = max(写入日, 最后使用日)
 *
 *   - 写入日：条目元信息里的 `[YYYY-MM-DD]`（本地日界，见 lib/clock.js）；
 *   - 最后使用日：`.access.json` 里该条最后被"用到"的日期（见 lib/access.js）；
 *   - **只要 TTL 天内被用过，基准日就被顶到使用那天**，于是永远不会"刚用过就转冷"；
 *   - 不算"使用"的：每轮注入快照、面板浏览、巡检、保养（否则 TTL 永不生效）。
 *
 * 转冷条件：`今天 − 基准日 > TTL` —— 即 **TTL 天内（含第 TTL 天）都仍算热**，
 * 第 TTL+1 天才转冷。例：DAILY 7 天，09-01 那天的日志在 09-08 仍是最后一天，09-09 才归档。
 */
export function ttlRef(date, usedAt) {
  const d = date || null
  const u = usedAt || null
  if (d && u) return u > d ? u : d
  return d || u || null
}

/** 距转冷还剩几天（≥0 = 仍热；<0 = 该转冷；基准日缺失或 TTL≤0 → null 表示不判） */
export function daysUntilCold(ref, ttlDays, today) {
  const ttl = Number(ttlDays)
  if (!ref || !today || !Number.isFinite(ttl) || ttl <= 0) return null
  const age = Math.round((new Date(today + 'T00:00:00') - new Date(ref + 'T00:00:00')) / 86400000)
  if (!Number.isFinite(age)) return null
  return ttl - age
}

/** 把一批条目追加到归档文件 */
export function appendToArchive(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true })
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const block = entries.join(ENTRY_DELIMITER)
  const body = existing.trim() ? existing.trimEnd() + ENTRY_DELIMITER + block : block
  writeFileSync(filePath, body + '\n', 'utf8')
}

/** 读归档来源索引 */
export function readArchiveIndex(root) {
  try {
    const p = join(root, ARCHIVE_DIR, INDEX_FILE)
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      return j && typeof j === 'object' ? j : {}
    }
  } catch { /* fresh */ }
  return {}
}

/** 写归档来源索引 */
export function writeArchiveIndex(root, index) {
  const dir = join(root, ARCHIVE_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, INDEX_FILE), JSON.stringify(index, null, 2), 'utf8')
}

/** 距上次"周保养"的天数（无记录返回 null） */
export function daysSinceMaintain(root) {
  try {
    const p = join(root, ARCHIVE_DIR, MAINTAIN_MARK)
    if (!existsSync(p)) return null
    const last = readFileSync(p, 'utf8').trim()
    const d = Math.round((new Date(todayStamp() + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000)
    return Number.isFinite(d) ? d : null
  } catch {
    return null
  }
}

/** 记录本次周保养时间 */
export function markMaintain(root) {
  const dir = join(root, ARCHIVE_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, MAINTAIN_MARK), todayStamp(), 'utf8')
}

/**
 * 执行一次归档检查（防抖：每天至多一次；写库路径懒触发；也可由 /memory_maintain 强制）。
 * @param {string} root
 * @param {object} opts - { dailyRetentionDays=7, projectTtlDays=30, userTtlDays=90, force=false }
 * @returns {object} { ok, skipped?, dailies, entries, due[] }
 */
export function runArchive(root, opts = {}) {
  const cfg = {
    dailyRetentionDays: opts.dailyRetentionDays ?? 7,
    projectTtlDays: opts.projectTtlDays ?? 30,
    userTtlDays: opts.userTtlDays ?? 90,
  }
  const archiveDir = join(root, ARCHIVE_DIR)
  mkdirSync(archiveDir, { recursive: true })
  const today = todayStamp()
  const marker = join(archiveDir, '.last-run')
  if (!opts.force) {
    try {
      if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === today) {
        return { ok: true, skipped: true, reason: '今日已执行过归档检查' }
      }
    } catch { /* best-effort */ }
  }

  return withDirLock(root, () => {
    const report = { ok: true, dailies: 0, entries: 0, due: [], kept: [], ask: [], coldTimeout: [], preCold: [] }
    const index = readArchiveIndex(root)

    // ---- 1. DAILY 过期 → 按周合并进 ARCHIVE ----
    // 以**文件**为单位判到期：基准日 = max(文件名日期, 文件内任一条目的最后使用日)。
    // 2026-09-11 提醒的起始点问题：7 天内**被用过**的日志不该因为"文件日期老"就被合并。
    const dailyDir = join(root, 'DAILY')
    const access = readAccess(root)
    if (existsSync(dailyDir)) {
      for (const f of readdirSync(dailyDir)) {
        if (!f.endsWith('.md')) continue
        const date = f.slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        const src = join(dailyDir, f)
        const entries = new MemoryStore(src).entries()
        const usedAt = latestAccessOf(access, entries.map((e) => extractEntryId(e)))
        const ref = ttlRef(date, usedAt)
        const left = daysUntilCold(ref, cfg.dailyRetentionDays, today)
        if (left === null || left >= 0) {
          if (left !== null && left <= 7) {
            report.due.push({ scope: 'daily', date: ref, file: f, inDays: left, basis: usedAt && usedAt > date ? 'used' : 'written' })
          }
          continue
        }
        const wk = weekKey(new Date(date + 'T12:00:00'))
        if (entries.length > 0) {
          appendToArchive(join(archiveDir, 'daily-' + wk + '.md'), entries)
          for (const e of entries) {
            const id = extractEntryId(e)
            if (id) index[id] = { scope: 'daily', file: 'daily-' + wk + '.md', archivedAt: today, reason: 'daily-ttl' }
          }
        }
        rmSync(src, { force: true })
        report.dailies += 1
      }
    }

    // ---- 2. 条目 TTL：项目 30 天 / 偏好 90 天；全局与"关键"永不 ----
    const files = memoryFiles(root)
    const scopes = [
      { key: 'user', label: 'USER.md', file: files.user, ttl: cfg.userTtlDays },
    ]
    const projDir = join(root, 'PROJECTS')
    if (existsSync(projDir)) {
      for (const f of readdirSync(projDir)) {
        if (f.endsWith('.md')) scopes.push({ key: 'project', label: 'PROJECTS/' + f, file: join(projDir, f), ttl: cfg.projectTtlDays })
      }
    }
    // 注意：**全局 MEMORY.md 不进入该列表**（永不遗忘）——2026-09-11 定
    const archived = []
    // ---- 转冷预审（2026-09-11 定：到期≠立即转冷，先做一次辅助判断）----
    const triageOn = opts.triageEnabled !== false
    const grace = Number.isFinite(Number(opts.triageGraceDays)) ? Number(opts.triageGraceDays) : 7
    const triage = triageOn ? readTriage(root) : { kept: {}, pending: {} }
    const triageCtx = triageOn
      ? gatherTriageContext(root, { today, access, graph: readGraph(root), dailyDays: 7 })
      : null
    for (const sc of scopes) {
      if (!sc.file || !existsSync(sc.file) || !sc.ttl || sc.ttl <= 0) continue
      const store = new MemoryStore(sc.file)
      const all = store.entries()
      const keep = []
      for (const e of all) {
        const tag = parseEntryTag(e)
        const date = extractEntryDate(e)
        const id = extractEntryId(e)
        // 「被用到才算热」：基准日 = max(写入日, 最后使用日)（见 ttlRef 注释）
        const used = lastAccessOf(access, id)
        const ref = ttlRef(date, used)
        const left = daysUntilCold(ref, sc.ttl, today)
        const dueNow = tag !== '关键' && left !== null && left < 0
        const dueSoon = tag !== '关键' && left !== null && left >= 0 && left <= NOTICE_DAYS
        if (!dueNow && !dueSoon) {
          keep.push(e)
          continue
        }
        const scopeToken = sc.key === 'project' ? sc.label.replace(/^PROJECTS\//, '').replace(/\.md$/, '') : sc.key
        // ① 已有保留判定（自动/助手/使用者）→ 继续留热
        const held = keepUntil(triage, id, today)
        if (held) {
          report.kept.push({ id, scope: sc.key, label: sc.label, until: held.until, by: held.by, reason: held.reason, pre: dueSoon })
          keep.push(e)
          continue
        }
        // ①' 已判定为冷（助手拍板）→ 不再询问，到期即冷
        const settledCold = coldVerdict(triage, id)
        if (settledCold && dueSoon) {
          report.preCold.push({ id, scope: sc.key, label: sc.label, inDays: left, score: 0, reason: settledCold.reason || '已判定为冷' })
          keep.push(e)
          continue
        }
        if (settledCold) {
          archived.push({ entry: e, scope: sc.key, label: sc.label })
          if (id) delete triage.cold[id]
          index[id] = { scope: sc.key, file: sc.key === 'project' ? sc.label.replace(/^PROJECTS\//, '').replace(/\.md$/, '') : null, archivedAt: today, reason: settledCold.by === 'auto' ? 'ttl' : 'triage-cold' }
          continue
        }
        // ② 跑一次辅助判断（到期前 7 天就先判，留出处理时间）
        const judge = triageOn && id
          ? judgeEntry(e, {
            today,
            hotTexts: sc.key === 'project' ? all : [...all, ...Object.values(triageCtx.projectTexts).flat()],
            globalTexts: triageCtx.globalTexts,
            recentDailyTexts: triageCtx.recentDailyTexts,
            graphDegree: triageCtx.graphDeg.get(id) || 0,
            accessCount: triageCtx.accessCount(id),
          })
          : { decision: 'cold', score: 0, reasons: [] }
        if (judge.decision === 'keep') {
          const rec = markKept(root, triage, {
            id, days: sc.ttl, today, by: 'auto', scope: scopeToken,
            label: sc.label, reason: judge.reasons.join('；') || '预审判定保留',
          })
          report.kept.push({ id, scope: sc.key, label: sc.label, until: rec.until, by: 'auto', reason: rec.reason, score: judge.score, pre: dueSoon })
          keep.push(e)
          continue
        }
        if (judge.decision === 'ask') {
          const waited = dueSoon ? null : pendingDays(triage, id, today)
          if (dueSoon || waited === null || grace <= 0 || waited <= grace) {
            markPending(root, triage, {
              id, days: sc.ttl, today, scope: scopeToken, label: sc.label,
              score: judge.score, reason: judge.reasons.join('；'),
              excerpt: judge.label,
            })
            report.ask.push({
              id, scope: sc.key, label: sc.label, score: judge.score, reasons: judge.reasons,
              excerpt: judge.label, waited: waited === null ? 0 : waited, pre: dueSoon,
            })
            keep.push(e)
            continue
          }
          // 宽限期内助手也没判 → 自然转冷（不再拖）
          report.coldTimeout.push({ id, scope: sc.key, label: sc.label, waited })
        }
        // ③ cold：到期就转冷；未到期只记"预判自然转冷"，等它到期
        if (dueSoon) {
          report.preCold.push({ id, scope: sc.key, label: sc.label, inDays: left, score: judge.score, reason: judge.reasons.join('；') })
          report.due.push({ scope: sc.key, label: sc.label, date: ref, inDays: left, basis: used && date && used > date ? 'used' : 'written', verdict: 'cold' })
          keep.push(e)
          continue
        }
        archived.push({ entry: e, scope: sc.key, label: sc.label })
        if (id) delete triage.kept[id]
        if (id) delete triage.pending[id]
        // 索引里存**不带扩展名**的项目名，转热时再拼 .md（否则会拼成 xx.md.md）
        if (id) index[id] = { scope: sc.key, file: sc.key === 'project' ? sc.label.replace(/^PROJECTS\//, '').replace(/\.md$/, '') : null, archivedAt: today, reason: 'ttl' }
      }
      if (keep.length !== all.length) {
        if (keep.length === 0) rmSync(sc.file, { force: true })
        else store._writeGuarded(keep)
      }
    }
    if (archived.length > 0) {
      appendToArchive(join(archiveDir, ARCHIVE_ENTRIES), archived.map((a) => a.entry))
      report.entries = archived.length
    }
    if (triageOn) {
      // 保留窗口已过期的记录顺手清理，避免 .triage.json 无限增长
      for (const id of Object.keys(triage.kept)) {
        if (!keepUntil(triage, id, today)) delete triage.kept[id]
      }
      writeTriage(root, triage)
    }

    writeArchiveIndex(root, index)
    writeFileSync(marker, today, 'utf8')
    return report
  })
}

/** 列出归档文件与条数 */
export function listArchive(root) {
  const dir = join(root, ARCHIVE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const entries = new MemoryStore(join(dir, f)).entries()
      return { file: f, entries: entries.length, path: join(dir, f) }
    })
}

/** 召回归档内容（scope=archive 时使用；带 id 便于转热） */
export function archiveEntries(root, limit = 20) {
  const out = []
  for (const f of listArchive(root)) {
    for (const e of new MemoryStore(f.path).entries()) {
      out.push({ scope: 'archive/' + f.file, entry: e, id: extractEntryId(e), file: f.file })
    }
  }
  out.sort((a, b) => b.entry.localeCompare(a.entry))
  return out.slice(0, limit)
}

/**
 * 冷 → 热：把归档中的某条记忆按**原 id、原文**写回它原来所属的范围。
 * @param {string} root
 * @param {string} id - 条目 id
 * @returns {{ ok:boolean, scope?:string, file?:string, entry?:string, error?:string }}
 */
export function promoteEntry(root, id) {
  if (!id) return { ok: false, error: 'id 不能为空' }
  return withDirLock(root, () => {
    const index = readArchiveIndex(root)
    const meta = index[id] || null
    let found = null
    let foundFile = null
    for (const f of listArchive(root)) {
      const e = new MemoryStore(f.path).entries().find((x) => extractEntryId(x) === id)
      if (e) { found = e; foundFile = f; break }
    }
    if (!found) return { ok: false, error: '归档中未找到该 id：' + id }

    // 目标范围：优先用索引记录，其次按 scope 推断
    const files = memoryFiles(root)
    let target = null
    let scope = meta?.scope || null
    if (scope === 'daily') target = join(root, 'DAILY', todayStamp() + '.md')
    else if (scope === 'user') target = files.user
    else if (scope === 'project') target = join(root, 'PROJECTS', String(meta?.file || '未分类').replace(/\.md$/, '') + '.md')
    if (!target) { target = files.user; scope = scope || 'user' }

    // 写回原范围（保留原 id 与原文）
    const store = new MemoryStore(target)
    store.ensure()
    if (!store.entries().some((x) => extractEntryId(x) === id)) store.add(found)
    registerEntry(root, found)

    // 从归档文件与索引里移除
    const archName = (meta?.file && meta.file.endsWith('.md')) ? meta.file : (scope === 'daily' ? null : ARCHIVE_ENTRIES)
    const candidates = archName ? [archName] : listArchive(root).map((f) => f.file)
    for (const name of candidates) {
      const p = join(root, ARCHIVE_DIR, name)
      if (!existsSync(p)) continue
      const s = new MemoryStore(p)
      const rest = s.entries().filter((x) => extractEntryId(x) !== id)
      if (rest.length !== s.entries().length) {
        if (rest.length === 0) rmSync(p, { force: true })
        else s._writeGuarded(rest)
        break
      }
    }
    delete index[id]
    writeArchiveIndex(root, index)
    // 转热即"被用到"：清掉预审状态（保留/待判断），避免旧判定压着它
    try {
      const triage = readTriage(root)
      delete triage.kept[id]
      delete triage.pending[id]
      writeTriage(root, triage)
    } catch { /* best-effort */ }
    return { ok: true, scope, file: target, entry: found, from: foundFile }
  })
}

/** 在热区（USER.md / PROJECTS/*）里按 id 找条目 */
export function findHotEntry(root, id) {
  if (!id) return null
  const files = memoryFiles(root)
  const targets = [{ scope: 'user', file: files.user, label: 'USER.md' }]
  const projDir = join(root, 'PROJECTS')
  if (existsSync(projDir)) {
    for (const f of readdirSync(projDir)) {
      if (f.endsWith('.md')) targets.push({ scope: 'project', file: join(projDir, f), label: 'PROJECTS/' + f })
    }
  }
  for (const t of targets) {
    if (!t.file || !existsSync(t.file)) continue
    const entry = new MemoryStore(t.file).entries().find((e) => extractEntryId(e) === id)
    if (entry) return { ...t, entry }
  }
  return null
}

/** 列出待判断队列（按进入时间倒序，最新的在前） */
export function listPending(root) {
  const { pending } = readTriage(root)
  return Object.entries(pending)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => String(b.since || '').localeCompare(String(a.since || '')))
}

/**
 * 转冷预审判定①：**保留**（助手或使用者判定该条仍需留在热区）。
 * 只记保留窗口，不改条目原文、不伪造"被使用"记录。
 */
export function keepEntry(root, id, { reason = '判定：仍需留在热区', days = 30, by = 'assistant', today = todayStamp() } = {}) {
  if (!id) return { ok: false, error: 'id 不能为空' }
  return withDirLock(root, () => {
    const hit = findHotEntry(root, id)
    if (!hit) return { ok: false, error: '热区未找到该 id（可能已经转冷）：' + id }
    const triage = readTriage(root)
    const rec = markKept(root, triage, { id, days, by, today, reason, label: hit.label, scope: hit.scope })
    writeTriage(root, triage)
    return { ok: true, record: rec, label: hit.label, entry: hit.entry }
  })
}

/** 转冷预审判定②：**转冷**（已到期立即移入 ARCHIVE；未到期只记判定，到期时静默转冷） */
export function archiveEntryById(root, id, { reason = 'triage-cold', by = 'assistant', today = todayStamp(), ttlDays = null } = {}) {
  if (!id) return { ok: false, error: 'id 不能为空' }
  return withDirLock(root, () => {
    const hit = findHotEntry(root, id)
    if (!hit) return { ok: false, error: '热区未找到该 id（可能已经转冷）：' + id }
    const ttl = Number(ttlDays) > 0 ? Number(ttlDays) : (hit.scope === 'project' ? 30 : 90)
    const ref = ttlRef(extractEntryDate(hit.entry), lastAccessOf(readAccess(root), id))
    const left = daysUntilCold(ref, ttl, today)
    if (left !== null && left >= 0) {
      // 还没到期：记判定，等它到期时直接冷，不再反复询问
      const triage = readTriage(root)
      const rec = markCold(triage, { id, reason, by, today, label: hit.label, scope: hit.scope })
      writeTriage(root, triage)
      return { ok: true, deferred: true, until: addDays(ref, ttl + 1), label: hit.label, record: rec }
    }
    const store = new MemoryStore(hit.file)
    const rest = store.entries().filter((e) => extractEntryId(e) !== id)
    if (rest.length === 0) rmSync(hit.file, { force: true })
    else store._writeGuarded(rest)
    appendToArchive(join(root, ARCHIVE_DIR, ARCHIVE_ENTRIES), [hit.entry])
    const index = readArchiveIndex(root)
    index[id] = {
      scope: hit.scope,
      file: hit.scope === 'project' ? hit.label.replace(/^PROJECTS\//, '').replace(/\.md$/, '') : null,
      archivedAt: today,
      reason,
    }
    writeArchiveIndex(root, index)
    const triage = readTriage(root)
    delete triage.kept[id]
    delete triage.pending[id]
    if (triage.cold) delete triage.cold[id]
    writeTriage(root, triage)
    return { ok: true, scope: hit.scope, label: hit.label, entry: hit.entry }
  })
}
