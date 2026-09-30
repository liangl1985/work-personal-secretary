/**
 * dsh-doc-suite — 设置命名空间（0.1.x 原生设置服务 / 0.2.0-rc.2 具名导出 Config 双口径）
 *
 * **键路径（扁平顶层键；2026-09-16 由嵌套 media* 改为扁平）**：
 *   pythonLauncher · docsRoot · wpsRequired · doctorOnStartup ·
 *   mediaProvider · mediaImageEnabled · mediaImageModel · mediaImageSize ·
 *   mediaImageTimeoutMs · mediaImageRetries · mediaImageFallbackToVector ·
 *   mediaVideoEnabled · mediaVideoModel · mediaArkApiKey · mediaArkEndpoint
 *
 * **为什么扁平**（口径变更依据，2026-09-16 使用者选定方案 A）：集成体的「能力配置页」把五个
 * 子插件的设置集中到一处渲染 —— 它的宿主侧写入校验**只接受顶层键**
 * （modules/work-personal-secretary/lib/settings-api.js 的 path 白名单原文："不接受嵌套路径"），
 * 客户端分组定义也是扁平 keys 列表。嵌套键在那一页读不到、也写不进；扁平化后
 * **无需放宽集成体的安全边界**即可直接可用。
 *
 * 其余约定不变：**密钥默认空**、不打印不落日志不入 git；环境变量 ARK_API_KEY 优先于设置项。
 *
 * 两种宿主口径并存（2026-09-30 迁移）：
 *   ① 0.1.x：`ctx.settings.register(ns, schema, { base, applies: 'live' })` 显式注册命名空间，
 *      组合配置作 base 层、设置页写用户覆盖层、`scope.get()` 取值并 `watch` 变更；
 *   ② 0.2.0-rc.2：settings 服务不再提供 register —— cordis 注册插件时捕获**具名导出的 Config**
 *      （`vendor/cordis/src/registry.ts:326` → `packages/settings/settings/src/index.ts:425-428`），
 *      命名空间即 profile entry id（本模块 entry id 是 `doc-suite`，而 SETTINGS_NS 常量沿用包名
 *      `dsh-doc-suite` 供 0.1.x 注册分支与自检文案使用），取值来自 `apply(ctx, config)`。
 *
 * rc.2 的两条硬性口径（源码依据）：
 *   - **只有带 `.volatile()` 的字段进设置表单**：`packages/settings/settings/src/schema.ts:37-47` 的
 *     `volatileForm()` 只挑 volatile 子树，整棵无 volatile 时 `index.ts:308-309` 直接返回空 ——
 *     条目在设置页 / 能力配置页不出现。故本文件把 15 个键**全部**标 volatile
 *     （迁移前整卡可配，不标即功能回退）。`.volatile()` 是 schemastery **3.18.3** 才有的方法
 *     （peer 下界 ^3.18.1），而 schema 在**模块顶层求值** —— 必须特性探测：裸调会抛 TypeError，
 *     而外层 try/catch 只包 `await import()`，接不住 → 整个插件加载失败。
 *   - **Config 绝不能是 `null`**：`index.ts:427` 判据 `'toJSON' in schema` 对 null 会抛 TypeError；
 *     schemastery 不可用时导出 `undefined`（那时 cordis 原样透传 config，插件退回 DEFAULTS）。
 *   - **Config 必须覆盖 cordis.patch.yml 里的全部键**：patch 的 `pythonLauncher` / `docsRoot` /
 *     `wpsRequired` / `doctorOnStartup` 与 11 个 media* 键都要在 schema 里，否则 rc.2 下这些键无法
 *     从设置页/能力配置页写入。
 *
 * 热更语义（rc.2）：volatile 是 loader **就地更新**的引用（`vendor/loader/src/config/entry.ts:162-195`
 * 的 `_commitVolatile()` → `updateVolatile(ref, source)`），**不重跑 apply 也不重启 fiber**，
 * 因此 read() 每次实时解包 baseConfig，watch 由 `loader/volatile-update` 事件驱动。
 *
 * @module dsh-doc-suite/settings
 */

/**
 * schemastery 动态导入（降级为 null：纯 node 单测 / 宿主缺依赖时模块仍能加载，
 * 只是设置命名空间注册被跳过、退回 DEFAULTS）。本模块是 ESM，允许 top-level await。
 */
let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

/** 设置命名空间名（0.1.x 设置页与集成体能力配置页按它派发；rc.2 下实际 ns = profile entry id `doc-suite`） */
export const SETTINGS_NS = 'dsh-doc-suite'

/** 兜底默认值：与 schema 默认值保持一致（设置服务缺失时退回这份值） */
export const DEFAULTS = {
  pythonLauncher: 'py -3',
  docsRoot: '',
  wpsRequired: true,
  doctorOnStartup: false,
  mediaProvider: 'volcengine-ark',
  mediaImageEnabled: true,
  mediaImageModel: 'doubao-seedream-5-0-pro-260628',
  mediaImageSize: '1K',
  mediaImageTimeoutMs: 60000,
  mediaImageRetries: 2,
  mediaImageFallbackToVector: true,
  mediaVideoEnabled: false,
  mediaVideoModel: '',
  mediaArkApiKey: '',
  mediaArkEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
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
 * 特性探测包一层 `.role('secret')`：与 withVolatile 同款纪律 —— schema 在**模块顶层求值**，
 * 宿主（或 CI / 单测里的精简 schemastery mock）没有 `role` 方法时裸调会抛 TypeError，
 * 整个插件加载失败。宿主支持时给字段打上 secret 元数据，设置接口与集成体能力配置页据此脱敏
 * （rc.2 `redact.ts` 依据 schema 的 `meta.role === 'secret'`）。
 *
 * @param {object} field schemastery 字段 schema
 * @returns {object} 打过 secret 角色的字段，或原样返回
 */
function withSecretRole(field) {
  return field && typeof field.role === 'function' ? field.role('secret') : field
}

/**
 * 设置页与集成体能力配置页渲染用的 schema（description 即说明文字）。
 * 15 个键**全部 volatile**：rc.2 只把 volatile 字段投影进表单，不标即读不到也写不进。
 * 不可用时导出 `undefined`（**不是 null**，见文件头口径）。
 */
export const SETTINGS_SCHEMA = z ? z.object({
  pythonLauncher: withVolatile(z.string().default('py -3'))
    .description('Python 启动器（Windows 建议 py -3；python 可能是 Microsoft Store 别名 stub）。仅 /doc-doctor 自检用'),
  docsRoot: withVolatile(z.string().default(''))
    .description('文档脚本根目录；留空 = 使用模块自带 scripts/ 目录'),
  wpsRequired: withVolatile(z.boolean().default(true))
    .description('声明 WPS Office（COM）为硬前置：环境自检会检查并在缺失时给出修复指引（本项只是声明，不会自动安装 WPS）'),
  doctorOnStartup: withVolatile(z.boolean().default(false))
    .description('是否每次启动做一次环境自检（默认关，避免拖慢启动）'),
  mediaProvider: withVolatile(z.string().default('volcengine-ark'))
    .description('生图服务商；默认火山引擎（ARK）'),
  mediaImageEnabled: withVolatile(z.boolean().default(true))
    .description('图形元素优先生图（图标/装饰/概念插图/背景图）；关闭或失败时自动回退代码矢量绘制'),
  mediaImageModel: withVolatile(z.string().default('doubao-seedream-5-0-pro-260628'))
    .description('方舟模型 ID（默认 Seedream 5.0 Pro）；以方舟控制台开通的 ID 为准'),
  mediaImageSize: withVolatile(z.string().default('1K'))
    .description('出图尺寸（方舟口径，如 1K / 2K）'),
  mediaImageTimeoutMs: withVolatile(z.natural().default(60000))
    .description('单次请求超时（毫秒）'),
  mediaImageRetries: withVolatile(z.natural().default(2))
    .description('失败重试次数（网络/5xx 重试；4xx 不重试）'),
  mediaImageFallbackToVector: withVolatile(z.boolean().default(true))
    .description('无密钥/未开通/限流/超时 → 自动回退代码矢量绘制（不需人工介入）'),
  mediaVideoEnabled: withVolatile(z.boolean().default(false))
    .description('生视频开关（默认关）'),
  mediaVideoModel: withVolatile(z.string().default(''))
    .description('生视频模型 ID（按方舟控制台填写；默认空 = 不用）'),
  mediaArkApiKey: withSecretRole(withVolatile(z.string().default('')))
    .description('ARK 密钥（敏感）：默认空；不会打印、不落日志、不进报错。schema 标 role=secret —— 设置接口与能力配置页按 secret 脱敏。留空则生图不可用并自动回退矢量'),
  mediaArkEndpoint: withVolatile(z.string().default('https://ark.cn-beijing.volces.com/api/v3'))
    .description('方舟端点（默认北京区）'),
}) : undefined

/**
 * rc.2 的具名导出：cordis 注册插件时把它捕获为 `plugin.Config`（vendor/cordis/src/registry.ts:326），
 * settings 服务再由它派生设置表单。0.1.x 下这个导出没有副作用（那里走 installSettings 的 register 分支）。
 */
export const Config = SETTINGS_SCHEMA

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

/** 组合配置层：只保留 schema 认识的键（未知键忽略；先解包 volatile） */
function normalizeBase(base) {
  const out = {}
  for (const [k, v] of Object.entries(base || {})) {
    if (!(k in DEFAULTS)) continue
    const value = unwrapValue(v)
    if (value === undefined || value === null) continue
    out[k] = value
  }
  return out
}

/** 解析值 → 插件内部配置（逐已知键解包 volatile；空字符串统一视为「未设置」） */
function toConfig(resolved) {
  const src = resolved ?? {}
  const cfg = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = unwrapValue(src[key])
    if (value === undefined || value === null) continue
    cfg[key] = value
  }
  if (!cfg.mediaArkApiKey) cfg.mediaArkApiKey = ''
  if (!cfg.mediaVideoModel) cfg.mediaVideoModel = ''
  return cfg
}

/**
 * 注册设置命名空间并把解析值接到插件运行时（双分支）。
 *
 * - 分支 A（0.1.x，`ctx.settings.register` 存在）：行为与迁移前一致 —— 组合配置作 base 层、
 *   `applies: 'live'`（设置改动免重启生效）、`scope.get()` 取值并 `watch` 变更。
 * - 分支 B（rc.2，无 register，**正常路径**）：取值来自 `apply(ctx, config)`，表单由具名导出
 *   `Config` 派生；volatile 由 loader 就地提交（不重跑 apply、不重启 fiber），故 read() 每次实时
 *   解包 baseConfig，并监听 `loader/volatile-update` 驱动 watch 订阅者。不抛不 warn。
 * - 降级（schemastery 不可用或注册抛错）：`available: false`，read 仍返回组合配置解析值。
 *
 * @param {object} ctx cordis context（需 settings 服务；拿不到时降级为默认值）
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
        ctx?.logger?.warn?.('dsh-doc-suite: 设置变更回调失败：' + (err?.message || err))
      }
    }
  }

  try {
    if (!z || !SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    if (ctx && ctx.settings && typeof ctx.settings.register === 'function') {
      // ---- 分支 A：0.1.x 显式注册（行为与迁移前一致） ----
      const base = normalizeBase(baseConfig)
      // applies: 'live' —— 设置改动**免重启生效**（与集成体「记忆库 / 专家库」的形态一致）。
      // 服务端若不认识该字段会抛错 → 由下面的 catch 降级，不影响插件启动。
      scope = ctx.settings.register(SETTINGS_NS, SETTINGS_SCHEMA, { base, applies: 'live' })
      current = toConfig(scope.get())
      scope.watch(() => {
        current = toConfig(scope.get())
        notify()
      })
      mode = 'register'
      ctx.logger?.debug?.('dsh-doc-suite: 设置命名空间已注册（设置 → 插件 → dsh-doc-suite）')
    } else {
      // ---- 分支 B：0.2.0-rc.2 具名导出 Config 派生（无 register 是正常口径，不降级、不告警） ----
      mode = 'config'
      if (ctx && typeof ctx.on === 'function') {
        ctx.on('loader/volatile-update', () => {
          current = toConfig(baseConfig)
          notify()
          ctx.logger?.debug?.('dsh-doc-suite: 设置已更新（volatile 就地提交）')
        })
      }
      ctx?.logger?.debug?.('dsh-doc-suite: 设置由具名导出 Config 派生（rc.2 口径，ns = entry id doc-suite），读取时实时解包 volatile 引用')
    }
  } catch (err) {
    ctx?.logger?.warn?.('dsh-doc-suite: 设置服务不可用，退回组合配置/默认值：' + (err?.message || err))
    scope = null
    mode = 'none'
  }

  return {
    // 分支 A 用 scope 维护的 current；分支 B 与降级路径每次实时解包 baseConfig（volatile 引用就地更新）
    read: () => (scope ? current : toConfig(baseConfig)),
    watch: (cb) => {
      if (typeof cb === 'function') listeners.push(cb)
    },
    get scope() { return scope },
    available: mode !== 'none',
    mode,
  }
}

/** 生图配置摘要（绝不含密钥明文，供命令与自检展示） */
export function mediaSummary(cfg) {
  return {
    provider: cfg.mediaProvider,
    imageEnabled: !!cfg.mediaImageEnabled,
    model: cfg.mediaImageModel,
    size: cfg.mediaImageSize,
    hasApiKey: !!cfg.mediaArkApiKey,
    endpoint: cfg.mediaArkEndpoint,
    videoEnabled: !!cfg.mediaVideoEnabled,
  }
}
