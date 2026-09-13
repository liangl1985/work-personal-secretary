/**
 * work-personal-secretary —— 装载冒烟测试
 *
 * 不依赖宿主运行时：mock 浏览器 loader 与 cordis ctx，**真跑客户端半的 apply()**，
 * 验证「注册了什么」与「渲染出什么」。用法：node scripts/smoke-load.mjs
 *
 * [1]-[6] 是既有断言（注册 / 关于与致谢 / 中立性），不得削弱；
 * [7] 是「安装与检查」页新增断言：在无 location、可控 fetch 的替身环境里，
 * 验证七项骨架、四步进度、复选框与批量补齐请求（含桌面载体基址回退）。
 * [11] 是「初始化」页（P3：配置引导 setup wizard）新增断言：四段式向导、首用必配表单、
 * 检查与预览（GET /basedeck?workspace=…）、逐项 POST /basedeck（dryRun:false + overrides）、
 * 结果回显与「需重启 DSH 生效」、dryRun:false 不支持时的可读失败、setupNeeded 默认落页与引导条。
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

// ══════════════════════════════════════════════════════════════════
// [9] 安装子插件页（P2）
// ══════════════════════════════════════════════════════════════════
console.log('\n[9] 安装子插件页')

const PLUGINS_PAYLOAD = {
  ok: true,
  repoRoot: 'C:/integrator/repo',
  plugins: [
    { id: 'dsh-work-memory', name: '记忆库', nature: '自研', builtinVersion: '1.2.0', installedVersion: '1.2.0', mode: 'file', status: 'upToDate' },
    { id: 'dsh-doc-suite', name: '文档能力', nature: 'self', builtinVersion: '1.1.0', installedVersion: null, mode: 'link', status: 'installable' },
    // 故意不给 name（走内置中文名兜底）与 status（按「已装 vs 内置」推导）
    { id: 'dsh-experts', nature: '第三方', builtinVersion: '0.9.0', installedVersion: '0.8.0', mode: '复制', status: 'updatable' },
    { id: 'dsh-mermaid', name: '思维链与图表', nature: 'third', builtinVersion: '0.4.0', installedVersion: null, mode: 'link' },
    { id: 'dsh-token-pet', name: '桌面形象', nature: 'third', builtinVersion: '0.5.1', installedVersion: '0.5.1', mode: 'copy', status: 'upToDate' },
  ],
}
const installOnePayload = (opts) => {
  let id = 'dsh-doc-suite'
  try { id = JSON.parse(String((opts && opts.body) || '{}')).id || id } catch (err) { id = 'dsh-doc-suite' }
  return {
    ok: true, id: id, from: '内置 1.1.0', to: '1.1.0', files: 12, verified: true, durationMs: 900, message: '',
    output: '文件：12 个（已排除 node_modules / .git / __pycache__）\nSHA256：12/12 一致',
  }
}
const INSTALL_ALL_PAYLOAD = {
  ok: true,
  results: ['dsh-doc-suite', 'dsh-experts', 'dsh-mermaid'].map((id, i) => ({
    id: id, ok: true, from: 'old-' + id, to: 'new-' + id, files: 3, verified: true, durationMs: 700 + i * 50,
  })),
}
const pluginsFetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (!/^https?:/i.test(u)) throw new Error('relative URL unavailable in desktop shell')
  if (u.indexOf('/plugins') >= 0) return jsonRes(PLUGINS_PAYLOAD)
  if (u.indexOf('/install-all') >= 0) return jsonRes(INSTALL_ALL_PAYLOAD)
  if (u.indexOf('/install') >= 0) return jsonRes(installOnePayload(opts))
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
globalThis.fetch = pluginsFetch
calls.length = 0

// loading 骨架（未挂 effect、未发请求）
hookSlots = []
hookCursor = 0
effectQueue = []
let pTree = expand(reg.render({ initialTab: 'plugins' }))
let ptexts = collect(pTree, []).join(' | ')
ok(ptexts.includes('安装子插件') && ptexts.includes('当前'), '「安装子插件」为当前步（标「当前」）')
ok(ptexts.includes('初始化') && ptexts.includes('后续版本'), '「初始化」仍标「后续版本」')
ok(ptexts.includes('子插件清单') && ptexts.includes('读取中'), '首次进入显示「子插件清单 / 读取中…」')
const pnames = ['记忆库', '文档能力', '专家库', '思维链与图表', '桌面形象']
ok(pnames.every((n) => ptexts.includes(n)), '骨架列出五个子插件（' + pnames.join(' / ') + '）')

const pErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { pErrors.push(err) } }
ok(pErrors.length === 0, '安装子插件页挂载 effect 不抛错')
await tick(50)
ok(calls.length > 0 && calls[0].url === 'http://dsh.internal/work-personal-secretary/api/plugins', '桌面载体 GET /plugins 命中合成基址')

// ready 态：清单字段 / 徽标 / 默认勾选 / 底部说明
hookCursor = 0
effectQueue = []
pTree = expand(reg.render({ initialTab: 'plugins' }))
ptexts = collect(pTree, []).join(' | ')
ok(ptexts.includes('1.2.0') && ptexts.includes('0.8.0'), '渲染内置版本与已装版本')
ok(ptexts.includes('未安装'), '未安装项显示「未安装」')
ok(ptexts.includes('已是最新') && ptexts.includes('可安装') && ptexts.includes('可更新'), '状态徽标三态齐全（已是最新 / 可安装 / 可更新）')
ok(ptexts.includes('自研') && ptexts.includes('第三方'), '性质徽标（自研 / 第三方）')
ok(ptexts.includes('file') && ptexts.includes('link') && ptexts.includes('复制'), '安装方式标注（file / link / 复制）')
ok(ptexts.includes('专家库'), '接口未给 name 时用内置中文名兜底')
ok(ptexts.includes('安装选中项（3）'), '可安装 / 可更新三项默认勾选 → 「安装选中项（3）」')
ok(ptexts.includes('从集成体仓库内置副本安装') && ptexts.includes('重启 DSH 生效'), '底部说明：内置副本离线可用 + 需重启 DSH 生效')
ok(ptexts.includes('仓库目录'), '顶部显示仓库目录徽标')
const pBoxes = findBoxes(pTree)
ok(pBoxes.length === 5, '五个子插件各有复选框（实测 ' + pBoxes.length + '）')
ok(pBoxes.filter((b) => b.props.checked === true).length === 3, '只有可安装 / 可更新的三项默认勾选')

// 主路径：逐个 POST /install（固定顺序、不发 /install-all）
calls.length = 0
const pBtns = findButtons(pTree)
const pOne = pBtns.filter((b) => label(b) === '安装')
ok(pOne.length === 5, '清单每行都有行内「安装」按钮（实测 ' + pOne.length + '）')
ok(pOne.filter((b) => b.props.disabled === true).length === 2, '「已是最新」两项的行内「安装」按钮禁用')
const pBatch = pBtns.filter((b) => label(b) === '安装选中项（3）')[0]
ok(Boolean(pBatch), '找到底部主按钮「安装选中项（3）」')
if (pBatch) pBatch.props.onClick()
await tick(200)
const instPosts = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/install-all') < 0 && c.url.indexOf('/install') >= 0)
ok(instPosts.length === 3, '主按钮＝逐个 POST /install（3 项各 1 次；实测 ' + instPosts.length + '）')
ok(String(instPosts.map((c) => JSON.parse(String(c.body)).id)) === String(['dsh-doc-suite', 'dsh-experts', 'dsh-mermaid']), '逐个安装顺序固定（按五项目录顺序过滤选中项）')
ok(calls.every((c) => c.method !== 'POST' || c.url.indexOf('/install-all') < 0), '主路径不发 POST /install-all（仅作兜底）')
ok(instPosts.every((c) => c.url.indexOf('/work-personal-secretary/api/install') >= 0), '每次安装都命中 /work-personal-secretary/api/install')
ok(calls.filter((c) => c.method === 'GET' && c.url.indexOf('/plugins') >= 0).length >= 1, '安装完成后自动重新拉取 /plugins')

// 报告逐项回显：from / to / files / verified / durationMs
hookCursor = 0
effectQueue = []
pTree = expand(reg.render({ initialTab: 'plugins' }))
ptexts = collect(pTree, []).join(' | ')
ok(ptexts.includes('安装结果') && ptexts.includes('已完成'), '报告卡片显示「安装结果 / 已完成」')
ok(ptexts.includes('内置 1.1.0') && ptexts.includes('1.1.0'), '报告回显 from / to')
ok(ptexts.includes('12 个文件'), '报告回显 files')
ok(ptexts.includes('通过'), '报告回显 verified')
ok(ptexts.includes('900 ms'), '报告回显 durationMs')
ok(ptexts.includes('SHA256：12/12 一致'), '报告回显 output 尾部（校验明细）')
ok(ptexts.includes('成功'), '逐项状态显示成功')

// 单项安装：POST /install { id }
calls.length = 0
const p2OneBtn = findButtons(pTree).filter((b) => label(b) === '安装' && b.props.disabled !== true)[0]
ok(Boolean(p2OneBtn), '拿到行内单项「安装」按钮')
if (p2OneBtn) p2OneBtn.props.onClick()
await tick(200)
const onePost = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/install-all') < 0 && c.url.indexOf('/install') >= 0)
ok(onePost.length === 1 && onePost[0].url === 'http://dsh.internal/work-personal-secretary/api/install', '单项安装走 POST /install（桌面载体仅 1 次，命中合成基址）')
ok(onePost.length > 0 && String(onePost[0].body) === JSON.stringify({ id: 'dsh-doc-suite' }), 'POST /install body 只有 { id }')

// 逐项实时进度：/install 变慢时，中途应看到按钮进度与该项「安装中…」
hookCursor = 0
effectQueue = []
pTree = expand(reg.render({ initialTab: 'plugins' }))
globalThis.fetch = async (url, opts) => { await tick(30); return pluginsFetch(url, opts) }
calls.length = 0
const slowBtn = findButtons(pTree).filter((b) => label(b) === '安装选中项（3）')[0]
ok(Boolean(slowBtn), '实时进度测试前拿到主按钮')
if (slowBtn) slowBtn.props.onClick()
await tick(10)
hookCursor = 0
effectQueue = []
const p2MidTree = expand(reg.render({ initialTab: 'plugins' }))
const p2MidTexts = collect(p2MidTree, []).join(' | ')
ok(p2MidTexts.includes('安装中 1/3'), '执行中按钮显示逐项进度「安装中 1/3」')
ok(p2MidTexts.includes('安装中…'), '正在安装的那一项单独标记「安装中…」')
ok(p2MidTexts.includes('等待'), '尚未开始的项保持「等待」')
await tick(500)
globalThis.fetch = pluginsFetch

// 兜底：宿主未注册 /install 时，先逐个尝试一次，随即整体回退 POST /install-all
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.indexOf('/install-all') < 0 && u.indexOf('/install') >= 0) {
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
    throw new Error('install route not registered')
  }
  return pluginsFetch(url, opts)
}
hookCursor = 0
effectQueue = []
pTree = expand(reg.render({ initialTab: 'plugins' }))
calls.length = 0
const fbBtn = findButtons(pTree).filter((b) => label(b) === '安装选中项（3）')[0]
ok(Boolean(fbBtn), '兜底前重新拿到主按钮')
if (fbBtn) fbBtn.props.onClick()
await tick(250)
const p2Tried = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/install-all') < 0 && c.url.indexOf('/install') >= 0)
const p2FellBack = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/install-all') >= 0)
ok(p2Tried.length === 1, '逐个 /install 请求层失败时立刻判定路由缺失（仅试 1 项 1 次；实测 ' + p2Tried.length + '）')
ok(p2FellBack.length === 1, '随后整体回退到 POST /install-all 兜底（实测 ' + p2FellBack.length + '）')
ok(p2FellBack.length > 0 && String(p2FellBack[0].body) === JSON.stringify({ ids: ['dsh-doc-suite', 'dsh-experts', 'dsh-mermaid'] }), '兜底 /install-all body 为完整 ids 数组')
hookCursor = 0
effectQueue = []
pTree = expand(reg.render({ initialTab: 'plugins' }))
ptexts = collect(pTree, []).join(' | ')
ok(ptexts.includes('new-dsh-experts') && ptexts.includes('成功'), '兜底结果按 results 逐项回填')

// repoRoot 缺失：提示 + 安装按钮禁用 + tooltip
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/plugins') >= 0) return jsonRes({ ok: true, repoRoot: null, plugins: PLUGINS_PAYLOAD.plugins })
  if (u.indexOf('/install-all') >= 0) return jsonRes(INSTALL_ALL_PAYLOAD)
  if (u.indexOf('/install') >= 0) return jsonRes(installOnePayload(opts))
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'plugins' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
const nrTree = expand(reg.render({ initialTab: 'plugins' }))
const nrTexts = collect(nrTree, []).join(' | ')
ok(nrTexts.includes('未找到集成体仓库目录，请在设置里指定'), 'repoRoot 缺失时给出清晰提示')
const nrOne = findButtons(nrTree).filter((b) => label(b) === '安装')
ok(nrOne.length === 5 && nrOne.every((b) => b.props.disabled === true), 'repoRoot 缺失时行内「安装」按钮全部禁用')
ok(nrOne.every((b) => String(b.props.title || '').length > 0), '禁用的「安装」按钮带 tooltip 说明')
const nrBatch = findButtons(nrTree).filter((b) => label(b) === '安装选中项（3）')[0]
ok(Boolean(nrBatch) && nrBatch.props.disabled === true, 'repoRoot 缺失时底部主按钮禁用')
const nrBoxes = findBoxes(nrTree)
ok(nrBoxes.length === 5 && nrBoxes.every((b) => b.props.disabled === true), 'repoRoot 缺失时复选框禁用')

// 无 fetch 载体：骨架安全渲染 + 可读错误 + 重试
const savedP2Fetch = globalThis.fetch
globalThis.fetch = undefined
hookSlots = []
hookCursor = 0
effectQueue = []
const nfTree = expand(reg.render({ initialTab: 'plugins' }))
const nfTexts = collect(nfTree, []).join(' | ')
const nfErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { nfErrors.push(err) } }
ok(nfErrors.length === 0, '无 fetch 载体下安装子插件页 effect 不抛错')
await tick(20)
ok(nfTexts.includes('记忆库') && nfTexts.includes('安装子插件') && nfTexts.includes('重新检测'), '无 fetch 载体下仍渲染五项骨架与「重新检测」')
hookCursor = 0
effectQueue = []
const nfErrTree = expand(reg.render({ initialTab: 'plugins' }))
const nfErrTexts = collect(nfErrTree, []).join(' | ')
ok(nfErrTexts.includes('子插件清单读取失败') && nfErrTexts.includes('重试'), '无 fetch 时显示可读错误与「重试」而非白屏')
globalThis.fetch = savedP2Fetch

// ══════════════════════════════════════════════════════════════════
// [10] 真实契约形状（与 lib/install.js / lib/api.js 的字段对齐）
// ══════════════════════════════════════════════════════════════════
console.log('\n[10] 真实契约形状（后端字段：items/label/kind/bundledVersion/installed/installedVersion/installMode/upToDate）')

const REAL_PLUGINS_PAYLOAD = {
  ok: true,
  repoRoot: 'C:/repo/integrator',
  repoRootSource: 'relative',
  profileDir: 'C:/Users/x/.dsh/profiles/desktop',
  items: [
    { id: 'dsh-work-memory', label: '记忆库', kind: '自研', bundledVersion: '1.0.0', installed: true, installedVersion: '1.0.0', installMode: 'file', upToDate: true },
    { id: 'dsh-doc-suite', label: '文档能力', kind: '自研', bundledVersion: '1.0.0', installed: false, installedVersion: null, installMode: null, upToDate: false },
    { id: 'dsh-experts', label: '专家库', kind: '自研', bundledVersion: '1.0.0', installed: true, installedVersion: '0.9.0', installMode: 'copy', upToDate: false },
    { id: 'dsh-mermaid', label: '思维链与图表', kind: '第三方', bundledVersion: '0.4.2', installed: true, installedVersion: null, installMode: 'link', upToDate: false },
    { id: 'dsh-token-pet', label: '桌面形象', kind: '第三方', bundledVersion: '0.5.1', installed: false, installedVersion: null, installMode: null, upToDate: false },
  ],
  summary: { total: 5, installed: 3, upToDate: 1 },
}
const REAL_INSTALL_PAYLOAD = {
  ok: true, id: 'dsh-doc-suite',
  from: 'C:/repo/integrator/modules/dsh-doc-suite',
  to: 'C:/Users/x/.dsh/profiles/desktop/node_modules/dsh-doc-suite',
  files: 42, verified: true, backup: '', durationMs: 321,
  output: '文件：42 个（已排除 node_modules / .git / __pycache__）\nSHA256：42/42 一致\nprofile/package.json：已更新',
}
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/plugins') >= 0) return jsonRes(REAL_PLUGINS_PAYLOAD)
  if (u.indexOf('/install-all') >= 0) return jsonRes({ ok: true, results: [] })
  if (u.indexOf('/install') >= 0) return jsonRes(REAL_INSTALL_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
expand(reg.render({ initialTab: 'plugins' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
const realTree = expand(reg.render({ initialTab: 'plugins' }))
const realTexts = collect(realTree, []).join(' | ')
ok(realTexts.includes('记忆库') && realTexts.includes('桌面形象'), '后端 label 字段渲染中文名')
ok(realTexts.includes('自研') && realTexts.includes('第三方'), '后端 kind 字段渲染性质徽标')
ok(realTexts.includes('1.0.0') && realTexts.includes('0.9.0') && realTexts.includes('0.4.2'), '后端 bundledVersion / installedVersion 渲染版本列')
ok(realTexts.includes('已是最新'), 'upToDate:true（含 installed:true + 同版本）→ 「已是最新」')
ok(realTexts.includes('可安装'), 'installed:false → 「可安装」')
ok(realTexts.includes('可更新'), '已装 0.9.0 / 内置 1.0.0 → 「可更新」')
ok(realTexts.includes('已装版本 —'), 'installed:true 但 installedVersion:null → 显示「—」而非「未安装」')
const notInstalledCount = (realTexts.match(/未安装/g) || []).length
ok(notInstalledCount === 2, '只有两项真正未安装（实测 ' + notInstalledCount + '）')
ok(realTexts.includes('file') && realTexts.includes('link') && realTexts.includes('复制'), '后端 installMode（file / link / copy）渲染安装方式')
ok(realTexts.includes('安装选中项（3）'), '默认勾选＝可安装（2）+ 可更新（1）＝3 项')
const realBoxes = findBoxes(realTree)
ok(realBoxes.length === 5 && realBoxes.filter((b) => b.props.checked === true).length === 3, '真实契约下复选框 5 个 / 默认勾选 3 个')

// 真实 /install 响应回显（from/to 是绝对路径，files 是数字）
calls.length = 0
const realBtn = findButtons(realTree).filter((b) => label(b) === '安装' && b.props.disabled !== true)[0]
ok(Boolean(realBtn), '真实契约下拿到行内「安装」按钮')
if (realBtn) realBtn.props.onClick()
await tick(200)
hookCursor = 0
effectQueue = []
const realTree2 = expand(reg.render({ initialTab: 'plugins' }))
const realTexts2 = collect(realTree2, []).join(' | ')
ok(realTexts2.includes('C:/repo/integrator/modules/dsh-doc-suite'), '报告回显 from（服务端拼接的源路径）')
ok(realTexts2.includes('node_modules/dsh-doc-suite'), '报告回显 to（profile 目标路径）')
ok(realTexts2.includes('42 个文件'), '报告回显 files（数字 → 「42 个文件」）')
ok(realTexts2.includes('321 ms'), '报告回显 durationMs')
ok(realTexts2.includes('SHA256：42/42 一致'), '报告回显 output 尾部')

// 接口 message（profileDir 缺失等）作为可读提示回显
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.indexOf('/plugins') >= 0) {
    return jsonRes({
      ok: true, repoRoot: 'C:/repo/integrator', profileDir: null,
      items: REAL_PLUGINS_PAYLOAD.items,
      message: '未找到当前 profile 目录（可用 DSH_PROFILE_DIR / DSH_PROFILE 指定，默认 ~/.dsh/profiles/desktop）',
    })
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'plugins' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
const hintTexts = collect(expand(reg.render({ initialTab: 'plugins' })), []).join(' | ')
ok(hintTexts.includes('未找到当前 profile 目录'), '接口 message 作为可读提示回显（profileDir 缺失场景）')

// ══════════════════════════════════════════════════════════════════
// [11] 初始化页（P3：配置引导 setup wizard —— 表单 → 预览 → 执行 → 结果）
// ══════════════════════════════════════════════════════════════════
console.log('\n[11] 初始化页（配置引导）')

const bdHash = (ch) => 'sha256:' + ch.repeat(64)
const BD_ITEMS = [
  { id: 'agentsMd', label: '指令层 AGENTS.md', status: 'append', target: 'C:/work/space/AGENTS.md',
    detail: '目标文件不存在，将新建并写入标记块', autoApplyable: true,
    preview: { action: '将新建（文件末尾追加标记块）', blockVersion: '1', contentHash: bdHash('a'),
      sampleLines: ['# 指令', '', '## 语言', '中文回答'] } },
  { id: 'memorySeed', label: '记忆种子', status: 'update', target: 'C:/work/space/memory/seed.md',
    detail: '标记块区间为内置版本，可安全更新', autoApplyable: true,
    preview: { action: '将只更新标记块区间', blockVersion: '2', contentHash: bdHash('b'),
      sampleLines: Array.from({ length: 25 }, (_, i) => 'seed-line-' + (i + 1)) } },
  { id: 'skills', label: '技能', status: 'up_to_date', target: 'C:/work/space/skills',
    detail: '已是最新，无需写入', autoApplyable: true,
    preview: { action: '已是最新无需写入', blockVersion: '1', contentHash: bdHash('c'), sampleLines: [] } },
  { id: 'settings', label: '设置', status: 'user_modified', target: ['C:/work/space/.dsh/settings.json'],
    detail: '块内被手工改过，不自动覆盖', autoApplyable: false,
    preview: { action: '块内被手工改过不自动覆盖', blockVersion: '1', contentHash: bdHash('d'), sampleLines: ['custom: true'] } },
  { id: 'dirs', label: '目录结构', status: 'multiple', target: 'C:/work/space/notes',
    detail: '检测到多份候选目录，需人工确认', autoApplyable: false,
    preview: { action: '检测到多份同名目录', blockVersion: '1', contentHash: bdHash('e'), sampleLines: [] } },
]
const BD_GET = {
  ok: true, workspace: 'C:/work/space', workspaceSource: 'config', setupNeeded: true,
  items: BD_ITEMS, summary: { total: 5, toWrite: 2, upToDate: 1, blocked: 2 },
}
/** 写前预览（GET）与逐项写入（POST dryRun:false）共用的 mock */
const bdFetch = async (url, opts) => {
  const u = String(url)
  const method = (opts && opts.method) || 'GET'
  calls.push({ url: u, method: method, body: opts && opts.body })
  if (!/^https?:/i.test(u)) throw new Error('relative URL unavailable in desktop shell')
  if (u.indexOf('/basedeck') >= 0 && method === 'POST') {
    let body = {}
    try { body = JSON.parse(String((opts && opts.body) || '{}')) } catch (e) { body = {} }
    const id = Array.isArray(body.ids) ? String(body.ids[0] || '') : ''
    return jsonRes({
      ok: true, id: id, dryRun: body.dryRun !== false, action: '已写入',
      target: 'C:/work/space/' + id, backup: 'C:/work/space/' + id + '.bak',
      bytesWritten: 100 + id.length, detail: '已写入 ' + id,
    })
  }
  if (u.indexOf('/basedeck') >= 0) return jsonRes(BD_GET)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const findInputs = (n) => findAll(n, (x) => x.type === 'input', [])
const findSelects = (n) => findAll(n, (x) => x.type === 'select', [])
const hasBtn = (n, text) => findButtons(n).filter((b) => label(b).indexOf(text) >= 0)

globalThis.fetch = bdFetch

// ── 段 1 骨架：四段式向导 + 首用必配表单 ────────────────────────
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let iTree = expand(reg.render({ initialTab: 'init' }))
let itext = collect(iTree, []).join(' | ')
ok(itext.includes('配置引导'), '页面标题为「配置引导」（不再是只读计划）')
ok(itext.includes('填写配置') && itext.includes('检查与预览') && itext.includes('执行') && itext.includes('结果'), '四段式向导齐全（填写配置 / 检查与预览 / 执行 / 结果）')
ok(itext.includes('环境检查') && itext.includes('安装子插件') && itext.includes('初始化') && itext.includes('当前'), '分区四步进度条含「初始化」且为当前步')
const bdFields = ['工作区目录', '工作岗位域', '身份专家', '记忆库目录', 'Obsidian 库目录']
ok(bdFields.every((x) => itext.includes(x)), '首用必配五项字段齐全（' + bdFields.join(' / ') + '）')
ok(itext.includes('首用必配项') && itext.includes('必填'), '表单标题与必填提示')
ok(itext.includes('可选'), '可选项标注「可选」')
ok(itext.includes('写入前会自动备份') && itext.includes('只更新「工作秘书」标记块内的内容') && itext.includes('不会被改动'), '安全文案：自动备份 + 只改标记块 + 不动你自己的段落')
ok(itext.includes('检查并预览'), '段 1 主按钮为「检查并预览」')
const domText = findSelects(iTree).length > 0 ? collect(findSelects(iTree)[0], []).join(' | ') : ''
ok(['售前', '售后·技术支持', '会计财务', '法务', '文档', '核查·通用'].every((x) => domText.includes(x)), '工作岗位域下拉六项齐全')
ok(findSelects(iTree)[0].props.value === '', '工作岗位域不默认预选（初始 value 为空）')
ok(domText.indexOf('请选择') >= 0, '工作岗位域下拉首项为占位「请选择…」')
ok(itext.includes('请先选择你的工作方向'), '未选岗位域时给出提示「请先选择你的工作方向」')
ok(itext.includes('留空将把记忆镜像到 <工作区>/work-memory'), 'Obsidian 库目录补充留空说明（镜像到 <工作区>/work-memory）')
ok(itext.indexOf('只做检查') < 0 && itext.indexOf('不会修改任何文件') < 0, '原「本版只做检查不写盘」文案已移除')

const iErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { iErrors.push(err) } }
ok(iErrors.length === 0, '初始化页挂载 effect 不抛错')
await tick(50)
ok(calls.length > 0 && calls[0].url === 'http://dsh.internal/work-personal-secretary/api/basedeck', '进入页 GET /basedeck（不带 workspace）命中合成基址')

// ── 段 1：默认取当前工作区 ──────────────────────────────────────
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
itext = collect(iTree, []).join(' | ')
const iInputs = findInputs(iTree)
ok(iInputs.length === 4 && iInputs[0].props.value === 'C:/work/space', '工作区目录默认预填当前工作区（实测 ' + iInputs.length + ' 个文本框）')
ok(hasBtn(iTree, '检查并预览').length === 1 && hasBtn(iTree, '检查并预览')[0].props.disabled !== true, '工作区已填 → 「检查并预览」可用')

// ── 段 2：检查与预览（GET 带 workspace，只读） ──────────────────
const chkBtn = hasBtn(iTree, '检查并预览')[0]
calls.length = 0
chkBtn.props.onClick()
await tick(50)
const getCalls = calls.filter((c) => c.method === 'GET')
ok(getCalls.length === 1 && getCalls[0].url.indexOf('?workspace=') >= 0, '「检查并预览」GET /basedeck 带 workspace 查询参数')
ok(getCalls.length === 1 && getCalls[0].url.indexOf('workspace=C%3A%2Fwork%2Fspace') >= 0, 'workspace 值经 URL 编码（实测 ' + (getCalls[0] && getCalls[0].url) + '）')
ok(calls.every((c) => c.method === 'GET'), '预览阶段只读：不发 POST')

hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
itext = collect(iTree, []).join(' | ')
ok(itext.includes('写入计划') && itext.includes('尚未改动任何文件'), '段 2 显示「写入计划」与写前提示')
ok(itext.includes('将追加') && itext.includes('将更新') && itext.includes('已是最新')
  && itext.includes('被手工改过') && itext.includes('多份冲突'), '五项状态徽标五态齐全')
ok(itext.includes('将新建（文件末尾追加标记块）') && itext.includes('C:/work/space/AGENTS.md'), '回显 preview.action 与 target')
ok(itext.includes('目标文件不存在，将新建并写入标记块'), '回显 detail 说明')
ok(hasBtn(iTree, '完成配置').length === 1, '段 2 出现主按钮「完成配置」')
ok(hasBtn(iTree, '完成配置')[0].props.disabled === true, '未选岗位域时「完成配置」禁用（不允许提交）')
ok(hasBtn(iTree, '完成配置')[0].props.title === '请先选择你的工作方向', '未选岗位域时提交按钮 tooltip 给出可读提示')
ok(itext.includes('请先选择你的工作方向'), '段 2 提交旁同时给出提示「请先选择你的工作方向」')
ok(hasBtn(iTree, '返回修改').length === 1, '段 2 提供「返回修改」')

const pvBtns = findButtons(iTree).filter((b) => label(b) === '预览')
ok(pvBtns.length === 5, '五项各有一个「预览」按钮（实测 ' + pvBtns.length + '）')
pvBtns[1].props.onClick()
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
itext = collect(iTree, []).join(' | ')
ok(itext.includes('收起预览'), '点击后按钮变为「收起预览」')
ok(itext.includes('seed-line-1') && itext.includes('seed-line-20') && !itext.includes('seed-line-21'), '展开渲染 sampleLines 且最多 20 行')
ok(itext.includes('仅显示前 20 行'), '超长预览给出「仅显示前 20 行」提示')

// 段 2 → 段 1：返回修改并主动选择工作岗位域（必填、不预选）
hasBtn(iTree, '返回修改')[0].props.onClick()
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
findSelects(iTree)[0].props.onChange({ target: { value: 'presales' } })
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
ok(findSelects(iTree)[0].props.value === 'presales', '选择工作岗位域后下拉值生效')
ok(hasBtn(iTree, '检查并预览').length === 1, '回到段 1 后可重新「检查并预览」')
hasBtn(iTree, '检查并预览')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
ok(hasBtn(iTree, '完成配置').length === 1 && hasBtn(iTree, '完成配置')[0].props.disabled !== true, '选好工作岗位域后「完成配置」可用')

// ── 段 3/4：完成配置（逐个 POST /basedeck，dryRun:false，逐项实时状态） ──
const finBtn = hasBtn(iTree, '完成配置')[0]
globalThis.fetch = async (url, opts) => { await tick(20); return bdFetch(url, opts) }
calls.length = 0
finBtn.props.onClick()
await tick(10)
hookCursor = 0
effectQueue = []
const bdMidTree = expand(reg.render({ initialTab: 'init' }))
const midText = collect(bdMidTree, []).join(' | ')
ok(midText.includes('写入中 1/5'), '执行中显示逐项进度「写入中 1/5」')
ok(midText.includes('写入中…') && midText.includes('等待'), '正在写入的项标「写入中…」，未开始的项保持「等待」')
await tick(400)
globalThis.fetch = bdFetch

const postCalls = calls.filter((c) => c.method === 'POST')
ok(postCalls.length === 5, '主路径＝逐个 POST /basedeck（5 项各 1 次；实测 ' + postCalls.length + '）')
const postIds = postCalls.map((c) => JSON.parse(String(c.body)).ids[0])
ok(String(postIds) === String(['dirs', 'memorySeed', 'skills', 'settings', 'agentsMd']), '写入顺序固定 dirs → memorySeed → skills → settings → agentsMd')
ok(postCalls.every((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/basedeck'), '每次写入都命中 /work-personal-secretary/api/basedeck')
ok(postCalls.every((c) => JSON.parse(String(c.body)).dryRun === false), '每次写入 body 都带 dryRun:false（真写，不是试运行）')
const ov = JSON.parse(String(postCalls[0].body)).overrides || {}
ok(ov.workspace === 'C:/work/space' && ov.defaultDomain === 'presales'
  && ov.identityExpert === '' && ov.memoryDir === '' && ov.obsidianSyncDir === '', 'overrides 携带表单五项（workspace / defaultDomain / identityExpert / memoryDir / obsidianSyncDir）')

hookCursor = 0
effectQueue = []
const doneTree = expand(reg.render({ initialTab: 'init' }))
const doneText = collect(doneTree, []).join(' | ')
ok(doneText.includes('配置完成'), '完成态标题「配置完成」')
ok(doneText.includes('需重启 DSH 生效'), '完成态明确提示需重启 DSH 生效')
ok(doneText.includes('C:/work/space/dirs') && doneText.includes('C:/work/space/agentsMd'), '结果逐项回显 target（含固定写入顺序的首尾项）')
ok(doneText.includes('C:/work/space/dirs.bak'), '结果逐项回显 backup')
ok(doneText.includes('104') && doneText.includes('已写入 dirs'), '结果逐项回显 bytesWritten 与 detail')
ok(hasBtn(doneTree, '重新检查').length === 1, '结果段保留「重新检查」')

// ── 段 3 兜底：POST 路由层失败 → 整批一次 POST；仍失败则给可读提示 ──
const bdBadFetch = async (url, opts) => {
  const u = String(url)
  const method = (opts && opts.method) || 'GET'
  calls.push({ url: u, method: method, body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0 && method === 'POST') throw new Error('basedeck write route not registered')
  if (u.indexOf('/basedeck') >= 0) return jsonRes(BD_GET)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
globalThis.fetch = bdBadFetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let badTree = expand(reg.render({ initialTab: 'init' }))
findSelects(badTree)[0].props.onChange({ target: { value: 'presales' } })
hookCursor = 0
effectQueue = []
badTree = expand(reg.render({ initialTab: 'init' }))
hasBtn(badTree, '检查并预览')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
badTree = expand(reg.render({ initialTab: 'init' }))
calls.length = 0
hasBtn(badTree, '完成配置')[0].props.onClick()
await tick(200)
const badPosts = calls.filter((c) => c.method === 'POST')
const badIds = badPosts.map((c) => { try { return JSON.parse(String(c.body)).ids } catch (e) { return [] } })
ok(badPosts.length === 2, '逐个写入在请求层失败时立刻判定路由缺失（仅试 1 项），随后整批兜底（实测 ' + badPosts.length + '）')
ok(String(badIds[0] || []) === String(['dirs']) && String(badIds[1] || []) === String(['dirs', 'memorySeed', 'skills', 'settings', 'agentsMd']), '兜底整批 body 携带全部 ids（固定顺序）')
hookCursor = 0
effectQueue = []
const badTree2 = expand(reg.render({ initialTab: 'init' }))
const badText = collect(badTree2, []).join(' | ')
ok(badText.includes('写入失败') && badText.includes('dryRun:false'), '写入不支持时给出可读失败提示（不假装成功）')
ok(badText.includes('部分失败') && badText.indexOf('配置完成') < 0, '失败结果标「部分失败」，不显示「配置完成」')

// ── workspaceSource:none：提示 + 禁用提交 ──────────────────────
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) {
    return jsonRes({ ok: true, workspace: 'C:/work/space', workspaceSource: 'none', items: BD_ITEMS, summary: BD_GET.summary })
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let noneTree = expand(reg.render({ initialTab: 'init' }))
findSelects(noneTree)[0].props.onChange({ target: { value: 'presales' } })
hookCursor = 0
effectQueue = []
noneTree = expand(reg.render({ initialTab: 'init' }))
hasBtn(noneTree, '检查并预览')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
noneTree = expand(reg.render({ initialTab: 'init' }))
const noneText = collect(noneTree, []).join(' | ')
ok(noneText.includes('未确定工作区路径') && noneText.indexOf('提交已禁用') >= 0, 'workspaceSource:none 给出可读提示')
ok(hasBtn(noneTree, '完成配置').length === 1 && hasBtn(noneTree, '完成配置')[0].props.disabled === true, 'workspaceSource:none 时「完成配置」禁用')

// ── 其余状态徽标：领先 / 损坏 / 未检测到 + target 列表 ──────────
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) {
    return jsonRes({
      ok: true, workspace: 'C:/work/space', workspaceSource: 'config', summary: BD_GET.summary,
      items: [
        { id: 'agentsMd', status: 'ahead', target: 'C:/work/space/AGENTS.md', detail: '目标块比内置新',
          preview: { action: '不自动覆盖', sampleLines: ['x'] } },
        { id: 'memorySeed', status: 'broken', target: 'C:/work/space/memory/seed.md', detail: '标记块不完整',
          preview: { action: '需人工处理', sampleLines: ['y'] } },
        { id: 'skills', status: 'none', target: '', detail: '尚未创建',
          preview: { action: '将新建', sampleLines: [] } },
        { id: 'settings', status: 'up_to_date', target: 'C:/work/space/settings.json', detail: '已是最新',
          preview: { action: '无需写入', sampleLines: [] } },
        { id: 'dirs', status: 'append', target: ['C:/work/space/a', 'C:/work/space/b'], detail: '将新建目录',
          preview: { action: '将新建', sampleLines: [] } },
      ],
    })
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let stTree = expand(reg.render({ initialTab: 'init' }))
findSelects(stTree)[0].props.onChange({ target: { value: 'presales' } })
hookCursor = 0
effectQueue = []
stTree = expand(reg.render({ initialTab: 'init' }))
hasBtn(stTree, '检查并预览')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
stTree = expand(reg.render({ initialTab: 'init' }))
const stText = collect(stTree, []).join(' | ')
ok(stText.includes('领先') && stText.includes('损坏') && stText.includes('未检测到'), '其余状态徽标三态（领先 / 损坏 / 未检测到）')
ok(stText.includes('C:/work/space/a、C:/work/space/b'), 'target 为路径列表时连成一行回显')
ok(hasBtn(stTree, '完成配置').length === 1 && hasBtn(stTree, '完成配置')[0].props.disabled !== true, 'workspaceSource=config 时「完成配置」可用')

// ── 无 fetch 载体：骨架安全渲染 + 可读错误 + 重试 ───────────────
const savedBdFetch = globalThis.fetch
globalThis.fetch = undefined
hookSlots = []
hookCursor = 0
effectQueue = []
const nfBdTree = expand(reg.render({ initialTab: 'init' }))
const nfBdText = collect(nfBdTree, []).join(' | ')
const nfBdErr = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { nfBdErr.push(err) } }
ok(nfBdErr.length === 0, '无 fetch 载体下初始化页 effect 不抛错')
await tick(20)
ok(nfBdText.includes('工作区目录') && nfBdText.includes('检查并预览') && nfBdText.includes('重新检查'), '无 fetch 载体下仍渲染表单骨架与「重新检查」')
hookCursor = 0
effectQueue = []
const nfBdTree2 = expand(reg.render({ initialTab: 'init' }))
const nfBdText2 = collect(nfBdTree2, []).join(' | ')
ok(nfBdText2.includes('初始化信息读取失败') && nfBdText2.includes('重试'), '无 fetch 时显示可读错误与「重试」而非白屏')
globalThis.fetch = savedBdFetch

// ── setupNeeded 引导：为 true → 默认落「初始化」页 + 顶部引导条 ──
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) return jsonRes(BD_GET)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({}))
const setupErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { setupErrors.push(err) } }
ok(setupErrors.length === 0, 'setupNeeded 探测 effect 不抛错')
await tick(50)
hookCursor = 0
effectQueue = []
const gTree = expand(reg.render({}))
const gText = collect(gTree, []).join(' | ')
ok(gText.includes('还差 4 项才能开始使用'), 'setupNeeded:true → 顶部引导提示「还差 4 项才能开始使用」')
ok(gText.includes('去完成配置'), '引导条带「去完成配置」按钮')
ok(gText.includes('首用必配项'), 'setupNeeded:true → 默认落在「初始化」页')

// setupNeeded 为 false / 缺失 → 默认页仍是「关于与致谢」
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.indexOf('/basedeck') >= 0) return jsonRes({ ok: true, workspace: 'C:/work/space', items: BD_ITEMS, summary: BD_GET.summary })
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({}))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
const g2Tree = expand(reg.render({}))
const g2Text = collect(g2Tree, []).join(' | ')
ok(g2Text.includes('本集成体包含的插件') && g2Text.indexOf('还差') < 0 && g2Text.indexOf('首用必配项') < 0, 'setupNeeded 为 false / 缺失时默认页仍是「关于与致谢」')

// ── Web 载体：GET /basedeck 走根相对路径 ───────────────────────
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) return jsonRes(BD_GET)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
expand(webReg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
ok(calls.length > 0 && calls[0].url === '/work-personal-secretary/api/basedeck', 'Web 载体 GET /basedeck 走根相对路径（' + (calls[0] && calls[0].url) + '）')
ok(calls.every((c) => c.url.indexOf('dsh.internal') < 0), 'Web 载体不发合成基址请求（相对路径成功即止）')

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
