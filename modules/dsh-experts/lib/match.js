/**
 * dsh-experts — 匹配打分（纯函数，无副作用，可单测）
 *
 * 两套分数，各司其职：
 *   - **总分**（`score`）决定"本轮主角是谁"：岗位先验 + 会话域 + 关键词/标签 + 显式指令；
 *   - **证据分**（`evidence`）只统计**任务文本里的实证**（关键词 + 角色标签命中），
 *     决定**排序先后**与"要不要再补一位跨域专家"。
 *
 * 为什么不能只看总分：岗位先验给本域每位专家都加同样的分（0.35），
 * 使跨域专家在总分上天然吃亏。于是"这份合同的钱怎么算、税怎么处理"（法务+会计）
 * 这类任务里，对口专家（0.20–0.25）永远排在"只沾岗位域"的本域专家（0.35）之后 ——
 * 而它恰恰是该命中的场景（2026-09-13 真机实测：期望法务+会计，实际返回投标策略师）。
 * 所以排序**先看实证、再看总分**：有实证的专家排在"只有先验"的专家之前；
 * 补位同样比**跨域证据的强度**，不是被岗位先验抬高的总分。
 * 取舍是刻意的：任务里偶然出现的一个词会把跨域对口专家排到前面 —— 宁可命中者优先，
 * 也不要"只靠岗位域兜底"；而**显式指定**（/expert use、消息点名）永远最高优先。
 *
 * 权重口径（产品口径 2026-09-12 定：岗位先验权重最高，但任务信号明确时应压过先验）：
 *   显式指令 > 岗位默认域 ≈ 密集关键词 > 会话域 > 零散标签
 *
 * @module dsh-experts/match
 */

/** 各信号权重（总分归一到 0–1 区间，便于设置页用 expertMinScore 卡阈值） */
export const WEIGHTS = {
  explicit: 1.0,      // /expert use <id> 或消息里点名某位专家
  domain: 0.35,       // 命中本人岗位默认域（短任务"帮我看看这个"靠它兜底）
  branch: 0.15,       // 命中会话工作目录推断出的域
  keywordEach: 0.2,   // 每个触发关键词命中（**两个命中即可压过岗位先验**）
  keywordCap: 0.6,    // 关键词合计上限
  roleTagEach: 0.05,  // 每个角色标签命中
  roleTagCap: 0.1,    // 角色标签合计上限
}

/**
 * 会话工作目录末段名 → 域（branch 先验，权重较低，仅作弱提示）。
 * 采用**通用岗位/业务目录名**，不绑定任何特定工作区结构；
 * 目录名命中不了就返回 null（退化为只有岗位域与任务信号，不影响其余匹配）。
 */
export const BRANCH_DOMAIN_HINTS = {
  售前: 'infosec',
  投标: 'infosec',
  方案: 'infosec',
  客户: 'infosec',
  报价: 'infosec',
  安全: 'infosec',
  工控: 'infosec',
  等保: 'infosec',
  财务: 'accounting',
  会计: 'accounting',
  税务: 'accounting',
  报表: 'accounting',
  发票: 'accounting',
  人力: 'hr',
  招聘: 'hr',
  绩效: 'hr',
  代码: 'coding',
  插件: 'coding',
  仓库: 'coding',
  投资: 'finance',
  策略: 'finance',
  量化: 'finance',
  法务: 'general',
  合同: 'general',
  诉讼: 'general',
  文档: 'general',
  报告: 'general',
  排版: 'general',
  工作: 'general',
  笔记: 'general',
  资料: 'general',
  docs: 'general',
  notes: 'general',
}

/** 取触发关键词命中的列表（中文短词直接 includes，无需分词） */
export function keywordHits(entry, text) {
  const kws = Array.isArray(entry?.trigger_keywords) ? entry.trigger_keywords : []
  return kws.filter((k) => k && text.includes(k))
}

/** 取角色标签命中的列表 */
export function roleTagHits(entry, text) {
  const tags = Array.isArray(entry?.role_tag) ? entry.role_tag : []
  return tags.filter((t) => t && text.includes(t))
}

/**
 * 给单个专家打分。
 * @param {object} entry - index.json 里的专家条目
 * @param {object} ctx - { text, defaultDomain, branchDomain, explicitId }
 * @returns {{score:number, evidence:number, reasons:string[]}}
 */
export function scoreEntry(entry, ctx = {}) {
  const text = String(ctx.text || '')
  const reasons = []
  let score = 0
  let evidence = 0

  if (ctx.explicitId && String(entry.id).toLowerCase() === String(ctx.explicitId).toLowerCase()) {
    score += WEIGHTS.explicit
    reasons.push('显式指定')
  }
  // 岗位域与会话域是**同一类先验**（"使用者在哪个语境"），取较大者而非相加：
  // 相加会把本域专家双重抬高，压过任务里明确且密集的跨域信号
  // （例："客户要做三级等保测评，定级备案怎么走" 应命中等保测评专家，
  //  而不是本域的网络安全售前 —— 后者只命中"等保"一个词，却拿了先验双份加分）。
  const inHome = Boolean(ctx.defaultDomain) && entry.domain === ctx.defaultDomain
  const inBranch = Boolean(ctx.branchDomain) && entry.domain === ctx.branchDomain
  if (inHome) {
    score += WEIGHTS.domain
    reasons.push('岗位域·' + entry.domain)
  } else if (inBranch) {
    score += WEIGHTS.branch
    reasons.push('会话域·' + entry.domain)
  }
  if (text) {
    const hits = keywordHits(entry, text)
    if (hits.length > 0) {
      const part = Math.min(WEIGHTS.keywordCap, hits.length * WEIGHTS.keywordEach)
      score += part
      evidence += part
      reasons.push('关键词·' + hits.join('/'))
    }
    const tagHits = roleTagHits(entry, text)
    if (tagHits.length > 0) {
      const part = Math.min(WEIGHTS.roleTagCap, tagHits.length * WEIGHTS.roleTagEach)
      score += part
      evidence += part
      reasons.push('标签·' + tagHits.join('/'))
    }
  }

  return { score: Number(score.toFixed(4)), evidence: Number(evidence.toFixed(4)), reasons }
}

/**
 * 全体专家排序：**显式指定 > 任务实证（evidence）> 总分 > index.json 顺序**。
 *
 * 排序口径（2026-09-14 修「跨域单关键词任务被岗位域先验压过」）：
 *   总分里的岗位先验（0.35）给本域每位专家同样的分，而单关键词命中的跨域对口专家
 *   只有 0.20–0.25 —— 纯按总分排，对口专家永远排在"只沾岗位域"的本域专家之后。
 *   改为先比 evidence（只有任务文本里有实据的专家才 > 0），把有实据的排前面、
 *   只靠先验兜底的退后面；同 evidence 档内仍按总分降序，最后按 index.json 顺序稳定排列。
 *   显式指定单独占最高优先级，完全不受 evidence 影响。
 * @param {Array<object>} entries - 参与匹配的专家（通常来自 activeExperts()）
 * @param {object} ctx - 打分上下文
 * @returns {Array<{entry:object, score:number, evidence:number, reasons:string[]}>}
 */
export function rankExperts(entries, ctx = {}) {
  const explicitRank = (x) => (x.reasons.includes('显式指定') ? 1 : 0)
  return (entries || [])
    .map((entry, i) => ({ entry, i, ...scoreEntry(entry, ctx) }))
    .sort((a, b) =>
      (explicitRank(b) - explicitRank(a))
      || (b.evidence - a.evidence)
      || (b.score - a.score)
      || (a.i - b.i))
    .map(({ entry, score, evidence, reasons }) => ({ entry, score, evidence, reasons }))
}

/**
 * 选出本轮要注入的专家。
 *
 * 规则（产品口径 2026-09-12 定，2026-09-12 二次确认「身份专家常驻」）：
 *   - **身份专家恒选**：`ctx.identityId`（切合使用者身份的那一位）**常驻注入**，
 *     不参与阈值淘汰 —— 哪怕本轮问题不在它的专业方向（它是"我是谁"的默认视角）；
 *   - **其余按问题归属补位**：仅当 `expertInjectMax ≥ 2` 且**跨域**才考虑，满足其一即补：
 *       a) 分数 ≥ 本轮最强信号 × expertSecondThreshold；或
 *       b) 证据分 ≥ 本轮最强证据分 × expertSecondThreshold（最强信号有实证时）；或
 *       c) 最强信号只是岗位先验兜底（证据分 0），而该位有实证 —— 说明任务其实指向它；
 *   - **未命中就不注入**：没有身份专家、分数又低于 `expertMinScore` 时，本轮不注入，
 *     保持通用助手行为（宁缺勿滥）；
 *   - 同域不叠加（同域多注只是重复视角，白吃 TOKEN）。
 *
 * @param {Array<object>} entries - 参与匹配的专家
 * @param {object} ctx - 打分上下文（含 identityId）
 * @param {object} cfg - 归一化后的设置（expertInjectMax / expertSecondThreshold / expertMinScore）
 * @returns {{selected:Array, ranked:Array, reason:string}}
 */
export function selectExperts(entries, ctx = {}, cfg = {}) {
  const ranked = rankExperts(entries, ctx)
  // 0 = 不限（交由预算与阈值守门）；其余按硬边界 clamp，绝不静默超限
  const rawMax = Number(cfg.expertInjectMax)
  const max = (Number.isFinite(rawMax) && rawMax === 0)
    ? Number.POSITIVE_INFINITY
    : Math.min(3, Math.max(1, Number.isFinite(rawMax) ? Math.floor(rawMax) : 1))
  const minScore = Number.isFinite(Number(cfg.expertMinScore)) ? Number(cfg.expertMinScore) : 0.35
  const threshold = Number.isFinite(Number(cfg.expertSecondThreshold)) ? Number(cfg.expertSecondThreshold) : 0.8
  const identityId = String(ctx.identityId || '').toLowerCase()

  const selected = []

  /** 去重粒度 = 职能键（role_tag[0]）；缺该字段时回落 domain（向后兼容） */
  const funcKey = (e) => (Array.isArray(e?.role_tag) && e.role_tag[0]) ? String(e.role_tag[0]) : String(e?.domain || '')

  // 1) 身份专家恒选：常驻的唯一身份视角
  const idItem = identityId ? ranked.find((r) => String(r.entry.id).toLowerCase() === identityId) : null
  if (idItem) selected.push(idItem)

  // 2) 其余按问题归属补位（总上限 = expertInjectMax，含身份专家）
  const base = ranked[0] || null
  for (const item of ranked) {
    if (selected.length >= max) break
    if (idItem && item.entry.id === idItem.entry.id) continue
    if (selected.length === 0) {
      const explicit = item.reasons.includes('显式指定')
      // 门槛只卡「没有任何任务实证」的候选：evidence > 0 说明任务确实指向它，
      // 哪怕总分低于 expertMinScore 也注入；纯靠岗位先验兜底的才受 minScore 约束。
      if (!explicit && item.evidence === 0 && item.score < minScore) break
      selected.push(item)
      continue
    }
    if (selected.some((s) => funcKey(s.entry) === funcKey(item.entry))) continue // 同职能不叠加（域已划粗为行业）

    const ref = base || selected[0]
    // 纯先验兜底不得补位：基准有实证时，只沾岗位先验（evidence=0）的候选与本轮任务无关
    if (ref.evidence > 0 && item.evidence === 0) continue
    const byScore = item.score >= ref.score * threshold
    const byEvidence = ref.evidence > 0
      ? item.evidence >= ref.evidence * threshold
      : item.evidence > 0
    if (!byScore && !byEvidence) continue

    selected.push(item)
  }

  const reason = selected.length === 0
    ? (ranked.length === 0 ? 'no-experts' : 'below-threshold')
    : (idItem ? 'identity+' + (selected.length - 1) : 'top' + selected.length)

  return { selected, ranked, reason }
}
