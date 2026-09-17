/**
 * dsh-experts —— 专家库模块（宿主半）
 *
 * 定位：把"临场手写专家人设"变成"按需调用现成专家定义"。
 * 子代理工具只有 description / prompt，没有"专家类型"入参 —— 所以本模块做两件事：
 *   1. **按需注入**（`ctx.systemPrompt.context`）：每轮按「任务实证 + 岗位先验」双赛道打分，
 *      上限**写死 4**（实测命中通常 1–2 位，4 是留余量）；注入分**会话阶段**两态 ——
 *      首轮全景（命中专家全部给精简卡）+ 干活轮（判定要干活的给全文），绝不全部加载；
 *   2. **现取现用**（`expert_recall` 工具；`/expert` 命令已于 0.3.0 移除）：派子代理时把 persona 内联进
 *      `subagent.prompt`，或临时切换视角。
 *
 * 四项口径（产品口径 2026-09-12 定，细节见 README 与设置页说明）：
 *   ① 上限**写死 4**（2026-09-15 起，设置页不提供该项；实测命中通常 1–2 位，4 是留余量）；② 岗位关联（defaultDomain）；
 *   ③ 全局激活集合（enabledDomains / enabledExperts）；④ 其余专家按需临时注入。
 *
 * @module dsh-experts
 */

import { installSettings } from './settings.js'
import { DOMAINS, activeExperts, allExperts, allPersonas, allSkills, findExpert, groupByDomain, splitList, identityExpertOf } from './store.js'
import { selectExperts, pickWorkers } from './match.js'
import { buildInjection, buildCatalog, buildManualInjection, PHASE_OPENING, PHASE_WORKING } from './inject.js'
import { loadDiscipline, resolveMemoryRoot, formatDiscipline } from './discipline.js'
import { createSkillSource, routeCapabilities } from './capability.js'

/**
 * 官方工具辅助 `defineTool`（宿主运行时 `@deepseek-ai/dsh-tools` 提供）。
 * 取不到时退回**等价普通对象** —— 这样在没有宿主依赖的环境（CI / 本机自测）里
 * 模块仍能加载，脚本照跑。真机上优先用官方 helper（它会做规范化与校验）。
 */
let defineTool = null
try {
  defineTool = (await import('@deepseek-ai/dsh-tools')).defineTool
} catch {
  defineTool = null
}
const asTool = (def) => (typeof defineTool === 'function' ? defineTool(def) : def)

export const name = 'dsh-experts'
export const inject = ['systemPrompt', 'tools', 'commands', 'settings']

/** 会话 id（取不到就退回单例键，保证临时注入状态可用） */
function sessionKey(session) {
  try {
    return String(session?.header?.id || session?.id || session?.header?.sessionId || 'default')
  } catch {
    return 'default'
  }
}

/**
 * 本轮任务文本缓存（按会话分槽）。
 *
 * 为什么需要它（2026-09-14 复盘）：宿主 `systemPrompt.assemble` 传给 provider 的只有
 * `{ agent, scope, signal }`（@deepseek-ai/dsh-agent/lib/types/dispatch.js:92），**不含任务文本**；
 * 本模块原有的 5 条提取路径（context.text / userText / input、session.lastUserMessage / messages）
 * 在该宿主上全部取不到 → 打分输入恒空 → 每轮退化为岗位先验兜底。而宿主在 assemble **之前**
 * 已广播 `agent/inbox/claimed`（dsh-agent-loop/lib/index.js:107，claim 在 :889、assemble 在 :890），
 * `agent/pre-step` 的 payload 也带 `messages`。这里把两条通道接住，注入回调即可同步读到。
 * 只读不写：不往 decision.messages 里加东西 —— 不进历史、不影响 turn 结束判定。
 */
const taskTextCache = new Map()
const TASK_TEXT_TTL_MS = 30 * 60_000

/** 缓存键：会话优先，退回 agent id（子代理各自独立） */
function taskCacheKey(agent) {
  try {
    const session = agent?.session
    return String(session?.header?.id || session?.id || agent?.id || 'default')
  } catch {
    return 'default'
  }
}

/** 取一条消息里的纯文本（content 块拼装） */
function textOfMessage(message) {
  try {
    const content = message?.content
    if (typeof content === 'string') return content.trim()
    if (!Array.isArray(content)) return ''
    const parts = []
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n').trim()
  } catch {
    return ''
  }
}

/** 宿主 / 其它插件注入的消息（不是使用者输入）：按 source.kind 排除 */
const INJECTED_SOURCE_KINDS = new Set([
  'plugin', 'skill-invocation', 'skill-catalog', 'agent-instructions', 'compaction', 'dsh-experts',
])

/** 判断一条 inbox 消息是否为使用者输入 */
function isUserInputMessage(message) {
  if (!message || message.role !== 'user') return false
  const kind = message?.source?.kind
  if (!kind) return true
  return !INJECTED_SOURCE_KINDS.has(kind)
}

/** 从一批消息里取用户文本（从后往前找最近一条） */
function userTextOfMessages(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textOfMessage(messages[i])
    if (text && isUserInputMessage(messages[i])) return text
  }
  return ''
}

/** 写入缓存（只有真实使用者文本才覆盖；工具循环的其它消息不动它） */
function rememberTaskText(agent, text, source = 'unknown') {
  if (!text) return
  try {
    taskTextCache.set(taskCacheKey(agent), { text: String(text).slice(0, 4000), at: Date.now(), source })
  } catch { /* 缓存失败不影响主流程 */ }
}

/** 按缓存键读完整状态（诊断用：/expert status 显示「是否接住 + 来自哪条通道」） */
function cachedTaskStateByKey(key) {
  try {
    const hit = taskTextCache.get(String(key))
    if (hit && hit.text && (Date.now() - hit.at) < TASK_TEXT_TTL_MS) return hit
  } catch { /* 读失败当作未接住 */ }
  return null
}

/** 读缓存文本（超时视为失效） */
function readCachedTaskText(agent) {
  const hit = cachedTaskStateByKey(taskCacheKey(agent))
  return hit ? hit.text : ''
}

/**
 * 取当前任务文本（用于关键词打分）。
 * 顺序：事件缓存（agent/inbox/claimed → agent/pre-step）→ 原多路径容错 → 空串。
 */
function extractTaskText(context) {
  const cached = readCachedTaskText(context?.agent)
  if (cached) return cached
  const out = []
  const push = (v) => {
    if (typeof v === 'string' && v.trim()) out.push(v)
    else if (Array.isArray(v)) {
      for (const part of v) {
        if (typeof part === 'string') push(part)
        else if (part && typeof part.text === 'string') push(part.text)
      }
    }
  }
  try {
    push(context?.text)
    push(context?.userText)
    push(context?.input)
    const session = context?.agent?.session
    push(session?.lastUserMessage)
    const msgs = session?.messages || session?.header?.messages
    if (Array.isArray(msgs)) {
      let taken = 0
      for (let i = msgs.length - 1; i >= 0 && taken < 3; i--) {
        const m = msgs[i]
        if (!m || (m.role && m.role !== 'user')) continue
        push(m.content ?? m.text)
        taken += 1
      }
    }
  } catch {
    /* 容错：结构变化不影响主流程 */
  }
  return out.join('\n').slice(0, 4000)
}

export function apply(ctx, config = {}) {
  const settings = installSettings(ctx, config)
  /** 每轮实时读设置：改设置页免重启生效 */
  const cfg = () => settings.read()

  const disposers = []

  // ---- 0a. 任务文本接入（2026-09-14 修复，命中链路的核心）----
  // 主通道 agent/inbox/claimed：claim 在 assemble 之前（dsh-agent-loop:889 → :107 → :890），
  //   本轮使用者输入在注入回调被调用之前就能拿到。
  // 备通道 agent/pre-step：payload 带 messages（官方 dsh-tool-skill 同款钩子）；它排在 assemble 之后，
  //   只对第 2 步起生效，用作 claimed 事件不可达时的兜底。
  // 两条都只读缓存、不碰 decision —— 不进历史、不影响 turn 结束判定。
  if (typeof ctx.on === 'function') {
    try {
      disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        try {
          if (!isUserInputMessage(message)) return
          rememberTaskText(agent, textOfMessage(message), 'agent/inbox/claimed')
        } catch (err) {
          ctx.logger?.debug?.('dsh-experts: claimed 文本缓存失败：' + (err?.message || err))
        }
      }))
    } catch (err) {
      ctx.logger?.debug?.('dsh-experts: 无法监听 agent/inbox/claimed（命中退回原路径）：' + (err?.message || err))
    }
    try {
      disposers.push(ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
        const decision = await next()
        try {
          const text = userTextOfMessages(messages)
          if (text) rememberTaskText(agent, text, 'agent/pre-step')
        } catch { /* 只读兜底，失败不影响主流程 */ }
        return decision
      }))
    } catch (err) {
      ctx.logger?.debug?.('dsh-experts: 无法监听 agent/pre-step（命中退回原路径）：' + (err?.message || err))
    }
  }

  // ---- 0. 能力层数据源（宿主 skill 注册表：异步预取 + 同步读缓存） ----
  // ctx.skills.snapshot() 是 async，而注入回调是同步的 —— 这里预取进缓存、回调只读缓存；
  // 拿不到宿主注册表时（CI / 单测 / 未装 skill 插件）退回 experts/skills.auto.json。
  const skillSource = createSkillSource()
  let skillsCtx = null
  const capabilityEntries = () => {
    const live = skillSource.entries()
    return live.length > 0 ? live : allSkills()
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['skills'], (sctx) => {
        skillsCtx = sctx
        skillSource.refresh(sctx, '')
      })
    } catch (err) {
      ctx.logger?.debug?.('dsh-experts: skills 服务不可用，能力层退回 skills.auto.json：' + (err?.message || err))
    }
  }

  // ---- 1. 按需注入专家视角（systemPrompt.context，官方 API） ----
  // 常驻注册，开关在回调内判断（切总开关免重启）；order 注册期固定，改动需重启。
  // 注入文本缓存**按 sessionId 分槽**（2026-09-14 批二修复）：此前 lastKey / lastText 是
  // apply 级闭包，多会话交替时**互相顶掉**（每次会话切换都重算，缓存命中率退化）；
  // 内容本身不会错配（缓存键含选中集合与设置，不同键必然重算），所以这是性能与时序问题。
  const injectCache = new Map()
  // 会话首轮状态（2026-09-16 注入机制重构）：sid → 1，表示本会话已经给过「首轮全景卡」。
  // 只有**真的注入了 persona** 才算开过场（零命中不消耗首轮）；容量上限防长期泄漏。
  const openedSessions = new Map()
  const OPENED_MAX = 200
  {
    disposers.push(ctx.systemPrompt.context({
      name: 'dsh-experts:persona',
      order: Number(config.injectOrder) || 480,
      text: (context) => {
        const c = cfg()
        if (!c.expertsEnabled) return ''
        const session = context?.agent?.session
        const sid = sessionKey(session)

        const taskText = extractTaskText(context)
        const pool = activeExperts(c)
        if (pool.length === 0) return ''
        // 身份专家：常驻注入的唯一一位（切合使用者身份）；其余按问题归属补充
        const identity = identityExpertOf(c)
        const { selected, ranked } = selectExperts(
          pool,
          {
            text: taskText,
            defaultDomain: c.defaultDomain,
            identityId: identity?.id || '',
          },
          c,
        )
        // 会话阶段（2026-09-16 注入机制重构）：本会话首次命中 → **首轮全景**（命中专家全部给精简卡）；
        // 之后每轮，按本轮证据**从大到小**取「最大 + 次大」共 expertFullHitMax 位（默认 2，并列取任意两位）
        // 给**全文**，其余本轮不注入 —— 这不是「丢弃」：没轮到干活的专家只是本轮不需要，
        // 目录段（L0）每轮可见、expert_recall 随时可取；预算不再触发降级，只作上限。
        // ⚠️ 不能直接 `selected.slice(0, N)`（2026-09-16 修正）：`selected` 是**构造顺序** ——
        // 「身份专家 → 通用赛道保底占位 → 域专家」，通用型专家被保底机制先 push，常落在 selected[0]，
        // 直接切片会让它**恒定占掉一个全文名额**（真机实测：干活轮给了 typeset 0.2 + ics-security 0.4，
        // 而证据 0.4 的 bid-proposal 被挤出）。证据序在 **ranked** 里，故按它取（见 pickWorkers）。
        const isOpening = !openedSessions.has(sid)
        const workers = isOpening ? [] : pickWorkers(selected, ranked, c.expertFullHitMax)
        const personaSelected = (!isOpening && workers.length === 0) ? [] : selected
        const workerIds = workers.map((s) => s.entry.id)

        // 能力层（层 3）：技能指针 —— 独立于 persona 命中，按强信号 + 自己的预算守门
        skillSource.refresh(skillsCtx, session?.header?.cwd)
        const capLines = (c.skillInjectEnabled && Number(c.skillBudgetChars) > 0)
          ? routeCapabilities(capabilityEntries(), taskText, {
              budgetChars: c.skillBudgetChars,
              maxLines: 3,
            })
          : []
        const capText = capLines.length > 0
          ? '\n【可用能力·指针】\n' + capLines.map((l) => '· ' + l).join('\n')
          : ''
        if (selected.length === 0 && capLines.length === 0) {
          injectCache.delete(sid)
          return ''
        }
        // 安装引导提醒：未确认本人岗位时，在注入内容末尾带一行提示（确认后不再出现）
        const setupHint = c.expertSetupDone
          ? ''
          : '\n（专家库还没确认本人岗位，当前按 ' + c.defaultDomain + ' 处理：到 设置 → 插件 → experts 填「本人岗位默认域」即可，之后不再提示）'
        // 缓存键：选中集合与分数之外，**注入形态与预算也参与** —— 否则改设置后
        // 同一选中集合会命中旧文本（形态/预算变了但内容未变，缓存必须失效）
        const key = personaSelected.map((s) => s.entry.id + ':' + s.score).join('|')
          + '|id:' + (identity?.id || '-')
          + '|ph:' + (isOpening ? 'o' : 'w') + ':' + workerIds.join(',')
          + '|d:' + c.expertInjectDetail + '|b:' + c.expertInjectBudgetChars
          + '|cap:' + capLines.join(',')
          + (setupHint ? '|hint' : '')
        const cached = injectCache.get(sid)
        if (cached && cached.key === key) return cached.text // 内容未变 → 返回上次文本（保持缓存稳定）
        const selectedText = personaSelected.length > 0
          ? buildInjection(personaSelected, {
              banner: c.expertShowBanner,
              identityId: identity?.id || '',
              detail: c.expertInjectDetail,
              phase: isOpening ? PHASE_OPENING : PHASE_WORKING,
              workerIds,
              budgetChars: c.expertInjectBudgetChars,
            })
          : ''
        // 首轮全景：只有**真的注入了 persona**才算开过场（后续轮才可能进入「干活轮」）
        if (isOpening && personaSelected.length > 0) {
          openedSessions.set(sid, 1)
          if (openedSessions.size > OPENED_MAX) openedSessions.delete(openedSessions.keys().next().value)
        }
        const text = selectedText + capText + setupHint
        injectCache.set(sid, { key, text })
        return text
      },
    }))
  }

  // ---- 1b. 专家库目录段（systemPrompt.section，**稳定通道**） ----
  // order 10150：宿主 SECTION_ORDERS 里 10100（Web 表层）与 10200（部署 persona 后缀）之间无占用。
  // 内容只由索引与能力索引决定（不依赖任何设置，除总开关）——同一专家库渲染出的文本逐字稳定，
  // 于是换任务时系统提示词节点不动、不打断前缀复用（宿主 system-prompt README.zh.md:149）。
  if (typeof ctx.systemPrompt?.section === 'function') {
    disposers.push(ctx.systemPrompt.section({
      name: 'dsh-experts:catalog',
      order: Number(config.catalogOrder) || 10150,
      text: () => {
        const c = cfg()
        if (!c.expertsEnabled || !c.expertCatalogEnabled) return ''
        return buildCatalog({ domains: DOMAINS, personas: allPersonas(), skills: capabilityEntries() })
      },
    }))
  } else {
    ctx.logger?.debug?.('dsh-experts: 宿主未提供 systemPrompt.section，目录段跳过（仅 context 通道）')
  }

  // ---- 1c. 交付层·纪律块（systemPrompt.context，order 481） ----
  // 自检红线不再写进 persona，统一由交付层每轮注入（design-v2 第 8 节 + 使用者口径①）：
  // 只读项目记忆（PROJECTS/dsh-experts.md 的【纪律块 v1】条目），按 mtime+size 指纹缓存。
  // 与 persona 段**分开注册**：不参与 persona 预算降级，阶段裁剪时也不丢弃。
  if (typeof ctx.systemPrompt?.context === 'function') {
    disposers.push(ctx.systemPrompt.context({
      name: 'dsh-experts:delivery',
      order: Number(config.deliveryOrder) || 481,
      text: () => {
        const c = cfg()
        if (!c.expertsEnabled || !c.disciplineEnabled) return ''
        try {
          const result = loadDiscipline({ root: resolveMemoryRoot(ctx, c) })
          return formatDiscipline(result)
        } catch (err) {
          // 绝不把异常抛进 text 回调（宿主对回调不容错）
          return '【交付层·纪律】未加载（读取异常：' + (err?.message || err) + '）'
        }
      },
    }))
  }

  // ---- 2. 工具：现取现用（派子代理时内联进 prompt） ----
  disposers.push(ctx.tools.register(asTool({
    name: 'expert_recall',
    description: '取出某位专家的 persona 正文（现取现用，不常驻上下文）。用于：派子代理时把 persona 内联进 subagent.prompt；或临时按某位专家的视角工作。不传 id 时按 query 关键词返回最匹配的专家。',
    // 官方参数 DSL：属性内 required: true（**不是** JSON Schema 的 properties/required 数组）
    parameters: {
      id: { type: 'string', description: '专家 id（如 infosec-bid-proposal）；省略则用 query 匹配' },
      query: { type: 'string', description: '任务描述或关键词，用于选出最匹配的专家' },
      list: { type: 'boolean', description: '仅列出可用专家清单（含域、一句话定位、激活状态）' },
    },
    // 官方 output 结构：{ schema, render }；execute 返回结构化对象，render 负责显示
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          kind: { type: 'string' },
          id: { type: 'string' },
          name: { type: 'string' },
          score: { type: 'number' },
          reasons: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (args, value) => [{ type: 'text', text: String(value?.text ?? value?.error ?? '') }],
    },
    isConcurrencySafe: () => true,
    execute: async (args = {}) => {
      const c = cfg()
      if (args.list) {
        return { ok: true, kind: 'listing', text: listText(c) }
      }
      if (args.id) {
        const entry = findExpert(args.id)
        if (!entry) {
          return { ok: false, kind: 'error', error: '未找到专家：' + args.id + '\n\n' + listText(c, { compact: true }) }
        }
        const body = buildManualInjection(entry, { banner: false })
        if (!body) {
          return { ok: false, kind: 'error', error: '专家 ' + entry.id + ' 的 persona 文件缺失：' + (entry.file || '(未登记)') }
        }
        return { ok: true, kind: 'persona', id: entry.id, name: entry.name, text: body }
      }
      const pool = activeExperts(c)
      const source = pool.length > 0 ? pool : allExperts()
      const { ranked } = selectExperts(source, { text: String(args.query || ''), defaultDomain: c.defaultDomain }, c)
      const top = ranked[0]
      if (!top || top.score <= 0) {
        return { ok: false, kind: 'no-match', error: '没有匹配的专家。\n\n' + listText(c, { compact: true }) }
      }
      const body = buildManualInjection(top.entry, { banner: false })
      return {
        ok: true,
        kind: 'match',
        id: top.entry.id,
        name: top.entry.name,
        score: top.score,
        reasons: top.reasons,
        text: '【匹配】' + top.entry.name + '（' + top.entry.id + '，' + top.score + '，' + top.reasons.join('；') + '）\n\n' + body,
      }
    },
  })))


  return () => {
    for (const d of disposers) {
      try { d() } catch { /* best-effort */ }
    }
  }
}

/** 专家清单文本（按域分组，标注激活状态与来源） */
function listText(c, { compact = false } = {}) {
  const all = allExperts()
  if (all.length === 0) return '专家库为空：experts/index.json 未登记任何专家。'
  const activated = new Set(activeExperts(c).map((e) => e.id))
  const groups = groupByDomain(all)
  const lines = ['专家库 · 共 ' + all.length + ' 位（★ = 在当前匹配范围内，共 ' + activated.size + ' 位；默认全量参与）', '']
  for (const g of groups) {
    lines.push('【' + g.domain.name + '】' + g.domain.desc)
    for (const e of g.items) {
      const mark = activated.has(e.id) ? '★' : '·'
      const src = e.source?.origin === 'self-authored' ? '自撰' : (e.source?.repo || '未标来源')
      lines.push('  ' + mark + ' ' + e.id + ' ｜ ' + e.name + ' ｜ ' + (e.when_to_use || '') + (compact ? '' : '  [' + src + ']'))
    }
    lines.push('')
  }
  lines.push('用法：/expert use <id> 临时注入 ｜ /expert auto 恢复自动 ｜ /expert off 关闭本会话注入')
  return lines.join('\n')
}

