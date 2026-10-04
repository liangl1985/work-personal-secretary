#!/usr/bin/env node
/**
 * 发布件个人路径门禁 —— 打包后按**包内实际文件内容**扫描。
 *
 * 为什么需要它：2026-10-04 两次独立静态扫描都漏检了 experts/skills.auto.json ——
 * JSON 里是转义后的双反斜杠（<工作区>），单反斜杠检索式命中不了；且
 * .gitignore 拦不住 npm 打包（files 白名单优先）。本脚本改为"先打包、再逐字节扫"。
 *
 * 用法：node scripts/check-publish-paths.mjs
 * 退出码：0 通过 ｜ 1 命中个人路径 ｜ 2 执行失败
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const HERE = fileURLToPath(new URL('..', import.meta.url))
/** 解析 npm 的 CLI 入口：环境变量优先，其次与 node 同目录（PATH 里常没有 npm；也不要经 shell，避免 "C:\Program Files" 被截断） */
function resolveNpmCli() {
  const cands = []
  if (process.env.npm_execpath && /npm-cli\.js$/.test(process.env.npm_execpath)) cands.push(process.env.npm_execpath)
  const dir = dirname(process.execPath)
  cands.push(join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  for (const c of cands) { try { if (statSync(c).isFile()) return c } catch { /* 继续找 */ } }
  return ''
}

const PATTERNS = [
  { name: '个人盘符路径(Users/工作区)', re: /[A-Za-z]:[\\/]{1,2}(?:Users[\\/][^\\/"'\s]+|lina)/g },
  // 私有称呼：用 Unicode 转义写，避免门禁脚本自身被自己的模式命中（自指）
  { name: '私有称呼', re: /(?:\u4e3b\u4eba|\u8389\u5a1c)/g },
]

const tmp = mkdtempSync(join(tmpdir(), 'dsh-publish-gate-'))
let failed = false
const findings = []
try {
  // --ignore-scripts：避免与 prepack 等钩子相互递归
  const npmCli = resolveNpmCli()
  const packArgs = ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp]
  const out = npmCli
    ? execFileSync(process.execPath, [npmCli, ...packArgs], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : execFileSync('npm', packArgs, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true })
  const info = JSON.parse(out)
  const tgz = join(tmp, info[0].filename)
  const unpack = join(tmp, 'unpacked')
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'ignore' })
  const root = join(tmp, 'package')

  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (statSync(full).size > 2_000_000) continue
      let text = ''
      try { text = readFileSync(full, 'utf8') } catch { continue }
      for (const p of PATTERNS) {
        const hits = [...new Set([...text.matchAll(p.re)].map((m) => m[0]))]
        if (hits.length) { findings.push({ file: full.slice(root.length + 1), kind: p.name, hits: hits.slice(0, 5) }); failed = true }
      }
    }
  }
  walk(root)
  console.log('包内文件数：' + info[0].files.length + '（' + info[0].filename + '）')
} catch (e) {
  console.error('门禁执行失败：' + (e && e.message ? e.message : String(e)))
  rmSync(tmp, { recursive: true, force: true })
  process.exit(2)
}
rmSync(tmp, { recursive: true, force: true })

if (failed) {
  console.error('❌ 发布件含个人路径 / 私有称呼：')
  for (const f of findings) console.error('  · ' + f.file + ' [' + f.kind + '] → ' + f.hits.join(' , '))
  process.exit(1)
}
console.log('✅ 发布件个人路径门禁通过')
