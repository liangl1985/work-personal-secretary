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
 * 三级口径（2026-09-16 注入机制重构后）：
 *   - **L0 目录**：`systemPrompt.section` 稳定段，列出各域成员与可用能力（不占注入预算）；
 *   - **L1 精简卡**（本文件 buildPersonaCard，确定性生成）：角色段首句 + 工作方法前 3 条
 *     + 交付与自检前 2 条 + when_to_use 一行；带尾注「精简卡 · 全文用 expert_recall 取」；
 *   - **L2 全文**：干活轮按需注入，或用 `expert_recall` 现取 / 派子代理时内联进 prompt。
 *
 * 每轮注入按**会话阶段**分两态（见 PHASE_*）：
 *   - **首轮全景（opening）**：本会话首次命中 → 命中专家**全部**给精简卡（一个不裁）；
 *   - **干活轮（working）**：后续轮 → 按证据取「最大 + 次大」共 `expertFullHitMax` 位（默认 2）
 *     给**全文**；身份专家恒给卡；其余本轮不注入（不设固定证据门槛）。
 * `expertInjectBudgetChars`（默认 15000，按最大可能消费定档）只作**上限**：超出即截断并标注（绝不静默超限）；
 * INJECT_BUDGET_MAX = 20000 是任何形态（含 full）都不得突破的安全红线。
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
 * 2026-09-16 由 3000 提到 **3600**：回归的体量口径是「去空白 900–3000」（最长为
 * general-office / general-typeset，去空白 2977/2991），而**含空白**最长到 3245 ——
 * 按含空白 3000 截断会把这两位的全文削掉一截，使「干活轮给全文」名不副实。
 */
export const PERSONA_MAX_CHARS = 3600

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

/** 精简卡生成参数（确定性：同输入同输出；方法条 clip(90) × 3 + 交付条 clip(90) × 2 + 角色/适用，一张卡约 500-620 字符） */
export const CARD_ROLE_MAX_CHARS = 80
/** 角色首句过短时续接到此长度（信息量下限，仍记作「首句」） */
export const CARD_ROLE_MIN_CHARS = 40
export const CARD_METHOD_MAX_CHARS = 90
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
 * 角色段首句（≤80 字）+ 工作方法前 3 条（每条 ≤90 字）+ 交付与自检前 2 条（每条 ≤90 字）
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

/**
 * 会话阶段（2026-09-16 注入机制重构，使用者定）：
 *   - opening：本会话**首次命中** → 命中专家**全部**给精简卡（候选全景，一个不裁）；
 *   - working：后续轮判定确实要某位专家干活 → 只给这些专家**全文**，其余本轮不注入。
 */
export const PHASE_OPENING = 'opening'
export const PHASE_WORKING = 'working'

/**
 * 选形态 —— **不再有降级链**（2026-09-16 重构：mixed → card → card-core 三级链与
 * 「未注入：xxx」注记整体删除）。逐项决定形态：
 *
 *   - **首轮全景（opening）**：命中专家**全部**给精简卡（4 位最坏实测 2535 字符，结构性装得下）；
 *   - **干活轮（working）**：身份专家恒给卡（常驻视角、与本轮任务无关）+ 判定要干活的
 *     workerIds 给**全文**（最相关的 1–2 位）；其余本轮不注入 ——
 *     这不是「丢弃」：没轮到干活的专家只是本轮不需要，目录段仍每轮可见、expert_recall 随时可取；
 *   - 设置值 `card` / `full` 是全局形态开关（全部卡 / 全部全文）。
 *
 * 预算只作**上限**：超出即截断并标注（INJECT_BUDGET_MAX = 20000 是任何形态都不得突破的安全红线）。
 */
function planInjection(items, { detail, phase, workerIds, budget, banner }) {
  const want = new Set((workerIds || []).map((x) => String(x).toLowerCase()))
  const blocks = []
  for (const it of items) {
    const id = String(it.entry.id).toLowerCase()
    let mode = null
    if (detail === 'full') mode = 'full'
    else if (detail === 'card') mode = 'card'
    else if (phase === PHASE_WORKING) {
      if (it.isIdentity) mode = 'card'          // 身份专家恒给卡（常驻视角，与本轮任务无关）
      else if (want.has(id)) mode = 'full'      // 确实要它干活 → 全文
      // 其余：本轮不注入（不是丢弃）
    } else mode = 'card'                        // auto + 首轮全景
    if (!mode) continue
    const block = buildPersonaBlock(it.entry, it.body, {
      banner,
      kind: it.isIdentity ? 'identity' : 'match',
      detail: mode,
    })
    if (block) blocks.push(block)
  }
  if (blocks.length === 0) return { text: '', notes: [] }

  const text0 = blocks.join('\n\n')
  if (text0.length > budget) {
    // 旧口径是「超预算按序降级」；新口径**只截断并标注**（降级链已删）—— 绝不静默超限
    const note = '…（已截断：本轮注入 ' + text0.length + ' 字符，超出上限 ' + budget
      + ' · 全文用 expert_recall 取）'
    return { text: text0.slice(0, Math.max(0, budget - note.length)) + note, notes: [] }
  }
  return { text: text0, notes: [] }
}

/**
 * 组装本轮的专家注入文本（对外契约不变：banner / withPathHint 语义与旧版一致）。
 * @param {Array<{entry:object, score:number, evidence:number, reasons:string[]}>} selected - selectExperts() 的结果
 * @param {object} opts - { banner, identityId, withPathHint, detail, phase, workerIds, budgetChars }
 *   detail：'auto'（产品默认，按**会话阶段**分两态）/ 'card'（全精简卡）/ 'full'（全文，旧行为）；
 *   phase：auto 下使用 —— 'opening' 首轮全景（全卡）/ 'working' 干活轮（workerIds 给全文）；
 *   **不传 detail 时回落 'full'** —— 旧调用方（只传 banner/identityId）与旧版逐字等价；
 *   产品默认形态 expertInjectDetail='auto' 由设置层保证，index.js 每轮显式传入。
 */
export function buildInjection(selected, opts = {}) {
  const identityId = String(opts.identityId || '').toLowerCase()
  const banner = opts.banner !== false
  const detail = normalizeDetail(opts.detail, 'full')
  const phase = opts.phase === PHASE_WORKING ? PHASE_WORKING : PHASE_OPENING
  const workerIds = Array.isArray(opts.workerIds) ? opts.workerIds.map((x) => String(x)) : []
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

  const plan = planInjection(items, { detail, phase, workerIds, budget, banner })
  if (!plan.text) return ''
  const head = (banner && opts.withPathHint !== false) ? PATH_HINT + '\n\n' : ''
  const tail = plan.notes.length > 0 ? '\n' + plan.notes.join('\n') : ''
  return head + plan.text + tail
}

/** 取某位专家的 L2 全文（expert_recall 用；不受预算与形态影响） */
export function buildManualInjection(entry, { banner = true } = {}) {
  const body = loadPersona(entry)
  if (!body) return ''
  return buildPersonaBlock(entry, body, { banner, kind: 'manual', detail: 'full' })
}

/** 目录段字符上限（2026-09-16 由 400 提到 **1000**：需容纳「命中不足可额外补 1 名专家」的权限说明，并为专家与能力条目增长留余量；超出截断并标注） */
export const CATALOG_MAX_CHARS = 1000

/**
 * 专家库目录段（走 systemPrompt.section，**稳定通道**）。
 *
 * 内容 = 六个域的成员（展示名，逗号级）+「可用能力」节（能力层索引，未就绪时整节省略）。
 * 刻意**不依赖任何设置项**：同一 index.json / skills.auto.json 渲染出的文本逐字稳定，
 * 因此切换命中专家时系统提示词节点不动（宿主 system-prompt README.zh.md:149），
 * 避免「头节点重写导致前缀复用从首个变化 token 起失效」。
 *
 * @param {object} args - { domains, personas, skills }
 * @returns {string} 目录段文本（空串 = 不注入）
 */
export function buildCatalog({ domains = [], personas = [], skills = [] } = {}) {
  const lines = ['【专家库·目录】先判断问题归属，命中则按该专家视角处理；命中不足时可额外补 1 名专家（expert_recall 取全文），派子代理时内联 persona。']
  for (const d of domains) {
    const names = personas
      .filter((p) => p && p.domain === d.id)
      .map((p) => String(p.name || p.id))
      .filter(Boolean)
    if (names.length === 0) continue
    lines.push('· ' + d.name + '：' + names.join('、'))
  }
  // 能力节**稳定排序**（代码点序，与宿主 skill 注册表的 compareCodePoints 一致）：
  // 目录段有两个数据源（兜底 skills.auto.json / 运行时 ctx.skills），来源切换时若顺序不同，
  // 渲染文本就会变 —— 而 section 文本一变，宿主会重写系统提示词节点（2026-09-14 实测：跨重启的
  // 会话历史里会多留一个旧 system 节点）。排序归一化后两个来源渲染逐字相同。
  const capNames = skills
    .map((s) => String(s?.skill || s?.id || ''))
    .filter(Boolean)
    .sort()
  if (capNames.length > 0) lines.push('· 可用能力：' + capNames.join('、'))
  if (lines.length <= 1) return ''
  const text = lines.join('\n')
  return text.length <= CATALOG_MAX_CHARS ? text : text.slice(0, CATALOG_MAX_CHARS - 1) + '…'
}

/** 无匹配时的空注入（保持通用助手行为，刻意不提示，避免刷屏） */
export function buildNone() {
  return ''
}
