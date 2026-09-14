#!/usr/bin/env node
/**
 * dsh-experts 能力层兜底索引生成器 —— 扫技能源 → 写 experts/skills.auto.json
 *
 * 用途（design-v2 第 7 节的 discoverSources()/buildIndex()，2026-09-14 落地版）：
 *   - **运行时首选宿主 skill 注册表**（ctx.skills），本文件只是**兜底**：
 *     无宿主运行时的环境（CI / 单测）+ 想要一份可入库、可审计的清单时用它；
 *   - 扫的源与 rank 严格对齐 @deepseek-ai/dsh-skill-filesystem：
 *       100 project-dsh    <projectRoot>/.dsh/skills
 *       200 project-agents <projectRoot>/.agents/skills
 *       400 user-dsh       <DSH_HOME>/skills          （跳过其 .system 子目录）
 *       500 user-agents    <DSH_AGENTS_HOME|~/.agents>/skills
 *       600 bundled        $DSH_BUNDLED_SKILL_DIR
 *     发现深度**只有 1 层**：<root>/<name>/SKILL.md 或平铺 <root>/<name>.md。
 *
 * 指纹（既准又便宜）：各根目录 mtimeMs + 每个 SKILL.md 的 size:mtimeMs。
 * **改文件内容不会改父目录 mtime**，所以内容级变化必须靠 SKILL.md 自身元数据。
 *
 * 运行：node scripts/skill-index.mjs [--project-root <dir>] [--dry]
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCapabilityEntry } from '../lib/capability.js'

const HERE = fileURLToPath(new URL('..', import.meta.url))
const OUT_FILE = join(HERE, 'experts', 'skills.auto.json')

const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const prIdx = argv.indexOf('--project-root')
const projectRootArg = prIdx >= 0 ? argv[prIdx + 1] : ''

/** 从给定目录向上找含 .git 的最近祖先（找不到就用该目录本身） */
function findProjectRoot(start) {
  let dir = resolve(start)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(start)
}

const projectRoot = projectRootArg ? resolve(projectRootArg) : findProjectRoot(process.cwd())
const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
const agentsHome = String(process.env.DSH_AGENTS_HOME || '').trim() || join(homedir(), '.agents')

/** 与宿主一致的源优先级（rank 小者胜） */
const ROOTS = [
  { rank: 100, source: 'project-dsh', dir: join(projectRoot, '.dsh', 'skills') },
  { rank: 200, source: 'project-agents', dir: join(projectRoot, '.agents', 'skills') },
  { rank: 400, source: 'user-dsh', dir: join(dshHome, 'skills') },
  { rank: 500, source: 'user-agents', dir: join(agentsHome, 'skills') },
  { rank: 600, source: 'bundled', dir: String(process.env.DSH_BUNDLED_SKILL_DIR || '').trim() },
].filter((r) => r.dir && existsSync(r.dir))

/** 极简 frontmatter 解析：只取顶层 `key: value` 单行标量（本机 12 个技能全部如此） */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''))
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
    if (!kv) continue
    out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

/** 扫一个根：目录型 + 平铺型；跳过 .system */
function scanRoot(root) {
  const found = []
  let entries = []
  try {
    entries = readdirSync(root.dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const full = join(root.dir, ent.name)
    if (ent.isDirectory()) {
      const md = join(full, 'SKILL.md')
      if (!existsSync(md)) continue
      found.push({ file: md, dir: full })
    } else if (ent.isFile() && ent.name.endsWith('.md') && ent.name !== 'SKILL.md') {
      found.push({ file: full, dir: root.dir })
    }
  }
  return found
}

const byName = new Map()
const fingerprintParts = []
const rootsMeta = []

for (const root of ROOTS) {
  let mtime = 0
  try {
    mtime = statSync(root.dir).mtimeMs
  } catch { /* 忽略 */ }
  fingerprintParts.push(root.source + ':' + mtime)
  const files = scanRoot(root)
  rootsMeta.push({ source: root.source, rank: root.rank, dir: root.dir, skills: files.length })
  for (const f of files) {
    let text = ''
    let st = null
    try {
      text = readFileSync(f.file, 'utf8')
      st = statSync(f.file)
    } catch {
      continue
    }
    const fm = parseFrontmatter(text)
    const name = String(fm?.name || '').trim()
    if (!name) continue
    fingerprintParts.push(name + ':' + st.size + ':' + Math.round(st.mtimeMs))
    if (byName.has(name)) continue // rank 小者已占位（ROOTS 已按 rank 升序）
    byName.set(name, { summary: { name, description: String(fm.description || ''), provider: root.source, resourceBase: { path: f.dir } }, file: f.file })
  }
}

const skills = [...byName.values()].map((x) => toCapabilityEntry(x.summary)).filter(Boolean)
  .sort((a, b) => String(a.skill).localeCompare(String(b.skill)))
const fingerprint = createHash('sha256').update(fingerprintParts.join('|')).digest('hex').slice(0, 16)
const payload = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  note: '能力层兜底索引（运行时首选宿主 skill 注册表 ctx.skills）。由 scripts/skill-index.mjs 生成，可重建、可入库。',
  projectRoot,
  fingerprint,
  roots: rootsMeta,
  skills,
}

console.log('【能力层索引】projectRoot = ' + projectRoot)
for (const r of rootsMeta) console.log('  · rank ' + r.rank + ' ' + r.source + ' → ' + r.dir + '（' + r.skills + ' 个）')
console.log('  技能 ' + skills.length + ' 个：' + skills.map((s) => s.skill).join('、'))
console.log('  指纹 ' + fingerprint)

if (dry) {
  console.log('  （--dry：未写文件）')
} else {
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log('  已写入 ' + OUT_FILE)
}
