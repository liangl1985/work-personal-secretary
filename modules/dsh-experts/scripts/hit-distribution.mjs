#!/usr/bin/env node
/**
 * dsh-experts 命中位数分布评估（关键词 ↔ 选取关系）
 *
 * 目标（使用者 2026-09-16 定）：**2 位与 3 位为常态**（合计 ≥55%）· **4 位占比 20–30%**。
 * 注：原「0/1 位 ≤15%」这一目标**已于 2026-09-16 由使用者撤销**（与真实任务结构冲突，见报告 49 第五节）；
 *     0+1 位仍照常统计显示，但**不再作为判据**、不参与退出码。
 * 用法：node scripts/hit-distribution.mjs [--detail] [--file <语料.json>]（默认读同目录 hit-corpus.json；真实语料可传 --file hit-corpus-real.json）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allExperts } from '../lib/store.js'
import { selectExperts } from '../lib/match.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const fileArg = process.argv.indexOf('--file')
const rel = fileArg >= 0 && process.argv[fileArg + 1] ? process.argv[fileArg + 1] : 'hit-corpus.json'
const corpusPath = /^([A-Za-z]:|\\|\/)/.test(rel) ? rel : here + rel
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
console.log('语料文件：' + corpusPath)
const experts = allExperts()
const cfg = {
  defaultDomain: 'infosec',
  identityExpert: '',
  expertInjectMax: 4,
  expertSecondThreshold: Number(process.env.SECOND_THRESHOLD || 0.3),
  expertGeneralMax: Number(process.env.GENERAL_MAX || 1),
  expertGeneralMinEvidence: Number(process.env.GENERAL_MIN_EVIDENCE || 0.2),
}
const showDetail = process.argv.includes('--detail')
const dist = new Map([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])
const rows = []
for (const item of corpus) {
  const { selected } = selectExperts(experts, { text: item.text, defaultDomain: cfg.defaultDomain, branchDomain: null, identityId: '' }, cfg)
  const n = selected.length
  dist.set(n, (dist.get(n) || 0) + 1)
  rows.push({ item, n, ids: selected.map((s) => s.entry.id + '(' + s.evidence + ')') })
}
const total = corpus.length
const pct = (n) => Math.round((n / total) * 1000) / 10
console.log('语料 ' + total + ' 条 · 门槛 secondThreshold=' + cfg.expertSecondThreshold
  + ' generalMax=' + cfg.expertGeneralMax + ' generalMinEvidence=' + cfg.expertGeneralMinEvidence)
console.log('')
console.log('位数 | 条数 | 占比')
for (const n of [0, 1, 2, 3, 4]) {
  const c = dist.get(n) || 0
  console.log('  ' + n + '  |  ' + String(c).padStart(2) + '  | ' + String(pct(c)).padStart(5) + '%')
}
const mid = (dist.get(2) || 0) + (dist.get(3) || 0)
const low = (dist.get(0) || 0) + (dist.get(1) || 0)
const four = dist.get(4) || 0
console.log('')
console.log('目标核对：')
console.log('  2+3 位 = ' + pct(mid) + '%  ' + (pct(mid) >= 55 ? '✅' : '❌') + ' （目标 ≥55%）')
console.log('  4 位   = ' + pct(four) + '%  ' + (pct(four) >= 20 && pct(four) <= 30 ? '✅' : '❌') + ' （目标 20–30%）')
if (showDetail) {
  console.log('')
  console.log('明细：')
  for (const r of rows) console.log('  [' + r.n + '] ' + r.item.id + ' ' + r.item.text.slice(0, 26) + ' → ' + (r.ids.join(' + ') || '无'))
}
const ok = pct(mid) >= 55 && pct(four) >= 20 && pct(four) <= 30
process.exitCode = ok ? 0 : 1