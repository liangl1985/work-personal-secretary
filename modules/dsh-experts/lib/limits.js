/**
 * dsh-experts — 共享常量与归一化（**无外部依赖**，便于回归脚本直接引用）
 *
 * 单独成文件的原因：`settings.js` 依赖 `@deepseek-ai/schemastery`（宿主运行时提供，
 * 仓库内不一定安装），而回归脚本需要在没有宿主依赖的情况下也能跑，
 * 所以把纯函数与常量放在这里。
 *
 * @module dsh-experts/limits
 */

/** 每轮注入上限的硬边界：设置页填超范围时按此 clamp（产品口径 2026-09-12 定的上限 3） */
export const INJECT_MAX_HARD = 3

/** 注入上限归一化：非法值回落到 1，超过硬边界则 clamp */
export function clampInjectMax(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(INJECT_MAX_HARD, Math.floor(n))
}

/** 分数阈值归一化：非法值回落到默认值 */
export function clampUnit(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
}

/**
 * 每轮专家注入的**字符预算**默认值（产品口径 2026-09-14 定）。
 *
 * 为什么是 1400：默认形态下 = 身份专家精简卡 + 命中专家精简卡（各约 400–700 字符），
 * 留出降级/截断注记余量；约合 0.9–1.2k token（中文 1 字符 ≈ 0.6–0.7 token）。
 * 旧口径（全文注入）单轮约 4.5–5.2KB，本项默认值把固定开销压到约 1/4。
 */
export const INJECT_BUDGET_DEFAULT = 1400

/** 预算硬边界：过小会把专家卡压到不可读，过大等于放弃降级（设置在界外时 clamp） */
export const INJECT_BUDGET_MIN = 200
export const INJECT_BUDGET_MAX = 20000

/** 预算归一化：非法/非正数回落默认值；界外按硬边界 clamp（绝不静默超限，由注入层标注） */
export function clampBudget(value, fallback = INJECT_BUDGET_DEFAULT) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(INJECT_BUDGET_MAX, Math.max(INJECT_BUDGET_MIN, Math.floor(n)))
}

/**
 * 注入形态（expertInjectDetail）：
 *   - auto（默认）—— 先试「身份精简卡 + 命中专家全文」，超预算按序降级：
 *     命中专家全文 → 命中专家精简卡 → 只留身份专家精简卡；
 *   - card —— 全部精简卡（起点即精简卡，仍受预算约束）；
 *   - full —— 全文注入，保持旧行为（不做预算降级，只受 PERSONA_MAX_CHARS 截断）。
 */
export const DETAIL_MODES = ['auto', 'card', 'full']

/** 形态归一化：非法值回落默认（auto） */
export function normalizeDetail(value, fallback = 'auto') {
  const v = String(value ?? '').trim().toLowerCase()
  return DETAIL_MODES.includes(v) ? v : fallback
}
