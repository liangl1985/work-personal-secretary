#!/usr/bin/env node
/**
 * dsh-experts × dsh-work-memory **共存契约测试**
 *
 * 验证两个模块挂在同一个 cordis ctx 上时：
 *   1. 两个注入注册（systemPrompt.context）都在，顺序正确（专家 480 → 记忆 500）；
 *   2. 两个回调都能返回字符串（互不抛错、互不覆盖）；
 *   3. 合并后的上下文里两条内容都在（专家视角 + 记忆快照）；
 *   4. 工具 / 命令注册不冲突（无重名）。
 *
 * 两条路径：
 *   - **真加载**：能 import 到 dsh-work-memory 时，直接加载它（需要宿主依赖
 *     `@deepseek-ai/dsh-tools`，即装机环境）；
 *   - **契约模拟**：纯 node 环境（CI / 开发机无宿主依赖）加载不了 memory 模块时，
 *     用一个等价的 order=500 记忆快照注册替换，验证**共存契约**本身（顺序、互不覆盖、合并）。
 *     本脚本会明确打印当前走的是哪条路径 —— 不假装真加载。
 *
 * 安全：真加载时记忆库指向**工作区内临时目录**（`.tmp-coexist-memory`），不触碰真实记忆库。
 *
 * 运行：node scripts/coexist.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const MEMORY_MOD = join(HERE, '..', 'dsh-work-memory', 'lib', 'index.js')
const TMP_MEMORY = join(HERE, '.tmp-coexist-memory')

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

const captured = { contexts: [], sections: [], tools: [], commands: [] }
const ctx = {
  logger: { debug() {}, info() {}, warn() {} },
  settings: { register: () => ({ get: () => ({}), set() {}, watch() {} }) },
  systemPrompt: {
    context: (def) => { captured.contexts.push(def); return () => {} },
    section: (def) => { captured.sections.push(def); return () => {} },
  },
  tools: { register: (def) => { captured.tools.push(def); return () => {} } },
  commands: { register: (def) => { captured.commands.push(def); return () => {} } },
  webServer: { register: () => () => {} },
}

const session = { header: { id: 'coexist', cwd: 'C:\\workspace\\docs' } }
const frame = () => ({ agent: { session } })
const disposers = []

// ---- 加载两个模块：experts 必成功；memory 视环境而定 ----
const experts = await import(pathToFileURL(join(HERE, 'lib', 'index.js')).href)
let memory = null
let memoryReason = ''
try {
  memory = await import(pathToFileURL(MEMORY_MOD).href)
} catch (err) {
  memory = null
  memoryReason = String(err?.message || err).split('\n')[0]
}

console.log('  路径：' + (memory ? '真加载 dsh-work-memory' : '契约模拟（memory 模块不可加载：' + memoryReason.slice(0, 90) + '）'))

/** 记忆模块的装载函数：真加载用它的 apply，否则用等价契约注册（order 500） */
const applyMemory = memory
  ? () => memory.apply(ctx, {
      memoryDir: TMP_MEMORY,   // 工作区内临时库，绝不碰真实记忆库
      injectMemory: true,
      dailyAutoLog: false,
      backupEnabled: false,
      archiveEnabled: false,
      obsidianSyncDir: '',
    })
  : () => ctx.systemPrompt.context({
      name: 'work-memory:snapshot(contract-stub)',
      order: 500,
      text: () => '【记忆】（共存契约模拟：真实快照在装机环境注入）',
    })

await t('experts 模块可加载；memory 模块按环境真加载或契约模拟', () => {
  assert.ok(experts?.apply, 'experts.apply 缺失')
  if (!memory) assert.ok(memoryReason.length > 0, '未记录不可加载原因')
})

await t('先后 apply 到同一个 ctx，互不抛错', () => {
  disposers.push(applyMemory())
  disposers.push(experts.apply(ctx, { defaultDomain: 'infosec' }))
})

await t('三个 context 注册都在，顺序为 专家 480 → 交付层 481 → 记忆 500', () => {
  assert.equal(captured.contexts.length, 3, '注入注册数应为 3，实际 ' + captured.contexts.length)
  const orders = captured.contexts.map((c) => c.order).sort((a, b) => a - b)
  assert.deepEqual(orders, [480, 481, 500], '顺序异常：' + orders.join(', '))
})

await t('experts 新增目录段 section（order 10150），与 work-memory 的 context 不抢位', () => {
  const cat = captured.sections.find((s) => s.name === 'dsh-experts:catalog')
  assert.ok(cat, '缺目录段 section：' + captured.sections.map((s) => s.name).join(','))
  assert.equal(cat.order, 10150)
  assert.ok(captured.contexts.every((c) => Number(c.order) < 10000), 'context 段不应落在 section 的 10xxx 区间')
})

await t('两个注入回调各自返回字符串（互不干扰）', () => {
  for (const c of captured.contexts) {
    const text = c.text(frame())
    assert.equal(typeof text, 'string', (c.name || c.order) + ' 未返回字符串')
  }
})

await t('合并上下文同时含「专家视角」与「记忆」两条内容', () => {
  const merged = captured.contexts
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.text(frame()))
    .filter(Boolean)
    .join('\n\n')
  assert.ok(merged.includes('【交付层·纪律】'), '缺专家注入（交付层纪律块）：' + merged.slice(0, 160))
  assert.ok(merged.includes('记忆'), '缺记忆内容：' + merged.slice(0, 160))
  assert.ok(merged.indexOf('【交付层·纪律】') < merged.indexOf('记忆'), '顺序应为专家在前、记忆在后')
})

await t('工具注册不重名；不再注册命令（/expert 已于 0.3.0 移除）', () => {
  const toolNames = captured.tools.map((x) => x.name)
  assert.ok(toolNames.includes('expert_recall'), '缺 expert_recall：' + toolNames.join(','))
  assert.equal(new Set(toolNames).size, toolNames.length, '工具重名：' + toolNames.join(','))
  assert.ok(!captured.commands.some((x) => x.name === 'expert'), 'experts 不应再注册 /expert 命令（已注册：' + captured.commands.map((x) => x.name).join(',') + '）')
})

await t('两个模块的 dispose 都可安全调用', () => {
  for (const d of disposers) d()
})

// 清理临时记忆库（仅真加载路径会创建）
if (existsSync(TMP_MEMORY)) {
  try { rmSync(TMP_MEMORY, { recursive: true, force: true }) } catch { /* best-effort */ }
}

console.log('\ndsh-experts × dsh-work-memory 共存：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
