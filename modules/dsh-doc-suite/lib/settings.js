/**
 * dsh-doc-suite — 设置命名空间（DSH 原生设置服务）
 *
 * **键路径（扁平顶层键；2026-09-16 由嵌套 media*（扁平顶层键） 改为扁平）**：
 *   mediaProvider · mediaImageEnabled · mediaImageModel · mediaImageSize ·
 *   mediaImageTimeoutMs · mediaImageRetries · mediaImageFallbackToVector ·
 *   mediaVideoEnabled · mediaVideoModel · mediaArkApiKey · mediaArkEndpoint
 *
 * **为什么扁平**（口径变更依据，2026-09-16 使用者选定方案 A）：集成体的「能力配置页」把五个
 * 子插件的设置集中到一处渲染 —— 它的宿主侧写入校验**只接受顶层键**
 * （modules/work-personal-secretary/lib/settings-api.js 的 path 白名单原文："不接受嵌套路径"），
 * 客户端分组定义也是扁平 keys 列表。嵌套的 media*（扁平顶层键） 在那一页读不到、也写不进；扁平化后
 * **无需放宽集成体的安全边界**即可直接可用。
 *
 * 其余约定不变：**密钥默认空**、不打印不落日志不入 git；环境变量 ARK_API_KEY 优先于设置项。
 *
 * @module dsh-doc-suite/settings
 */
import z from '@deepseek-ai/schemastery'

/** 设置命名空间名（设置页与集成体能力配置页按它派发） */
export const SETTINGS_NS = 'dsh-doc-suite'

/** 兜底默认值：与 schema 默认值保持一致（设置服务缺失时退回这份值） */
export const DEFAULTS = {
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

/** 设置页与集成体能力配置页渲染用的 schema（description 即说明文字） */
export const SETTINGS_SCHEMA = z.object({
  mediaProvider: z.string().default('volcengine-ark')
    .description('生图服务商；默认火山引擎（ARK）'),
  mediaImageEnabled: z.boolean().default(true)
    .description('图形元素优先生图（图标/装饰/概念插图/背景图）；关闭或失败时自动回退代码矢量绘制'),
  mediaImageModel: z.string().default('doubao-seedream-5-0-pro-260628')
    .description('方舟模型 ID（默认 Seedream 5.0 Pro）；以方舟控制台开通的 ID 为准'),
  mediaImageSize: z.string().default('1K')
    .description('出图尺寸（方舟口径，如 1K / 2K）'),
  mediaImageTimeoutMs: z.natural().default(60000)
    .description('单次请求超时（毫秒）'),
  mediaImageRetries: z.natural().default(2)
    .description('失败重试次数（网络/5xx 重试；4xx 不重试）'),
  mediaImageFallbackToVector: z.boolean().default(true)
    .description('无密钥/未开通/限流/超时 → 自动回退代码矢量绘制（不需人工介入）'),
  mediaVideoEnabled: z.boolean().default(false)
    .description('生视频开关（默认关）'),
  mediaVideoModel: z.string().default('')
    .description('生视频模型 ID（按方舟控制台填写；默认空 = 不用）'),
  mediaArkApiKey: z.string().default('')
    .description('ARK 密钥（敏感）：默认空；不会打印、不落日志、不进报错。留空则生图不可用并自动回退矢量'),
  mediaArkEndpoint: z.string().default('https://ark.cn-beijing.volces.com/api/v3')
    .description('方舟端点（默认北京区）'),
})

/** 组合配置层：只保留 schema 认识的键（未知键忽略） */
function normalizeBase(base) {
  const out = {}
  for (const [k, v] of Object.entries(base || {})) {
    if (k in DEFAULTS && v !== undefined && v !== null) out[k] = v
  }
  return out
}

/** 解析值 → 插件内部配置（浅合并；空字符串统一视为「未设置」） */
function toConfig(resolved) {
  const cfg = { ...DEFAULTS, ...normalizeBase(resolved) }
  if (!cfg.mediaArkApiKey) cfg.mediaArkApiKey = ''
  if (!cfg.mediaVideoModel) cfg.mediaVideoModel = ''
  return cfg
}

/**
 * 注册设置命名空间并把解析值接到插件运行时。
 *
 * @param {object} ctx cordis context（需 settings 服务；拿不到时降级为默认值）
 * @param {object} baseConfig 组合配置（bundle entry config）作为 base 层
 */
export function installSettings(ctx, baseConfig = {}) {
  const base = normalizeBase(baseConfig)
  let scope = null
  let current = toConfig(base)
  try {
    // applies: 'live' —— 设置改动**免重启生效**（与集成体「记忆库 / 专家库」的形态一致）。
    // 服务端若不认识该字段会抛错 → 由下面的 catch 降级，不影响插件启动。
    scope = ctx.settings.register(SETTINGS_NS, SETTINGS_SCHEMA, { base, applies: 'live' })
    current = toConfig(scope.get())
    scope.watch(() => { current = toConfig(scope.get()) })
    ctx.logger?.debug?.('dsh-doc-suite: 设置命名空间已注册（设置 → 插件 → dsh-doc-suite）')
  } catch (err) {
    ctx.logger?.warn?.('dsh-doc-suite: 设置服务不可用，退回组合配置/默认值：' + (err?.message || err))
    scope = null
  }
  return {
    read: () => current,
    watch: (cb) => { if (scope) scope.watch(() => cb(current)) },
    get scope() { return scope },
    available: scope !== null,
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
