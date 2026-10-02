/**
 * work-personal-secretary —— 设置命名空间（本体自己的可配置项）
 *
 * 两种宿主口径并存（0.2.0-rc.2 迁移，2026-09-30）：
 *   ① 0.1.x：`ctx.settings.register(ns, schema, { base })` 显式注册命名空间，scope.get() / scope.watch 免重启热更；
 *   ② 0.2.0-rc.2：settings 服务不再提供 register —— cordis 在注册插件时捕获**具名导出的 Config**
 *      （`vendor/cordis/src/registry.ts:326` → `packages/settings/settings/src/index.ts:425-428`），
 *      命名空间即 profile entry id（本体的是 `work-personal-secretary`，与 SETTINGS_NS 同值），
 *      取值来自 `apply(ctx, config)`；volatile 字段是**就地更新的引用**（`vendor/loader/src/config/entry.ts:162-195`
 *      的 `_commitVolatile()` → `updateVolatile(ref, source)`），不重跑 apply，所以每次读取都要实时解包。
 *
 * 两条硬性口径（rc.2 源码依据）：
 *   - `Config` **绝不能是 `null`**：`index.ts:427` 的判据是 `'toJSON' in schema`，`in null` 会抛 TypeError；
 *     schemastery 不可用时必须导 `undefined`（那时 `runtime.Config` 为 undefined，cordis 原样透传 config）。
 *   - 只有带 `.volatile()` 的字段才进设置页：`schema.ts:37-47` 的 `volatileForm()` 只挑 volatile 子树，
 *     `index.ts:308-309` 对整棵无 volatile 的 schema 直接返回 []（该 entry 在设置页不出现）。
 *
 * 为什么需要它（2026-09-14 增补）：安装器要靠 repoRoot 找到集成体仓库（<repoRoot>/modules/<id>），
 * 而此前本体**没有注册任何设置命名空间** —— 面板提示「请在设置里指定」时使用者无处可指，
 * 只能由 profile 的 cordis.patch.yml 写死兜底。现在把 repoRoot 收进设置：
 *   ① 设置值（用户层，最高优先级）→ ② cordis.patch.yml（既有兜底）→ ③ 祖先探测。
 *
 * 降级纪律：schemastery 是宿主运行时依赖（peerDependencies）。这里用**动态导入降级**：
 * 真实宿主一定有它；纯 node 单测 / 冒烟环境里模块仍能加载，只是设置不可用（`available: false`），
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

/** 设置命名空间名（= 本体包名 = rc.2 的 profile entry id；与 install.js 的 MODULE_ID 保持一致） */
export const SETTINGS_NS = 'work-personal-secretary'

/** 兜底默认值（与 schema 默认值一致；设置服务缺失或 schema 不可用时使用） */
export const DEFAULTS = {
  repoRoot: '',
  // 知识库根目录（vault 根）：知识库结构生成器与「记忆镜像建议值」的依据。
  // 留空 = knowledgeDeck 显式返回 none（不猜路径）；个性化在该 profile 的 cordis.patch.yml 覆盖。
  obsidianDir: '',
  // 自定义岗位列表：JSON 字符串（形如 [{"id","label","content"}]）。数组语义用字符串是本库既有约定
  // （见 dsh-experts 的 enabledDomains）。**必须标 volatile**：宿主设置服务拒绝写非 volatile 字段
  // （真机 2026-10-02 实测 'Config field "customJobs" is not volatile'），写不进去则岗位无法持久化。
  // 代价是它会出现在设置表单里——由 description 说明"通常无需手工编辑"。读写走 GET/POST /jobs（见 lib/api.js）。
  customJobs: '',
}

/**
 * 特性探测包一层 `.volatile()`：volatile 是 schemastery **3.18.3** 才引入的方法
 * （3.18.1 / 3.18.2 的 lib 里没有），而本包 peer 是 `^3.18.1`；本表达式又在**模块顶层求值**，
 * 直接调 `.volatile()` 会抛 TypeError，且下面的 try/catch 只包着 `await import()`，接不住
 * → 整个插件加载失败。这里探测后按需调用，链式与说明文案都不变。
 *
 * @param {object} field schemastery 字段 schema
 * @returns {object} 调用过 `.volatile()` 的字段；宿主版本不支持时原样返回（该字段不进设置页，但不崩）
 */
function withVolatile(field) {
  return field && typeof field.volatile === 'function' ? field.volatile() : field
}

/**
 * 设置页渲染的 schema（description 即卡片上的说明文字；repoRoot 留空 = 走自动探测）。
 * `repoRoot` 需要 `.volatile()`：rc.2 只把 volatile 字段派生成可编辑表单项。
 * 不可用时导出 `undefined`（**不是 null**，见文件头口径）。
 */
export const WPS_SETTINGS_SCHEMA = z ? z.object({
  repoRoot: withVolatile(z.string().default(''))
    .description('集成体仓库目录（集成体源码仓根，应包含 modules/<id>/package.json）。**留空 = 自动探测**：'
      + '先读本机 profile 的 cordis.patch.yml，再从本体模块目录逐级向上找含 modules/ 的目录。'
      + '本机若为 file:/link: 链接安装，安装器会尝试从本体位置自动推导并写回，通常无需手填；'
      + '手填时必须是绝对路径，填错会在安装页与接口里显式报错（不静默降级）。'),
  obsidianDir: withVolatile(z.string().default(''))
    .description('知识库根目录（Obsidian vault 根，应包含 .obsidian/ 与各模块知识库）。**留空 = 未指定**：'
      + '知识库结构生成器（knowledgeDeck）显式返回 none，不猜路径。填了之后：镜像建议值改为 <知识库根>/00_全局记忆，'
      + '并据此生成/校验知识库骨架。个性化可在该 profile 的 cordis.patch.yml 覆盖本键。'),
  customJobs: withVolatile(z.string().default(''))
    .description('自定义岗位列表（JSON）。**由「核心配置 → 目录与岗位」页维护，通常无需手工编辑**；'
      + '新增/删除岗位时这里会同步。该字段必须是 volatile —— 宿主设置服务只允许写 volatile 字段（实测报错：'
      + 'Config field "customJobs" is not volatile），因此它会出现在本表单里，属预期。'),
}) : undefined

/**
 * rc.2 的具名导出：cordis 注册插件时把它捕获为 `plugin.Config`（vendor/cordis/src/registry.ts:326），
 * settings 服务再由它派生设置表单。0.1.x 下这个导出没有副作用（那里走 installSettings 的 register 分支）。
 */
export const Config = WPS_SETTINGS_SCHEMA

/** volatile 引用的跨副本协议符号（与 vendor/cosmokit/src/volatile.ts:3 同源，走 Symbol.for 全局注册表） */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 解包 rc.2 的 volatile 引用（取当前值）。
 *
 * 官方判定见 `vendor/cosmokit/src/volatile.ts:52-54` 的 `isVolatile()`：
 * `typeof value === 'object' && value !== null && write in value`（write = Symbol.for('cosmokit.volatile.write')）。
 * 这里用同一协议，不引 cosmokit（不在 peerDependencies 里）。
 * **不能用 `typeof v.get === 'function'`**：那会误伤 `new Map()`（get 是方法，解包后变 undefined、
 * 数据丢失）以及任何带 get 的普通对象。普通值（含函数、数组、Map）一律原样返回。
 *
 * @param {unknown} v 解析后的配置值（可能是 volatile 引用，也可能是普通值）
 * @returns {unknown} 解包后的普通值
 */
export function unwrapValue(v) {
  return v && typeof v === 'object' && VOLATILE_WRITE in v ? v.get() : v
}

/** 解析值 → 插件内部配置（先解包 volatile，只收已知键；缺失值回落默认） */
function toConfig(resolved) {
  const src = resolved || {}
  const cfg = {}
  for (const key of Object.keys(DEFAULTS)) {
    const value = unwrapValue(src[key])
    cfg[key] = value === null || value === undefined ? DEFAULTS[key] : value
  }
  cfg.repoRoot = String(cfg.repoRoot == null ? '' : cfg.repoRoot).trim()
  cfg.obsidianDir = String(cfg.obsidianDir == null ? '' : cfg.obsidianDir).trim()
  cfg.customJobs = String(cfg.customJobs == null ? '' : cfg.customJobs)
  return cfg
}

/**
 * 把设置接进插件运行时（双分支）。
 *
 * - 分支 A（0.1.x，`ctx.settings.register` 存在）：显式注册命名空间，scope.get() 取值、scope.watch 热更；
 *   base 层仍留空 —— 组合配置里的 repoRoot（cordis.patch.yml / bundle 配置）由 installApi 的 configRoot
 *   单独承载，不在这里伪装成「设置值」（与迁移前行为一致）。
 * - 分支 B（rc.2，无 register）：取值直接来自 apply(ctx, config)，表单由具名导出 Config 派生；
 *   配置变更**不重跑 apply**（volatile 引用就地更新），故 read 每次实时解包 baseConfig，watch 退化为 no-op。
 *   这是**正常路径**，不告警。
 * - 降级（schemastery 不可用）：`available: false`，read 仍可用（返回组合配置里能取到的值）。
 *
 * @param {object} ctx - cordis context（需 settings 服务）
 * @param {object} [baseConfig] 插件配置（组合配置 entry config；rc.2 下含 volatile 包装的字段）
 * @returns {{ read: () => {repoRoot:string}, watch: (cb:Function) => void, scope: object|null, available: boolean, mode: 'register'|'config'|'none' }}
 */
export function installSettings(ctx, baseConfig = {}) {
  // rc.2 下 config 里的 volatile 字段是包装对象，toConfig 先解包再归一化；
  // 0.1.x / 降级环境下是普通值，解包函数原样返回。
  let current = toConfig(baseConfig)
  let scope = null
  let mode = 'none'

  try {
    if (!z || !WPS_SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    if (ctx && ctx.settings && typeof ctx.settings.register === 'function') {
      // ---- 分支 A：0.1.x 显式注册（行为与迁移前一致） ----
      scope = ctx.settings.register(SETTINGS_NS, WPS_SETTINGS_SCHEMA, { base: {} })
      current = toConfig(scope.get())
      scope.watch(() => {
        current = toConfig(scope.get())
      })
      mode = 'register'
      ctx.logger?.debug?.('work-personal-secretary: 设置命名空间已注册（repoRoot 可在设置页配置）')
    } else {
      // ---- 分支 B：rc.2 具名导出 Config 派生（无 register 是正常口径，不降级、不告警） ----
      mode = 'config'
      ctx?.logger?.debug?.('work-personal-secretary: 设置由具名导出 Config 派生（rc.2 口径）；'
        + 'repoRoot 取插件配置里的 volatile 引用，读取时实时解包')
    }
  } catch (err) {
    ctx?.logger?.warn?.('work-personal-secretary: 设置服务不可用，repoRoot 退回自动探测（组合配置）：'
      + (err && err.message ? err.message : err))
    scope = null
    mode = 'none'
  }

  return {
    // 分支 A 用 scope 维护的 current；分支 B（rc.2）与降级路径**每次实时解包** baseConfig ——
    // rc.2 的 volatile 是就地更新（loader 的 _commitVolatile → updateVolatile 改已有引用），
    // 既不重跑 apply 也不重启 fiber，快照会立刻过期（设置页写入后 api.js 的 settingsRepoRoot() 会读到旧值）。
    read: () => (scope ? current : toConfig(baseConfig)),
    watch: (cb) => {
      // 分支 A：转发 scope.watch；分支 B：no-op（read 已实时取 volatile 引用，无需 watch）
      if (scope && typeof cb === 'function') scope.watch(() => cb(current))
    },
    get scope() {
      return scope
    },
    available: mode !== 'none',
    mode,
  }
}
