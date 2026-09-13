/**
 * work-personal-secretary —— 装载冒烟测试
 *
 * 不依赖宿主运行时：mock 浏览器 loader 与 cordis ctx，**真跑客户端半的 apply()**，
 * 验证「注册了什么」与「渲染出什么」。用法：node scripts/smoke-load.mjs
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

// ── 极简 React 替身：只记录元素树，不做真实渲染 ─────────────────────
const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(init) { return [init, () => {}] },
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

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n')
process.exit(fail === 0 ? 0 : 1)
