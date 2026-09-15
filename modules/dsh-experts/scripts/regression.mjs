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

import { DOMAINS, EXPERTS_ROOT, allExperts, allPersonas, allSkills, findSkill, kindOf, findExpert, activeExperts, loadPersona, splitList, domainById, identityExpertOf } from '../lib/store.js'
import { selectExperts, rankExperts, pickWorkers, WEIGHTS } from '../lib/match.js'
import { clampInjectMax, clampUnit, INJECT_MAX_HARD, INJECT_MAX_DEFAULT, COST_PERSONA_CARD, COST_SKILL_LINE } from '../lib/limits.js'
import { buildInjection, buildPersonaBlock, buildPersonaCard, PERSONA_MAX_CHARS, buildCatalog, CATALOG_MAX_CHARS } from '../lib/inject.js'
import { parseDiscipline, formatDiscipline, DISCIPLINE_MARK } from '../lib/discipline.js'
import { toCapabilityEntry, capabilityLine, routeCapabilities, createSkillSource } from '../lib/capability.js'

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

test('kind 分池：persona 池 = 索引全部（无 kind 视为 persona）；能力池缺文件时为空且不报错', () => {
  const personas = allPersonas()
  assert.equal(personas.length, experts.length, 'persona 池应等于索引条目数，实际 ' + personas.length)
  assert.ok(personas.every((e) => kindOf(e) === 'persona'), 'persona 池混入了非 persona 条目')
  const skills = allSkills()
  assert.ok(Array.isArray(skills), '能力池应为数组')
  for (const s of skills) {
    assert.equal(s.kind, 'skill', '能力条目缺 kind=skill：' + s.id)
    assert.ok(s.id && s.name, '能力条目缺 id / name：' + JSON.stringify(s))
  }
  assert.equal(findSkill('no-such-skill'), null)
  assert.equal(kindOf({ kind: 'persona' }), 'persona')
  assert.equal(kindOf({}), 'persona')
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
const cfg = (over = {}) => ({ expertInjectMax: 1, expertSecondThreshold: 0.8, ...over })

test('零命中不注入：空任务文本下不注入任何专家（宁缺勿滥）', () => {
  const { selected, reason } = selectExperts(experts, ctx(), cfg())
  assert.equal(selected.length, 0, '零命中不应注入：' + selected.map((s) => s.entry.id).join(','))
  assert.equal(reason, 'no-evidence')
})

test('零命中不补位：上限 2 时空任务也不补出第二位（补位污染根治）', () => {
  const { selected } = selectExperts(experts, ctx({ text: '帮我看看这个' }), cfg({ expertInjectMax: 2 }))
  assert.equal(selected.length, 0, '零命中不应补位：' + selected.map((s) => s.entry.id).join(','))
})

test('有任务实证时跨域命中正常（零命中闸门不误伤真命中）', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '这个月的发票和税务怎么处理', defaultDomain: 'infosec' }), cfg({ expertInjectMax: 2 }))
  assert.ok(selected.length >= 1, '应命中税务专家')
  assert.equal(selected[0].entry.id, 'accounting-tax', '实际：' + selected.map((s) => s.entry.id).join(','))
})

test('关键词命中：等保问题命中等保测评专家', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '客户要做三级等保测评，定级备案流程怎么走', defaultDomain: GENERAL_DOMAIN }), cfg())
  assert.equal(selected.length, 1)
  assert.equal(selected[0].entry.id, 'infosec-djbh')
})

test('任务证据压过岗位先验：跨域对口专家排在只沾岗位域的专家之前', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '这个月的发票和税务怎么处理', defaultDomain: 'infosec' }), cfg())
  assert.equal(selected.length, 1, '只应注入命中的那一位：' + selected.map((s) => s.entry.id).join(','))
  assert.equal(selected[0].entry.id, 'accounting-tax', '跨域对口专家未排第一')
})

test('role_tag 不再当命中信号（只作职能去重键）', () => {
  // 「工控安全」在 infosec-sales-engineer 的 role_tag 里、同时是 ics-security 的关键词：
  // 旧口径会让销售位凭标签分被顺带补位（实测误命中），现只应命中真正带该关键词的那位。
  const { selected } = selectExperts(experts,
    ctx({ text: '帮我看看工控安全的事', defaultDomain: 'general' }), cfg({ expertInjectMax: 2 }))
  const ids = selected.map((s) => s.entry.id)
  assert.ok(ids.includes('infosec-ics-security'), '应命中工控安全售前：' + ids.join(','))
  assert.ok(!ids.includes('infosec-sales-engineer'), '销售位不应凭 role_tag 被顺带命中：' + ids.join(','))
})

test('关键词表：与本位正文不脱节（≥2 词有正文落点）', () => {
  // 口径说明：关键词表来自**用户语言**（用户会说「质量」「回归」），不要求与正文一一对应；
  // 但至少要有一两个词在本位正文里有落点，证明「这位专家确实管这件事」。
  const bad = []
  for (const e of experts) {
    const body = loadPersona(e) || ''
    const kws = e.trigger_keywords || []
    const inBody = kws.filter((k) => body.includes(k)).length
    if (inBody < Math.min(2, kws.length)) bad.push(e.id + '（正文仅命中 ' + inBody + '/' + kws.length + '）')
  }
  assert.deepEqual(bad, [], '关键词与正文完全脱节：' + bad.join('；'))
})

test('关键词跨专家撞车只能是已知的 6 处（防词表乱增造成误命中）', () => {
  // 已知且接受的交叉（语义确有重叠，或同词不同义）：
  //   合规 / 整改 —— 等保测评 与 内控合规 的固有交叉
  //   版式 / 字体 —— 报告排版 / 演示设计 / 视觉设计 的固有交叉
  //   演示 —— 销售工程师（给客户演示产品）与 演示与汇报设计（做演示文稿），同词不同义
  //   幻灯片 —— 文档与表格处理（处理 pptx）与 演示与汇报设计
  // 新增撞车必须人工裁定（拆词 / 合并 / 或加入本清单）。
  const KNOWN = new Set(['合规', '整改', '版式', '字体', '演示', '幻灯片'])
  const map = new Map()
  for (const e of experts) for (const k of (e.trigger_keywords || [])) {
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(e.id)
  }
  const unexpected = [...map.entries()]
    .filter(([k, ids]) => ids.length > 1 && !KNOWN.has(k))
    .map(([k, ids]) => k + '（' + ids.join('、') + '）')
  assert.deepEqual(unexpected, [], '出现新的关键词撞车（请裁定：拆词 / 合并 / 加入已知清单）：' + unexpected.join('；'))
})

test('「审查」靠关键词表命中（本次从 role_tag 并入的词）', () => {
  const { selected } = selectExperts(experts,
    ctx({ text: '这段代码帮我审查一下', defaultDomain: GENERAL_DOMAIN }), cfg())
  assert.ok(selected.length >= 1, '应命中代码审查专家')
  assert.equal(selected[0].entry.id, 'coding-review', '实际：' + selected.map((s) => s.entry.id).join(','))
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

test('干活轮取人（2026-09-16 修正）：按证据序取「最大 + 次大」，通用保底占位不得挤掉高证据域专家', () => {
  // 反例构造：通用专家被「保底占位」先 push（match.js 第 1 步），落在 selected[0]；
  // 旧实现 selected.slice(0, 2) 会把它算进全文名额 —— 这正是真机抓到的缺陷。
  const mk = (id, domain, evidence) => ({ entry: { id, domain }, evidence, score: evidence })
  const selected = [mk('general-typeset', 'general', 0.2), mk('infosec-ics-security', 'infosec', 0.4), mk('infosec-bid-proposal', 'infosec', 0.4)]
  const ranked = [mk('infosec-ics-security', 'infosec', 0.4), mk('infosec-bid-proposal', 'infosec', 0.4), mk('general-typeset', 'general', 0.2)]
  assert.deepEqual(selected.slice(0, 2).map((s) => s.entry.id), ['general-typeset', 'infosec-ics-security'],
    '前提不成立：selected 应是构造顺序（通用保底在前）')
  assert.deepEqual(pickWorkers(selected, ranked, 2).map((s) => s.entry.id), ['infosec-ics-security', 'infosec-bid-proposal'])
  assert.equal(selected[0].entry.id, 'general-typeset', 'pickWorkers 不得改动入参顺序')
  assert.deepEqual(pickWorkers(selected, ranked, 0).map((s) => s.entry.id), [])
  assert.deepEqual(pickWorkers(selected, ranked, 1).map((s) => s.entry.id), ['infosec-ics-security'])
  assert.deepEqual(pickWorkers([], ranked, 2).map((s) => s.entry.id), [])
  assert.deepEqual(pickWorkers([mk('orphan', 'infosec', 0.2)], ranked, 1).map((s) => s.entry.id), ['orphan'],
    'ranked 里缺项时不得抛错，应仍返回该位')
})

test('干活轮取人：真实任务下 = 证据最大的 n 位（不受通用赛道保底影响）', () => {
  const { selected, ranked } = selectExperts(experts,
    ctx({ text: '帮我写一份工控安全产品的投标方案，把评分点和竞争定位都考虑进去。' }),
    cfg({ expertInjectMax: 4, expertSecondThreshold: 0.3 }))
  assert.ok(selected.length >= 2, '本用例需至少命中 2 位，实际：' + selected.map((s) => s.entry.id).join(','))
  assert.equal(selected[0].entry.domain, GENERAL_DOMAIN,
    '前提：通用专家被保底占位排在最前（实际：' + selected.map((s) => s.entry.id).join(',') + '）')
  const workers = pickWorkers(selected, ranked, 2)
  const byEvidence = [...selected].sort((a, b) => b.evidence - a.evidence).slice(0, 2).map((s) => s.entry.id).sort()
  assert.deepEqual(workers.map((s) => s.entry.id).sort(), byEvidence, '干活轮取到的不是证据最大的两位')
  assert.ok(workers.every((s) => s.entry.domain !== GENERAL_DOMAIN),
    '通用专家不应占走全文名额：' + workers.map((s) => s.entry.id).join(','))
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

test('身份专家：留空 = 不常驻（身份退场）；显式指定生效；无效 id 返回 null', () => {
  assert.equal(identityExpertOf({ defaultDomain: 'infosec', identityExpert: '' }), null,
    '留空不应解析出常驻身份专家（身份由 work-memory 承担）')
  const picked = identityExpertOf({ defaultDomain: 'infosec', identityExpert: 'infosec-djbh' })
  assert.ok(picked && picked.id === 'infosec-djbh', '显式指定的身份专家未生效')
  assert.equal(identityExpertOf({ defaultDomain: 'infosec', identityExpert: 'no-such-id' }), null,
    '无效 id 应返回 null（不回退到岗位域第一位）')
})

test('expertInjectMax = 0（不限）：跨职能可全部补入，不再受个数上限截断', () => {
  const { selected } = selectExperts(
    experts,
    ctx({ text: '工控项目要过等保，还要投标', defaultDomain: 'coding' }),
    cfg({ expertInjectMax: 0 }),
  )
  assert.ok(selected.length >= 2, '不限时应补入多位跨职能专家，实际 ' + selected.length)
  const funcs = selected.map((s) => s.entry.role_tag[0])
  assert.equal(new Set(funcs).size, funcs.length, '同职能键被重复选中：' + funcs.join(','))
})

test('成本常量与个数量级自洽（装填规划用）', () => {
  assert.ok(COST_PERSONA_CARD >= 300 && COST_PERSONA_CARD <= 800, 'persona 卡成本常量越界：' + COST_PERSONA_CARD)
  assert.ok(COST_SKILL_LINE > 0 && COST_SKILL_LINE < COST_PERSONA_CARD, '技能指针成本应远小于 persona 卡')
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
  const { selected } = selectExperts(experts,
    ctx({ text: '帮我把这份 Word 文档排版一下' }), cfg({ expertInjectMax: 2 }))
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

test('注入上限归一化：0 = 不限，非法 → 默认，超界 → ' + INJECT_MAX_HARD, () => {
  assert.equal(clampInjectMax(0), 0)
  assert.equal(clampInjectMax('abc'), INJECT_MAX_DEFAULT)
  assert.equal(clampInjectMax(-5), INJECT_MAX_DEFAULT)
  assert.equal(clampInjectMax(2), 2)
  assert.equal(clampInjectMax(99), INJECT_MAX_HARD)
  assert.equal(clampUnit('bad', 0.8), 0.8)
  assert.equal(clampUnit(0.5, 0.8), 0.5)
})

test('交付层纪律块：按 § 条目解析【纪律块 v1】，只取列表行（不解析 markdown 标题）', () => {
  const text = [
    '[id:aaa111] [2026-09-14] [tag:常规] 无关条目',
    '§',
    '[id:bbb222] [2026-09-14] [branch:dsh-experts] [tag:关键] ' + DISCIPLINE_MARK,
    '- 红线一：数字要么实测要么不写',
    '## 这不是标题而是正文',
    '- 红线二：汇报给出来处',
    '§',
    '[id:ccc333] [2026-09-14] [tag:常规] 另一条',
  ].join('\n')
  assert.deepEqual(parseDiscipline(text), ['红线一：数字要么实测要么不写', '## 这不是标题而是正文', '红线二：汇报给出来处'])
  assert.deepEqual(parseDiscipline('没有任何纪律条目'), [])
  assert.deepEqual(parseDiscipline(''), [])
})

test('交付层纪律块：只有「正文以标记开头」的条目才算（正文里提到标记不算），多条合并', () => {
  const text = [
    '[id:aaa111] [2026-09-14] [tag:常规] 这条正文里提到了 ' + DISCIPLINE_MARK + ' 但并不是它',
    '§',
    '[id:bbb222] [2026-09-14] [branch:x] [tag:关键] ' + DISCIPLINE_MARK,
    '- 红线一：不臆断',
    '§',
    '[id:ccc333] [2026-09-14] [branch:x] [tag:关键] ' + DISCIPLINE_MARK,
    '- 红线二：给出来处',
  ].join('\n')
  assert.deepEqual(parseDiscipline(text), ['红线一：不臆断', '红线二：给出来处'],
    '正文提到标记的条目不应被当成纪律块；多条纪律块应合并')
})

test('交付层纪律块：ok / absent / unreadable 三态（absent 静默、unreadable 明示）', () => {
  assert.equal(formatDiscipline({ status: 'absent', lines: [], file: 'F' }), '', 'absent 应静默')
  assert.ok(formatDiscipline({ status: 'unreadable', lines: [], file: 'F' }).includes('未加载'), 'unreadable 应明示')
  const ok = formatDiscipline({ status: 'ok', lines: ['A', 'B'] })
  assert.ok(ok.includes('交付层') && ok.includes('A') && ok.includes('B'), 'ok 渲染异常：' + ok)
  const many = formatDiscipline({ status: 'ok', lines: ['1', '2', '3', '4', '5', '6', '7'] })
  assert.ok(many.includes('还有 1 条'), '超出上限应标注省略：' + many)
})

test('目录段：六域成员 + 能力节；无能力索引时省略该节且不超上限', () => {
  const cat = buildCatalog({ domains: DOMAINS, personas: experts, skills: [] })
  assert.ok(cat.includes('【专家库·目录】'), '缺目录标题')
  assert.ok(cat.includes('信息安全') && cat.includes('通用职能'), '缺域行')
  assert.ok(!cat.includes('可用能力'), '无能力索引时不应出现能力节')
  const withSkills = buildCatalog({ domains: DOMAINS, personas: experts, skills: [{ id: 'office-excel', kind: 'skill', skill: 'office-excel' }] })
  assert.ok(withSkills.includes('可用能力') && withSkills.includes('office-excel'), '能力节未生成')
  assert.ok(cat.length <= CATALOG_MAX_CHARS + 1, '目录段超上限：' + cat.length)
  assert.equal(buildCatalog({ domains: [], personas: [], skills: [] }), '', '空库应不注入目录段')
})

test('目录段：能力节排序与数据源无关（稳定排序 → 两来源渲染逐字相同）', () => {
  const a = buildCatalog({ domains: DOMAINS, personas: experts, skills: [{ skill: 'pdf-tools' }, { skill: 'office-excel' }, { skill: 'vibe' }] })
  const b = buildCatalog({ domains: DOMAINS, personas: experts, skills: [{ skill: 'vibe' }, { skill: 'pdf-tools' }, { skill: 'office-excel' }] })
  assert.equal(a, b, '同一能力集合的不同顺序应渲染出逐字相同的目录段')
  assert.ok(a.includes('可用能力：office-excel、pdf-tools、vibe'), '能力节应按代码点序稳定排列：' + a.slice(-90))
})

test('能力层：技能条目映射 / 指针行格式 / 开放命中 / 预算守门', () => {
  const excel = toCapabilityEntry({ name: 'office-excel', description: '处理 Excel 表格（.xlsx/.xls/.et）：读取工作表与单元格…', provider: 'filesystem', resourceBase: { path: 'X' } })
  assert.equal(excel.kind, 'skill', '能力条目 kind 应为 skill')
  assert.equal(excel.skill, 'office-excel')
  assert.ok(excel.trigger_keywords.length > 0, '缺触发关键词')
  assert.ok(excel.when_to_use.length > 0, '缺一句话定位')
  const line = capabilityLine(excel)
  assert.ok(line.startsWith('【工具·office-excel】'), '指针行格式异常：' + line)
  assert.ok(line.endsWith('· skill 加载'), '指针行缺少加载提示：' + line)
  assert.ok(line.length <= 120, '指针行过长：' + line.length)
  assert.equal(toCapabilityEntry({}), null, '无名技能应返回 null')

  const pdf = toCapabilityEntry({ name: 'pdf-tools', description: 'PDF 处理' })
  const pool = [excel, pdf]
  assert.equal(routeCapabilities(pool, '', {}).length, 0, '空任务不应命中任何能力')
  assert.equal(routeCapabilities(pool, '今天天气不错', {}).length, 0, '无关任务不应命中')
  const hit = routeCapabilities(pool, '帮我把这个 xlsx 表合并一下', { budgetChars: 300 })
  assert.equal(hit.length, 1, '应只命中 office-excel：' + hit.join('|'))
  assert.ok(hit[0].includes('office-excel'))
  const both = routeCapabilities(pool, 'xlsx 和 pdf 都要处理', { budgetChars: 300 })
  assert.equal(both.length, 2, '两个强信号应都命中：' + both.join('|'))
  const tight = routeCapabilities(pool, 'xlsx 和 pdf 都要处理', { budgetChars: 10, maxLines: 3 })
  assert.equal(tight.length, 1, '预算收紧后只应保留第一条：' + tight.length)

  const src = createSkillSource()
  assert.equal(src.entries().length, 0, '未刷新时能力池应为空（不抛错）')
  assert.equal(src.usingFallback(), true, '未就绪时应报 usingFallback')
  src.refresh(null, '')   // 无 skills 上下文 → 安全跳过
  assert.equal(src.entries().length, 0)
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
