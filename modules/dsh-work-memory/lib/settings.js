/**
 * work-memory — 设置命名空间（0.1.x 原生设置服务 / 0.2.0-rc.2 具名导出 Config 双口径）
 *
 * 两种宿主口径并存（2026-09-30 迁移）：
 *   ① 0.1.x：`ctx.settings.register(ns, schema, { base })` 显式注册命名空间；
 *      组合配置作 `base` 层、设置页写用户覆盖层、插件侧 `scope.get()` 读快照并 `watch` 变更。
 *   ② 0.2.0-rc.2：settings 服务不再提供 register —— cordis 注册插件时捕获**具名导出的 Config**
 *      （`vendor/cordis/src/registry.ts:326` → `packages/settings/settings/src/index.ts:425-428`），
 *      命名空间即 profile entry id（本插件的是 `work-memory`，与 SETTINGS_NS 同值），
 *      取值直接来自 `apply(ctx, config)`。
 *
 * rc.2 的两条硬性口径（源码依据）：
 *   - **只有带 `.volatile()` 的字段进设置表单**：`packages/settings/settings/src/schema.ts:37-47` 的
 *     `volatileForm()` 只挑 volatile 子树，整棵无 volatile 时 `index.ts:308-309` 直接返回空。
 *     故本文件把 24 个可配置字段**全部**标 volatile（迁移前它们整卡可配，不标即等于功能回退）。
 *     例外：`.volatile()` 是 schemastery 3.18.3 才有的方法（peer 下界 ^3.18.1），必须特性探测。
 *   - **Config 绝不能是 `null`**：`index.ts:427` 判据 `'toJSON' in schema` 对 null 会抛 TypeError；
 *     schemastery 不可用时导出 `undefined`（那时 cordis 原样透传 config，插件退回 DEFAULTS）。
 *
 * 热更语义（rc.2）：volatile 是 loader **就地更新**的引用（`vendor/loader/src/config/entry.ts:162-195`
 * 的 `_commitVolatile()` → `updateVolatile(ref, source)`），**不重跑 apply 也不重启 fiber**。
 * 因此本模块：read() 每次实时解包；并监听 `loader/volatile-update` 事件把变更推给 watch 订阅者
 * （index.js 的 liveArchiveCfg / liveBackupCfg 与记忆库根目录切换依赖它即时生效）。
 *
 * @module work-memory/settings
 */

/**
 * schemastery 动态导入（降级为 null：纯 node 单测 / 宿主缺依赖时模块仍可加载）。
 * 注意本模块是 ESM，允许 top-level await。
 */
let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  z = null
}

/** 设置命名空间名（设置页卡片按它派发；rc.2 下 = profile entry id） */
export const SETTINGS_NS = 'work-memory'

/**
 * 兜底默认值：与 schema 默认值保持一致。
 * schema 不可用或设置服务缺失时，插件退回这份值，行为与旧版一致。
 */
export const DEFAULTS = {
  memoryDir: null,
  personaLabel: '记忆',
  injectMemory: true,
  snapshotOrder: 500,
  snapshotMaxChars: 4000,
  snapshotLimitGlobal: 20,
  snapshotLimitUser: 12,
  snapshotLimitProject: 16,
  snapshotLimitDaily: 8,
  reviewEnabled: true,
  dailyAutoLog: true,
  maintainWarnDays: 7,
  archiveEnabled: true,
  dailyRetentionDays: 7,
  projectTtlDays: 30,
  userTtlDays: 90,
  triageEnabled: true,
  triageGraceDays: 7,
  triageAskInSnapshot: true,
  globalWarnCount: 20,
  backupEnabled: true,
  backupDir: null,
  backupKeep: 7,
  obsidianSyncDir: null,
}

/**
 * 特性探测包一层 `.volatile()`：该方法 schemastery 3.18.3 才引入，而 peer 下界是 ^3.18.1，
 * 且下面的 schema 在**模块顶层求值** —— 裸调会抛 TypeError，而 try/catch 只包着 `await import()`，
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
 * 24 个字段全部 volatile —— 迁移前它们整卡可配，rc.2 只投影 volatile 字段，不标即功能回退。
 * 不可用时导出 `undefined`（**不是 null**，见文件头口径）。
 */
export const MEMORY_SETTINGS_SCHEMA = z ? z.object({
  memoryDir: withVolatile(z.string().default(''))
    .description('记忆库根目录；留空 = <DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory（改动即时生效，无需重启）'),
  personaLabel: withVolatile(z.string().default('记忆'))
    .description('注入快照的标题词，默认「记忆」'),
  injectMemory: withVolatile(z.boolean().default(true))
    .description('每轮对话注入记忆 runtime 快照（关闭后记忆库仍可用，只是不再自动注入）'),
  snapshotOrder: withVolatile(z.natural().default(500))
    .description('runtime 上下文快照顺序，越小越靠前（改动需重启 DSH 生效）'),
  snapshotMaxChars: withVolatile(z.natural().default(4000))
    .description('注入快照的字符上限，超出按优先级截断（截断处会标注未注入条数）'),
  snapshotLimitGlobal: withVolatile(z.natural().default(20)).description('快照里「全局记忆」最多注入条数（全局永不归档）'),
  snapshotLimitUser: withVolatile(z.natural().default(12)).description('快照里「用户偏好」最多注入条数（关键优先、近期优先）'),
  snapshotLimitProject: withVolatile(z.natural().default(16)).description('快照里「项目记忆」最多注入条数（关键优先、近期优先）'),
  snapshotLimitDaily: withVolatile(z.natural().default(8)).description('快照里「今日日志」最多注入条数（取最近若干条）'),
  reviewEnabled: withVolatile(z.boolean().default(true))
    .description('tag=关键 的记忆先进入待确认队列，批准后才落盘'),
  dailyAutoLog: withVolatile(z.boolean().default(true))
    .description('每轮对话自动追加一条今日活动日志（10 分钟防抖）'),
  maintainWarnDays: withVolatile(z.natural().default(7))
    .description('距上次 /memory_maintain 超过多少天时，在注入快照里提醒做周保养（0 = 关闭）'),
  archiveEnabled: withVolatile(z.boolean().default(true))
    .description('冷热分层：到期热记忆转冷（ARCHIVE），全局与关键永不归档'),
  dailyRetentionDays: withVolatile(z.natural().default(7))
    .description('DAILY 日志保留天数，更早的按周合并进 ARCHIVE/daily-YYYY-Www.md'),
  projectTtlDays: withVolatile(z.natural().default(30))
    .description('项目记忆（PROJECTS）条目保留天数，超期转冷（关键永不；被用到过的顺延）'),
  userTtlDays: withVolatile(z.natural().default(90))
    .description('偏好记忆（USER.md）条目保留天数，超期转冷（关键永不；被用到过的顺延）'),
  triageEnabled: withVolatile(z.boolean().default(true))
    .description('转冷预审：条目到期后先结合近期日志/热记忆/全局记忆自动判断——该保留的顺延、该冷的转冷、拿不准的进待判断队列（关掉则到期即转冷）'),
  triageGraceDays: withVolatile(z.natural().default(7))
    .description('预审「待判断」条目的宽限天数：超过仍未判定则自然转冷（0 = 不宽限）'),
  triageAskInSnapshot: withVolatile(z.boolean().default(true))
    .description('有「转冷待判断」条目时，在注入快照里提醒助手去判定（/memory_triage）'),
  globalWarnCount: withVolatile(z.natural().default(20))
    .description('全局记忆条数告警阈值：超过时注入快照里会出现整理提醒（0 = 关闭）'),
  backupEnabled: withVolatile(z.boolean().default(true))
    .description('自动备份记忆库（写库时懒触发，每天至多一次）'),
  backupDir: withVolatile(z.string().default(''))
    .description('备份根目录；留空使用默认目录'),
  backupKeep: withVolatile(z.natural().default(7))
    .description('保留最近多少份备份，更早的删除'),
  obsidianSyncDir: withVolatile(z.string().default(''))
    .description('Obsidian 记忆镜像目录（留空 = 不同步；建议指向 vault 下的记忆镜像区）'),
}) : undefined

/**
 * rc.2 的具名导出：cordis 注册插件时把它捕获为 `plugin.Config`（vendor/cordis/src/registry.ts:326），
 * settings 服务再由它派生设置表单。0.1.x 下这个导出没有副作用（那里走 installSettings 的 register 分支）。
 */
export const Config = MEMORY_SETTINGS_SCHEMA

/** volatile 引用的跨副本协议符号（与 vendor/cosmokit/src/volatile.ts:3 同源，走 Symbol.for 全局注册表） */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 解包 rc.2 的 volatile 引用（取当前值）。
 *
 * 官方判定见 `vendor/cosmokit/src/volatile.ts:52-54` 的 `isVolatile()`：
 * `typeof value === 'object' && value !== null && write in value`。
 * **不能用 `typeof v.get === 'function'`**：那会误伤 `new Map()` 与任何带 get 的普通对象。
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

/** 解析值 → 插件内部配置（逐已知键解包 volatile；空字符串视为「未设置」） */
function toConfig(resolved) {
  const src = resolved ?? {}
  const cfg = {}
  for (const key of Object.keys(DEFAULTS)) {
    const value = unwrapValue(src[key])
    cfg[key] = value === null || value === undefined ? DEFAULTS[key] : value
  }
  if (!cfg.backupDir) cfg.backupDir = null
  if (!cfg.memoryDir) cfg.memoryDir = null
  if (!cfg.obsidianSyncDir) cfg.obsidianSyncDir = null
  return cfg
}

/**
 * 把设置接进插件运行时（双口径）。
 *
 * - 分支 A（0.1.x，`ctx.settings.register` 存在）：行为与迁移前一致 —— 组合配置作 base 层、
 *   scope.get() 取值、scope.watch 热更。
 * - 分支 B（rc.2，无 register，**正常路径**）：取值来自 apply(ctx, config)；read() 每次实时解包；
 *   监听 `loader/volatile-update`（loader 就地提交 volatile 后发出）驱动 watch 订阅者。不抛不 warn。
 * - 降级（schemastery 不可用或注册抛错）：`available: false`，read 仍返回组合配置解析值。
 *
 * @param {object} ctx - cordis context（需 settings 服务）
 * @param {object} [baseConfig] 组合配置（bundle entry config）；rc.2 下含 volatile 引用
 * @returns {{ read: () => object, watch: (cb: Function) => void, scope: object|null, available: boolean, mode: 'register'|'config'|'none' }}
 */
export function installSettings(ctx, baseConfig = {}) {
  let scope = null
  let mode = 'none'
  const listeners = []
  let current = toConfig(baseConfig)

  /** 把当前解析值推给 watch 订阅者；单个回调抛错不影响其它回调 */
  const notify = () => {
    for (const cb of listeners) {
      try {
        cb(current)
      } catch (err) {
        ctx?.logger?.warn?.('work-memory: 设置变更回调失败：' + (err?.message || err))
      }
    }
  }

  try {
    if (!z || !MEMORY_SETTINGS_SCHEMA) throw new Error('schemastery 不可用（宿主运行时缺失或降级环境）')
    if (ctx && ctx.settings && typeof ctx.settings.register === 'function') {
      // ---- 分支 A：0.1.x 原生设置服务（与迁移前行为一致） ----
      const base = normalizeBase(baseConfig)
      scope = ctx.settings.register(SETTINGS_NS, MEMORY_SETTINGS_SCHEMA, { base })
      current = toConfig(scope.get())
      scope.watch(() => {
        current = toConfig(scope.get())
        notify()
      })
      mode = 'register'
      ctx.logger?.debug?.('work-memory: 设置命名空间已注册（设置→插件 可配置）')
    } else {
      // ---- 分支 B：0.2.0-rc.2 具名导出 Config 派生（无 register 是正常口径，不降级、不告警） ----
      mode = 'config'
      // rc.2 的 volatile 由 loader 就地提交（不重跑 apply、不重启 fiber），所以：
      //   ① read() 每次实时解包 —— 任何走 read() 的消费点随时拿到新值；
      //   ② 监听 loader/volatile-update —— 驱动 watch 订阅者（index.js 的 cfg 快照变量、
      //      liveArchiveCfg / liveBackupCfg 与记忆库根目录切换都靠它就地生效）。
      if (ctx && typeof ctx.on === 'function') {
        ctx.on('loader/volatile-update', () => {
          current = toConfig(baseConfig)
          notify()
          ctx.logger?.debug?.('work-memory: 设置已更新（volatile 就地提交）')
        })
      }
      ctx?.logger?.debug?.('work-memory: 设置由具名导出 Config 派生（rc.2 口径），memoryDir 等改动即时生效')
    }
  } catch (err) {
    ctx?.logger?.warn?.('work-memory: 设置服务不可用，退回组合配置：' + (err?.message || err))
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
