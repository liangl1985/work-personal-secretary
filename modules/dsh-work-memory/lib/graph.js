/**
 * work-memory — 图谱（GRAPH.json）读写与登记
 *
 * 2026-09-11 使用者指出：图谱只在 `memory_link` 时登记，**记忆落盘时完全不碰图谱**，
 * 导致「偏好」范围只有一个点、项目范围没有节点。这里把图谱维护收成一处：
 *   - 每条记忆写入（remember / 批准建议 / API 写入）→ `registerEntry` 登记节点；
 *   - 删除条目 → `pruneEntity` 摘掉节点与相关边；
 *   - `memory_link` → `linkEntries` 建边（并顺手登记两端节点）。
 * 纯文件操作 + 一个带锁的便利入口，便于单测。
 *
 * @module work-memory/graph
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripEntryId, extractEntryId, withDirLock } from './store.js'
import { localIso } from './clock.js'
import { touchAccess } from './access.js'

/** 图谱文件路径 */
export function graphPath(root) {
  return join(root, 'GRAPH.json')
}

/** 读图谱（容错：文件缺失/损坏返回空图） */
export function readGraph(root) {
  try {
    const p = graphPath(root)
    if (existsSync(p)) {
      const g = JSON.parse(readFileSync(p, 'utf8'))
      return {
        entities: Array.isArray(g.entities) ? g.entities : [],
        edges: Array.isArray(g.edges) ? g.edges : [],
      }
    }
  } catch { /* fresh graph */ }
  return { entities: [], edges: [] }
}

/** 写图谱（确保目录存在） */
export function writeGraph(root, graph) {
  mkdirSync(root, { recursive: true })
  writeFileSync(graphPath(root), JSON.stringify({
    entities: Array.isArray(graph.entities) ? graph.entities : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  }, null, 2), 'utf8')
}

/** 节点名 = 条目正文摘要（剥掉 [id:..] [日期] [branch:..] [tag:..] 元信息前缀） */
export function labelOfEntry(raw) {
  const id = extractEntryId(raw) || ''
  const body = stripEntryId(String(raw ?? ''))
    .replace(/^(?:\s*\[[^\]]*\]\s*)+/, '')
    .trim()
    .slice(0, 60)
  return body || id
}

/** 确保节点存在（已存在则保留原 label） */
export function ensureEntity(graph, entity) {
  if (!Array.isArray(graph.entities)) graph.entities = []
  if (!entity || !entity.id) return graph
  if (!graph.entities.some((x) => x && x.id === entity.id)) graph.entities.push(entity)
  return graph
}

/**
 * 登记一条记忆的图谱节点（需在已持锁或单线程场景调用；纯文件操作）。
 * @returns {boolean} 是否登记（无 id 的条目跳过）
 */
export function registerEntry(root, raw) {
  const id = extractEntryId(String(raw ?? ''))
  if (!id) return false
  const graph = readGraph(root)
  ensureEntity(graph, { id, label: labelOfEntry(raw) })
  writeGraph(root, graph)
  return true
}

/** 摘掉某条记忆的节点及其所有边 */
export function pruneEntity(root, id) {
  if (!id) return false
  const graph = readGraph(root)
  const before = graph.entities.length
  graph.entities = graph.entities.filter((x) => !x || x.id !== id)
  graph.edges = graph.edges.filter((e) => e && e.from !== id && e.to !== id)
  if (graph.entities.length !== before) {
    writeGraph(root, graph)
    return true
  }
  return false
}

/**
 * 建立两条记忆之间的关联（登记两端节点 + 去重边）。
 *
 * **关联即使用**（2026-09-11 定的 TTL 起始点规则）：建边时顺手刷新两端的
 * `.access.json` 使用时间，于是"被关联过的旧记忆"在下一次归档判定里顺延，
 * 不会因为"写入日期老"而被转冷。
 */
export function linkEntries(root, { from, to, relation = '相关', at = localIso(), touch = true }) {
  const graph = readGraph(root)
  ensureEntity(graph, { id: from.id, label: from.label })
  ensureEntity(graph, { id: to.id, label: to.label })
  graph.edges.push({ from: from.id, to: to.id, relation, at })
  graph.edges = graph.edges.filter((e, i, arr) =>
    arr.findIndex((x) => x.from === e.from && x.to === e.to && x.relation === e.relation) === i)
  writeGraph(root, graph)
  if (touch) {
    try { touchAccess(root, [from.id, to.id]) } catch { /* best-effort：使用记录失败不影响建边 */ }
  }
  return { from: from.id, to: to.id, relation }
}

/** 带锁的登记入口（独立调用时用） */
export function registerEntryLocked(root, raw) {
  return withDirLock(root, () => registerEntry(root, raw))
}
