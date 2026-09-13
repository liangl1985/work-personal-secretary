/**
 * work-personal-secretary —— 装载冒烟测试
 *
 * 不依赖宿主运行时：mock 浏览器 loader 与 cordis ctx，**真跑客户端半的 apply()**，
 * 验证「注册了什么」与「渲染出什么」。用法：node scripts/smoke-load.mjs
 *
 * [1]-[6] 是既有断言（注册 / 关于与致谢 / 中立性），不得削弱；
 * [7] 是「安装与检查」页新增断言：在无 location、可控 fetch 的替身环境里，
 * 验证七项骨架、四步进度、复选框与批量补齐请求（含桌面载体基址回退）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'client', 'index.js')

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}

// ── 极简 React 替身：记录元素树 + 模拟 hook 槽位 ─────────────────────
// useState 真的写回槽位（供安装页的 ready 态断言），useEffect 只登记不自动执行。
let hookSlots = []
let hookCursor = 0
let effectQueue = []
const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(init) {
    const i = hookCursor++
    if (!(i in hookSlots)) hookSlots[i] = typeof init === 'function' ? init() : init
    return [hookSlots[i], (next) => { hookSlots[i] = typeof next === 'function' ? next(hookSlots[i]) : next }]
  },
  useEffect(fn) { hookCursor++; effectQueue.push(fn) },
}

// ── mock 浏览器 loader ────────────────────────────────────────────
const src = readFileSync(CLIENT, 'utf8')
let captured = null
const win = { __ModuleLoader__: { load(mod) { captured = mod } } }
new Function('window', src)(win) // eslint-disable-line no-new-func

// ── mock cordis ctx ──────────────────────────────────────────────
const injected = []
const registered = {}
const ctx = {
  effect(fn) { return fn() },
  logger: { debug() {}, warn() {}, info() {} },
  locale: {
    register() { return () => {} },
    bind() { return (k) => k },
  },
  slots: {
    inject(slot, cb) { injected.push(slot); cb() },
    register(meta, render) { registered[meta.name] = { meta, render }; return () => {} },
  },
}

console.log('\n[1] bundle 结构')
ok(captured && captured.id === 'work-personal-secretary', 'loader 收到 id = work-personal-secretary')
ok(typeof captured.factory === 'function', 'factory 是函数')

const mod = captured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
})
console.log('\n[2] 模块导出')
ok(typeof mod.apply === 'function', 'apply 是函数')
ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), "inject 含 'slots'")

console.log('\n[3] 注册行为')
mod.apply(ctx)
ok(injected.includes('settings.section'), "注册进 'settings.section' 槽位")
const reg = registered['settings.section']
ok(Boolean(reg), "settings.section 已注册")
ok(reg && reg.meta.id === 'work-personal-secretary', "分区 id = 'work-personal-secretary'")
ok(reg && typeof reg.meta.order === 'number', 'order 是数字（决定左侧导航顺序）')
ok(reg && typeof reg.meta.label === 'function' && String(reg.meta.label()).length > 0, 'label() 返回非空导航名')

console.log('\n[4] 渲染（元素树，不做真实 DOM）')
let tree = null
try {
  tree = reg.render({})
} catch (err) {
  console.log('  渲染抛错: ' + (err && err.message))
}
ok(tree !== null && tree !== undefined, 'render() 返回元素树而非抛错')

function collect(node, out) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return out }
  if (typeof node === 'object') {
    // 函数组件：调用展开（这是替身 renderer 的最小行为，否则自定义组件的内容看不到）
    if (typeof node.type === 'function') {
      let rendered = null
      try { rendered = node.type(Object.assign({}, node.props)) } catch { rendered = null }
      collect(rendered, out)
      return out
    }
    if (node.children) for (const c of node.children) collect(c, out)
  }
  return out
}
const texts = collect(tree, [])
const joined = texts.join(' | ')

console.log('\n[5] 内容完整性（关于与致谢）')
const expectPlugins = ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'dsh-token-pet']
for (const p of expectPlugins) {
  ok(joined.includes(p), '列出子插件 ' + p)
}
ok(joined.includes('MIT'), '声明许可（MIT）')
ok(joined.includes('不联网') || joined.includes('无遥测'), '声明本地/离线/无遥测')
ok(joined.includes('未经专业复核') || joined.includes('专业复核'), '声明专家内容免责边界')
ok(joined.includes('关于与致谢') || joined.includes('About'), '分区标题可读')

console.log('\n[6] 中立性（发布件不得出现私有信息）')
const bad = ['莉娜', '主人', '天地和兴', 'E:\\', '知识库-天地', 'lina']
const hit = bad.filter((k) => src.includes(k))
ok(hit.length === 0, '客户端源码无私有信息' + (hit.length ? '（命中: ' + hit.join(', ') + '）' : ''))

// ══════════════════════════════════════════════════════════════════
// [7] 安装与检查页（P1）
// ══════════════════════════════════════════════════════════════════
console.log('\n[7] 安装与检查页')

/** 把元素树里的函数组件就地展开（之后 collect/find 都不再触发组件调用） */
function expand(node) {
  if (node === null || node === undefined) return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return expand(node.type(Object.assign({}, node.props)))
    return { type: node.type, props: node.props, children: (node.children || []).map(expand) }
  }
  return node
}
function findAll(node, predicate, out) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) { for (const n of node) findAll(n, predicate, out); return out }
  if (typeof node === 'object') {
    if (predicate(node)) out.push(node)
    for (const c of node.children || []) findAll(c, predicate, out)
  }
  return out
}
const findButtons = (n) => findAll(n, (x) => x.type === 'button', [])
const findBoxes = (n) => findAll(n, (x) => x.type === 'input' && x.props && x.props.type === 'checkbox', [])
const findLinks = (n) => findAll(n, (x) => x.type === 'a', [])
const label = (node) => collect(node, []).join('')

const CHECK_PAYLOAD = {
  ok: true,
  checkedAt: '2026-09-13T17:05:00+08:00',
  items: [
    { id: 'host', label: 'DSH 宿主', status: 'ok', value: '2.0.9 / dsh 0.1.5-rc.1', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'node', label: 'Node.js', status: 'ok', value: 'v22.14.0', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'python', label: 'Python', status: 'warn', value: '3.10.0', detail: '低于 3.12', fixKind: 'winget', fixCommand: 'winget install --id Python.Python.3.12', autoFixable: true },
    { id: 'pythonDeps', label: 'Python 依赖', status: 'warn', value: '缺 2 个', detail: '缺少 python-docx, pdfplumber', fixKind: 'pip', fixCommand: 'py -3 -m pip install python-docx openpyxl python-pptx PyMuPDF pdfplumber pypdf Pillow pywin32', autoFixable: true },
    { id: 'wps', label: 'WPS Office', status: 'missing', value: '—', detail: '未检测到 WPS 组件（可到 https://www.wps.com/ 手动安装）', fixKind: 'winget', fixCommand: 'winget install --id Kingsoft.WPSOffice', autoFixable: true },
    { id: 'obsidian', label: 'Obsidian', status: 'missing', value: '—', detail: '可选组件（官网 https://obsidian.md/）', fixKind: 'winget', fixCommand: 'winget install --id Obsidian.Obsidian', autoFixable: true },
    { id: 'subPlugins', label: '子插件', status: 'ok', value: '5/5', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
  ],
  summary: { ok: 3, warn: 2, missing: 2, skip: 0 },
}
const FIX_ALL_PAYLOAD = {
  ok: true,
  results: ['python', 'pythonDeps', 'wps', 'obsidian'].map((id, i) => ({
    id: id,
    ok: true,
    command: 'cmd-' + id,
    exitCode: 0,
    durationMs: 1200 + i * 100,
    output: 'line-1 ' + id + '\nline-2\nSuccessfully installed ' + id,
  })),
}
const FIX_DURATIONS = { python: 1200, pythonDeps: 1300, wps: 1400, obsidian: 1500 }
const fixOnePayload = (opts) => {
  let id = 'python'
  try { id = JSON.parse(String((opts && opts.body) || '{}')).id || id } catch (err) { id = 'python' }
  return {
    ok: true, id: id, command: 'cmd-' + id, exitCode: 0,
    durationMs: FIX_DURATIONS[id] === undefined ? 1000 : FIX_DURATIONS[id],
    output: 'Collecting ' + id + '\nSuccessfully installed ' + id,
  }
}
const calls = []
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body })
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (!/^https?:/i.test(u)) throw new Error('relative URL unavailable in desktop shell')
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  if (u.indexOf('/fix-all') >= 0) return jsonRes(FIX_ALL_PAYLOAD)
  if (u.indexOf('/fix') >= 0) return jsonRes(fixOnePayload(opts))
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms))

// 首次进入（loading 态骨架）
hookSlots = []
hookCursor = 0
effectQueue = []
let installTree = expand(reg.render({ initialTab: 'install' }))
let itexts = collect(installTree, []).join(' | ')

const expectItems = ['DSH 宿主', 'Node.js', 'Python', 'Python 依赖', 'WPS Office', 'Obsidian', '子插件']
let foundAll = true
for (const name of expectItems) if (!itexts.includes(name)) foundAll = false
ok(foundAll, '七项清单骨架齐全（' + expectItems.join(' / ') + '）')
ok(itexts.includes('环境检查') && itexts.includes('补齐依赖') && itexts.includes('安装子插件') && itexts.includes('初始化'), '四步进度条齐全')
ok(itexts.includes('后续版本'), '后两步标注「后续版本」')
ok(itexts.includes('重新检测'), '含「重新检测」按钮')
ok(itexts.includes('检测中'), '首次进入显示「检测中…」')
ok(itexts.includes('只读') && itexts.includes('内置白名单') && itexts.includes('不接受外部输入'), '底部说明：只读 + 白名单 + 不接受外部输入')

// 挂载 effect（无 location = 桌面外壳 → 只走合成基址）
const hookErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { hookErrors.push(err) } }
ok(hookErrors.length === 0, '挂载 effect 在无 fetch 语义下不抛错')
await tick(50)
ok(calls.length > 0 && calls[0].url === 'http://dsh.internal/work-personal-secretary/api/check', '桌面载体（origin=null）GET 首次即命中合成基址 http://dsh.internal')
ok(calls.every((c) => /^https?:/i.test(c.url)), '桌面载体不再产生根相对路径尝试（无失败噪音；实测 ' + calls.length + ' 条全为绝对 URL）')

// ready 态：证据值 / 徽标 / 复选框 / 结论条 / 链接
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
itexts = collect(installTree, []).join(' | ')
ok(itexts.includes('3.10.0') && itexts.includes('v22.14.0'), '渲染接口证据值')
ok(itexts.includes('警告') && itexts.includes('缺失') && itexts.includes('正常'), '渲染状态徽标（ok / warn / missing）')
ok(itexts.includes('一键补齐全部（4 项）'), '结论条给出「一键补齐全部（4 项）」')
ok(itexts.includes('补齐选中项（4）'), '底部主按钮为「补齐选中项（4）」')
ok(itexts.includes('将安装：') && itexts.includes('Python 解释器（3.12）') && itexts.includes('Obsidian（可选组件）'), '确认文案列出将安装内容（含 Obsidian）')
ok(itexts.includes('WPS Office 为第三方商业软件') && itexts.includes('许可协议'), 'WPS 项显示许可协议提示')
ok(itexts.includes('逐项依次执行'), '批量入口标注「逐项依次执行」（不再整批转圈）')
const boxes = findBoxes(installTree)
ok(boxes.length === 4, '可代执行四项各有复选框（实测 ' + boxes.length + ' 个）')
ok(boxes.length === 4 && boxes.every((b) => b.props.checked === true), '复选框默认全部勾选（含 Obsidian）')
const links = findLinks(installTree).map((a) => a.props.href)
ok(links.indexOf('https://www.wps.com/') >= 0, 'detail 里的官网链接渲染成可点击链接')

// 批量补齐（UI 主路径）：按客户端写死的固定顺序，逐个 POST /fix
const buttons = findButtons(installTree)
const batchBtn = buttons.filter((b) => label(b) === '补齐选中项（4）')[0]
ok(Boolean(batchBtn), '找到「补齐选中项（4）」按钮')
calls.length = 0
if (batchBtn) batchBtn.props.onClick()
await tick(150)
const stepCalls = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/fix-all') < 0)
ok(calls.every((c) => c.method !== 'POST' || c.url.indexOf('/fix-all') < 0), '主路径不发 POST /fix-all（/fix-all 仅作兜底）')
ok(stepCalls.length === 4, '批量补齐＝逐个 POST /fix（4 项各 1 次；实测 ' + stepCalls.length + '）')
const stepIds = stepCalls.map((c) => JSON.parse(String(c.body)).id)
ok(String(stepIds) === String(['python', 'pythonDeps', 'wps', 'obsidian']), '逐个补齐顺序固定 python → pythonDeps → wps → obsidian')
ok(stepCalls.every((c) => c.url.indexOf('/work-personal-secretary/api/fix') >= 0), '每次补齐都命中 /work-personal-secretary/api/fix')

// 批量结果逐项回显
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
itexts = collect(installTree, []).join(' | ')
ok(itexts.includes('补齐结果') && itexts.includes('已完成'), '报告卡片显示「补齐结果 / 已完成」')
ok(itexts.includes('cmd-python') && itexts.includes('cmd-obsidian'), '逐项回显 command')
ok(itexts.includes('1200 ms') && itexts.includes('1500 ms'), '逐项回显 durationMs')
ok(itexts.includes('Successfully installed obsidian'), '逐项回显 output 尾部')
ok(itexts.includes('成功'), '逐项状态显示成功')

// 只对选中项过滤：取消 WPS 后只发 3 项，相对顺序不变
const boxes2 = findBoxes(installTree)
ok(boxes2.length === 4, '取消勾选前仍可拿到 4 个复选框')
boxes2[2].props.onChange()
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
itexts = collect(installTree, []).join(' | ')
ok(itexts.includes('补齐选中项（3）'), '取消 WPS 后主按钮变为「补齐选中项（3）」')
calls.length = 0
const batchBtn2 = findButtons(installTree).filter((b) => label(b) === '补齐选中项（3）')[0]
ok(Boolean(batchBtn2), '找到「补齐选中项（3）」按钮')
if (batchBtn2) batchBtn2.props.onClick()
await tick(150)
const step2 = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/fix-all') < 0).map((c) => JSON.parse(String(c.body)).id)
ok(String(step2) === String(['python', 'pythonDeps', 'obsidian']), '只补齐选中项且保持固定相对顺序（实测 ' + String(step2) + '）')

// 单项补齐：POST /fix { id }（保留）
calls.length = 0
const oneBtn = findButtons(installTree).filter((b) => label(b) === '补齐')[0]
ok(Boolean(oneBtn), '清单行内保留单项「补齐」按钮')
if (oneBtn) oneBtn.props.onClick()
await tick(150)
const fixOne = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/fix') >= 0)
ok(fixOne.length === 1 && fixOne[0].url === 'http://dsh.internal/work-personal-secretary/api/fix', '单项补齐走 POST /fix（桌面载体仅 1 次，命中合成基址）')
ok(fixOne.length > 0 && fixOne.every((c) => String(c.body) === JSON.stringify({ id: 'python' })), 'POST /fix body 只有 { id }')
ok(fixOne.some((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/fix'), 'POST /fix 命中合成基址')
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
itexts = collect(installTree, []).join(' | ')
ok(itexts.includes('cmd-python') && itexts.includes('Successfully installed python'), '单项报告只回显该项')

// 兜底：宿主未注册 /fix 时，先逐个尝试一次，随即整体回退 POST /fix-all
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.indexOf('/fix-all') < 0 && u.indexOf('/fix') >= 0) {
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
    throw new Error('fix route not registered')
  }
  return originalFetch(url, opts)
}
calls.length = 0
const batchBtn3 = findButtons(installTree).filter((b) => label(b) === '补齐选中项（4）')[0]
ok(Boolean(batchBtn3), '兜底前重新拿到批量按钮')
if (batchBtn3) batchBtn3.props.onClick()
await tick(200)
const tried = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/fix-all') < 0)
const fellBack = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/fix-all') >= 0)
ok(tried.length === 1, '逐个 /fix 请求层失败时立刻判定路由缺失（仅试 1 项 1 次；实测 ' + tried.length + '）')
ok(fellBack.length === 1, '随后整体回退到 POST /fix-all 兜底（实测 ' + fellBack.length + '）')
ok(fellBack.length > 0 && String(fellBack[0].body) === JSON.stringify({ ids: ['python', 'pythonDeps', 'wps', 'obsidian'] }), '兜底 /fix-all body 为完整 ids 数组')
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
itexts = collect(installTree, []).join(' | ')
ok(itexts.includes('cmd-obsidian') && itexts.includes('成功'), '兜底结果按 results 逐项回填（/fix-all 容错解析保留）')

// 逐项实时进度：/fix 变慢时，中途应看到按钮进度与该项「执行中」
globalThis.fetch = async (url, opts) => { await tick(25); return originalFetch(url, opts) }
calls.length = 0
const batchBtn4 = findButtons(installTree).filter((b) => label(b) === '补齐选中项（4）')[0]
ok(Boolean(batchBtn4), '实时进度测试前拿到批量按钮')
if (batchBtn4) batchBtn4.props.onClick()
await tick(10)
hookCursor = 0
effectQueue = []
const midTree = expand(reg.render({ initialTab: 'install' }))
const midTexts = collect(midTree, []).join(' | ')
ok(midTexts.includes('补齐中 1/4'), '执行中按钮显示逐项进度「补齐中 1/4」')
ok(midTexts.includes('执行中'), '正在执行的那一项单独标记「执行中」')
await tick(400)
globalThis.fetch = originalFetch

// 无 fetch 载体（mock ctx 的实际情形）：初始渲染不抛错，骨架仍在
const savedFetch = globalThis.fetch
globalThis.fetch = undefined
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
const noFetchTexts = collect(installTree, []).join(' | ')
const noFetchErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { noFetchErrors.push(err) } }
ok(noFetchErrors.length === 0, '无 fetch 载体下挂载 effect 不抛错')
await tick(20)
ok(noFetchTexts.includes('DSH 宿主') && noFetchTexts.includes('Python 依赖') && noFetchTexts.includes('重新检测'), '无 fetch 载体下仍渲染七项骨架与重新检测按钮')
globalThis.fetch = savedFetch

// ══════════════════════════════════════════════════════════════════
// [8] Web 载体（origin 正常）：走根相对路径
// ══════════════════════════════════════════════════════════════════
console.log('\n[8] Web 载体（origin 正常）')
function makeCtx() {
  const reg2 = {}
  const injected2 = []
  return {
    registered: reg2,
    ctx: {
      effect(fn) { return fn() },
      logger: { debug() {}, warn() {}, info() {} },
      locale: { register() { return () => {} }, bind() { return (k) => k } },
      slots: {
        inject(slot, cb) { injected2.push(slot); cb() },
        register(meta, render) { reg2[meta.name] = { meta, render }; return () => {} },
      },
    },
  }
}
const webCaptured = (() => {
  let cap = null
  const w = { __ModuleLoader__: { load(mod) { cap = mod } }, location: { origin: 'http://127.0.0.1:43120' } }
  new Function('window', src)(w) // eslint-disable-line no-new-func
  return cap
})()
const webShell = makeCtx()
webCaptured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
}).apply(webShell.ctx)
const webReg = webShell.registered['settings.section']
const desktopFetch = globalThis.fetch
// Web 载体的 mock：相对路径就是同源请求，直接可用（不再抛错）
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  if (u.indexOf('/fix-all') >= 0) return jsonRes(FIX_ALL_PAYLOAD)
  if (u.indexOf('/fix') >= 0) return jsonRes(fixOnePayload(opts))
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
let webTree = expand(webReg.render({ initialTab: 'install' }))
calls.length = 0
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 忽略：断言在下面 */ } }
await tick(50)
ok(calls.length > 0 && calls[0].url === '/work-personal-secretary/api/check', 'Web 载体 GET 走根相对路径（' + (calls[0] && calls[0].url) + '）')
ok(calls.every((c) => c.url.indexOf('dsh.internal') < 0), 'Web 载体不发合成基址请求（相对路径成功即止；实测 ' + calls.length + ' 条）')
hookCursor = 0
effectQueue = []
webTree = expand(webReg.render({ initialTab: 'install' }))
calls.length = 0
const webBtn = findButtons(webTree).filter((b) => label(b) === '补齐选中项（4）')[0]
ok(Boolean(webBtn), 'Web 载体拿到批量按钮')
if (webBtn) webBtn.props.onClick()
await tick(150)
const webPosts = calls.filter((c) => c.method === 'POST')
ok(webPosts.length === 4 && webPosts.every((c) => c.url === '/work-personal-secretary/api/fix'), 'Web 载体逐个 POST /fix 走根相对路径（4 项各 1 次）')
globalThis.fetch = desktopFetch

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
