#!/usr/bin/env node
/**
 * dsh-experts 回归脚本（v2 库）
 *
 * 覆盖四类不变量（不依赖宿主 DSH 运行时，可独立 `node scripts/regression.mjs` 运行）：
 *   1. 索引完整性：index.json 可解析、字段齐全、id 唯一、域合法、**域配额合规**、file 全部存在、**复核标注（review）按域合规**；
 *   2. persona 体量：正文存在、含三段固定标题、字数在 900–3000 之间；
 *   3. 匹配打分：岗位先验 / 关键词 / 显式指定 / 跨域 Top-2 / **同职能不叠加** /
 *      **同域不同职能可并存** / **补位不污染（纯先验不补位）** / 身份专家恒选 / 阈值卡关；
 *   4. 注入组装：标题、截断标注、空 persona 不产出。
 *
 * 库现状（2026-09-14 域体系冻结）：**19 位 / 6 域**
 *   infosec 4 · accounting 4 · coding 3 · finance 2 · hr 1 · general 5
 *   配额：五个行业域 ≤4，general（跨行业职能兜底域）特例 ≤8。
 *
 * 运行：node scripts/regression.mjs
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DOMAINS, EXPERTS_ROOT, allExperts, findExpert, activeExperts, loadPersona, splitList, domainById, identityExpertOf } from '../lib/store.js'
import { selectExperts, rankExperts, WEIGHTS } from '../lib/match.js'
import { clampInjectMax, clampUnit, INJECT_MAX_HARD } from '../lib/limits.js'
import { buildInjection, buildPersonaBlock, PERSONA_MAX_CHARS } from '../lib/inject.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 五个行业域（每域 ≤4） */
const INDUSTRY_DOMAINS = ['infosec', 'accounting', 'hr', 'coding', 'finance']
/** 跨行业职能兜底域（特例 ≤8） */
const GENERAL_DOMAIN = 'general'
const QUOTA_INDUSTRY = 4
const QUOTA_GENERAL = 8
/**
 * 不再锁「定稿数量与分布」——库会演进（2026-09-14 已从 20 位 / 6 个旧职能域重构为 19 位 / 6 个新域）。
 * 数量与分布的结构性约束由以下断言覆盖：字段齐全 / id 唯一 / 文件存在 / 域合法 / 域配额（上下界）。
 * 任何新增或删除专家都不需要改本文件。
 */

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
test('index.json 可解析且专家数非空（不锁具体数量，随库演进）', () => {
  assert.ok(experts.length >= 1, '索引里没有任何专家')
})

test('每位专家字段齐全、关键词与角色标签非空', () => {
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

test('每位专家的正文文件真实存在', () => {
  const missing = experts.filter((e) => !existsSync(join(EXPERTS_ROOT, e.file))).map((e) => e.id + ' → ' + e.file)
  assert.equal(missing.length, 0, '缺文件：' + missing.join('、'))
})

test('domain 合法：只允许已登记的行业域与 general（不锁分布数量）', () => {
  // 域合法性以 index.json 实际出现的域为准（库演进时不会被 lib 的域表拖住）；
  // 每域的**数量**不在此处锁死——由下一条「域配额合规」断言负责上下界。
  const seen = new Set(experts.map((e) => e.domain))
  const allowed = new Set([...INDUSTRY_DOMAINS, GENERAL_DOMAIN])
  for (const d of seen) assert.ok(allowed.has(d), '出现未登记的域：' + d)
})

test('域配额合规：五个行业域 ≤' + QUOTA_INDUSTRY + '、general ≤' + QUOTA_GENERAL + '、每域 ≥1', () => {
  const count = {}
  for (const e of experts) count[e.domain] = (count[e.domain] || 0) + 1
  for (const d of INDUSTRY_DOMAINS) {
    assert.ok((count[d] || 0) >= 1, d + ' 至少应有 1 位，实际 ' + (count[d] || 0))
    assert.ok((count[d] || 0) <= QUOTA_INDUSTRY, d + ' 超过行业域配额 ' + QUOTA_INDUSTRY + '：' + count[d])
  }
  assert.ok((count[GENERAL_DOMAIN] || 0) >= 1, GENERAL_DOMAIN + ' 至少应有 1 位')
  assert.ok((count[GENERAL_DOMAIN] || 0) <= QUOTA_GENERAL,
    GENERAL_DOMAIN + ' 超过特例配额 ' + QUOTA_GENERAL + '：' + count[GENERAL_DOMAIN])
  const sum = Object.values(count).reduce((a, b) => a + b, 0)
  assert.equal(sum, experts.length, '域计数之和与专家总数不一致')
})

test('source 记录来源或许可（自撰需 origin=self-authored）', () => {
  // 一次性报全缺口（此前首个不满足者即抛出，会掩盖其余）
  const noOrigin = []
  const noLicense = []
  for (const e of experts) {
    const s = e.source || {}
    if (!(s.origin === 'self-authored' || s.repo)) noOrigin.push(e.id)
    if (!(s.license || s.origin === 'self-authored')) noLicense.push(e.id)
  }
  assert.equal(noOrigin.length, 0, '既无 repo 也无 self-authored：' + noOrigin.join('、'))
  assert.equal(noLicense.length, 0, '缺 license：' + noLicense.join('、'))
})

/**
 * 复核标注（2026-09-14 主人定，**按域判定**，不逐 id 写死——增删专家无需改本文件）：
 *   标 review=pending 的域：该域会输出**可能被当作专业结论或法规依据**的内容
 *     （安全方案/测评/招投标法规、会计准则与税法与内控审计、投资研究与量化风险表述、劳动法）；
 *   不标的域：coding（技术实现）、general（文档/演示/设计/核查，属工具与质检，不产出专业结论）。
 */
const REVIEW_PENDING_DOMAINS = ['infosec', 'accounting', 'finance', 'hr']
const REVIEW_FREE_DOMAINS = ['coding', GENERAL_DOMAIN]

test('专业结论/法规依据域必须标 source.review=pending（按域判定）', () => {
  const missing = []
  for (const e of experts) {
    if (!REVIEW_PENDING_DOMAINS.includes(e.domain)) continue
    const rev = (e.source || {}).review
    if (rev !== 'pending') missing.push(e.id + '（' + e.domain + '）→ ' + (rev === undefined ? '缺 review 字段' : rev))
  }
  assert.equal(missing.length, 0,
    '以下专家位于需复核域但未标 review=pending：\n       · ' + missing.join('\n       · '))
})

test('非专业结论域不应出现 review 字段（避免标注泛滥）', () => {
  const unexpected = []
  for (const e of experts) {
    if (!REVIEW_FREE_DOMAINS.includes(e.domain)) continue
    if ((e.source || {}).review !== undefined) unexpected.push(e.id + '（' + e.domain + '）→ ' + (e.source || {}).review)
  }
  assert.equal(unexpected.length, 0,
    '以下专家位于不需复核域却带了 review：\n       · ' + unexpected.join('\n       · '))
})

test('文档/演示/排版类专家声明与本集成体 dsh-doc-suite 的分工', () => {
  for (const id of ['general-office', 'general-slides', 'general-typeset']) {
    const e = findExpert(id)
    assert.ok(e, '缺专家 ' + id)
    const body = loadPersona(e)
    assert.ok(body.includes('dsh-doc-suite'), id + ' 未声明与 dsh-doc-suite 的分工')
  }
})

test('findExpert 支持完整 id 与后缀简写，且拒绝未知 id', () => {
  assert.ok(findExpert('accounting-accountant'), '完整 id 未命中')
  assert.ok(findExpert('accountant'), '后缀简写未命中')
  assert.equal(findExpert('no-such-expert'), null)
})

test('activeExperts：默认全量参与（岗位只作先验）/ enabledDomains / enabledExperts 三种口径', () => {
  const byDefault = activeExperts({ defaultDomain: 'infosec', enabledDomains: '', enabledExperts: '' })
  assert.equal(byDefault.length, experts.length, '默认应全量参与匹配，实际 ' + byDefault.length)
  const expectDomains = experts.filter((e) => e.domain === 'coding' || e.domain === 'general').length
  const byDomains = activeExperts({ defaultDomain: 'infosec', enabledDomains: 'coding,general', enabledExperts: '' })
  assert.equal(byDomains.length, expectDomains, 'coding+general 应 ' + expectDomains + ' 位，实际 ' + byDomains.length)
  const byIds = activeExperts({ defaultDomain: 'infosec', enabledDomains: '', enabledExperts: 'general-office, hr-labor-law' })
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
const ctx = (over = {}) => ({ text: '', defaultDomain: 'infosec', branchDomain: null, explicitId: null, ...over })
const cfg = (over = {}) => ({ expertInjectMax: 1, expertSecondThreshold: 0.8, expertMinScore: 0.35, ...over })

test('岗位先验：空任务文本也命中本域专家（且分数 = 权重值）', () => {
  const { selected } = selectExperts(experts, ctx(), cfg())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].entry.domain, 'infosec')
  assert.equal(selected[0].score, WEIGHTS.domain)
})

test('关键词命中：等保问题命中等保测评专家', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '客户要做三级等保测评，定级备案流程怎么走', defaultDomain: GENERAL_DOMAIN }), cfg())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].entry.id, 'infosec-djbh')
})

test('显式指定压过岗位先验', () => {
  const { selected } = selectExperts(experts, ctx({ text: '帮我看看', explicitId: 'hr-labor-law' }), cfg())
  assert.equal(selected[0].entry.id, 'hr-labor-law')
  assert.ok(selected[0].reasons.includes('显式指定'))
})

test('分数不足则不注入（宁缺勿滥）', () => {
  const { selected, reason } = selectExperts(experts,
    ctx({ text: '今天天气不错', defaultDomain: GENERAL_DOMAIN }), cfg({ expertMinScore: 0.9 }))
  assert.equal(selected.length, 0)
  assert.equal(reason, 'below-threshold')
})

test('跨域 Top-2：上限 2 且两位证据接近时补第二位；两位须跨域', () => {
  const text = '解除劳动合同的经济补偿要交个税吗'
  const one = selectExperts(experts, ctx({ text, defaultDomain: 'coding' }), cfg({ expertInjectMax: 1 }))
  assert.equal(one.selected.length, 1, '上限 1 时只应 1 位')

  const two = selectExperts(experts, ctx({ text, defaultDomain: 'coding' }), cfg({ expertInjectMax: 2 }))
  const ids = two.selected.map((s) => s.entry.id)
  assert.equal(two.selected.length, 2, '上限 2 且跨域达标时应 2 位，实际：' + ids.join(','))
  const [a, b] = two.selected
  assert.notEqual(a.entry.domain, b.entry.domain, '两位不得同域')
  assert.ok(b.evidence > 0, '第二位应带任务实证，而不是靠岗位先验凑数')
  assert.ok(b.evidence >= a.evidence * 0.8 || b.score >= a.score * 0.8, '第二位未达门槛')
  assert.ok(ids.includes('hr-labor-law'), '缺劳动法专家：' + ids.join(','))
  assert.ok(ids.includes('accounting-tax'), '缺税务专家：' + ids.join(','))
})

test('去重粒度 = 职能键 role_tag[0]：同职能不叠加', () => {
  // 用构造条目直接验证语义（新库 infosec 四位职能两两不同，找不到天然的同职能对）
  const mk = (id, domain, func, kw) => ({ id, name: id, domain, role_tag: [func, 'x'], when_to_use: 't', trigger_keywords: kw, file: 'nope.md', source: { origin: 'self-authored' } })
  const pool = [
    mk('a-sales', 'infosec', '售前', ['方案']),
    mk('a-presales', 'infosec', '售前', ['方案']),
    mk('b-presales', 'infosec', '投标', ['方案']),
  ]
  const { selected } = selectExperts(pool, { text: '方案', defaultDomain: 'infosec' }, cfg({ expertInjectMax: 3 }))
  const funcs = selected.map((s) => s.entry.role_tag[0])
  assert.equal(new Set(funcs).size, funcs.length, '同职能键被重复选中：' + funcs.join(','))
  assert.ok(selected.length >= 1)
})

test('同域不同职能可同轮并存（域变粗后不再按域去重）', () => {
  const text = '工控项目要过等保，还要投标'
  const { selected } = selectExperts(experts, ctx({ text, defaultDomain: 'coding' }), cfg({ expertInjectMax: 3 }))
  const ids = selected.map((s) => s.entry.id)
  assert.ok(selected.length >= 2, '同域多职能应可并存，实际 ' + selected.length + ' 位：' + ids.join(','))
  assert.ok(selected.every((s) => s.entry.domain === 'infosec'), '本用例应全部落在 infosec 域：' + ids.join(','))
  const funcs = selected.map((s) => s.entry.role_tag[0])
  assert.equal(new Set(funcs).size, funcs.length, '同职能键重复：' + funcs.join(','))
})

test('补位不污染：任务有明确实证时，不补出只沾岗位先验的专家', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '这个插件的设置命名空间怎么注册', defaultDomain: 'infosec' }), cfg({ expertInjectMax: 2 }))
  const ids = selected.map((s) => s.entry.id)
  assert.ok(ids.includes('coding-dsh-plugin'), '应命中插件专家：' + ids.join(','))
  assert.ok(!ids.includes('infosec-ics-security'), '不应补出只靠岗位先验的专家：' + ids.join(','))
  assert.equal(selected.length, 1, '纯先验不得补位，实际 ' + selected.length + ' 位：' + ids.join(','))
})

test('rankExperts 证据优先：有任务实证的排在只有岗位先验的之前', () => {
  const ranked = rankExperts(experts, ctx({ text: '解除劳动合同的经济补偿要交个税吗' }))
  assert.ok(ranked[0].evidence > 0, '第一名应带任务实证，实际 ' + ranked[0].entry.id)
  assert.ok(['hr-labor-law', 'accounting-tax'].includes(ranked[0].entry.id),
    '第一名应为劳动法或税务专家，实际 ' + ranked[0].entry.id)
  const firstInfosec = ranked.findIndex((r) => r.entry.domain === 'infosec')
  const taxAt = ranked.findIndex((r) => r.entry.id === 'accounting-tax')
  assert.ok(taxAt >= 0 && taxAt < firstInfosec,
    '有实证的税务专家应排在只有岗位先验的 infosec 专家之前（tax@' + taxAt + ' vs infosec@' + firstInfosec + '）')
})

test('rankExperts 同 evidence 档内按总分降序、空任务由岗位先验兜底', () => {
  const ranked = rankExperts(experts, ctx())
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].evidence >= ranked[i].evidence, 'evidence 未降序')
  }
  assert.equal(ranked[0].entry.domain, 'infosec', '空任务应由岗位先验兜底')
  assert.equal(ranked[0].score, WEIGHTS.domain)
})

test('身份专家：留空时取岗位域第一位；显式指定优先；无效 id 回退', () => {
  const auto = identityExpertOf({ defaultDomain: 'infosec', identityExpert: '' })
  assert.ok(auto, '未解析出身份专家')
  assert.equal(auto.domain, 'infosec', '留空应取岗位域第一位')
  const picked = identityExpertOf({ defaultDomain: 'infosec', identityExpert: 'infosec-djbh' })
  assert.equal(picked.id, 'infosec-djbh', '显式指定的身份专家未生效')
  const fallback = identityExpertOf({ defaultDomain: 'infosec', identityExpert: 'no-such-id' })
  assert.ok(fallback && fallback.domain === 'infosec', '无效 id 应回退到岗位域')
})

test('身份专家恒选：默认上限 1 时只注入身份专家（跨域任务也不挤占常驻上下文）', () => {
  const { selected, reason } = selectExperts(
    experts,
    ctx({ text: '客户要做三级等保测评，定级备案怎么走', identityId: 'accounting-accountant' }),
    cfg({ expertInjectMax: 1 }),
  )
  assert.equal(selected.length, 1, '实际 ' + selected.length + ' 位')
  assert.equal(selected[0].entry.id, 'accounting-accountant', '身份专家未被恒选')
  assert.equal(reason, 'identity+0')
})

test('问题归属补位：上限 2 时，跨职能命中的专家被补上（身份专家 +1）', () => {
  const { selected } = selectExperts(
    experts,
    ctx({ text: '客户要做三级等保测评，定级备案怎么走', identityId: 'infosec-ics-security' }),
    cfg({ expertInjectMax: 2 }),
  )
  const ids = selected.map((s) => s.entry.id)
  assert.equal(selected.length, 2, '实际：' + ids.join(','))
  assert.ok(ids.includes('infosec-ics-security'), '缺身份专家：' + ids.join(','))
  assert.ok(ids.includes('infosec-djbh'), '未补上命中的等保专家：' + ids.join(','))
})

// ---------- 4. 注入与设置归一化 ----------
test('注入组装：无身份专家时命中块带「本轮命中」标题与正文', () => {
  const { selected } = selectExperts(experts, ctx({ explicitId: 'general-office' }), cfg())
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

test('lib 域表（DOMAINS）覆盖 index.json 中实际使用的全部域', () => {
  // 库重构后 store.js 的 DOMAINS 必须与索引同源；否则 /expert list 会漏掉整片域
  const ids = new Set(DOMAINS.map((d) => d.id))
  const missing = [...new Set(experts.map((e) => e.domain))].filter((d) => !ids.has(d))
  assert.equal(missing.length, 0, 'store.js DOMAINS 缺域：' + missing.join('、') + '（实际表：' + [...ids].join('/') + '）')
  assert.equal(DOMAINS.length, INDUSTRY_DOMAINS.length + 1, 'DOMAINS 应有 6 个域（5 行业 + general），实际 ' + DOMAINS.length)
  for (const d of DOMAINS) {
    assert.ok(domainById(d.id), d.id + ' 查询失败')
    assert.ok(d.name && d.desc, d.id + ' 缺展示名或说明')
  }
})

// ---------- 汇总 ----------
console.log('\ndsh-experts 回归 · ' + (pass + fail) + ' 项\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
