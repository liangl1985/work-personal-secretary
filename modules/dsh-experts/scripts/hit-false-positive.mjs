#!/usr/bin/env node
/**
 * dsh-experts **假命中**检测（负样本压测）。
 *
 * 负样本 = 纯事务 / 闲聊 / 生活句，**不应命中任何专家**（使用者 2026-09-16 定：精简的目标是命中更准、减少假命中）。
 * 用法：node scripts/hit-false-positive.mjs [--detail]
 * 退出码：假命中 ≤ 2 条 → 0；否则 1。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { allExperts } from '../lib/store.js'
import { selectExperts, keywordHits } from '../lib/match.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const negs = JSON.parse(readFileSync(here + 'hit-negative.json', 'utf8'))
const experts = allExperts()
const cfg = { defaultDomain: 'infosec', identityId: '', expertInjectMax: 4, expertSecondThreshold: 0.3, expertGeneralMax: 1, expertGeneralMinEvidence: 0.2 }
const showDetail = process.argv.includes('--detail')
const wordHit = new Map()
const dirty = []
for (const it of negs) {
  const { selected } = selectExperts(experts, { text: it.text, defaultDomain: 'infosec', branchDomain: null, identityId: '' }, cfg)
  if (!selected.length) continue
  const detail = selected.map((s) => {
    const ws = keywordHits(s.entry, it.text)
    for (const w of ws) wordHit.set(s.entry.id + '||' + w, (wordHit.get(s.entry.id + '||' + w) || 0) + 1)
    return s.entry.id + '[' + ws.join(',') + ']'
  })
  dirty.push({ id: it.id, text: it.text, detail })
}
console.log('负样本 ' + negs.length + ' 条 · 假命中 ' + dirty.length + ' 条 · 干净 ' + (negs.length - dirty.length) + ' 条')
if (showDetail) for (const x of dirty) console.log('  ' + x.id + ' ' + x.text + '  →  ' + x.detail.join('  |  '))
const src = [...wordHit.entries()].sort((a, b) => b[1] - a[1])
if (src.length) {
  console.log('假命中源词：')
  for (const [k, v] of src) console.log('  ' + v + '  ' + k.replace('||', ' → '))
}
process.exitCode = dirty.length <= 2 ? 0 : 1