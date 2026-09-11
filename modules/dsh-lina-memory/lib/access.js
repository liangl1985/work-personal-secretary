/**
 * lina-memory — 记忆"被用到"的跟踪（`.access.json`）
 *
 * 2026-09-11 主人定：**"访问跟踪直接做"** —— 热记忆的 TTL 判据不是"写入多久"，
 * 而是"最近有没有被用到"：归档判定取 `max(写入日, 最后使用日)`，**常用的旧记忆不会被归档**。
 *
 * **什么算"被用到"（会刷新 last）**：
 *   - `memory_recall` 命中并返回给模型的条目；
 *   - `memory_link` 建边的两端（"关联即使用"，见 lib/graph.js）；
 *   - 冷 → 热写回（`/memory_promote`、归档范围 recall 命中转热）。
 *
 * **什么不算（绝不刷新 last）**：每轮**注入快照**、面板浏览、`/memory_audit` 巡检、
 * `/memory_maintain` 自身。这条是**红线**：注入会把热记忆每轮都送进上下文，若算作
 * "使用"，全库将永远停在热区、TTL 永不生效——主人 2026-09-11 特别提醒过这个起始点。
 *
 * @module lina-memory/access
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { localIso } from './clock.js'

const ACCESS_FILE = '.access.json'

function accessPath(root) {
  return join(root, ACCESS_FILE)
}

/** 读访问记录（容错） */
export function readAccess(root) {
  try {
    const p = accessPath(root)
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      return j && typeof j === 'object' ? j : {}
    }
  } catch { /* fresh */ }
  return {}
}

/** 写访问记录 */
export function writeAccess(root, map) {
  mkdirSync(root, { recursive: true })
  writeFileSync(accessPath(root), JSON.stringify(map, null, 2), 'utf8')
}

/**
 * 记录一次"被用到"。
 * @param {string} root
 * @param {string|string[]} ids - 命中的条目 id（可为空数组，静默跳过）
 * @returns {number} 实际记录的条数
 */
export function touchAccess(root, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (list.length === 0) return 0
  const now = localIso()
  const map = readAccess(root)
  for (const id of list) {
    const prev = map[id] || {}
    map[id] = { last: now, count: (prev.count || 0) + 1 }
  }
  writeAccess(root, map)
  return list.length
}

/** 取某条目的最后使用时间（本地 ISO；无记录返回 null） */
export function lastAccessOf(map, id) {
  const v = map && map[id]
  return v && typeof v.last === 'string' ? v.last.slice(0, 10) : null
}

/**
 * 一批条目里**最晚**的使用日（用于 DAILY 以"文件"为单位判到期：
 * 只要文件里有任一条 7 天内被用过，整个文件就顺延，不按周合并）。
 */
export function latestAccessOf(map, ids) {
  let latest = null
  for (const id of (Array.isArray(ids) ? ids : [ids])) {
    if (!id) continue
    const d = lastAccessOf(map, id)
    if (d && (!latest || d > latest)) latest = d
  }
  return latest
}

/** 清理已不存在条目的访问记录（避免无限增长） */
export function pruneAccess(root, existingIds) {
  const map = readAccess(root)
  let removed = 0
  for (const id of Object.keys(map)) {
    if (!existingIds.has(id)) { delete map[id]; removed += 1 }
  }
  if (removed > 0) writeAccess(root, map)
  return removed
}
