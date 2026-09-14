#!/usr/bin/env node
/**
 * dsh-experts 提示词注入分级测试（独立于 regression.mjs，可单独运行）
 *
 * 覆盖（三级注入：L0 目录 / L1 精简卡 / L2 全文 + 每轮预算降级）：
 *   1. 精简卡确定性（同输入同输出）与体量区间、内容取自正文；
 *   2. 解析失败 / 段落缺失 → 回退全文截断（永不空块）；
 *   3. 空 persona 不产出；超长 persona 截断标注；
 *   4. 预算降级顺序：命中全文 → 命中精简卡 → 只留身份精简卡 → 硬截断（均带标注）；
 *   5. full 模式与旧 HEAD 行为逐字等价；
 *   6. 默认值三处一致（schema default / settings DEFAULTS / cordis.patch.yml base）；
 *   7. auto / card / full 三态；归一化边界。
 *
 * 运行：node scripts/injection-tier-test.mjs   （失败时非零退出）
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { allExperts, findExpert, loadPersona } from '../lib/store.js'
import { selectExperts } from '../lib/match.js'
import { apply } from '../lib/index.js'
import { buildInjection, buildPersonaBlock, buildPersonaCard, parsePersonaSections, CARD_NOTE, PERSONA_MAX_CHARS, PATH_HINT } from '../lib/inject.js'
import { DEFAULTS } from '../lib/settings.js'
import { clampBudget, normalizeDetail, INJECT_BUDGET_DEFAULT, INJECT_BUDGET_MIN, INJECT_BUDGET_MAX } from '../lib/limits.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PATH_LEN = PATH_HINT.length + 2
const blockChars = (text) => Math.max(0, String(text).length - PATH_LEN)

let pass = 0
let fail = 0
const results = []

function test(label, fn) {
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
const IDENTITY = findExpert('presales-ics-security')
const HIT = findExpert('finance-tax')
const baseSel = [
  { entry: IDENTITY, score: 0.9, evidence: 1, reasons: ['岗位先验'] },
  { entry: HIT, score: 0.84, evidence: 1, reasons: ['关键词'] },
]
const opt = (over = {}) => ({ banner: true, identityId: IDENTITY.id, ...over })

// ---------- 1. 精简卡生成 ----------
test('精简卡确定性：20 位 persona 同输入两次逐字相同且非空', () => {
  for (const e of experts) {
    const body = loadPersona(e)
    const a = buildPersonaCard(e, body)
    const b = buildPersonaCard(e, body)
    assert.equal(a, b, e.id + ' 两次生成不一致')
    assert.ok(a.length > 0, e.id + ' 产出空卡')
  }
})

test('精简卡体量：目标 400–700 字符/位（全部落在 300–800 内）', () => {
  const lens = experts.map((e) => buildPersonaCard(e, loadPersona(e)).length)
  const inBand = lens.filter((n) => n >= 400 && n <= 700).length
  const min = Math.min(...lens)
  const max = Math.max(...lens)
  results.push('       （实测卡长 ' + min + '–' + max + ' 字符；落在 400–700 的 ' + inBand + '/' + lens.length + ' 位）')
  for (let i = 0; i < experts.length; i++) {
    assert.ok(lens[i] >= 300 && lens[i] <= 800, experts[i].id + ' 卡长 ' + lens[i] + ' 越界（应在 300–800）')
  }
  assert.ok(inBand >= experts.length - 2, '落在目标区间的过少：' + inBand + '/' + experts.length)
})

test('精简卡内容取自正文（角色段首句 + 方法/交付条数 + 适用行）', () => {
  const body = loadPersona(IDENTITY)
  const sec = parsePersonaSections(body)
  const card = buildPersonaCard(IDENTITY, body)
  assert.ok(sec.methods.length >= 3, '方法条数解析不足：' + sec.methods.length)
  assert.ok(sec.deliveries.length >= 2, '交付条数解析不足：' + sec.deliveries.length)
  const roleHead = sec.role.slice(0, 16)
  assert.ok(card.includes(roleHead), '卡未取正文角色段首句')
  assert.ok(card.includes('适用：' + String(IDENTITY.when_to_use).slice(0, 12)), '卡缺 when_to_use 适用行')
  const rows = card.split('\n')
  assert.ok(rows.length >= 3 && rows.length <= 5, '卡行数异常：' + rows.length)
  assert.ok(card.indexOf('角色：') === 0, '卡应以角色行开头')
})

// ---------- 2. 解析失败回退 ----------
test('解析失败 / 段落缺失 → 回退全文截断且标注（永不空块）', () => {
  const noTitle = '这是一段没有三段标题的正文。'.repeat(30)
  const c1 = buildPersonaCard({ id: 't', name: '测试', file: 't.md' }, noTitle)
  assert.ok(c1.length > 0, '回退产出空块')
  assert.ok(c1.includes('结构未识别'), '回退未标注')
  const partial = '## 角色\n我是测试角色。\n'
  const c2 = buildPersonaCard({ id: 't2', name: '测试2', file: 't2.md' }, partial)
  assert.ok(c2.length > 0 && c2.includes('结构未识别'), '段落缺失未回退（空卡或未标注）：' + c2.slice(0, 60))
})

// ---------- 3. 空 / 超长 ----------
test('空 persona 不产出（block 与 buildInjection 均为空串）', () => {
  assert.equal(buildPersonaBlock({ id: 'x', name: 'x', file: 'nope.md' }, ''), '')
  assert.equal(buildPersonaBlock({ id: 'x', name: 'x', file: 'nope.md' }, '   '), '')
  assert.equal(buildPersonaCard({ id: 'x', name: 'x', file: 'nope.md' }, ''), '')
  assert.equal(buildInjection([{ entry: { id: 'x', name: 'x', file: 'nope.md' }, score: 1 }], opt({ detail: 'auto' })), '')
})

test('full 形态：超长 persona 截断并标注「已截断」', () => {
  const long = 'x'.repeat(PERSONA_MAX_CHARS + 200)
  const block = buildPersonaBlock({ id: 't', name: '测试', file: 't.md' }, long, { detail: 'full' })
  assert.ok(block.includes('已截断'), '未标注截断')
  assert.ok(block.length < long.length + 300, '未见截断效果')
})

test('精简卡尾注：identity / match / manual 三语义都标明取全文方式', () => {
  const body = loadPersona(IDENTITY)
  for (const kind of ['identity', 'match', 'manual']) {
    const block = buildPersonaBlock(IDENTITY, body, { kind, detail: 'card' })
    assert.ok(block.includes(CARD_NOTE), kind + ' 卡缺尾注「' + CARD_NOTE + '」')
    assert.ok(block.includes('【'), kind + ' 卡缺 banner 标题')
  }
})

// ---------- 4. 三态 ----------
test('三态：full = 全文 / card = 全精简卡 / auto = 按预算降级', () => {
  const full = buildInjection(baseSel, opt({ detail: 'full' }))
  assert.ok(full.includes('## 角色') && full.includes('## 工作方法'), 'full 未注入正文全文')

  const card = buildInjection(baseSel, opt({ detail: 'card', budgetChars: INJECT_BUDGET_DEFAULT }))
  assert.ok(!card.includes('## '), 'card 不应出现正文标题')
  assert.ok(card.includes('【身份视角·') && card.includes('【本轮命中·'), 'card 应含两张卡')
  assert.ok(card.includes(CARD_NOTE), 'card 缺精简卡尾注')
  assert.ok(!card.includes('已降为精简卡'), 'card 起点即精简卡，不该出现降级注记')

  const auto = buildInjection(baseSel, opt({ detail: 'auto', budgetChars: INJECT_BUDGET_DEFAULT }))
  assert.ok(!auto.includes('## 工作方法'), 'auto 默认预算下不应出现命中专家全文')
  assert.ok(auto.includes(CARD_NOTE), 'auto 默认预算下命中专家应为精简卡（卡尾注）')
  // 口径（2026-09-14 读稿调整）：默认形态下「命中专家用卡」是预期，不再每轮加"已降级"提示；
  // 只有真的丢专家（card-core）或硬截断才标注 —— 由下面两条降级用例覆盖。
  assert.ok(!auto.includes('已降为精简卡'), '默认形态不再输出降级提示（避免刷屏）')
  assert.ok(!auto.includes('未注入：'), '未丢专家时不该写未注入')
})

// ---------- 5. 预算降级顺序 ----------
test('auto 第 0 级：预算足够（5000 字符）时命中专家给全文', () => {
  const out = buildInjection(baseSel, opt({ detail: 'auto', budgetChars: 5000 }))
  assert.ok(out.includes('## 工作方法'), '预算足够时应给命中专家全文')
  assert.ok(out.includes('【身份视角·') && out.includes('【本轮命中·'), '缺块标题')
  assert.ok(!out.includes('已降为精简卡'), '未降级不应出现降级注记')
})

test('auto 第 2 级：预算只够身份卡时丢弃命中专家并写明未注入', () => {
  const cardChars = blockChars(buildInjection(baseSel, opt({ detail: 'card', budgetChars: INJECT_BUDGET_MAX })))
  const coreChars = blockChars(buildInjection([baseSel[0]], opt({ detail: 'card', budgetChars: INJECT_BUDGET_MAX })))
  assert.ok(cardChars > coreChars + 100, '两卡与单卡长度差过小，无法构造中间预算')
  const out = buildInjection(baseSel, opt({ detail: 'auto', budgetChars: coreChars + 40 }))
  assert.ok(out.includes('【身份视角·'), '缺身份卡')
  assert.ok(!out.includes('【本轮命中·'), '应已丢弃命中专家')
  assert.ok(out.includes('仅保留身份专家精简卡'), '未标注降级到最低级')
  assert.ok(out.includes('未注入：' + HIT.name), '未写明被丢弃的专家')
})

test('auto 兜底：连最低形态都放不下 → 硬截断并标注（绝不静默超限）', () => {
  const out = buildInjection(baseSel, opt({ detail: 'auto', budgetChars: INJECT_BUDGET_MIN }))
  assert.ok(out.includes('已截断'), '未标注截断')
  assert.ok(out.includes('expert_recall'), '截断标注未给出取全文方式')
  assert.ok(out.length < INJECT_BUDGET_MIN + PATH_LEN + 200, '截断未生效：' + out.length)
})

// ---------- 6. full 与旧行为等价 ----------
test('full 模式与旧 HEAD 行为逐字等价（手工复现旧 buildInjection 逻辑）', () => {
  const legacy = PATH_HINT + '\n\n' + baseSel.map((it) => buildPersonaBlock(it.entry, loadPersona(it.entry), {
    banner: true,
    kind: it.entry.id === IDENTITY.id ? 'identity' : 'match',
  })).join('\n\n')
  assert.equal(buildInjection(baseSel, opt({ detail: 'full' })), legacy)
  assert.equal(buildInjection(baseSel, opt()), legacy, '不传 detail 的旧调用方必须保持 full')
})

// ---------- 7. 默认值三处一致 ----------
test('默认值三处一致：schema default / settings DEFAULTS / cordis.patch.yml base', () => {
  const settingsSrc = readFileSync(join(ROOT, 'lib', 'settings.js'), 'utf8')
  const limitsSrc = readFileSync(join(ROOT, 'lib', 'limits.js'), 'utf8')
  const patchSrc = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

  const schemaDetail = /expertInjectDetail:\s*z\.string\(\)\.default\('([a-z]+)'\)/.exec(settingsSrc)
  assert.ok(schemaDetail, 'schema 未找到 expertInjectDetail 默认值')
  assert.ok(/expertInjectBudgetChars:\s*z\.natural\(\)\.default\(INJECT_BUDGET_DEFAULT\)/.test(settingsSrc),
    'schema 未用 INJECT_BUDGET_DEFAULT 作为预算默认值')

  const budgetConst = /export const INJECT_BUDGET_DEFAULT = (\d+)/.exec(limitsSrc)
  assert.ok(budgetConst, 'limits.js 未找到 INJECT_BUDGET_DEFAULT 常量')
  const schemaBudget = Number(budgetConst[1])

  const patchDetail = /expertInjectDetail:\s*'?([a-z]+)'?/.exec(patchSrc)
  const patchBudget = /expertInjectBudgetChars:\s*(\d+)/.exec(patchSrc)
  assert.ok(patchDetail && patchBudget, 'cordis.patch.yml base 未声明新键')

  assert.equal(DEFAULTS.expertInjectDetail, schemaDetail[1], 'DEFAULTS 与 schema 的 detail 默认值不一致')
  assert.equal(DEFAULTS.expertInjectDetail, patchDetail[1], 'patch base 与 schema 的 detail 默认值不一致')
  assert.equal(DEFAULTS.expertInjectBudgetChars, schemaBudget, 'DEFAULTS 与 schema 的预算默认值不一致')
  assert.equal(DEFAULTS.expertInjectBudgetChars, Number(patchBudget[1]), 'patch base 与 schema 的预算默认值不一致')
  assert.equal(INJECT_BUDGET_DEFAULT, schemaBudget, 'limits 常量与 schema 引用不一致')
  results.push('       （三处一致：detail = ' + DEFAULTS.expertInjectDetail + '，budget = ' + DEFAULTS.expertInjectBudgetChars + '）')
})

// ---------- 8. 归一化 ----------
test('归一化：预算 clamp 与注入形态回落', () => {
  assert.equal(clampBudget(50), INJECT_BUDGET_MIN)
  assert.equal(clampBudget(999999), INJECT_BUDGET_MAX)
  assert.equal(clampBudget(0), INJECT_BUDGET_DEFAULT)
  assert.equal(clampBudget('x'), INJECT_BUDGET_DEFAULT)
  assert.equal(clampBudget('1400'), 1400)
  assert.equal(normalizeDetail('CARD'), 'card')
  assert.equal(normalizeDetail(' full '), 'full')
  assert.equal(normalizeDetail('bogus'), 'auto')
  assert.equal(normalizeDetail('bogus', 'full'), 'full')
})

// ---------- 9. 注入回调：设置热更与缓存键 ----------
function makeCtx() {
  const ctx = { _def: null, _scope: null }
  const watchers = []
  ctx.logger = { debug() {}, info() {}, warn() {} }
  ctx.settings = {
    register(ns, schema, opts) {
      let current = { ...(opts?.base || {}) }
      ctx._scope = {
        get: () => current,
        set: (next) => { current = next; for (const w of watchers) w() },
        watch: (fn) => { watchers.push(fn) },
      }
      return ctx._scope
    },
  }
  ctx.systemPrompt = { context: (def) => { ctx._def = def; return () => {} } }
  ctx.tools = { register: () => () => {} }
  ctx.commands = { register: () => () => {} }
  return ctx
}

test('注入回调：默认走精简卡；改设置后免重启生效（缓存键含 detail/budget）', () => {
  const ctx = makeCtx()
  apply(ctx, { defaultDomain: 'presales', identityExpert: 'presales-ics-security' })
  const frame = { agent: { session: { header: { id: 'tier-session', cwd: 'C:\\workspace\\docs' } } }, text: '帮我看看这个' }

  const before = ctx._def.text(frame)
  assert.ok(before.includes('【身份视角·'), '默认未注入身份专家：' + before.slice(0, 80))
  assert.ok(!before.includes('## 工作方法'), '默认形态应为精简卡（不该是全文）')

  if (!ctx._scope) {
    results.push('       （本环境无 @deepseek-ai/schemastery：跳过设置热更断言，仅校验 DEFAULTS 口径）')
    return
  }
  ctx._scope.set({ ...ctx._scope.get(), expertInjectDetail: 'full' })
  const after = ctx._def.text(frame)
  assert.ok(after.includes('## 工作方法'), '改 full 后应注入全文（形态未参与缓存键则会返回旧卡）')
  assert.notEqual(after, before, '形态变更后注入文本未变化')

  ctx._scope.set({ ...ctx._scope.get(), expertInjectDetail: 'auto', expertInjectBudgetChars: 300 })
  const tight = ctx._def.text(frame)
  assert.ok(tight.includes('已截断') || tight.includes('仅保留身份专家精简卡'), '收紧预算后未降级/截断：' + tight.slice(0, 120))
})

// ---------- 10. 端到端体积（before/after） ----------
test('端到端：3 个代表任务 auto 注入体积（before = 旧全文口径）', () => {
  const cfg = { defaultDomain: 'presales', expertInjectMax: 2, expertSecondThreshold: 0.8, expertMinScore: 0.35 }
  const tasks = ['写投标方案', '这份采购合同的钱怎么算、税怎么处理', '帮我看看这个']
  for (const t of tasks) {
    const { selected } = selectExperts(experts, { text: t, defaultDomain: 'presales', branchDomain: null, identityId: IDENTITY.id }, cfg)
    const before = buildInjection(selected, { banner: true, identityId: IDENTITY.id, detail: 'full' })
    const after = buildInjection(selected, { banner: true, identityId: IDENTITY.id, detail: 'auto', budgetChars: INJECT_BUDGET_DEFAULT })
    results.push('       · ' + t + ' → [' + (selected.map((s) => s.entry.id).join(' + ') || '无') + ']  '
      + before.length + ' → ' + after.length + ' 字符（≈ ' + Math.round(before.length * 0.6) + '→' + Math.round(after.length * 0.6) + ' token）')
    assert.ok(blockChars(after) <= INJECT_BUDGET_DEFAULT + 120, '降级后仍超预算：' + blockChars(after))
    assert.ok(after.length <= before.length, 'after 不应比 before 更长')
  }
})

console.log('\ndsh-experts 注入分级测试 · ' + (pass + fail) + ' 项\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
