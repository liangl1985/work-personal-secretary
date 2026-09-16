/**
 * work-personal-secretary —— 岗位身份：预置正文与生成通道
 *
 * 两件事：
 *   1. 五个预置岗位的**可直接写入身份的正文**（由对应行业域专家卡提炼，通用骨架、不含个人称呼）；
 *   2. POST /domain/generate 的生成通道 —— 与桌宠 workspace-tokenpet 完全同构：
 *      ① ctx.get('promptEnhancer') 优先；② 回退 ctx.get('llm') + ctx.get('agentDefaultModel')；
 *      ③ 都没有 → 可读错误（前端改为手填），**绝不假成功**。
 *
 * 重要（本单硬要求）：promptEnhancer / llm / agentDefaultModel **不写进 inject**。
 * 它们是可选运行时服务，写进 inject 会让缺这些服务的环境整个插件加载失败；
 * 这里一律用 ctx.get(...) 运行时取值并降级。
 *
 * 发布件中立：预置正文与提示词不含任何个人路径、称呼、姓名、凭据、客户或项目名称、业绩数字。
 *
 * @module work-personal-secretary/domain
 */

/** 记忆条目正文的统一前缀（身份写入模块据此定位唯一目标条目） */
export const IDENTITY_PREFIX = '使用者身份：'

/**
 * 生成正文的长度上限（设计定稿 §9：**200 字以内一段话**）。
 * 2026-09-16 曾一度裁定改为 300 字，同日**已更正回 200** —— 维持原口径。
 * 它同时是**服务端兜底截断值**：模型不听话时也不会把超长内容写进身份条目。
 */
export const DOMAIN_MAX_CHARS = 200

/** 岗位名称的长度上限（2026-09-16 裁定：**≤10 字**；正文口径已撤回，本条保留）；生成提示与入库前都按此归一化 */
export const DOMAIN_NAME_MAX_CHARS = 10

/** 生成通道的独立 purpose 标识（与桌宠的 workspace-tokenpet-prompt-enhance 区分） */
export const DOMAIN_PURPOSE = 'work-personal-secretary-domain'

/**
 * 生成调用的 **token 预算（模型用量）** —— 与桌宠的 **2048** 档位对齐。
 *
 * 口径边界（2026-09-16 明确）：**「输出字数」与「模型用量」是两件事**。
 *   · 200 字是产品对**最终写入内容**的约束（提示词 + 前端 maxLength + 服务端截断三层保证）；
 *   · `maxTokens` 是**给模型的额度**，不从输出字数反推、也不为省用量压小 ——
 *     512 正是被推理阶段吃光、收不到 `text-delta` 的那个取值。
 *
 * 宿主契约（一手核实）：
 *   · `maxTokens` 被原样映射为 provider 的 `max_tokens`，**不做 clamp**，只要求正整数
 *     （`@deepseek-ai/dsh-llm-deepseek/lib/index.js:246` 与同文件 `:1965`）；
 *   · 该 adapter 自身默认上限是 `config.maxTokens ?? 256e3`（同文件 `:1998`）——
 *     2048 远低于宿主可用额度，属「给足而不过量」；
 *   · 推理（reasoning）与正文**共用同一预算**，额度必须同时覆盖思考与正文。
 * 下面的 CAP 只是防御性的调用方可传上限（远低于 adapter 的 256000）。
 */
export const DOMAIN_MAX_TOKENS = 2048
/** 调用方可覆盖的 token 上限（防御性上限，不是推荐值） */
export const DOMAIN_MAX_TOKENS_CAP = 4096

/** 生成用的系统提示词（只输出可直接写入的正文） */
export const DOMAIN_SYSTEM_PROMPT = [
  '你为个人助手写一条「使用者身份」记忆条目的正文。',
  '只输出正文本身，不要任何前言、解释、标题、markdown 标记、引号或项目符号。',
  '正文必须写成一段中文，200 字以内，内容依次覆盖：岗位名称与职责、关注点与边界、常见产出物。',
  '岗位名称不超过 10 个字（给的名字过长时，按前 10 个字理解即可，不要复述名字）。',
  '只写使用者（人）的身份与工作，不写助手人设、不写称呼、不写公司名与客户名。',
  '不编造资质、证书、业绩数字与从业年限。',
  '不要以「使用者身份：」开头（系统会统一加前缀）。',
].join('')

/**
 * 五个预置岗位（设计定稿 §3.2：信息安全 / 财务 / 人力资源 / 代码编程 / 金融）。
 * content = 可直接写入身份的正文（不含「使用者身份：」前缀，由写入模块统一加）。
 */
export const DOMAIN_PRESETS = [
  { id: 'infosec', label: '信息安全', content: '从事信息安全售前工作，面向电力、石化、制造等生产型客户，负责工控与网络安全方案设计、技术应答与投标支持。关注生产连续性优先：任何措施先判定停机影响与实施窗口，用分区、管道与安全等级作为对话口径；不代出测评结论、渗透测试报告与商务承诺。常见产出物：资产与拓扑清单、分区与管道图、安全等级对照表、合规映射矩阵、技术方案与应答表、分期路线与停机影响说明。' },
  { id: 'accounting', label: '财务', content: '从事财务与会计工作，按企业会计准则或小企业会计准则记账、结账与出表，对凭证、账簿与三大报表负责。关注账实、账证、账账、账表四相符，会计口径与税务口径分开处理、差异留在税会差异里；不代出审计意见，涉税处理与筹划交税务专业。常见产出物：记账凭证与附件清单、科目余额表与试算平衡表、三大报表、月末结账检查清单、调整分录说明。' },
  { id: 'hr', label: '人力资源', content: '从事人力资源与劳动关系工作，按中国大陆口径处理劳动合同、社保、竞业限制与用工争议。关注关系性质认定、强制规定与可协商约定的区分、程序与送达留痕；引用法条前核对现行原文，给出依据与区间并注明适用地区与时点，不替代律师的正式法律意见，工资与补偿的个税处理交税务专业。常见产出物：合规风险清单、条款审查意见、争议处理路径与举证要点、留痕文书清单。' },
  { id: 'coding', label: '代码编程', content: '从事软件开发工作，把需求做成本机可跑、可读、可改、可回退的代码。关注先讲清边界与取舍、改动小而可回滚、接口与数据结构的兼容性、凭据不入代码，写完自己先跑一遍再交；写文件与批量类操作先 dry-run，采集类任务守合规边界。常见产出物：可运行代码与改动说明、运行与验证命令、接口变更清单与迁移路径、回滚方式、遗留问题与后续建议。' },
  { id: 'finance', label: '金融', content: '从事投资研究工作，产出可证伪的论点：先写清判断依据，再写清什么数据会推翻它。关注一手来源与数据日期、看多与看空同等严谨、下行风险量化、估值方法的适用边界；不给买卖时点、仓位与目标价承诺，不替使用者做买入决定，策略实现与风控交量化专业。常见产出物：研究报告、数据来源与日期清单、估值区间与逐项假设、风险与论点破坏者监控清单。' },
]

/** 岗位 id 是否在预置清单里 */
export function isPresetDomainId(id) {
  return DOMAIN_PRESETS.some((p) => p.id === id)
}

/** 取预置岗位（找不到返回 null） */
export function findPresetDomain(id) {
  return DOMAIN_PRESETS.filter((p) => p.id === id)[0] || null
}

/** 归一化一行入参（去空白 + 截断） */
function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max || 200) : ''
}

/**
 * 把模型输出归一化成「可直接写入」的正文：
 * 去 markdown 装饰 → 合并成一段 → 剥掉可选前缀 → 截断到上限。
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function normalizeDomainText(text, max) {
  let s = String(text == null ? '' : text)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, '')
  s = s.replace(/\*\*/g, '').replace(/[\u0060]/g, '')
  s = s.replace(/[\n\t]+/g, ' ')
  s = s.replace(/[ ]{2,}/g, ' ').trim()
  s = s.replace(/^「?使用者身份[:：]?」?[ ]*/, '')
  s = s.replace(/^「|」$/g, '').trim()
  const limit = max || DOMAIN_MAX_CHARS
  if (s.length > limit) s = s.slice(0, limit)
  return s
}

/**
 * 组装生成请求（system + user 提示词）。
 * @param {{name?:string, content?:string}} input
 * @returns {{system:string, prompt:string}}
 */
export function buildDomainPrompt(input = {}) {
  const name = cleanText(input.name, DOMAIN_NAME_MAX_CHARS) || '（未命名岗位）'
  const draft = cleanText(input.content, 1000)
  const lines = [
    '岗位名称：' + name,
  ]
  if (draft) lines.push('使用者已填的岗位内容（作为主要依据）：' + draft)
  lines.push('请据此写出这条「使用者身份」条目的正文。')
  return { system: DOMAIN_SYSTEM_PROMPT, prompt: lines.join('\n') }
}

/**
 * 运行生成通道。**不抛异常**：一切失败都收敛成可读结果（调用方据此回 HTTP 状态码）。
 * 通道与桌宠同构：promptEnhancer 优先 → llm + agentDefaultModel → 都不可用则失败。
 *
 * @param {object} ctx cordis context（需支持 ctx.get，可选）
 * @param {{name?:string, content?:string, maxTokens?:number}} input
 * @returns {Promise<{ok:boolean, content:string, channel:string, provider:string, model:string, code:string, error:string}>}
 */
export async function generateDomainContent(ctx, input = {}) {
  const built = buildDomainPrompt(input)
  // 名称先归一化（≤10 字），提示词与响应回显共用同一个值
  const domainName = cleanText(input.name, DOMAIN_NAME_MAX_CHARS)
  const maxTokens = Number.isInteger(input.maxTokens) && input.maxTokens > 0
    ? Math.min(input.maxTokens, DOMAIN_MAX_TOKENS_CAP)
    : DOMAIN_MAX_TOKENS
  const get = (ctx && typeof ctx.get === 'function') ? (name) => { try { return ctx.get(name) } catch (e) { return undefined } } : () => undefined

  // ① promptEnhancer 优先（与桌宠一致）
  const enhancer = get('promptEnhancer')
  if (enhancer && typeof enhancer.enhance === 'function') {
    try {
      const result = await enhancer.enhance({ prompt: built.prompt, template: built.system })
      const text = typeof result === 'string' ? result : (result && result.enhanced)
      const content = normalizeDomainText(text)
      if (content) {
        return { ok: true, content: content, channel: 'promptEnhancer', provider: '', model: (result && result.model) || '', code: '', error: '', name: domainName }
      }
      return { ok: false, content: '', channel: 'promptEnhancer', provider: '', model: '', code: 'empty', error: '提示词增强服务没有返回正文，请改为手填' }
    } catch (err) {
      return { ok: false, content: '', channel: 'promptEnhancer', provider: '', model: '', code: 'enhancer-failed', error: '生成失败（提示词增强服务报错）：' + String(err && err.message ? err.message : err).slice(0, 200) + '；可改为手填' }
    }
  }

  // ② 回退 llm + agentDefaultModel
  const llm = get('llm')
  const defaults = get('agentDefaultModel')
  let providers = []
  if (llm && typeof llm.listProviders === 'function') {
    try { providers = llm.listProviders() || [] } catch (e) { providers = [] }
  }
  let selection = {}
  if (defaults && typeof defaults.currentSelection === 'function') {
    try { selection = defaults.currentSelection() || {} } catch (e) { selection = {} }
  }
  // 透传推理强度：agentDefaultModel.currentSelection() 会带 reasoningEffort（取不到就不传，向后兼容）
  const reasoningEffort = typeof selection.reasoningEffort === 'string' && selection.reasoningEffort
    ? selection.reasoningEffort : ''
  // 路由优先级（与桌宠 lib/prompt-route.js 的 resolvePromptRoute 同构）：
  //   ① 请求体显式传入（客户端从会话上下文取到后带上）→ ② agentDefaultModel（首轮之前的兜底）
  //   ③ 唯一 provider → ④ 该 provider 的首个模型。
  // 说明：设置分区插槽只拿到 { close }（宿主 dsh-client-ui-settings-general/lib/client.js:197），
  // 拿不到会话路由；会话路由只能由客户端经请求体带入（桌宠同样如此）。
  const requestProvider = cleanText(input.provider, 64)
  const requestModel = cleanText(input.model, 64)
  let provider = requestProvider || selection.provider || (providers[0] && providers[0].id) || ''
  let model = requestModel || (provider === selection.provider ? selection.model : '') || ''
  if (!model && llm && provider && typeof llm.listModels === 'function') {
    try {
      const models = await llm.listModels(provider)
      model = (models && models[0] && models[0].id) || ''
    } catch (e) { model = '' }
  }
  if (!llm || typeof llm.stream !== 'function' || !provider || !model) {
    return {
      ok: false, content: '', channel: 'llm', provider: provider, model: model, code: 'no-model-service',
      error: '当前 profile 未提供可用的模型服务（promptEnhancer 与 llm 都不可用），无法自动生成；请改为手填岗位内容，或先在 DSH 里配置模型。',
    }
  }
  const baseRequest = {
    provider: provider,
    model: model,
    system: built.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: built.prompt }], source: { kind: 'plugin', plugin: 'work-personal-secretary' } }],
    maxTokens: maxTokens,
    // 宿主 GenerateOptions.purpose 的类型只允许 'compaction' | 'session-title'，且 LlmRuntime 运行时
    // 不读取它（dsh-llm/lib/typert.host.js:287；dsh-llm/lib/index.js 内无消费点）。保留只为将来可追踪。
    purpose: DOMAIN_PURPOSE,
  }

  /**
   * 跑一次流，把 chunk 收成可判定的事实：正文 / 是否收到过推理 / 结束原因。
   * @param {boolean} withEffort 是否带上 reasoningEffort
   */
  const runStream = async (withEffort) => {
    const request = Object.assign({}, baseRequest)
    if (withEffort && reasoningEffort) request.reasoningEffort = reasoningEffort
    let text = ''
    let reasoningChars = 0
    let sawReasoning = false
    let finishKind = ''
    let finishFailure = ''
    for await (const chunk of llm.stream(request)) {
      if (!chunk) continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        sawReasoning = true
        reasoningChars += chunk.text.length
      } else if (chunk.type === 'finish') {
        finishKind = (chunk.reason && chunk.reason.kind) || ''
        finishFailure = (chunk.reason && chunk.reason.failure && chunk.reason.failure.message) || ''
      }
    }
    return { text: text, sawReasoning: sawReasoning, reasoningChars: reasoningChars, finishKind: finishKind, finishFailure: finishFailure }
  }

  /** 失败结果统一形状（可读中文 + 排查证据） */
  const fail = (code, error, extra) => Object.assign({
    ok: false, content: '', channel: 'llm', provider: provider, model: model, code: code, error: error,
    name: domainName, maxTokens: maxTokens, reasoningEffort: reasoningEffort, finishKind: '', reasoningChars: 0,
  }, extra || {})

  try {
    let run = await runStream(true)
    // 推理强度与宿主/连接侧配置冲突（例如连接已禁用 thinking）→ 去掉该字段重试**一次**；
    // 只在确实没有拿到正文时重试，避免重复调用与重复计费。
    if (!normalizeDomainText(run.text) && run.finishKind === 'error' && /reasoning|thinking/i.test(String(run.finishFailure))) {
      run = await runStream(false)
    }
    const content = normalizeDomainText(run.text)
    if (content) {
      return {
        ok: true, content: content, channel: 'llm', provider: provider, model: model, code: '', error: '',
        name: domainName, maxTokens: maxTokens, reasoningEffort: reasoningEffort,
        finishKind: run.finishKind, reasoningChars: run.reasoningChars,
      }
    }
    const evidence = '（channel=llm, model=' + model + ', maxTokens=' + maxTokens
      + (reasoningEffort ? ', reasoningEffort=' + reasoningEffort : '')
      + (run.finishKind ? ', finish=' + run.finishKind : '') + '）'
    if (run.finishKind === 'error') {
      return fail('stream-failed', '生成失败：' + String(run.finishFailure || '模型返回错误').slice(0, 200) + '；可改为手填',
        { finishKind: run.finishKind, reasoningChars: run.reasoningChars })
    }
    if (run.sawReasoning) {
      // 关键区分：**收到过 reasoning-delta 但正文为空** = 预算被思考吃掉，不是「模型什么都没输出」
      return fail('reasoning-only',
        '模型把 token 预算用在了思考上，没有留下正文（收到 ' + run.reasoningChars + ' 字符推理内容、正文 0 字符）'
        + evidence + '；可重试，或先手填一句岗位内容再点「自动生成」，也可直接手填',
        { finishKind: run.finishKind, reasoningChars: run.reasoningChars })
    }
    if (run.finishKind === 'max-tokens') {
      return fail('max-tokens',
        '模型输出被 token 上限截断，未产出正文（上限 ' + maxTokens + ' token）' + evidence + '；可重试或改为手填',
        { finishKind: run.finishKind })
    }
    return fail('empty', '模型没有返回任何内容（既无正文也无推理输出）' + evidence + '；可重试或改为手填', { finishKind: run.finishKind })
  } catch (err) {
    return fail('stream-failed', '生成失败：' + String(err && err.message ? err.message : err).slice(0, 200) + '；可改为手填')
  }
}
