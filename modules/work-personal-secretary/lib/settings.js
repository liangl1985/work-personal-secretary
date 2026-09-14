/**
 * work-personal-secretary —— 设置命名空间（本体自己的可配置项）
 *
 * 与子插件（dsh-experts / dsh-work-memory）同构：组合配置作为 `base` 层，
 * 用户在设置页写入的覆盖层**免重启热生效**；本文件只读解析后的快照。
 *
 * 为什么需要它（2026-09-14 增补）：安装器要靠 repoRoot 找到集成体仓库（<repoRoot>/modules/<id>），
 * 而此前本体**没有注册任何设置命名空间** —— 面板提示「请在设置里指定」时使用者无处可指，
 * 只能由 profile 的 cordis.patch.yml 写死兜底。现在把 repoRoot 收进设置：
 *   ① 设置值（用户层，最高优先级）→ ② cordis.patch.yml（既有兜底）→ ③ 祖先探测。
 *
 * 降级纪律：schemastery 是宿主运行时依赖（peerDependencies）。这里用**动态导入降级**：
 * 真实宿主一定有它；纯 node 单测 / 冒烟环境里模块仍能加载，只是命名空间注册被跳过，
 * 插件退回组合配置的默认值（repoRoot 走自动探测），功能不受影响。
 *
 * @module work-personal-secretary/settings
 */

/**
 * schemastery 动态导入（降级：没有宿主依赖时为 null）。
 * 注意本模块是 ESM，允许 top-level await；导入失败只记 null，不影响模块加载。
 */
let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

/** 设置命名空间名（= 本体包名；与 install.js 的 MODULE_ID 保持一致） */
export const SETTINGS_NS = 'work-personal-secretary'

/** 兜底默认值（与 schema 默认值一致；设置服务缺失或 schema 不可用时使用） */
export const DEFAULTS = {
  repoRoot: '',
}

/** 设置页渲染的 schema（description 即卡片上的说明文字；repoRoot 留空 = 走自动探测） */
export const WPS_SETTINGS_SCHEMA = z ? z.object({
  repoRoot: z.string().default('')
    .description('集成体仓库目录（集成体源码仓根，应包含 modules/<id>/package.json）。**留空 = 自动探测**：'
      + '先读本机 profile 的 cordis.patch.yml，再从本体模块目录逐级向上找含 modules/ 的目录。'
      + '本机若为 file:/link: 链接安装，安装器会尝试从本体位置自动推导并写回，通常无需手填；'
      + '手填时必须是绝对路径，填错会在安装页与接口里显式报错（不静默降级）。'),
}) : null

/** 把组合配置里的 null/undefined/未知键规整成 schema 能接受的值 */
function normalizeBase(base) {
  const out = {}
  for (const [key, value] of Object.entries(base || {})) {
    if (!(key in DEFAULTS)) continue
    if (value === null || value === undefined) continue
    out[key] = value
  }
  return out
}

/** 解析值 → 插件内部配置（只收顶层标量；非法值回落默认） */
function toConfig(resolved) {
  const cfg = { ...DEFAULTS, ...(resolved || {}) }
  cfg.repoRoot = String(cfg.repoRoot == null ? '' : cfg.repoRoot).trim()
  return cfg
}

/**
 * 注册设置命名空间并把解析值接到插件运行时。
 *
 * @param {object} ctx - cordis context（需 settings 服务）
 * @param {object} [baseConfig] 组合配置（bundle entry config），作为 base 层
 * @returns {{ read: () => {repoRoot:string}, watch: (cb:Function) => void, scope: object|null, available: boolean }}
 */
export function installSettings(ctx, baseConfig = {}) {
  const base = normalizeBase(baseConfig)
  let scope = null
  let current = toConfig(base)

  try {
    if (!z || !WPS_SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    if (!ctx || !ctx.settings || typeof ctx.settings.register !== 'function') {
      throw new Error('ctx.settings.register 不可用（宿主未提供设置服务）')
    }
    scope = ctx.settings.register(SETTINGS_NS, WPS_SETTINGS_SCHEMA, { base })
    current = toConfig(scope.get())
    scope.watch(() => {
      current = toConfig(scope.get())
    })
    ctx.logger?.debug?.('work-personal-secretary: 设置命名空间已注册（repoRoot 可在设置页配置）')
  } catch (err) {
    ctx.logger?.warn?.('work-personal-secretary: 设置服务不可用，repoRoot 退回自动探测（组合配置）：'
      + (err && err.message ? err.message : err))
    scope = null
  }

  return {
    read: () => current,
    watch: (cb) => {
      if (scope && typeof cb === 'function') scope.watch(() => cb(current))
    },
    get scope() {
      return scope
    },
    available: scope !== null,
  }
}
