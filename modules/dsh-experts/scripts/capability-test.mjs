#!/usr/bin/env node
/**
 * dsh-experts 能力层测试（独立于 regression.mjs，可单独运行）
 *
 * 覆盖（design-v2 第 7 节 + 第 16 节验收口径 1/4/5）：
 *   1. 技能条目映射：已知技能走 SKILL_HINTS，未知技能回退 name/description，无名返回 null；
 *   2. 指针行格式与长度（只放"去哪拿"，约 100 字符）；
 *   3. 开放命中：只看强信号（技能名 / 关键词），无关任务不命中；
 *   4. 预算守门：成本预判（COST_SKILL_LINE）+ 真实行长度双守门；
 *   5. createSkillSource：未就绪为空且不抛错 / 无宿主服务安全跳过 /
 *      **同 cwd 连续 refresh 只拉一次（指纹命中不重扫）** / cwd 变化才重扫；
 *   6. experts/skills.auto.json 兜底索引（存在时）字段齐全、可被 store 读到。
 *
 * 运行：node scripts/capability-test.mjs   （失败时非零退出）
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toCapabilityEntry, capabilityLine, routeCapabilities, estimateCapabilityCost, createSkillSource } from '../lib/capability.js'
import { allSkills, readSkillsIndex } from '../lib/store.js'
import { COST_SKILL_LINE, SKILL_BUDGET_DEFAULT } from '../lib/limits.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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

async function ta(label, fn) {
  try {
    await fn()
    pass += 1
    results.push('  ✅ ' + label)
  } catch (err) {
    fail += 1
    results.push('  ❌ ' + label + '\n       → ' + (err?.message || err))
  }
}

const summary = (name, desc = '') => ({ name, description: desc, provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { path: 'E:\\mock\\' + name } })

// ---------- 1. 条目映射 ----------
t('条目映射：已知技能走 SKILL_HINTS（中文名 + 关键词），未知技能回退 name/description', () => {
  const excel = toCapabilityEntry(summary('office-excel', '处理 Excel 表格（.xlsx/.xls/.et）：读取工作表与单元格…'))
  assert.equal(excel.id, 'skill:office-excel')
  assert.equal(excel.kind, 'skill')
  assert.equal(excel.skill, 'office-excel')
  assert.ok(excel.name.includes('Excel'), '已知技能应用中文别名：' + excel.name)
  assert.ok(excel.trigger_keywords.some((k) => k === 'xlsx'), '已知技能应带格式关键词')
  const unknown = toCapabilityEntry(summary('some-new-skill', '这是一个还没有内置别名的技能，描述较长需要被截断处理'))
  assert.equal(unknown.name, 'some-new-skill', '未知技能应回退技能名作显示名')
  assert.deepEqual(unknown.trigger_keywords, ['some-new-skill'], '未知技能应回退技能名作关键词')
  assert.ok(unknown.when_to_use.length <= 60, '未知技能的定位应被截断：' + unknown.when_to_use.length)
  assert.equal(toCapabilityEntry({ description: 'x' }), null, '无名技能应返回 null')
  assert.equal(toCapabilityEntry(null), null, '空输入应返回 null')
})

// ---------- 2. 指针行 ----------
t('指针行：格式固定、只放指针、长度受控', () => {
  const line = capabilityLine(toCapabilityEntry(summary('office-ppt', 'PPT')))
  assert.ok(line.startsWith('【工具·office-ppt】'), line)
  assert.ok(line.endsWith('· skill 加载'), line)
  assert.ok(line.length <= 120, '指针行过长：' + line.length)
  assert.ok(!line.includes('python'), '指针行不应含做法细节')
})

// ---------- 3. 开放命中 ----------
t('开放命中：只看强信号，无关任务不命中；多命中按强度降序', () => {
  const pool = [
    toCapabilityEntry(summary('office-excel', 'Excel')),
    toCapabilityEntry(summary('pdf-tools', 'PDF')),
    toCapabilityEntry(summary('web-fetch', '抓网页')),
  ]
  assert.equal(routeCapabilities(pool, '', {}).length, 0, '空文本不应命中')
  assert.equal(routeCapabilities(pool, '今天天气不错，随便聊聊', {}).length, 0, '无关文本不应命中')
  const hit = routeCapabilities(pool, '帮我把这个 xlsx 合并一下', { budgetChars: 300 })
  assert.equal(hit.length, 1)
  assert.ok(hit[0].includes('office-excel'))
  const two = routeCapabilities(pool, '把 pdf 提取出来，再抓一下这个网页', { budgetChars: 300 })
  assert.equal(two.length, 2, '两个强信号应都命中：' + two.join('|'))
  assert.ok(two[0].includes('pdf-tools') && two[1].includes('web-fetch'), '应按命中强度/名称稳定排序：' + two.join('|'))
  const strong = routeCapabilities(pool, 'pdf pdf 扫描件合并一下', { budgetChars: 300 })
  assert.equal(strong.length, 1, '单纯重复关键词不应放大命中条数')
  const repeated = routeCapabilities(pool, 'pdf pdf pdf', { budgetChars: 300 })
  assert.equal(repeated.length, 1, '重复关键词不应重复命中同一能力')
})

// ---------- 4. 预算守门 ----------
t('预算守门：成本预判 + 真实长度双守门，条数与成本估算自洽', () => {
  const pool = [
    toCapabilityEntry(summary('office-excel', 'Excel')),
    toCapabilityEntry(summary('pdf-tools', 'PDF')),
    toCapabilityEntry(summary('web-fetch', '抓网页')),
  ]
  const text = 'xlsx pdf 网页 都要处理'
  const wide = routeCapabilities(pool, text, { budgetChars: SKILL_BUDGET_DEFAULT, maxLines: 5 })
  assert.ok(wide.length >= 2, '默认预算下应命中多条：' + wide.length)
  const narrow = routeCapabilities(pool, text, { budgetChars: COST_SKILL_LINE, maxLines: 5 })
  assert.equal(narrow.length, 1, '预算只够一条时不应多塞：' + narrow.length)
  assert.equal(estimateCapabilityCost(wide), wide.length * COST_SKILL_LINE, '成本估算应为条数 × 常量')
  assert.equal(estimateCapabilityCost([]), 0)
  assert.equal(estimateCapabilityCost(null), 0)
  const capped = routeCapabilities(pool, text, { budgetChars: 9999, maxLines: 2 })
  assert.equal(capped.length, 2, 'maxLines 应封顶：' + capped.length)
})

// ---------- 5. 运行时技能源 ----------
await ta('createSkillSource：未就绪为空且不抛错；无宿主服务安全跳过', () => {
  const src = createSkillSource()
  assert.equal(src.entries().length, 0)
  assert.equal(src.usingFallback(), true)
  src.refresh(null, '')          // 没有 skills 服务
  src.refresh({}, '')            // 服务但没有 snapshot
  assert.equal(src.entries().length, 0)
})

await ta('createSkillSource：异步拉取生效；同 cwd 连续 refresh 只拉一次（指纹命中不重扫）', async () => {
  let calls = 0
  const sctx = {
    skills: {
      snapshot: async ({ cwd } = {}) => {
        calls += 1
        return { complete: true, skills: [summary('office-excel', 'Excel')] }
      },
    },
  }
  const src = createSkillSource({ ttlMs: 60_000 })
  src.refresh(sctx, 'C:\\proj')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(src.entries().length, 1, '异步拉取后应有 1 条能力')
  assert.equal(src.usingFallback(), false)
  assert.equal(calls, 1)
  src.refresh(sctx, 'C:\\proj')       // 同 cwd、未过期 → 不应重扫
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls, 1, '同 cwd 且未过期时不应重扫（指纹命中）')
  src.refresh(sctx, 'C:\\other')      // cwd 变化 → 重扫
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls, 2, 'cwd 变化应触发重扫')
})

await ta('createSkillSource：拉取失败不抛错、不覆盖上次好结果', async () => {
  const src = createSkillSource({ ttlMs: 0 })
  const bad = { skills: { snapshot: async () => { throw new Error('boom') } } }
  src.refresh(bad, 'C:\\x')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(src.entries().length, 0, '失败时应保持空池（不抛错）')
  assert.ok(String(src.state.error).includes('boom'), '应记录错误原因：' + src.state.error)
})

// ---------- 6. 兜底索引 ----------
t('兜底索引 experts/skills.auto.json：可被 store 读取且字段齐全（不存在时按空池处理）', () => {
  const file = join(ROOT, 'experts', 'skills.auto.json')
  const skills = allSkills()
  if (!existsSync(file)) {
    results.push('       （未生成 skills.auto.json：按空池处理，跳过内容断言）')
    assert.deepEqual(skills, [])
    return
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(Array.isArray(parsed.skills) && parsed.skills.length > 0, '索引应至少含 1 条能力')
  assert.ok(parsed.fingerprint, '索引应带指纹')
  assert.equal(skills.length, parsed.skills.length, 'store 读到的条数与文件不一致')
  for (const s of skills) {
    assert.equal(s.kind, 'skill', 'kind 缺失：' + s.id)
    assert.ok(s.id && s.skill && s.name && s.when_to_use, '字段不齐：' + JSON.stringify(s))
    assert.ok(Array.isArray(s.trigger_keywords) && s.trigger_keywords.length > 0, '缺关键词：' + s.id)
  }
  assert.ok(readSkillsIndex().fingerprint === parsed.fingerprint, 'store 与文件的指纹不一致')
  results.push('       （兜底索引 ' + skills.length + ' 条：' + skills.map((s) => s.skill).join('、') + '）')
})

console.log('\ndsh-experts 能力层测试 · ' + (pass + fail) + ' 项\n' + results.join('\n'))
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
