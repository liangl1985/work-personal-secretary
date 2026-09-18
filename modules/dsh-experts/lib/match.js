/**
 * dsh-experts — 匹配打分（纯函数，无副作用，可单测）
 *
 * 打分 v3（2026-09-14 简化，依据实测数据）—— 只保留**两条信号**：
 *   - **evidence**（关键词命中：0.2/词，上限 0.6）：**唯一决定"是否注入"**的信号；
 *   - **score** = evidence + domain（岗位先验 0.35）：只用于**同一证据档内的排序**。
 *
 * 排序：evidence 降序 → score 降序 → index.json 顺序。
 * 选择：零命中（evidence === 0）不注入（宁缺勿滥）；命中后按职能键去重，
 *       第二位须达到 expertSecondThreshold × 本轮最强证据（纯证据比较）。
 *
 * 为什么砍掉三个旧信号（2026-09-14 实测）：
 *   - branch（会话目录 → 域）：本机 cwd 末段（<会话目录> / <业务知识库>）从不在映射表内 → 恒 null，死配置；
 *   - explicit（消息点名）：注入链路从未传入（/expert use 走 buildManualInjection 旁路）→ 死路径；
 *   - role_tag 打分：76 条标签里 57 条与自身关键词重复（同词双计），且「工控安全」这类标签
 *     会让销售位被售前任务顺带命中（实测 2 处误补位）；真正救回过命中的只有「审查」，
 *     现已正式并入 coding-review 的关键词表。role_tag 从此**只作职能去重键**。
 *
 * @module dsh-experts/match
 */

import { INJECT_MAX_HARD } from './limits.js'

/** 各信号权重（score 归一到 0–1；evidence 只由关键词产生） */
export const WEIGHTS = {
  domain: 0.35,       // **域专家**：命中本人岗位默认域
  general: 0.15,      // **通用型专家**：恒定通用先验（方法层，对任何任务都可能有用）—— 2026-09-15 新增
  keywordEach: 0.2,   // 每个触发关键词命中
  keywordCap: 0.6,    // 关键词合计上限（3 个词封顶）
}

/** 通用职能域（与行业域分开评分、分开配额） */
export const GENERAL_DOMAIN = 'general'

/** 取触发关键词命中的列表（中文短词直接 includes，无需分词） */
export function keywordHits(entry, text) {
  const kws = Array.isArray(entry?.trigger_keywords) ? entry.trigger_keywords : []
  return kws.filter((k) => k && text.includes(k))
}

/**
 * 给单个专家打分。
 * @param {object} entry - index.json 里的专家条目
 * @param {object} ctx - { text, defaultDomain }
 * @returns {{score:number, evidence:number, reasons:string[]}}
 */
export function scoreEntry(entry, ctx = {}) {
  const text = String(ctx.text || '')
  const reasons = []
  let score = 0
  let evidence = 0

  // 2026-09-15：**通用型专家与域专家分开评分** ——
  //   域专家只有命中本人岗位域才拿先验（0.35）；
  //   通用型专家没有岗位域，改拿恒定通用先验（0.15），否则在 defaultDomain=infosec 下永远吃亏。
  if (String(entry?.domain || '') === GENERAL_DOMAIN) {
    score += WEIGHTS.general
    reasons.push('通用职能·' + GENERAL_DOMAIN)
  } else if (ctx.defaultDomain && entry.domain === ctx.defaultDomain) {
    score += WEIGHTS.domain
    reasons.push('岗位域·' + entry.domain)
  }
  if (text) {
    const hits = keywordHits(entry, text)
    if (hits.length > 0) {
      const part = Math.min(WEIGHTS.keywordCap, hits.length * WEIGHTS.keywordEach)
      score += part
      evidence += part
      reasons.push('关键词·' + hits.join('/'))
    }
  }

  return { score: Number(score.toFixed(4)), evidence: Number(evidence.toFixed(4)), reasons }
}

/**
 * 全体专家排序：**任务实证（evidence）> 总分 > index.json 顺序**。
 *
 * 有任务实据的排在只有岗位先验的之前；同 evidence 档内按总分降序
 * （岗位先验在这里起"平手时本域优先"的作用），最后按 index.json 顺序稳定排列。
 *
 * @param {Array<object>} entries - 参与匹配的专家（通常来自 activeExperts()）
 * @param {object} ctx - 打分上下文
 * @returns {Array<{entry:object, score:number, evidence:number, reasons:string[]}>}
 */
export function rankExperts(entries, ctx = {}) {
  return (entries || [])
    .map((entry, i) => ({ entry, i, ...scoreEntry(entry, ctx) }))
    .sort((a, b) =>
      (b.evidence - a.evidence)
      || (b.score - a.score)
      || (a.i - b.i))
    .map(({ entry, score, evidence, reasons }) => ({ entry, score, evidence, reasons }))
}

/**
 * 选出本轮要注入的专家。
 *
 * 规则（2026-09-14 简化）：
 *   - **零命中不注入**：没有任务实证（evidence === 0）就一位都不注入 —— 未命中由
 *     目录段 + 模型自判 + expert_recall 承担（design-v2：宁缺勿滥）；
 *   - **身份专家可选常驻**：仅当显式配置 identityExpert 时恒选（留空 = 不常驻）；
 *   - **第二位**：按职能键（role_tag[0]）去重，证据须达到
 *     expertSecondThreshold × 本轮最强证据；上限 expertInjectMax（0 = 不限，其余 clamp 1–4，硬上限见 limits.js）。
 *
 * @param {Array<object>} entries - 参与匹配的专家
 * @param {object} ctx - 打分上下文（含 identityId）
 * @param {object} cfg - 归一化设置（expertInjectMax / expertSecondThreshold）
 * @returns {{selected:Array, ranked:Array, reason:string}}
 */
export function selectExperts(entries, ctx = {}, cfg = {}) {
  const ranked = rankExperts(entries, ctx)
  const rawMax = Number(cfg.expertInjectMax)
  const max = (Number.isFinite(rawMax) && rawMax === 0)
    ? Number.POSITIVE_INFINITY
    : Math.min(INJECT_MAX_HARD, Math.max(1, Number.isFinite(rawMax) ? Math.floor(rawMax) : 1))
  // 兜底值须与 settings.js 的 DEFAULTS 一致（2026-09-15：0.8 → 0.3 —— 相对门槛设高会把第 2/3 位挡在外面）
  const threshold = Number.isFinite(Number(cfg.expertSecondThreshold)) ? Number(cfg.expertSecondThreshold) : 0.3
  const identityId = String(ctx.identityId || '').toLowerCase()
  // 通用型专家的**独立配额**（默认保底 1 位）与**独立绝对门槛**（默认 evidence ≥ 0.2 = 命中 1 个关键词）
  const rawGen = Number(cfg.expertGeneralMax)
  const generalQuota = Number.isFinite(rawGen) && rawGen >= 0 ? Math.floor(rawGen) : 1
  const rawGenMin = Number(cfg.expertGeneralMinEvidence)
  const generalMinEvidence = Number.isFinite(rawGenMin) && rawGenMin >= 0 ? rawGenMin : 0.2

  const selected = []

  /** 去重粒度 = 职能键（role_tag[0]）；缺该字段时回落 domain（向后兼容） */
  const funcKey = (e) => (Array.isArray(e?.role_tag) && e.role_tag[0]) ? String(e.role_tag[0]) : String(e?.domain || '')
  const isGeneral = (it) => String(it.entry?.domain || '') === GENERAL_DOMAIN

  // 0) 身份专家恒选（仅当显式配置了 identityExpert）
  const idItem = identityId ? ranked.find((r) => String(r.entry.id).toLowerCase() === identityId) : null
  if (idItem) selected.push(idItem)

  const base = ranked[0] || null
  // 零命中不注入（宁缺勿滥）：连一位有实证的候选都没有时，通用先验也不单独触发
  if (!base || base.evidence <= 0) {
    return { selected, ranked, reason: ranked.length === 0 ? 'no-experts' : 'no-evidence' }
  }

  const pushable = (it) => it.evidence > 0
    && !selected.some((s) => s.entry.id === it.entry.id)
    && !selected.some((s) => funcKey(s.entry) === funcKey(it.entry))
  const push = (it) => { selected.push(it) }

  // **双赛道**（2026-09-15）：域专家按「相对门槛」（最强证据 × exponentSecondThreshold）比；
  // 通用型专家按「独立绝对门槛」比 —— 两者的证据分布天然不同（通用词更泛、证据更低），
  // 用同一把尺会让通用专家永远补不进来（实测：defaultDomain=infosec 时它连 0.35 的岗位先验都拿不到）。
  const domPool = ranked.filter((it) => pushable(it) && !isGeneral(it) && it.evidence >= base.evidence * threshold)
  const genPool = ranked.filter((it) => pushable(it) && isGeneral(it) && it.evidence >= generalMinEvidence)

  // 1) 通用赛道**保底**占位（先占 quota，保证「方法层」在场；上限内）
  let genPicked = 0
  for (const it of genPool) {
    if (selected.length >= max || genPicked >= generalQuota) break
    if (pushable(it)) { push(it); genPicked += 1 }
  }
  // 2) 域赛道填满剩余名额
  for (const it of domPool) {
    if (selected.length >= max) break
    if (pushable(it)) push(it)
  }
  // 3) 域专家不足时，通用专家再补（吃满上限，避免空位浪费）
  for (const it of genPool) {
    if (selected.length >= max) break
    if (pushable(it)) push(it)
  }

  const reason = selected.length === 0
    ? 'no-evidence'
    : (idItem ? 'identity+' + (selected.length - 1) : 'top' + selected.length)

  return { selected, ranked, reason }
}

/**
 * 干活轮「给全文」的选取（2026-09-16 修正）。
 *
 * **不能用 `selected.slice(0, n)`**：`selected` 是**构造顺序** ——
 * 「身份专家 → 通用赛道保底占位 → 域专家」，通用型专家被保底机制**先 push**，
 * 因此常落在 `selected[0]`；直接切片会让它**恒定占掉一个全文名额**，把证据更高的域专家挤出去
 * （真机实测：干活轮给了 general-typeset 0.2 + infosec-ics-security 0.4，
 * 而并列最高、证据 0.4 的 infosec-bid-proposal 被挤出）。
 * 证据序在 `ranked`（证据降序 → 分数降序 → 索引顺序）里，故按它的次序取前 `max` 位，
 * 兑现「按本轮任务证据取最大 + 次大」的口径。
 *
 * @param {Array<{entry:object,evidence:number,score:number}>} selected - selectExperts 的选中集合（构造顺序）
 * @param {Array<{entry:object}>} ranked - selectExperts 的全量排序（证据降序）
 * @param {number} max - 给全文的位数（expertFullHitMax）
 * @returns {Array} 按证据降序排好的前 max 位；不改动入参，max ≤ 0 或空集合返回 []
 */
export function pickWorkers(selected, ranked, max) {
  const n = Math.max(0, Math.floor(Number(max) || 0))
  if (n === 0 || !Array.isArray(selected) || selected.length === 0) return []
  const order = new Map((Array.isArray(ranked) ? ranked : []).map((it, i) => [it?.entry?.id, i]))
  const fallback = Number.MAX_SAFE_INTEGER
  return [...selected]
    .sort((a, b) => (order.get(a?.entry?.id) ?? fallback) - (order.get(b?.entry?.id) ?? fallback))
    .slice(0, n)
}
