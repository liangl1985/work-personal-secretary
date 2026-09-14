/**
 * dsh-experts — 注入文本组装（三级注入：L0 目录 / L1 精简卡 / L2 全文）
 *
 * 注入形态（与记忆快照并列进 systemPrompt.context）：
 *   【处理路径】先用下方身份视角判断问题归属：命中专家 → 按该专家视角处理
 *   （要独立作业就派子代理并把 persona 内联进 prompt）；未命中 → 用通用能力原生处理。
 *
 *   【身份视角·工控安全售前（本人岗位）】
 *   <L1 精简卡（默认，约 0.4–0.7 千字符）或 L2 全文>
 *   （身份视角：常驻…）
 *
 * 三级口径（产品口径 2026-09-14 定）：
 *   - **L0 目录**：默认不注入正文；索引靠 expert_recall / `/expert list` 可见；
 *   - **L1 精简卡**（本文件 buildPersonaCard，确定性生成）：角色段首句 + 工作方法前 3 条
 *     + 交付与自检前 2 条 + when_to_use 一行；带尾注「精简卡 · 全文用 expert_recall 取」；
 *   - **L2 全文**：`/expert use <id>`、`expert_recall`、派子代理内联 时使用（不变）。
 *
 * 每轮预算（expertInjectBudgetChars，默认 1400 字符）：超预算按序降级
 *   命中专家全文 → 命中专家精简卡 → 只留身份专家精简卡；连最低形态都放不下时硬截断，
 *   **任何降级与截断都会写明**（绝不静默超限）。
 *
 * 硬约束：精简卡只从 persona 正文**确定性解析**得出，不重写、不修改 experts/**.md；
 * 解析失败/段落缺失时回退「全文截断」，**永不产出空块**。
 *
 * @module dsh-experts/inject
 */

import { loadPersona } from './store.js'
import { clampBudget, normalizeDetail, INJECT_BUDGET_DEFAULT } from './limits.js'

export { INJECT_BUDGET_DEFAULT }

/**
 * 单条 persona 正文的字符上限（超出截断并标注，绝不静默丢弃）。
 * 取 3000 是因为实测 20 位 persona 为 1250–1730 字（非空白），留足余量；
 * 截断只在有人手工写入超长 persona 时才会触发。
 */
export const PERSONA_MAX_CHARS = 3000

/** 每轮注入开头的处理路径提示（让"先判断归属再决定处理方式"成为显式流程） */
export const PATH_HINT = '【处理路径】先用下方身份视角判断问题归属：命中专家 → 按该专家视角处理'
  + '（需要独立作业就派子代理，并用 expert_recall 把 persona 内联进 prompt）；未命中 → 用通用能力原生处理。'

/** 身份视角块的尾注 */
export const IDENTITY_NOTE = '（身份视角：常驻，代表使用者岗位；本轮问题不在它的方向时不必强套，改按命中的专家视角处理）'

/** 本轮命中块的尾注 */
export const MATCH_NOTE = '（本轮命中：按问题归属激活；与本轮任务无关时忽略）'

/** 临时注入块的尾注 */
export const MANUAL_NOTE = '（临时注入：仅本会话生效，不常驻上下文；/expert off 关闭，/expert auto 恢复自动）'

/** 精简卡尾注（要求原样出现：「精简卡 · 全文用 expert_recall 取」） */
export const CARD_NOTE = '精简卡 · 全文用 expert_recall 取'

/** 精简卡生成参数（确定性：同输入同输出；长度上限保证一张卡约 400–700 字符） */
export const CARD_ROLE_MAX_CHARS = 80
/** 角色首句过短时续接到此长度（信息量下限，仍记作「首句」） */
export const CARD_ROLE_MIN_CHARS = 40
export const CARD_METHOD_MAX_CHARS = 60
export const CARD_METHOD_COUNT = 3
export const CARD_DELIVERY_MAX_CHARS = 90
export const CARD_DELIVERY_COUNT = 2
export const CARD_WHEN_MAX_CHARS = 80

const SENTENCE_END = /(?<=[。！？!?；;])/
const LIST_ITEM = /^\s*(?:\d+[.、)]|[-*•])\s+(.+)$/
const SECTION_TITLE = /^#{2,3}\s*(.+?)\s*$/

/** 去掉 markdown 强调标记与换行，得到单行纯文本（确定性） */
function stripMarks(text) {
  return String(text ?? '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
}

/** 压平空白后按上限截断（超长加省略号；确定性） */
function clip(text, maxChars) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  return s.length > maxChars ? s.slice(0, maxChars) + '…' : s
}

/**
 * 首句（按中英文句读切）；首句过短（< minChars）时顺次续接后续分句，最终不超过 maxChars。
 * 用于「角色段首句（≤80 字）」：既不越上限，也不因原文首句过短而丢信息。
 */
function leadSentence(text, maxChars, minChars = 0) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  const parts = s.split(SENTENCE_END).map((x) => x.trim()).filter(Boolean)
  let head = parts[0] || s
  for (let i = 1; i < parts.length && head.length < minChars; i++) head += parts[i]
  return clip(head, maxChars)
}

/** 段落文本 → 列表项（编号 / 项目符号；续行并入上一项） */
function listItems(text) {
  const out = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = LIST_ITEM.exec(line)
    if (m) {
      out.push(stripMarks(m[1]))
      continue
    }
    if (out.length > 0 && line.trim()) out[out.length - 1] += ' ' + stripMarks(line)
  }
  return out.filter(Boolean)
}

/**
 * 确定性解析 persona 正文的三段结构。
 * 只按标题关键词定位（## 角色 / ## 工作方法… / ## 交付与自检），不依赖下标位置。
 * @param {string} body - persona 正文
 * @returns {{ role:string, methods:string[], deliveries:string[], ok:boolean }}
 */
export function parsePersonaSections(body) {
  const text = String(body ?? '')
  if (!text.trim()) return { role: '', methods: [], deliveries: [], ok: false }
  const sections = new Map()
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    const m = SECTION_TITLE.exec(line)
    if (m) {
      cur = m[1]
      sections.set(cur, [])
      continue
    }
    if (cur) sections.get(cur).push(line)
  }
  const pick = (words) => {
    for (const [title, lines] of sections) {
      if (words.some((w) => title.includes(w))) return lines.join('\n')
    }
    return ''
  }
  const role = stripMarks(pick(['角色']))
  const methods = listItems(pick(['工作方法']))
  const deliveries = listItems(pick(['交付', '自检']))
  const ok = !!(role || methods.length > 0 || deliveries.length > 0)
  return { role, methods, deliveries, ok }
}

/** 全文截断（超 PERSONA_MAX_CHARS 时截断并标注）——full 形态与卡回退共用 */
function clipPersona(entry, text) {
  const s = String(text ?? '').trim()
  if (s.length <= PERSONA_MAX_CHARS) return s
  return s.slice(0, PERSONA_MAX_CHARS)
    + '\n…（persona 超出上限，已截断；请精简 experts/' + (entry?.file || '') + '）'
}

/**
 * L1 精简卡：从 persona 正文**确定性**生成（同输入同输出）。
 * 角色段首句（≤80 字）+ 工作方法前 3 条（每条 ≤60 字）+ 交付与自检前 2 条（每条 ≤90 字）
 * + when_to_use 一行（≤80 字）。
 * 解析失败或段落缺失 → 回退「全文截断」并标注，**永不产出空块**。
 * @returns {string} 卡正文（不含标题与尾注；空串仅当正文为空）
 */
export function buildPersonaCard(entry, body) {
  const text = String(body ?? '').trim()
  if (!text) return ''
  const { role, methods, deliveries, ok } = parsePersonaSections(text)
  if (!ok || methods.length === 0) {
    return clipPersona(entry, text) + '\n（结构未识别 · 已回退全文截断 · 全文用 expert_recall 取）'
  }
  const lines = []
  const roleLine = leadSentence(role, CARD_ROLE_MAX_CHARS, CARD_ROLE_MIN_CHARS)
  if (roleLine) lines.push('角色：' + roleLine)
  const methods3 = methods.slice(0, CARD_METHOD_COUNT)
    .map((t, i) => (i + 1) + ') ' + clip(t, CARD_METHOD_MAX_CHARS))
  if (methods3.length > 0) lines.push('方法：' + methods3.join('  '))
  const deliveries2 = deliveries.slice(0, CARD_DELIVERY_COUNT)
    .map((t) => '• ' + clip(t, CARD_DELIVERY_MAX_CHARS))
  if (deliveries2.length > 0) lines.push('交付：' + deliveries2.join('  '))
  const when = stripMarks(entry?.when_to_use || '').slice(0, CARD_WHEN_MAX_CHARS)
  if (when) lines.push('适用：' + when)
  if (lines.length === 0) return clipPersona(entry, text)
  return lines.join('\n')
}

/** 形态 → 卡尾注（identity / match / manual 三种语义不变，只多标"精简卡"与取全文方式） */
function cardNote(kind) {
  const scope = kind === 'identity' ? '身份视角' : (kind === 'manual' ? '临时注入' : '本轮命中')
  return '（' + scope + '·' + CARD_NOTE + '）'
}

/**
 * 组装一位专家的注入块（对外契约不变：banner / kind / note 语义与旧版一致）。
 * @param {object} entry - 专家元数据
 * @param {string} body - persona 正文
 * @param {object} opts - { banner, kind: 'identity'|'match'|'manual', note, detail: 'full'|'card' }
 *   detail 默认 'full' —— 旧调用方（不传 detail）行为与旧版**完全一致**；
 *   注入形态由设置 expertInjectDetail 决定，由 buildInjection() 显式传入。
 */
export function buildPersonaBlock(entry, body, { banner = true, kind = 'match', note = null, detail = 'full' } = {}) {
  const text = String(body || '').trim()
  if (!text) return ''
  const useCard = String(detail).toLowerCase() === 'card'
  const rendered = useCard ? buildPersonaCard(entry, text) : clipPersona(entry, text)
  if (!rendered) return ''

  const head = !banner
    ? ''
    : (kind === 'identity'
        ? '【身份视角·' + entry.name + (entry.domain_name ? '（' + entry.domain_name + '）' : '') + '】'
        : (kind === 'manual'
            ? '【临时注入·' + entry.name + '】'
            : '【本轮命中·' + entry.name + '】'))

  const defaultNote = useCard
    ? cardNote(kind)
    : (kind === 'identity' ? IDENTITY_NOTE : (kind === 'manual' ? MANUAL_NOTE : MATCH_NOTE))

  return [head, rendered, note || defaultNote].filter(Boolean).join('\n')
}

/** 身份/保底项：只留身份专家（没有身份专家时留第一位） */
function coreItems(items) {
  const identity = items.find((it) => it.isIdentity)
  if (identity) return [identity]
  return items.length > 0 ? [items[0]] : []
}

/** 渲染一个降级级别（mode: 'full' | 'card' | 'mixed'；mixed = 身份卡 + 命中全文） */
function renderLevel(list, mode, banner) {
  const blocks = []
  for (const it of list) {
    const detail = mode === 'mixed' ? (it.isIdentity ? 'card' : 'full') : mode
    blocks.push(buildPersonaBlock(it.entry, it.body, {
      banner,
      kind: it.isIdentity ? 'identity' : 'match',
      detail,
    }))
  }
  return blocks.filter(Boolean).join('\n\n')
}

/**
 * 选形态 + 按预算降级（绝不静默）。
 * @returns {{ text:string, notes:string[] }}
 */
function planInjection(items, { detail, budget, banner }) {
  const core = coreItems(items)
  let levels
  if (detail === 'full') {
    levels = [{ tag: 'full', mode: 'full', list: items }]
  } else if (detail === 'card') {
    levels = [
      { tag: 'card', mode: 'card', list: items },
      { tag: 'card-core', mode: 'card', list: core },
    ]
  } else {
    levels = [
      { tag: 'mixed', mode: 'mixed', list: items },
      { tag: 'card', mode: 'card', list: items },
      { tag: 'card-core', mode: 'card', list: core },
    ]
  }
  // 同一 (mode, 成员) 的级别只留一个（例如只有身份专家时 mixed 与 card 同文）
  const seen = new Set()
  const uniq = []
  for (const lv of levels) {
    const sig = lv.mode + '|' + lv.list.map((it) => it.entry.id).join(',')
    if (seen.has(sig)) continue
    seen.add(sig)
    uniq.push(lv)
  }

  let chosen = null
  let chosenIndex = -1
  for (let i = 0; i < uniq.length; i++) {
    const lv = uniq[i]
    const text = renderLevel(lv.list, lv.mode, banner)
    if (!text) continue
    const fits = detail === 'full' || text.length <= budget
    chosen = { lv, text }
    chosenIndex = i
    if (fits) break
  }
  if (!chosen) return { text: '', notes: [] }

  const notes = []
  const injectedIds = new Set(chosen.lv.list.map((it) => it.entry.id))
  const dropped = items.filter((it) => !injectedIds.has(it.entry.id))
  let text = chosen.text
  let truncated = false

  if (detail !== 'full' && text.length > budget) {
    // 连最低形态都放不下 → 硬截断（标注写在截断处，绝不静默超限）
    const note = '（本轮预算 ' + budget + ' 字符：已截断 · 全文用 expert_recall 取）'
    const keep = Math.max(0, budget - note.length)
    text = text.slice(0, keep) + '…' + note
    truncated = true
  }

  if (detail !== 'full' && !truncated && chosenIndex > 0) {
    // 口径（2026-09-14 读稿调整）：auto/card 下「命中专家用精简卡」是**默认预期**，
    // 卡尾注已写明取全文方式，不再每轮再加一行"已降级"提示（避免刷屏）；
    // 只有真的**丢掉了专家**（card-core）或**硬截断**时才提示。
    if (chosen.lv.tag === 'card-core') {
      notes.push('（本轮预算 ' + budget + ' 字符：仅保留身份专家精简卡'
        + (dropped.length > 0 ? '；本轮未注入：' + dropped.map((it) => it.entry.name).join('、') : '')
        + ' · 全文用 expert_recall 取）')
    }
  }

  return { text, notes }
}

/**
 * 组装本轮的专家注入文本（对外契约不变：banner / withPathHint 语义与旧版一致）。
 * @param {Array<{entry:object, score:number, evidence:number, reasons:string[]}>} selected - selectExperts() 的结果
 * @param {object} opts - { banner, identityId, withPathHint, detail, budgetChars }
 *   detail：'auto'（按预算降级，产品默认）/ 'card'（全精简卡）/ 'full'（全文，旧行为）；
 *   **不传 detail 时回落 'full'** —— 旧调用方（只传 banner/identityId）与旧版逐字等价；
 *   产品默认形态 expertInjectDetail='auto' 由设置层保证，index.js 每轮显式传入。
 * @returns {string} 注入文本（空串 = 本轮不注入）
 */
export function buildInjection(selected, opts = {}) {
  const identityId = String(opts.identityId || '').toLowerCase()
  const banner = opts.banner !== false
  const detail = normalizeDetail(opts.detail, 'full')
  const budget = clampBudget(opts.budgetChars)
  const items = []
  for (const item of selected || []) {
    const body = loadPersona(item.entry)
    if (!body) continue
    items.push({
      entry: item.entry,
      body,
      isIdentity: !!(identityId && String(item.entry.id).toLowerCase() === identityId),
    })
  }
  if (items.length === 0) return ''

  const plan = planInjection(items, { detail, budget, banner })
  if (!plan.text) return ''
  const head = (banner && opts.withPathHint !== false) ? PATH_HINT + '\n\n' : ''
  const tail = plan.notes.length > 0 ? '\n' + plan.notes.join('\n') : ''
  return head + plan.text + tail
}

/** 手动临时注入某位专家（`/expert use <id>`）——L2 全文，与旧版一致（不受预算与形态影响） */
export function buildManualInjection(entry, { banner = true } = {}) {
  const body = loadPersona(entry)
  if (!body) return ''
  return buildPersonaBlock(entry, body, { banner, kind: 'manual', detail: 'full' })
}

/** 无匹配时的空注入（保持通用助手行为，刻意不提示，避免刷屏） */
export function buildNone() {
  return ''
}
