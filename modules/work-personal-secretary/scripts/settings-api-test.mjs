/**
 * work-personal-secretary —— 能力配置页宿主侧自测（P4：读写子插件设置 + 专家打分预览）
 *
 * 用法：node scripts/settings-api-test.mjs
 *
 * 覆盖（契约《17_P4 能力配置页（读写子插件设置）接口契约与安全边界》§四 / §五 / §七 host 侧可测项）：
 *   [1] 契约形状：三条路由 / ns 白名单 / 既有 8 条 API_PATHS 未被破坏
 *   [2] fields 归一化：schemastery {uid,refs} 与内联两种形态 → 顶层标量直出、复杂类型 complex 降级只读
 *   [3] 白名单裁剪：describe 里的非白名单 ns 一律不出现；未注册 ns 出占位（installed:false）
 *   [4] validateWriteRequest：非白名单 ns / 未声明 path / 嵌套 path / 复杂类型键 / 非法 op / 空 ops / 超条数 全被拒
 *   [5] POST /settings/write：**dryRun 默认 true 不写盘**；dryRun:false 才调 mutate，参数与写后重读正确
 *   [6] 冲突映射：SETTINGS_CONFLICT → HTTP 409 { expected, actual }
 *   [7] 同源守卫：跨站 / 缺 Content-Type / 缺 Origin → 403，且不产生任何写入
 *   [8] 降级不崩：ctx.settings 缺失 / describe 抛错 / mutate 失败 / 子插件未装 → 可读错误，绝不抛
 *   [9] GET /experts/preview：真实子插件打分（契约 §六.1 三级等保用例 + max=1↔2 因果对照）
 *  [10] 预览文本上限 2000：超长截断并标记 truncated
 *  [11] 路由注册口径：installApi 的 exact 数不变（既有测试不破），P4 精确路由独立补注册
 *  [12] 真实子插件 schema 键数静态核对（work-memory 24 / experts 16）+ 默认值 1→2 与注入分级落点
 *  [13] 真实环境只读快照首尾比对（证明本次开发未写入真实设置文件 / 工作区 / 子插件源码）
 *
 * 隔离红线（本测试的全部保证）：
 *   - 所有候选路径（profile / 仓库 / 模块）都指向 os.tmpdir() 下自建的**夹具**；
 *   - 夹具内允许真写真验（假仓库 / 假 profile 目录），写前用 assertInsideTmp() 复核仍在临时根内；
 *   - 真实 settings.yaml / 工作区 / 子插件源码只做 statSync / readdirSync **只读快照**首尾比对，绝不写入；
 *   - 预览用例与 [12] 刻度检查动态 import 真实 dsh-experts 的 match.js / store.js / limits.js —— 只读，不产生任何写入。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'

import { API_PATHS, API_ROOT, installApi, installSettingsExactRoutes } from '../lib/api.js'
import {
  MAX_WRITE_OPS,
  PREVIEW_TEXT_LIMIT,
  SETTINGS_API_PATHS,
  SETTINGS_NS_WHITELIST,
  buildSettingsView,
  normalizeSchemaFields,
  sanitizeMessage,
  validateWriteRequest,
} from '../lib/settings-api.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')
const MODULES_DIR = join(MODULE_DIR, '..')

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  OK   ' + label) }
  else { fail++; console.log('  FAIL ' + label) }
}
function section(title) { console.log('\n' + title) }

// ───────────────────── 隔离护栏 ─────────────────────

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'wps-settings-api-test-'))

function assertInsideTmp(p, where) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()
  const root = TMP_ROOT.replace(/\\/g, '/').toLowerCase()
  if (s.indexOf(root) !== 0) throw new Error('隔离护栏拦截：' + (where || 'path') + ' 不在临时目录内：' + p)
}
function writeTmp(file, text) {
  assertInsideTmp(file, 'writeTmp')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(text, 'utf8'))
}
function statSnap(file) {
  try { const st = statSync(file); return { size: st.size, mtimeMs: st.mtimeMs, isDir: st.isDirectory() } } catch (e) { return null }
}
function sameSnap(a, b) {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.isDir === b.isDir
}
function listNames(dir) {
  try { return readdirSync(dir).sort().join(',') } catch (e) { return null }
}

// ───────────────────── 夹具：假仓库 / 假 profile（隔离「子插件未装」用例） ─────────────────────

const FAKE_REPO = join(TMP_ROOT, 'fake-repo')
const FAKE_MODULE = join(FAKE_REPO, 'modules', 'work-personal-secretary')
const FAKE_PROFILE = join(TMP_ROOT, 'fake-profile')
writeTmp(join(FAKE_MODULE, 'package.json'), JSON.stringify({ name: 'work-personal-secretary', version: '0.0.0' }, null, 2) + '\n')
assertInsideTmp(FAKE_REPO, 'fakeRepo')

/** 未装 dsh-experts 的探测参数（三个候选全部落空 → 预览应降级） */
const DEPS_EXPERTS_MISSING = {
  platform: 'win32',
  repoRoot: FAKE_REPO,
  moduleDir: FAKE_MODULE,
  profileDir: FAKE_PROFILE,
  env: {},
  commonCandidates: [],
}

// ───────────────────── 夹具：mock settings 服务（模拟官方 describe/mutate 契约） ─────────────────────

/** work-memory 的 schema 摘要（形态照 schemastery toJSON：{ uid, refs }，见 schemastery/src/index.ts:296-307） */
const WM_SCHEMA = {
  uid: 1,
  refs: {
    1: {
      type: 'object',
      meta: {},
      dict: {
        personaLabel: 2,
        injectMemory: 3,
        snapshotMaxChars: 4,
        snapshotLimitGlobal: 5,
        advanced: 6, // 复杂类型（dict）→ 应降级只读
      },
    },
    2: { type: 'string', meta: { default: '记忆', description: '注入快照的标题词' } },
    3: { type: 'boolean', meta: { default: true, description: '每轮注入记忆快照' } },
    4: { type: 'number', meta: { default: 4000, description: '注入快照的字符上限' } },
    5: { type: 'number', meta: { default: 20, description: '' } },
    6: { type: 'dict', meta: {}, inner: 7 },
    7: { type: 'string', meta: { default: '' } },
  },
}

/** experts 的 schema 摘要（口径对齐 dsh-experts 0.3.2：defaultDomain 域重划 presales→infosec，expertMinScore 已移除） */
const EXP_SCHEMA = {
  uid: 10,
  refs: {
    10: {
      type: 'object',
      meta: {},
      dict: {
        expertsEnabled: 11,
        defaultDomain: 12,
        identityExpert: 13,
        expertInjectMax: 14,
        expertInjectDetail: 17,
        expertInjectBudgetChars: 18,
        expertSecondThreshold: 15,
      },
    },
    11: { type: 'boolean', meta: { default: true, description: '专家库总开关' } },
    12: { type: 'string', meta: { default: 'infosec', description: '本人岗位默认域' } },
    13: { type: 'string', meta: { default: '', description: '常驻身份专家 id' } },
    14: { type: 'number', meta: { default: 2, description: '每轮最多注入几位专家' } },
    15: { type: 'number', meta: { default: 0.8, description: '' } },
    17: { type: 'string', meta: { default: 'auto', description: '注入形态：auto / card / full' } },
    18: { type: 'number', meta: { default: 2000, description: '每轮注入字符预算' } },
  },
}

/** 白名单外的 ns（必须被裁掉） */
const OTHER_SCHEMA = {
  uid: 20,
  refs: { 20: { type: 'object', meta: {}, dict: { theme: 21 } }, 21: { type: 'string', meta: { default: 'dark' } } },
}

function makeMockSettings(options = {}) {
  const state = {
    describeCalls: 0,
    mutateCalls: [],
    failDescribe: options.failDescribe === true,
    failMutate: options.failMutate || null,
    revision: { 'work-memory': 12, experts: 5 },
    user: { 'work-memory': { personaLabel: '记忆' }, experts: {} },
    value: {
      'work-memory': {
        personaLabel: '记忆', injectMemory: true, snapshotMaxChars: 4000, snapshotLimitGlobal: 20, advanced: {},
      },
      experts: Object.assign({
        expertsEnabled: true,
        defaultDomain: 'infosec',
        identityExpert: '',
        expertInjectMax: 2,
        expertInjectDetail: 'auto',
        expertInjectBudgetChars: 2000,
        expertSecondThreshold: 0.8,
      }, options.expertsValue || {}),
    },
  }
  const settings = {
    writable: options.writable === false ? false : true,
    describe(opts) {
      state.describeCalls += 1
      if (state.failDescribe) throw new Error('boom at C:\\Users\\secret\\settings.yaml')
      return [
        { ns: 'work-memory', schema: WM_SCHEMA, value: state.value['work-memory'], revision: state.revision['work-memory'], user: state.user['work-memory'], applies: 'live' },
        { ns: 'experts', schema: EXP_SCHEMA, value: state.value.experts, revision: state.revision.experts, user: state.user.experts, applies: 'live' },
        { ns: 'workspace-tokenpet', schema: OTHER_SCHEMA, value: { theme: 'dark' }, revision: 1, applies: 'restart' },
      ]
    },
    async mutate(ns, ops, rev) {
      state.mutateCalls.push({ ns: ns, ops: ops, rev: rev })
      if (state.failMutate) throw state.failMutate
      state.revision[ns] = (state.revision[ns] || 0) + 1
      for (const op of ops) {
        if (op.op === 'set') state.user[ns][op.path[0]] = op.value
        else delete state.user[ns][op.path[0]]
      }
    },
  }
  return { settings: settings, state: state }
}

// ───────────────────── HTTP 夹具 ─────────────────────

function makeMockCtx(settings) {
  const routes = []
  return {
    routes: routes,
    settings: settings,
    logger: { debug() {}, warn() {}, info() {} },
    webServer: { register(o) { routes.push(o); return () => {} } },
  }
}
function makeReq(o) {
  const raw = o.body === undefined || o.body === null ? null : Buffer.from(JSON.stringify(o.body), 'utf8')
  return {
    method: o.method || 'GET',
    url: o.url || '/',
    headers: o.headers || {},
    async *[Symbol.asyncIterator]() { if (raw) yield raw },
  }
}
function makeRes() {
  return {
    status: 0, headers: null, body: '',
    writeHead(s, h) { this.status = s; this.headers = h || null },
    end(t) { this.body = t || '' },
  }
}

const REQ_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }
const CROSS_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://evil.example' }
const NO_CT_HEADERS = { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }
const NO_ORIGIN_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120' }

function prefixHandlerOf(ctx) {
  return (ctx.routes.filter((x) => x.kind === 'prefix')[0] || {}).handler
}
function exactHandlerOf(ctx, p) {
  const hit = ctx.routes.filter((x) => x.kind === 'exact' && x.path === API_ROOT + p)[0]
  return hit ? hit.handler : null
}
async function callOn(handler, method, sub, body, headers) {
  const res = makeRes()
  await handler(makeReq({ method: method, url: API_ROOT + sub, body: body, headers: headers }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json, raw: res.body }
}
/** 用某个 ctx 的 prefix handler 发请求（浏览器载体） */
function callPrefix(ctx, method, sub, body, headers) {
  return callOn(prefixHandlerOf(ctx), method, sub, body, headers)
}
/** 用精确路由 handler 发请求（桌面载体） */
function callExact(ctx, p, method, body, headers) {
  return callOn(exactHandlerOf(ctx, p), method, p, body, headers)
}

// ───────────────────── 真实环境只读快照（首） ─────────────────────

const REAL_DSH_HOME = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
function discoverRealWorkspace() {
  const explicit = String(process.env.WPS_TEST_REAL_WORKSPACE || '').trim()
  if (explicit) return explicit
  let cursor = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cursor, 'AGENTS.md'))) return cursor
    const up = dirname(cursor)
    if (!up || up === cursor) break
    cursor = up
  }
  return ''
}
const REAL_WS = discoverRealWorkspace()

const REAL_TARGETS = [
  { label: '真实 settings.yaml', kind: 'file', path: join(REAL_DSH_HOME, 'settings.yaml') },
  { label: '真实记忆库根目录清单', kind: 'dirList', path: join(REAL_DSH_HOME, 'memories') },
  { label: '真实工作区 AGENTS.md', kind: 'file', path: REAL_WS ? join(REAL_WS, 'AGENTS.md') : '' },
  { label: '真实工作区根目录清单', kind: 'dirList', path: REAL_WS || '' },
  { label: '真实本体 lib 清单', kind: 'dirList', path: join(MODULE_DIR, 'lib') },
  { label: '真实子插件 experts/lib 清单', kind: 'dirList', path: join(MODULES_DIR, 'dsh-experts', 'lib') },
  { label: '真实子插件 work-memory/lib 清单', kind: 'dirList', path: join(MODULES_DIR, 'dsh-work-memory', 'lib') },
]
function readRealTarget(t) {
  if (!t.path) return null
  return t.kind === 'file' ? statSnap(t.path) : listNames(t.path)
}
const REAL_BEFORE = REAL_TARGETS.map((t) => ({ t: t, v: readRealTarget(t) }))

// ═══════════════════════════ 主流程 ═══════════════════════════

section('[1] 契约形状')
ok(SETTINGS_API_PATHS.join(',') === '/settings,/settings/write,/experts/preview', 'P4 三条路由与契约 §4 一致')
ok(SETTINGS_NS_WHITELIST.join(',') === 'work-memory,experts', 'ns 白名单硬编码为 work-memory / experts（契约 §5.1）')
ok(PREVIEW_TEXT_LIMIT === 2000, '预览文本上限 2000 字符（契约 §4.3）')
ok(API_PATHS.join(',') === '/check,/fix,/fix-all,/plugins,/install,/install-all,/basedeck', '既有 8 条 API_PATHS 一字未动')

section('[2] fields 归一化：顶层标量直出 / 复杂类型 complex 降级只读')
const wmFields = normalizeSchemaFields(WM_SCHEMA)
const fieldOf = (list, k) => list.filter((f) => f.key === k)[0]
ok(wmFields.length === 5, 'uid+refs 形态解析出 5 个顶层键')
ok(fieldOf(wmFields, 'snapshotMaxChars').type === 'number' && fieldOf(wmFields, 'snapshotMaxChars').default === 4000,
  'number 标量直出 type + default')
ok(fieldOf(wmFields, 'injectMemory').type === 'boolean' && fieldOf(wmFields, 'injectMemory').default === true, 'boolean 标量直出')
ok(fieldOf(wmFields, 'personaLabel').type === 'string' && fieldOf(wmFields, 'personaLabel').description === '注入快照的标题词',
  'string 标量直出且 description 透出')
ok(fieldOf(wmFields, 'advanced').type === 'complex' && fieldOf(wmFields, 'advanced').writable === false,
  'dict 复杂类型 → type:"complex" 且 writable:false（降级只读）')
ok(fieldOf(wmFields, 'advanced').default === null, '复杂类型不回传 default（避免误当可写值）')
ok(wmFields.every((f) => typeof f.key === 'string' && typeof f.type === 'string'
  && typeof f.override === 'boolean' && typeof f.writable === 'boolean' && typeof f.description === 'string'),
  'fields 五字段类型齐全（key/type/default/override/writable/description）')

const inlineSchema = {
  type: 'object',
  meta: {},
  dict: {
    a: { type: 'string', meta: { default: 'x', description: 'A' } },
    b: { type: 'array', meta: {} },
  },
}
const inlineFields = normalizeSchemaFields(inlineSchema)
ok(inlineFields.length === 2 && fieldOf(inlineFields, 'a').default === 'x' && fieldOf(inlineFields, 'b').type === 'complex',
  '内联 type+meta+dict 形态同样兼容')
ok(normalizeSchemaFields(null).length === 0 && normalizeSchemaFields({}).length === 0, 'schema 不可解析 → 空字段表（调用方降级，不抛）')

section('[3] 白名单裁剪 + 未注册 ns 占位')
const mock = makeMockSettings()
const view = buildSettingsView(mock.settings.describe({ redactSecrets: true }), { writable: true })
ok(view.ok === true && view.namespaces.length === 2, '只保留白名单两个 ns')
ok(view.namespaces.map((n) => n.ns).join(',') === 'work-memory,experts', '顺序按白名单（页面分组稳定）')
ok(JSON.stringify(view).indexOf('workspace-tokenpet') < 0, 'describe 里的非白名单 ns（workspace-tokenpet）不出现在响应里')
ok(view.namespaces[0].title === '记忆库' && view.namespaces[1].title === '专家库', 'ns 标题按契约 §3')
ok(view.namespaces[0].revision === 12 && view.namespaces[1].revision === 5, 'revision 透出')
ok(view.namespaces[0].applies === 'live', 'applies 透出')
ok(fieldOf(view.namespaces[0].fields, 'personaLabel').override === true, '用户层有该键 → override=true（页面标「已覆盖」）')
ok(fieldOf(view.namespaces[0].fields, 'injectMemory').override === false, '用户层没有该键 → override=false')
ok(view.namespaces[0].value.snapshotMaxChars === 4000 && view.namespaces[0].user.personaLabel === '记忆', 'value / user 原样透出')
ok(view.namespaces[0].installed === true, '已注册 ns 标 installed:true')

const partial = buildSettingsView([
  { ns: 'work-memory', schema: WM_SCHEMA, value: {}, revision: 3, applies: 'live' },
], { writable: true })
ok(partial.namespaces.length === 2 && partial.namespaces[1].ns === 'experts', '未注册 ns 仍占位（页面不出现空分组）')
ok(partial.namespaces[1].installed === false && partial.namespaces[1].writable === false && partial.namespaces[1].fields.length === 0,
  '未注册 ns → installed:false / writable:false / fields 空（可读降级，不崩）')

section('[4] validateWriteRequest：ns 白名单 + path 白名单 + 默认 dry-run')
const V = view
const good = { ns: 'work-memory', ops: [{ op: 'set', path: ['snapshotMaxChars'], value: 6000 }] }
ok(validateWriteRequest(good, V).ok === true, '白名单 ns + 已声明 path → 通过')
ok(validateWriteRequest(good, V).dryRun === true, '未传 dryRun → dryRun=true（契约 §5.4）')
ok(validateWriteRequest(Object.assign({}, good, { dryRun: false }), V).dryRun === false, 'dryRun:false 透传')
ok(validateWriteRequest(Object.assign({}, good, { ns: 'workspace-tokenpet' }), V).error === 'ns-not-allowed', '非白名单 ns 被拒（契约 §5.1）')
ok(validateWriteRequest(Object.assign({}, good, { ns: 'dsh-doc-suite' }), V).error === 'ns-not-allowed', '任意 ns 一律被拒')
ok(validateWriteRequest({ ns: 'experts', ops: [{ op: 'set', path: ['expertInjectMax'], value: 2 }] }, V).ok === true,
  '白名单里的另一个 ns 允许（path 白名单按该 ns schema 各自判定）')
ok(validateWriteRequest({ ns: 'experts', ops: [{ op: 'set', path: ['snapshotMaxChars'], value: 1 }] }, V).error === 'path-not-allowed',
  'path 白名单是**按 ns 隔离**的：work-memory 的键不能写进 experts')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'set', path: ['nope'], value: 1 }] }, V).error === 'path-not-allowed',
  '未声明键被拒（契约 §5.2）')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'set', path: ['advanced', 'x'], value: 1 }] }, V).error === 'invalid-path',
  '嵌套路径被拒（契约 §5.2：只允许顶层键）')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'set', path: ['advanced'], value: 1 }] }, V).error === 'path-not-allowed',
  '复杂类型键已降级只读 → 写入被拒')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'set', path: [], value: 1 }] }, V).error === 'invalid-path', '空 path 被拒')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'delete', path: ['personaLabel'] }] }, V).error === 'invalid-op',
  '只接受 set / unset（契约 §4.2）')
ok(validateWriteRequest({ ns: 'work-memory', ops: [] }, V).error === 'invalid-ops', '空 ops 被拒')
ok(validateWriteRequest({ ns: 'work-memory' }, V).error === 'invalid-ops', '缺 ops 被拒')
ok(validateWriteRequest({ ns: 'work-memory', ops: new Array(MAX_WRITE_OPS + 1).fill({ op: 'unset', path: ['personaLabel'] }) }, V).error === 'too-many-ops',
  '超单次条数上限被拒')
const unsetGood = validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'unset', path: ['personaLabel'] }] }, V)
ok(unsetGood.ok === true && unsetGood.ops[0].op === 'unset' && unsetGood.ops[0].path[0] === 'personaLabel',
  'unset 通过（清除覆盖回默认，契约 §5.3）')
ok(validateWriteRequest(Object.assign({}, good, { revision: 12 }), V).revision === 12, 'revision 透传（冲突栅栏用）')
ok(validateWriteRequest(good, V).revision === undefined, '不带 revision → undefined（官方语义：不检查冲突）')
ok(validateWriteRequest({ ns: 'work-memory', ops: [{ op: 'set', path: ['snapshotMaxChars'], value: 1 }] }, [
  { ns: 'work-memory', installed: false, fields: [] }, { ns: 'experts', installed: true, fields: [] },
]).error === 'ns-unavailable', 'ns 未注册 → 写请求被拒（子插件未装时降级）')

section('[5] POST /settings/write：dryRun 默认不写盘 / dryRun:false 才写')
const ctx1 = makeMockCtx(mock.settings)
installApi(ctx1, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
const wDry = await callPrefix(ctx1, 'POST', '/settings/write', good, REQ_HEADERS)
ok(wDry.status === 200 && wDry.body.ok === true && wDry.body.dryRun === true, 'POST 未传 dryRun → 200 + dryRun:true')
ok(mock.state.mutateCalls.length === 0, 'dry-run 下 mutate 一次都没被调用（确实没写盘）')
ok(wDry.body.revision === 12 && wDry.body.value.snapshotMaxChars === 4000, 'dry-run 回填当前 revision / value')
ok(mock.state.revision['work-memory'] === 12, 'dry-run 后 revision 未推进')

const wWrite = await callPrefix(ctx1, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false, revision: 12 }), REQ_HEADERS)
ok(wWrite.status === 200 && wWrite.body.ok === true && wWrite.body.dryRun === false, 'dryRun:false → 真写成功')
ok(mock.state.mutateCalls.length === 1, 'mutate 恰好被调用 1 次')
ok(mock.state.mutateCalls[0].ns === 'work-memory' && mock.state.mutateCalls[0].rev === 12, 'mutate(ns, ops, revision) 参数正确')
ok(JSON.stringify(mock.state.mutateCalls[0].ops) === JSON.stringify([{ op: 'set', path: ['snapshotMaxChars'], value: 6000 }]),
  'ops 原样透给官方 mutate（set 顶层键）')
ok(wWrite.body.revision === 13, '写后重读 describe 回填新 revision（13）')
ok(wWrite.body.user.snapshotMaxChars === 6000, '写后 user 层能看到新值（免重启热生效的口径）')

const wUnset = await callPrefix(ctx1, 'POST', '/settings/write', { ns: 'work-memory', dryRun: false, ops: [{ op: 'unset', path: ['personaLabel'] }] }, REQ_HEADERS)
ok(wUnset.body.ok === true && mock.state.mutateCalls[1].ops[0].op === 'unset', 'unset 走同一 mutate 通道')

const wBad = await callPrefix(ctx1, 'POST', '/settings/write', { ns: 'workspace-tokenpet', dryRun: false, ops: [{ op: 'set', path: ['theme'], value: 'light' }] }, REQ_HEADERS)
ok(wBad.status === 400 && wBad.body.ok === false && wBad.body.error === 'ns-not-allowed', '非白名单 ns → 400 + 机器码')
ok(mock.state.mutateCalls.length === 2, '被拒的请求没有触发 mutate')

const wBadPath = await callPrefix(ctx1, 'POST', '/settings/write', { ns: 'experts', dryRun: false, ops: [{ op: 'set', path: ['notDeclared'], value: 1 }] }, REQ_HEADERS)
ok(wBadPath.status === 400 && wBadPath.body.error === 'path-not-allowed', '未声明 path → 400 + 机器码')
ok(mock.state.mutateCalls.length === 2, '未声明 path 没有触发 mutate')

section('[6] 冲突映射：SETTINGS_CONFLICT → HTTP 409')
const conflictErr = Object.assign(new Error('settings namespace "work-memory" changed since it was read (expected revision 12, now 13)'), {
  code: 'SETTINGS_CONFLICT', expected: 12, actual: 13,
})
const conflictMock = makeMockSettings({ failMutate: conflictErr })
const ctxC = makeMockCtx(conflictMock.settings)
installApi(ctxC, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
const wConflict = await callPrefix(ctxC, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false, revision: 12 }), REQ_HEADERS)
ok(wConflict.status === 409, '旧 revision 写入 → HTTP 409（契约 §4.2）')
ok(wConflict.body.ok === false && wConflict.body.error === 'conflict', '响应体 ok:false + error:"conflict"')
ok(wConflict.body.expected === 12 && wConflict.body.actual === 13, '响应带 expected / actual')
ok(conflictMock.state.revision['work-memory'] === 12, '冲突后原值未被破坏（页面重读不丢原值）')

const plainFail = makeMockSettings({ failMutate: new Error('validation failed at C:\\Users\\secret\\x.yaml') })
const ctxP = makeMockCtx(plainFail.settings)
installApi(ctxP, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
const wPlain = await callPrefix(ctxP, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false }), REQ_HEADERS)
ok(wPlain.status === 400 && wPlain.body.error === 'write-failed', '普通写入失败 → 400 write-failed（不是 500）')
ok(String(wPlain.body.message).indexOf('<path>') > 0 && String(wPlain.body.message).indexOf('secret') < 0,
  '失败信息脱敏：本机路径被抹成 <path>（契约 §5.8）')

section('[7] 同源守卫：跨站 / 缺 Content-Type / 缺 Origin → 403')
const beforeCross = mock.state.mutateCalls.length
const wCross = await callPrefix(ctx1, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false }), CROSS_HEADERS)
ok(wCross.status === 403, '跨站 Origin → 403（契约 §5.5）')
const wNoCt = await callPrefix(ctx1, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false }), NO_CT_HEADERS)
ok(wNoCt.status === 403, '缺 application/json → 403')
const wNoOrigin = await callPrefix(ctx1, 'POST', '/settings/write', Object.assign({}, good, { dryRun: false }), NO_ORIGIN_HEADERS)
ok(wNoOrigin.status === 403, '缺 Origin 头 → 403')
ok(mock.state.mutateCalls.length === beforeCross, '被拦下的写请求没有产生任何写入')

section('[8] 降级不崩：settings 缺失 / describe 抛错 / 子插件未装')
const ctxNo = makeMockCtx(null)
installApi(ctxNo, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
const gNo = await callPrefix(ctxNo, 'GET', '/settings')
ok(gNo.status === 200 && gNo.body.ok === false && gNo.body.error === 'settings-unavailable' && Array.isArray(gNo.body.namespaces),
  'ctx.settings 缺失 → 200 + 可读错误 + 空 namespaces（不抛）')
const wNo = await callPrefix(ctxNo, 'POST', '/settings/write', good, REQ_HEADERS)
ok(wNo.status === 200 && wNo.body.ok === false && wNo.body.error === 'settings-unavailable', '写路径同样降级为可读错误')

const badDescribe = makeMockSettings({ failDescribe: true })
const ctxBD = makeMockCtx(badDescribe.settings)
installApi(ctxBD, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
const gBadD = await callPrefix(ctxBD, 'GET', '/settings')
ok(gBadD.status === 200 && gBadD.body.error === 'describe-failed', 'describe 抛错 → 200 + describe-failed')
ok(String(gBadD.body.message).indexOf('<path>') > 0 && String(gBadD.body.message).indexOf('secret') < 0, 'describe 错误信息同样脱敏')

const ctxNoExp = makeMockCtx(makeMockSettings().settings)
installApi(ctxNoExp, DEPS_EXPERTS_MISSING)
const pNoExp = await callPrefix(ctxNoExp, 'GET', '/experts/preview?text=' + encodeURIComponent('三级等保'))
ok(pNoExp.status === 200 && pNoExp.body.ok === false && pNoExp.body.unavailable === true,
  '子插件未装 → 200 + { ok:false, unavailable:true }（契约 §4.3，不抛不崩）')
ok(typeof pNoExp.body.message === 'string' && pNoExp.body.text === '三级等保', '降级响应带可读提示与回显文本')
ok(JSON.stringify(pNoExp.body).indexOf(TMP_ROOT.replace(/\\/g, '/')) < 0, '降级响应不含夹具私有路径（契约 §5.8）')

const weird = await callPrefix(ctx1, 'POST', '/settings/write', null, REQ_HEADERS)
ok(weird.status === 400 && weird.body.ok === false && weird.body.error === 'ns-not-allowed', '空 body → 可读错误（不抛）')
const notFound = await callPrefix(ctx1, 'GET', '/settings/nope')
ok(notFound.status === 404, '未知子路径交回既有 404 逻辑（不吞掉）')

section('[9] GET /experts/preview：真实子插件打分（契约 §六.1 三级等保用例，口径对齐 dsh-experts 0.3.2）')
const ID_TEXT = '客户要做三级等保测评，定级备案怎么走'
const PREVIEW_DEPS = { platform: 'win32', repoRoot: '', moduleDir: MODULE_DIR, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] }
const expMax2 = makeMockSettings({ expertsValue: { expertInjectMax: 2, identityExpert: 'infosec-ics-security' } })
const ctxExp2 = makeMockCtx(expMax2.settings)
installApi(ctxExp2, PREVIEW_DEPS)
const prev2 = await callPrefix(ctxExp2, 'GET', '/experts/preview?text=' + encodeURIComponent(ID_TEXT))
ok(prev2.status === 200 && prev2.body.ok === true, '真实子插件打分可用（动态 import match.js）')
ok(prev2.body.selected.join(',') === 'infosec-ics-security,infosec-djbh',
  'max=2：身份专家 + 等保测评专家都进入注入名单（契约 §六.1 验收项；0.3.x 域重划后的 id）')
const djbh = (prev2.body.ranked || []).filter((x) => x.id === 'infosec-djbh')[0]
ok(djbh && djbh.score === 0.95 && djbh.evidence === 0.6 && djbh.domain === 'infosec',
  'infosec-djbh 得分 0.95＝岗位域 0.35 + 关键词 0.6（打分 v3 实测口径）')
ok(prev2.body.ranked.length >= 10, 'ranked 返回完整排行榜')
ok(prev2.body.ranked.every((x) => typeof x.id === 'string' && typeof x.domain === 'string'
  && typeof x.score === 'number' && typeof x.evidence === 'number' && Array.isArray(x.reasons)),
  'ranked 五字段形状符合契约 §4.3')
ok(typeof prev2.body.reason === 'string' && prev2.body.reason.indexOf('identity') === 0, 'reason 标出「身份专家 + N」')
ok(prev2.body.config.expertInjectMax === 2 && prev2.body.config.expertSecondThreshold === 0.8,
  'config 两项生效阈值从 experts ns 解析值透出（0.3.x 已无 expertMinScore）')
ok(prev2.body.source === 'repo' || prev2.body.source === 'bundled' || prev2.body.source === 'profile',
  'source 只给枚举（不外发路径）')
ok(prev2.body.text === ID_TEXT && prev2.body.truncated === false, '短文本原样回显且 truncated=false')

// 身份退场（0.3.0）：identityExpert 留空 = 不常驻身份专家；零命中专家一律不进注入名单
const expNoId = makeMockSettings()
const ctxNoId = makeMockCtx(expNoId.settings)
installApi(ctxNoId, PREVIEW_DEPS)
const prevNoId = await callPrefix(ctxNoId, 'GET', '/experts/preview?text=' + encodeURIComponent(ID_TEXT))
ok(prevNoId.body.selected.join(',') === 'infosec-djbh' && prevNoId.body.reason === 'top1',
  '身份留空 → 仅注入关键词命中的 infosec-djbh（0.3.x 身份退场 + 零命中不注入）')

const expMax1 = makeMockSettings({ expertsValue: { expertInjectMax: 1, identityExpert: 'infosec-ics-security' } })
const ctxExp1 = makeMockCtx(expMax1.settings)
installApi(ctxExp1, PREVIEW_DEPS)
const prev1 = await callPrefix(ctxExp1, 'GET', '/experts/preview?text=' + encodeURIComponent(ID_TEXT))
ok(prev1.body.selected.join(',') === 'infosec-ics-security',
  'max=1：身份专家独占唯一名额，命中专家被挤掉（契约 §六.1 的因果归因）')

const prevEmpty = await callPrefix(ctxExp2, 'GET', '/experts/preview')
ok(prevEmpty.status === 200 && prevEmpty.body.ok === true && prevEmpty.body.text === '', '空 text 也能预览（不报错）')

section('[10] 预览文本上限 2000')
const longText = '等保'.repeat(1500) // 3000 字符
const prevLong = await callPrefix(ctxExp2, 'GET', '/experts/preview?text=' + encodeURIComponent(longText))
ok(prevLong.body.truncated === true, '超长文本标 truncated:true')
ok(prevLong.body.text.length === PREVIEW_TEXT_LIMIT, '文本被截到 2000 字符（打分成本有界）')
ok(Array.isArray(prevLong.body.ranked), '截断后仍正常打分')

section('[11] 路由注册口径：installApi / apply 的 exact 数不变 + P4 精确路由（默认不接线）')
const ctxR = makeMockCtx(makeMockSettings().settings)
installApi(ctxR, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
ok(ctxR.routes.filter((x) => x.kind === 'prefix').length === 1, 'prefix 路由仍为 1 条（既有断言不破）')
ok(ctxR.routes.filter((x) => x.kind === 'exact').length === API_PATHS.length,
  'installApi 的 exact 路由数仍 = API_PATHS.length = 8（既有 basedeck-test [13] 段不破）')
const disposeExact = installSettingsExactRoutes(ctxR, { repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, profileDir: FAKE_PROFILE, env: {}, commonCandidates: [] })
ok(ctxR.routes.filter((x) => x.kind === 'exact').length === API_PATHS.length + SETTINGS_API_PATHS.length,
  '补注册后 exact = 8 + 3（桌面载体 fetch 桥可用）')
ok(SETTINGS_API_PATHS.every((p) => exactHandlerOf(ctxR, p) !== null), '三条精确路由逐条可查')
const exactGet = await callExact(ctxR, '/settings', 'GET', null, null)
ok(exactGet.status === 200 && exactGet.body && exactGet.body.ok === true && exactGet.body.namespaces.length === 2,
  '精确路由 handler 正常工作（GET /settings 走 exact 也拿到两个 ns）')
ok(typeof disposeExact === 'function', '精确路由返回 disposer（函数级已就绪，接线即可用）')

// 零回归护栏：apply 的路由总数必须与 probe-test:497 的口径一致（1 prefix + API_PATHS.length exact）
const hostModule = await import('../lib/index.js')
const ctxApply = makeMockCtx(makeMockSettings().settings)
const disposeApply = hostModule.apply(ctxApply, {})
ok(ctxApply.routes.length === API_PATHS.length + 1,
  'apply 注册总数 = API_PATHS.length + 1 = ' + (API_PATHS.length + 1) + '（既有 probe-test 断言不破）')
ok(ctxApply.routes.filter((x) => x.kind === 'exact').length === API_PATHS.length,
  'apply 未新增 exact 路由（P4 三条一律走 prefix 分发）')
ok(ctxApply.routes.filter((x) => x.kind === 'prefix').length === 1, 'apply 的 prefix 仍为 1 条')
disposeApply()

section('[12] 真实子插件 schema 键数与默认值静态核对（只读）')
function countSchemaKeys(file) {
  const text = readFileSync(file, 'utf8')
  return text.split(/\r?\n/).filter((l) => /^ {2}[A-Za-z][A-Za-z0-9]*: z\./.test(l)).length
}
const wmSettingsFile = join(MODULES_DIR, 'dsh-work-memory', 'lib', 'settings.js')
const expSettingsFile = join(MODULES_DIR, 'dsh-experts', 'lib', 'settings.js')
ok(countSchemaKeys(wmSettingsFile) === 24, 'work-memory schema 24 键（契约 §一）')
ok(countSchemaKeys(expSettingsFile) === 16, 'experts schema 16 键（0.3.x：目录段 / 纪律块 / 能力层指针四项已入 schema）')
const expSrc = readFileSync(expSettingsFile, 'utf8')
ok(/defaultDomain: 'infosec',/.test(expSrc), "DEFAULTS.defaultDomain = 'infosec'（0.3.x 域重划：presales → infosec，settings.js:46）")
ok(/identityExpert: '',/.test(expSrc), "DEFAULTS.identityExpert = ''（身份退场：留空 = 不常驻，settings.js:47）")
ok(/expertInjectMax: 2,/.test(expSrc), 'DEFAULTS.expertInjectMax = 2（契约 §六.1 甲案，settings.js:50）')
ok(/expertInjectMax: z\.natural\(\)\.default\(2\)/.test(expSrc), 'schema 默认值 = 2（settings.js:86）')
// limits.js 无外部依赖：直接动态 import 做行为刻度（比正则匹配源码更稳），边界口径 = 0 不限 / 负数回落 / 硬上限 3
const expLimits = await import(pathToFileURL(join(MODULES_DIR, 'dsh-experts', 'lib', 'limits.js')).href)
ok(expLimits.clampInjectMax(0) === 0 && expLimits.clampInjectMax(-1) === 2 && expLimits.clampInjectMax(9) === 3,
  'limits.js clampInjectMax：0=不限 / 负数回落默认 2 / 硬上限 3（0.3.x 边界；本模块不复制该逻辑）')
ok(/backupDir: null/.test(readFileSync(wmSettingsFile, 'utf8')), 'work-memory settings.js 只读兼容（未被本次改动触碰）')

section('[13] 真实环境只读快照首尾比对')
let realDrift = 0
for (const b of REAL_BEFORE) {
  const now = readRealTarget(b.t)
  const same = (typeof b.v === 'string' || b.v === null) ? b.v === now : sameSnap(b.v, now)
  if (!same) realDrift += 1
  console.log('  · ' + b.t.label + '：' + (!b.t.path ? '（无目标，跳过）' : (same ? '未变' : '发生变化 !')))
}
ok(realDrift === 0, '真实 settings.yaml / 记忆库 / 工作区 / 子插件源码 全部未被触碰')
ok(sanitizeMessage('x'.repeat(500)).length <= 301, 'sanitizeMessage 截断可用')

// ───────────────────── 收尾 ─────────────────────

console.log('\n──────── 结果 ────────')
console.log('  通过 ' + pass + ' / 失败 ' + fail)
console.log('  夹具根：' + TMP_ROOT)
console.log('  本次开发未对真实设置文件 / 工作区 / 子插件源码执行任何写入（上表逐项为只读快照比对结果）')
if (fail === 0) {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
  console.log('  夹具已清理（删除临时目录）')
}
process.exit(fail === 0 ? 0 : 1)
