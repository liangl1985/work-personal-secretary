/**
 * dsh-experts — 设置命名空间（0.1.x 原生设置服务 / 0.2.0-rc.2 具名导出 Config 双口径）
 *
 * 两种宿主口径并存（2026-09-30 迁移）：
 *   ① 0.1.x：`ctx.settings.register(ns, schema, { base })` 显式注册命名空间，组合配置作 base 层，
 *      用户覆盖层由设置页「插件」分区写入（免重启，带 revision 栅栏），插件侧只读 scope.get() 快照并可 watch；
 *   ② 0.2.0-rc.2：settings 服务不再提供 register —— cordis 注册插件时捕获**具名导出的 Config**
 *      （`vendor/cordis/src/registry.ts:326` → `packages/settings/settings/src/index.ts:425-428`），
 *      命名空间即 profile entry id（本模块的是 `experts`，与 SETTINGS_NS 同值），取值来自 `apply(ctx, config)`。
 *
 * rc.2 的两条硬性口径（源码依据）：
 *   - **只有带 `.volatile()` 的字段进设置表单**：`packages/settings/settings/src/schema.ts:37-47` 的
 *     `volatileForm()` 只挑 volatile 子树，整棵无 volatile 时 `index.ts:308-309` 直接返回空 —— 条目在设置页不出现。
 *     故本文件把「迁移前设置页可改」的字段逐个标 volatile（不标 = rc.2 下功能回退）。
 *     例外：`.volatile()` 是 schemastery **3.18.3** 才有的方法（peer 下界 ^3.18.1），必须特性探测 ——
 *     schema 在模块顶层求值，裸调会抛 TypeError，而外层 try/catch 只包 `await import()`，接不住
 *     → 整个插件加载失败。
 *   - **Config 绝不能是 `null`**：`index.ts:427` 判据 `'toJSON' in schema` 对 null 会抛 TypeError；
 *     schemastery 不可用时导出 `undefined`（那时 cordis 原样透传 config，插件退回 DEFAULTS）。
 *
 * 热更语义（rc.2）：volatile 是 loader **就地更新**的引用（`vendor/loader/src/config/entry.ts:162-195`
 * 的 `_commitVolatile()` → `updateVolatile(ref, source)`），**不重跑 apply 也不重启 fiber**，
 * 因此 read() 每次实时解包 baseConfig，watch 由 `loader/volatile-update` 事件驱动。
 *
 * 注入口径（2026-09-16 重构后，与设置通道无关）：
 *   ① 按**会话阶段**分两态：首轮全景（命中专家全给精简卡）→ 干活轮（判定要干活的给全文）；
 *   ② 注入位数上限**写死 4**（expertInjectMax，见下方 volatile 例外说明）；
 *   ③ 岗位关联（defaultDomain）只作同证据时的排序先验，不决定是否注入；
 *   ④ 全局激活集合（enabledDomains / enabledExperts）决定谁参与自动匹配；
 *   ⑤ 未注入的专家走临时注入（expert_recall），不常驻上下文；零命中则一位都不注入。
 *
 * @module dsh-experts/settings
 */

import { INJECT_MAX_HARD, clampInjectMax, clampUnit, clampBudget, clampSkillBudget, normalizeDetail, INJECT_BUDGET_DEFAULT, SKILL_BUDGET_DEFAULT, clampFullHitMax, FULL_HIT_MAX_DEFAULT } from './limits.js'

export { INJECT_MAX_HARD, clampInjectMax, clampBudget, clampSkillBudget, normalizeDetail, INJECT_BUDGET_DEFAULT, SKILL_BUDGET_DEFAULT, clampFullHitMax, FULL_HIT_MAX_DEFAULT }

/**
 * schemastery 是宿主运行时依赖（peerDependencies）。这里用**动态导入降级**：
 * 真实宿主一定有它；在没有宿主依赖的环境（CI、纯 node 单测/冒烟）里模块仍能加载，
 * 只是设置命名空间注册被跳过 —— 插件退回组合配置的默认值，功能不受影响。
 */
let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

/** 设置命名空间名（设置页卡片按它派发；rc.2 下 = profile entry id `experts`） */
export const SETTINGS_NS = 'experts'

/**
 * 兜底默认值：与 schema 默认值保持一致。
 * schema 解析失败或设置服务缺失时，插件退回这份值（行为与组合配置一致）。
 */
export const DEFAULTS = {
  expertsEnabled: true,
  injectOrder: 480,
  expertCatalogEnabled: true,
  disciplineEnabled: true,
  disciplineMemoryDir: '',
  defaultDomain: 'infosec',
  identityExpert: '',
  enabledDomains: '',
  enabledExperts: '',
  expertInjectMax: 4,
  skillInjectEnabled: true,
  skillBudgetChars: SKILL_BUDGET_DEFAULT,
  expertInjectDetail: 'auto',
  expertInjectBudgetChars: INJECT_BUDGET_DEFAULT,
  expertFullHitMax: FULL_HIT_MAX_DEFAULT,
  expertSecondThreshold: 0.3,
  expertGeneralMax: 1,
  expertGeneralMinEvidence: 0.2,
  expertShowBanner: true,
  expertSetupDone: false,
}

/**
 * 特性探测包一层 `.volatile()`：该方法 schemastery **3.18.3** 才引入，而本包 peer 下界是 `^3.18.1`；
 * 本表达式又在**模块顶层求值**，裸调 `.volatile()` 会抛 TypeError，且外层 try/catch 只包着 `await import()`，
 * 接不住 → 整个插件加载失败。宿主版本不支持时原样返回（该字段不进设置页，但不崩）。
 *
 * @param {object} field schemastery 字段 schema
 * @returns {object} 调用过 `.volatile()` 的字段，或原样返回
 */
function withVolatile(field) {
  return field && typeof field.volatile === 'function' ? field.volatile() : field
}

/**
 * 设置页渲染的 schema（description 即卡片上的说明文字）。
 *
 * volatile 口径（2026-09-30 迁移）：**除 `expertInjectMax` 外逐个标 volatile**。
 * 原因是 0.1.x 时这些字段本就在设置页可改，rc.2 只投影 volatile 字段，不标即等于功能回退；
 * 唯一例外 `expertInjectMax` 本来就刻意**不在设置页提供**（2026-09-15 使用者定：注入位数写死 4，
 * 避免误调），故保持不 volatile —— rc.2 下它仍可从组合配置（profile patch）取值，
 * 只是不出现在设置表单里，与原口径一致。
 *
 * 不可用时导出 `undefined`（**不是 null**，见文件头口径）。
 */
export const EXPERTS_SETTINGS_SCHEMA = z ? z.object({
  expertsEnabled: withVolatile(z.boolean().default(true))
    .description('专家库总开关（关闭后不注入任何 persona，专家工具与命令仍可用）'),

  expertCatalogEnabled: withVolatile(z.boolean().default(true))
    .description('是否注入「专家库目录段」（走 systemPrompt.section，order 10150）：列出六个域的成员与「可用能力」，让模型判断问题归属时知道库里有什么。它是**稳定段**（只在专家库增删专家/技能时变，不随任务变），也不占每轮专家注入预算；追求极简上下文时可关闭'),

  disciplineEnabled: withVolatile(z.boolean().default(true))
    .description('是否注入「交付层·纪律块」（走 systemPrompt.context，order 481）：从项目记忆里读【纪律块 v1】条目，每轮注入、不随专家裁剪丢弃。自检红线的新家 —— 红线写在记忆里（真相源），插件只读不改'),

  disciplineMemoryDir: withVolatile(z.string().default(''))
    .description('纪律块的记忆库根目录；留空 = 自动取 work-memory 设置里的 memoryDir，再退到 <DSH_HOME>/data/dsh-work-memory/memory。读取的是 <根>/PROJECTS/dsh-experts.md 里的【纪律块 v1】条目（只读，绝不写）'),

  defaultDomain: withVolatile(z.string().default('infosec'))
    .description('本人岗位默认域 —— 安装引导会问一次。取值：infosec 信息安全 / accounting 财务 / hr 人力资源 / coding 代码编程 / finance 金融 / general 通用职能。它决定任务优先从哪个专业角度被拆解（给会计岗同事用时改成 accounting 即可，无需改代码）'),

  identityExpert: withVolatile(z.string().default(''))
    .description('要**常驻注入**的身份专家（专家 id，如 infosec-ics-security）；**留空 = 不常驻任何身份专家**（身份由记忆层承担，2026-09-14 起）。需要每轮固定视角时显式填 id；其余专家由「问题归属判断」决定是否本轮注入或派子代理激活'),

  enabledDomains: withVolatile(z.string().default(''))
    .description('把匹配范围**收窄**到这些域（逗号分隔，如 infosec,accounting）；留空 = 全部专家都参与匹配。「本人岗位」只作打分先验，不当白名单（否则跨域任务会命中不了本域之外的专家）'),

  enabledExperts: withVolatile(z.string().default(''))
    .description('把匹配范围**收窄**到这些专家（id 逗号分隔，如 infosec-bid-proposal,accounting-tax）；留空 = 不收窄。范围外的专家不参与自动匹配，仍可用 expert_recall 现取现用'),

  expertInjectMax: z.natural().default(4)
    .description('**persona 注入软上限**：**默认 4，且 2026-09-15 起不在设置页提供**（使用者定：直接写死，避免误调）。0 = 不限（交由字符预算与分数阈值守门）；如需收紧，改本机 profile 的 cordis.patch.yml 里 entry id experts 的 config.expertInjectMax（取值 1–3）后重启生效 —— 0.2.0-rc.2 首启会把 ~/.dsh/settings.yaml 搬为 settings.yaml.imported，改该文件已不再生效。实测 20 条真实任务**无一命中 4 位**（70% 只命中 1 位），故 4 是「留余量」而非「常态化占满」'),

  skillInjectEnabled: withVolatile(z.boolean().default(true))
    .description('是否注入**能力层指针**（工具 / 技能专家）：从本轮任务识别要用的技能，只注入一行「去哪拿」的指针（约 100 字符/条），做法原文由 skill 工具按需加载。它独立于 persona 命中，**不占** expertInjectMax 配额，也不受 enabledDomains 收窄'),

  skillBudgetChars: withVolatile(z.natural().default(SKILL_BUDGET_DEFAULT))
    .description('能力层指针的字符预算（默认 300，约 3 条）：只放指针不放做法原文；0 = 不注入指针（等同只关能力层注入，persona 不受影响）'),

  expertInjectDetail: withVolatile(z.string().default('auto'))
    .description('每轮注入形态：**auto**（默认，按会话阶段分两态 —— 首轮全景给全部命中专家的精简卡；后续判定要干活的专家给全文，其余本轮不注入）/ **card**（全部精简卡）/ **full**（全文，旧行为逃生舱）。⚠️ full 会把每位 persona 正文全文注入（约 1.7–3.2 千字符/位）；auto 常态只花 4 位卡 ≈2535 字符（≈1.6k TOKEN），干活轮 1–2 位全节约 2–6.5 千字符。取值非法时回落 auto'),

  expertInjectBudgetChars: withVolatile(z.natural().default(INJECT_BUDGET_DEFAULT))
    .description('每轮专家注入的**字符上限**（默认 15000，按**最大可能消费**定档：单篇全文上限 3600 × 位数硬边界 4 + 块头尾注与处理路径 ≈ 14850）。只作上限，**不再降级** —— 超出即截断并标注（绝不静默超限）。调小＝更省但会截断；真正的**安全红线**是 20000（任何形态含 full 都不得突破）'),

  expertFullHitMax: withVolatile(z.natural().default(FULL_HIT_MAX_DEFAULT))
    .description('干活轮给**全文**的位数（默认 2）：按本轮任务证据取**最大 + 次大**（并列取任意两位，**不设固定门槛**）；硬边界 4。1 位更省，4 位最全'),

  expertSecondThreshold: withVolatile(z.number().default(0.3))
    .description('**域专家**的第 2/3 位门槛：其关键词证据 ≥ 本轮最强证据 × 该值时才注入（默认 0.3；仅 expertInjectMax ≥ 2 时生效）。注意这是**相对门槛** —— 第一名证据越强、后面越难进；实测 0.8 时 70% 的任务只能命中 1 位，故 2026-09-15 调为 0.3'),

  expertGeneralMax: withVolatile(z.natural().default(1))
    .description('**通用型专家**（核查 / 排版 / 文档 / 演示 / 设计）的独立配额，默认 1。2026-09-15 起通用专家与行业域专家**分开评分、分开门槛**（域专家走上面的相对门槛，通用专家走下面的绝对门槛）—— 否则通用专家在本机 defaultDomain=infosec 下拿不到岗位先验，会被结构性挤掉。设 0 = 不保底'),

  expertGeneralMinEvidence: withVolatile(z.number().default(0.2))
    .description('**通用型专家**的绝对门槛：关键词证据 ≥ 该值即可入选（默认 0.2 = 命中 1 个关键词）。通用专家的触发词更泛、证据天然更低，用域专家的相对门槛会让它们永远补不进来'),


  expertShowBanner: withVolatile(z.boolean().default(true))
    .description('注入时显示「当前专家视角」标识，便于你知道本轮用的是哪位专家'),

  expertSetupDone: withVolatile(z.boolean().default(false))
    .description('安装引导是否已完成（问过「你的工作方向是？」并写入 defaultDomain）；重置为关可让引导下次再问一次'),
}) : undefined

/**
 * rc.2 的具名导出：cordis 注册插件时把它捕获为 `plugin.Config`（vendor/cordis/src/registry.ts:326），
 * settings 服务再由它派生设置表单。0.1.x 下这个导出没有副作用（那里走 installSettings 的 register 分支）。
 */
export const Config = EXPERTS_SETTINGS_SCHEMA

/** volatile 引用的跨副本协议符号（与 vendor/cosmokit/src/volatile.ts:3 同源，走 Symbol.for 全局注册表） */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 解包 rc.2 的 volatile 引用（取当前值）。
 *
 * 官方判定见 `vendor/cosmokit/src/volatile.ts:52-54` 的 `isVolatile()`：
 * `typeof value === 'object' && value !== null && write in value`。
 * **不能用 `typeof v.get === 'function'`**：那会误伤 `new Map()`（get 是方法，解包后变 undefined、
 * 数据丢失）以及任何带 get 的普通对象。普通值（含函数、数组、Map）一律原样返回。
 *
 * @param {unknown} v 解析后的配置值（可能是 volatile 引用，也可能是普通值）
 * @returns {unknown} 解包后的普通值
 */
export function unwrapValue(v) {
  return v && typeof v === 'object' && VOLATILE_WRITE in v ? v.get() : v
}

/** 把组合配置里的 null/undefined/未知键规整成 schema 能接受的值（先解包 volatile） */
function normalizeBase(base) {
  const out = {}
  for (const [key, value] of Object.entries(base ?? {})) {
    if (!(key in DEFAULTS)) continue
    const v = unwrapValue(value)
    if (v === null || v === undefined) continue
    out[key] = v
  }
  return out
}

/** 解析值 → 插件内部配置（逐已知键解包 volatile，再做数值归一化） */
function toConfig(resolved) {
  const src = resolved ?? {}
  const cfg = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = unwrapValue(src[key])
    if (value !== null && value !== undefined) cfg[key] = value
  }
  cfg.expertInjectMax = clampInjectMax(cfg.expertInjectMax)
  cfg.expertInjectDetail = normalizeDetail(cfg.expertInjectDetail, DEFAULTS.expertInjectDetail)
  cfg.expertInjectBudgetChars = clampBudget(cfg.expertInjectBudgetChars, DEFAULTS.expertInjectBudgetChars)
  cfg.skillBudgetChars = clampSkillBudget(cfg.skillBudgetChars, DEFAULTS.skillBudgetChars)
  // 干活轮给全文的位数（2026-09-16 新增）
  cfg.expertFullHitMax = clampFullHitMax(cfg.expertFullHitMax, DEFAULTS.expertFullHitMax)
  const th = clampUnit(cfg.expertSecondThreshold, DEFAULTS.expertSecondThreshold)
  cfg.expertSecondThreshold = th > 0 ? th : DEFAULTS.expertSecondThreshold
  // 通用型专家的独立配额与绝对门槛（2026-09-15 新增）
  const gm = Number(cfg.expertGeneralMax)
  cfg.expertGeneralMax = Number.isFinite(gm) && gm >= 0 ? Math.floor(gm) : DEFAULTS.expertGeneralMax
  cfg.expertGeneralMinEvidence = clampUnit(cfg.expertGeneralMinEvidence, DEFAULTS.expertGeneralMinEvidence)
  cfg.enabledDomains = String(cfg.enabledDomains ?? '').trim()
  cfg.enabledExperts = String(cfg.enabledExperts ?? '').trim()
  cfg.defaultDomain = String(cfg.defaultDomain ?? '').trim() || DEFAULTS.defaultDomain
  cfg.identityExpert = String(cfg.identityExpert ?? '').trim()
  return cfg
}

/**
 * 注册设置命名空间并把解析值接到插件运行时（双分支）。
 *
 * - 分支 A（0.1.x，`ctx.settings.register` 存在）：行为与迁移前一致 —— 组合配置作 base 层、
 *   `scope.get()` 取值、`scope.watch` 热更。
 * - 分支 B（rc.2，无 register，**正常路径**）：取值来自 `apply(ctx, config)`，表单由具名导出
 *   `Config` 派生；volatile 由 loader 就地提交（不重跑 apply、不重启 fiber），故 read() 每次实时
 *   解包 baseConfig，并监听 `loader/volatile-update` 驱动 watch 订阅者。不抛不 warn。
 * - 降级（schemastery 不可用或注册抛错）：`available: false`，read 仍返回组合配置解析值。
 *
 * @param {object} ctx - cordis context（需 settings 服务）
 * @param {object} [baseConfig] 组合配置（bundle entry config）；rc.2 下含 volatile 引用
 * @returns {{ read: () => object, watch: (cb: Function) => void, scope: object|null, available: boolean, mode: 'register'|'config'|'none' }}
 */
export function installSettings(ctx, baseConfig = {}) {
  const listeners = []
  let scope = null
  let mode = 'none'
  let current = toConfig(baseConfig)

  /** 把当前解析值推给 watch 订阅者；单个回调抛错不影响其它回调 */
  const notify = () => {
    for (const cb of listeners) {
      try {
        cb(current)
      } catch (err) {
        ctx?.logger?.warn?.('dsh-experts: 设置变更回调失败：' + (err?.message || err))
      }
    }
  }

  try {
    if (!z || !EXPERTS_SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    if (ctx && ctx.settings && typeof ctx.settings.register === 'function') {
      // ---- 分支 A：0.1.x 显式注册（行为与迁移前一致） ----
      const base = normalizeBase(baseConfig)
      scope = ctx.settings.register(SETTINGS_NS, EXPERTS_SETTINGS_SCHEMA, { base })
      current = toConfig(scope.get())
      scope.watch(() => {
        current = toConfig(scope.get())
        notify()
      })
      mode = 'register'
      ctx.logger?.debug?.('dsh-experts: 设置命名空间已注册（设置→插件 可配置）')
    } else {
      // ---- 分支 B：0.2.0-rc.2 具名导出 Config 派生（无 register 是正常口径，不降级、不告警） ----
      mode = 'config'
      if (ctx && typeof ctx.on === 'function') {
        ctx.on('loader/volatile-update', () => {
          current = toConfig(baseConfig)
          notify()
          ctx.logger?.debug?.('dsh-experts: 设置已更新（volatile 就地提交）')
        })
      }
      ctx?.logger?.debug?.('dsh-experts: 设置由具名导出 Config 派生（rc.2 口径），读取时实时解包 volatile 引用')
    }
  } catch (err) {
    ctx?.logger?.warn?.('dsh-experts: 设置服务不可用，退回组合配置：' + (err?.message || err))
    scope = null
    mode = 'none'
  }

  return {
    // 分支 A 用 scope 维护的 current；分支 B 与降级路径每次实时解包 baseConfig（volatile 引用就地更新）
    read: () => (scope ? current : toConfig(baseConfig)),
    watch: (cb) => {
      if (typeof cb === 'function') listeners.push(cb)
    },
    get scope() {
      return scope
    },
    available: mode !== 'none',
    mode,
  }
}
