#!/usr/bin/env node
/**
 * dsh-experts 回归脚本
 *
 * 覆盖四类不变量（不依赖宿主 DSH 运行时，可独立 `node scripts/regression.mjs` 运行）：
 *   1. 索引完整性：index.json 可解析、20 位、字段齐全、id 唯一、域合法；
 *   2. persona 体量：正文存在、含三段固定标题、字数在 900–3000 之间（实测 1.3–1.8 千字；区间按 900–3000 非空白字符卡）；
 *   3. 匹配打分：岗位先验 / 关键词 / 显式指定 / 跨域 Top-2 门槛 / 同域不叠加 / 阈值卡关；
 *   4. 注入组装：标题、截断标注、空 persona 不产出。
 *
 * 运行：node scripts/regression.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOMAINS, allExperts, findExpert, activeExperts, loadPersona, splitList, domainById, identityExpertOf } from '../lib/store.js'
import { selectExperts, rankExperts, WEIGHTS } from '../lib/match.js'
import { clampInjectMax, clampUnit, INJECT_MAX_HARD } from '../lib/limits.js'
import { buildInjection, buildPersonaBlock, PERSONA_MAX_CHARS } from '../lib/inject.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXPECTED_TOTAL = 20
const EXPECTED_BY_DOMAIN = { presales: 5, aftersales: 4, finance: 5, legal: 2, doc: 3, general: 1 }
const REQUIRED_FIELDS = ['id', 'name', 'domain', 'role_tag', 'when_to_use', 'trigger_keywords', 'file', 'source']
const SECTION_TITLES = ['## 角色', '## 工作方法（拆解任务的默认角度）', '## 交付与自检']

let pass = 0
let fail = 0
const results = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    results.push('  ✅ ' + name)
  } catch (err) {
    fail += 1
    results.push('  ❌ ' + name + '\n       → ' + (err?.message || err))
  }
}

const experts = allExperts()

// ---------- 1. 索引完整性 ----------
test('index.json 可解析且专家数为 ' + EXPECTED_TOTAL, () => {
  assert.equal(experts.length, EXPECTED_TOTAL, '实际 ' + experts.length + ' 位')
})

test('每位专家字段齐全', () => {
  for (const e of experts) {
    for (const f of REQUIRED_FIELDS) {
      assert.ok(e[f] !== undefined && e[f] !== null && e[f] !== '', e.id + ' 缺字段 ' + f)
    }
    assert.ok(Array.isArray(e.trigger_keywords) && e.trigger_keywords.length >= 3, e.id + ' 触发关键词过少')
    assert.ok(Array.isArray(e.role_tag) && e.role_tag.length >= 1, e.id + ' 缺 role_tag')
  }
})

test('id 唯一', () => {
  const seen = new Set()
  for (const e of experts) {
    assert.ok(!seen.has(e.id), '重复 id：' + e.id)
    seen.add(e.id)
  }
})

test('domain 合法且分布符合定稿（售前5/售后4/财务5/法务2/文档3/通用1）', () => {
  const valid = new Set(DOMAINS.map((d) => d.id))
  const count = {}
  for (const e of experts) {
    assert.ok(valid.has(e.domain), e.id + ' 的域非法：' + e.domain)
    count[e.domain] = (count[e.domain] || 0) + 1
  }
  for (const [d, n] of Object.entries(EXPECTED_BY_DOMAIN)) {
    assert.equal(count[d] || 0, n, d + ' 实际 ' + (count[d] || 0) + ' 位，应为 ' + n)
  }
})

test('source 记录来源或许可（自撰需 origin=self-authored）', () => {
  for (const e of experts) {
    const s = e.source || {}
    assert.ok(s.origin === 'self-authored' || s.repo, e.id + ' 既无 repo 也无 self-authored')
    assert.ok(s.license || s.origin === 'self-authored', e.id + ' 缺 license')
  }
})

test('安全域 6 位 + 法务 2 位标 review=pending（待专业复核后才算对外可用）', () => {
  const need = [
    'presales-cyber-security', 'presales-ics-security',
    'aftersales-cyber-support', 'aftersales-ics-support', 'aftersales-djbh', 'aftersales-pentest',
    'legal-civil', 'legal-criminal',
  ]
  for (const id of need) {
    const e = findExpert(id)
    assert.ok(e, '缺专家 ' + id)
    assert.equal(e.source.review, 'pending', id + ' 未标 review=pending')
  }
})

test('文档域 3 位均声明与本集成体 dsh-doc-suite 的分工', () => {
  for (const id of ['doc-office', 'doc-report-typeset', 'doc-ppt']) {
    const body = loadPersona(findExpert(id))
    assert.ok(body.includes('dsh-doc-suite'), id + ' 未声明与 dsh-doc-suite 的分工')
  }
})

test('findExpert 支持完整 id 与后缀简写，且拒绝未知 id', () => {
  assert.ok(findExpert('finance-accountant'), '完整 id 未命中')
  assert.ok(findExpert('accountant'), '后缀简写未命中')
  assert.equal(findExpert('no-such-expert'), null)
})

test('activeExperts：默认全量参与（岗位只作先验）/ enabledDomains / enabledExperts 三种口径', () => {
  const byDefault = activeExperts({ defaultDomain: 'presales', enabledDomains: '', enabledExperts: '' })
  assert.equal(byDefault.length, EXPECTED_TOTAL, '默认应全量参与匹配，实际 ' + byDefault.length)
  const byDomains = activeExperts({ defaultDomain: 'presales', enabledDomains: 'legal,general', enabledExperts: '' })
  assert.equal(byDomains.length, 3, 'legal+general 应 3 位，实际 ' + byDomains.length)
  const byIds = activeExperts({ defaultDomain: 'presales', enabledDomains: '', enabledExperts: 'doc-ppt, legal-criminal' })
  assert.equal(byIds.length, 2, 'id 白名单应 2 位，实际 ' + byIds.length)
})

test('splitList 兼容中英文逗号与顿号', () => {
  assert.deepEqual(splitList('a, b，c、d'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(splitList(''), [])
})

// ---------- 2. persona 正文 ----------
test('每位 persona 文件存在、含三段标题、字数 900–3000', () => {
  const problems = []
  for (const e of experts) {
    const body = loadPersona(e)
    if (!body) {
      problems.push(e.id + '：文件缺失或为空（' + e.file + '）')
      continue
    }
    for (const t of SECTION_TITLES) {
      if (!body.includes(t)) problems.push(e.id + '：缺标题「' + t + '」')
    }
    const n = body.replace(/\s/g, '').length
    if (n < 900) problems.push(e.id + '：仅 ' + n + ' 字，偏薄')
    if (n > 3000) problems.push(e.id + '：' + n + ' 字，超上限（挤上下文）')
  }
  assert.equal(problems.length, 0, '\n       · ' + problems.join('\n       · '))
})

// ---------- 3. 匹配打分 ----------
const ctx = (over = {}) => ({ text: '', defaultDomain: 'presales', branchDomain: null, explicitId: null, ...over })
const cfg = (over = {}) => ({ expertInjectMax: 1, expertSecondThreshold: 0.8, expertMinScore: 0.35, ...over })

test('岗位先验：空任务文本也命中本域专家（且分数 = 权重值）', () => {
  const { selected } = selectExperts(experts, ctx(), cfg())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].entry.domain, 'presales')
  assert.equal(selected[0].score, WEIGHTS.domain)
})

test('关键词命中：等保问题命中等保测评专家', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '客户要做三级等保测评，定级备案流程怎么走', defaultDomain: 'general' }), cfg())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].entry.id, 'aftersales-djbh')
})

test('显式指定压过岗位先验', () => {
  const { selected } = selectExperts(experts, ctx({ text: '帮我看看', explicitId: 'legal-criminal' }), cfg())
  assert.equal(selected[0].entry.id, 'legal-criminal')
  assert.ok(selected[0].reasons.includes('显式指定'))
})

test('分数不足则不注入（宁缺勿滥）', () => {
  const { selected, reason } = selectExperts(experts,
    ctx({ text: '今天天气不错', defaultDomain: 'doc' }), cfg({ expertMinScore: 0.9 }))
  assert.equal(selected.length, 0)
  assert.equal(reason, 'below-threshold')
})

test('跨域 Top-2：上限 2 且分数达标时补第二位；同域不叠加', () => {
  const text = '这份合同的钱怎么算、税怎么处理'
  const one = selectExperts(experts, ctx({ text, defaultDomain: 'finance' }), cfg({ expertInjectMax: 1 }))
  assert.equal(one.selected.length, 1, '上限 1 时只应 1 位')

  const two = selectExperts(experts, ctx({ text, defaultDomain: 'finance' }), cfg({ expertInjectMax: 2 }))
  assert.equal(two.selected.length, 2, '上限 2 且跨域达标时应 2 位，实际 ' + two.selected.length)
  const [a, b] = two.selected
  assert.notEqual(a.entry.domain, b.entry.domain, '两位不得同域')
  assert.ok(b.evidence > 0, '第二位应带任务实证，而不是靠岗位先验凑数')
  assert.ok(b.evidence >= a.evidence * 0.8 || b.score >= a.score * 0.8, '第二位未达门槛')

  const allPresales = experts.filter((e) => e.domain === 'presales')
  const same = selectExperts(allPresales, ctx(), cfg({ expertInjectMax: 3 }))
  assert.equal(same.selected.length, 1, '同域不得叠加')
})

test('rankExperts 按分数降序且稳定', () => {
  const ranked = rankExperts(experts, ctx({ text: '工控安全方案' }))
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, '排序不稳定')
  }
})

test('身份专家：留空时取岗位域第一位；显式指定优先', () => {
  const auto = identityExpertOf({ defaultDomain: 'presales', identityExpert: '' })
  assert.ok(auto, '未解析出身份专家')
  assert.equal(auto.domain, 'presales', '留空应取岗位域第一位')
  const picked = identityExpertOf({ defaultDomain: 'presales', identityExpert: 'aftersales-djbh' })
  assert.equal(picked.id, 'aftersales-djbh', '显式指定的身份专家未生效')
  const fallback = identityExpertOf({ defaultDomain: 'presales', identityExpert: 'no-such-id' })
  assert.ok(fallback && fallback.domain === 'presales', '无效 id 应回退到岗位域')
})

test('身份专家恒选：默认上限 1 时只注入身份专家（跨域任务也不挤占常驻上下文）', () => {
  const { selected, reason } = selectExperts(
    experts,
    ctx({ text: '客户要做三级等保测评，定级备案怎么走', identityId: 'finance-accountant' }),
    cfg({ expertInjectMax: 1 }),
  )
  assert.equal(selected.length, 1, '实际 ' + selected.length + ' 位')
  assert.equal(selected[0].entry.id, 'finance-accountant', '身份专家未被恒选')
  assert.equal(reason, 'identity+0')
})

test('问题归属补位：上限 2 时，跨域命中的专家被补上（身份专家 +1）', () => {
  const { selected } = selectExperts(
    experts,
    ctx({ text: '客户要做三级等保测评，定级备案怎么走', identityId: 'presales-ics-security' }),
    cfg({ expertInjectMax: 2 }),
  )
  const ids = selected.map((s) => s.entry.id)
  assert.equal(selected.length, 2, '实际：' + ids.join(','))
  assert.ok(ids.includes('presales-ics-security'), '缺身份专家：' + ids.join(','))
  assert.ok(ids.includes('aftersales-djbh'), '未补上跨域命中的等保专家：' + ids.join(','))
})

// ---------- 4. 注入与设置归一化 ----------
test('注入组装：无身份专家时命中块带「本轮命中」标题与正文', () => {
  const { selected } = selectExperts(experts, ctx({ explicitId: 'doc-office' }), cfg())
  const text = buildInjection(selected, { banner: true })
  assert.ok(text.includes('【本轮命中·'), '缺标题：' + text.slice(0, 80))
  assert.ok(text.includes('【处理路径】'), '缺处理路径提示')
  assert.ok(text.includes('## 角色'), '缺正文')
})

test('注入组装：超长 persona 截断并标注（不静默丢弃）', () => {
  const long = 'x'.repeat(PERSONA_MAX_CHARS + 200)
  const block = buildPersonaBlock({ id: 't', name: '测试', file: 't.md' }, long)
  assert.ok(block.includes('已截断'), '未标注截断')
  assert.ok(block.length < long.length + 300, '未见截断效果')
})

test('空 persona 不产出注入块', () => {
  assert.equal(buildInjection([{ entry: { id: 'x', name: 'x', file: 'nope.md' }, score: 1 }], {}), '')
})

test('注入上限归一化：非法 → 1，超界 → ' + INJECT_MAX_HARD, () => {
  assert.equal(clampInjectMax(0), 1)
  assert.equal(clampInjectMax('abc'), 1)
  assert.equal(clampInjectMax(2), 2)
  assert.equal(clampInjectMax(99), INJECT_MAX_HARD)
  assert.equal(clampUnit('bad', 0.8), 0.8)
  assert.equal(clampUnit(0.5, 0.8), 0.5)
})

test('域定义齐全（6 域，含中文名）', () => {
  assert.equal(DOMAINS.length, 6)
  for (const d of DOMAINS) {
    assert.ok(domainById(d.id), d.id + ' 查询失败')
    assert.ok(d.name && d.desc, d.id + ' 缺展示名或说明')
  }
})

// ---------- 汇总 ----------
console.log('\ndsh-experts 回归 · ' + (pass + fail) + ' 项\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
