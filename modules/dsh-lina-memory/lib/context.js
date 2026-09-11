/**
 * lina-memory — 热记忆快照生成（每轮注入）
 *
 * 2026-09-11 主人批准的**取舍规则**（写死在此，参数可在设置页调）：
 *   1. 分段上限：全局 20 / 偏好 12 / 项目 16 / 今日 8；总字符 maxChars 默认 4000；
 *   2. 优先级：关键 > 常规 > 临时；**敏感不自动注入**（只在你显式 memory_recall 时给出）；
 *   3. 段内排序：偏好/项目按"最近更新"倒序（近期状态更重要）；**全局保持原顺序**（老的红线优先）；
 *   4. 截断：先砍最低优先级段的尾部；被砍的段尾补 `（另有 N 条未注入，用 memory_recall 查）`——**绝不静默丢弃**；
 *   5. 受保护：全局段的 `关键` 条目在字符不够时优先保留，仍放不下则在快照里告警；
 *   6. 周保养提醒：距上次保养 > maintainWarnDays（默认 7）天时，快照里出现一行提醒。
 *   7. 转冷待判断提醒：预审拿不准的条目进队列，快照里出现 `⏳ 转冷待判断 N 条`（莉娜判定，不推给主人）。
 *
 * **红线**：本模块**只读**，绝不刷新 `.access.json`（见 lib/access.js）——每轮注入不算
 * "被用到"，否则热记忆永远顺延、TTL 失效（主人 2026-09-11 指出的起始点问题）。
 *
 * @module lina-memory/context
 */

import { join } from 'node:path'
import { MemoryStore, DAILY_ACTIVITY_PREFIX, extractEntryDate, parseEntryTag, stripEntryId } from './store.js'
import { todayStamp } from './clock.js'
import { readTriage } from './triage.js'

const DEFAULTS = { global: 20, user: 12, project: 16, daily: 8 }

/** tag 优先级（越小越优先注入） */
function tagRank(tag) {
  if (tag === '关键') return 0
  if (tag === '临时') return 2
  return 1
}

/** 关键优先 + 最近更新倒序 */
function pickPriority(entries, limit) {
  const scored = entries.map((e, i) => ({ e, i, tag: parseEntryTag(e), date: extractEntryDate(e) || '' }))
  scored.sort((a, b) => {
    const ra = tagRank(a.tag)
    const rb = tagRank(b.tag)
    if (ra !== rb) return ra - rb
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.i - b.i
  })
  return { taken: scored.slice(0, limit).map((x) => x.e), dropped: Math.max(0, scored.length - limit) }
}

/** 收集一段：过滤敏感 + 按上限裁剪 */
function section(store, limit, { keepOrder = false } = {}) {
  const all = store.entries().filter((e) => parseEntryTag(e) !== '敏感')
  if (keepOrder) return { taken: all.slice(0, limit), dropped: Math.max(0, all.length - limit), list: all }
  const picked = pickPriority(all, limit)
  return { taken: picked.taken, dropped: picked.dropped, list: all }
}

/**
 * 构建热记忆快照文本。
 * @param {object} opts - { root, maxChars, branch, today, globalWarnCount, limits, maintainDays, maintainWarnDays }
 * @returns {string} 注入文本（空串 = 不注入）
 */
export function buildSnapshot({
  root,
  maxChars = 4000,
  branch = null,
  today = null,
  globalWarnCount = 20,
  limits = {},
  maintainDays = null,
  maintainWarnDays = 7,
  triageAsk = true,
} = {}) {
  const t = today || todayStamp()
  const lim = { ...DEFAULTS, ...(limits || {}) }
  const parts = []

  // 1. 全局记忆（永不遗忘；保持原顺序，老的红线在前）
  const globalSec = section(new MemoryStore(join(root, 'MEMORY.md')), lim.global, { keepOrder: true })
  if (globalSec.taken.length > 0) {
    parts.push({ key: 'global', label: '【全局记忆】', taken: globalSec.taken, dropped: globalSec.dropped, total: globalSec.list.length })
    if (globalWarnCount > 0 && globalSec.list.length > globalWarnCount) {
      parts.push({ raw: '⚠️ 全局记忆已 ' + globalSec.list.length + ' 条（阈值 ' + globalWarnCount + '）：请整理——与具体项目/插件/任务有关的条目应移入 PROJECTS/<项目>.md（用 memory_audit 命令可看巡检报告）' })
    }
  }

  // 2. 用户偏好（关键优先 + 最近更新倒序）
  const userSec = section(new MemoryStore(join(root, 'USER.md')), lim.user)
  if (userSec.taken.length > 0) parts.push({ key: 'user', label: '【用户偏好】', taken: userSec.taken, dropped: userSec.dropped, total: userSec.list.length })

  // 3. 项目记忆（按会话目录推断的 branch）
  if (branch) {
    const projSec = section(new MemoryStore(join(root, 'PROJECTS', sanitize(branch) + '.md')), lim.project)
    if (projSec.taken.length > 0) parts.push({ key: 'project', label: '【项目记忆·' + branch + '】', taken: projSec.taken, dropped: projSec.dropped, total: projSec.list.length })
  }

  // 4. 今日日志（自动活动行不注入；取最近几条）
  const dailyStore = new MemoryStore(join(root, 'DAILY', t + '.md'))
  const dailyAll = dailyStore.entries().filter((e) => !stripEntryId(e).includes(DAILY_ACTIVITY_PREFIX) && parseEntryTag(e) !== '敏感')
  const dailyPool = dailyAll.length > 0 ? dailyAll : dailyStore.entries().filter((e) => parseEntryTag(e) !== '敏感')
  if (dailyPool.length > 0) {
    const taken = dailyPool.slice(-lim.daily)
    parts.push({ key: 'daily', label: '【今日日志】', taken, dropped: Math.max(0, dailyPool.length - lim.daily), total: dailyPool.length })
  }

  // 5. 周保养提醒
  if (maintainWarnDays > 0 && (maintainDays === null || maintainDays > maintainWarnDays)) {
    const when = maintainDays === null ? '尚未做过' : '已 ' + maintainDays + ' 天未做'
    parts.push({ raw: '⏰ 记忆周保养' + when + '（建议 >7 天做一次）：/memory_maintain 可一次完成"到期转冷 + 转热候选 + 分类巡检"' })
  }

  // 6. 转冷待判断提醒（主人 2026-09-11 定：预审拿不准的由莉娜判定，不推给主人）
  if (triageAsk !== false) {
    try {
      const pend = Object.keys(readTriage(root).pending || {}).length
      if (pend > 0) {
        parts.push({ raw: '⏳ 转冷待判断 ' + pend + ' 条（预审信号不足，需莉娜判定）：/memory_triage 查看并 keep/cold；超宽限会自动转冷' })
      }
    } catch { /* best-effort */ }
  }

  if (parts.length === 0) return ''

  // ---- 组装 + 字符上限：超限时从最低优先级段（今日→项目→偏好→全局常规）尾部砍 ----
  const render = () => parts.map((p) => {
    if (p.raw) return p.raw
    const body = p.taken.map(stripEntryId).join('；')
    const tail = p.dropped > 0 ? '（另有 ' + p.dropped + ' 条未注入，用 memory_recall 查）' : ''
    return p.label + body + tail
  }).join('\n')

  let text = render()
  for (const key of ['daily', 'project', 'user', 'global']) {
    while (text.length > maxChars) {
      const sec = parts.find((p) => p.key === key && p.taken.length > 0)
      if (!sec) break
      if (key === 'global') {
        // 全局段：关键条目受保护，只砍非关键
        const idx = [...sec.taken].reverse().findIndex((e) => parseEntryTag(e) !== '关键')
        if (idx === -1) break
        sec.taken.splice(sec.taken.length - 1 - idx, 1)
      } else {
        sec.taken.pop()
      }
      sec.dropped += 1
      text = render()
    }
    if (text.length <= maxChars) break
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + '…（快照超出上限，部分内容未注入：请调大 snapshotMaxChars 或用 memory_recall）'
  }
  return text
}

/** 记忆文件路径生成（统一入口） */
export function memoryFiles(root, { branch = null, today = null } = {}) {
  const t = today || todayStamp()
  return {
    global: join(root, 'MEMORY.md'),
    user: join(root, 'USER.md'),
    daily: join(root, 'DAILY', t + '.md'),
    project: branch ? join(root, 'PROJECTS', sanitize(branch) + '.md') : null,
    suggestions: join(root, 'SUGGESTIONS.jsonl'),
    graph: join(root, 'GRAPH.json'),
  }
}

/** 项目名安全化（防路径注入） */
export function sanitize(name) {
  return String(name ?? 'default').replace(/[^a-zA-Z0-9_一-龥-]/g, '_').slice(0, 60) || 'default'
}
