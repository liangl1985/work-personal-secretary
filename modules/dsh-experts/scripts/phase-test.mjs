#!/usr/bin/env node
/**
 * dsh-experts 阶段切面测试（独立于 regression.mjs，可单独运行）
 *
 * 覆盖（design-v2 第 9 节 + 第 16 节验收口径 6）：
 *   1. 卡片三态裁剪：understand（全卡）/ execute（丢方法行）/ deliver（只留交付）；不传 stage 与旧行为逐字一致；
 *   2. **交付行（自检红线）在任何阶段都保留** —— 这是"永不丢弃"的底线；
 *   3. 卡长单调：understand ≥ execute ≥ deliver，且裁剪不是把整块卡丢掉；
 *   4. full 形态不做阶段裁剪（全文信息完整，裁剪等于丢信息）；
 *   5. buildInjection 全链路：三阶段 × 多位专家；
 *   6. 交付层纪律块与能力指针**不受阶段影响**（独立通道，各按自己的门控）。
 *
 * 运行：node scripts/phase-test.mjs   （失败时非零退出）
 */

import assert from 'node:assert/strict'

import { allExperts, loadPersona } from '../lib/store.js'
import { buildPersonaCard, buildInjection } from '../lib/inject.js'
import { formatDiscipline } from '../lib/discipline.js'
import { routeCapabilities, toCapabilityEntry } from '../lib/capability.js'
import { INJECT_BUDGET_MAX } from '../lib/limits.js'

let pass = 0
let fail = 0
const results = []

function t(label, fn) {
  try {
    fn()
    pass += 1
    results.push('  ✅ ' + label)
  } catch (err) {
    fail += 1
    results.push('  ❌ ' + label + '\n       → ' + (err?.message || err))
  }
}

const experts = allExperts()
const STAGES = ['', 'understand', 'execute', 'deliver']

// ---------- 1. 全库裁剪一致性 ----------
t('全库 ' + experts.length + ' 位：四态卡都非空、结构合法、不传 stage 与 understand 逐字一致', () => {
  for (const e of experts) {
    const body = loadPersona(e)
    const base = buildPersonaCard(e, body)
    assert.ok(base.length > 0, e.id + ' 全卡为空')
    assert.equal(buildPersonaCard(e, body, {}), base, e.id + ' 不传 stage 应与旧行为一致')
    assert.equal(buildPersonaCard(e, body, { stage: 'understand' }), base, e.id + ' understand 应等于全卡')
    for (const stage of ['execute', 'deliver']) {
      const card = buildPersonaCard(e, body, { stage })
      assert.ok(card.length > 0, e.id + ' ' + stage + ' 卡为空（裁剪不应把卡丢空）')
      assert.ok(card.includes('交付：'), e.id + ' ' + stage + ' 丢了交付行（红线必须保留）')
    }
  }
})

// ---------- 2. 三态结构 ----------
t('三态结构：understand 三段齐全 / execute 无方法行 / deliver 只留交付', () => {
  const e = experts[0]
  const body = loadPersona(e)
  const full = buildPersonaCard(e, body)
  assert.ok(full.includes('角色：') && full.includes('方法：') && full.includes('交付：'), '全卡结构异常')
  const exec = buildPersonaCard(e, body, { stage: 'execute' })
  assert.ok(exec.includes('角色：') && !exec.includes('方法：') && exec.includes('交付：'), 'execute 结构异常：' + exec.slice(0, 80))
  assert.ok(exec.includes('阶段·execute'), 'execute 应带阶段标注')
  const dlv = buildPersonaCard(e, body, { stage: 'deliver' })
  assert.ok(!dlv.includes('角色：') && !dlv.includes('方法：') && !dlv.includes('交付：') === false, 'deliver 应只留交付：' + dlv.slice(0, 80))
  assert.ok(dlv.includes('阶段·deliver'), 'deliver 应带阶段标注')
  assert.ok(!dlv.includes('适用：'), 'deliver 不应带适用行')
})

// ---------- 3. 卡长单调 ----------
t('卡长单调：understand ≥ execute ≥ deliver（裁剪方向正确）', () => {
  for (const e of experts) {
    const body = loadPersona(e)
    const a = buildPersonaCard(e, body).length
    const b = buildPersonaCard(e, body, { stage: 'execute' }).length
    const c = buildPersonaCard(e, body, { stage: 'deliver' }).length
    assert.ok(a >= b, e.id + '：execute 不应比全卡长（' + a + ' → ' + b + '）')
    assert.ok(b >= c, e.id + '：deliver 不应比 execute 长（' + b + ' → ' + c + '）')
    assert.ok(c > 0, e.id + '：deliver 卡为空')
  }
})

// ---------- 4. full 不裁剪 ----------
t('full 形态不做阶段裁剪（deliver 也给完整正文）', () => {
  const sel = [{ entry: experts[0], score: 1, evidence: 1, reasons: ['test'] }]
  const full = buildInjection(sel, { banner: true, detail: 'full' })
  const fullDeliver = buildInjection(sel, { banner: true, detail: 'full', stage: 'deliver' })
  assert.equal(fullDeliver, full, 'full 形态下 stage 不应改变输出')
  assert.ok(fullDeliver.includes('## 工作方法'), 'full 应含完整方法段')
})

// ---------- 5. 多专家全链路 ----------
t('buildInjection 全链路：两位专家在三个阶段都被裁剪且都保留交付行', () => {
  const sel = [
    { entry: experts[0], score: 1, evidence: 1, reasons: ['a'] },
    { entry: experts[1], score: 0.9, evidence: 1, reasons: ['b'] },
  ]
  let prev = Infinity
  for (const stage of ['understand', 'execute', 'deliver']) {
    const out = buildInjection(sel, { banner: true, detail: 'card', budgetChars: INJECT_BUDGET_MAX, stage })
    assert.ok(out.includes('【本轮命中·'), stage + '：缺命中标题')
    assert.ok((out.match(/交付：/g) || []).length >= 2, stage + '：两位都应保留交付行')
    if (stage === 'execute') assert.ok(!out.includes('方法：'), 'execute 不应有方法行')
    if (stage === 'deliver') assert.ok(!out.includes('角色：'), 'deliver 不应有角色行')
    assert.ok(out.length < prev, stage + '：文本应随阶段推进继续变短或持平')
    prev = out.length
  }
})

// ---------- 6. 附属通道不受阶段影响 ----------
t('交付层纪律块与能力指针不受阶段影响（独立通道，各按自己的门控）', () => {
  const block = formatDiscipline({ status: 'ok', lines: ['红线一', '红线二'] })
  assert.ok(block.includes('红线一') && block.includes('红线二'), '纪律块内容异常')
  const pool = [toCapabilityEntry({ name: 'office-excel', description: 'Excel', provider: 'p', resourceBase: { path: 'x' } })]
  const a = routeCapabilities(pool, '帮我合并 xlsx', { budgetChars: 300, maxLines: 3 })
  const b = routeCapabilities(pool, '帮我合并 xlsx', { budgetChars: 300, maxLines: 5 })
  assert.deepEqual(a, b, '同一命中在默认条数上限内应与阶段无关')
  assert.ok(!block.includes('阶段·execute') && !block.includes('阶段·deliver'), '纪律块不应被卡片的阶段标注污染')
  results.push('       （纪律块 ' + block.length + ' 字符 / 能力指针 ' + a.length + ' 条，均由各自门控）')
})

console.log('\ndsh-experts 阶段切面测试 · ' + (pass + fail) + ' 项\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
