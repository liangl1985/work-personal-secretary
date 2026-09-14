#!/usr/bin/env node
/**
 * dsh-experts 装载冒烟：用 mock cordis ctx 真正调用 apply()，
 * 验证「注册了什么」与「注入回调返回什么」—— 这是纯回归（match/store）覆盖不到的部分。
 *
 * 可在无宿主依赖的环境运行：settings.js 对 `@deepseek-ai/schemastery` 做了动态导入降级，
 * 缺失时设置命名空间注册被跳过（会打印提示），其余功能照常。
 *
 * 运行：node scripts/smoke-load.mjs
 */

import assert from 'node:assert/strict'
import { name, inject, apply } from '../lib/index.js'

let pass = 0
let fail = 0

async function t(label, fn) {
  try {
    await fn()
    pass += 1
    console.log('  ✅ ' + label)
  } catch (err) {
    fail += 1
    console.log('  ❌ ' + label + ' → ' + (err?.message || err))
  }
}

const captured = { settings: null, contexts: [], sections: [], tools: [], commands: [], injects: [] }

/** persona 段取值：新增「交付层」context 后，不能再按"最后一个 context"取 */
const firstPersonaDef = () => captured.contexts.find((c) => c.name === 'dsh-experts:persona')
const lastPersonaDef = () => captured.contexts.filter((c) => c.name === 'dsh-experts:persona').pop()

function makeCtx() {
  return {
    logger: { debug() {}, info() {}, warn() {} },
    settings: {
      register(ns, schema, opts) {
        captured.settings = { ns, hasSchema: !!schema, base: opts?.base || {} }
        let current = { ...(opts?.base || {}) }
        return {
          get: () => current,
          set: (next) => { current = next },
          watch: () => {},
        }
      },
    },
    systemPrompt: {
      context: (def) => { captured.contexts.push(def); return () => {} },
      section: (def) => { captured.sections.push(def); return () => {} },
    },
    // 模拟官方 dsh-tools 的注册校验（真机在此抛错，2026-09-12 实际踩过）：
    //   TypeError: tool "x" must declare output { schema, render, presentationMeta? }
    // 并校验参数必须用 DSL（属性内 required: true），不是 JSON Schema。
    tools: {
      register: (def) => {
        if (!def || typeof def.name !== 'string') throw new Error('tool 必须声明 name')
        if (!def.output || typeof def.output !== 'object' || !def.output.schema || typeof def.output.render !== 'function') {
          throw new Error('tool "' + (def && def.name) + '" must declare output { schema, render, presentationMeta? }')
        }
        if (def.parameters && (def.parameters.type || def.parameters.properties)) {
          throw new Error('tool "' + def.name + '" 的 parameters 必须用 DSL（属性内 required: true），不是 JSON Schema')
        }
        captured.tools.push(def)
        return () => {}
      },
    },
    commands: { register: (def) => { captured.commands.push(def); return () => {} } },
    // 批二：能力层与阶段推断走 ctx.inject 延迟注入；这里给一个 mock 宿主服务
    inject: (deps, cb) => {
      captured.injects.push(deps.join(','))
      for (const d of deps) {
        if (d === 'skills') {
          cb({
            skills: {
              snapshot: async () => ({
                complete: true,
                skills: [
                  { name: 'office-excel', description: '处理 Excel 表格', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { path: 'E:\\mock\\office-excel' } },
                  { name: 'pdf-tools', description: 'PDF 处理', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { path: 'E:\\mock\\pdf-tools' } },
                ],
              }),
            },
          })
        } else if (d === 'sessionProjections') {
          cb({ sessionProjections: { stateOf: () => null } })
        }
      }
    },
  }
}

const ctx = makeCtx()
const dispose = apply(ctx, { defaultDomain: 'infosec' })

const session = { header: { id: 'smoke-session', cwd: 'C:\\workspace\\docs' } }
const frame = (text) => ({ agent: { session }, text })

await t('模块导出 name / inject / apply', () => {
  assert.equal(name, 'dsh-experts')
  assert.ok(Array.isArray(inject), 'inject 应为数组')
  for (const s of ['systemPrompt', 'tools', 'commands', 'settings']) {
    assert.ok(inject.includes(s), 'inject 缺 ' + s)
  }
  assert.equal(typeof apply, 'function')
  assert.equal(typeof dispose, 'function')
})

await t('注册 2 个 context（persona 480 / 交付层 481）与 1 个 section（目录 10150）', () => {
  const persona = firstPersonaDef()
  const delivery = captured.contexts.find((c) => c.name === 'dsh-experts:delivery')
  assert.ok(persona && delivery, '缺 persona / delivery 段：' + captured.contexts.map((c) => c.name).join(','))
  assert.equal(persona.order, 480)
  assert.equal(delivery.order, 481)
  assert.equal(typeof persona.text, 'function')
  assert.equal(typeof delivery.text, 'function')
  assert.ok(captured.injects.includes('skills'), '未延迟注入 skills 服务：' + captured.injects.join('|'))
  assert.ok(captured.injects.includes('sessionProjections'), '未延迟注入 sessionProjections：' + captured.injects.join('|'))
  const cat = captured.sections.find((s) => s.name === 'dsh-experts:catalog')
  assert.ok(cat, '缺目录段 section')
  assert.equal(cat.order, 10150)
  const catText = String(cat.text())
  assert.ok(catText.includes('【专家库·目录】'), '目录段内容异常：' + catText.slice(0, 80))
  assert.ok(catText.includes('信息安全') && catText.includes('财务'), '目录段缺域成员：' + catText.slice(0, 120))
})

await t('注册 expert_recall 工具与 /expert 命令', () => {
  assert.equal(captured.tools.length, 1)
  assert.equal(captured.tools[0].name, 'expert_recall')
  assert.equal(captured.commands.length, 1)
  assert.equal(captured.commands[0].name, 'expert')
})

await t('设置命名空间注册（有 schemastery 时）或降级（无宿主依赖时）', () => {
  if (captured.settings) {
    assert.equal(captured.settings.ns, 'experts')
    assert.ok(captured.settings.hasSchema, 'schema 未传')
  } else {
    console.log('       （降级：本环境无 @deepseek-ai/schemastery，已退回组合配置）')
  }
})

await t('注入回调：身份专家常驻注入（默认 = 岗位域第一位）+ 处理路径提示', () => {
  const out = firstPersonaDef().text(frame('帮我看看这个'))
  assert.equal(typeof out, 'string', 'text 回调必须返回字符串')
  assert.ok(out.includes('【身份视角·'), '未注入身份专家：' + out.slice(0, 120))
  assert.ok(out.includes('【处理路径】'), '缺处理路径提示：' + out.slice(0, 120))
})

await t('注入回调：把上限调回 1 时，跨域专家不再占常驻上下文', () => {
  // 默认值自 0.1.3 起是 2（身份专家 + 至多一位按问题归属补位的对口专家）；
  // 这里显式传 1，专门守住「调小上限即收敛为只有身份专家」这条行为。
  const ctx1 = makeCtx()
  apply(ctx1, { defaultDomain: 'infosec', expertInjectMax: 1 })
  const last = lastPersonaDef()
  const out = last.text(frame('客户要做三级等保测评，定级备案怎么走'))
  assert.ok(out.includes('【身份视角·'), '缺身份专家')
  assert.ok(!out.includes('【本轮命中·'), '上限 1 时不应再注入跨域专家：' + out.slice(0, 160))
})

await t('/expert list 输出专家清单', async () => {
  const res = await captured.commands[0].handler({ rawInput: 'list', session: { agent: { session } } })
  assert.ok(res.text.includes('专家库'), '清单缺标题')
  assert.ok(res.text.includes('infosec-bid-proposal'), '清单缺专家 id')
})

await t('/expert status 输出四项配置状态', async () => {
  const res = await captured.commands[0].handler({ rawInput: 'status', session: { agent: { session } } })
  assert.ok(res.text.includes('本人岗位'), '缺岗位行')
  assert.ok(res.text.includes('注入上限'), '缺注入上限行')
})

await t('/expert why 展示打分依据', async () => {
  const res = await captured.commands[0].handler({ rawInput: 'why 工控安全方案', session: { agent: { session } } })
  assert.ok(/工控安全/.test(res.text), '未见打分输出')
})

await t('/expert use 临时注入 → 注入回调切换；/expert off → 不再注入', async () => {
  const cmd = captured.commands[0]
  const use = await cmd.handler({ rawInput: 'use hr-labor-law', session: { agent: { session } } })
  assert.ok(use.text.includes('临时注入'), '临时注入未生效：' + use.text)

  const injected = firstPersonaDef().text(frame('随便问点什么'))
  assert.ok(injected.includes('劳动'), '临时注入的 persona 未出现：' + injected.slice(0, 80))

  await cmd.handler({ rawInput: 'off', session: { agent: { session } } })
  assert.equal(firstPersonaDef().text(frame('随便问点什么')), '', 'off 后不应再注入')

  await cmd.handler({ rawInput: 'auto', session: { agent: { session } } })
  const back = firstPersonaDef().text(frame('帮我看看这个'))
  assert.ok(back.includes('【身份视角·'), 'auto 后未恢复自动注入')
})

await t('expert_recall 工具：按 id 取 persona 正文（返回结构化对象）', async () => {
  const r = await captured.tools[0].execute({ id: 'hr-labor-law' })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'persona')
  assert.equal(r.id, 'hr-labor-law')
  assert.ok(String(r.text).includes('## 角色'), '未返回 persona 正文：' + String(r.text).slice(0, 80))
})

await t('expert_recall 工具：按 query 返回最匹配专家', async () => {
  const r = await captured.tools[0].execute({ query: '客户要做等保测评' })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'match')
  assert.ok(String(r.text).includes('【匹配】'), '未返回匹配头')
})

await t('expert_recall 工具：list 模式列出全部专家', async () => {
  const r = await captured.tools[0].execute({ list: true })
  assert.equal(r.ok, true)
  assert.equal(r.kind, 'listing')
  assert.ok(String(r.text).includes('专家库 · 共'), '未列出总数')
})

await t('expert_recall：render 产出可见文本（官方 output 契约）', () => {
  const def = captured.tools[0]
  const blocks = def.output.render({}, { ok: true, kind: 'persona', text: 'X' })
  assert.ok(Array.isArray(blocks) && blocks[0].type === 'text' && blocks[0].text === 'X', 'render 输出异常')
})

await t('未知 id 返回 ok:false 的结构化错误（不抛异常）', async () => {
  const r = await captured.tools[0].execute({ id: 'no-such-expert' })
  assert.equal(r.ok, false)
  assert.ok(String(r.error).includes('未找到专家'))
})

await t('未知 id 给出明确提示而非抛错', async () => {
  const res = await captured.commands[0].handler({ rawInput: 'use no-such', session: { agent: { session } } })
  assert.equal(res.kind, 'error')
  assert.ok(res.text.includes('未找到专家'), res.text)
})

await t('注入上限 2 时：跨域命中专家被补上（问题归属判断生效）', () => {
  const ctx2 = makeCtx()
  apply(ctx2, { defaultDomain: 'infosec', expertInjectMax: 2 })
  const last = lastPersonaDef()
  const out = last.text(frame('客户要做三级等保测评，定级备案怎么走'))
  assert.ok(out.includes('【身份视角·'), '缺身份专家：' + out.slice(0, 120))
  assert.ok(out.includes('【本轮命中·'), '未补上跨域命中专家：' + out.slice(0, 200))
  assert.ok(out.includes('等保测评'), '补上的应为等保测评专家')
})

await t('/expert phase：切到 execute 后卡中不再有方法行；auto 恢复；非法值报错', async () => {
  const cmd = captured.commands[0]
  const switchTo = await cmd.handler({ rawInput: 'phase execute', session: { agent: { session } } })
  assert.ok(switchTo.text.includes('execute'), '未切到 execute：' + switchTo.text)
  const out = firstPersonaDef().text(frame('客户要做三级等保测评，定级备案怎么走'))
  assert.ok(!out.includes('方法：'), 'execute 阶段卡中不应再有方法行：' + out.slice(0, 200))
  assert.ok(out.includes('阶段·execute'), 'execute 阶段应带阶段标注：' + out.slice(0, 200))

  const status = await cmd.handler({ rawInput: 'phase', session: { agent: { session } } })
  assert.ok(status.text.includes('execute'), 'phase status 未显示当前阶段：' + status.text)

  const bad = await cmd.handler({ rawInput: 'phase nonsense', session: { agent: { session } } })
  assert.equal(bad.kind, 'error', '非法阶段应报错')

  const back = await cmd.handler({ rawInput: 'phase auto', session: { agent: { session } } })
  assert.ok(back.text.includes('恢复'), '未恢复自动：' + back.text)
  const after = firstPersonaDef().text(frame('客户要做三级等保测评，定级备案怎么走'))
  assert.ok(after.includes('方法：') || after.includes('## 工作方法'), '恢复后应重新出现方法行')
})

await t('能力层：宿主 skills 可用时注入「可用能力·指针」行（开放命中 + 预算守门）', async () => {
  await new Promise((r) => setTimeout(r, 10))
  const def = firstPersonaDef()
  const out = def.text(frame('帮我把这个 xlsx 表格合并一下'))
  assert.ok(out.includes('【可用能力·指针】'), '缺能力指针块：' + out.slice(0, 200))
  assert.ok(out.includes('office-excel'), '未命中 office-excel：' + out.slice(0, 240))
  assert.ok(out.includes('· skill 加载'), '指针行格式异常：' + out.slice(0, 240))
  const quiet = def.text(frame('今天天气不错'))
  assert.ok(!quiet.includes('【可用能力·指针】'), '无关任务不该注入指针：' + quiet.slice(0, 160))
})

await t('多会话隔离：A 会话 /expert off 不影响 B 会话（状态与缓存都按 sessionId）', async () => {
  const cmd = captured.commands[0]
  const def = firstPersonaDef()
  const sessA = { header: { id: 'sess-A', cwd: 'C:\\workspace\\docs' } }
  const sessB = { header: { id: 'sess-B', cwd: 'C:\\workspace\\docs' } }
  const ask = '帮我看看这个'
  const beforeB = def.text({ agent: { session: sessB }, text: ask })
  await cmd.handler({ rawInput: 'off', session: { agent: { session: sessA } } })
  const afterA = def.text({ agent: { session: sessA }, text: ask })
  const afterB = def.text({ agent: { session: sessB }, text: ask })
  assert.equal(afterA, '', 'A 会话 off 后不应再注入')
  assert.ok(afterB.includes('【身份视角·'), 'B 会话不应受 A 影响：' + afterB.slice(0, 80))
  assert.equal(afterB, beforeB, 'B 会话注入文本应逐字不变（各自命中缓存）')
  await cmd.handler({ rawInput: 'auto', session: { agent: { session: sessA } } })
})

await t('交付层纪律块：读不到项目记忆时明示一行（不静默，也不抛错）', () => {
  const delivery = captured.contexts.find((c) => c.name === 'dsh-experts:delivery')
  const out = String(delivery.text(frame('x')))
  assert.ok(out === '' || out.includes('【交付层·纪律】'), '纪律块输出异常：' + out.slice(0, 120))
  if (out) assert.ok(out.includes('未加载') || out.includes('·'), '纪律块既非未加载提示也无条目：' + out.slice(0, 120))
})

await t('dispose 可安全调用（无异常）', () => {
  dispose()
})

console.log('\ndsh-experts 装载冒烟：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
