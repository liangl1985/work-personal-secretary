/**
 * dsh-doc-suite — 设置命名空间（DSH 原生设置服务）
 *
 * 约定（55 号第七章 v4）：
 *   - 生图/生视频的**平台与开关都进设置项**，**默认接入火山引擎（ARK）**；
 *   - **密钥默认值为空字符串**（发布件永不含密钥）；密钥**不打印、不落日志、不进报错文本**；
 *   - 环境变量（ARK_API_KEY / ARK_ENDPOINT / ARK_MODEL）**优先于**设置项（脚本侧读取）；
 *   - 键路径形如 media.image.enabled（设置页按 media / image / video / ark 分组）。
 *
 * 依赖宿主自带的 @deepseek-ai/schemastery（peer）。
 * 默认值三处必须一致：本文件的 schema / DEFAULTS、cordis.patch.yml 的注释、README。
 *
 * @module dsh-doc-suite/settings
 */
import z from '@deepseek-ai/schemastery'

/** 设置命名空间名（设置页按它派发） */
export const SETTINGS_NS = 'dsh-doc-suite'

/** 兜底默认值：与 schema 默认值保持一致（设置服务缺失时退回这份值） */
export const DEFAULTS = {
  media: {
    provider: 'volcengine-ark',
    image: {
      enabled: true,
      model: 'doubao-seedream-5-0-pro-260628',
      size: '1K',
      timeout_ms: 60000,
      retries: 2,
      fallback_to_vector: true,
    },
    video: { enabled: false, model: '' },
    ark: { api_key: '', endpoint: 'https://ark.cn-beijing.volces.com/api/v3' },
  },
}

/** 设置页渲染的 schema（description 即卡片说明文字） */
export const SETTINGS_SCHEMA = z.object({
  media: z.object({
    provider: z.string().default('volcengine-ark')
      .description('生图服务商；默认火山引擎（ARK）'),
    image: z.object({
      enabled: z.boolean().default(true)
        .description('图形元素优先生图（图标/装饰/概念插图/背景图）；关闭或失败时自动回退代码矢量绘制'),
      model: z.string().default('doubao-seedream-5-0-pro-260628')
        .description('方舟模型 ID（默认 Seedream 5.0 Pro）；以方舟控制台开通的 ID 为准'),
      size: z.string().default('1K')
        .description('出图尺寸（方舟口径，如 1K / 2K）'),
      timeout_ms: z.natural().default(60000)
        .description('单次请求超时（毫秒）'),
      retries: z.natural().default(2)
        .description('失败重试次数（网络/5xx 重试；4xx 不重试）'),
      fallback_to_vector: z.boolean().default(true)
        .description('无密钥/未开通/限流/超时 → 自动回退代码矢量绘制（不需人工介入）'),
    }),
    video: z.object({
      enabled: z.boolean().default(false).description('生视频开关（默认关）'),
      model: z.string().default('').description('生视频模型 ID（按方舟控制台填写；默认空 = 不用）'),
    }),
    ark: z.object({
      api_key: z.string().default('')
        .description('ARK 密钥（敏感）：默认空；不会打印、不落日志、不进报错。留空则生图不可用并自动回退矢量'),
      endpoint: z.string().default('https://ark.cn-beijing.volces.com/api/v3')
        .description('方舟端点（默认北京区）'),
    }),
  }),
})

function deepMerge(base, override) {
  const out = { ...base }
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

/** 组合配置层：只保留 schema 认识的媒体键 */
function normalizeBase(base) {
  const media = base && typeof base === 'object' ? base.media : null
  return media && typeof media === 'object' ? { media: JSON.parse(JSON.stringify(media)) } : {}
}

/** 解析值 → 插件内部配置（空字符串统一视为「未设置」） */
function toConfig(resolved) {
  const cfg = deepMerge(DEFAULTS, resolved || {})
  if (!cfg.media.ark.api_key) cfg.media.ark.api_key = ''
  if (!cfg.media.video.model) cfg.media.video.model = ''
  return cfg
}

/** 扁平路径读取（脚本与文档统一用 media.image.enabled 这样的键路径） */
export function getPath(cfg, dotted) {
  return String(dotted).split('.').reduce((node, key) => (node == null ? undefined : node[key]), cfg)
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
  const img = cfg.media.image
  const ark = cfg.media.ark
  return {
    provider: cfg.media.provider,
    imageEnabled: !!img.enabled,
    model: img.model,
    size: img.size,
    hasApiKey: !!ark.api_key,
    endpoint: ark.endpoint,
    videoEnabled: !!cfg.media.video.enabled,
  }
}
