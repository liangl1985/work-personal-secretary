/**
 * lina-memory — 设置命名空间（DSH 0.1.5-rc.1 原生设置服务）
 *
 * 0.2.0 时代配置只来自 profile 的 cordis.patch.yml（改一次要重启）。
 * 0.3.0 起改用官方 `ctx.settings` 命名空间：
 *   - 组合配置（cordis.patch.yml / bundle entry config）作为 `base` 层；
 *   - 用户覆盖层由设置页「插件」分区的可配置卡片写入（无需重启，带 revision 栅栏）；
 *   - 插件侧只读解析后的深冻结快照，并可 watch 已提交变更。
 *
 * 依赖 `@deepseek-ai/schemastery`（宿主运行时自带，peer）。
 *
 * @module lina-memory/settings
 */

import z from '@deepseek-ai/schemastery'

/** 设置命名空间名（设置页卡片按它派发） */
export const SETTINGS_NS = 'lina-memory'

/**
 * 兜底默认值：与 schema 默认值保持一致。
 * schema 解析失败或设置服务缺失时，插件退回这份值，行为与旧版一致。
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

/** 设置页渲染的 schema（描述即卡片上的说明文字） */
export const MEMORY_SETTINGS_SCHEMA = z.object({
  memoryDir: z.string().default('')
    .description('记忆库根目录；留空 = ~/.dsh/memories/<插件命名空间>'),
  personaLabel: z.string().default('记忆')
    .description('注入快照的标题词，默认「记忆」'),
  injectMemory: z.boolean().default(true)
    .description('每轮对话注入记忆 runtime 快照（关闭后记忆库仍可用，只是不再自动注入）'),
  snapshotOrder: z.natural().default(500)
    .description('runtime 上下文快照顺序，越小越靠前（改动需重启 DSH 生效）'),
  snapshotMaxChars: z.natural().default(4000)
    .description('注入快照的字符上限，超出按优先级截断（截断处会标注未注入条数）'),
  snapshotLimitGlobal: z.natural().default(20).description('快照里「全局记忆」最多注入条数（全局永不归档）'),
  snapshotLimitUser: z.natural().default(12).description('快照里「用户偏好」最多注入条数（关键优先、近期优先）'),
  snapshotLimitProject: z.natural().default(16).description('快照里「项目记忆」最多注入条数（关键优先、近期优先）'),
  snapshotLimitDaily: z.natural().default(8).description('快照里「今日日志」最多注入条数（取最近若干条）'),
  reviewEnabled: z.boolean().default(true)
    .description('tag=关键 的记忆先进入待确认队列，批准后才落盘'),
  dailyAutoLog: z.boolean().default(true)
    .description('每轮对话自动追加一条今日活动日志（10 分钟防抖）'),
  maintainWarnDays: z.natural().default(7)
    .description('距上次 /memory_maintain 超过多少天时，在注入快照里提醒做周保养（0 = 关闭）'),
  archiveEnabled: z.boolean().default(true)
    .description('冷热分层：到期热记忆转冷（ARCHIVE），全局与关键永不归档'),
  dailyRetentionDays: z.natural().default(7)
    .description('DAILY 日志保留天数，更早的按周合并进 ARCHIVE/daily-YYYY-Www.md'),
  projectTtlDays: z.natural().default(30)
    .description('项目记忆（PROJECTS）条目保留天数，超期转冷（关键永不；被用到过的顺延）'),
  userTtlDays: z.natural().default(90)
    .description('偏好记忆（USER.md）条目保留天数，超期转冷（关键永不；被用到过的顺延）'),
  triageEnabled: z.boolean().default(true)
    .description('转冷预审：条目到期后先结合近期日志/热记忆/全局记忆自动判断——该保留的顺延、该冷的转冷、拿不准的进待判断队列（关掉则到期即转冷）'),
  triageGraceDays: z.natural().default(7)
    .description('预审「待判断」条目的宽限天数：超过仍未判定则自然转冷（0 = 不宽限）'),
  triageAskInSnapshot: z.boolean().default(true)
    .description('有「转冷待判断」条目时，在注入快照里提醒助手去判定（/memory_triage）'),
  globalWarnCount: z.natural().default(20)
    .description('全局记忆条数告警阈值：超过时注入快照里会出现整理提醒（0 = 关闭）'),
  backupEnabled: z.boolean().default(true)
    .description('自动备份记忆库（写库时懒触发，每天至多一次）'),
  backupDir: z.string().default('')
    .description('备份根目录；留空使用默认目录'),
  backupKeep: z.natural().default(7)
    .description('保留最近多少份备份，更早的删除'),
  obsidianSyncDir: z.string().default('')
    .description('Obsidian 记忆镜像目录（留空 = 不同步；建议指向 vault 下的记忆镜像区）'),
})

/** 把组合配置里的 null/undefined 规整成 schema 能接受的值 */
function normalizeBase(base) {
  const out = {}
  for (const [key, value] of Object.entries(base ?? {})) {
    if (!(key in DEFAULTS)) continue
    if (value === null || value === undefined) continue
    out[key] = value
  }
  return out
}

/** 解析值 → 插件内部配置（空字符串视为“未设置”） */
function toConfig(resolved) {
  const cfg = { ...DEFAULTS, ...(resolved ?? {}) }
  if (!cfg.backupDir) cfg.backupDir = null
  if (!cfg.memoryDir) cfg.memoryDir = null
  if (!cfg.obsidianSyncDir) cfg.obsidianSyncDir = null
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
    scope = ctx.settings.register(SETTINGS_NS, MEMORY_SETTINGS_SCHEMA, { base })
    current = toConfig(scope.get())
    scope.watch(() => {
      current = toConfig(scope.get())
    })
    ctx.logger?.debug?.('lina-memory: 设置命名空间已注册（设置→插件 可配置）')
  } catch (err) {
    ctx.logger?.warn?.('lina-memory: 设置服务不可用，退回组合配置：' + (err?.message || err))
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
