/**
 * work-personal-secretary —— 能力配置页宿主侧 API（读写子插件设置 + 专家打分预览）
 *
 * 路由（前缀 /work-personal-secretary/api；契约《17_P4 能力配置页接口契约与安全边界》§4）：
 *   GET  /settings        —— 只读枚举：白名单 ns（work-memory / experts）的 value / user / fields
 *   POST /settings/write  —— 写用户层：ns 白名单 + path 白名单 + revision 栅栏；**dryRun 默认 true**
 *   GET  /experts/preview —— 打分实时预览：动态 import 子插件 dsh-experts/lib/match.js（**只读**）
 *
 * 安全边界（契约 §5，逐条对应）：
 * 1. **ns 白名单硬编码**（官方 seam 无所有权校验，产品层必须收敛）；
 * 2. **path 白名单** = 该 ns schema 已声明的顶层键（拒绝未知键、拒绝嵌套路径、拒绝复杂类型）；
 * 3. **只写用户层**：一律走 `ctx.settings.mutate` 的 set/unset，不碰 base 与组合配置；
 * 4. **默认 dry-run**：POST 不带 `dryRun:false` 一律不写盘（沿用 P2/P3 约定）；
 * 5. **零命令执行 / 零路径透传**：不接受客户端传命令或文件路径，预览只吃文本；
 * 6. **不泄露**：describe 的 `redactSecrets:true` 保留；错误信息脱敏，不回显本机私有路径。
 *
 * 降级纪律（契约 §七「不崩」验收项）：ctx.settings 缺失 / 子插件未装 / schema 不可解析 /
 * 打分抛错 —— 一律返回**可读错误**（ok:false + message），绝不向外抛异常。
 *
 * 宿主契约依据（`@deepseek-ai/dsh-settings/lib/index.js`）：
 *   - `describe(options)` :358-388 —— 返回**数组**，每项 `{ ns, schema: schema.toJSON(), value, revision, base?, user?, applies, secrets? }`；
 *   - `mutate(ns, ops, expectedRevision)` :440-448 —— ops 形如 `{ op:'set'|'unset', path:[key], value? }`；
 *     **resolve 值不携带新 revision/value**，所以写成功后必须重新 describe 才能回填响应；
 *   - `SettingsConflictError` :99-117 —— `code='SETTINGS_CONFLICT'`，带 `expected` / `actual`。
 *
 * @module work-personal-secretary/settings-api
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ───────────────────────────── 契约常量（契约 §3 / §4 / §5.1） ─────────────────────────────

/** ns 白名单（契约 §5.1 硬编码；**不接受客户端任意 ns**） */
export const SETTINGS_NS_WHITELIST = ['work-memory', 'experts']

/** ns → 页面分组标题（契约 §3：记忆库 / 专家库） */
export const SETTINGS_NS_TITLES = { 'work-memory': '记忆库', experts: '专家库' }

/** P4 的三条路由（注册方式见 lib/api.js 的 installSettingsExactRoutes） */
export const SETTINGS_API_PATHS = ['/settings', '/settings/write', '/experts/preview']

/** 预览文本上限（契约 §4.3：2000 字符；超出按上限截断，保证打分成本有界） */
export const PREVIEW_TEXT_LIMIT = 2000

/** 单次写请求的 ops 条数上限（契约未定；取 64，仅防滥用） */
export const MAX_WRITE_OPS = 64

/** fields 里**可写**的标量类型；其余（object / dict / array / tuple / union …）一律 type:"complex" 降级只读 */
export const SCALAR_TYPES = ['string', 'number', 'boolean', 'const']

/**
 * dsh-experts 设置项的兜底值（settings 服务不可用时使用）。
 * 出处：modules/dsh-experts/lib/settings.js 的 DEFAULTS（expertInjectMax 默认 2 —— 契约 §六.1 甲案）。
 */
export const EXPERTS_CONFIG_FALLBACK = {
  defaultDomain: 'presales',
  identityExpert: '',
  expertInjectMax: 2,
  expertInjectDetail: 'auto',
  expertInjectBudgetChars: 1400,
  expertSecondThreshold: 0.8,
  expertMinScore: 0.35,
}

// ───────────────────────────── schema 归一化（契约 §4.1 fields） ─────────────────────────────

/**
 * 解析 schemastery 的 toJSON 结果里的引用。
 * `Schema.prototype.toJSON()`（schemastery/src/index.ts:296-307）返回 `{ uid, refs }`，
 * 顶层对象在 `refs[uid]`，其 `dict` 的每个值是指向 `refs` 的 uid 或内联节点。
 */
function derefSchema(schemaJson, node) {
  if (typeof node === 'number' && schemaJson && schemaJson.refs && typeof schemaJson.refs === 'object') {
    return schemaJson.refs[node] || null
  }
  return node && typeof node === 'object' ? node : null
}

/** 取 schema 的顶层节点（兼容 `{uid,refs}` 与内联 `{type,meta,dict}` 两种形态） */
function schemaRoot(schemaJson) {
  if (!schemaJson || typeof schemaJson !== 'object') return null
  if (schemaJson.refs && typeof schemaJson.refs === 'object' && schemaJson.uid !== undefined) {
    return derefSchema(schemaJson, schemaJson.uid)
  }
  return schemaJson
}

/**
 * 把 `schema.toJSON()` 归一化成契约 §4.1 的 fields 结构。
 * 顶层标量直出（type/default/description 可用）；复杂类型标 `type:"complex"` 并**降级只读**。
 * schema 解析不出来时返回空数组（调用方按「未装」降级）。
 *
 * @param {object} schemaJson - `ctx.settings.describe()` 里 ns 的 `schema` 字段
 * @returns {Array<{key:string,type:string,default:*,override:boolean,writable:boolean,description:string}>}
 */
export function normalizeSchemaFields(schemaJson) {
  const fields = []
  const root = schemaRoot(schemaJson)
  if (!root || typeof root !== 'object') return fields
  const dict = (root.dict && typeof root.dict === 'object' && !Array.isArray(root.dict))
    ? root.dict
    // 兼容：schema 本身就是键表（没有 object 包装）
    : (typeof root.type === 'undefined' ? root : null)
  if (!dict) return fields
  for (const key of Object.keys(dict)) {
    const node = derefSchema(schemaJson, dict[key]) || {}
    const meta = (node.meta && typeof node.meta === 'object') ? node.meta : {}
    const rawType = typeof node.type === 'string' ? node.type : 'complex'
    const scalar = SCALAR_TYPES.indexOf(rawType) >= 0
    fields.push({
      key: key,
      type: scalar ? rawType : 'complex',
      default: scalar && meta.default !== undefined ? meta.default : null,
      override: false, // 由 normalizeNamespace 按用户层实际键标
      writable: scalar,
      description: typeof meta.description === 'string' ? meta.description : '',
    })
  }
  return fields
}

/**
 * describe 的单条 ns 描述子 → 契约 §4.1 的对外结构。
 * @param {object} entry - describe 数组里的一项
 * @param {boolean} [nsWritable] - provider 级可写性（describe 不返回 writable）
 */
export function normalizeNamespace(entry, nsWritable = true) {
  const ns = String((entry && entry.ns) || '')
  const rawUser = (entry && entry.user && typeof entry.user === 'object' && !Array.isArray(entry.user)) ? entry.user : {}
  const fields = normalizeSchemaFields(entry && entry.schema).map((f) => ({
    key: f.key,
    type: f.type,
    default: f.default,
    override: Object.prototype.hasOwnProperty.call(rawUser, f.key),
    writable: f.writable,
    description: f.description,
  }))
  return {
    ns: ns,
    title: SETTINGS_NS_TITLES[ns] || ns,
    revision: entry && typeof entry.revision === 'number' ? entry.revision : 0,
    writable: nsWritable,
    applies: entry && typeof entry.applies === 'string' ? entry.applies : 'live',
    installed: true,
    value: entry && entry.value !== undefined ? entry.value : {},
    user: rawUser,
    fields: fields,
  }
}

/**
 * describe 结果 → GET /settings 的响应体（**白名单裁剪**，契约 §4.1）。
 * 白名单内但未注册的 ns 也返回占位条目（`installed:false`）—— 页面显示「未安装」而不是空分组。
 *
 * @param {Array|object} described - `ctx.settings.describe({redactSecrets:true})` 的返回（数组）
 * @param {{writable?:boolean}} [options]
 */
export function buildSettingsView(described, options = {}) {
  const list = Array.isArray(described)
    ? described
    : (described && Array.isArray(described.namespaces) ? described.namespaces : [])
  const nsWritable = !(options && options.writable === false)
  const namespaces = SETTINGS_NS_WHITELIST.map((ns) => {
    const hit = list.filter((d) => d && d.ns === ns)[0]
    if (!hit) {
      return {
        ns: ns,
        title: SETTINGS_NS_TITLES[ns],
        revision: 0,
        writable: false,
        applies: 'live',
        installed: false,
        value: {},
        user: {},
        fields: [],
      }
    }
    return normalizeNamespace(hit, nsWritable)
  })
  return { ok: true, namespaces: namespaces }
}

// ───────────────────────────── 写请求校验（契约 §4.2 + §5.1/5.2） ─────────────────────────────

/** 键名回显脱敏（防超长回显；纯展示用） */
function safeKey(key) {
  return String(key == null ? '' : key).slice(0, 64)
}

/**
 * 校验 POST /settings/write 的请求体（纯函数，可单测）。
 * 拒绝：非白名单 ns / 未注册 ns / 空 ops / 非法 op / 非顶层 path / 未声明键 / 复杂类型键。
 *
 * @param {object} body - 请求体
 * @param {Array|object} view - buildSettingsView 的结果（或 namespaces 数组）
 * @returns {{ok:true, ns:string, ops:Array, revision:number|undefined, dryRun:boolean}
 *          | {ok:false, status:number, error:string, message:string}}
 */
export function validateWriteRequest(body, view) {
  const namespaces = Array.isArray(view) ? view : (view && Array.isArray(view.namespaces) ? view.namespaces : [])
  const req = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {}

  const ns = typeof req.ns === 'string' ? req.ns : ''
  if (SETTINGS_NS_WHITELIST.indexOf(ns) === -1) {
    return {
      ok: false, status: 400, error: 'ns-not-allowed',
      message: '命名空间不在白名单内（只允许 ' + SETTINGS_NS_WHITELIST.join(' / ') + '）',
    }
  }
  const target = namespaces.filter((n) => n && n.ns === ns)[0]
  if (!target || target.installed === false) {
    return {
      ok: false, status: 400, error: 'ns-unavailable',
      message: '命名空间 ' + ns + ' 未注册（对应子插件未安装）',
    }
  }
  if (!Array.isArray(req.ops) || req.ops.length === 0) {
    return { ok: false, status: 400, error: 'invalid-ops', message: 'ops 必须是非空数组' }
  }
  if (req.ops.length > MAX_WRITE_OPS) {
    return { ok: false, status: 400, error: 'too-many-ops', message: '单次最多 ' + MAX_WRITE_OPS + ' 条操作' }
  }

  const allowed = new Set(target.fields.filter((f) => f.writable).map((f) => f.key))
  const ops = []
  for (const raw of req.ops) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, status: 400, error: 'invalid-op', message: '每条操作必须是 { op, path } 对象' }
    }
    const kind = raw.op
    if (kind !== 'set' && kind !== 'unset') {
      return { ok: false, status: 400, error: 'invalid-op', message: 'op 只接受 set / unset' }
    }
    const path = raw.path
    if (!Array.isArray(path) || path.length !== 1 || typeof path[0] !== 'string') {
      return {
        ok: false, status: 400, error: 'invalid-path',
        message: 'path 只接受长度 1 的字符串数组（该 ns schema 已声明的顶层键），不接受嵌套路径',
      }
    }
    const key = path[0]
    if (!allowed.has(key)) {
      return {
        ok: false, status: 400, error: 'path-not-allowed',
        message: '键 ' + safeKey(key) + ' 未在该 ns schema 中声明（或为复杂类型，已降级只读）',
      }
    }
    ops.push(kind === 'set' ? { op: 'set', path: [key], value: raw.value } : { op: 'unset', path: [key] })
  }

  return {
    ok: true,
    ns: ns,
    ops: ops,
    revision: Number.isInteger(req.revision) ? req.revision : undefined,
    dryRun: req.dryRun !== false, // 契约 §5.4：默认 dry-run
  }
}

/**
 * 错误信息脱敏（契约 §5.8：路由响应不回显本机私有路径）。
 * 折叠空白 → 抹掉 Windows 绝对路径 → 截断。
 */
export function sanitizeMessage(err, max = 300) {
  let text = String(err && err.message ? err.message : (err == null ? '' : err))
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ───────────────────────────── 专家库动态加载（契约 §4.3） ─────────────────────────────

/**
 * 子插件 dsh-experts 的候选模块目录（**按 profile 的 node_modules 优先**，契约 §4.3）。
 * 返回的是「来源枚举 + 目录」，不外发路径。
 */
export function expertsModuleCandidates(paths) {
  const out = []
  const profileDir = paths && typeof paths.profileDir === 'string' ? paths.profileDir : ''
  const repoRoot = paths && typeof paths.repoRoot === 'string' ? paths.repoRoot : ''
  const moduleDir = paths && typeof paths.moduleDir === 'string' ? paths.moduleDir : ''
  if (profileDir) out.push({ source: 'profile', libDir: join(profileDir, 'node_modules', 'dsh-experts', 'lib') })
  if (repoRoot) out.push({ source: 'repo', libDir: join(repoRoot, 'modules', 'dsh-experts', 'lib') })
  if (moduleDir) out.push({ source: 'bundled', libDir: join(moduleDir, '..', 'dsh-experts', 'lib') })
  return out
}

/**
 * 动态 import 子插件的 match.js（打分）与 store.js（专家索引）。
 * 装不上 / 加载失败 → `{ ok:false }`（调用方降级 `{ok:false,unavailable:true}`），**绝不抛**。
 */
export async function loadExpertsModules(paths) {
  const candidates = expertsModuleCandidates(paths)
  for (const c of candidates) {
    const matchFile = join(c.libDir, 'match.js')
    if (!existsSync(matchFile)) continue
    let match = null
    try {
      match = await import(pathToFileURL(matchFile).href)
    } catch (err) {
      match = null
    }
    if (!match || typeof match.selectExperts !== 'function') continue
    // store.js 与 match.js 同在 lib/ 下（同一子插件），一起装；读不到就无法取得专家索引
    let store = null
    const storeFile = join(c.libDir, 'store.js')
    if (existsSync(storeFile)) {
      try {
        store = await import(pathToFileURL(storeFile).href)
      } catch (err) {
        store = null
      }
    }
    if (!store) continue
    return { ok: true, source: c.source, match: match, store: store }
  }
  return { ok: false, source: '', reason: 'not-installed' }
}

// ───────────────────────────── 路由 handler ─────────────────────────────

/**
 * 创建 P4 三条路由的 handler。
 *
 * HTTP 小工具（sendJson / sendError / readBody / sameOriginGuard）与路径解析器由 lib/api.js 注入，
 * 以**复用既有同源守卫与错误响应格式**，本文件不重复实现（契约 §5.5）。
 *
 * @param {object} ctx - cordis context
 * @param {object} deps
 * @param {Function} deps.sendJson
 * @param {Function} deps.sendError
 * @param {Function} deps.readBody
 * @param {Function} deps.sameOriginGuard
 * @param {Function} [deps.resolveProfileDir] () => string
 * @param {Function} [deps.resolveRepoRoot] () => {repoRoot:string}
 * @param {string} [deps.moduleDir]
 * @returns {{handle:(req,res,url,sub)=>Promise<boolean>, paths:string[]}}
 */
export function createSettingsApi(ctx, deps = {}) {
  const sendJson = deps.sendJson
  const sendError = deps.sendError
  const readBody = deps.readBody
  const sameOriginGuard = deps.sameOriginGuard
  const resolveProfileDir = typeof deps.resolveProfileDir === 'function' ? deps.resolveProfileDir : () => ''
  const resolveRepoRoot = typeof deps.resolveRepoRoot === 'function' ? deps.resolveRepoRoot : () => ({ repoRoot: '' })
  const moduleDir = typeof deps.moduleDir === 'string' ? deps.moduleDir : ''

  /** ctx.settings 可用性判定（缺 describe 即视为不可用 → 降级） */
  const settingsOf = () => (ctx && ctx.settings && typeof ctx.settings.describe === 'function') ? ctx.settings : null

  /** describe → 归一化视图；调用方负责 catch */
  async function describeAll(settings) {
    const described = await settings.describe({ redactSecrets: true })
    return buildSettingsView(described, { writable: settings.writable !== false })
  }

  // ---- GET /settings —— 只读枚举（白名单裁剪） ----
  async function handleSettings(res) {
    const settings = settingsOf()
    if (!settings) {
      return sendJson(res, 200, {
        ok: false,
        error: 'settings-unavailable',
        namespaces: [],
        message: '设置服务不可用（ctx.settings 缺失）：能力配置页无法读写设置',
      })
    }
    try {
      const view = await describeAll(settings)
      return sendJson(res, 200, view)
    } catch (err) {
      return sendJson(res, 200, {
        ok: false, error: 'describe-failed', namespaces: [],
        message: '读取设置失败：' + sanitizeMessage(err),
      })
    }
  }

  // ---- POST /settings/write —— 写用户层（同源守卫 + dryRun 默认 true + revision 栅栏） ----
  async function handleWrite(req, res) {
    const guard = sameOriginGuard(req)
    if (guard) return sendError(res, 403, guard)

    const settings = settingsOf()
    if (!settings) {
      return sendJson(res, 200, {
        ok: false, error: 'settings-unavailable',
        message: '设置服务不可用（ctx.settings 缺失），写入被拒绝',
      })
    }
    if (typeof settings.mutate !== 'function') {
      return sendJson(res, 200, {
        ok: false, error: 'settings-readonly',
        message: '设置服务未提供 mutate（本次运行只读），写入被拒绝',
      })
    }

    let body
    try {
      body = await readBody(req)
    } catch (err) {
      return sendError(res, 400, sanitizeMessage(err))
    }

    let view
    try {
      view = await describeAll(settings)
    } catch (err) {
      return sendJson(res, 200, {
        ok: false, error: 'describe-failed',
        message: '读取设置失败：' + sanitizeMessage(err),
      })
    }

    const check = validateWriteRequest(body, view)
    if (!check.ok) {
      return sendJson(res, check.status, {
        ok: false, error: check.error, ns: typeof body.ns === 'string' ? safeKey(body.ns) : '', message: check.message,
      })
    }

    const current = view.namespaces.filter((n) => n.ns === check.ns)[0] || null

    if (check.dryRun) {
      return sendJson(res, 200, {
        ok: true, dryRun: true, ns: check.ns, ops: check.ops,
        revision: current ? current.revision : 0,
        value: current ? current.value : {},
        user: current ? current.user : {},
        message: 'dry-run：未写盘（带 dryRun:false 才写入用户层）',
      })
    }

    try {
      // mutate 的 resolve 值不携带新 revision/value（dsh-settings/lib/index.js:440-448 → :463-478）
      await settings.mutate(check.ns, check.ops, check.revision)
    } catch (err) {
      if (err && err.code === 'SETTINGS_CONFLICT') {
        return sendJson(res, 409, {
          ok: false, error: 'conflict',
          expected: Number.isInteger(err.expected) ? err.expected : null,
          actual: Number.isInteger(err.actual) ? err.actual : null,
        })
      }
      return sendJson(res, 400, {
        ok: false, error: 'write-failed', ns: check.ns,
        message: '写入失败：' + sanitizeMessage(err),
      })
    }

    // 写成功 → 重新 describe 回填新 revision / value / user（免重启热生效，契约 §七）
    let after = null
    try {
      const fresh = await describeAll(settings)
      after = fresh.namespaces.filter((n) => n.ns === check.ns)[0] || null
    } catch (err) {
      after = null
    }
    return sendJson(res, 200, {
      ok: true, dryRun: false, ns: check.ns, ops: check.ops,
      revision: after ? after.revision : null,
      value: after ? after.value : {},
      user: after ? after.user : {},
    })
  }

  /** 从设置里取 experts ns 的解析值（settings 不可用时退回兜底常量） */
  async function readExpertsConfig() {
    const cfg = { ...EXPERTS_CONFIG_FALLBACK }
    const settings = settingsOf()
    if (!settings) return cfg
    try {
      const view = await describeAll(settings)
      const ns = view.namespaces.filter((n) => n.ns === 'experts')[0]
      const value = (ns && ns.value && typeof ns.value === 'object' && !Array.isArray(ns.value)) ? ns.value : {}
      return { ...cfg, ...value }
    } catch (err) {
      return cfg
    }
  }

  // ---- GET /experts/preview?text=... —— 打分实时预览（只读） ----
  async function handlePreview(url, res) {
    const raw = String(url.searchParams.get('text') || '')
    const text = raw.slice(0, PREVIEW_TEXT_LIMIT)
    const truncated = raw.length > PREVIEW_TEXT_LIMIT

    const repo = resolveRepoRoot() || {}
    const loaded = await loadExpertsModules({
      profileDir: resolveProfileDir(),
      repoRoot: typeof repo.repoRoot === 'string' ? repo.repoRoot : '',
      moduleDir: moduleDir,
    })
    if (!loaded.ok) {
      return sendJson(res, 200, {
        ok: false, unavailable: true,
        message: '专家库（dsh-experts）未安装或无法加载，打分预览不可用；安装该子插件后重试',
        text: text, truncated: truncated,
      })
    }

    const cfg = await readExpertsConfig()

    let entries = []
    let identityId = ''
    try {
      const store = loaded.store
      entries = typeof store.activeExperts === 'function'
        ? store.activeExperts(cfg)
        : (typeof store.allExperts === 'function' ? store.allExperts() : [])
      const identity = typeof store.identityExpertOf === 'function' ? store.identityExpertOf(cfg) : null
      identityId = identity ? String(identity.id || '') : ''
    } catch (err) {
      return sendJson(res, 200, {
        ok: false, unavailable: true,
        message: '专家索引读取失败：' + sanitizeMessage(err),
        text: text, truncated: truncated,
      })
    }

    try {
      const result = loaded.match.selectExperts(entries, {
        text: text,
        defaultDomain: String(cfg.defaultDomain || ''),
        branchDomain: null,
        explicitId: null,
        identityId: identityId,
      }, cfg)
      const ranked = (result.ranked || []).map((r) => ({
        id: (r.entry && r.entry.id) || '',
        domain: (r.entry && r.entry.domain) || '',
        score: r.score,
        evidence: r.evidence,
        reasons: Array.isArray(r.reasons) ? r.reasons : [],
      }))
      const selected = (result.selected || []).map((r) => (r.entry && r.entry.id) || '').filter(Boolean)
      return sendJson(res, 200, {
        ok: true,
        reason: result.reason || '',
        ranked: ranked,
        selected: selected,
        config: {
          expertInjectMax: cfg.expertInjectMax,
          expertSecondThreshold: cfg.expertSecondThreshold,
          expertMinScore: cfg.expertMinScore,
        },
        source: loaded.source,
        text: text,
        truncated: truncated,
      })
    } catch (err) {
      return sendJson(res, 200, {
        ok: false, unavailable: true,
        message: '专家打分失败：' + sanitizeMessage(err),
        text: text, truncated: truncated,
      })
    }
  }

  /**
   * 分发 P4 三条路由。
   * @returns {Promise<boolean>} true = 已处理（无论成败）；false = 不匹配，交回调用方
   */
  async function handle(req, res, url, sub) {
    if (typeof sendJson !== 'function' || typeof sendError !== 'function'
      || typeof readBody !== 'function' || typeof sameOriginGuard !== 'function') {
      return false
    }
    try {
      const path = String(sub || '')
      if (req.method === 'GET' && (path === '/settings' || path === '/settings/')) {
        await handleSettings(res)
        return true
      }
      if (req.method === 'POST' && (path === '/settings/write' || path === '/settings/write/')) {
        await handleWrite(req, res)
        return true
      }
      if (req.method === 'GET' && (path === '/experts/preview' || path === '/experts/preview/')) {
        await handlePreview(url, res)
        return true
      }
      return false
    } catch (err) {
      // 兜底：任何未预期异常都降级为可读错误，绝不让路由 500 崩溃（契约 §七）
      try {
        sendJson(res, 200, { ok: false, error: 'internal', message: '内部错误：' + sanitizeMessage(err) })
      } catch (e) { /* best-effort */ }
      return true
    }
  }

  return { handle: handle, paths: SETTINGS_API_PATHS }
}
