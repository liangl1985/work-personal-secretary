/**
 * dsh-experts — 设置命名空间（DSH 0.1.5-rc.1 原生设置服务）
 *
 * 与 dsh-work-memory 同构：组合配置（bundle entry config）作为 `base` 层，
 * 用户覆盖层由设置页「插件」分区写入（免重启，带 revision 栅栏），
 * 插件侧只读解析后的深冻结快照，并可 watch 已提交变更。
 *
 * 四项口径（主人 2026-09-12 定）：
 *   ① 默认注入 1 位，可调 2/3，>1 时设置页明确提示「占用较多 TOKEN」；
 *   ② 岗位关联（defaultDomain）安装引导问一次 —— 决定任务从哪个专业角度拆解；
 *   ③ 全局激活集合（enabledDomains / enabledExperts）决定谁参与自动匹配；
 *   ④ 未激活/未注入的专家走临时注入（/expert use、expert_recall），不常驻上下文。
 *
 * @module dsh-experts/settings
 */

import { INJECT_MAX_HARD, clampInjectMax, clampUnit } from './limits.js'

export { INJECT_MAX_HARD, clampInjectMax }

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
  defaultDomain: 'presales',
  identityExpert: '',
  enabledDomains: '',
  enabledExperts: '',
  expertInjectMax: 1,
  expertSecondThreshold: 0.8,
  expertMinScore: 0.35,
  expertShowBanner: true,
  expertSetupDone: false,
}

/** 设置页渲染的 schema（description 即卡片上的说明文字） */
export const EXPERTS_SETTINGS_SCHEMA = z ? z.object({
  expertsEnabled: z.boolean().default(true)
    .description('专家库总开关（关闭后不注入任何 persona，专家工具与命令仍可用）'),

  defaultDomain: z.string().default('presales')
    .description('本人岗位默认域 —— 安装引导会问一次。取值：presales 售前 / aftersales 售后·技术支持 / finance 会计财务 / legal 法务 / doc 文档 / general 核查·通用。它决定任务优先从哪个专业角度被拆解（给会计岗同事用时改成 finance 即可，无需改代码）'),

  identityExpert: z.string().default('')
    .description('**常驻注入的唯一身份专家**（专家 id，如 presales-ics-security）；留空 = 自动取「本人岗位」域的第一位。它每轮都在场，代表使用者的默认身份视角；其余专家由「问题归属判断」决定是否临时补充或派子代理激活'),

  enabledDomains: z.string().default('')
    .description('把匹配范围**收窄**到这些域（逗号分隔，如 presales,legal）；留空 = 全部专家都参与匹配。「本人岗位」只作打分先验，不当白名单（否则跨域任务会命中不了本域之外的专家）'),

  enabledExperts: z.string().default('')
    .description('把匹配范围**收窄**到这些专家（id 逗号分隔，如 presales-bid-proposal,finance-accountant）；留空 = 不收窄。范围外的专家不参与自动匹配，仍可用 /expert use <id> 临时注入'),

  expertInjectMax: z.natural().default(1)
    .description('每轮最多注入几位专家：1（默认）/ 2 / 3。⚠️ 调成 2 或 3 会占用较多 TOKEN（每位 persona 约 1.3–1.8 千字，UTF-8 约 3.3–4.9KB），且只在分数接近且跨域时才补第 2/3 位'),

  expertSecondThreshold: z.number().default(0.8)
    .description('第 2/3 位专家的门槛：其分数 ≥ 第 1 位 × 该值时才注入（默认 0.8；仅 expertInjectMax ≥ 2 时生效）'),

  expertMinScore: z.number().default(0.35)
    .description('低于此分数不注入 —— 宁缺勿滥，短任务/无专业信号时保持通用助手行为'),

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
  const th = clampUnit(cfg.expertSecondThreshold, DEFAULTS.expertSecondThreshold)
  cfg.expertSecondThreshold = th > 0 ? th : DEFAULTS.expertSecondThreshold
  cfg.expertMinScore = clampUnit(cfg.expertMinScore, DEFAULTS.expertMinScore)
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
