/**
 * dsh-experts — 注入文本组装
 *
 * 注入形态（与记忆快照并列进 systemPrompt.context）：
 *   【处理路径】先用下方身份视角判断问题归属：命中专家 → 按该专家视角处理
 *   （要独立作业就派子代理并把 persona 内联进 prompt）；未命中 → 用通用能力原生处理。
 *
 *   【身份视角·工控安全售前（本人岗位）】
 *   <persona 约 1.3–1.8 千字（UTF-8 约 3.3–4.9KB）>
 *   （身份视角：常驻，代表使用者岗位；本轮问题不在它的方向时不必强套）
 *
 *   【本轮命中·等保测评】
 *   <persona>
 *   （本轮命中：按问题归属激活；不需要时忽略）
 *
 * 硬约束（主人 2026-09-12 定）：
 *   - **常驻注入的只有一位**：切合使用者身份的「身份专家」；
 *   - 其余专家按**问题归属**补充激活，且总量受 `expertInjectMax` 限制（>1 会占用较多 TOKEN）；
 *   - 未命中就不注入：保持通用助手行为；
 *   - 注入的是**视角与方法**，不是人格扮演秀 —— 工作区红线与语言规则仍然压过 persona。
 *
 * @module dsh-experts/inject
 */

import { loadPersona } from './store.js'

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

/**
 * 组装一位专家的注入块。
 * @param {object} entry - 专家元数据
 * @param {string} body - persona 正文
 * @param {object} opts - { banner, kind: 'identity'|'match'|'manual', note }
 */
export function buildPersonaBlock(entry, body, { banner = true, kind = 'match', note = null } = {}) {
  const text = String(body || '').trim()
  if (!text) return ''
  const clipped = text.length > PERSONA_MAX_CHARS
    ? text.slice(0, PERSONA_MAX_CHARS) + '\n…（persona 超出上限，已截断；请精简 experts/' + (entry.file || '') + '）'
    : text

  const head = !banner
    ? ''
    : (kind === 'identity'
        ? '【身份视角·' + entry.name + (entry.domain_name ? '（' + entry.domain_name + '）' : '') + '】'
        : (kind === 'manual'
            ? '【临时注入·' + entry.name + '】'
            : '【本轮命中·' + entry.name + '】'))

  const defaultNote = kind === 'identity' ? IDENTITY_NOTE : (kind === 'manual'
    ? '（临时注入：仅本会话生效，不常驻上下文；/expert off 关闭，/expert auto 恢复自动）'
    : MATCH_NOTE)

  return [head, clipped, note || defaultNote].filter(Boolean).join('\n')
}

/**
 * 组装本轮的专家注入文本。
 * @param {Array<{entry:object, score:number, evidence:number, reasons:string[]}>} selected - selectExperts() 的结果
 * @param {object} opts - { banner, identityId, withPathHint }
 * @returns {string} 注入文本（空串 = 本轮不注入）
 */
export function buildInjection(selected, opts = {}) {
  const identityId = String(opts.identityId || '').toLowerCase()
  const blocks = []
  for (const item of selected || []) {
    const body = loadPersona(item.entry)
    if (!body) continue
    const isIdentity = identityId && String(item.entry.id).toLowerCase() === identityId
    blocks.push(buildPersonaBlock(item.entry, body, {
      banner: opts.banner !== false,
      kind: isIdentity ? 'identity' : 'match',
    }))
  }
  if (blocks.length === 0) return ''
  const head = (opts.banner !== false && opts.withPathHint !== false) ? PATH_HINT + '\n\n' : ''
  return head + blocks.join('\n\n')
}

/** 手动临时注入某位专家（`/expert use <id>`）—— 与自动注入同样的块，但标为"临时" */
export function buildManualInjection(entry, { banner = true } = {}) {
  const body = loadPersona(entry)
  if (!body) return ''
  return buildPersonaBlock(entry, body, { banner, kind: 'manual' })
}

/** 无匹配时的空注入（保持通用助手行为，刻意不提示，避免刷屏） */
export function buildNone() {
  return ''
}
