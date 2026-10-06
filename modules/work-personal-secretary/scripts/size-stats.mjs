#!/usr/bin/env node
/**
 * size-stats —— 集成体规模统计（口径明确、可复现）
 *
 * 口径（严格照 `01_重构总纲.md` §2.2，不得自创）：
 *   1. 文本扩展集：.md .js .mjs .cjs .ts .tsx .json .yml .yaml .py .html .css .txt .ps1
 *   2. 排除目录：node_modules / .git / dist / __pycache__
 *   3. 行数 = content.split('\n').length（文件末尾有换行时比 `wc -l` 多 1）
 *   4. β 口径 = 排除 lib/ 目录（任意层级的 lib/）；α 口径 = 含 lib/（真实维护量）
 *
 * 与 01 §2.2 的关系：
 *   · 原口径两组（β 217/57,575、α 285/79,587）未声明扩展集与排除项 → 不可复现，只留档；
 *   · 本脚本落地 01 §2.2 的「实测组」口径（执行以此为准）：β 221/66,097、α 290/91,682 为 2026-10-04 快照值；
 *     本次实测以脚本输出为准——差异来源含时点差（P0 期间改动）与扩展集口径，见 01 §7-1。
 *
 * 用法：
 *   node scripts/size-stats.mjs                 # 统计脚本所在仓库根（<ROOT>）
 *   node scripts/size-stats.mjs <root>          # 指定统计根
 *   node scripts/size-stats.mjs --json          # 机器可读输出
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(HERE, '..', '..', '..') // modules/work-personal-secretary/scripts → <ROOT>
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const rootArg = args.find((a) => !a.startsWith('--'))
const ROOT = path.resolve(rootArg || DEFAULT_ROOT).replace(/[\\/]+$/, '')

const EXTS = new Set(['.md', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.py', '.html', '.css', '.txt', '.ps1'])
const SKIP = new Set(['node_modules', '.git', 'dist', '__pycache__'])
const LIB_SEGMENT = 'lib'

const files = []
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) { walk(abs, r); continue }
    const ext = path.extname(e.name).toLowerCase()
    if (!EXTS.has(ext)) continue
    const text = fs.readFileSync(abs, 'utf8')
    files.push({ rel: r, ext, lines: text.split('\n').length, inLib: r.split('/').includes(LIB_SEGMENT) })
  }
}
walk(ROOT, '')

const sum = (arr, key) => arr.reduce((s, x) => s + x[key], 0)
const alpha = files
const beta = files.filter((f) => !f.inLib)

const byTop = {}
for (const f of files) {
  const seg = f.rel.split('/')
  const key = seg[0] === 'modules' ? seg.slice(0, 2).join('/') : seg[0]
  byTop[key] = byTop[key] || { files: 0, lines: 0 }
  byTop[key].files += 1
  byTop[key].lines += f.lines
}

const report = {
  root: ROOT,
  generatedAt: new Date().toISOString(),
  ext: [...EXTS],
  skipDirs: [...SKIP],
  lineRule: 'content.split(\\n).length',
  alpha: { label: 'α（含 lib/，真实维护量）', files: alpha.length, lines: sum(alpha, 'lines') },
  beta: { label: 'β（排除 lib/）', files: beta.length, lines: sum(beta, 'lines') },
  libOnly: { files: alpha.length - beta.length, lines: sum(alpha, 'lines') - sum(beta, 'lines') },
  byTop,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('size-stats · ' + ROOT)
  console.log('口径：文本扩展 ' + [...EXTS].join(' ') + '；排除 ' + [...SKIP].join('/') + "；行数 = content.split('\\n').length")
  console.log('β（排除 lib/）：' + report.beta.files + ' 文件 / ' + report.beta.lines + ' 行')
  console.log('α（含 lib/）  ：' + report.alpha.files + ' 文件 / ' + report.alpha.lines + ' 行')
  console.log('其中 lib/ 部分：' + report.libOnly.files + ' 文件 / ' + report.libOnly.lines + ' 行')
  console.log('--- 顶层分区 ---')
  for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1].lines - a[1].lines)) {
    console.log(k.padEnd(46) + String(v.files).padStart(4) + String(v.lines).padStart(9))
  }
}
