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
 *   - branch（会话目录 → 域）：本机 cwd 末段（lina / 知识库-天地）从不在映射表内 → 恒 null，死配置；
 *   - explicit（消息点名）：注入链路从未传入（/expert use 走 buildManualInjection 旁路）→ 死路径；
 *   - role_tag 打分：76 条标签里 57 条与自身关键词重复（同词双计），且「工控安全」这类标签
 *     会让销售位被售前任务顺带命中（实测 2 处误补位）；真正救回过命中的只有「审查」，
 *     现已正式并入 coding-review 的关键词表。role_tag 从此**只作职能去重键**。
 *
 * @module dsh-experts/match
 */

/** 各信号权重（score 归一到 0–1；evidence 只由关键词产生） */
export const WEIGHTS = {
  domain: 0.35,       // 命中本人岗位默认域 —— 只影响同证据时的排序，不再决定是否注入
  keywordEach: 0.2,   // 每个触发关键词命中
  keywordCap: 0.6,    // 关键词合计上限（3 个词封顶）
}

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

  if (ctx.defaultDomain && entry.domain === ctx.defaultDomain) {
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
 *     expertSecondThreshold × 本轮最强证据；上限 expertInjectMax（0 = 不限，其余 clamp 1–3）。
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
    : Math.min(3, Math.max(1, Number.isFinite(rawMax) ? Math.floor(rawMax) : 1))
  const threshold = Number.isFinite(Number(cfg.expertSecondThreshold)) ? Number(cfg.expertSecondThreshold) : 0.8
  const identityId = String(ctx.identityId || '').toLowerCase()

  const selected = []

  /** 去重粒度 = 职能键（role_tag[0]）；缺该字段时回落 domain（向后兼容） */
  const funcKey = (e) => (Array.isArray(e?.role_tag) && e.role_tag[0]) ? String(e.role_tag[0]) : String(e?.domain || '')

  // 0) 身份专家恒选（仅当显式配置了 identityExpert）
  const idItem = identityId ? ranked.find((r) => String(r.entry.id).toLowerCase() === identityId) : null
  if (idItem) selected.push(idItem)

  // 1) 按任务实证选人
  const base = ranked[0] || null
  for (const item of ranked) {
    if (selected.length >= max) break
    if (idItem && item.entry.id === idItem.entry.id) continue
    // ranked 已按 evidence 降序：遇到没有实证的候选即可停止（其后全为 0）
    if (item.evidence === 0) break
    if (selected.length === 0) {
      selected.push(item)
      continue
    }
    if (selected.some((s) => funcKey(s.entry) === funcKey(item.entry))) continue // 同职能不叠加
    const ref = base || selected[0]
    if (ref.evidence <= 0) break
    if (item.evidence < ref.evidence * threshold) continue
    selected.push(item)
  }

  const reason = selected.length === 0
    ? (ranked.length === 0 ? 'no-experts' : 'no-evidence')
    : (idItem ? 'identity+' + (selected.length - 1) : 'top' + selected.length)

  return { selected, ranked, reason }
}
