/**
 * dsh-experts —— 专家库模块（宿主半）
 *
 * 定位：把"临场手写专家人设"变成"按需调用现成专家定义"。
 * 子代理工具只有 description / prompt，没有"专家类型"入参 —— 所以本模块做两件事：
 *   1. **按需注入**（`ctx.systemPrompt.context`）：每轮按「岗位先验 + 关键词 + 会话域」打分，
 *      默认只注入 Top-1（可调 2/3），未注入的专家走临时注入，绝不全部加载；
 *   2. **现取现用**（`expert_recall` 工具 + `/expert` 命令）：派子代理时把 persona 内联进
 *      `subagent.prompt`，或临时切换视角。
 *
 * 四项口径（产品口径 2026-09-12 定，细节见 README 与设置页说明）：
 *   ① 默认注入 1 位，上限可调 3（>1 会占用较多 TOKEN）；② 岗位关联（defaultDomain）；
 *   ③ 全局激活集合（enabledDomains / enabledExperts）；④ 其余专家按需临时注入。
 *
 * @module dsh-experts
 */

import { installSettings } from './settings.js'
import { DOMAINS, activeExperts, allExperts, allPersonas, allSkills, findExpert, groupByDomain, domainById, splitList, identityExpertOf } from './store.js'
import { selectExperts, rankExperts, BRANCH_DOMAIN_HINTS } from './match.js'
import { buildInjection, buildCatalog, buildManualInjection } from './inject.js'
import { loadDiscipline, resolveMemoryRoot, formatDiscipline } from './discipline.js'
import { createSkillSource, routeCapabilities } from './capability.js'
import { COST_PERSONA_CARD } from './limits.js'

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

/** 会话工作目录末段 → 域（branch 先验） */
function branchDomain(session) {
  try {
    const cwd = session?.header?.cwd
    if (!cwd) return null
    const parts = String(cwd).split(/[\\/]/).filter(Boolean)
    const leaf = parts.length > 0 ? parts[parts.length - 1] : ''
    return BRANCH_DOMAIN_HINTS[leaf] || null
  } catch {
    return null
  }
}

/**
 * 取当前任务文本（用于关键词打分）。
 * 官方 runtime 上下文的结构随版本略有差异，这里做多路径容错：取不到就为空串，
 * 此时打分自然退化为"岗位先验 + 会话域"，仍然可用（这正是 short task 的常态）。
 */
function extractTaskText(context) {
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

/** 把一行说明拼成命令结果（官方 CommandResult 形态） */
function reply(kind, text) {
  return { kind, text }
}

export function apply(ctx, config = {}) {
  const settings = installSettings(ctx, config)
  /** 每轮实时读设置：改设置页免重启生效 */
  const cfg = () => settings.read()

  /** 会话级临时状态：{ useId?: string, off?: boolean, phase?: string } —— 只在内存，重启即清 */
  const tempState = new Map()
  const state = (sid) => tempState.get(sid) || {}

  const disposers = []

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

  // ---- 0b. 会话阶段（层 5）：显式 > 任务清单推断 > 默认 understand ----
  // 任务清单存在 session projection（key: todos），插件**只读**；宿主在每轮 turn/start 会把它清零
  // （dsh-tool-todo 的 projection apply），所以这里自建一份带时间窗的缓存兜住跨轮粘性；
  // 拿不到就退化为默认阶段 —— 绝不假装读到了（design-v2 第 9 节「读不到则退化为显式置位」）。
  const todoCache = new Map()
  let projectionsCtx = null
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['sessionProjections'], (pctx) => {
        projectionsCtx = pctx
      })
    } catch (err) {
      ctx.logger?.debug?.('dsh-experts: sessionProjections 不可用，阶段改为纯显式：' + (err?.message || err))
    }
  }
  function readTodos(sid, session) {
    try {
      const list = projectionsCtx?.sessionProjections?.stateOf?.(session, 'todos')
      if (Array.isArray(list)) {
        todoCache.set(sid, { todos: list, at: Date.now() })
        return list
      }
    } catch {
      /* projection 读取失败不致命 */
    }
    const hit = todoCache.get(sid)
    if (hit && (Date.now() - hit.at) < 10 * 60_000) return hit.todos
    return null
  }
  /** 阶段：显式 phase > 任务清单推断（全完成 → deliver，有未完成 → execute）> understand */
  function resolveStage(st, sid, session) {
    if (st && st.phase) return st.phase
    const todos = readTodos(sid, session)
    if (Array.isArray(todos) && todos.length > 0) {
      const done = todos.filter((t) => t && t.status === 'completed').length
      return done === todos.length ? 'deliver' : 'execute'
    }
    return 'understand'
  }

  // ---- 1. 按需注入专家视角（systemPrompt.context，官方 API） ----
  // 常驻注册，开关在回调内判断（切总开关免重启）；order 注册期固定，改动需重启。
  // 注入文本缓存**按 sessionId 分槽**（2026-09-14 批二修复）：此前 lastKey / lastText 是
  // apply 级闭包，多会话交替时**互相顶掉**（每次会话切换都重算，缓存命中率退化）；
  // 内容本身不会错配（缓存键含选中集合与设置，不同键必然重算），所以这是性能与时序问题。
  const injectCache = new Map()
  {
    disposers.push(ctx.systemPrompt.context({
      name: 'dsh-experts:persona',
      order: Number(config.injectOrder) || 480,
      text: (context) => {
        const c = cfg()
        if (!c.expertsEnabled) return ''
        const session = context?.agent?.session
        const sid = sessionKey(session)
        const st = state(sid)

        // 手动关闭 → 本轮不注入任何专家
        if (st.off) return ''

        // 临时注入优先（/expert use <id>）：只影响本会话，不改设置
        if (st.useId) {
          const entry = findExpert(st.useId)
          if (!entry) {
            tempState.set(sid, { ...st, useId: null })
          } else {
            const key = 'manual:' + entry.id
            const hit = injectCache.get(sid)
            if (hit && hit.key === key) return hit.text
            const text = buildManualInjection(entry, { banner: c.expertShowBanner })
            injectCache.set(sid, { key, text })
            return text
          }
        }

        const taskText = extractTaskText(context)
        const pool = activeExperts(c)
        if (pool.length === 0) return ''
        // 身份专家：常驻注入的唯一一位（切合使用者身份）；其余按问题归属补充
        const identity = identityExpertOf(c)
        const { selected } = selectExperts(
          pool,
          {
            text: taskText,
            defaultDomain: c.defaultDomain,
            branchDomain: branchDomain(session),
            identityId: identity?.id || '',
          },
          c,
        )
        // 成本装填（design-v2 第 6 节）：persona 侧也按成本常量守门 —— 预算放不下就不塞多位
        const maxByCost = Math.max(1, Math.floor(Number(c.expertInjectBudgetChars) / COST_PERSONA_CARD))
        if (selected.length > maxByCost) selected.length = maxByCost

        // 能力层（层 3）：技能指针 —— 独立于 persona 命中，按强信号 + 自己的预算守门
        // 阶段（层 5）：understand = 完整卡；execute = 丢方法行 + 指针上限提到 5 条；deliver = 只留交付
        const stage = resolveStage(st, sid, session)
        skillSource.refresh(skillsCtx, session?.header?.cwd)
        const capLines = (c.skillInjectEnabled && Number(c.skillBudgetChars) > 0)
          ? routeCapabilities(capabilityEntries(), taskText, {
              budgetChars: c.skillBudgetChars,
              maxLines: stage === 'execute' ? 5 : 3,
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
          : '\n（专家库还没确认本人岗位，当前按 ' + c.defaultDomain + ' 处理：跑一次 /expert setup <域> [身份专家id] 即可，之后不再提示）'
        // 缓存键：选中集合与分数之外，**注入形态与预算也参与** —— 否则改设置后
        // 同一选中集合会命中旧文本（形态/预算变了但内容未变，缓存必须失效）
        const key = selected.map((s) => s.entry.id + ':' + s.score).join('|')
          + '|id:' + (identity?.id || '-')
          + '|d:' + c.expertInjectDetail + '|b:' + c.expertInjectBudgetChars
          + '|cap:' + capLines.join(',')
          + '|s:' + stage
          + (setupHint ? '|hint' : '')
        const cached = injectCache.get(sid)
        if (cached && cached.key === key) return cached.text // 内容未变 → 返回上次文本（保持缓存稳定）
        const selectedText = selected.length > 0
          ? buildInjection(selected, {
              banner: c.expertShowBanner,
              identityId: identity?.id || '',
              detail: c.expertInjectDetail,
              budgetChars: c.expertInjectBudgetChars,
              stage,
            })
          : ''
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

  // ---- 3. 命令：/expert（list / use / off / auto / status / setup / why） ----
  disposers.push(ctx.commands.register({
    name: 'expert',
    description: '专家库：/expert list 列专家 · use <id> 临时注入 · off 关闭 · auto 恢复自动 · phase 切理解/执行/交付阶段 · status 当前状态 · setup 安装引导 · why <文本> 看打分',
    handler: async (input = {}, exec) => {
      const rawInput = input?.rawInput
      // 会话信息在不同宿主版本可能落在 input.session 或 exec.agent.session —— 三处都试，取不到则退化为全局状态
      const session = input?.session || exec?.agent?.session || exec?.session
      const c = cfg()
      const sid = sessionKey(session?.agent?.session || session)
      const argv = String(rawInput || '').trim().split(/\s+/).filter(Boolean)
      const sub = (argv.shift() || 'list').toLowerCase()

      if (sub === 'list') return reply('success', listText(c))

      if (sub === 'use') {
        const id = argv[0]
        if (!id) return reply('error', '用法：/expert use <id>（先用 /expert list 看 id）')
        const entry = findExpert(id)
        if (!entry) return reply('error', '未找到专家：' + id + '\n\n' + listText(c, { compact: true }))
        tempState.set(sid, { ...state(sid), useId: entry.id, off: false })
        return reply('success', '已临时注入【' + entry.name + '】（' + entry.id + '）——仅本会话生效，不常驻；恢复自动：/expert auto')
      }

      if (sub === 'off') {
        tempState.set(sid, { ...state(sid), off: true, useId: null })
        return reply('success', '本会话已关闭专家注入（/expert auto 恢复）')
      }

      if (sub === 'auto') {
        tempState.set(sid, { off: false, useId: null })
        return reply('success', '已恢复自动匹配注入')
      }

      if (sub === 'phase') {
        const want = (argv[0] || '').toLowerCase()
        const st = state(sid)
        if (!want || want === 'status') {
          return reply('success', '当前注入阶段：' + (st.phase || 'auto（按任务清单推断；无清单时 understand）')
            + '\n用法：/expert phase understand|execute|deliver|auto')
        }
        if (!['understand', 'execute', 'deliver', 'auto'].includes(want)) {
          return reply('error', '未知阶段：' + want + '（可选 understand / execute / deliver / auto）')
        }
        tempState.set(sid, { ...st, phase: want === 'auto' ? '' : want })
        const detail = want === 'execute'
          ? '已丢掉方法行（保留角色与交付），能力指针上限提到 5 条'
          : (want === 'deliver' ? '只留「交付与自检」' : '完整精简卡')
        return reply('success', want === 'auto'
          ? '已恢复「按任务清单推断阶段」'
          : '已切到「' + want + '」阶段（仅本会话）：' + detail + ' · 恢复用 /expert phase auto')
      }

      if (sub === 'setup') {
        const want = (argv[0] || '').toLowerCase()
        const wantIdentity = (argv[1] || '').trim()
        if (!want) return reply('success', setupText(c))
        const d = domainById(want)
        if (!d) return reply('error', '未知域：' + want + '\n\n' + setupText(c))
        let identityEntry = null
        if (wantIdentity) {
          identityEntry = findExpert(wantIdentity)
          if (!identityEntry) {
            return reply('error', '未知身份专家：' + wantIdentity
              + '\n该域候选：' + allExperts().filter((e) => e.domain === d.id).map((e) => e.id).join('、'))
          }
        }
        let written = false
        try {
          const scope = settings.scope
          if (scope && typeof scope.set === 'function') {
            scope.set({
              ...scope.get(),
              defaultDomain: d.id,
              ...(identityEntry ? { identityExpert: identityEntry.id } : {}),
              expertSetupDone: true,
            })
            written = true
          }
        } catch { /* 设置服务不提供写入时退回指引 */ }
        const domainExperts = allExperts().filter((e) => e.domain === d.id)
        const identity = identityEntry || identityExpertOf({ defaultDomain: d.id, identityExpert: '' })
        return reply('success', [
          '本人岗位已设为【' + d.name + '（' + d.id + '）】' + (written ? '（已写入设置，立即生效）' : ''),
          written ? '' : '若未生效：请到 设置 → 插件 → experts 把「本人岗位默认域」改成 ' + d.id + '。',
          '身份专家（**常驻注入的唯一一位**）：' + (identity ? identity.name + '（' + identity.id + '）' : '（无）'),
          identityEntry ? '' : '要换更贴切的身份专家：/expert setup ' + d.id + ' <专家id>　候选：' + (domainExperts.map((e) => e.id).join('、') || '（该域暂无专家）'),
          '其余专家不常驻：每轮先判断问题归属 —— 命中就补充注入（受注入上限限制）或派子代理激活，未命中则通用能力原生处理。',
          '匹配范围默认是全部 ' + allExperts().length + ' 位专家（岗位只作先验，不作白名单）；如需收窄，在设置页填「全局激活域」或「全局激活专家」。',
        ].filter(Boolean).join('\n'))
      }

      if (sub === 'status') {
        const pool = activeExperts(c)
        return reply('success', [
          '专家库：' + (c.expertsEnabled ? '开' : '关'),
          '本人岗位：' + c.defaultDomain + '（' + (domainById(c.defaultDomain)?.name || '未知域') + '）—— 仅作打分先验',
          '身份专家（常驻注入的唯一一位）：' + (() => { const id = identityExpertOf(c); return id ? id.name + '（' + id.id + '）' : '（无）' })(),
          '参与匹配：' + pool.length + ' / ' + allExperts().length + ' 位' +
            (c.enabledExperts ? '（enabledExperts 白名单）' : (c.enabledDomains ? '（enabledDomains 收窄）' : '（默认全量参与）')),
          '注入上限：' + c.expertInjectMax + ' 位' + (c.expertInjectMax > 1 ? '（⚠️ 占用较多 TOKEN）' : ''),
          '注入形态：' + c.expertInjectDetail + '（auto = 按预算降级 / card = 全精简卡 / full = 全文）；每轮预算：' + c.expertInjectBudgetChars + ' 字符',
          '第 2/3 位门槛：' + c.expertSecondThreshold + '；最低分：' + c.expertMinScore,
          '本会话：' + (state(sid).off ? '已关闭' : (state(sid).useId ? '临时注入 ' + state(sid).useId : '自动匹配')),
        ].join('\n'))
      }

      if (sub === 'why') {
        const text = argv.join(' ')
        if (!text) return reply('error', '用法：/expert why <任务文本或关键词>')
        const c2 = cfg()
        const pool = activeExperts(c2)
        const { ranked } = selectExperts(pool.length ? pool : allExperts(),
          { text, defaultDomain: c2.defaultDomain }, c2)
        const lines = ranked.slice(0, 6).map((r, i) => (i + 1) + '. ' + r.entry.name + '（' + r.entry.id + '）' + r.score +
          (r.reasons.length ? ' ← ' + r.reasons.join('；') : ' ← 无信号'))
        return reply('success', '任务文本：' + text + '\n\n' + (lines.join('\n') || '（无专家可匹配）'))
      }

      return reply('error', '未知子命令：' + sub + '\n\n' + listText(c, { compact: true }))
    },
  }))

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

/** 安装引导文本（首次启用时问一次「你的工作方向是？」） */
function setupText(c) {
  const lines = [
    '【专家库 · 安装引导】你的工作方向是？（这决定任务优先从哪个专业角度被拆解，随时可在设置页改）',
    '',
  ]
  for (const d of (groupByDomain(allExperts()).map((g) => g.domain))) {
    const n = allExperts().filter((e) => e.domain === d.id).length
    lines.push('  ' + d.id + ' —— ' + d.name + '（' + n + ' 位）：' + d.desc)
  }
  lines.push('')
  lines.push('执行：/expert setup <域> [身份专家id]   例如 /expert setup infosec infosec-ics-security')
  lines.push('  · 域 —— 你的岗位方向，决定打分先验（跨域专家仍可被命中）')
  lines.push('  · 身份专家 —— **常驻注入的唯一一位**；留空则取该域第一位')
  const id = identityExpertOf(c)
  lines.push('当前：' + c.defaultDomain + (c.expertSetupDone ? '（引导已完成）' : '（默认值，尚未确认）')
    + '；身份专家：' + (id ? id.name + '（' + id.id + '）' : '（无）'))
  return lines.join('\n')
}
