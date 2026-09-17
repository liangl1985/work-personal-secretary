#!/usr/bin/env node
/**
 * 未定义标识符静态检查（T5-2）—— 补 `node --check` 抓不到的缺口。
 *
 * 背景：`node --check` 只做语法检查。「引用了本文件既未声明、也未 import 的标识符」
 * 这类缺陷（如历史上真出过的 `ENTRY_SEP is not defined`）它抓不到，只能等运行到那行才炸。
 * 本脚本借 TypeScript 的 checkJs 做静态检查，**只关心** TS2304（Cannot find name）
 * 与 TS2552（Cannot find name，是否想找 …）两类；其余类型噪音（TS2339 属性不存在等）
 * 在纯 JS 项目里是常态，一律忽略。
 *
 * 用法：
 *   node scripts/check-undefined.mjs [--require-tsc] [--typeRoots <dir>]
 *     --require-tsc   找不到 tsc 时判失败（CI 用；本机默认「跳过放行」，避免把没装 tsc 的人弄红）
 *     --typeRoots     显式指定 @types 根目录（默认自动探测仓库内各模块的 node_modules/@types）
 *
 * 退出码：0 干净或跳过 ｜ 1 存在未定义标识符 ｜ 2 参数错误
 * 纪律：只用 node: 内置模块；只读；不联网（tsc 与 @types 由调用方准备）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = resolve(HERE, '..')
const REPO_ROOT = resolve(MODULE_DIR, '..', '..')
const TSCONFIG = join(MODULE_DIR, 'tsconfig.checkjs.json')
const WANT = /TS(2304|2552):/

let requireTsc = false
let explicitTypeRoots = ''
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--require-tsc') requireTsc = true
  else if (a === '--typeRoots') explicitTypeRoots = argv[++i] ?? ''
  else if (a === '--help' || a === '-h') { console.log('用法：node scripts/check-undefined.mjs [--require-tsc] [--typeRoots <dir>]'); process.exit(0) }
  else { console.error('未知参数：' + a); process.exit(2) }
}

/** 在若干个候选 node_modules 里找 typescript 的 tsc 入口（lib/tsc.js）。 */
function findTsc() {
  const roots = []
  if (process.env.DSH_TSC_ROOT) roots.push(process.env.DSH_TSC_ROOT)
  roots.push(join(REPO_ROOT, 'node_modules'))
  roots.push(join(MODULE_DIR, 'node_modules'))
  for (const name of ['workspace-tokenpet', 'dsh-doc-suite', 'dsh-experts', 'dsh-work-memory', 'dsh-mermaid']) {
    roots.push(join(REPO_ROOT, 'modules', name, 'node_modules'))
  }
  for (const r of roots) {
    const p = join(r, 'typescript', 'lib', 'tsc.js')
    if (existsSync(p)) return p
  }
  return ''
}

/** 找 @types 根目录（内含 node 类型声明）。 */
function findTypeRoots() {
  if (explicitTypeRoots) return explicitTypeRoots
  const roots = [
    join(MODULE_DIR, 'node_modules', '@types'),
    join(REPO_ROOT, 'node_modules', '@types')
  ]
  for (const name of ['workspace-tokenpet', 'dsh-doc-suite', 'dsh-experts', 'dsh-work-memory', 'dsh-mermaid']) {
    roots.push(join(REPO_ROOT, 'modules', name, 'node_modules', '@types'))
  }
  for (const r of roots) if (existsSync(join(r, 'node'))) return r
  return ''
}

if (!existsSync(TSCONFIG)) { console.error('缺失 tsconfig：' + TSCONFIG); process.exit(2) }

const tsc = findTsc()
if (tsc === '') {
  const how = '装法：npm install -D typescript @types/node（或设 DSH_TSC_ROOT / --typeRoots）'
  if (requireTsc) { console.error('❌ 未找到 tsc（--require-tsc 下判失败）。' + how); process.exit(1) }
  console.log('⏭ 跳过：本机未找到 tsc，未做未定义标识符检查。' + how)
  process.exit(0)
}

const typeRoots = findTypeRoots()
const args = [tsc, '-p', TSCONFIG]
if (typeRoots) args.push('--typeRoots', typeRoots)

console.log('check-undefined · 未定义标识符静态检查（T5-2）')
console.log('  tsc      ：' + tsc)
console.log('  typeRoots：' + (typeRoots || '（未指定，Node 全局可能被当未定义 → 会有假阳性）'))
console.log('')

const run = spawnSync(process.execPath, args, { encoding: 'utf8' })
const out = String(run.stdout ?? '') + String(run.stderr ?? '')
const hits = out.split(/\r?\n/).filter((l) => WANT.test(l))

if (hits.length === 0) {
  console.log('✅ 未发现未定义标识符（TS2304 / TS2552 = 0）')
  process.exit(0)
}
console.error('❌ 发现 ' + hits.length + ' 处未定义标识符：')
for (const h of hits) console.error('   ' + h)
console.error('')
console.error('说明：这些名字在本文件里既未声明、也未 import/require —— 运行到那一行必然 ReferenceError。')
process.exit(1)
