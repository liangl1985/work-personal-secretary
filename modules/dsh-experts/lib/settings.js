/**
 * dsh-experts — 设置命名空间（DSH 0.1.5-rc.1 原生设置服务）
 *
 * 与 dsh-work-memory 同构：组合配置（bundle entry config）作为 `base` 层，
 * 用户覆盖层由设置页「插件」分区写入（免重启，带 revision 栅栏），
 * 插件侧只读解析后的深冻结快照，并可 watch 已提交变更。
 *
 * 四项口径（产品口径 2026-09-12 定）：
 *   ① 默认注入 2 位，可调 1 或 3，>1 时设置页明确提示「占用较多 TOKEN」；
 *   ② 岗位关联（defaultDomain）安装引导问一次 —— 决定任务从哪个专业角度拆解；
 *   ③ 全局激活集合（enabledDomains / enabledExperts）决定谁参与自动匹配；
 *   ④ 未激活/未注入的专家走临时注入（/expert use、expert_recall），不常驻上下文。
 *
 * @module dsh-experts/settings
 */

import { INJECT_MAX_HARD, clampInjectMax, clampUnit, clampBudget, clampSkillBudget, normalizeDetail, INJECT_BUDGET_DEFAULT, SKILL_BUDGET_DEFAULT } from './limits.js'

export { INJECT_MAX_HARD, clampInjectMax, clampBudget, clampSkillBudget, normalizeDetail, INJECT_BUDGET_DEFAULT, SKILL_BUDGET_DEFAULT }

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

/** 设置命名空间名（设置页卡片按它派发） */
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
  expertSecondThreshold: 0.3,
  expertGeneralMax: 1,
  expertGeneralMinEvidence: 0.2,
  expertShowBanner: true,
  expertSetupDone: false,
}

/** 设置页渲染的 schema（description 即卡片上的说明文字） */
export const EXPERTS_SETTINGS_SCHEMA = z ? z.object({
  expertsEnabled: z.boolean().default(true)
    .description('专家库总开关（关闭后不注入任何 persona，专家工具与命令仍可用）'),

  expertCatalogEnabled: z.boolean().default(true)
    .description('是否注入「专家库目录段」（走 systemPrompt.section，order 10150）：列出六个域的成员与「可用能力」，让模型判断问题归属时知道库里有什么。它是**稳定段**（只在专家库增删专家/技能时变，不随任务变），也不占每轮专家注入预算；追求极简上下文时可关闭'),

  disciplineEnabled: z.boolean().default(true)
    .description('是否注入「交付层·纪律块」（走 systemPrompt.context，order 481）：从项目记忆里读【纪律块 v1】条目，每轮注入、不随专家裁剪丢弃。自检红线的新家 —— 红线写在记忆里（真相源），插件只读不改'),

  disciplineMemoryDir: z.string().default('')
    .description('纪律块的记忆库根目录；留空 = 自动取 work-memory 设置里的 memoryDir（本机为 ~/.dsh/memories/lina），再退到 $DSH_HOME/memories/work-memory。读取的是 <根>/PROJECTS/dsh-experts.md 里的【纪律块 v1】条目（只读，绝不写）'),

  defaultDomain: z.string().default('infosec')
    .description('本人岗位默认域 —— 安装引导会问一次。取值：infosec 信息安全 / accounting 财务 / hr 人力资源 / coding 代码编程 / finance 金融 / general 通用职能。它决定任务优先从哪个专业角度被拆解（给会计岗同事用时改成 accounting 即可，无需改代码）'),

  identityExpert: z.string().default('')
    .description('**常驻注入的唯一身份专家**（专家 id，如 infosec-ics-security）；留空 = 自动取「本人岗位」域的第一位。它每轮都在场，代表使用者的默认身份视角；其余专家由「问题归属判断」决定是否临时补充或派子代理激活'),

  enabledDomains: z.string().default('')
    .description('把匹配范围**收窄**到这些域（逗号分隔，如 infosec,accounting）；留空 = 全部专家都参与匹配。「本人岗位」只作打分先验，不当白名单（否则跨域任务会命中不了本域之外的专家）'),

  enabledExperts: z.string().default('')
    .description('把匹配范围**收窄**到这些专家（id 逗号分隔，如 infosec-bid-proposal,accounting-tax）；留空 = 不收窄。范围外的专家不参与自动匹配，仍可用 /expert use <id> 临时注入'),

  expertInjectMax: z.natural().default(4)
    .description('**persona 注入软上限**：**默认 4，且 2026-09-15 起不在设置页提供**（主人定：直接写死，避免误调）。0 = 不限（交由字符预算与分数阈值守门）；如需收紧，手改 settings.yaml 为 1–3 仍生效。实测 20 条真实任务**无一命中 4 位**（70% 只命中 1 位），故 4 是「留余量」而非「常态化占满」'),

  skillInjectEnabled: z.boolean().default(true)
    .description('是否注入**能力层指针**（工具 / 技能专家）：从本轮任务识别要用的技能，只注入一行「去哪拿」的指针（约 100 字符/条），做法原文由 skill 工具按需加载。它独立于 persona 命中，**不占** expertInjectMax 配额，也不受 enabledDomains 收窄'),

  skillBudgetChars: z.natural().default(SKILL_BUDGET_DEFAULT)
    .description('能力层指针的字符预算（默认 300，约 3 条）：只放指针不放做法原文；0 = 不注入指针（等同只关能力层注入，persona 不受影响）'),

  expertInjectDetail: z.string().default('auto')
    .description('每轮注入形态：auto（默认，按预算自动降级）/ card（全部精简卡）/ full（全文，保持旧行为）。⚠️ full 会把每位 persona 正文全文注入（1.8–2.6 千字符/位），单轮约 4.5–5.2KB；auto / card 只注入精简卡（角色首句 + 方法前 3 条 + 交付前 2 条 + 适用），单轮约 1.3–1.8 千字符，省约 2/3 TOKEN；取值非法时回落 auto'),

  expertInjectBudgetChars: z.natural().default(INJECT_BUDGET_DEFAULT)
    .description('每轮专家注入的**字符预算**（默认 2000，约 1.3–1.7k TOKEN）：超预算按序降级 —— 命中专家全文 → 命中专家精简卡 → 只留身份专家精简卡；连最低形态都放不下则截断并标注（绝不静默超限）。调大＝视角更完整但更占 TOKEN；调小＝更省但卡片更薄（下限 200，上限 20000）'),

  expertSecondThreshold: z.number().default(0.3)
    .description('**域专家**的第 2/3 位门槛：其关键词证据 ≥ 本轮最强证据 × 该值时才注入（默认 0.3；仅 expertInjectMax ≥ 2 时生效）。注意这是**相对门槛** —— 第一名证据越强、后面越难进；实测 0.8 时 70% 的任务只能命中 1 位，故 2026-09-15 调为 0.3'),

  expertGeneralMax: z.natural().default(1)
    .description('**通用型专家**（核查 / 排版 / 文档 / 演示 / 设计）的独立配额，默认 1。2026-09-15 起通用专家与行业域专家**分开评分、分开门槛**（域专家走上面的相对门槛，通用专家走下面的绝对门槛）—— 否则通用专家在本机 defaultDomain=infosec 下拿不到岗位先验，会被结构性挤掉。设 0 = 不保底'),

  expertGeneralMinEvidence: z.number().default(0.2)
    .description('**通用型专家**的绝对门槛：关键词证据 ≥ 该值即可入选（默认 0.2 = 命中 1 个关键词）。通用专家的触发词更泛、证据天然更低，用域专家的相对门槛会让它们永远补不进来'),


  expertShowBanner: z.boolean().default(true)
    .description('注入时显示「当前专家视角」标识，便于你知道本轮用的是哪位专家'),

  expertSetupDone: z.boolean().default(false)
    .description('安装引导是否已完成（问过「你的工作方向是？」并写入 defaultDomain）；重置为关可让引导下次再问一次'),
}) : null

/** 把组合配置里的 null/undefined/未知键规整成 schema 能接受的值 */
function normalizeBase(base) {
  const out = {}
  for (const [key, value] of Object.entries(base ?? {})) {
    if (!(key in DEFAULTS)) continue
    if (value === null || value === undefined) continue
    out[key] = value
  }
  return out
}

/** 解析值 → 插件内部配置 */
function toConfig(resolved) {
  const cfg = { ...DEFAULTS, ...(resolved ?? {}) }
  cfg.expertInjectMax = clampInjectMax(cfg.expertInjectMax)
  cfg.expertInjectDetail = normalizeDetail(cfg.expertInjectDetail, DEFAULTS.expertInjectDetail)
  cfg.expertInjectBudgetChars = clampBudget(cfg.expertInjectBudgetChars, DEFAULTS.expertInjectBudgetChars)
  cfg.skillBudgetChars = clampSkillBudget(cfg.skillBudgetChars, DEFAULTS.skillBudgetChars)
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
 * 注册设置命名空间并把解析值接到插件运行时。
 *
 * @param {object} ctx - cordis context（需 settings 服务）
 * @param {object} baseConfig - 组合配置（bundle entry config），作为 base 层
 * @returns {{ read: () => object, watch: (cb: Function) => void, scope: object|null, available: boolean }}
 */
export function installSettings(ctx, baseConfig = {}) {
  const base = normalizeBase(baseConfig)
  let scope = null
  let current = toConfig(base)

  try {
    if (!z || !EXPERTS_SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    scope = ctx.settings.register(SETTINGS_NS, EXPERTS_SETTINGS_SCHEMA, { base })
    current = toConfig(scope.get())
    scope.watch(() => {
      current = toConfig(scope.get())
    })
    ctx.logger?.debug?.('dsh-experts: 设置命名空间已注册（设置→插件 可配置）')
  } catch (err) {
    ctx.logger?.warn?.('dsh-experts: 设置服务不可用，退回组合配置：' + (err?.message || err))
    scope = null
  }

  return {
    read: () => current,
    watch: (cb) => {
      if (scope) scope.watch(() => cb(current))
    },
    get scope() {
      return scope
    },
    available: scope !== null,
  }
}
