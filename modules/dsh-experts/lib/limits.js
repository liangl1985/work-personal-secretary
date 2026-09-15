/**
 * dsh-experts — 共享常量与归一化（**无外部依赖**，便于回归脚本直接引用）
 *
 * 单独成文件的原因：`settings.js` 依赖 `@deepseek-ai/schemastery`（宿主运行时提供，
 * 仓库内不一定安装），而回归脚本需要在没有宿主依赖的情况下也能跑，
 * 所以把纯函数与常量放在这里。
 *
 * @module dsh-experts/limits
 */

/** 每轮注入上限的硬边界（2026-09-15 起为 **4**，0.4.0 起为正式口径）：`expertInjectMax` 已写死 4、设置页不提供该项，本常量仍是任何越界值的最终 clamp（绝不静默超限） */
export const INJECT_MAX_HARD = 4

/** persona 注入上限的默认值（0 = 不限，由预算与阈值守门）—— 与 settings.js 的 DEFAULTS 保持一致（0.4.0 起为 4） */
export const INJECT_MAX_DEFAULT = 4

/**
 * 注入上限归一化（2026-09-14 批二：expertInjectMax 降级为 **persona 软上限**）：
 *   - 0 → 0（不限：交由字符预算与分数阈值守门；技能指针不占该配额）；
 *   - 非法 / 负数 → 默认 4；
 *   - 1..4 → 原值；超过硬边界 → clamp 到 4（绝不静默超限）。
 */
export function clampInjectMax(value, fallback = INJECT_MAX_DEFAULT) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  if (n === 0) return 0
  return Math.min(INJECT_MAX_HARD, Math.floor(n))
}

/**
 * 装填成本常量（字符，2026-09-14 批二口径）：把「按个数配额」换成「按成本装填」。
 *   - persona 精简卡：实测 500–609 字符，取 500 作估算常量；
 *   - skill 指针行：「【工具·office-ppt】演示文稿读写 / 导出 / 逐页出图 · skill 加载」约 100 字符。
 * 仅用于**预算规划**，不改变实际渲染文本（绝不按常量裁剪正文）。
 */
export const COST_PERSONA_CARD = 500
export const COST_SKILL_LINE = 100

/** 能力层（技能指针）预算默认值：约 3 行指针（每行 ≈100 字符，只放「去哪拿」不放做法原文） */
export const SKILL_BUDGET_DEFAULT = 300
export const SKILL_BUDGET_MIN = 0
export const SKILL_BUDGET_MAX = 2000

/**
 * 能力层预算归一化：非法 / 负数回落默认；0 = 不注入指针（等同关掉能力层注入）；
 * 超上限按硬边界 clamp（绝不静默超限）。
 */
export function clampSkillBudget(value, fallback = SKILL_BUDGET_DEFAULT) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(SKILL_BUDGET_MAX, Math.floor(n))
}

/** 分数阈值归一化：非法值回落到默认值 */
export function clampUnit(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

/**
 * 每轮专家注入的**字符上限**（2026-09-16 随注入机制重构：2800 → **15000**，按**最大可能消费**定档）。
 *
 * 新机制**不再按预算降级**，而是按**会话阶段**分两态（见 inject.js 的 PHASE_*）：
 *   - **首轮全景**：命中专家**全部**给精简卡 —— 4 位最坏实测 2431 + 处理路径 104 ≈ **2535**；
 *   - **干活轮**：按证据取**最大 + 次大**共 `expertFullHitMax` 位（默认 2、硬边界 4）给**全文**。
 *
 * 定档按**配置允许的最大组合**（使用者 2026-09-16 定：「需要按最大预算去设定」）：
 *   单篇全文上限 `PERSONA_MAX_CHARS = 3600` × 位数硬边界 `FULL_HIT_MAX_HARD = 4` = **14400**，
 *   加每篇块头/尾注（约 60–80）× 4 ≈ 300，再加处理路径 104 与块间分隔 ≈ 150 → **≈ 14850**。
 * 取 **15000** —— 任何允许的配置组合都落在上限内，不会误触发截断。
 *
 * 本值只是**期望上限**；超出不再降级、只截断并标注。真正的**安全红线**是
 * INJECT_BUDGET_MAX = 20000（2026-09-15 使用者定：「20000 是一个保护值」）——
 * 任何形态（含 full）都不得突破。
 */
export const INJECT_BUDGET_DEFAULT = 15000

/** 预算硬边界：过小会把专家卡压到不可读，过大等于放弃兜底（设置在界外时 clamp） */
export const INJECT_BUDGET_MIN = 200
export const INJECT_BUDGET_MAX = 20000

/** 预算归一化：非法/非正数回落默认值；界外按硬边界 clamp（绝不静默超限，由注入层标注） */
export function clampBudget(value, fallback = INJECT_BUDGET_DEFAULT) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(INJECT_BUDGET_MAX, Math.max(INJECT_BUDGET_MIN, Math.floor(n)))
}

/**
 * 注入形态（`expertInjectDetail`，2026-09-16 重构后口径）：
 *   - **auto（默认）** —— 按**会话阶段**分两态：
 *     ① 首轮全景：命中专家**全部**给精简卡（不裁人）；
 *     ② 干活轮：**按证据排序取「最大 + 次大」共 expertFullHitMax 位（默认 2）给全文**，
 *        其余本轮不注入（目录段仍每轮可见，需要时 expert_recall 现取）；
 *   - card —— 全部精简卡（全局形态开关）；
 *   - full —— 全文注入（旧行为逃生舱；同样受 INJECT_BUDGET_MAX 红线兜底）。
 */
export const DETAIL_MODES = ['auto', 'card', 'full']

/** 形态归一化：非法值回落默认（auto） */
export function normalizeDetail(value, fallback = 'auto') {
  const v = String(value ?? '').trim().toLowerCase()
  return DETAIL_MODES.includes(v) ? v : fallback
}

/**
 * 干活轮给**全文**的位数（2026-09-16 使用者定：「最相关的两人全文」——
 * 即按本轮任务证据取**最大值与次大值**，并列时取任意两位；**不设固定证据门槛**）。
 */
export const FULL_HIT_MAX_DEFAULT = 2

/** 全文位数的硬边界（再大就等于放弃「干活轮」的省 token 本意） */
export const FULL_HIT_MAX_HARD = 4

/** 全文位数归一化：非法/负数回落默认；超硬边界 clamp */
export function clampFullHitMax(value, fallback = FULL_HIT_MAX_DEFAULT) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(FULL_HIT_MAX_HARD, Math.floor(n))
}
