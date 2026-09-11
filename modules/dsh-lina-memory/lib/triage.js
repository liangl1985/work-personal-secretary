/**
 * lina-memory — **转冷预审**（到期条目的"该不该冷"辅助判断）
 *
 * 主人 2026-09-11 定：
 *   > 「转冷前会做一次判断吗？……应该结合近期日志及热记忆和全局记忆等内容做一次辅助判断，
 *   >   判断完该自然转冷的转冷。不应该将这个部分全部交给用户决定。实在无法确认重要性的再交用户确认。」
 *
 * 于是 TTL 到期**不等于**立即转冷，而是先过三道：
 *
 *   1. **自动保留**（keep）：条目与近 7 天日志 / 全局记忆 / 热记忆主题相关，或含未完结、
 *      决策约定类措辞，或被图谱关联 → 记入保留清单 `.triage.json`，顺延一个 TTL 周期。
 *      （不动条目原文、不伪造"被使用"记录——保留是**显式判断**，不是"用过了"。）
 *   2. **自动转冷**（cold）：含完成/一次性信号（已完成、已装、已卸、已发布…），
 *      或同主题已有更新条目（被取代）→ 直接转冷，不进队列。
 *   3. **待判断**（ask）：信号不足或互相矛盾的，进待判断队列并在注入快照里提醒；
 *      **由莉娜在周保养时逐条判定**（`/memory_triage keep|cold <id>`），
 *      只有莉娜也拿不准的才交主人确认。超过宽限期（默认 7 天）仍未判定 → 自然转冷。
 *
 * 判定是**纯函数**（`judgeEntry`），输入全部来自调用方传入的上下文，便于单测与复演。
 *
 * @module lina-memory/triage
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addDays, diffDays, todayStamp } from './clock.js'
import { MemoryStore, parseEntryTag, extractEntryId, extractEntryDate, stripEntryId } from './store.js'
import { readGraph } from './graph.js'

const TRIAGE_FILE = '.triage.json'

/** 未完结 / 进行中信号：这些条目还有后续价值，不该静默转冷 */
export const UNFINISHED_MARKERS = [
  '待办', '待定', '待确认', '待补', '暂缓', '暂不', '进行中', '未完成', '下一步', '后续',
  '计划', '打算', 'TODO', 'todo', '待验证', '未验收', '未落地', '仍在', '待评估', '未决',
]

/** 决策 / 约定 / 红线信号：跨会话要一直遵守，通常该长期留热 */
export const DECISION_MARKERS = [
  '决策', '约定', '红线', '铁律', '必须', '禁止', '规则', '判据', '口径', '流程', '标准',
  '主人定', '主人批准', '定死', '以后一律', '不再', '默认',
]

/** 完成 / 一次性信号：记录性质，适合自然转冷 */
export const DONE_MARKERS = [
  '已完成', '完成于', '已装', '已卸', '已删除', '已移除', '已发布', '已迁移', '已同步',
  '已完成部署', '修复完成', '已修复', '提交', '通过', '收官', '结束', '一次性', '临时',
]

/** 去掉元信息前缀与纯符号，留下正文 */
export function triageBody(raw) {
  return stripEntryId(String(raw ?? ''))
    .replace(/^(?:\s*\[[^\]]*\]\s*)+/, '')
    .trim()
}

/** 分词：CJK 二元组 + 英文/数字词（去掉 1~2 位纯数字，避免日期噪声） */
export function tokenize(text) {
  const s = String(text ?? '')
  const out = new Set()
  for (const w of s.match(/[A-Za-z][A-Za-z0-9_.@/-]{1,}/g) || []) {
    const t = w.toLowerCase()
    if (t.length >= 2) out.add(t)
  }
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, '\u0000').split('\u0000')
  for (const run of cjk) {
    if (run.length < 2) continue
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2))
    if (run.length >= 3) for (let i = 0; i + 2 < run.length; i += 1) out.add(run.slice(i, i + 3))
  }
  return out
}

/** 重叠系数：公共 token / 较短一方 token（短文本与长文本比对更稳） */
export function overlap(aTokens, bTokens) {
  const a = aTokens instanceof Set ? aTokens : tokenize(aTokens)
  const b = bTokens instanceof Set ? bTokens : tokenize(bTokens)
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const t of a) if (b.has(t)) hit += 1
  return hit / Math.min(a.size, b.size)
}

/** 与一组文本的最高重叠度 */
export function maxOverlap(tokens, texts) {
  let best = 0
  for (const t of texts || []) {
    const s = overlap(tokens, t instanceof Set ? t : tokenize(t))
    if (s > best) best = s
  }
  return best
}

/** 命中的标记词（最多 3 个，用于报告） */
export function hitsOf(body, markers) {
  const out = []
  for (const m of markers) if (body.includes(m)) out.push(m)
  return out.slice(0, 3)
}

/**
 * 预审判定（纯函数）。
 *
 * @param {string} entry - 记忆条目原文
 * @param {object} ctx
 *   - today: 本地日期
 *   - hostFile: 条目当前所在文件（用于"同主题已有更新条目"的比较）
 *   - hotTexts: 热记忆正文（USER.md / 各 PROJECTS，可含本条自身，内部会跳过）
 *   - globalTexts: 全局记忆 MEMORY.md 正文
 *   - recentDailyTexts: 近 7 天日志正文
 *   - graphDegree: 该条在图谱里的关联数
 *   - accessCount: 历史被召回/关联次数
 *   - keepWindowDays: 保留判定顺延的周期（= 该范围的 TTL）
 * @returns {{ decision:'keep'|'cold'|'ask', score:number, reasons:string[], label:string, id:string, date:string }}
 */
export function judgeEntry(entry, ctx = {}) {
  const body = triageBody(entry)
  const tag = parseEntryTag(entry)
  const id = extractEntryId(entry)
  const date = extractEntryDate(entry)
  const reasons = []
  let score = 0

  if (tag === '关键') return { decision: 'keep', score: 99, reasons: ['关键：永不转冷'], id, date, label: body.slice(0, 60) }

  const tokens = tokenize(body)

  // 1. 图谱关联（有关联 = 处于某个知识网络里）
  const deg = Number(ctx.graphDegree || 0)
  if (deg > 0) { score += 2; reasons.push('图谱有 ' + deg + ' 条关联') }

  // 2. 与近 7 天日志的相关度（"近期还在做的事"最强信号）
  const simDaily = maxOverlap(tokens, ctx.recentDailyTexts)
  if (simDaily >= 0.34) { score += 3; reasons.push('与近 7 天日志高度相关（' + simDaily.toFixed(2) + '）') }
  else if (simDaily >= 0.2) { score += 1; reasons.push('与近 7 天日志弱相关（' + simDaily.toFixed(2) + '）') }

  // 3. 与全局记忆主题相关（根本约定牵着的条目）
  const simGlobal = maxOverlap(tokens, ctx.globalTexts)
  if (simGlobal >= 0.34) { score += 2; reasons.push('与全局记忆主题相关（' + simGlobal.toFixed(2) + '）') }

  // 4. 与同范围其他热记忆相关（仍在同一话题簇里）
  const peers = (ctx.hotTexts || []).filter((t) => triageBody(t) !== body)
  const simHot = maxOverlap(tokens, peers)
  if (simHot >= 0.34) { score += 1; reasons.push('与同范围热记忆相关（' + simHot.toFixed(2) + '）') }

  // 5. 未完结 / 决策类措辞
  const unfinished = hitsOf(body, UNFINISHED_MARKERS)
  if (unfinished.length > 0) { score += 3; reasons.push('含未完结信号：' + unfinished.join('、')) }
  const decided = hitsOf(body, DECISION_MARKERS)
  if (decided.length > 0) { score += 2; reasons.push('含决策/约定类措辞：' + decided.join('、')) }

  // 6. 完成 / 一次性信号（负分）
  const done = hitsOf(body, DONE_MARKERS)
  if (done.length > 0) { score -= 2; reasons.push('含完成/一次性信号：' + done.join('、')) }

  // 7. 同主题是否已有更新的条目（被取代 → 这条可以冷）
  const newer = (ctx.hotTexts || [])
    .map((t) => ({ t, d: extractEntryDate(t) || '' }))
    .filter((x) => x.d && date && x.d > date)
    .filter((x) => overlap(tokens, x.t) >= 0.34)
  if (newer.length > 0) { score -= 2; reasons.push('同主题已有更新条目（' + newer[0].d + '）') }

  // 8. 历史使用次数（被反复取用过的，偏保留）
  const cnt = Number(ctx.accessCount || 0)
  if (cnt >= 2) { score += 1; reasons.push('历史被用到 ' + cnt + ' 次') }

  const decision = score >= 3 ? 'keep' : score <= -1 ? 'cold' : 'ask'
  return { decision, score, reasons, id, date, label: body.slice(0, 60) }
}

/**
 * 汇集预审所需的上下文（近期日志 / 全局记忆 / 偏好 / 各项目 / 图谱度数）。
 *
 * @param {string} root
 * @param {object} opts - { today, access, graph, dailyDays=7 }
 * @returns {{ globalTexts:string[], userTexts:string[], projectTexts:Object<string,string[]>,
 *             recentDailyTexts:string[], graphDeg:Map<string,number>, accessCount:(id)=>number }}
 */
export function gatherTriageContext(root, { today = todayStamp(), access = {}, graph = null, dailyDays = 7 } = {}) {
  const readEntries = (p) => {
    try {
      if (!p || !existsSync(p)) return []
      return new MemoryStore(p).entries()
    } catch { return [] }
  }
  const globalTexts = readEntries(join(root, 'MEMORY.md'))
  const userTexts = readEntries(join(root, 'USER.md'))
  const projectTexts = {}
  const projDir = join(root, 'PROJECTS')
  try {
    if (existsSync(projDir)) {
      for (const f of readdirSync(projDir)) {
        if (f.endsWith('.md')) projectTexts['PROJECTS/' + f] = readEntries(join(projDir, f))
      }
    }
  } catch { /* fresh */ }

  const recentDailyTexts = []
  const dailyDir = join(root, 'DAILY')
  try {
    if (existsSync(dailyDir)) {
      for (const f of readdirSync(dailyDir)) {
        if (!f.endsWith('.md')) continue
        const d = f.slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
        const gap = diffDays(today, d)
        if (gap === null || gap < 0 || gap > dailyDays) continue
        recentDailyTexts.push(...readEntries(join(dailyDir, f)))
      }
    }
  } catch { /* fresh */ }

  const graphDeg = new Map()
  try {
    const g = graph && Array.isArray(graph.edges) ? graph : readGraph(root)
    for (const e of g.edges || []) {
      graphDeg.set(e.from, (graphDeg.get(e.from) || 0) + 1)
      graphDeg.set(e.to, (graphDeg.get(e.to) || 0) + 1)
    }
  } catch { /* fresh */ }

  return {
    globalTexts,
    userTexts,
    projectTexts,
    recentDailyTexts,
    graphDeg,
    accessCount: (id) => Number(access?.[id]?.count || 0),
  }
}

/** 读预审状态（保留清单 + 待判断队列） */
export function readTriage(root) {
  try {
    const p = join(root, TRIAGE_FILE)
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      return {
        kept: j && typeof j.kept === 'object' && j.kept ? j.kept : {},
        pending: j && typeof j.pending === 'object' && j.pending ? j.pending : {},
        cold: j && typeof j.cold === 'object' && j.cold ? j.cold : {},
      }
    }
  } catch { /* fresh */ }
  return { kept: {}, pending: {}, cold: {} }
}

/** 写预审状态 */
export function writeTriage(root, state) {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, TRIAGE_FILE), JSON.stringify({
    kept: state.kept || {},
    pending: state.pending || {},
    cold: state.cold || {},
  }, null, 2), 'utf8')
}

/**
 * 记录一条"已判定为冷"（莉娜/主人拍板）：到期时**不再询问**、直接自然转冷。
 * 与 keep 相对，避免同一条目在每次保养里反复进"待判断"。
 */
export function markCold(state, { id, reason = '', by = 'lina', today = todayStamp(), label = '', scope = '' }) {
  if (!id) return null
  const rec = { at: today, by, reason, label, scope }
  state.cold = state.cold || {}
  state.cold[id] = rec
  delete state.kept[id]
  delete state.pending[id]
  return rec
}

/** 是否已判定为冷（返回记录或 null） */
export function coldVerdict(state, id) {
  const c = state?.cold?.[id]
  return c || null
}

/** 该条是否在有效保留窗口内（until >= today） */
export function keepUntil(state, id, today) {
  const k = state?.kept?.[id]
  if (!k || !k.until) return null
  return String(k.until) >= String(today) ? k : null
}

/**
 * 记录一条"保留"判定（默认顺延一个 TTL 周期）。
 * @returns {object} 保留记录
 */
export function markKept(root, state, { id, reason = '', by = 'auto', days = 30, today = todayStamp(), label = '', scope = '' }) {
  if (!id) return null
  const rec = { until: addDays(today, days), at: today, by, reason, label, scope }
  state.kept[id] = rec
  delete state.pending[id]
  return rec
}

/** 记录一条"待判断"（首次进队列时记 since，超过宽限期由调用方决定自然转冷） */
export function markPending(root, state, { id, reason = '', score = 0, days = 30, today = todayStamp(), label = '', scope = '', excerpt = '' }) {
  if (!id) return null
  const prev = state.pending[id] || {}
  state.pending[id] = {
    since: prev.since || today,
    at: today,
    scope: scope || prev.scope || '',
    label: label || prev.label || '',
    excerpt: excerpt || prev.excerpt || '',
    ttlDays: days,
    score,
    reasons: reason ? [reason] : (prev.reasons || []),
  }
  return state.pending[id]
}

/** 该条在待判断队列里等了几天（不在队列 → null） */
export function pendingDays(state, id, today) {
  const p = state?.pending?.[id]
  if (!p || !p.since) return null
  return diffDays(today, p.since)
}

/** 清理预审状态里已不存在的条目 */
export function pruneTriage(root, state, existingIds) {
  let removed = 0
  for (const bucket of ['kept', 'pending', 'cold']) {
    for (const id of Object.keys(state[bucket] || {})) {
      if (!existingIds.has(id)) { delete state[bucket][id]; removed += 1 }
    }
  }
  return removed
}
