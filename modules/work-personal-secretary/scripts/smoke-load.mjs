/**
 * work-personal-secretary —— 装载冒烟测试
 *
 * 不依赖宿主运行时：mock 浏览器 loader 与 cordis ctx，**真跑客户端半的 apply()**，
 * 验证「注册了什么」与「渲染出什么」。用法：node scripts/smoke-load.mjs
 *
 * [1]-[6] 是既有断言（注册 / 关于与致谢 / 中立性），不得削弱；
 * [7] 是「安装与检查」页断言：在无 location、可控 fetch 的替身环境里，
 * 验证分组骨架（环境依赖 / 依赖安装工具 / 子插件）、复选框与批量补齐请求（含基址回退）；
 * 1.1.3 起四步进度条已删除，改由 [13] 段覆盖新骨架与门禁。
 * [11] 是「初始化」页（P3：配置引导 setup wizard）新增断言：四段式向导、首用必配表单、
 * 检查与预览（GET /basedeck?workspace=…）、逐项 POST /basedeck（dryRun:false + overrides）、
 * 结果回显与「需重启 DSH 生效」、dryRun:false 不支持时的可读失败、setupNeeded 默认落页与引导条。
 * [12] 是「能力配置」页（P4：读写子插件设置）新增断言：四组渲染、记忆库五个语义小节、
 * 「已覆盖」标记、清除覆盖（unset）/ 恢复默认（set 默认值）、编辑草稿后 POST /settings/write
 * （恒带 dryRun:false + revision）、409 冲突提示与自动重读且不丢输入、专家打分实时预览、
 * 子插件未安装与服务完全不可用两种降级（页面不崩、不出空分组）、桌面形象跳转。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
// 1.1.3：默认页签是「安装与检查」，关于页内容必须**显式指定页签**才看得到
const aboutJoined = collect(reg.render({ initialTab: 'about' }), []).join(' | ')
const expectPlugins = ['dsh-work-memory', 'dsh-doc-suite', 'dsh-experts', 'dsh-mermaid', 'workspace-tokenpet']
for (const p of expectPlugins) {
  ok(aboutJoined.includes(p), '列出子插件 ' + p)
}
ok(aboutJoined.includes('MIT'), '声明许可（MIT）')
ok(aboutJoined.includes('不联网') || aboutJoined.includes('无遥测'), '声明本地/离线/无遥测')
ok(aboutJoined.includes('未经专业复核') || aboutJoined.includes('专业复核'), '声明专家内容免责边界')
ok(aboutJoined.includes('关于与致谢') || aboutJoined.includes('About'), '分区标题可读')

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
ok(itexts.includes('查看安装引导') && itexts.includes('使用说明'), '按钮组置顶：查看安装引导（N 项待处理）+ 使用说明')
ok(itexts.includes('环境依赖') && itexts.includes('依赖安装工具') && itexts.includes('子插件'), '分组卡片：环境依赖 + 依赖安装工具 + 子插件')
ok(!itexts.includes('后续版本') && !itexts.includes('环境检查'), '四步进度条与其文案已删除')
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
ok(itexts.includes('查看安装引导（3 项待处理）'), '有缺项时主按钮为「查看安装引导（3 项待处理）」（R-1：只数硬项 host/node/python/pythonDeps/wps，Obsidian 可选不计）')
ok(itexts.includes('补齐选中项（4）'), '底部主按钮为「补齐选中项（4）」')
ok(itexts.includes('将安装：') && itexts.includes('Python 解释器（3.12）') && itexts.includes('Obsidian（知识库组件）'), '确认文案列出将安装内容（含 Obsidian；C1 改名后为「知识库组件」）')
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

// 恢复 WPS 勾选：D1 之后 picked 由本页状态持有，重新检测不再重置它，
// 上一段取消勾选的效果会跨段落保留 —— 这里显式勾回，保持后续用例的前提（4 项）。
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))
const boxesRestore = findBoxes(installTree)
if (boxesRestore[2]) boxesRestore[2].props.onChange()
hookCursor = 0
effectQueue = []
installTree = expand(reg.render({ initialTab: 'install' }))

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
let webWin = null
const webCaptured = (() => {
  let cap = null
  // 暴露这个 window 对象：Web 载体的 window.open 断言要用（[16] 段）
  webWin = { __ModuleLoader__: { load(mod) { cap = mod } }, location: { origin: 'http://127.0.0.1:43120' } }
  new Function('window', src)(webWin) // eslint-disable-line no-new-func
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
    { id: 'workspace-tokenpet', name: '桌面形象', nature: 'third', builtinVersion: '0.5.1', installedVersion: '0.5.1', mode: 'copy', status: 'upToDate' },
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
ok(ptexts.includes('子插件清单') && ptexts.includes('重新检测'), '旧「安装子插件」页已下线页签，深链仍可渲染（组件留待与核心配置一起收口）')
ok(ptexts.includes('子插件清单') && ptexts.includes('读取中'), '首次进入显示「子插件清单 / 读取中…」')
const pnames = ['记忆库', '文档能力', '专家库', '思维链与图表', '桌面形象']
ok(pnames.every((n) => ptexts.includes(n)), '骨架列出五个子插件（' + pnames.join(' / ') + '）')

const pErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { pErrors.push(err) } }
ok(pErrors.length === 0, '安装子插件页挂载 effect 不抛错')
await tick(50)
ok(calls.some((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/plugins'), '桌面载体 GET /plugins 命中合成基址（D1 后首个请求可能是 Section 的 /check，故按包含判定）')

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
ok(nfTexts.includes('记忆库') && nfTexts.includes('子插件清单') && nfTexts.includes('重新检测'), '无 fetch 载体下仍渲染五项骨架与「重新检测」')
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
    { id: 'workspace-tokenpet', label: '桌面形象', kind: '第三方', bundledVersion: '0.5.1', installed: false, installedVersion: null, installMode: null, upToDate: false },
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
ok(itext.includes('填写配置') && itext.includes('首用必配项'), '旧「初始化」页深链仍渲染向导（页签已下线，组件留待与核心配置一起收口）')
ok(itext.includes('填写配置') && itext.includes('检查与预览') && itext.includes('执行') && itext.includes('结果'), '四段式向导齐全（填写配置 / 检查与预览 / 执行 / 结果）')
ok(!itext.includes('环境检查') && !itext.includes('后续版本'), '旧「初始化」页不再渲染四步进度条（1.1.3 已删除）')
const bdFields = ['工作区目录', '工作岗位域', '身份专家', '记忆库目录', 'Obsidian 库目录']
ok(bdFields.every((x) => itext.includes(x)), '首用必配五项字段齐全（' + bdFields.join(' / ') + '）')
ok(itext.includes('首用必配项') && itext.includes('必填'), '表单标题与必填提示')
ok(itext.includes('可选'), '可选项标注「可选」')
ok(itext.includes('写入前会自动备份') && itext.includes('只更新「工作秘书」标记块内的内容') && itext.includes('不会被改动'), '安全文案：自动备份 + 只改标记块 + 不动你自己的段落')
ok(itext.includes('检查并预览'), '段 1 主按钮为「检查并预览」')
ok(mod.inject.includes('uiWorkspace'), "模块 inject 已声明 'uiWorkspace'（原生目录选择）")
const bdBrowse = findButtons(iTree).filter((b) => label(b) === '浏览…')
ok(bdBrowse.length === 3, '三个目录字段各有「浏览…」按钮（实测 ' + bdBrowse.length + '）')
ok(bdBrowse.every((b) => b.props.disabled === true), '服务缺失（无 uiWorkspace）时「浏览…」全部禁用（优雅降级）')
ok(bdBrowse.every((b) => String(b.props.title || '').length > 0), '禁用的「浏览…」带 tooltip 说明，页面不崩')
ok(findButtons(iTree).filter((b) => label(b) === '使用探测到的工作区').length === 1, '工作区目录有「使用探测到的工作区」候选')
ok(findButtons(iTree).filter((b) => label(b).indexOf('使用默认（<DSH_HOME 或 ~/.dsh>/') >= 0).length === 1, '记忆库目录有「使用默认」候选')
ok(findButtons(iTree).filter((b) => label(b) === '不使用镜像').length === 1
  && findButtons(iTree).filter((b) => label(b) === '<工作区>/00_全局记忆').length === 1
  && findButtons(iTree).filter((b) => label(b) === '<工作区>/work-memory').length === 1, 'Obsidian 库目录三个候选齐全（不使用镜像 / 00_全局记忆 / work-memory）')
const domText = findSelects(iTree).length > 0 ? collect(findSelects(iTree)[0], []).join(' | ') : ''
ok(['信息安全', '财务', '人力资源', '代码编程', '金融', '通用职能'].every((x) => domText.includes(x)), '工作岗位域下拉六项齐全（dsh-experts 0.3.x 域重划后的 5 行业域 + 1 通用职能域）')
ok(findSelects(iTree)[0].props.value === '', '工作岗位域不默认预选（初始 value 为空）')
ok(domText.indexOf('请选择') >= 0, '工作岗位域下拉首项为占位「请选择…」')
ok(itext.includes('请先选择你的工作方向'), '未选岗位域时给出提示「请先选择你的工作方向」')
ok(itext.includes('留空将把记忆镜像到 <工作区>/work-memory'), 'Obsidian 库目录补充留空说明（镜像到 <工作区>/work-memory）')
ok(itext.indexOf('只做检查') < 0 && itext.indexOf('不会修改任何文件') < 0, '原「本版只做检查不写盘」文案已移除')

const iErrors = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { iErrors.push(err) } }
ok(iErrors.length === 0, '初始化页挂载 effect 不抛错')
await tick(50)
ok(calls.some((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/basedeck'), '进入页 GET /basedeck（不带 workspace）命中合成基址（按包含判定）')

// ── 段 1：默认取当前工作区 ──────────────────────────────────────
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
itext = collect(iTree, []).join(' | ')
const iInputs = findInputs(iTree)
ok(iInputs.length === 4 && iInputs[0].props.value === 'C:/work/space', '工作区目录默认预填当前工作区（实测 ' + iInputs.length + ' 个文本框）')
ok(hasBtn(iTree, '检查并预览').length === 1 && hasBtn(iTree, '检查并预览')[0].props.disabled !== true, '工作区已填 → 「检查并预览」可用')
ok(itext.includes('已按设置里的工作区配置填入'), 'workspaceSource=config → 工作区字段下方标明来源')

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
findSelects(iTree)[0].props.onChange({ target: { value: 'infosec' } })
hookCursor = 0
effectQueue = []
iTree = expand(reg.render({ initialTab: 'init' }))
ok(findSelects(iTree)[0].props.value === 'infosec', '选择工作岗位域后下拉值生效')
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
ok(ov.workspace === 'C:/work/space' && ov.defaultDomain === 'infosec'
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
findSelects(badTree)[0].props.onChange({ target: { value: 'infosec' } })
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
findSelects(noneTree)[0].props.onChange({ target: { value: 'infosec' } })
hookCursor = 0
effectQueue = []
noneTree = expand(reg.render({ initialTab: 'init' }))
ok(findInputs(noneTree)[0].props.value === '', 'workspaceSource=none → 工作区留空（不预填）')
ok(collect(noneTree, []).join(' | ').indexOf('必须选择工作区') >= 0, 'workspaceSource=none → 字段下方提示「必须选择工作区」')
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
findSelects(stTree)[0].props.onChange({ target: { value: 'infosec' } })
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
ok(gText.includes('先满足最低使用需求'), 'setupNeeded:true → 默认落在「核心配置」页（引导条 + 门禁卡）')

// setupNeeded 为 false / 缺失 → 默认页是「安装与检查」（1.1.3：打开即从环境检查起步）
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
ok(g2Text.includes('查看安装引导') && g2Text.includes('环境依赖') && g2Text.indexOf('还差') < 0 && g2Text.indexOf('首用必配项') < 0,
  'setupNeeded 为 false / 缺失时默认落在「安装与检查」页')

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
ok(calls.some((c) => c.url === '/work-personal-secretary/api/basedeck'), 'Web 载体 GET /basedeck 走根相对路径（按包含判定；首个请求可能是 /check）')
ok(calls.every((c) => c.url.indexOf('dsh.internal') < 0), 'Web 载体不发合成基址请求（相对路径成功即止）')

// ── workspaceSource 的预填与来源说明（derived / cwd / config） ──
const bdSourceFetch = (source) => async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) {
    return jsonRes({ ok: true, workspace: 'C:/work/space', workspaceSource: source, items: BD_ITEMS, summary: BD_GET.summary })
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
for (const pair of [['derived', '已按记忆镜像目录反推，请确认'], ['cwd', '已按当前工作目录填入，请确认'], ['config', '已按设置里的工作区配置填入']]) {
  const srcName = pair[0]
  const noteText = pair[1]
  globalThis.fetch = bdSourceFetch(srcName)
  hookSlots = []
  hookCursor = 0
  effectQueue = []
  expand(reg.render({ initialTab: 'init' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(50)
  hookCursor = 0
  effectQueue = []
  const srcTree = expand(reg.render({ initialTab: 'init' }))
  const srcText = collect(srcTree, []).join(' | ')
  ok(findInputs(srcTree)[0].props.value === 'C:/work/space', 'workspaceSource=' + srcName + ' → 工作区已预填')
  ok(srcText.includes(noteText), 'workspaceSource=' + srcName + ' → 标明来源「' + noteText + '」')
}

// ── 原生目录选择（uiWorkspace.pickDirectory）：点击填值 / 取消保持原值 ──
const pickSeq = ['C:/picked/ws', null]
const pickShell = (() => {
  const reg3 = {}
  const ctx3 = {
    effect(fn) { return fn() },
    logger: { debug() {}, warn() {}, info() {} },
    locale: { register() { return () => {} }, bind() { return (k) => k } },
    uiWorkspace: { pickDirectory: async () => (pickSeq.length ? pickSeq.shift() : null) },
    slots: {
      inject(slot, cb) { cb() },
      register(meta, render) { reg3[meta.name] = { meta, render }; return () => {} },
    },
  }
  return { registered: reg3, ctx: ctx3 }
})()
const pickCaptured = (() => {
  let cap = null
  // 不传 location = 桌面外壳载体（只走合成基址，每请求 1 次，便于计数断言）
  const w = { __ModuleLoader__: { load(mod) { cap = mod } } }
  new Function('window', src)(w) // eslint-disable-line no-new-func
  return cap
})()
pickCaptured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
}).apply(pickShell.ctx)
const pickReg = pickShell.registered['settings.section']
globalThis.fetch = bdFetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(pickReg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let pkTree = expand(pickReg.render({ initialTab: 'init' }))
const pkBrowse = findButtons(pkTree).filter((b) => label(b) === '浏览…')
ok(pkBrowse.length === 3 && pkBrowse.every((b) => b.props.disabled !== true), '有 uiWorkspace 服务时三个「浏览…」按钮可用')
pkBrowse[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[0].props.value === 'C:/picked/ws', '点击「浏览…」把系统目录选择结果填入工作区')
findButtons(pkTree).filter((b) => label(b) === '浏览…')[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[0].props.value === 'C:/picked/ws', '使用者取消选择（返回 null）时保持原值不变')

// 候选按钮填值（工作区 / 记忆库 / Obsidian 三个）
findInputs(pkTree)[0].props.onChange({ target: { value: 'D:/manual' } })
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
findButtons(pkTree).filter((b) => label(b) === '使用探测到的工作区')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[0].props.value === 'C:\\work\\space', '「使用探测到的工作区」候选把探测值填回（统一成反斜杠）')

findButtons(pkTree).filter((b) => label(b).indexOf('使用默认（<DSH_HOME 或 ~/.dsh>/') >= 0)[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[1].props.value === '<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory',
  '记忆库候选填入新默认路径（<DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory）')

findButtons(pkTree).filter((b) => label(b) === '<工作区>/00_全局记忆')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[2].props.value === 'C:\\work\\space\\00_全局记忆', 'Obsidian 候选「<工作区>/00_全局记忆」填入拼接路径（统一成反斜杠）')
findButtons(pkTree).filter((b) => label(b) === '<工作区>/work-memory')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(findInputs(pkTree)[2].props.value === 'C:\\work\\space\\work-memory', 'Obsidian 候选「<工作区>/work-memory」填入拼接路径（统一成反斜杠）')
findButtons(pkTree).filter((b) => label(b) === '不使用镜像')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
let pkText = collect(pkTree, []).join(' | ')
ok(findInputs(pkTree)[2].props.value === '', '「不使用镜像」清空该字段')
ok(pkText.includes('已选择不使用镜像'), '「不使用镜像」进入显式关闭状态且页面可见标注')
ok(pkText.indexOf('留空将把记忆镜像到') < 0, '显式关闭状态下不再显示「留空将镜像到…」提示')
const offBtn = findButtons(pkTree).filter((b) => label(b) === '不使用镜像')[0]
ok(Boolean(offBtn) && offBtn.props.style && offBtn.props.style.background === '#f3f6ff', '「不使用镜像」按钮高亮（显式关闭生效）')

// 点镜像候选 → 退出显式关闭
findButtons(pkTree).filter((b) => label(b) === '<工作区>/work-memory')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
pkText = collect(pkTree, []).join(' | ')
ok(findInputs(pkTree)[2].props.value === 'C:\\work\\space\\work-memory'
  && pkText.indexOf('已选择不使用镜像') < 0
  && pkText.includes('留空将把记忆镜像到'), '点镜像候选 → 退出显式关闭状态（提示恢复）')

// 手输路径 → 退出显式关闭
findButtons(pkTree).filter((b) => label(b) === '不使用镜像')[0].props.onClick()
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(collect(pkTree, []).join(' | ').includes('已选择不使用镜像'), '再次点「不使用镜像」→ 重新进入显式关闭')
findInputs(pkTree)[2].props.onChange({ target: { value: 'D:/mine/vault' } })
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
pkText = collect(pkTree, []).join(' | ')
ok(findInputs(pkTree)[2].props.value === 'D:/mine/vault'
  && pkText.indexOf('已选择不使用镜像') < 0, '手输路径 → 退出显式关闭状态')

// 显式关闭 → 提交上报哨兵 __none__
findButtons(pkTree).filter((b) => label(b) === '不使用镜像')[0].props.onClick()
findSelects(pkTree)[0].props.onChange({ target: { value: 'infosec' } })
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
ok(collect(pkTree, []).join(' | ').includes('已选择不使用镜像'), '选工作岗位域不会退出显式关闭状态')
hasBtn(pkTree, '检查并预览')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
pkTree = expand(pickReg.render({ initialTab: 'init' }))
calls.length = 0
hasBtn(pkTree, '完成配置')[0].props.onClick()
await tick(300)
const offPosts = calls.filter((c) => c.method === 'POST')
ok(offPosts.length === 5, '显式关闭状态下仍逐个 POST /basedeck（实测 ' + offPosts.length + '）')
ok(offPosts.length > 0 && offPosts.every((c) => JSON.parse(String(c.body)).overrides.obsidianSyncDir === '__none__'), '显式关闭 → overrides.obsidianSyncDir = "__none__"')

// ── 桌面壳原生选择器优先（window.__DSH_DESKTOP_PICK_DIRECTORY__）──
// 桌面壳的 host directoryPicker 只有 browse 能力，host pickDirectory() 必然抛；
// 官方（dsh-plugin-desktop + directory-browser）在桌面环境只认 window 上的 bridge。
const NATIVE_ERR = 'directory picker failed: directoryPicker.pick needs the native capability; the composed picker serves "browse"'
let hostPickCalls = 0
const deskSeq = ['E:/picked-by-desktop', null]
const deskShell = (() => {
  const reg = {}
  const ctx = {
    effect(fn) { return fn() },
    logger: { debug() {}, warn() {}, info() {} },
    locale: { register() { return () => {} }, bind() { return (k) => k } },
    uiWorkspace: { pickDirectory: async () => { hostPickCalls += 1; throw new Error(NATIVE_ERR) } },
    slots: {
      inject(slot, cb) { cb() },
      register(meta, render) { reg[meta.name] = { meta, render }; return () => {} },
    },
  }
  return { registered: reg, ctx }
})()
const deskCaptured = (() => {
  let cap = null
  const w = {
    __ModuleLoader__: { load(mod) { cap = mod } },
    __DSH_DESKTOP_PICK_DIRECTORY__: async () => (deskSeq.length ? deskSeq.shift() : null),
  }
  new Function('window', src)(w) // eslint-disable-line no-new-func
  return cap
})()
deskCaptured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
}).apply(deskShell.ctx)
const deskReg = deskShell.registered['settings.section']
globalThis.fetch = bdFetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(deskReg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let deskTree = expand(deskReg.render({ initialTab: 'init' }))
const deskBrowse = findButtons(deskTree).filter((b) => label(b) === '浏览…')
ok(deskBrowse.length === 3 && deskBrowse.every((b) => b.props.disabled !== true), '桌面壳：有原生选择器 bridge 时三个「浏览…」仍可用（不再因 host 不可用而禁用）')
deskBrowse[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
deskTree = expand(deskReg.render({ initialTab: 'init' }))
ok(findInputs(deskTree)[0].props.value === 'E:/picked-by-desktop', '桌面壳：优先走 window.__DSH_DESKTOP_PICK_DIRECTORY__ 并填入结果')
ok(hostPickCalls === 0, '桌面壳：完全不再调用会失败的 host uiWorkspace.pickDirectory')
findButtons(deskTree).filter((b) => label(b) === '浏览…')[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
deskTree = expand(deskReg.render({ initialTab: 'init' }))
ok(findInputs(deskTree)[0].props.value === 'E:/picked-by-desktop', '桌面壳：bridge 返回 null（取消）→ 原值不变')

// ── 无 bridge 且 host 报 native capability → 换可读中文提示，不暴露英文原文 ──
const nativeShell = (() => {
  const reg = {}
  const ctx = {
    effect(fn) { return fn() },
    logger: { debug() {}, warn() {}, info() {} },
    locale: { register() { return () => {} }, bind() { return (k) => k } },
    uiWorkspace: { pickDirectory: async () => { throw new Error(NATIVE_ERR) } },
    slots: {
      inject(slot, cb) { cb() },
      register(meta, render) { reg[meta.name] = { meta, render }; return () => {} },
    },
  }
  return { registered: reg, ctx }
})()
const nativeCaptured = (() => {
  let cap = null
  const w = { __ModuleLoader__: { load(mod) { cap = mod } } }
  new Function('window', src)(w) // eslint-disable-line no-new-func
  return cap
})()
nativeCaptured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
}).apply(nativeShell.ctx)
const nativeReg = nativeShell.registered['settings.section']
globalThis.fetch = bdFetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(nativeReg.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let ntTree = expand(nativeReg.render({ initialTab: 'init' }))
findButtons(ntTree).filter((b) => label(b) === '浏览…')[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
ntTree = expand(nativeReg.render({ initialTab: 'init' }))
const ntText = collect(ntTree, []).join('')
ok(ntText.indexOf('当前环境没有系统目录选择器') >= 0, 'host 报 native capability → 换成可读中文提示')
ok(ntText.indexOf('native capability') < 0, '英文原始错误不再直接暴露给使用者')

// ── 「重新检查」只刷新当前步骤，绝不代替使用者跳步 ──
hookCursor = 0
effectQueue = []
let rcTree = expand(nativeReg.render({ initialTab: 'init' }))
ok(collect(rcTree, []).join('').indexOf('首用必配项') >= 0, '第 1 步：标题为「首用必配项」')
findButtons(rcTree).filter((b) => label(b) === '重新检查')[0].props.onClick()
await tick(50)
hookCursor = 0
effectQueue = []
rcTree = expand(nativeReg.render({ initialTab: 'init' }))
const rcText = collect(rcTree, []).join('')
ok(rcText.indexOf('首用必配项') >= 0, '第 1 步点「重新检查」→ 停在第 1 步（不再自动跳到预览）')
ok(rcText.indexOf('写入计划') < 0, '第 1 步点「重新检查」→ 不出现第 2 步的「写入计划」')

// ── pickDirectory 抛错：可读提示 + 原值不变 + 不崩 ──────────────
const failReg = {}
const failShell = {
  ctx: {
    effect(fn) { return fn() },
    logger: { debug() {}, warn() {}, info() {} },
    locale: { register() { return () => {} }, bind() { return (k) => k } },
    uiWorkspace: { pickDirectory: async () => { throw new Error('picker-boom') } },
    slots: {
      inject(slot, cb) { cb() },
      register(meta, render) { failReg[meta.name] = { meta, render }; return () => {} },
    },
  },
}
const failCaptured = (() => {
  let cap = null
  const w = { __ModuleLoader__: { load(mod) { cap = mod } } }
  new Function('window', src)(w) // eslint-disable-line no-new-func
  return cap
})()
failCaptured.factory((id) => {
  if (id === 'react') return ReactStub
  throw new Error('未预期的客户端依赖: ' + id)
}).apply(failShell.ctx)
const failRegS = failReg['settings.section']
globalThis.fetch = bdFetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(failRegS.render({ initialTab: 'init' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
let failTree = expand(failRegS.render({ initialTab: 'init' }))
const failBefore = findInputs(failTree)[0].props.value
findButtons(failTree).filter((b) => label(b) === '浏览…')[0].props.onClick()
await tick(30)
hookCursor = 0
effectQueue = []
failTree = expand(failRegS.render({ initialTab: 'init' }))
const failText = collect(failTree, []).join(' | ')
ok(failText.includes('目录选择失败：picker-boom'), 'pickDirectory 抛错 → 显示「目录选择失败：<原因>」')
ok(findInputs(failTree)[0].props.value === failBefore, '选择失败时原值不变')
ok(failText.includes('工作区目录') && findInputs(failTree).length === 4, '选择失败后页面照常渲染（不崩）')

// ══════════════════════════════════════════════════════════════════
// [12] 能力配置页（P4：读写子插件设置）
// 契约：GET /settings（白名单裁剪的只读枚举）→ POST /settings/write
// （{ ns, dryRun:false, revision, ops }，409 = 版本冲突）；
// GET /experts/preview?text= 只读打分预览。
// 覆盖：四组渲染 / 「已覆盖」标记 / unset / 恢复默认 / 409 冲突重读不丢输入 /
// 预览渲染 / 服务不可用与子插件未安装的降级不崩 / 桌面形象跳转。
// ══════════════════════════════════════════════════════════════════
console.log('\n[12] 能力配置页')

const findByAttr = (n, attr, val) => findAll(n, (x) => x.props && x.props[attr] === val, [])

/** work-memory 24 键（与 modules/dsh-work-memory/lib/settings.js 的 DEFAULTS 对齐） */
const CFG_MEM_DEFAULTS = {
  memoryDir: null, personaLabel: '记忆', injectMemory: true, snapshotOrder: 500,
  snapshotMaxChars: 4000, snapshotLimitGlobal: 20, snapshotLimitUser: 12,
  snapshotLimitProject: 16, snapshotLimitDaily: 8, reviewEnabled: true, dailyAutoLog: true,
  maintainWarnDays: 7, archiveEnabled: true, dailyRetentionDays: 7, projectTtlDays: 30,
  userTtlDays: 90, triageEnabled: true, triageGraceDays: 7, triageAskInSnapshot: true,
  globalWarnCount: 20, backupEnabled: true, backupDir: '', backupKeep: 7, obsidianSyncDir: null,
}
/** 用户层覆盖两项（用于「已覆盖」标记 / unset / 恢复默认断言） */
const CFG_MEM_USER0 = { snapshotMaxChars: 6000, backupDir: 'D:/bak' }
/** experts **18 键**（= dsh-experts 0.4.0 的 settings schema 全量；口径 2026-09-15 核对）。
 * expertInjectMax 已写死 4（设置页不提供该项，故断言它不出现在渲染结果里）。
 * 注意：injectOrder 只在部署层 base（不在 schema），宿主 describe() 不会返回它，故 mock 也不含它。 */
const CFG_EXP_DEFAULTS = {
  expertsEnabled: true, defaultDomain: 'infosec', identityExpert: '',
  enabledDomains: '', enabledExperts: '', expertInjectMax: 4, expertSecondThreshold: 0.3,
  expertShowBanner: true, expertSetupDone: false,
  expertCatalogEnabled: true, disciplineEnabled: true, disciplineMemoryDir: '',
  skillInjectEnabled: true, skillBudgetChars: 300, expertInjectDetail: 'auto',
  expertInjectBudgetChars: 2000, expertGeneralMax: 1, expertGeneralMinEvidence: 0.2,
}
const cfgTypeOf = (v) => (typeof v === 'boolean' ? 'boolean' : (typeof v === 'number' ? 'number' : 'string'))
const cfgFieldsOf = (defaults) => Object.keys(defaults).map((k) => ({
  key: k, type: cfgTypeOf(defaults[k]), default: defaults[k], description: '接口说明·' + k,
}))

/** 可变的 mock 服务端状态（写成功会真的改它，供重读一致性断言） */
let cfgRevision = 12
let cfgConflict = false
let cfgMemValue = Object.assign({}, CFG_MEM_DEFAULTS, CFG_MEM_USER0)
let cfgMemUser = Object.assign({}, CFG_MEM_USER0)
/** experts 的三种服务端形态：on 已注册 / placeholder 未安装占位（宿主实态）/ absent 直接不给 */
let cfgExpertMode = 'on'
/** 模拟「宿主忽略了 dryRun:false」的回归场景 */
let cfgIgnoreDryRun = false
const cfgNamespaces = () => {
  const list = [{
    ns: 'work-memory', title: '记忆库', revision: cfgRevision, writable: true, applies: 'live',
    installed: true, value: cfgMemValue, user: cfgMemUser, fields: cfgFieldsOf(CFG_MEM_DEFAULTS),
  }]
  if (cfgExpertMode === 'on') {
    list.push({
      ns: 'experts', title: '专家库', revision: cfgRevision, writable: true, applies: 'live',
      installed: true, value: CFG_EXP_DEFAULTS, user: {}, fields: cfgFieldsOf(CFG_EXP_DEFAULTS),
    })
  } else if (cfgExpertMode === 'placeholder') {
    // 宿主实态：子插件未安装时**不省略 ns**，而是给 fields/value 全空的占位条目
    list.push({
      ns: 'experts', title: '专家库', revision: 0, writable: false, applies: 'live',
      installed: false, value: {}, user: {}, fields: [],
    })
  }
  return list
}
const CFG_PREVIEW_PAYLOAD = {
  ok: true, reason: 'identity+1',
  ranked: [
    { id: 'infosec-ics-security', domain: 'infosec', score: 0.9, evidence: 0.9, reasons: ['身份专家'] },
    { id: 'infosec-djbh', domain: 'infosec', score: 0.7, evidence: 0.7, reasons: ['关键词·等保'] },
  ],
  selected: ['infosec-ics-security', 'infosec-djbh'],
  config: { expertInjectMax: 4, expertSecondThreshold: 0.3, expertInjectBudgetChars: 2000 },
}
const cfgFetch = async (url, opts) => {
  const u = String(url)
  const method = (opts && opts.method) || 'GET'
  calls.push({ url: u, method: method, body: opts && opts.body })
  if (!/^https?:/i.test(u)) throw new Error('relative URL unavailable in desktop shell')
  if (u.indexOf('/settings/write') >= 0) {
    let body = {}
    try { body = JSON.parse(String((opts && opts.body) || '{}')) } catch (err) { body = {} }
    if (cfgConflict) {
      return { ok: false, status: 409, json: async () => ({ ok: false, error: 'conflict', expected: body.revision, actual: (body.revision || 0) + 1 }) }
    }
    if (cfgIgnoreDryRun) return jsonRes({ ok: true, ns: body.ns, dryRun: true, revision: cfgRevision, value: cfgMemValue, user: cfgMemUser })
    if (body.dryRun !== false) return jsonRes({ ok: true, ns: body.ns, dryRun: true })
    const nextValue = Object.assign({}, cfgMemValue)
    const nextUser = Object.assign({}, cfgMemUser)
    for (const op of (body.ops || [])) {
      const k = op && Array.isArray(op.path) ? op.path[0] : ''
      if (!k) continue
      if (op.op === 'unset') { delete nextUser[k]; nextValue[k] = CFG_MEM_DEFAULTS[k] }
      else { nextValue[k] = op.value; nextUser[k] = op.value }
    }
    if (body.ns === 'work-memory') { cfgMemValue = nextValue; cfgMemUser = nextUser }
    cfgRevision = (typeof body.revision === 'number' ? body.revision : cfgRevision) + 1
    return jsonRes({ ok: true, ns: body.ns, revision: cfgRevision, value: nextValue, user: nextUser })
  }
  if (u.indexOf('/experts/preview') >= 0) {
    if (cfgExpertMode !== 'on') return jsonRes({ ok: false, unavailable: true, message: '专家库（dsh-experts）未安装或无法加载' })
    return jsonRes(CFG_PREVIEW_PAYLOAD)
  }
  if (u.indexOf('/settings') >= 0) return jsonRes({ ok: true, namespaces: cfgNamespaces() })
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  if (u.indexOf('/plugins') >= 0) return jsonRes(PLUGINS_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}

// ── 段 1：骨架 —— 五个页签不变 + 四组齐全 + 只读枚举 ──────────────
globalThis.fetch = cfgFetch
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let cfTree = expand(reg.render({ initialTab: 'config' }))
let cfText = collect(cfTree, []).join(' | ')
ok(['安装与检查', '核心配置', '配置', '关于与致谢'].every((x) => cfText.includes(x)),
  '页签 5 → 4（安装与检查 / 核心配置 / 配置 / 关于与致谢）')
ok(!cfText.includes('安装子插件'), '旧「安装子插件」页签已从页签栏移除')
ok(cfText.includes('读取中'), '首屏显示「读取中…」（异步枚举前骨架可读）')
const cfBootErr = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { cfBootErr.push(err) } }
ok(cfBootErr.length === 0, '能力配置页挂载 effect 不抛错')
await tick(60)
ok(calls.some((c) => c.method === 'GET' && c.url === 'http://dsh.internal/work-personal-secretary/api/settings'),
  '进入页 GET /settings（桌面载体命中合成基址）')

// ── 段 2：四组渲染 + 记忆库五个语义小节 + 已覆盖标记 ─────────────
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(['记忆库', '专家库', '文档能力', '桌面形象'].every((x) => cfText.includes(x)), '顶部插件级标签齐全（记忆库 / 专家库 / 文档能力 / 桌面形象）')
/**
 * 切到某个插件标签并重渲染（能力配置页按插件分批显示，不再四组铺开）。
 * 注意：文档能力 / 桌面形象是独立组件，切换后会**重新挂载并各自 fetch**，
 * 所以这里要跑一遍 effect 再等一拍，否则断言看到的还是 loading 态。
 */
const cfSwitchTo = async (gid) => {
  const btn = findByAttr(cfTree, 'data-cfg-group', gid).filter((b) => b.type === 'button')[0]
  if (btn) btn.props.onClick()
  hookCursor = 0
  effectQueue = []
  cfTree = expand(reg.render({ initialTab: 'config' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(80)
  hookCursor = 0
  effectQueue = []
  cfTree = expand(reg.render({ initialTab: 'config' }))
  cfText = collect(cfTree, []).join(' | ')
  return cfTree
}
ok(['每轮注入记忆', '快照标题词', '快照字符上限', '记忆库根目录', 'Obsidian 镜像目录'].every((x) => cfText.includes(x)),
  'T5 记忆库常显 5 键齐全（注入开关 / 标题词 / 字符上限 / 记忆库目录 / 镜像目录）')
ok(cfText.includes('高级设置（8 项）'), 'T5 记忆库高级档折叠为 8 项')
ok(cfText.includes('快照字符上限') && cfText.includes('Obsidian 镜像目录'), '默认只渲染记忆库（顶部标签默认选中记忆库）')
ok(cfText.includes('已覆盖'), 'user 层含该键 → 显示「已覆盖」标记')
const cfNum0 = findByAttr(cfTree, 'data-cfg-key', 'snapshotMaxChars').filter((x) => x.type === 'input')[0]
ok(cfNum0 && String(cfNum0.props.value) === '6000', '数字字段用输入框并回显覆盖值 6000')
const cfUnsetBtns = findByAttr(cfTree, 'data-cfg-action', 'unset')
const cfRestoreBtns = findByAttr(cfTree, 'data-cfg-action', 'restore')
ok(cfUnsetBtns.length === 13, 'T5 记忆库渲染 5 常显 + 8 高级 = 13 项，各有「清除覆盖」（实测 ' + cfUnsetBtns.length + '）')
ok(cfRestoreBtns.length === 13, 'T5 记忆库 13 项各有「恢复默认」（实测 ' + cfRestoreBtns.length + '）')
ok(cfUnsetBtns.filter((b) => b.props.disabled !== true).length === 2, '只有用户层覆盖过的两个键「清除覆盖」可用')

// 切到专家库标签：只渲染专家库
await cfSwitchTo('experts')
ok(cfText.includes('注入形态') && !cfText.includes('快照字符上限'), '切到专家库后只渲染专家库（记忆库字段不再出现）')
const cfUnsetExp = findByAttr(cfTree, 'data-cfg-action', 'unset')
ok(cfUnsetExp.length === 9, 'T5 专家库渲染 4 常显 + 5 高级 = 9 项，各有「清除覆盖」（实测 ' + cfUnsetExp.length + '）')
const cfRanges = findAll(cfTree, (x) => x.type === 'input' && x.props && x.props.type === 'range', [])
ok(cfRanges.length === 2, 'T5 专家库只剩两个预算渲染为滑块（注入字符预算 / 能力层指针预算；实测 ' + cfRanges.length + '）')
ok(findByAttr(cfTree, 'data-cfg-key', 'expertInjectMax').length === 0,
  'expertInjectMax 已从设置页移除（写死 4，不再渲染任何控件；实测 '
  + findByAttr(cfTree, 'data-cfg-key', 'expertInjectMax').length + '）')
const cfSelects = findSelects(cfTree)
ok(cfSelects.length === 2, 'defaultDomain 与 expertInjectDetail 各渲染为下拉（实测 ' + cfSelects.length + '）')
const cfSelectText = collect(cfSelects[0], []).join(' | ')
ok(['信息安全', '财务', '人力资源', '代码编程', '金融', '通用职能'].every((x) => cfSelectText.includes(x)),
  '岗位域下拉六项带中文标签')
ok(cfSelects[0].props.value === 'infosec', '岗位域下拉回显当前值')
// identityExpert 自 dsh-experts 0.3.0「身份退场」起移出配置页（settings.yaml 仍可配）
ok(findByAttr(cfTree, 'data-cfg-key', 'identityExpert').length === 0, 'identityExpert 已从配置页移除（不渲染）')

// 文档能力标签
await cfSwitchTo('docs')
ok(cfText.includes('office-word') && cfText.includes('pdf-tools') && cfText.includes('未检测'), '文档能力面板显示四技能清单（不空）')
ok(cfText.includes('Python') && cfText.includes('WPS Office'), '文档能力面板显示 Python / WPS 依赖状态')

// 桌面形象标签
await cfSwitchTo('pet')
ok(cfText.includes('0.5.1') && cfText.includes('打开桌面形象面板'), '桌面形象分组显示安装状态与跳转按钮')

// 切回记忆库：后续段 3/4 都在记忆库上下文操作
await cfSwitchTo('work-memory')

// ── 段 3：编辑草稿 → 「保存改动」→ POST /settings/write（dryRun:false） ──
cfNum0.props.onChange({ target: { value: '7777' } })
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
let cfSave = findByAttr(cfTree, 'data-cfg-action', 'save').filter((b) => b.props['data-cfg-ns'] === 'work-memory')[0]
ok(Boolean(cfSave) && label(cfSave) === '保存改动（1）', '编辑后主按钮变为「保存改动（1）」')
ok(String(findByAttr(cfTree, 'data-cfg-key', 'snapshotMaxChars').filter((x) => x.type === 'input')[0].props.value) === '7777',
  '输入先进本地草稿（未保存也已回显）')
calls.length = 0
cfSave.props.onClick()
await tick(60)
const cfPosts = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/settings/write') >= 0)
ok(cfPosts.length === 1, '「保存改动」只发一次 POST /settings/write（实测 ' + cfPosts.length + '）')
const cfBody = cfPosts.length ? JSON.parse(String(cfPosts[0].body)) : {}
ok(cfBody.ns === 'work-memory', 'body.ns = work-memory（白名单命名空间）')
ok(cfBody.dryRun === false, 'body 恒带 dryRun:false（真写，不是试运行）')
ok(cfBody.revision === 12, 'body 带当前 revision（栅栏；实测 ' + String(cfBody.revision) + '）')
ok(JSON.stringify(cfBody.ops) === JSON.stringify([{ op: 'set', path: ['snapshotMaxChars'], value: 7777 }]),
  'ops 只发有变化的键且数字保持数字类型')
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(cfText.includes('已保存'), '保存成功给出回执')
ok(String(findByAttr(cfTree, 'data-cfg-key', 'snapshotMaxChars').filter((x) => x.type === 'input')[0].props.value) === '7777', '保存后回填新值')
ok(cfText.includes('版本 r13'), 'revision 前进到 r13（实测文本含「版本 r13」）')

// ── 段 4：「清除覆盖」= 单键 unset ──────────────────────────────
calls.length = 0
const cfUnset = findByAttr(cfTree, 'data-cfg-action', 'unset').filter((b) => b.props['data-cfg-key'] === 'backupDir')[0]
ok(Boolean(cfUnset) && cfUnset.props.disabled !== true, '已覆盖的键可点「清除覆盖」')
cfUnset.props.onClick()
await tick(60)
const cfUnsetPosts = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/settings/write') >= 0)
ok(cfUnsetPosts.length === 1, '「清除覆盖」即时发一次写入（实测 ' + cfUnsetPosts.length + '）')
const cfUnsetBody = cfUnsetPosts.length ? JSON.parse(String(cfUnsetPosts[0].body)) : {}
ok(JSON.stringify(cfUnsetBody.ops) === JSON.stringify([{ op: 'unset', path: ['backupDir'] }]),
  'ops = [{ op:"unset", path:["backupDir"] }]（回到 base / 默认）')
ok(cfUnsetBody.dryRun === false, 'unset 同样带 dryRun:false')
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
ok(findByAttr(cfTree, 'data-cfg-action', 'unset').filter((b) => b.props.disabled !== true).length === 1,
  '清除后只剩 snapshotMaxChars 仍可「清除覆盖」')

// ── 段 5：「恢复默认」= set schema 默认值 ────────────────────────
calls.length = 0
const cfRestore = findByAttr(cfTree, 'data-cfg-action', 'restore').filter((b) => b.props['data-cfg-key'] === 'snapshotMaxChars')[0]
ok(Boolean(cfRestore) && cfRestore.props.disabled !== true, '值与默认不同时「恢复默认」可用')
cfRestore.props.onClick()
await tick(60)
const cfRestorePosts = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/settings/write') >= 0)
ok(cfRestorePosts.length === 1, '「恢复默认」即时发一次写入')
const cfRestoreBody = cfRestorePosts.length ? JSON.parse(String(cfRestorePosts[0].body)) : {}
ok(JSON.stringify(cfRestoreBody.ops) === JSON.stringify([{ op: 'set', path: ['snapshotMaxChars'], value: 4000 }]),
  '恢复默认 = set 到接口给的 schema 默认值 4000')

// ── 段 6：409 冲突 → 提示 + 自动重读 + 不丢输入 ──────────────────
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
findByAttr(cfTree, 'data-cfg-key', 'personaLabel').filter((x) => x.type === 'input')[0]
  .props.onChange({ target: { value: '我的记忆' } })
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfgConflict = true
calls.length = 0
const cfSave409 = findByAttr(cfTree, 'data-cfg-action', 'save').filter((b) => b.props['data-cfg-ns'] === 'work-memory')[0]
cfSave409.props.onClick()
await tick(80)
cfgConflict = false
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(cfText.includes('设置已被其他改动更新'), '409 → 提示「设置已被其他改动更新」')
ok(calls.filter((c) => c.method === 'GET' && c.url.indexOf('/work-personal-secretary/api/settings') >= 0).length === 1,
  '409 后自动重读一次 GET /settings（实测 '
  + calls.filter((c) => c.method === 'GET' && c.url.indexOf('/work-personal-secretary/api/settings') >= 0).length + '）')
ok(String(findByAttr(cfTree, 'data-cfg-key', 'personaLabel').filter((x) => x.type === 'input')[0].props.value) === '我的记忆',
  '冲突重读后使用者输入仍在（草稿不被覆盖）')
ok(label(findByAttr(cfTree, 'data-cfg-action', 'save').filter((b) => b.props['data-cfg-ns'] === 'work-memory')[0]) === '保存改动（1）',
  '冲突后草稿仍算 1 项待保存（可再次提交）')

// ── 段 7：专家打分实时预览（只读） ──────────────────────────────
await cfSwitchTo('experts')
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
const cfPvInput = findByAttr(cfTree, 'data-cfg-action', 'preview-text')[0]
ok(Boolean(cfPvInput), '预览区有任务文本框')
cfPvInput.props.onChange({ target: { value: '这份合同的付款与税务怎么处理？' } })
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
const cfPvBtn = findByAttr(cfTree, 'data-cfg-action', 'preview')[0]
ok(Boolean(cfPvBtn) && cfPvBtn.props.disabled !== true, '填了文本后「试算」可用')
calls.length = 0
cfPvBtn.props.onClick()
await tick(60)
const cfPvGet = calls.filter((c) => c.method === 'GET' && c.url.indexOf('/experts/preview') >= 0)
ok(cfPvGet.length === 1, '预览走 GET /experts/preview（实测 ' + cfPvGet.length + '）')
ok(cfPvGet.length > 0 && cfPvGet[0].url.indexOf('text=' + encodeURIComponent('这份合同的付款与税务怎么处理？')) >= 0,
  '任务文本经 URL 编码传入 text=')
ok(calls.every((c) => c.method === 'GET'), '预览全程只读：不产生任何写入')
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(cfText.includes('infosec-ics-security') && cfText.includes('infosec-djbh'), '渲染注入名单（两位专家）')
ok(cfText.includes('0.9') && cfText.includes('0.7'), '渲染每位 score')
ok(cfText.includes('关键词·等保') && cfText.includes('身份专家'), '渲染每位 reasons')
ok(cfText.includes('identity+1'), '渲染判定理由 reason')
ok(cfText.includes('expertInjectMax=4') && cfText.includes('expertSecondThreshold=0.3') && cfText.includes('expertInjectBudgetChars=2000'),
  '渲染试算所用三项阈值（expertInjectMax 只读回显；expertMinScore 已于 0.3.0 删除）')

// ── 段 8a：降级 —— 子插件未安装（宿主给 installed:false 占位条目） ──
cfgExpertMode = 'placeholder'
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
// 占位降级发生在专家库标签内（该 ns 未安装），切过去看
await cfSwitchTo('experts')
ok(cfText.includes('本机服务未提供该能力的设置命名空间'), 'installed:false 占位条目 → 分组内可读降级提示（不渲染 11 个禁用字段）')
ok(findByAttr(cfTree, 'data-cfg-action', 'save').length === 0, '未安装的分组不出现「保存改动」按钮（实测 '
  + findByAttr(cfTree, 'data-cfg-action', 'save').length + '）')
ok(cfText.includes('记忆库') && cfText.includes('专家库') && cfText.includes('文档能力'), '降级时顶部标签仍在（不出现空分组）')
findByAttr(cfTree, 'data-cfg-action', 'preview-text')[0].props.onChange({ target: { value: '预览降级用例' } })
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
findByAttr(cfTree, 'data-cfg-action', 'preview')[0].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
cfText = collect(expand(reg.render({ initialTab: 'config' })), []).join(' | ')
ok(cfText.includes('专家库未安装或未启用'), '预览 available:false → 可读降级提示且不崩')
ok(cfText.includes('未安装或无法加载'), '预览降级时回显服务端的可读 message')

// ── 段 8b：降级 —— 宿主响应里干脆没有该 ns（兼容形态） ──────────
cfgExpertMode = 'absent'
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
cfText = collect(expand(reg.render({ initialTab: 'config' })), []).join(' | ')
ok(cfText.includes('快照字符上限'), '记忆库仍正常渲染（一个 ns 缺失不影响另一个）')
await cfSwitchTo('experts')
ok(cfText.includes('本机服务未提供该能力的设置命名空间'), 'ns 完全缺失 → 同样给可读降级提示')
cfgExpertMode = 'on'

// ── 段 8c：服务端忽略 dryRun:false → 不谎报成功，草稿保留 ────────
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
findByAttr(cfTree, 'data-cfg-key', 'snapshotLimitGlobal').filter((x) => x.type === 'input')[0]
  .props.onChange({ target: { value: '9' } })
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfgIgnoreDryRun = true
findByAttr(cfTree, 'data-cfg-action', 'save').filter((b) => b.props['data-cfg-ns'] === 'work-memory')[0].props.onClick()
await tick(60)
cfgIgnoreDryRun = false
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(cfText.includes('仍按试运行处理'), '服务端 dryRun:true → 明确提示未真正写入（不谎报「已保存」）')
ok(cfText.indexOf('已保存（') < 0, '试运行场景不显示成功回执')
ok(String(findByAttr(cfTree, 'data-cfg-key', 'snapshotLimitGlobal').filter((x) => x.type === 'input')[0].props.value) === '9',
  '试运行场景草稿保留（改动不丢）')

// ── 段 9：服务完全不可用 —— 页面不崩、四组仍在 ──────────────────
globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (!/^https?:/i.test(String(url))) throw new Error('relative URL unavailable in desktop shell')
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
expand(reg.render({ initialTab: 'config' }))
const cfDownErr = []
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { cfDownErr.push(err) } }
await tick(80)
ok(cfDownErr.length === 0, '服务完全不可用（404）时挂载 effect 不抛错')
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')
ok(cfText.includes('能力配置读取失败') && cfText.includes('重试'), '显示可读错误与「重试」而非白屏')
ok(['记忆库', '专家库', '文档能力', '桌面形象'].every((x) => cfText.includes(x)), '降级时四组标签仍在')
ok(cfText.includes('本机服务未提供该能力的设置命名空间'), '记忆库分组给出可读降级提示')
await cfSwitchTo('experts')
ok(cfText.includes('本机服务未提供该能力的设置命名空间'), '专家库分组给出可读降级提示')
await cfSwitchTo('docs')
ok(cfText.includes('office-word') && cfText.includes('pdf-tools') && cfText.includes('/doc-doctor'),
  '文档面板在无接口时仍显示四技能清单与自检说明（不空分组）')
ok(cfText.includes('未能取到依赖状态'), '文档面板给出可读降级提示')
await cfSwitchTo('pet')
ok(cfText.includes('未能取到安装状态'), '桌面形象面板给出可读降级提示')

// ── 段 10：桌面形象跳转（无 DOM 载体 → 可读提示，不崩） ─────────
const cfPetBtn = findByAttr(cfTree, 'data-cfg-action', 'open-pet')[0]
ok(Boolean(cfPetBtn), '桌面形象分组有跳转按钮')
cfPetBtn.props.onClick()
hookCursor = 0
effectQueue = []
cfText = collect(expand(reg.render({ initialTab: 'config' })), []).join(' | ')
ok(cfText.includes('未能自动定位设置面板'), '无法自动跳转（无 DOM）时给出可读提示，页面不崩')

// ── 段 11：Web 载体 —— GET /settings 走根相对路径 ───────────────
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/settings') >= 0) return jsonRes({ ok: true, namespaces: cfgNamespaces() })
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  if (u.indexOf('/plugins') >= 0) return jsonRes(PLUGINS_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
expand(webReg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
ok(calls.some((c) => c.url === '/work-personal-secretary/api/settings'), 'Web 载体 GET /settings 走根相对路径（按包含判定；首个请求可能是 /check）')
ok(calls.every((c) => c.url.indexOf('dsh.internal') < 0), 'Web 载体不发合成基址请求')

// ── 段 12：重读要有可见反馈（真机曾误判「按钮被禁用」） ──────────
globalThis.fetch = cfgFetch
hookSlots = []
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
const cfReloadBtn = findButtons(cfTree).filter((b) => label(b) === '重新读取')[0]
ok(Boolean(cfReloadBtn) && cfReloadBtn.props.disabled !== true, '「重新读取」在加载完成后可点（disabled 只覆盖读取中）')
ok(collect(cfTree, []).join(' | ').includes('最近读取'), '加载完成后即显示「最近读取」时刻（首次加载也算，便于判断数据新鲜度）')
cfReloadBtn.props.onClick()
await tick(40)
hookCursor = 0
effectQueue = []
cfText = collect(expand(reg.render({ initialTab: 'config' })), []).join(' | ')
ok(cfText.includes('最近读取'), '点击「重新读取」后仍显示读取时刻（不白屏、不永久停在读取中）')

// ══════════════════════════════════════════════════════════════════
// [13] 1.1.3 改版：四页签 / 首屏 A 版 / 主按钮置灰 / 页内展开 / 核心配置门禁
// ══════════════════════════════════════════════════════════════════
console.log('\n[13] 1.1.3 改版（页签 / 首屏 / 主按钮 / 页内展开 / 门禁）')

const OK_CHECK = {
  ok: true,
  checkedAt: '2026-09-16T10:00:00+08:00',
  items: [
    { id: 'host', label: 'DSH 宿主', status: 'ok', value: '2.0.10', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'node', label: 'Node.js', status: 'ok', value: 'v24.18.1', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'python', label: 'Python', status: 'ok', value: '3.12.10', detail: '', fixKind: 'winget', fixCommand: 'winget install --id Python.Python.3.12', autoFixable: true },
    { id: 'pythonDeps', label: 'Python 依赖', status: 'ok', value: '8/8 就绪', detail: '', fixKind: 'pip', fixCommand: 'py -3 -m pip install x', autoFixable: true },
    { id: 'wps', label: 'WPS Office', status: 'ok', value: 'KWPS.Application 可实例化', detail: '', fixKind: 'winget', fixCommand: 'winget install --id Kingsoft.WPSOffice', autoFixable: true },
    { id: 'obsidian', label: 'Obsidian', status: 'ok', value: '已安装', detail: '', fixKind: 'winget', fixCommand: 'winget install --id Obsidian.Obsidian', autoFixable: true },
    { id: 'subPlugins', label: '子插件', status: 'ok', value: '5/5 已装',
      detail: 'dsh-work-memory@1.0.5、dsh-doc-suite@0.7.9、dsh-experts@0.5.7、dsh-mermaid@0.4.0、workspace-tokenpet@1.0.1',
      fixKind: 'none', fixCommand: '', autoFixable: false },
  ],
  summary: { ok: 7, warn: 0, missing: 0, skip: 0 },
}
const OK_PLUGINS = {
  ok: true, repoRoot: 'C:/repo',
  plugins: [
    { id: 'dsh-work-memory', installed: true, installedVersion: '1.0.5', version: '1.0.5', upToDate: true },
    { id: 'dsh-doc-suite', installed: true, installedVersion: '0.7.9', version: '0.7.9', upToDate: true },
    { id: 'dsh-experts', installed: true, installedVersion: '0.5.7', version: '0.5.7', upToDate: true },
    { id: 'dsh-mermaid', installed: true, installedVersion: '0.4.0', version: '0.4.0', upToDate: true },
    { id: 'workspace-tokenpet', installed: true, installedVersion: '1.0.1', version: '1.0.1', upToDate: true },
  ],
}
// 说明页取的是**完整文档**（宿主 renderPage 的形态：DOCTYPE + head/title + 自带 <style>），
// 客户端把这份 HTML 写入独立新窗口（不再让浏览器导航受保护地址，也不会注入设置页 DOM）
// 说明页 = 插件目录里预先做好的 HTML 文件：客户端只调 POST /open-doc，由宿主用系统默认程序打开；
// /docs 给出两个文件的存在性与路径（只读，可选能力）
const DOCS_PAYLOAD = {
  ok: true,
  items: [
    { doc: 'guide', path: 'C:/plugins/work-personal-secretary/doc/guide.html', exists: true },
    { doc: 'help', path: 'C:/plugins/work-personal-secretary/doc/help.html', exists: true },
  ],
}
const htmlRes = (html) => ({ ok: true, status: 200, text: async () => html, json: async () => { throw new Error('not json') } })
const allOkFetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/open-doc') >= 0) {
    return jsonRes({ ok: true, doc: 'help', path: 'C:/plugins/work-personal-secretary/doc/help.html', command: 'open help.html' })
  }
  if (u.indexOf('/docs') >= 0) return jsonRes(DOCS_PAYLOAD)
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  if (u.indexOf('/plugins') >= 0) return jsonRes(OK_PLUGINS)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
globalThis.fetch = allOkFetch

// 首屏 + 页签
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let nTree = expand(reg.render({ initialTab: 'install' }))
let nText = collect(nTree, []).join(' | ')
ok(!nText.includes('检查运行环境、安装五个子插件'), 'A1：首屏描述整句已删除（标题下不再留说明书式描述）')
// BUILD 真比对（T10 升级）：读 package.json 的 version，断言 BUILD === 'v' + version
const pkgVersion = (() => {
  try { return String(JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version || '') } catch (err) { return '' }
})()
const buildMatch = String(src).match(/const BUILD = '([^']+)'/)
const buildConst = buildMatch ? buildMatch[1] : ''
ok(buildConst !== '' && buildConst === 'v' + pkgVersion,
  '客户端 BUILD 常量 === "v" + package.json.version（实测 BUILD=' + buildConst + ' / pkg=' + pkgVersion + '）')
ok(nText.includes('work-personal-secretary ' + buildConst), '状态条渲染的就是该 BUILD 常量（' + buildConst + '）')
// R-4：页签要**恰等四项**（按 data-tab 取全集，不再只数白名单内的标签）
const wantTabs = ['安装与检查', '核心配置', '配置', '关于与致谢']
const tabEls = findAll(nTree, (x) => Boolean(x.props && x.props['data-tab']), [])
ok(tabEls.length === 4, '页签恰有四项（实测 ' + tabEls.length + '）')
ok(String(tabEls.map((b) => b.props['data-tab']).join(',')) === 'install,core,config,about',
  '页签顺序与 id 固定（实测 ' + String(tabEls.map((b) => b.props['data-tab']).join(',')) + '）')
ok(tabEls.every((b) => wantTabs.indexOf(label(b)) >= 0), '四个页签文案都在白名单内')
ok(!nText.includes('安装子插件') && !nText.includes('能力配置'), '旧页签文案不再出现（安装子插件 / 能力配置）')

// 主按钮置灰（依赖组 + 子插件组全正常）
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(80)
hookCursor = 0
effectQueue = []
nTree = expand(reg.render({ initialTab: 'install' }))
nText = collect(nTree, []).join(' | ')
const readyBtn = findButtons(nTree).filter((b) => label(b) === '环境已就绪')[0]
ok(Boolean(readyBtn) && readyBtn.props.disabled === true, '依赖组 + 子插件组全正常 → 主按钮置灰（「环境已就绪」）')
ok(nText.includes('6/6 正常') && nText.includes('5/5 已装'), '分组徽标：环境依赖 6/6 正常 · 子插件 5/5 已装')

// 说明页：交给宿主打开插件目录里的 HTML 文件（各分支在 [16] 段详测）
const helpBtn = findButtons(nTree).filter((b) => label(b) === '使用说明')[0]
ok(Boolean(helpBtn), '「使用说明」按钮存在且可点')
calls.length = 0
if (helpBtn) helpBtn.props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
nTree = expand(reg.render({ initialTab: 'install' }))
nText = collect(nTree, []).join(' | ')
const openDocCalls13 = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/open-doc') >= 0)
ok(openDocCalls13.length === 1 && String(openDocCalls13[0].body) === JSON.stringify({ doc: 'help' }),
  '点击「使用说明」→ POST /open-doc { doc: "help" }（实测 ' + String(openDocCalls13[0] && openDocCalls13[0].body) + '）')
ok(nText.indexOf('已打开说明页') >= 0 && nText.indexOf('help.html') >= 0, '成功后就地回显「已打开说明页」+ 文件路径')
ok(String(src).indexOf('document.write') < 0 && String(src).indexOf('window.open') < 0,
  '客户端不再自己开窗 / 写文档（改由宿主打开）')

// 门禁：未就绪 → 门禁卡 + 整页灰化（pointer-events:none）
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
let cTree = expand(reg.render({ initialTab: 'core' }))
let cText = collect(cTree, []).join(' | ')
ok(cText.includes('先满足最低使用需求') && cText.includes('去安装与检查'), '门禁未就绪：门禁卡可见（标题 + 去安装与检查）')
ok(cText.includes('记忆库插件') && cText.includes('Python 解释器') && cText.includes('Python 工具'), '门禁卡逐项列出三项')
ok(cText.includes('记忆库工作目录在本页填写，不作为解锁条件'), '门禁卡说明：记忆库工作目录不参与判定（设计定稿 §3.1）')
const gatedBox = findAll(cTree, (x) => Boolean(x.props && x.props.style && x.props.style.pointerEvents === 'none'), [])[0]
ok(Boolean(gatedBox), '门禁未就绪：正文容器 pointer-events:none（整页灰化）')

// 门禁：三项就绪 → **不自动解锁**，等使用者点「点击此处继续」（D3）
globalThis.fetch = allOkFetch
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
cTree = expand(reg.render({ initialTab: 'core' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
cTree = expand(reg.render({ initialTab: 'core' }))
cText = collect(cTree, []).join(' | ')
ok(cText.includes('先满足最低使用需求') && cText.includes('点击此处继续'),
  'D3：三项就绪后仍停在门禁卡，按钮变为「点击此处继续」')
ok(!cText.includes('去安装与检查'), 'D3：全绿时不再显示「去安装与检查」')
const gcBtn = findButtons(cTree).filter((b) => label(b) === '点击此处继续')[0]
ok(Boolean(gcBtn), 'D3：找到「点击此处继续」按钮')
hookCursor = 0
effectQueue = []
if (gcBtn) gcBtn.props.onClick()
cTree = expand(reg.render({ initialTab: 'core' }))
cText = collect(cTree, []).join(' | ')
ok(!cText.includes('先满足最低使用需求'), 'D3：点击后门禁卡消失（进入配置表单）')
ok(cText.includes('目录与岗位') && cText.includes('保存配置并开始'), '点击后显示目录与岗位表单 + 保存条')
ok(!findAll(cTree, (x) => Boolean(x.props && x.props.style && x.props.style.pointerEvents === 'none'), []).length,
  '解锁后不再有灰化容器')
// D1：核心配置页不再自己发 /check（只发一次，由 Section 统一持有）
const checkCount = calls.filter((c) => c.method === 'GET' && c.url === 'http://dsh.internal/work-personal-secretary/api/check').length
ok(checkCount <= 1, 'D1：进入核心配置页不再重复发 /check（本次实测 ' + checkCount + ' 次）')

// ══════════════════════════════════════════════════════════════════
// [14] T4 核心配置：目录与岗位 + 保存即执行链 + 导入引导卡
// ══════════════════════════════════════════════════════════════════
console.log('\n[14] 核心配置（T4：字段顺序 / 保存置灰 / 执行链 / 失败重试 / 导入卡）')

const DOMAIN_ITEMS = [
  { id: 'infosec', label: '信息安全（infosec）', content: 'me-domain-infosec' },
  { id: 'accounting', label: '财务（accounting）', content: 'me-domain-accounting' },
  { id: 'hr', label: '人力资源（hr）', content: 'me-domain-hr' },
  { id: 'coding', label: '代码编程（coding）', content: 'me-domain-coding' },
  { id: 'finance', label: '金融（finance）', content: 'me-domain-finance' },
]
let bdCalls = []
let identityPayload = null
let preflightPayload = null
let failKnowledge = false
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  if (u.indexOf('/domain/list') >= 0) return jsonRes({ ok: true, prefix: '使用者身份：', maxChars: 200, items: DOMAIN_ITEMS })
  if (u.indexOf('/preflight') >= 0) {
    preflightPayload = JSON.parse(String((opts && opts.body) || '{}'))
    return jsonRes({
      ok: true, ready: true,
      checks: [{ id: 'memoryDir', label: '记忆库目录', level: 'ok', ok: true, detail: '可用' },
        { id: 'obsidianDir', label: 'Obsidian 知识库目录', level: 'ok', ok: true, detail: '可用' }],
      summary: { total: 2, ok: 2, warn: 0, block: 0 }, checkedAt: '2026-09-16T11:00:00+08:00',
    })
  }
  if (u.indexOf('/basedeck') >= 0) {
    const body = JSON.parse(String((opts && opts.body) || '{}'))
    bdCalls.push(body)
    // GET = 干跑预览（迁移步先只读探一次来源）。这里给一个「检测到旧记忆库」，
    // 目的是让迁移步真的发一次 POST —— 只有它发了 POST，下面才能断言「迁移排在建立结构之前」。
    if ((opts && opts.method) !== 'POST') {
      return jsonRes({ ok: true, dryRun: true, migrateFrom: 'D:/old-mem', results: [], wroteAny: false })
    }
    if (failKnowledge && (body.ids || []).indexOf('knowledgeDeck') >= 0) {
      return jsonRes({ ok: true, dryRun: false, results: [{ id: 'knowledgeDeck', ok: false, error: '目标目录不可写（模拟失败）' }] })
    }
    const results = (body.ids || []).map((id) => ({ id: id, ok: true, dryRun: false, action: '写入 ' + id, target: 'D:/fake/' + id }))
    return jsonRes({ ok: true, dryRun: false, results: results, wroteAny: true })
  }
  if (u.indexOf('/identity/save') >= 0) {
    identityPayload = JSON.parse(String((opts && opts.body) || '{}'))
    return jsonRes({ ok: true, status: 'rewrite', entryId: 'id-1', detail: '将整条改写「使用者身份」条目', personaUntouched: true, othersUntouched: true })
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}

hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let t4Tree = expand(reg.render({ initialTab: 'core' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(80)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
let t4Text = collect(t4Tree, []).join(' | ')

const iMem = t4Text.indexOf('记忆库目录')
const iObs = t4Text.indexOf('Obsidian 知识库目录')
const iJob = t4Text.indexOf('工作岗位')
ok(iMem >= 0 && iObs > iMem && iJob > iObs, '字段顺序：记忆库目录 → Obsidian 目录 → 工作岗位')

const findSave = () => findButtons(t4Tree).filter((b) => label(b) === '保存配置并开始')[0]
ok(Boolean(findSave()) && findSave().props.disabled === true, '三项未齐时保存按钮 disabled')

// 新模型（主人 2026-09-16 定）：使用者只选**一个存储根目录**，两个目录由它派生；
// 本夹具的 /setup-state 是 404（没有生效值），所以根目录为空、两个目录按「自动派生」显示为只读空值。
const t4Inputs = () => findAll(t4Tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
ok(t4Inputs().length === 3, '存储根目录 + 两个派生目录共 3 个输入框（实测 ' + t4Inputs().length + '）')
ok(t4Inputs()[1].props.disabled === true && t4Inputs()[2].props.disabled === true,
  '两个派生目录默认只读（由存储根目录自动生成，须显式点「单独指定」才能改）')
t4Inputs()[0].props.onChange({ target: { value: 'D:/ws' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
ok(t4Inputs()[1].props.value === 'D:\\ws\\memory-data' && t4Inputs()[2].props.value === 'D:\\ws\\obsidian-data',
  '填根目录（正斜杠）→ 两个目录自动派生，且统一成 Windows 反斜杠写法（实测 ' + t4Inputs()[1].props.value + ' / ' + t4Inputs()[2].props.value + '）')
ok(findSave().props.disabled === true, '只填目录、未选岗位时仍 disabled')

const t4Sel = findAll(t4Tree, (x) => x.type === 'select', [])[0]
ok(Boolean(t4Sel), '岗位下拉存在')
const optTexts = collect(findAll(t4Tree, (x) => x.type === 'option', []), []).join(' | ')
ok(DOMAIN_ITEMS.every((d) => optTexts.indexOf(d.label) >= 0), '五个预置岗位来自 GET /domain/list（不在前端写死）')
ok(optTexts.indexOf('都不是（新建岗位…）') >= 0, '岗位下拉含「都不是（新建岗位…）」')
ok(optTexts.indexOf('通用职能') < 0, '岗位下拉无「通用职能」')
t4Sel.props.onChange({ target: { value: 'infosec' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
ok(findSave().props.disabled !== true, '三项齐备 → 保存按钮可点')

calls.length = 0
findSave().props.onClick()
await tick(150)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
const t4Seq = calls.filter((c) => c.method === 'POST').map((c) => {
  const b = JSON.parse(String(c.body || '{}'))
  return (b.ids ? '/basedeck:' + b.ids.join(',') : String(c.url).replace(/^.*\/api/, ''))
})
ok(String(t4Seq) === String(['/preflight', '/basedeck:migrateMemory', '/basedeck:memoryDeck', '/basedeck:knowledgeDeck', '/basedeck:settings', '/identity/save']),
  '执行链按序发请求：preflight → migrateMemory → memoryDeck → knowledgeDeck → settings → identity/save（实测 ' + String(t4Seq) + '）')
// 顺序的**后果**断言：迁移只补缺失、不覆盖，排在建结构之后就会把 MEMORY.md / USER.md /
// GRAPH.json / PROJECTS/工作秘书.md 判成「同名但内容不同」而全部跳过（旧记忆一个都进不来）。
ok(t4Seq.indexOf('/basedeck:migrateMemory') > -1 && t4Seq.indexOf('/basedeck:migrateMemory') < t4Seq.indexOf('/basedeck:memoryDeck'),
  '迁移排在建立记忆库结构之前（否则旧库 MEMORY.md / USER.md / GRAPH.json / PROJECTS 会被判冲突而全部跳过）')
ok(Boolean(preflightPayload) && preflightPayload.dryRun === undefined, '可用性检查是只读的（不传 dryRun）')
const bdWrites = bdCalls.filter((b) => Array.isArray(b.ids))
ok(bdWrites.length === 4 && bdWrites.every((b) => b.dryRun === false),
  '四次 basedeck 写请求均显式 dryRun:false（迁移步的只读 GET 不计；实测写 ' + bdWrites.length + ' 次 / 全部 ' + bdCalls.length + ' 次）')
const t4Link = bdCalls.filter((b) => (b.ids || []).indexOf('settings') >= 0)[0]
ok(Boolean(t4Link) && String(t4Link.overrides.obsidianSyncDir).indexOf('00_全局记忆') >= 0,
  '第 3 步关联：basedeck settings 的 overrides.obsidianSyncDir = <Obsidian 目录>/00_全局记忆（实测 ' + (t4Link && t4Link.overrides.obsidianSyncDir) + '）')
ok(Boolean(t4Link) && t4Link.overrides.memoryDir === 'D:\\ws\\memory-data', '第 3 步关联：overrides.memoryDir 取派生值（<根>/memory-data）')
ok(Boolean(identityPayload) && identityPayload.dryRun === false && identityPayload.content === 'me-domain-infosec',
  '写入身份：dryRun:false，content 为岗位正文（不含「使用者身份：」前缀）')
ok(Boolean(identityPayload) && identityPayload.memoryDir === 'D:\\ws\\memory-data', '写入身份带上 memoryDir（派生值）')
ok(t4Text.indexOf('建立两者关联') >= 0 && t4Text.indexOf('已完成') >= 0, '执行链五项全绿（徽标「已完成」）')
ok(t4Text.indexOf('已有旧内容要带过来？') >= 0 && t4Text.indexOf('浏览… 选择知识库或记忆文件夹') >= 0,
  '全绿后出现导入引导卡（入口 + 标题）')
ok(t4Text.indexOf('只读源目录、只补还没有的文件、不覆盖现有文件、先给预览再逐项对照确认后才落盘') >= 0,
  '导入卡含纪律说明（逐项对照确认后才落盘）')

failKnowledge = true
calls.length = 0
bdCalls = []
findSave().props.onClick()
await tick(150)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
ok(t4Text.indexOf('目标目录不可写（模拟失败）') >= 0, '任一步失败：停在该步并回显可读原因')
ok(calls.filter((c) => c.method === 'POST').every((c) => String(c.url).indexOf('/identity/save') < 0),
  '失败后不继续后续步（未发 identity/save）')
const t4Retry = findButtons(t4Tree).filter((b) => label(b) === '重试')[0]
ok(Boolean(t4Retry), '失败后出现「重试」按钮')
failKnowledge = false
calls.length = 0
t4Retry.props.onClick()
await tick(200)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
const t4RetrySeq = calls.filter((c) => c.method === 'POST').map((c) => {
  const b = JSON.parse(String(c.body || '{}'))
  return (b.ids ? '/basedeck:' + b.ids.join(',') : String(c.url).replace(/^.*\/api/, ''))
})
ok(String(t4RetrySeq) === String(['/basedeck:knowledgeDeck', '/basedeck:settings', '/identity/save']),
  '「重试」从失败步继续、不重发 preflight / memoryDeck（实测 ' + String(t4RetrySeq) + '）')
t4Text = collect(t4Tree, []).join(' | ')
ok(t4Text.indexOf('已有旧内容要带过来？') >= 0, '重试成功后导入引导卡出现')

// 新建岗位对话框 + POST /domain/generate（503 → 改成手填，绝不假成功）
let genMode = 503
const t4Base = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.indexOf('/domain/generate') >= 0) {
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
    if (genMode === 503) {
      return { ok: false, status: 503, json: async () => ({ ok: false, code: 'no-model-service', error: '当前 profile 未提供模型服务，请改为手填岗位内容' }) }
    }
    // 'long'：服务端给了超长正文（模拟口径变化 / 手改接口），用于验证前端二次截断
    if (genMode === 'long') {
      return jsonRes({ ok: true, content: new Array(500).join('字'), channel: 'llm', provider: 'p', model: 'm', maxChars: 200 })
    }
    return jsonRes({ ok: true, content: 'me-generated-job', channel: 'llm', provider: 'p', model: 'm', maxChars: 200 })
  }
  return t4Base(url, opts)
}
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
findAll(t4Tree, (x) => x.type === 'select', [])[0].props.onChange({ target: { value: '__new__' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
ok(t4Text.indexOf('新建岗位') >= 0 && t4Text.indexOf('自动生成') >= 0 && t4Text.indexOf('保存岗位') >= 0,
  '选「都不是（新建岗位…）」→ 对话框出现（名称 / 内容 / 自动生成 / 保存）')
findButtons(t4Tree).filter((b) => label(b) === '保存岗位')[0].props.onClick()
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
ok(t4Text.indexOf('请先填写岗位名称') >= 0, '名称为空时保存被拒绝并给出提示')
const t4ModalInputs = findAll(t4Tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
ok(t4ModalInputs.length === 4, '对话框出现后共 4 个文本框（存储根目录 + 两个派生目录 + 岗位名称）')
// 岗位名称固定在末尾（前面是目录字段；按位置取会随字段增减而错位）
t4ModalInputs[t4ModalInputs.length - 1].props.onChange({ target: { value: '工控安全售前' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
calls.length = 0
findButtons(t4Tree).filter((b) => label(b) === '自动生成')[0].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
ok(calls.some((c) => String(c.url).indexOf('/domain/generate') >= 0 && c.method === 'POST'),
  '「自动生成」显式触发 POST /domain/generate（不点不发送）')
ok(t4Text.indexOf('当前 profile 未提供模型服务') >= 0, '503 → 明确提示改为手填（不假成功）')
const t4After503 = findAll(t4Tree, (x) => x.type === 'textarea', [])[0]
ok(Boolean(t4After503) && t4After503.props.value === '', '503 时不写入任何假内容（内容框保持原样）')
genMode = 200
findButtons(t4Tree).filter((b) => label(b) === '自动生成')[0].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
const t4After200 = findAll(t4Tree, (x) => x.type === 'textarea', [])[0]
ok(Boolean(t4After200) && t4After200.props.value === 'me-generated-job', '有模型服务时生成结果只作预览（填入内容框，可替换或重试）')
ok(collect(t4Tree, []).join(' | ').indexOf('已生成，可直接编辑或重试') >= 0, '生成后给「已生成…」提示')
findButtons(t4Tree).filter((b) => label(b) === '保存岗位')[0].props.onClick()
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
t4Text = collect(t4Tree, []).join(' | ')
ok(t4Text.indexOf('保存岗位') < 0, '保存后对话框关闭')
ok(t4Text.indexOf('工控安全售前（自定义）') >= 0, '新建岗位进入下拉并选中')
ok(findSave().props.disabled !== true, '自定义岗位选定后保存按钮仍可点')
// 字数上限（使用者 2026-09-16 裁定：名称 ≤ 10 字、内容 ≤ 200 字）
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
findAll(t4Tree, (x) => x.type === 'select', [])[0].props.onChange({ target: { value: '__new__' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
const mName = findAll(t4Tree, (x) => x.type === 'input' && x.props && x.props['data-modal-field'] === 'name', [])[0]
const mArea = findAll(t4Tree, (x) => x.type === 'textarea' && x.props && x.props['data-modal-field'] === 'content', [])[0]
ok(Boolean(mName) && String(mName.props.maxLength) === '10', '岗位名称输入框 maxLength=10')
ok(Boolean(mArea) && String(mArea.props.maxLength) === '200', '岗位内容 textarea maxLength=200')
const mText = collect(t4Tree, []).join(' | ')
ok(mText.indexOf('0/10 字') >= 0, '名称字数提示存在（0/10 字）')
ok(mText.indexOf('0/200 字') >= 0, '内容字数提示存在（0/200 字）')
ok(mText.indexOf('200 字以内') >= 0, '内容提示写明「200 字以内」')
mName.props.onChange({ target: { value: '一二三四五六七八九十十一' } })
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
const mName2 = findAll(t4Tree, (x) => x.type === 'input' && x.props && x.props['data-modal-field'] === 'name', [])[0]
ok(String(mName2.props.value).length === 10, '名称超过 10 字被截断（实测 ' + String(mName2.props.value).length + ' 字）')
genMode = 'long'
findButtons(t4Tree).filter((b) => label(b) === '自动生成')[0].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
t4Tree = expand(reg.render({ initialTab: 'core' }))
const mArea2 = findAll(t4Tree, (x) => x.type === 'textarea' && x.props && x.props['data-modal-field'] === 'content', [])[0]
ok(String(mArea2.props.value).length === 200, '生成结果超长被前端二次截断到 200 字（实测 ' + String(mArea2.props.value).length + ' 字）')
ok(collect(t4Tree, []).join(' | ').indexOf('200/200 字') >= 0, '截断后字数提示同步为 200/200 字')



// ══════════════════════════════════════════════════════════════════
// [15] T5 配置页键位（常显 / 高级 / 未放出不渲染 / 控件类型）+ R-1 置灰口径
// ══════════════════════════════════════════════════════════════════
console.log('\n[15] T5 键位口径（记忆库 5+8 / 专家库 5+5 / 文档能力 4+5）')

const CFG_DOC_DEFAULTS = {
  mediaProvider: 'volcengine-ark', mediaImageEnabled: true, mediaImageModel: 'doubao-seedream',
  mediaImageSize: '1K', mediaImageTimeoutMs: 60000, mediaImageRetries: 2,
  mediaImageFallbackToVector: true, mediaVideoEnabled: false, mediaVideoModel: '',
  mediaArkApiKey: '', mediaArkEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
}
const t5Fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (!/^https?:/i.test(u)) throw new Error('relative URL unavailable in desktop shell')
  if (u.indexOf('/settings/write') >= 0) return jsonRes({ ok: true, ns: 'work-memory', revision: 13, value: cfgMemValue, user: cfgMemUser })
  if (u.indexOf('/experts/preview') >= 0) return jsonRes(CFG_PREVIEW_PAYLOAD)
  if (u.indexOf('/settings') >= 0) {
    return jsonRes({ ok: true, namespaces: [
      { ns: 'work-memory', revision: 12, writable: true, applies: 'live', installed: true, value: cfgMemValue, user: cfgMemUser, fields: cfgFieldsOf(CFG_MEM_DEFAULTS) },
      { ns: 'experts', revision: 12, writable: true, applies: 'live', installed: true, value: CFG_EXP_DEFAULTS, user: {}, fields: cfgFieldsOf(CFG_EXP_DEFAULTS) },
      { ns: 'dsh-doc-suite', revision: 12, writable: true, applies: 'live', installed: true, value: CFG_DOC_DEFAULTS, user: {}, fields: cfgFieldsOf(CFG_DOC_DEFAULTS) },
    ] })
  }
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
globalThis.fetch = t5Fetch
hookSlots = []
hookCursor = 0
effectQueue = []
expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(80)
hookCursor = 0
effectQueue = []
cfTree = expand(reg.render({ initialTab: 'config' }))
cfText = collect(cfTree, []).join(' | ')

// ── 记忆库：常显 5 + 高级 8 + 未放出 11 ──────────────────────────
const MEM_PRIMARY = ['injectMemory', 'personaLabel', 'snapshotMaxChars', 'memoryDir', 'obsidianSyncDir']
const MEM_ADV = ['snapshotLimitGlobal', 'snapshotLimitUser', 'snapshotLimitProject', 'snapshotLimitDaily',
  'backupDir', 'reviewEnabled', 'triageAskInSnapshot', 'backupEnabled']
const MEM_HIDDEN = ['snapshotOrder', 'maintainWarnDays', 'dailyRetentionDays', 'projectTtlDays', 'userTtlDays',
  'triageGraceDays', 'globalWarnCount', 'dailyAutoLog', 'archiveEnabled', 'triageEnabled', 'backupKeep']
ok(MEM_PRIMARY.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '记忆库常显 5 键全部渲染')
ok(MEM_ADV.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '记忆库高级 8 键全部渲染（折叠档内）')
ok(cfText.indexOf('高级设置（8 项）') >= 0, '记忆库高级档标题计数 8 项')
const memHiddenHit = MEM_HIDDEN.filter((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0)
ok(memHiddenHit.length === 0, '记忆库 11 个未放出键均不渲染（命中：' + String(memHiddenHit) + '）')
const pickKeys = findByAttr(cfTree, 'data-cfg-action', 'pick-dir').map((b) => b.props['data-cfg-key'])
ok(['memoryDir', 'obsidianSyncDir', 'backupDir'].every((k) => pickKeys.indexOf(k) >= 0),
  '路径类键各有目录入口（实测 ' + String(pickKeys) + '）')

// ── 专家库：常显 4 + 高级 5 + 未放出 10（identityExpert 按使用者裁定移出）──
await cfSwitchTo('experts')
const EXP_PRIMARY = ['expertsEnabled', 'defaultDomain', 'expertInjectDetail', 'expertShowBanner']
const EXP_ADV = ['expertInjectBudgetChars', 'skillBudgetChars', 'expertCatalogEnabled', 'disciplineEnabled', 'skillInjectEnabled']
const EXP_HIDDEN = ['identityExpert', 'enabledDomains', 'enabledExperts', 'expertInjectMax', 'disciplineMemoryDir',
  'expertSetupDone', 'expertFullHitMax', 'expertSecondThreshold', 'expertGeneralMax', 'expertGeneralMinEvidence']
ok(EXP_PRIMARY.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '专家库常显 4 键全部渲染')
ok(EXP_ADV.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '专家库高级 5 键全部渲染（折叠档内）')
ok(cfText.indexOf('高级设置（5 项）') >= 0, '专家库高级档标题计数 5 项')
const expHiddenHit = EXP_HIDDEN.filter((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0)
ok(expHiddenHit.length === 0, '专家库 10 个未放出键均不渲染（含 identityExpert；命中：' + String(expHiddenHit) + '）')
const expSelects = findSelects(cfTree)
ok(expSelects.length === 2, '专家库两个下拉（工作岗位域 / 注入形态）')
const expDomText = collect(expSelects[0] || null, []).join(' | ')
ok(['信息安全', '财务', '人力资源', '代码编程', '金融', '通用职能'].every((x) => expDomText.indexOf(x) >= 0),
  'defaultDomain 保留 6 个域（含通用职能）；这是专家匹配先验，与核心配置页的 5 个岗位无关')
const expDetailText = collect(expSelects[1] || null, []).join(' | ')
ok(expDetailText.indexOf('auto') >= 0 && expDetailText.indexOf('card') >= 0 && expDetailText.indexOf('full') >= 0,
  'expertInjectDetail 渲染 auto / card / full 三选项（未回落到岗位域表）')

// ── 文档能力：常显 4 + 高级 5 + 未放出 2 ─────────────────────────
await cfSwitchTo('docs')
const DOC_PRIMARY = ['mediaImageEnabled', 'mediaArkApiKey', 'mediaImageModel', 'mediaVideoEnabled']
const DOC_ADV = ['mediaImageSize', 'mediaImageTimeoutMs', 'mediaImageRetries', 'mediaVideoModel', 'mediaImageFallbackToVector']
const DOC_HIDDEN = ['mediaProvider', 'mediaArkEndpoint']
ok(DOC_PRIMARY.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '文档能力常显 4 键全部渲染')
ok(DOC_ADV.every((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0), '文档能力高级 5 键全部渲染（折叠档内）')
ok(cfText.indexOf('高级设置（5 项）') >= 0, '文档能力高级档标题计数 5 项')
const docHiddenHit = DOC_HIDDEN.filter((k) => findByAttr(cfTree, 'data-cfg-key', k).length > 0)
ok(docHiddenHit.length === 0, '文档能力 2 个未放出键均不渲染（命中：' + String(docHiddenHit) + '）')
const arkInput = findByAttr(cfTree, 'data-cfg-key', 'mediaArkApiKey').filter((x) => x.type === 'input')[0]
ok(Boolean(arkInput) && arkInput.props.type === 'password', 'ARK 密钥渲染为 password（不回显明文）')

// ── R-1：硬项全绿 + Obsidian 未装 → 主按钮仍「环境已就绪」 ───────
const CHECK_HARD_OK = {
  ok: true, checkedAt: '2026-09-16T12:00:00+08:00',
  items: [
    { id: 'host', label: 'DSH 宿主', status: 'ok', value: '2.0.10', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'node', label: 'Node.js', status: 'ok', value: 'v24.18.1', detail: '', fixKind: 'none', fixCommand: '', autoFixable: false },
    { id: 'python', label: 'Python', status: 'ok', value: '3.12.10', detail: '', fixKind: 'winget', fixCommand: 'c', autoFixable: true },
    { id: 'pythonDeps', label: 'Python 依赖', status: 'ok', value: '8/8 就绪', detail: '', fixKind: 'pip', fixCommand: 'c', autoFixable: true },
    { id: 'wps', label: 'WPS Office', status: 'ok', value: 'KWPS.Application', detail: '', fixKind: 'winget', fixCommand: 'c', autoFixable: true },
    { id: 'obsidian', label: 'Obsidian', status: 'warn', value: '未检测到', detail: '可选组件', fixKind: 'winget', fixCommand: 'c', autoFixable: true },
    { id: 'subPlugins', label: '子插件', status: 'ok', value: '5/5 已装', detail: 'dsh-work-memory@1.0.5', fixKind: 'none', fixCommand: '', autoFixable: false },
  ],
  summary: { ok: 6, warn: 1, missing: 0, skip: 0 },
}
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_HARD_OK)
  if (u.indexOf('/plugins') >= 0) return jsonRes(OK_PLUGINS)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
let r1Tree = expand(reg.render({ initialTab: 'install' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
r1Tree = expand(reg.render({ initialTab: 'install' }))
const r1Text = collect(r1Tree, []).join(' | ')
const r1Btn = findButtons(r1Tree).filter((b) => label(b) === '环境已就绪')[0]
ok(Boolean(r1Btn) && r1Btn.props.disabled === true, 'R-1：硬项全绿 + Obsidian 未装 → 主按钮置灰「环境已就绪」')
ok(r1Text.indexOf('5/6 正常') >= 0, 'R-1：分组徽标仍如实显示 5/6 正常')
ok(r1Text.indexOf('可选') >= 0, 'R-1：Obsidian 未就绪显示「可选」而非「缺失 / 警告」')

// ══════════════════════════════════════════════════════════════════
// [16] 说明页：POST /open-doc → 宿主用系统默认程序打开插件目录里的 HTML 文件
//      /docs 存在性（缺失置灰）· 成功回显路径 · 失败可读原因 · Web 载体
// ══════════════════════════════════════════════════════════════════
console.log('\n[16] 说明页（宿主打开随包 HTML 文件）')

const openDocPosts16 = []
let openDocFail16 = false     // true → /open-doc 返回 ok:false + code
let docsMissing16 = ''        // '' | 'guide' | 'help' | 'both'
let docsOk16 = true           // false → /docs 返回 404（接口不可用）
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/open-doc') >= 0) {
    let body = {}
    try { body = JSON.parse(String((opts && opts.body) || '{}')) } catch (err) { body = {} }
    openDocPosts16.push(body)
    if (openDocFail16) return jsonRes({ ok: false, error: '找不到说明页文件', code: 'doc-missing' })
    const doc = body.doc === 'guide' ? 'guide' : 'help'
    return jsonRes({ ok: true, doc: doc, path: 'C:/plugins/work-personal-secretary/doc/' + doc + '.html', command: 'open ' + doc + '.html' })
  }
  if (u.indexOf('/docs') >= 0) {
    if (!docsOk16) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
    const miss = (d) => docsMissing16 === d || docsMissing16 === 'both'
    return jsonRes({ ok: true, items: [
      { doc: 'guide', path: 'C:/plugins/work-personal-secretary/doc/guide.html', exists: !miss('guide') },
      { doc: 'help', path: 'C:/plugins/work-personal-secretary/doc/help.html', exists: !miss('help') },
    ] })
  }
  if (u.indexOf('/check') >= 0) return jsonRes(CHECK_PAYLOAD)
  if (u.indexOf('/plugins') >= 0) return jsonRes(PLUGINS_PAYLOAD)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const e16Render = async () => {
  hookCursor = 0
  effectQueue = []
  let t = expand(reg.render({ initialTab: 'install' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(40)
  hookCursor = 0
  effectQueue = []
  t = expand(reg.render({ initialTab: 'install' }))
  return t
}
let e16Tree = await e16Render()
let e16Text = collect(e16Tree, []).join(' | ')
const e16Btn = (txt) => findButtons(e16Tree).filter((b) => label(b) === txt)[0]

// ① 进页面 GET /docs；两个文件都在 → 按钮都可点
ok(calls.some((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/docs'),
  '进入页面 GET /docs（合成基址；实测 ' + String((calls.filter((c) => c.url.indexOf('/docs') >= 0)[0] || {}).url) + '）')
const e16Help1 = e16Btn('使用说明')
const e16Guide1 = findButtons(e16Tree).filter((b) => label(b).indexOf('查看安装引导') >= 0)[0]
ok(Boolean(e16Help1) && e16Help1.props.disabled !== true, 'help 文件存在 → 「使用说明」可点')
ok(Boolean(e16Guide1), '找到「查看安装引导」按钮')

// ② 成功：POST /open-doc { doc:'guide' } → 回显文件路径
openDocPosts16.length = 0
calls.length = 0
if (e16Guide1) e16Guide1.props.onClick()
await tick(60)
e16Tree = await e16Render()
e16Text = collect(e16Tree, []).join(' | ')
ok(openDocPosts16.length === 1 && String(JSON.stringify(openDocPosts16[0])) === JSON.stringify({ doc: 'guide' }),
  '点击「查看安装引导」→ POST /open-doc { doc: "guide" }（实测 ' + JSON.stringify(openDocPosts16[0]) + '）')
const e16Post = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/open-doc') >= 0)[0]
ok(Boolean(e16Post) && e16Post.url === 'http://dsh.internal/work-personal-secretary/api/open-doc',
  '走合成基址 POST /open-doc（实测 ' + String(e16Post && e16Post.url) + '）')
ok(e16Text.indexOf('已打开说明页') >= 0 && e16Text.indexOf('guide.html') >= 0,
  '成功后就地回显「已打开说明页」+ 文件路径')
ok(String(src).indexOf('window.open') < 0 && String(src).indexOf('document.write') < 0,
  '客户端不再自己开窗 / 写文档（改由宿主打开）')

// ③ 失败：宿主返回 ok:false + code → 可读原因（不静默）
openDocFail16 = true
e16Tree = await e16Render()
const e16Help3 = e16Btn('使用说明')
if (e16Help3) e16Help3.props.onClick()
await tick(60)
e16Tree = await e16Render()
e16Text = collect(e16Tree, []).join(' | ')
ok(e16Text.indexOf('未能打开说明页') >= 0 && e16Text.indexOf('找不到说明页文件') >= 0,
  '失败 → 提示「未能打开说明页」+ 宿主给的原因')
ok(e16Text.indexOf('doc-missing') >= 0, '失败提示带上宿主返回的 code')
openDocFail16 = false

// ④ /docs 说文件缺失 → 对应按钮置灰 + 就地提示路径
docsMissing16 = 'help'
e16Tree = await e16Render()
e16Text = collect(e16Tree, []).join(' | ')
const e16Help4 = e16Btn('使用说明')
ok(Boolean(e16Help4) && e16Help4.props.disabled === true, 'help 文件缺失 → 「使用说明」置灰')
ok(e16Text.indexOf('说明页文件缺失') >= 0 && e16Text.indexOf('help.html') >= 0,
  '缺失时就地提示「说明页文件缺失」+ 路径')
docsMissing16 = ''

// ⑤ /docs 接口不可用 → 不拦主流程（按未知处理，按钮仍可点）
docsOk16 = false
e16Tree = await e16Render()
const e16Help5 = e16Btn('使用说明')
ok(Boolean(e16Help5) && e16Help5.props.disabled !== true, '/docs 不可用时不拦主流程：按钮仍可点（未知按可点）')
docsOk16 = true

// ⑥ Web 载体：POST 走根相对路径
hookSlots = []
hookCursor = 0
effectQueue = []
let e16Web = expand(webReg.render({ initialTab: 'install' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(40)
hookCursor = 0
effectQueue = []
e16Web = expand(webReg.render({ initialTab: 'install' }))
const e16WebHelp = findButtons(e16Web).filter((b) => label(b) === '使用说明')[0]
calls.length = 0
if (e16WebHelp) e16WebHelp.props.onClick()
await tick(60)
ok(calls.some((c) => c.method === 'POST' && c.url === '/work-personal-secretary/api/open-doc'),
  'Web 载体：POST /work-personal-secretary/api/open-doc 走根相对路径')


// 第 3 项：字段说明按设计定稿 §3.2 口径；第 2 项：「浏览…」按钮不换行
hookSlots = []
hookCursor = 0
effectQueue = []
let e16Core = expand(reg.render({ initialTab: 'core' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(40)
hookCursor = 0
effectQueue = []
e16Core = expand(reg.render({ initialTab: 'core' }))
const e16CoreText = collect(e16Core, []).join(' | ')
// 主人 2026-09-16 改口径：一个存储根目录 + 两边各自新建自己的子文件夹；
// 知识库**只新建不搬迁**（要搬必须由使用者指定、逐项对照），记忆体才自动迁移。
ok(e16CoreText.indexOf('存储根目录') >= 0 && e16CoreText.indexOf('各自新建一个自己的子文件夹') >= 0,
  '目录卡出现「存储根目录」主字段并说明两个子文件夹各自新建')
ok(e16CoreText.indexOf('只把旧库里还没有的文件补过来，旧目录原样保留') >= 0,
  '记忆库目录说明写明：旧库只补还没有的文件、旧目录保留')
ok(e16CoreText.indexOf('已有知识库不会被动，要搬请用下面的导入入口，由你指定后再逐项对照') >= 0,
  '知识库目录说明写明：只新建不搬迁，要搬须使用者指定后逐项对照')
const e16Browse = findButtons(e16Core).filter((b) => label(b) === '浏览…')[0]
ok(Boolean(e16Browse) && e16Browse.props.style && e16Browse.props.style.whiteSpace === 'nowrap',
  '「浏览…」按钮不换行（whiteSpace:nowrap；真机反馈曾被挤成竖排）')

// ══════════════════════════════════════════════════════════════════
// [17] 核心配置：预填当前生效值（GET /setup-state）+ 来源标注 + 兜底
// ══════════════════════════════════════════════════════════════════
console.log('\n[17] 核心配置预填（setup-state）')

let s17Payload = {
  ok: true,
  memoryDir: { value: 'D:/ws/memories/me', source: 'settings' },
  obsidianDir: { value: 'D:/ws', source: 'derived' },
  domain: { id: 'infosec', label: '信息安全（infosec）', isPreset: true, source: 'settings' },
  identity: { exists: false, entryId: '' },
  note: 'note-17',
}
let s17Ok = true
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  const method = (opts && opts.method) || 'GET'
  calls.push({ url: u, method: method, body: opts && opts.body })
  if (u.indexOf('/setup-state') >= 0) {
    if (!s17Ok) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
    return jsonRes(s17Payload)
  }
  if (u.indexOf('/domain/list') >= 0) return jsonRes({ ok: true, prefix: '使用者身份：', maxChars: 200, items: DOMAIN_ITEMS })
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const s17Render = async () => {
  hookCursor = 0
  effectQueue = []
  let t = expand(reg.render({ initialTab: 'core' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(50)
  hookCursor = 0
  effectQueue = []
  t = expand(reg.render({ initialTab: 'core' }))
  return t
}
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let s17Tree = await s17Render()
let s17Text = collect(s17Tree, []).join(' | ')
const s17Inputs = findAll(s17Tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
const s17Select = findAll(s17Tree, (x) => x.type === 'select', [])[0]
const s17Save = () => findButtons(s17Tree).filter((b) => label(b) === '保存配置并开始')[0]

// ① 预填三值（来源标注按使用者反馈已删，这里做反向断言）
ok(calls.some((c) => c.url === 'http://dsh.internal/work-personal-secretary/api/setup-state'),
  '进入页面 GET /api/setup-state（合成基址）')
ok(s17Inputs.length === 3 && String(s17Inputs[1].props.value) === 'D:\\ws\\memories\\me',
  '记忆库目录预填当前生效值（实测 ' + String(s17Inputs[1] && s17Inputs[1].props.value) + '）')
ok(String(s17Inputs[2] && s17Inputs[2].props.value) === 'D:\\ws', 'Obsidian 目录预填当前生效值（宿主的 POSIX 值在页面统一成反斜杠）')
// 这两个目录**不是**同一父目录下的 memory-data / obsidian-data → 反推不出根目录，
// 于是根目录留空、两个目录按「已单独指定」可编辑照显（绝不擅自改写既有路径）。
ok(String(s17Inputs[0].props.value) === '' && s17Inputs[1].props.disabled === false && s17Inputs[2].props.disabled === false,
  '既有配置推不出存储根目录 → 根目录留空、两个目录按「已单独指定」可编辑（不改写使用者路径）')
ok(Boolean(s17Select) && String(s17Select.props.value) === 'infosec', '工作岗位预填为对应预置项（infosec）')
ok(s17Text.indexOf('当前生效值') < 0 && s17Text.indexOf('由记忆镜像反推') < 0,
  'A2：来源标注不再显示（预填功能保留）')
ok(Boolean(s17Save()) && s17Save().props.disabled !== true, '预填后三项齐 → 保存按钮可点')
ok(calls.filter((c) => c.method === 'POST').length === 0, '预填不触发任何写操作（无 POST）')

// ② 清空任一字段 → 保存置灰（既有校验不变）
s17Inputs[1].props.onChange({ target: { value: '' } })
s17Tree = await s17Render()
ok(s17Save().props.disabled === true, '清空记忆库目录 → 保存按钮置灰')

// ③ 非预置岗位：走「都不是（新建岗位…）」+ 带入岗位名（正文留空，保存仍置灰）
s17Payload = {
  ok: true,
  memoryDir: { value: 'D:/ws/memories/me', source: 'settings' },
  obsidianDir: { value: 'D:/ws', source: 'settings' },
  domain: { id: 'sales', label: '工控安全售前', isPreset: false, source: 'settings' },
  identity: { exists: true, entryId: 'id-9' },
}
hookSlots = []
hookCursor = 0
effectQueue = []
s17Tree = await s17Render()
s17Text = collect(s17Tree, []).join(' | ')
const s17Select2 = findAll(s17Tree, (x) => x.type === 'select', [])[0]
ok(Boolean(s17Select2) && String(s17Select2.props.value).indexOf('custom:') === 0,
  '非预置岗位 → 选中「都不是（新建岗位…）」派生的自定义项（实测 ' + String(s17Select2 && s17Select2.props.value) + '）')
ok(s17Text.indexOf('工控安全售前（自定义）') >= 0, '岗位名带入自定义岗位并出现在下拉里')
ok(s17Text.indexOf('已带入当前岗位名称') >= 0, '提示需补充岗位内容（不自动造正文）')
ok(s17Save().props.disabled === true, '非预置且正文为空 → 保存仍置灰（语义不变）')

// ④ 接口不可用 → 字段留空、给可读说明、不拦主流程
s17Ok = false
hookSlots = []
hookCursor = 0
effectQueue = []
s17Tree = await s17Render()
s17Text = collect(s17Tree, []).join(' | ')
const s17Inputs4 = findAll(s17Tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
ok(s17Inputs4.length === 3 && s17Inputs4.every((x) => String(x.props.value) === ''), '接口 404 → 三个目录字段保持空（不臆造值）')
ok(s17Text.indexOf('未能取到当前生效值') >= 0, '接口 404 → 给一行可读说明（不静默）')
ok(Boolean(s17Save()), '接口 404 不拦主流程：表单与保存按钮仍在')
// ⑤ 新模型：宿主反推出存储根目录 → 根目录预填、两个目录只读派生；「单独指定」/「跟随根目录」可用
s17Ok = true
s17Payload = {
  ok: true,
  memoryDir: { value: 'D:/root/memory-data', source: 'settings' },
  obsidianDir: { value: 'D:/root/obsidian-data', source: 'derived' },
  root: { value: 'D:/root', source: 'derived' },
  rootSubdirs: { memory: 'memory-data', vault: 'obsidian-data' },
  domain: { id: 'infosec', label: '信息安全（infosec）', isPreset: true, source: 'settings' },
  identity: { exists: false, entryId: '' },
}
const s17TextInputs = (tree) => findAll(tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
/** 反斜杠（避免在源码里写转义，读起来也清楚） */
const BS = String.fromCharCode(92)
hookSlots = []
hookCursor = 0
effectQueue = []
s17Tree = await s17Render()
s17Text = collect(s17Tree, []).join(' | ')
let s17Root = s17TextInputs(s17Tree)
// 宿主回的是 POSIX（`D:/root`），页面按 **Windows 形态统一成反斜杠** —— 这是真机反馈的第二层：
// 「读到的数据」那一侧原来也是正斜杠，与使用者敲的根目录两种写法并列在同一页。
ok(s17Root.length === 3 && String(s17Root[0].props.value) === 'D:' + BS + 'root',
  '存储根目录预填并统一成反斜杠（实测 ' + String(s17Root[0] && s17Root[0].props.value) + '）')
ok(String(s17Root[1].props.value) === 'D:' + BS + 'root' + BS + 'memory-data' && String(s17Root[2].props.value) === 'D:' + BS + 'root' + BS + 'obsidian-data',
  '两个目录由根目录派生（<根>/memory-data 与 <根>/obsidian-data）')
// 使用者敲的根目录也一样统一（正斜杠 → 反斜杠），否则派生值又会与其它字段两种写法
s17Root[0].props.onChange({ target: { value: 'D:/work/' } })
s17Tree = await s17Render()
s17Root = s17TextInputs(s17Tree)
ok(String(s17Root[1].props.value) === 'D:' + BS + 'work' + BS + 'memory-data' && String(s17Root[2].props.value) === 'D:' + BS + 'work' + BS + 'obsidian-data',
  '正斜杠根目录（含结尾斜杠）→ 去重并统一成反斜杠（实测 ' + String(s17Root[1].props.value) + '）')
// 通用守卫（不只盯这一处）：按**最新**渲染文本判，页面路径文本里不许出现「盘符 + 反斜杠 … 正斜杠」的混排。
// 以后谁再写一处固定 '/' 的拼接，这条都会红，不必再靠肉眼发现。
s17Text = collect(s17Tree, []).join(' | ')
ok(!/[A-Za-z]:\\[^\s|]*\//.test(s17Text),
  '核心配置页路径文本无「反斜杠 + 正斜杠」混排（实测文本片段：' + String(s17Text).slice(0, 60) + '…）')
ok(s17Root[1].props.disabled === true && s17Root[2].props.disabled === true,
  '派生值默认只读（要改必须显式点「单独指定」——不做成随手可改，才有「默认不冲突」这个保证）')
ok(s17Text.indexOf('自动：存储根目录/') >= 0, '派生行标注来源「自动：存储根目录/」')
// 改根目录 → 两个派生值跟着重算
s17Root[0].props.onChange({ target: { value: 'E:/work' } })
s17Tree = await s17Render()
s17Root = s17TextInputs(s17Tree)
ok(String(s17Root[1].props.value) === 'E:\\work\\memory-data' && String(s17Root[2].props.value) === 'E:\\work\\obsidian-data',
  '改存储根目录 → 两个派生目录跟着重算')
// 「单独指定」：只放开该行，另一行仍只读；此后改根目录它不再跟随
const s17Cust = findButtons(s17Tree).filter((b) => label(b) === '单独指定')[0]
ok(Boolean(s17Cust), '派生行有「单独指定」按钮')
if (s17Cust) s17Cust.props.onClick()
s17Tree = await s17Render()
s17Root = s17TextInputs(s17Tree)
ok(s17Root[1].props.disabled === false && s17Root[2].props.disabled === true,
  '「单独指定」只放开被点的那一行（记忆库行可编辑，知识库行仍只读）')
s17Root[0].props.onChange({ target: { value: 'F:/root2' } })
s17Tree = await s17Render()
s17Root = s17TextInputs(s17Tree)
ok(String(s17Root[1].props.value) === 'E:\\work\\memory-data' && String(s17Root[2].props.value) === 'F:\\root2\\obsidian-data',
  '已单独指定的目录不再跟随根目录，未指定的继续跟随')
// 「跟随根目录」→ 回到派生值并恢复只读
const s17Follow = findButtons(s17Tree).filter((b) => label(b) === '跟随根目录')[0]
ok(Boolean(s17Follow), '单独指定后出现「跟随根目录」按钮')
if (s17Follow) s17Follow.props.onClick()
s17Tree = await s17Render()
s17Root = s17TextInputs(s17Tree)
ok(String(s17Root[1].props.value) === 'F:\\root2\\memory-data' && s17Root[1].props.disabled === true,
  '「跟随根目录」→ 该行回到派生值并恢复只读')
// 根目录为空时**不能**再给「跟随根目录」：没有可跟随的目标，点下去只会把刚填好的目录清空
// （真机反馈：「我选择跟随后没有继续」——根目录为空时 joinDir 返回空串，字段被清空）
s17TextInputs(s17Tree)[0].props.onChange({ target: { value: '' } })
s17Tree = await s17Render()
const s17Cust2 = findButtons(s17Tree).filter((b) => label(b) === '单独指定')[0]
if (s17Cust2) s17Cust2.props.onClick()
s17Tree = await s17Render()
ok(findButtons(s17Tree).filter((b) => label(b) === '跟随根目录').length === 0,
  '根目录为空时不提供「跟随根目录」（没有可跟随的目标，点了只会把目录清空）')

// ══════════════════════════════════════════════════════════════════
// [18] D 组：环境检测共享（只发一次）+ 加载态不显示「缺失」
// ══════════════════════════════════════════════════════════════════
console.log('\n[18] 检测共享与加载态（D1/D2）')

const t18FetchOf = (delayCheck) => async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/check') >= 0) {
    if (delayCheck) return { ok: true, status: 200, json: async () => new Promise(() => {}) }
    return jsonRes(CHECK_PAYLOAD)
  }
  if (u.indexOf('/plugins') >= 0) return jsonRes(PLUGINS_PAYLOAD)
  if (u.indexOf('/domain/list') >= 0) return jsonRes({ ok: true, prefix: '使用者身份：', maxChars: 200, items: DOMAIN_ITEMS })
  if (u.indexOf('/setup-state') >= 0) return jsonRes({ ok: true, memoryDir: { value: '', source: 'none' }, obsidianDir: { value: '', source: 'none' }, domain: { id: '', label: '', isPreset: false, source: 'none' } })
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}

// D1：进入分区只发一次 /check；切页签不重复
globalThis.fetch = t18FetchOf(false)
hookSlots = []
hookCursor = 0
effectQueue = []
calls.length = 0
let t18Tree = expand(reg.render({ initialTab: 'install' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
t18Tree = expand(reg.render({ initialTab: 'install' }))
const t18Check1 = calls.filter((c) => c.url.indexOf('/api/check') >= 0).length
const t18CoreTab = findAll(t18Tree, (x) => x.props && x.props['data-tab'] === 'core', [])[0]
ok(Boolean(t18CoreTab), '拿到「核心配置」页签按钮')
if (t18CoreTab) t18CoreTab.props.onClick()
hookCursor = 0
effectQueue = []
// 只重渲染、不再跑 effectQueue：真实 React 只在**挂载**时跑一次 effect，
// 替身里每渲染一次都会重新登记 effect，重复执行会伪造出第二次 /check。
t18Tree = expand(reg.render({ initialTab: 'install' }))
const t18Text = collect(t18Tree, []).join(' | ')
const t18Check2 = calls.filter((c) => c.url.indexOf('/api/check') >= 0).length
ok(t18Check1 === 1 && t18Check2 === 1, 'D1：进入安装与检查页再到核心配置页，/check 全程只发 1 次（实测 ' + t18Check1 + ' → ' + t18Check2 + '）')
ok(t18Text.indexOf('目录与岗位') >= 0, '切到核心配置页拿到的是同一份检测结果（表单已渲染）')

// D2：结果未到手时三项显示「检测中…」，绝不显示「缺失」
globalThis.fetch = t18FetchOf(true)
hookSlots = []
hookCursor = 0
effectQueue = []
let t18bTree = expand(reg.render({ initialTab: 'core' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(30)
hookCursor = 0
effectQueue = []
t18bTree = expand(reg.render({ initialTab: 'core' }))
const t18bText = collect(t18bTree, []).join(' | ')
ok(t18bText.indexOf('检测中…') >= 0, 'D2：检测未返回时门禁显示「检测中…」')
ok(t18bText.indexOf('缺失') < 0, 'D2：加载态不把「未知」画成「缺失」')
// ══════════════════════════════════════════════════════════════════
// [19] 迁移旧记忆库：执行链顺序 · stoppedAt 即停 · 无需迁移 · 契约 8 项
// ══════════════════════════════════════════════════════════════════
console.log('\n[19] 迁移旧记忆库（basedeck migrateMemory）')

const BD8_ITEMS = [
  { id: 'dirs', label: '目录结构' },
  { id: 'migrateMemory', label: '迁移旧记忆库' },
  { id: 'memorySeed', label: '记忆种子' },
  { id: 'memoryDeck', label: '记忆体结构' },
  { id: 'knowledgeDeck', label: '知识库结构' },
  { id: 'skills', label: '技能' },
  { id: 'settings', label: '设置用户层' },
  { id: 'agentsMd', label: '指令层 AGENTS.md' },
]
let t19From = 'D:/old/memories'      // GET /basedeck 的 migrateFrom
let t19Stop = false                  // true → migrateMemory 返回 stoppedAt
const t19Posts = []
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  const method = (opts && opts.method) || 'GET'
  calls.push({ url: u, method: method, body: opts && opts.body })
  if (u.indexOf('/basedeck') >= 0) {
    let body = {}
    try { body = JSON.parse(String((opts && opts.body) || '{}')) } catch (err) { body = {} }
    if (method === 'GET') return jsonRes({ ok: true, migrateFrom: t19From, items: BD8_ITEMS, setupNeeded: false })
    const ids = Array.isArray(body.ids) ? body.ids : []
    t19Posts.push(ids)
    if (ids.indexOf('migrateMemory') >= 0 && t19Stop) {
      return jsonRes({ ok: true, stoppedAt: 'migrateMemory', stopReason: '目标目录不可写（模拟）', results: [{ id: 'dirs', ok: true }, { id: 'migrateMemory', ok: false, error: '目标目录不可写（模拟）' }] })
    }
    const results = ids.map((id) => {
      if (id === 'migrateMemory') {
        return { id: id, ok: true, dryRun: false, action: '迁移 3 个文件', oldDirKept: true,
          migrateStats: { copy: 3, skip: 1, conflict: 1, noise: 2, bytes: 2048 },
          migratedFiles: ['MEMORY.md', 'USER.md', 'PROJECTS/工作秘书.md'], conflicts: ['GRAPH.json'] }
      }
      return { id: id, ok: true, dryRun: false, action: '写入 ' + id, target: 'D:/fake/' + id }
    })
    return jsonRes({ ok: true, dryRun: false, results: results, wroteAny: true })
  }
  if (u.indexOf('/setup-state') >= 0) {
    return jsonRes({ ok: true, memoryDir: { value: 'D:/ws/memories/me', source: 'settings' },
      obsidianDir: { value: 'D:/ws', source: 'settings' },
      domain: { id: 'infosec', label: '信息安全（infosec）', isPreset: true, source: 'settings' } })
  }
  if (u.indexOf('/domain/list') >= 0) return jsonRes({ ok: true, prefix: '使用者身份：', maxChars: 200, items: DOMAIN_ITEMS })
  if (u.indexOf('/preflight') >= 0) return jsonRes({ ok: true, ready: true, checks: [], summary: { total: 0, ok: 0, warn: 0, block: 0 } })
  if (u.indexOf('/identity/save') >= 0) return jsonRes({ ok: true, status: 'rewrite', entryId: 'id-1', detail: '已整条改写「使用者身份」条目' })
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const t19Run = async () => {
  hookSlots = []
  hookCursor = 0
  effectQueue = []
  let t = expand(reg.render({ initialTab: 'core' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(60)
  hookCursor = 0
  effectQueue = []
  t = expand(reg.render({ initialTab: 'core' }))
  // 门禁全绿 → 先点「点击此处继续」展开表单
  const gate = findButtons(t).filter((b) => label(b) === '点击此处继续')[0]
  if (gate) gate.props.onClick()
  hookCursor = 0
  effectQueue = []
  t = expand(reg.render({ initialTab: 'core' }))
  const save = findButtons(t).filter((b) => label(b) === '保存配置并开始')[0]
  return { tree: t, save: save }
}

// ① 正常迁移：执行链顺序 + 统计文案 + 8 项契约
t19From = 'D:/old/memories'
t19Stop = false
t19Posts.length = 0
let t19 = await t19Run()
if (t19.save) t19.save.props.onClick()
await tick(120)
ok(String(JSON.stringify(t19Posts)) === String(JSON.stringify([['migrateMemory'], ['memoryDeck'], ['knowledgeDeck'], ['settings']])),
  'basedeck 写请求顺序：migrateMemory → memoryDeck → knowledgeDeck → settings（与宿主 BASEDECK_APPLY_ORDER 一致；实测 ' + JSON.stringify(t19Posts) + '）')
const t19Text = collect(await (async () => { hookCursor = 0; effectQueue = []; return expand(reg.render({ initialTab: 'core' })) })(), []).join(' | ')
ok(t19Text.indexOf('迁移旧记忆库') >= 0, '执行链出现「迁移旧记忆库」步骤（保存后链条卡片可见）')
ok(t19Text.indexOf('已迁移 3 个文件') >= 0, '迁移步回显迁移文件数（migrateStats.copy）')
ok(t19Text.indexOf('旧目录保留不动') >= 0, '迁移步回显「旧目录保留不动」')
ok(t19Text.indexOf('只补缺失') >= 0 && t19Text.indexOf('不覆盖') >= 0, '迁移步说明写明「只补缺失、不覆盖」')
ok(t19Text.indexOf('已有旧内容要带过来？') >= 0, '全绿后进入导入引导卡（链条跑完）')
ok(BD8_ITEMS.length === 8, '夹具按宿主契约给 8 项 items（末项 migrateMemory）')
ok(t19Posts.every((ids) => ids.length === 1), '客户端按步骤逐个下发 ids（每步 1 项），不整批下发 8 项')

// ② stoppedAt 非空：立即终止，不再发后续请求
t19Stop = true
t19Posts.length = 0
calls.length = 0
t19 = await t19Run()
if (t19.save) t19.save.props.onClick()
await tick(150)
hookCursor = 0
effectQueue = []
const t19FailTree = expand(reg.render({ initialTab: 'core' }))
const t19FailText = collect(t19FailTree, []).join(' | ')
ok(t19FailText.indexOf('已在「migrateMemory」停止') >= 0 && t19FailText.indexOf('目标目录不可写') >= 0,
  'stoppedAt 非空 → 就地显示停止步与中文原因')
ok(JSON.stringify(t19Posts) === JSON.stringify([['migrateMemory']]),
  'stoppedAt 非空（迁移步就失败）→ 后续 basedeck 写请求一个都不发，尤其不发 memoryDeck（实测 ' + JSON.stringify(t19Posts) + '）')
ok(calls.filter((c) => c.url.indexOf('/identity/save') >= 0).length === 0, 'stoppedAt 非空 → 不发 identity/save')
ok(Boolean(findButtons(t19FailTree).filter((b) => label(b) === '重试')[0]), 'stoppedAt 失败后出现「重试」按钮')

// ③ migrateFrom 为空 → 「无需迁移」，且不发 migrateMemory 写请求
t19Stop = false
t19From = ''
t19Posts.length = 0
t19 = await t19Run()
if (t19.save) t19.save.props.onClick()
await tick(120)
hookCursor = 0
effectQueue = []
const t19NoneText = collect(expand(reg.render({ initialTab: 'core' })), []).join(' | ')
ok(t19NoneText.indexOf('无需迁移') >= 0, 'migrateFrom 为空 → 该步显示「无需迁移」')
ok(t19Posts.every((ids) => ids.indexOf('migrateMemory') < 0),
  'migrateFrom 为空 → 不发 migrateMemory 写请求（实测 ' + JSON.stringify(t19Posts) + '）')
// ══════════════════════════════════════════════════════════════════
// [20] 应用内目录浏览器（方案 A）：browse 弹层 · 面包屑 · 选用 · 新建 · native 不弹
// ══════════════════════════════════════════════════════════════════
console.log('\n[20] 应用内目录浏览器')

let d20Kind = 'browse'
let d20NewOk = true
let d20NoService = false
const d20NewBodies = []
const D20_ROOT = {
  ok: true, kind: 'browse', path: 'D:/ws', parent: 'D:/',
  crumbs: [{ name: 'D:', path: 'D:/' }, { name: 'ws', path: 'D:/ws' }],
  entries: [{ name: 'memories', path: 'D:/ws/memories' }, { name: 'vault', path: 'D:/ws/vault' }],
  truncated: false, message: '',
}
const D20_SUB = {
  ok: true, kind: 'browse', path: 'D:/ws/memories', parent: 'D:/ws',
  crumbs: [{ name: 'D:', path: 'D:/' }, { name: 'ws', path: 'D:/ws' }, { name: 'memories', path: 'D:/ws/memories' }],
  entries: [], truncated: true, message: '',
}
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/dirs/new') >= 0) {
    let body = {}
    try { body = JSON.parse(String((opts && opts.body) || '{}')) } catch (err) { body = {} }
    d20NewBodies.push(body)
    if (!d20NewOk) return jsonRes({ ok: false, code: 'exists', message: '同名目录已存在（模拟）' })
    return jsonRes({ ok: true, path: String(body.path || '') + '/' + String(body.name || '') })
  }
  if (u.indexOf('/dirs') >= 0) {
    if (d20NoService) return { ok: false, status: 404, json: async () => ({ ok: false, code: 'no-service', message: 'not found' }) }
    if (d20Kind === 'native') return jsonRes({ ok: false, kind: 'native', code: 'native-only', message: '该宿主只提供系统对话框' })
    return jsonRes(u.indexOf('memories') >= 0 ? D20_SUB : D20_ROOT)
  }
  if (u.indexOf('/setup-state') >= 0) {
    return jsonRes({ ok: true, memoryDir: { value: 'D:/ws', source: 'settings' },
      obsidianDir: { value: 'D:/ws/vault', source: 'settings' },
      domain: { id: 'infosec', label: '信息安全（infosec）', isPreset: true, source: 'settings' } })
  }
  if (u.indexOf('/domain/list') >= 0) return jsonRes({ ok: true, prefix: '使用者身份：', maxChars: 200, items: DOMAIN_ITEMS })
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
const d20Render = async () => {
  hookCursor = 0
  effectQueue = []
  let t = expand(reg.render({ initialTab: 'core' }))
  for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
  await tick(50)
  hookCursor = 0
  effectQueue = []
  t = expand(reg.render({ initialTab: 'core' }))
  const gate = findButtons(t).filter((b) => label(b) === '点击此处继续')[0]
  if (gate) gate.props.onClick()
  hookCursor = 0
  effectQueue = []
  return expand(reg.render({ initialTab: 'core' }))
}
const d20Browse = (tree) => findButtons(tree).filter((b) => label(b) === '浏览…')
const d20Layer = (tree) => findAll(tree, (x) => Boolean(x.props && x.props['data-dir-browser']), [])[0]

// ① browse 环境：点「浏览…」打开弹层；列目录请求带正确 path
hookSlots = []
hookCursor = 0
effectQueue = []
let d20Tree = await d20Render()
const d20Btns = d20Browse(d20Tree)
ok(d20Btns.length === 3, '存储根目录 + 两个（推不出根目录、按「已单独指定」显示的）目录各有「浏览…」（实测 ' + d20Btns.length + '）')
calls.length = 0
// 用**记忆库目录**那一行（索引 1；索引 0 是存储根目录）
if (d20Btns[1]) d20Btns[1].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
ok(Boolean(d20Layer(d20Tree)), 'browse 环境：点「浏览…」打开应用内目录浏览器')
let d20Text = collect(d20Tree, []).join(' | ')
ok(d20Text.indexOf('选择目录') >= 0 && d20Text.indexOf('memories') >= 0 && d20Text.indexOf('vault') >= 0, '弹层列出子目录')
const d20ListCall = calls.filter((c) => c.url.indexOf('/dirs') >= 0)[0]
ok(Boolean(d20ListCall) && d20ListCall.url === 'http://dsh.internal/work-personal-secretary/api/dirs?path=D%3A%5Cws',
  '列目录请求 URL 与 query 正确（实测 ' + String(d20ListCall && d20ListCall.url) + '）')

// ② 进入子目录：面包屑变化 + 空态 + truncated 提示
const d20Entry = findAll(d20Tree, (x) => x.props && x.props['data-dir-entry'] === 'D:\\ws\\memories', [])[0]
ok(Boolean(d20Entry), '拿到子目录条目（data-dir-entry）')
if (d20Entry) d20Entry.props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
d20Text = collect(d20Tree, []).join(' | ')
ok(d20Text.indexOf('memories') >= 0, '进入子目录后面包屑含该级（crumbs）')
ok(d20Text.indexOf('这个目录里没有子目录') >= 0, '空目录给可读空态')
ok(d20Text.indexOf('目录过多，只显示前若干项') >= 0, 'truncated:true 时给「目录过多」提示')

// ③ 选用此目录：填回输入框并关闭弹层
const d20Pick = findAll(d20Tree, (x) => x.props && x.props['data-dir-pick'], [])[0]
ok(Boolean(d20Pick), '弹层底部有「选用此目录」')
if (d20Pick) d20Pick.props.onClick()
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
ok(!d20Layer(d20Tree), '选用后弹层关闭')
const d20Inputs = findAll(d20Tree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
ok(d20Inputs.length === 3 && String(d20Inputs[1].props.value) === 'D:\\ws\\memories',
  '选中的路径写回记忆库目录字段（实测 ' + String(d20Inputs[1] && d20Inputs[1].props.value) + '）')

// ④ 新建目录：POST /api/dirs/new body 正确；失败时给可读原因
calls.length = 0
d20NewBodies.length = 0
if (d20Browse(d20Tree)[1]) d20Browse(d20Tree)[1].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
const d20NewInput = findAll(d20Tree, (x) => x.props && x.props['data-dir-new-name'], [])[0]
ok(Boolean(d20NewInput), '弹层有新建目录名输入框')
if (d20NewInput) d20NewInput.props.onChange({ target: { value: 'newdir' } })
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
const d20Create = findAll(d20Tree, (x) => x.props && x.props['data-dir-create'], [])[0]
if (d20Create) d20Create.props.onClick()
await tick(60)
ok(d20NewBodies.length === 1 && String(JSON.stringify(d20NewBodies[0])) === JSON.stringify({ path: 'D:\\ws\\memories', name: 'newdir' }),
  '新建目录请求 body 正确（实测 ' + JSON.stringify(d20NewBodies[0]) + '）')
// 失败分支
d20NewOk = false
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
const d20NewInput2 = findAll(d20Tree, (x) => x.props && x.props['data-dir-new-name'], [])[0]
if (d20NewInput2) d20NewInput2.props.onChange({ target: { value: 'dup' } })
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
const d20Create2 = findAll(d20Tree, (x) => x.props && x.props['data-dir-create'], [])[0]
if (d20Create2) d20Create2.props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
ok(collect(d20Tree, []).join(' | ').indexOf('新建目录失败：同名目录已存在（模拟）') >= 0, '新建失败 → 就地给可读原因（不吞）')
d20NewOk = true

// ⑤ kind:'native' → 不用应用内弹层（显示 native 说明，不白屏）
d20Kind = 'native'
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
if (d20Browse(d20Tree)[1]) d20Browse(d20Tree)[1].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
ok(collect(d20Tree, []).join(' | ').indexOf('系统目录对话框未能打开') >= 0, 'kind:native → 显示 native 说明（不静默）')
d20Kind = 'browse'

// ⑥ 接口不可用 → 可读提示
d20NoService = true
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
if (d20Browse(d20Tree)[1]) d20Browse(d20Tree)[1].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20Tree = expand(reg.render({ initialTab: 'core' }))
ok(collect(d20Tree, []).join(' | ').indexOf('宿主暂不提供目录浏览接口') >= 0, '接口不可用 → 可读提示')
d20NoService = false

// ⑦ native 可用（uiWorkspace 成功）→ 不打开弹层，直接填值
let d20NativeCalls = 0
pickShell.ctx.uiWorkspace.pickDirectory = async () => { d20NativeCalls += 1; return 'D:/picked/by-native' }
hookSlots = []
hookCursor = 0
effectQueue = []
let d20bTree = expand(pickReg.render({ initialTab: 'core' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(50)
hookCursor = 0
effectQueue = []
d20bTree = expand(pickReg.render({ initialTab: 'core' }))
const d20bGate = findButtons(d20bTree).filter((b) => label(b) === '点击此处继续')[0]
if (d20bGate) d20bGate.props.onClick()
hookCursor = 0
effectQueue = []
d20bTree = expand(pickReg.render({ initialTab: 'core' }))
if (d20Browse(d20bTree)[1]) d20Browse(d20bTree)[1].props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20bTree = expand(pickReg.render({ initialTab: 'core' }))
ok(!d20Layer(d20bTree), 'native 可用时不打开应用内弹层（保持既有 native 路径不变；native 调用次数 ' + d20NativeCalls + '）')
const d20bInputs = findAll(d20bTree, (x) => x.type === 'input' && x.props && x.props.type === 'text', [])
ok(d20bInputs.some((i) => String(i.props.value) === 'D:\\picked\\by-native'), 'native 选中的目录直接填入输入框（同样统一成反斜杠）')

// ⑧ 第三处入口：配置页的路径类字段（同一弹层）
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  calls.push({ url: u, method: (opts && opts.method) || 'GET', body: opts && opts.body })
  if (u.indexOf('/dirs') >= 0) return jsonRes(u.indexOf('memories') >= 0 ? D20_SUB : D20_ROOT)
  if (u.indexOf('/settings') >= 0) return jsonRes({ ok: true, namespaces: cfgNamespaces() })
  if (u.indexOf('/check') >= 0) return jsonRes(OK_CHECK)
  return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
}
hookSlots = []
hookCursor = 0
effectQueue = []
let d20cTree = expand(reg.render({ initialTab: 'config' }))
for (const fn of effectQueue.slice()) { try { fn() } catch (err) { /* 断言在下面 */ } }
await tick(60)
hookCursor = 0
effectQueue = []
d20cTree = expand(reg.render({ initialTab: 'config' }))
const d20cPick = findAll(d20cTree, (x) => x.props && x.props['data-cfg-action'] === 'pick-dir', [])[0]
ok(Boolean(d20cPick), '配置页路径类字段有「浏览…」入口（第三处）')
if (d20cPick) d20cPick.props.onClick()
await tick(60)
hookCursor = 0
effectQueue = []
d20cTree = expand(reg.render({ initialTab: 'config' }))
ok(Boolean(d20Layer(d20cTree)), '配置页：native 不可用时同样打开应用内浏览器')

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
