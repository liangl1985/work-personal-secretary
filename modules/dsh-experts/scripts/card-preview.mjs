#!/usr/bin/env node
/**
 * card-preview — 预览与验收专家精简卡（L1）的开发者工具
 *
 * 为什么固化：此前每次验收都要临时重建脚本（_cardcheck / _vcard），既重复又容易误删。
 * 本工具直接调用插件自身的 buildPersonaCard，结果与运行时注入口径一致。
 *
 * 判据分级（2026-09-14 校准）：
 *   FAIL  方法 1-3 的首句 > 90 字符 —— 卡只取前 3 条且每条 clip(90)，首句超长必在句中截断，读起来断裂。
 *   FAIL  卡为空（段落结构不可解析）。
 *   WARN  交付段前 2 条 > 90 字符 —— clip(90) 是既有设计（旧 20 位条目同样超），只提示不判错。
 *   INFO  卡长不在 500-620 区间 —— 目标区间而非硬约束；偏短只提示内容偏薄，卡面并无截断，故不计入 WARN。
 *
 * 用法：
 *   node scripts/card-preview.mjs --all
 *   node scripts/card-preview.mjs <正文路径> <id> <name> [when_to_use]
 *   CARD_SHOW=1 可打印卡面全文（cmd: $env:CARD_SHOW='1'）
 * 退出码：0 = 无 FAIL；1 = 有 FAIL
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const { buildPersonaCard, parsePersonaSections } = await import(pathToFileURL(path.join(ROOT, 'lib', 'inject.js')).href)

const SENTENCE_END = /(?<=[。！？!?；;])/
const CARD_MIN = 500
const CARD_MAX = 620

const leadSentence = (t) => { const s = String(t ?? '').trim(); return s ? (s.split(SENTENCE_END)[0] || s).trim() : '' }

function checkOne(file, id, name, when) {
  const fails = []; const warns = []
  let body = ''
  try { body = fs.readFileSync(file, 'utf8') } catch { fails.push('正文读取失败: ' + file) }
  if (!body) return { id, fails, warns, card: '' }
  const card = buildPersonaCard({ id, name, when_to_use: when || '' }, body)
  if (!card) fails.push('卡为空（段落结构不可解析）')
  const { methods, deliveries } = parsePersonaSections(body)
  methods.slice(0, 3).forEach((m, i) => {
    const lead = leadSentence(m)
    if (lead.length > 90) fails.push(`方法 ${i + 1} 首句 ${lead.length} 字 > 90（卡上会句中截断）`)
  })
  deliveries.slice(0, 2).forEach((d, i) => {
    if (d.length > 90) warns.push(`交付段第 ${i + 1} 条 ${d.length} 字 > 90（clip 后卡上截断）`)
  })
  const infos = []
  if (card.length && (card.length < CARD_MIN || card.length > CARD_MAX)) infos.push(`卡长 ${card.length} 不在 ${CARD_MIN}-${CARD_MAX}（目标区间，卡面无截断）`)
  return { id, fails, warns, infos, card, chars: body.length }
}

const args = process.argv.slice(2)
let targets = []
if (args[0] === '--all') {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'experts', 'index.json'), 'utf8'))
  targets = idx.experts.map(e => ({ file: path.join(ROOT, 'experts', e.file), id: e.id, name: e.name, when: e.when_to_use }))
} else {
  const [file, id, name, when] = args
  if (!file || !id) { console.error('用法: node scripts/card-preview.mjs --all | <正文路径> <id> <name> [when]'); process.exit(2) }
  targets = [{ file: path.isAbsolute(file) ? file : path.join(ROOT, file), id, name: name || id, when }]
}

let failed = 0; let warned = 0; let informed = 0
for (const t of targets) {
  const r = checkOne(t.file, t.id, t.name, t.when)
  const bad = r.fails.length > 0
  if (bad) failed++
  if (!bad && r.warns.length) warned++
  if (!bad && !r.warns.length && r.infos && r.infos.length) informed++
  console.log(`${bad ? 'FAIL' : (r.warns.length ? 'WARN' : 'OK  ')} ${r.id.padEnd(30)} 正文${String(r.chars ?? '-').padStart(5)} 卡${String(r.card ? r.card.length : '-').padStart(4)}`)
  for (const p of r.fails) console.log('       ✗ ' + p)
  for (const p of r.warns) console.log('       ⚠ ' + p)
  for (const p of (r.infos || [])) console.log('       ℹ ' + p)
  if (process.env.CARD_SHOW === '1' && r.card) console.log(r.card.split('\n').map(l => '       ' + l).join('\n'))
}
console.log(`\n共 ${targets.length} 位：FAIL ${failed} · WARN ${warned} · OK ${targets.length - failed - warned} · INFO(含告警) ${informed}`)
process.exit(failed > 0 ? 1 : 0)
