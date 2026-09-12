/**
 * dsh-experts — 共享常量与归一化（**无外部依赖**，便于回归脚本直接引用）
 *
 * 单独成文件的原因：`settings.js` 依赖 `@deepseek-ai/schemastery`（宿主运行时提供，
 * 仓库内不一定安装），而回归脚本需要在没有宿主依赖的情况下也能跑，
 * 所以把纯函数与常量放在这里。
 *
 * @module dsh-experts/limits
 */

/** 每轮注入上限的硬边界：设置页填超范围时按此 clamp（主人 2026-09-12 定的上限 3） */
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
