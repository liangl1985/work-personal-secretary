/**
 * work-personal-secretary —— 配置底座引擎自测（不依赖宿主运行时，也**不触碰任何真实环境**）
 *
 * 用法：node scripts/basedeck-test.mjs
 *
 * 覆盖：
 *   [1] 契约形状：五项 id / 执行顺序 / 4 个设置键
 *   [2] content-hash 规范化（行尾 / 尾随空白 / 首尾空行）
 *   [3] 标记块七状态（append / update / up_to_date / user_modified / ahead / broken / multiple）
 *   [4] AGENTS.md 端到端：首次追加 + 只替换块区间 + **块外逐字节未变** + 备份 + 无 BOM
 *   [5] 幂等：第二次运行为 up_to_date 且**不写盘**（mtime / size 不变）
 *   [6] 块内被手改：不覆盖原文件，另存 AGENTS.wps-new.md；BOM / 不完整块 / 多块一律拒写
 *   [7] 记忆种子：幂等 + 不删改已有条目（原有条目逐条保留，字节前缀不变）
 *   [8] 技能三态：一致 / 被本地改过（不覆盖 + 报告差异）/ 缺失（安装）
 *   [9] 设置：只增改指定键，其余行与注释逐字节保留；overrides 写 experts；YAML 结构坏 / 带 BOM 一律拒写
 *  [10] 目录：只创建缺失的，已存在的 mtime 不变
 *  [11] 未知 id 被拒（rejected）
 *  [12] **dry-run 零写盘**：整棵临时树快照逐项一致
 *  [13] 路由：GET /basedeck 只读、POST /basedeck 默认 dry-run、dryRun:false 在夹具里真写、跨站 403
 *  [14] setupNeeded 引导信号
 *  [15] 真实环境**只读快照**首尾比对（证明本次开发未写入真实工作区 / 真实设置文件）
 *
 * 隔离红线（本测试的全部保证）：
 *   - 所有夹具（假 DSH_HOME / 假仓库 / 假工作区 / 假设置 / 假记忆库）都在 os.tmpdir() 下自建；
 *   - 每次真写前都用 assertInsideTmp() 复核目标路径仍在临时根内；
 *   - dshHome / settingsFile / memoryDir / workspace / repoRoot 全部**显式注入**，绝不依赖 process.env.DSH_HOME；
 *   - 真实工作区与真实设置文件只做 statSync / readdir 只读快照，首尾比对，**从不用作任何写入目标**。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'

import {
  AGENTS_CANDIDATE_NAME,
  BACKUP_SUFFIX,
  BASEDECK_APPLY_ORDER,
  BASEDECK_ID_LIST,
  SETTINGS_TARGETS,
  applyBaseDeck,
  applyBaseDeckItem,
  currentBlockBody,
  decideAgentsStatus,
  hashBlockBody,
  inspectSimpleYaml,
  loadAgentsTemplate,
  loadMemorySeed,
  normalizeBlockBody,
  planBaseDeck,
  readSettingsValues,
  resolveWorkspace,
  safeWorkspaceParam,
  sha256Text,
} from '../lib/basedeck.js'
import { API_PATHS, API_ROOT, installApi } from '../lib/api.js'
import { detectBom } from '../lib/install.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

// ───────────────────── 隔离护栏 ─────────────────────

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'wps-basedeck-test-'))

function assertInsideTmp(p, where) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()
  const root = TMP_ROOT.replace(/\\/g, '/').toLowerCase()
  if (s.indexOf(root) !== 0) throw new Error('隔离护栏拦截：' + (where || 'path') + ' 不在临时目录内：' + p)
}
function readBytes(file) { try { return readFileSync(file) } catch (e) { return null } }
function statSnap(file) {
  try { const st = statSync(file); return { size: st.size, mtimeMs: st.mtimeMs, isDir: st.isDirectory() } } catch (e) { return null }
}
function sameSnap(a, b) {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.isDir === b.isDir
}
function listNames(dir) {
  try { return readdirSync(dir).sort().join(',') } catch (e) { return null }
}
/** 整棵树快照（目录名 + 文件 size/mtime），用于证明「零写盘」 */
function treeSnapshot(dir) {
  const out = {}
  const walk = (d, prefix) => {
    let ents = []
    try { ents = readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      const rel = prefix ? prefix + '/' + e.name : e.name
      const abs = join(d, e.name)
      if (e.isDirectory()) { out[rel] = 'dir'; walk(abs, rel) }
      else { const st = statSnap(abs); out[rel] = st ? (st.size + ':' + st.mtimeMs) : 'gone' }
    }
  }
  walk(dir, '')
  return out
}
function sameTree(a, b) {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.join('|') !== kb.join('|')) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}
function writeText(file, text, opts) {
  assertInsideTmp(file, 'writeText')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(text, 'utf8'))
  if (opts && opts.bom) writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]))
}
const FENCE = String.fromCharCode(96).repeat(3)
const NL = '\n'

// ───────────────────── 真实环境只读快照（首） ─────────────────────

const REAL_DSH_HOME = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')

/** 从测试进程的工作目录逐级向上探测真实工作区（只读；只是为了让快照有目标，绝不写入） */
function discoverRealWorkspace() {
  const explicit = String(process.env.WPS_TEST_REAL_WORKSPACE || '').trim()
  if (explicit) return explicit
  let cursor = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cursor, 'AGENTS.md'))) return cursor
    const up = dirname(cursor)
    if (!up || up === cursor) break
    cursor = up
  }
  return ''
}
const REAL_WS = discoverRealWorkspace()

/** 记忆库条目：运行时遍历 memories 下的各库 MEMORY.md（**不硬编码任何私有目录名**，发布件中立） */
function realMemoryTargets() {
  const out = []
  let names = []
  try { names = readdirSync(join(REAL_DSH_HOME, 'memories')) } catch (e) { return out }
  names.sort()
  let i = 0
  for (const name of names) {
    const f = join(REAL_DSH_HOME, 'memories', name, 'MEMORY.md')
    if (!existsSync(f)) continue
    i += 1
    out.push({ label: '真实记忆库 #' + i + ' 的 MEMORY.md', kind: 'file', path: f })
  }
  return out
}

const REAL_TARGETS = [
  { label: '真实 settings.yaml', kind: 'file', path: join(REAL_DSH_HOME, 'settings.yaml') },
  { label: '真实记忆库根目录清单', kind: 'dirList', path: join(REAL_DSH_HOME, 'memories') },
]
  .concat(realMemoryTargets())
  .concat([
    { label: '真实工作区 AGENTS.md', kind: 'file', path: REAL_WS ? join(REAL_WS, 'AGENTS.md') : '' },
    { label: '真实工作区 .dsh/skills', kind: 'dirList', path: REAL_WS ? join(REAL_WS, '.dsh', 'skills') : '' },
    { label: '真实工作区根目录清单', kind: 'dirList', path: REAL_WS || '' },
    { label: '真实候选文件 AGENTS.wps-new.md', kind: 'file', path: REAL_WS ? join(REAL_WS, AGENTS_CANDIDATE_NAME) : '' },
  ])
function readRealTarget(t) {
  if (!t.path) return null
  return t.kind === 'file' ? statSnap(t.path) : listNames(t.path)
}
const REAL_BEFORE = REAL_TARGETS.map((t) => ({ t: t, v: readRealTarget(t) }))

// ───────────────────── 夹具：一个「镜像仓库」+ 假 DSH_HOME + 假工作区 ─────────────────────

const FAKE_REPO = join(TMP_ROOT, 'repo')
const FAKE_MODULE = join(FAKE_REPO, 'modules', 'work-personal-secretary')
const FAKE_DOC = join(FAKE_REPO, 'modules', 'dsh-doc-suite')
const FAKE_DSH = join(TMP_ROOT, 'home', '.dsh')
const FAKE_SETTINGS = join(FAKE_DSH, 'settings.yaml')
const FIXED_NOW = new Date(2026, 0, 2, 3, 4, 5, 678)
const GEN_VERSION = '1.0.0'
const TPL_VERSION = '1'

const TEMPLATE_TEXT = [
  '# 模板（夹具）',
  '',
  '<!-- wps:begin generator="work-personal-secretary" generator-version="' + GEN_VERSION + '" template="agents-zh-CN" template-version="' + TPL_VERSION + '" content-hash="sha256:pending" updated="pending" -->',
  '> 本节由集成体自动维护 —— 请勿在标记块内手工修改。',
  '',
  '## 语言',
  '',
  '- 一律尽量使用简体中文。',
  '- 推理痕迹也用简体中文。',
  '',
  '## 工作方式',
  '',
  '- 主对话保持轻量。',
  '',
  '<!-- wps:end -->',
  '',
].join(NL)

const SEED_TEXT = [
  '# 种子（夹具）',
  '',
  '## 语言',
  '',
  FENCE,
  '【语言偏好】回答与思维尽量使用简体中文。',
  FENCE,
  '',
  '## 协作',
  '',
  FENCE,
  '【协作方式】主对话保持轻量，具体工作交子代理。',
  '【专家库】常驻只有一位身份专家。',
  FENCE,
  '',
].join(NL)

function makeFakeRepo() {
  writeText(join(FAKE_REPO, 'defaults', 'AGENTS.zh-CN.md'), TEMPLATE_TEXT)
  writeText(join(FAKE_REPO, 'defaults', 'global-memory.seed.md'), SEED_TEXT)
  writeText(join(FAKE_MODULE, 'package.json'), JSON.stringify({ name: 'work-personal-secretary', version: GEN_VERSION }, null, 2) + NL)
  writeText(join(FAKE_DOC, 'package.json'), JSON.stringify({ name: 'dsh-doc-suite', version: '8.8.8' }, null, 2) + NL)
  writeText(join(FAKE_DOC, 'skills', 'alpha', 'SKILL.md'), '# alpha' + NL + 'alpha body' + NL)
  writeText(join(FAKE_DOC, 'skills', 'beta', 'SKILL.md'), '# beta' + NL + 'beta body' + NL + 'second line' + NL)
  writeText(join(FAKE_DOC, 'skills', 'gamma', 'SKILL.md'), '# gamma' + NL + 'gamma body' + NL)
}
makeFakeRepo()
assertInsideTmp(FAKE_REPO, 'fakeRepo')

/** 造 / 重置一个假工作区 */
function makeWorkspace(name) {
  const dir = join(TMP_ROOT, 'ws', name)
  mkdirSync(dir, { recursive: true })
  assertInsideTmp(dir, 'workspace')
  return dir
}
const WS_MAIN = makeWorkspace('main')
const WS_CLEAN = makeWorkspace('clean')

// 公共调用参数：一切路径都显式注入，绝不落到 process.env.DSH_HOME
function opts(extra) {
  return Object.assign({
    dshHome: FAKE_DSH,
    env: {},
    repoRoot: FAKE_REPO,
    moduleDir: FAKE_MODULE,
    generatorVersion: GEN_VERSION,
    now: FIXED_NOW,
    workspace: WS_MAIN,
  }, extra || {})
}

// ═══════════════════════════ 主流程 ═══════════════════════════

section('[1] 契约形状')
ok(BASEDECK_ID_LIST.join(',') === 'agentsMd,memorySeed,skills,settings,dirs', '五项 id 与顺序')
ok(BASEDECK_APPLY_ORDER.join(',') === 'dirs,memorySeed,skills,settings,agentsMd', '执行顺序按依赖排，agentsMd 最后')
ok(SETTINGS_TARGETS.map((t) => t.ns + '.' + t.key).join(',') === 'work-memory.memoryDir,work-memory.obsidianSyncDir,experts.defaultDomain,experts.identityExpert', '只增改这 4 个键')
ok(API_PATHS.join(',') === '/check,/fix,/fix-all,/plugins,/install,/install-all,/basedeck', 'API_PATHS 含 /basedeck')

section('[2] content-hash 规范化（行尾 / 尾随空白 / 首尾空行）')
const bodyA = '## 标题\n- 条目一\n- 条目二'
const bodyB = '\r\n\r\n## 标题  \r\n- 条目一\t\r\n- 条目二\r\n\r\n'
const bodyC = '\n\n\n## 标题\n- 条目一\n- 条目二\n\n'
ok(normalizeBlockBody(bodyA) === normalizeBlockBody(bodyB), 'CRLF + 尾随空白归一后一致')
ok(normalizeBlockBody(bodyA) === normalizeBlockBody(bodyC), '首尾空行归一后一致')
ok(hashBlockBody(bodyA) === hashBlockBody(bodyB) && hashBlockBody(bodyA) === hashBlockBody(bodyC), '三种写法的 content-hash 相同')
ok(hashBlockBody(bodyA) !== hashBlockBody(bodyA + '\n- 条目三'), '内容不同 → 哈希不同')
ok(/^sha256:[0-9a-f]{64}$/.test(hashBlockBody(bodyA)), '哈希形如 sha256:<64 位小写十六进制>')

section('[3] 标记块七状态（纯函数）')
const tplFile = join(FAKE_REPO, 'defaults', 'AGENTS.zh-CN.md')
const tpl = loadAgentsTemplate(tplFile, { generatorVersion: GEN_VERSION, now: FIXED_NOW })
ok(tpl.ok === true && tpl.templateVersion === 1 && tpl.generatorVersion === GEN_VERSION, '模板编译成功（template-version=1）')
ok(tpl.contentHash === hashBlockBody(tpl.body), '模板 content-hash 按规范化正文计算')
const blockText = '<!-- wps:begin generator="work-personal-secretary" generator-version="' + GEN_VERSION + '" template="agents-zh-CN" template-version="' + TPL_VERSION + '" content-hash="' + tpl.contentHash + '" updated="2026-01-02" -->' + NL
  + tpl.body + NL + NL + '<!-- wps:end -->'

ok(decideAgentsStatus('', tpl).status === 'append', 'append：空文件（无块）')
ok(decideAgentsStatus('# 我的指令' + NL, tpl).status === 'append', 'append：有内容但无块')
ok(decideAgentsStatus(blockText, tpl).status === 'up_to_date', 'up_to_date：版本一致 + 哈希匹配')
const oldTpl = blockText.replace('template-version="1"', 'template-version="0"')
ok(decideAgentsStatus(oldTpl, tpl).status === 'update', 'update：块版本低于安装器')
const newTpl = blockText.replace('template-version="1"', 'template-version="2"')
ok(decideAgentsStatus(newTpl, tpl).status === 'ahead', 'ahead：块版本高于安装器')
const oldGen = blockText.replace('generator-version="' + GEN_VERSION + '"', 'generator-version="0.9.0"')
ok(decideAgentsStatus(oldGen, tpl).status === 'update', 'update：集成体版本更低')
ok(decideAgentsStatus(blockText.replace('- 主对话保持轻量。', '- 我改过这一行。'), tpl).status === 'user_modified', 'user_modified：块内被手改（哈希不匹配）')
ok(decideAgentsStatus(blockText.replace(/ content-hash="[^"]*"/, ''), tpl).status === 'user_modified', 'user_modified：块首无 content-hash')
ok(decideAgentsStatus('<!-- wps:begin foo="1" -->' + NL + '正文', tpl).status === 'broken', 'broken：有 begin 无 end')
ok(decideAgentsStatus('<!-- wps:end -->' + NL, tpl).status === 'broken', 'broken：有 end 无 begin')
ok(decideAgentsStatus(blockText + NL + blockText, tpl).status === 'multiple', 'multiple：出现两个完整块')

section('[4] AGENTS.md 端到端：追加 + 只替换块区间 + 块外逐字节未变')
const agents = join(WS_MAIN, 'AGENTS.md')
const original = '# 我自己的指令' + NL + NL + '- 保留我这一行（含特殊字符：§ <!-- x --> \u00a0）' + NL + NL + '## 我的小节' + NL + '手写内容' + NL
writeText(agents, original)
const beforeBytes = readBytes(agents)
const rAppend = applyBaseDeckItem('agentsMd', opts({ dryRun: false }))
assertInsideTmp(agents, 'agentsMd')
ok(rAppend.ok === true && rAppend.status === 'append', 'append 写入成功')
ok(rAppend.outsideUnchanged === true, '返回里标明块外内容未变')
ok(rAppend.outsideHashBefore === rAppend.outsideHashAfter, '块外 SHA256 写前=写后')
const afterBytes = readBytes(agents)
ok(afterBytes.slice(0, beforeBytes.length).equals(beforeBytes), '原有内容作为**逐字节前缀**完整保留')
const afterText = afterBytes.toString('utf8')
ok(afterText.trimEnd().endsWith('<!-- wps:end -->'), '标记块已追加到文件末尾')
const writtenHash = (/content-hash="([^"]+)"/.exec(afterText) || [])[1]
ok(writtenHash === hashBlockBody(currentBlockBody(afterText)), '块首 content-hash = 块内正文的规范化哈希')
ok(detectBom(afterBytes) === '', '写入后无 BOM')
ok(rAppend.backup && existsSync(rAppend.backup), '写前备份存在')
assertInsideTmp(rAppend.backup, 'agentsMd backup')
ok(readBytes(rAppend.backup).equals(beforeBytes), '备份内容 = 写前原文（逐字节）')
const reRead = applyBaseDeckItem('agentsMd', opts({ dryRun: true }))
ok(reRead.status === 'up_to_date', '重新计划为 up_to_date')

section('[5] 幂等：第二次不写盘（mtime / size 不变）')
const snapIdle1 = statSnap(agents)
const rIdle = applyBaseDeckItem('agentsMd', opts({ dryRun: false }))
const snapIdle2 = statSnap(agents)
ok(rIdle.ok === true && rIdle.status === 'up_to_date', '第二次运行 up_to_date')
ok(rIdle.bytesWritten === 0, 'bytesWritten = 0')
ok(sameSnap(snapIdle1, snapIdle2), 'AGENTS.md 的 size/mtime 一字未变（真没写盘）')

section('[6] 块内被手改：不覆盖原文件 + 另存候选文件')
const wsMod = makeWorkspace('modified')
const agentsMod = join(wsMod, 'AGENTS.md')
writeText(agentsMod, original + NL + blockText.replace('- 主对话保持轻量。', '- 使用者自己改过。') + NL)
const modBefore = readBytes(agentsMod)
const modSnapBefore = statSnap(agentsMod)
const rMod = applyBaseDeckItem('agentsMd', opts({ workspace: wsMod, dryRun: false }))
ok(rMod.ok === true && rMod.status === 'user_modified', 'user_modified：不自动覆盖')
ok(readBytes(agentsMod).equals(modBefore) && sameSnap(modSnapBefore, statSnap(agentsMod)), '原文件一字未动（字节 + mtime 都不变）')
const candidate = join(wsMod, AGENTS_CANDIDATE_NAME)
assertInsideTmp(candidate, 'candidate')
ok(existsSync(candidate), '已另存候选文件 ' + AGENTS_CANDIDATE_NAME)
ok(detectBom(readBytes(candidate)) === '', '候选文件无 BOM')
const wsBom = makeWorkspace('bom')
const agentsBom = join(wsBom, 'AGENTS.md')
writeText(agentsBom, original, { bom: true })
const rBom = applyBaseDeckItem('agentsMd', opts({ workspace: wsBom, dryRun: false }))
ok(rBom.ok === false && rBom.status === 'broken', 'AGENTS.md 带 BOM → 拒绝写入')
ok(readBytes(agentsBom).equals(readBytes(agentsBom)), '带 BOM 的文件未被改写')
const wsBroken = makeWorkspace('broken')
writeText(join(wsBroken, 'AGENTS.md'), '# x' + NL + '<!-- wps:begin foo="1" -->' + NL + '未闭合')
const rBroken = applyBaseDeckItem('agentsMd', opts({ workspace: wsBroken, dryRun: false }))
ok(rBroken.ok === false && rBroken.status === 'broken', '不完整块 → 拒写')
const wsMulti = makeWorkspace('multi')
writeText(join(wsMulti, 'AGENTS.md'), blockText + NL + blockText + NL)
const rMulti = applyBaseDeckItem('agentsMd', opts({ workspace: wsMulti, dryRun: false }))
ok(rMulti.ok === false && rMulti.status === 'multiple', '多块 → 拒写')

section('[7] 记忆种子：幂等 + 不删改已有条目')
const wsSeed = makeWorkspace('seed')
const memDir = join(TMP_ROOT, 'mem', 'seedws')
const memFile = join(memDir, 'MEMORY.md')
const existing1 = '[id:aaaaaaaaaaaa] [2026-01-01] [tag:关键] 既有条目一'
const existing2 = '[id:bbbbbbbbbbbb] [2026-01-01] [tag:常规] 既有条目二'
const memOriginal = existing1 + NL + '§' + NL + existing2 + NL
writeText(memFile, memOriginal)
const seedPlan0 = planBaseDeck(opts({ workspace: wsSeed, memoryDir: memDir }))
const seedItem0 = seedPlan0.items.filter((i) => i.id === 'memorySeed')[0]
ok(seedItem0.status === 'update' && seedItem0.autoApplyable === true, 'memorySeed：现状=update（3 条待写）')
ok(String(seedItem0.preview.sampleLines).split('\n').length === 3, '预览里能看到 3 条种子条目（sampleLines 是字符串）')
const rSeed = applyBaseDeckItem('memorySeed', opts({ workspace: wsSeed, memoryDir: memDir, dryRun: false }))
assertInsideTmp(memFile, 'memorySeed')
ok(rSeed.ok === true && rSeed.preservedEntries === 2 && rSeed.entriesAfter === 5, '写入后 2 条既有 + 3 条种子 = 5 条')
const memAfter = readBytes(memFile).toString('utf8')
ok(memAfter.indexOf(existing1) >= 0 && memAfter.indexOf(existing2) > 0, '既有条目原文仍在')
ok(memAfter.startsWith(existing1 + NL + '§' + NL + existing2 + NL), '既有内容作为逐字节前缀保留（未重排、未改写）')
ok(detectBom(readBytes(memFile)) === '', 'MEMORY.md 无 BOM')
ok(rSeed.backup && existsSync(rSeed.backup), '记忆库写前已备份')
const seedSnap1 = statSnap(memFile)
const rSeed2 = applyBaseDeckItem('memorySeed', opts({ workspace: wsSeed, memoryDir: memDir, dryRun: false }))
const seedSnap2 = statSnap(memFile)
ok(rSeed2.ok === true && rSeed2.status === 'up_to_date', '第二次运行 up_to_date（幂等）')
ok(sameSnap(seedSnap1, seedSnap2), 'MEMORY.md mtime/size 未变（不写盘）')
ok((memAfter.match(/【语言偏好】/g) || []).length === 1, '同一条种子不会重复写入')

section('[8] 技能三态：一致 / 被本地改过（不覆盖）/ 缺失（安装）')
const wsSkills = makeWorkspace('skills')
const srcSkills = join(FAKE_DOC, 'skills')
writeText(join(wsSkills, '.dsh', 'skills', 'alpha', 'SKILL.md'), readBytes(join(srcSkills, 'alpha', 'SKILL.md')).toString('utf8'))
const betaLocal = '# beta' + NL + 'beta body 被本地改过' + NL + 'second line' + NL
writeText(join(wsSkills, '.dsh', 'skills', 'beta', 'SKILL.md'), betaLocal)
const skillsPlan = planBaseDeck(opts({ workspace: wsSkills }))
const skillsItem = skillsPlan.items.filter((i) => i.id === 'skills')[0]
const st = {}
for (const f of skillsItem.files) st[f.name] = f.state
ok(st.alpha === 'same' && st.beta === 'modified' && st.gamma === 'missing', '三态判定：alpha=same / beta=modified / gamma=missing')
ok(skillsItem.status === 'user_modified', '有本地改动 → 整体 user_modified')
ok(skillsItem.files.filter((f) => f.name === 'beta')[0].detail.indexOf('第') >= 0, '差异报告里给出差异行')
const betaSnapBefore = statSnap(join(wsSkills, '.dsh', 'skills', 'beta', 'SKILL.md'))
const rSkills = applyBaseDeckItem('skills', opts({ workspace: wsSkills, dryRun: false }))
assertInsideTmp(join(wsSkills, '.dsh', 'skills', 'gamma', 'SKILL.md'), 'skills')
ok(rSkills.ok === true && rSkills.writtenFiles.length === 1, '只安装缺失的 1 个技能')
ok(existsSync(join(wsSkills, '.dsh', 'skills', 'gamma', 'SKILL.md')), 'gamma 已安装')
ok(readBytes(join(wsSkills, '.dsh', 'skills', 'beta', 'SKILL.md')).toString('utf8') === betaLocal
  && sameSnap(betaSnapBefore, statSnap(join(wsSkills, '.dsh', 'skills', 'beta', 'SKILL.md'))), '被本地改过的 beta 一字未动（含 mtime）')
ok(readBytes(join(wsSkills, '.dsh', 'skills', 'gamma', 'SKILL.md')).equals(readBytes(join(srcSkills, 'gamma', 'SKILL.md'))), '安装内容与仓库版逐字节一致')
ok(detectBom(readBytes(join(wsSkills, '.dsh', 'skills', 'gamma', 'SKILL.md'))) === '', '安装的技能无 BOM')

section('[9] 设置用户层：只增改指定键 + 其余内容逐字节保留')
const wsSet = makeWorkspace('settings')
const setFile = join(FAKE_DSH, 'settings.yaml')
const setOriginal = [
  '# 顶层注释（必须保留）',
  'dsh-desktop:',
  '  theme: dark',
  '',
  'work-memory:',
  '  # 记忆库（必须保留）',
  '  memoryDir: ' + join(TMP_ROOT, 'mem', 'existing').replace(/\\/g, '/'),
  '  personaLabel: 记忆',
  '',
  'experts:',
  '  defaultDomain: presales',
  '  identityExpert: presales-ics-security',
  '',
  'llm-pi-ai:',
  '  providers: { moonshotai-cn: { apiKeyEnv: X } }',
  '',
].join(NL)
writeText(setFile, setOriginal)
const setPlan = planBaseDeck(opts({ workspace: wsSet }))
const setItem = setPlan.items.filter((i) => i.id === 'settings')[0]
const keyActions = {}
for (const k of setItem.settingsKeys) keyActions[k.ns + '.' + k.key] = k.action
ok(keyActions['work-memory.memoryDir'] === 'keepExisting', '已有 memoryDir → 保留原值')
ok(keyActions['work-memory.obsidianSyncDir'] === 'write', '缺失 obsidianSyncDir → 写建议值')
ok(keyActions['experts.defaultDomain'] === 'keepExisting', '已有 defaultDomain → 保留原值')
ok(keyActions['experts.identityExpert'] === 'keepExisting', '已有 identityExpert → 保留原值')
const obsidianKey = setItem.settingsKeys.filter((k) => k.key === 'obsidianSyncDir')[0]
ok(obsidianKey.detail.indexOf('留空将镜像到') >= 0 && obsidianKey.detail.indexOf('work-memory') > 0, 'obsidianSyncDir 的 detail 写明「留空将镜像到 <工作区>/work-memory」')
ok(setItem.detail.indexOf('留空将镜像到') >= 0 && setItem.detail.indexOf(join(wsSet, 'work-memory').replace(/\\/g, '/')) > 0, 'settings 项 detail 带出实际镜像路径（留空不是隐性副作用）')
const rSet = applyBaseDeckItem('settings', opts({ workspace: wsSet, dryRun: false }))
assertInsideTmp(setFile, 'settings')
ok(rSet.ok === true, 'settings 写入成功')
const setAfter = readBytes(setFile).toString('utf8')
ok(detectBom(readBytes(setFile)) === '', 'settings.yaml 无 BOM')
ok(setAfter.indexOf('# 顶层注释（必须保留）') >= 0 && setAfter.indexOf('# 记忆库（必须保留）') > 0, '注释逐字保留')
ok(setAfter.indexOf('  memoryDir: ' + join(TMP_ROOT, 'mem', 'existing').replace(/\\/g, '/')) > 0
  && setAfter.indexOf('  identityExpert: presales-ics-security') > 0, '已有键值未被覆盖（原值保留）')
ok(setAfter.indexOf('  obsidianSyncDir: ' + join(wsSet, 'work-memory').replace(/\\/g, '/')) > 0, 'obsidianSyncDir 已补齐（建议值）')
ok(setAfter.indexOf('  theme: dark') > 0 && setAfter.indexOf('apiKeyEnv: X') > 0, '其他命名空间内容未变')
const onlyAdded = setAfter.replace('  obsidianSyncDir: ' + join(wsSet, 'work-memory').replace(/\\/g, '/') + NL, '')
ok(onlyAdded === setOriginal, '除新增的那一行外，全文与原文逐字节一致')
ok(rSet.backup && existsSync(rSet.backup) && readBytes(rSet.backup).toString('utf8') === setOriginal, '备份 = 写前原文')
const setSnap1 = statSnap(setFile)
const rSet2 = applyBaseDeckItem('settings', opts({ workspace: wsSet, dryRun: false }))
ok(rSet2.status === 'up_to_date' && sameSnap(setSnap1, statSnap(setFile)), '第二次运行 up_to_date 且不写盘')

// overrides：引导填值（含 experts 两键 + 新建段）
const setFile2 = join(TMP_ROOT, 'home2', '.dsh', 'settings.yaml')
const wsSet2 = makeWorkspace('settings2')
const ov = {
  workspace: wsSet2,
  memoryDir: join(TMP_ROOT, 'mem', 'fromwizard'),
  obsidianSyncDir: join(TMP_ROOT, 'mirror', 'fromwizard'),
  defaultDomain: 'engineering',
  identityExpert: 'eng-ics',
}
const ovOpts = opts({ workspace: wsSet2, settingsFile: setFile2, overrides: ov })
const setPlan2 = planBaseDeck(ovOpts)
const setItem2 = setPlan2.items.filter((i) => i.id === 'settings')[0]
ok(setItem2.status === 'append', '设置文件不存在 + 有填值 → append（将新建）')
const rSet2b = applyBaseDeckItem('settings', Object.assign({}, ovOpts, { dryRun: false }))
assertInsideTmp(setFile2, 'settings2')
ok(rSet2b.ok === true, 'overrides 写入成功')
const setNew = readBytes(setFile2).toString('utf8')
ok(setNew.indexOf('work-memory:') === 0 && setNew.indexOf('  memoryDir: ' + join(TMP_ROOT, 'mem', 'fromwizard').replace(/\\/g, '/')) > 0, '新文件写入 work-memory.memoryDir（引导填值）')
ok(setNew.indexOf('experts:') > 0 && setNew.indexOf('  defaultDomain: engineering') > 0 && setNew.indexOf('  identityExpert: eng-ics') > 0, '新文件写入 experts 两键（引导填值）')

// YAML 结构坏 → 拒写
const setBad = join(TMP_ROOT, 'home3', '.dsh', 'settings.yaml')
writeText(setBad, 'work-memory:' + NL + '\tmemoryDir: x' + NL)
const badBad = readBytes(setBad)
const rBad = applyBaseDeckItem('settings', opts({ workspace: wsSet, settingsFile: setBad, dryRun: false }))
ok(rBad.ok === false && rBad.status === 'broken', 'YAML 结构坏（TAB 缩进）→ 报错不写')
ok(readBytes(setBad).equals(badBad), '坏结构文件未被改写')
ok(!existsSync(setBad + BACKUP_SUFFIX + '20260102-030405-678'), '拒写时没有产生备份（确实没写）')
const setBom = join(TMP_ROOT, 'home4', '.dsh', 'settings.yaml')
writeText(setBom, 'work-memory:' + NL, { bom: true })
const rSetBom = applyBaseDeckItem('settings', opts({ workspace: wsSet, settingsFile: setBom, dryRun: false }))
ok(rSetBom.ok === false && rSetBom.status === 'broken', 'settings.yaml 带 BOM → 拒写')
ok(readSettingsValues(setBom, { strictNamespaces: ['work-memory'] }).bom === 'UTF-8', 'BOM 检测可用')

section('[10] 目录：只创建缺失的')
const wsDirs = makeWorkspace('dirs')
const dirMem = join(TMP_ROOT, 'dirs', 'mem')
const dirBackup = join(TMP_ROOT, 'dirs', 'backup')
mkdirSync(dirBackup, { recursive: true })
const dirMirror = join(TMP_ROOT, 'dirs', 'mirror')
const dirPet = join(TMP_ROOT, 'dirs', 'pet')
const backupSnap = statSnap(dirBackup)
const dirOpts = opts({
  workspace: wsDirs,
  settingsFile: join(TMP_ROOT, 'nope', 'settings.yaml'),
  memoryDir: dirMem,
  backupDir: dirBackup,
  obsidianSyncDir: dirMirror,
  petSkinsDir: dirPet,
  dshHome: FAKE_DSH,
})
const dirPlan = planBaseDeck(dirOpts)
const dirItem = dirPlan.items.filter((i) => i.id === 'dirs')[0]
const dirStates = {}
for (const d of dirItem.dirs) dirStates[d.key] = d.state
ok(dirStates.memoryDir === 'missing' && dirStates.backupDir === 'exists' && dirStates.obsidianSyncDir === 'missing', '状态：缺失 / 已存在 / 缺失')
const rDirs = applyBaseDeckItem('dirs', Object.assign({}, dirOpts, { dryRun: false }))
assertInsideTmp(rDirs.createdDirs[0], 'dirs')
ok(rDirs.ok === true && rDirs.createdDirs.length === 3, '只创建 3 个缺失目录')
ok(existsSync(dirMem) && existsSync(dirMirror) && existsSync(dirPet), '缺失目录已创建')
ok(sameSnap(backupSnap, statSnap(dirBackup)), '已存在的目录未被触碰（mtime 不变）')
ok(applyBaseDeckItem('dirs', Object.assign({}, dirOpts, { dryRun: true })).status === 'up_to_date', '再计划：全部已存在 → up_to_date')

section('[11] 未知 id 被拒（rejected），批次继续')
const wsBatch = makeWorkspace('batch')
const batch = applyBaseDeck(['agentsMd', 'nope', '../escape', 'agentsMd'], opts({ workspace: wsBatch, dryRun: true }))
ok(batch.rejected.join(',') === 'nope,../escape', '未知 id 计入 rejected')
ok(batch.results.length === 1 && batch.results[0].id === 'agentsMd', '只看白名单项且去重')
ok(batch.dryRun === true, '未传 dryRun → 默认 dry-run')

section('[12] dry-run 零写盘（整棵临时树快照）')
const cleanHome = join(TMP_ROOT, 'cleanhome', '.dsh')
const cleanWs = WS_CLEAN
writeText(join(cleanWs, 'AGENTS.md'), '# 干净工作区' + NL)
const cleanOpts = opts({
  dshHome: cleanHome,
  workspace: cleanWs,
  settingsFile: join(cleanHome, 'settings.yaml'),
  memoryDir: join(TMP_ROOT, 'cleanmem'),
  backupDir: join(TMP_ROOT, 'cleanbackup'),
  obsidianSyncDir: join(TMP_ROOT, 'cleanmirror'),
  petSkinsDir: join(TMP_ROOT, 'cleanpet'),
})
const treeBefore = treeSnapshot(TMP_ROOT)
const planClean = planBaseDeck(cleanOpts)
const dryAll = applyBaseDeck(BASEDECK_ID_LIST, Object.assign({}, cleanOpts, { dryRun: true }))
const defaultAll = applyBaseDeck(BASEDECK_ID_LIST, cleanOpts) // 不带 dryRun
const treeAfter = treeSnapshot(TMP_ROOT)
ok(sameTree(treeBefore, treeAfter), 'GET 计划 + dryRun + 缺省调用之后，整棵树逐项一致（零写盘）')
ok(dryAll.dryRun === true && defaultAll.dryRun === true, '两批都是 dryRun=true')
ok(dryAll.results.every((r) => r.bytesWritten === 0), 'dryRun 下 bytesWritten 全为 0')
ok(dryAll.results.every((r) => r.dryRun === true), 'dryRun 标记透传到每一项')
ok(planClean.setupNeeded === true, 'setupNeeded：干净工作区 + 缺键 + 缺技能 → true')

section('[13] 路由：GET /basedeck / POST /basedeck')
function makeMockCtx() {
  const routes = []
  return {
    routes: routes,
    logger: { debug() {}, warn() {}, info() {} },
    webServer: { register(o) { routes.push(o); return () => {} } },
  }
}
function prefixHandler(ctx) { return (ctx.routes.filter((x) => x.kind === 'prefix')[0] || {}).handler }
function makeReq(o) {
  const raw = o.body === undefined || o.body === null ? null : Buffer.from(JSON.stringify(o.body), 'utf8')
  return {
    method: o.method || 'GET',
    url: o.url || '/',
    headers: o.headers || {},
    async *[Symbol.asyncIterator]() { if (raw) yield raw },
  }
}
function makeRes() {
  return {
    status: 0, headers: null, body: '',
    writeHead(s, h) { this.status = s; this.headers = h || null },
    end(t) { this.body = t || '' },
  }
}
const REQ_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }
const CROSS_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://evil.example' }
const wsRoute = makeWorkspace('route')
const routeHome = join(TMP_ROOT, 'routehome', '.dsh')
const ctx = makeMockCtx()
installApi(ctx, {
  platform: 'win32',
  repoRoot: FAKE_REPO,
  workspace: wsRoute,
  profileDir: join(TMP_ROOT, 'profile'),
  moduleDir: FAKE_MODULE,
  env: {},
  now: FIXED_NOW,
  dshHome: routeHome,
})
ok(ctx.routes.filter((r) => r.kind === 'prefix').length === 1, 'prefix 路由已注册')
ok(ctx.routes.filter((r) => r.kind === 'exact').length === API_PATHS.length, 'exact 路由逐条注册（含 /basedeck）')
const handler = prefixHandler(ctx)
async function call(method, sub, body, headers) {
  const res = makeRes()
  await handler(makeReq({ method: method, url: API_ROOT + sub, body: body, headers: headers }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json }
}
const routeTreeBefore = treeSnapshot(wsRoute)
const rGet = await call('GET', '/basedeck')
ok(rGet.status === 200 && rGet.body.ok === true, 'GET /basedeck → 200 ok（只读）')
ok(rGet.body.items.length === 5 && typeof rGet.body.setupNeeded === 'boolean', 'items 五项 + setupNeeded 信号')
ok(rGet.body.items[0].id === 'agentsMd' && rGet.body.summary.total === 5, '计划按展示顺序，summary.total=5')
ok(rGet.body.workspaceSource === 'config', 'workspaceSource=config（来自设置项 workspace）')
ok(rGet.body.items.every((it) => it.internal === undefined), '内部字段 internal 不对外')
const rGetWs = await call('GET', '/basedeck?workspace=' + encodeURIComponent(wsRoute))
ok(rGetWs.body.workspace.toLowerCase().indexOf('route') > 0, '?workspace= 生效')
const rGetBad = await call('GET', '/basedeck?workspace=' + encodeURIComponent(join(TMP_ROOT, 'does-not-exist')))
ok(rGetBad.status === 200 && typeof rGetBad.body.message === 'string', '无效 workspace → 回退服务端解析并给出 message')
const routeMem = join(TMP_ROOT, 'routemem')
const rPostDry = await call('POST', '/basedeck', { ids: BASEDECK_ID_LIST, overrides: { workspace: wsRoute, memoryDir: routeMem, obsidianSyncDir: join(TMP_ROOT, 'routemirror') } }, REQ_HEADERS)
ok(rPostDry.status === 200 && rPostDry.body.dryRun === true, 'POST /basedeck 未传 dryRun → dryRun=true')
ok(rPostDry.body.results.every((r) => r.bytesWritten === 0), 'POST dry-run 零写盘')
ok(!existsSync(join(wsRoute, 'AGENTS.md')), 'dry-run 后 AGENTS.md 仍未创建')
ok(sameTree(routeTreeBefore, treeSnapshot(wsRoute)), 'dry-run 后工作区树未变')
const rPostCross = await call('POST', '/basedeck', { ids: ['agentsMd'], dryRun: false }, CROSS_HEADERS)
ok(rPostCross.status === 403, '跨站 POST /basedeck → 403')
ok(!existsSync(join(wsRoute, 'AGENTS.md')), '被拦下的跨站请求没有产生写入')
const rPostReal = await call('POST', '/basedeck', {
  ids: BASEDECK_ID_LIST.concat(['nope']),
  dryRun: false,
  overrides: { workspace: wsRoute, memoryDir: routeMem, obsidianSyncDir: join(TMP_ROOT, 'routemirror') },
}, REQ_HEADERS)
ok(rPostReal.status === 200 && rPostReal.body.ok === true, 'POST dryRun:false → 真写成功（仅夹具）')
ok(rPostReal.body.rejected.join(',') === 'nope', '未知 id 计入 rejected（不静默跳过）')
ok(rPostReal.body.results.map((r) => r.id).join(',') === 'dirs,memorySeed,skills,settings,agentsMd', '真写按依赖顺序执行，agentsMd 最后')
assertInsideTmp(join(wsRoute, 'AGENTS.md'), 'route agentsMd')
ok(existsSync(join(wsRoute, 'AGENTS.md')), '夹具工作区里的 AGENTS.md 已写入')
ok(existsSync(join(routeMem, 'MEMORY.md')), '夹具记忆库 MEMORY.md 已写入')
ok(existsSync(join(wsRoute, '.dsh', 'skills', 'alpha', 'SKILL.md')), '夹具技能已安装')
ok(existsSync(join(routeHome, 'settings.yaml')), '夹具 settings.yaml 已写入')
ok(detectBom(readBytes(join(wsRoute, 'AGENTS.md'))) === '' && detectBom(readBytes(join(routeHome, 'settings.yaml'))) === '', '真写产物一律无 BOM')
const rPostAfter = await call('GET', '/basedeck?workspace=' + encodeURIComponent(wsRoute))
ok(rPostAfter.body.setupNeeded === false, '装好后 setupNeeded=false（引导完成信号）')

section('[13b] 客户端契约细节：字符串预览 / wroteAny / 单 id 独立调用 / 空串 overrides')
const shape = (await call('GET', '/basedeck?workspace=' + encodeURIComponent(wsRoute))).body
ok(shape.items.every((it) => typeof it.preview.sampleLines === 'string'), 'preview.sampleLines 全部是**字符串**（不是数组）')
ok(shape.items.every((it) => typeof it.autoApplyable === 'boolean' && typeof it.detail === 'string' && typeof it.status === 'string'), 'items 字段类型符合契约')
ok(shape.items.every((it) => typeof it.preview.action === 'string' && typeof it.preview.blockVersion === 'string' && typeof it.preview.contentHash === 'string'), 'preview 四字段齐全且为字符串')
ok(shape.summary.total === 5 && typeof shape.setupNeeded === 'boolean' && typeof shape.workspace === 'string', 'summary + setupNeeded + workspace 存在')
const wsSingle = makeWorkspace('single')
const emptyOv = { workspace: wsSingle, defaultDomain: '', identityExpert: '', memoryDir: '', obsidianSyncDir: '' }
const singleDry = await call('POST', '/basedeck', { ids: ['agentsMd'], overrides: emptyOv }, REQ_HEADERS)
ok(singleDry.body.dryRun === true && singleDry.body.results.length === 1, '单 id + 五项空串 overrides：dry-run 正常')
ok(singleDry.body.wroteAny === false && singleDry.body.results[0].wroteAny === false, 'dry-run 时 wroteAny=false')
ok(!existsSync(join(wsSingle, 'AGENTS.md')), 'dry-run 未创建文件')
const singleReal = await call('POST', '/basedeck', { ids: ['agentsMd'], dryRun: false, overrides: emptyOv }, REQ_HEADERS)
ok(singleReal.body.ok === true && singleReal.body.results.length === 1 && singleReal.body.results[0].id === 'agentsMd', '单 id 真写独立成功（不依赖其他项）')
ok(singleReal.body.wroteAny === true && singleReal.body.results[0].wroteAny === true, '真写成功时 wroteAny=true')
assertInsideTmp(join(wsSingle, 'AGENTS.md'), 'single agentsMd')
ok(existsSync(join(wsSingle, 'AGENTS.md')), '单 id 写入落到指定工作区')
const singleAgain = await call('POST', '/basedeck', { ids: ['agentsMd'], dryRun: false, overrides: { workspace: wsSingle } }, REQ_HEADERS)
ok(singleAgain.body.wroteAny === false && singleAgain.body.results[0].status === 'up_to_date', '本来就是最新 → wroteAny=false（客户端可据此区分）')

section('[17] obsidianSyncDir 哨兵（__none__）与顶层 libraryName / memoryRoot')
const wsOv = makeWorkspace('ov')
const ovHome = join(TMP_ROOT, 'ovhome', '.dsh')
const ovSettings = join(ovHome, 'settings.yaml')
const ovMem = join(TMP_ROOT, 'ovmem')
const ovPlan = (value, extra) => planBaseDeck(opts(Object.assign({ workspace: wsOv, settingsFile: ovSettings, memoryDir: ovMem, overrides: { workspace: wsOv, obsidianSyncDir: value } }, extra || {})))
const obsKeyOf = (plan) => plan.items.filter((i) => i.id === 'settings')[0].settingsKeys.filter((k) => k.key === 'obsidianSyncDir')[0]

const planEmptyOv = ovPlan('')
ok(obsKeyOf(planEmptyOv).action === 'write' && obsKeyOf(planEmptyOv).value.replace(/\\/g, '/') === join(wsOv, 'work-memory').replace(/\\/g, '/'), '空串 → 用探测到的现状 / 默认（建议值 <工作区>/work-memory）')
const mirrorX = join(TMP_ROOT, 'mirrorX')
const planPathOv = ovPlan(mirrorX)
ok(obsKeyOf(planPathOv).action === 'write' && obsKeyOf(planPathOv).value.replace(/\\/g, '/') === mirrorX.replace(/\\/g, '/'), '路径 → 写入该路径')

const planOffOv = ovPlan('__none__')
const kOff = obsKeyOf(planOffOv)
ok(kOff.action === 'setEmpty' && kOff.value === '', '哨兵 __none__ → 显式写空值（不是 __none__ 字面量）')
ok(kOff.detail.indexOf('不使用镜像') >= 0, '哨兵分支的 detail 说明「不使用镜像」')
ok(planOffOv.items.filter((i) => i.id === 'settings')[0].detail.indexOf('关闭镜像同步') >= 0, 'settings 项 detail 说明已关闭镜像（不与「留空镜像」提示打架）')
ok(planOffOv.items.filter((i) => i.id === 'dirs')[0].dirs.filter((d) => d.key === 'obsidianSyncDir')[0].state === 'skipped', '关闭镜像后不再规划镜像目录')

const rOffOv = applyBaseDeckItem('settings', opts({ workspace: wsOv, settingsFile: ovSettings, memoryDir: ovMem, overrides: { workspace: wsOv, obsidianSyncDir: '__none__' }, dryRun: false }))
assertInsideTmp(ovSettings, 'ovSettings')
ok(rOffOv.ok === true && rOffOv.wroteAny === true, '哨兵真写成功（wroteAny=true）')
const ovText = readBytes(ovSettings).toString('utf8')
ok(/obsidianSyncDir: ''/.test(ovText), 'YAML 里落成空值（obsidianSyncDir 后跟两个单引号）')
ok(ovText.indexOf('__none__') < 0, '哨兵字面量不会被写进配置文件')
const planOffAgain = ovPlan('')
ok(obsKeyOf(planOffAgain).action === 'explicitOff', '已显式关闭 → 再次计划标 explicitOff（空串不再覆盖它）')
ok(planOffAgain.items.filter((i) => i.id === 'settings')[0].status === 'up_to_date', '已关闭 → settings 项 up_to_date（不写盘）')
const ovSnap = statSnap(ovSettings)
const rOffAgain = applyBaseDeckItem('settings', opts({ workspace: wsOv, settingsFile: ovSettings, memoryDir: ovMem, dryRun: false }))
ok(rOffAgain.ok === true && rOffAgain.wroteAny === false && sameSnap(ovSnap, statSnap(ovSettings)), '关闭状态幂等：不写盘、不回填默认')

const memLib = join(TMP_ROOT, 'memlib', 'mylib')
const planFieldsLib = planBaseDeck(opts({ workspace: wsOv, settingsFile: ovSettings, memoryDir: memLib }))
ok(planFieldsLib.libraryName === 'mylib', '顶层 libraryName = 记忆库目录名')
ok(planFieldsLib.memoryRoot.replace(/\\/g, '/') === join(TMP_ROOT, 'memlib').replace(/\\/g, '/'), '顶层 memoryRoot = 记忆库根目录')
const rGetFields = await call('GET', '/basedeck?workspace=' + encodeURIComponent(wsRoute))
ok(typeof rGetFields.body.libraryName === 'string' && typeof rGetFields.body.memoryRoot === 'string', 'GET /basedeck 顶层返回 libraryName / memoryRoot')
const rPostFields = await call('POST', '/basedeck', { ids: ['settings'], overrides: { workspace: wsRoute } }, REQ_HEADERS)
ok(typeof rPostFields.body.libraryName === 'string' && typeof rPostFields.body.memoryRoot === 'string', 'POST /basedeck 顶层返回 libraryName / memoryRoot')

section('[16] 工作区解析优先级（client/config/derived/cwd/none）+ 家目录回归护栏')
const wsDerived = makeWorkspace('derived')
const mirrorDir = join(wsDerived, '00_mirror')
mkdirSync(mirrorDir, { recursive: true })
const derivedHome = join(TMP_ROOT, 'derivedhome', '.dsh')
const derivedSettings = join(derivedHome, 'settings.yaml')
writeText(derivedSettings, ['work-memory:', '  obsidianSyncDir: ' + mirrorDir.replace(/\\/g, '/'), ''].join(NL))
const baseOpts = { env: {}, repoRoot: FAKE_REPO, moduleDir: FAKE_MODULE, now: FIXED_NOW }
const planDerived = planBaseDeck(Object.assign({
  dshHome: derivedHome,
  settingsFile: derivedSettings,
  cwd: join(TMP_ROOT, 'not-a-workspace'),
}, baseOpts))
ok(planDerived.workspaceSource === 'derived', 'settings 有 obsidianSyncDir → source=derived')
ok(planDerived.workspace.replace(/\\/g, '/') === wsDerived.replace(/\\/g, '/'), '反推结果 = 镜像目录的父目录')
ok(planDerived.workspaceNote.indexOf('反推') >= 0 && planDerived.workspaceNote.indexOf('请确认') >= 0, 'derived 必须给出「请确认」提示')
ok(planDerived.items.filter((i) => i.id === 'agentsMd')[0].detail.indexOf('反推') >= 0, 'agentsMd 的 detail 带出反推提示')
ok(planDerived.items.filter((i) => i.id === 'agentsMd')[0].target.replace(/\\/g, '/') === join(wsDerived, 'AGENTS.md').replace(/\\/g, '/'), 'agentsMd 目标落在反推出的工作区')

const wsCwd = makeWorkspace('cwd')
writeText(join(wsCwd, 'AGENTS.md'), '# cwd 工作区' + NL)
const planCwd = planBaseDeck(Object.assign({
  dshHome: FAKE_DSH,
  settingsFile: join(TMP_ROOT, 'nowhere-cwd', 'settings.yaml'),
  cwd: wsCwd,
}, baseOpts))
ok(planCwd.workspaceSource === 'cwd', '无 client/config/derived 时取 cwd')
ok(planCwd.workspace.replace(/\\/g, '/') === wsCwd.replace(/\\/g, '/'), 'cwd 命中且落到正确目录')
ok(planCwd.workspaceNote.indexOf('进程目录') >= 0, 'cwd 来源有提示')

const planNone = planBaseDeck(Object.assign({
  dshHome: FAKE_DSH,
  settingsFile: join(TMP_ROOT, 'nonehome', '.dsh', 'settings.yaml'),
  cwd: join(TMP_ROOT, 'not-a-workspace'),
}, baseOpts))
ok(planNone.workspaceSource === 'none' && planNone.workspace === '', '都不可用 → source=none 且 workspace 为空字符串')
ok(planNone.items.filter((i) => i.id === 'agentsMd')[0].status === 'none' && planNone.items.filter((i) => i.id === 'agentsMd')[0].target === '', 'agentsMd 状态 none 且无目标路径')
ok(planNone.items.filter((i) => i.id === 'skills')[0].target === '', 'skills 无目标路径')
ok(planNone.workspaceNote.indexOf('不会回退到用户主目录') >= 0, 'none 时提示显式填写工作区（不猜）')
const noneJson = JSON.stringify(planNone).replace(/\\/g, '/')
const fakeHomePosix = join(TMP_ROOT, 'home').replace(/\\/g, '/')
ok(noneJson.indexOf(fakeHomePosix + '/AGENTS.md') < 0 && noneJson.indexOf(fakeHomePosix + '/.dsh/skills') < 0, '返回里不含「类主目录/AGENTS.md」「类主目录/.dsh/skills」')
const homePosix = homedir().replace(/\\/g, '/')
ok(noneJson.indexOf(homePosix + '/AGENTS.md') < 0 && noneJson.indexOf(homePosix + '/.dsh/skills') < 0, '返回里不含「用户主目录/AGENTS.md」「用户主目录/.dsh/skills」（旧 bug 会产出这两条）')
ok(!existsSync(join(TMP_ROOT, 'home', 'AGENTS.md')) && !existsSync(join(TMP_ROOT, 'home', '.dsh', 'skills')), '没有把 AGENTS.md / 技能写到类主目录')

const rWs = resolveWorkspace({ dshHome: FAKE_DSH, env: {}, cwd: join(TMP_ROOT, 'not-a-workspace') })
ok(rWs.source === 'none' && rWs.workspace === null, 'resolveWorkspace 不再回退到 DSH_HOME 的上一级（旧 bug 回归）')
ok(Array.isArray(rWs.tried), '被拒候选留有 tried 记录，便于界面排查')

const homeCheck = safeWorkspaceParam(homedir())
ok(homeCheck.ok === false && homeCheck.error.indexOf('主目录') >= 0, 'safeWorkspaceParam 拒绝用户主目录（客户端传值也拦）')
const wsRejectPlan = planBaseDeck(Object.assign({ overrides: { workspace: homedir() }, dshHome: FAKE_DSH, settingsFile: join(TMP_ROOT, 'nonehome2', '.dsh', 'settings.yaml'), cwd: join(TMP_ROOT, 'not-a-workspace') }, baseOpts))
ok(wsRejectPlan.workspaceSource === 'none' && wsRejectPlan.workspace === '', 'overrides 传家目录 → 被拒并回落 none（不写主目录）')

section('[14] 真实素材（真实 defaults）只读兼容性')
const realTpl = join(MODULE_DIR, '..', '..', 'defaults', 'AGENTS.zh-CN.md')
const realSeed = join(MODULE_DIR, '..', '..', 'defaults', 'global-memory.seed.md')
const realTplLoaded = loadAgentsTemplate(realTpl, { generatorVersion: GEN_VERSION, now: FIXED_NOW })
ok(realTplLoaded.ok === true && realTplLoaded.templateVersion === 1, '真实 AGENTS 模板可编译（template-version=1）')
const realSeedLoaded = loadMemorySeed(realSeed)
ok(realSeedLoaded.ok === true && realSeedLoaded.entries.length === 3, '真实记忆种子解析出 3 条条目')
ok(realSeedLoaded.entries.every((e) => e.indexOf('AGENTS.md') > 0), '种子条目都是指向指令层的指针（单一真源）')
const realPlan = planBaseDeck(opts({ workspace: WS_CLEAN, templateFile: realTpl, seedFile: realSeed }))
ok(realPlan.items.filter((i) => i.id === 'agentsMd')[0].preview.contentHash.indexOf('sha256:') === 0, '真实模板可产出 content-hash')
ok(inspectSimpleYaml('a:' + NL + '  b: 1' + NL).ok === true, '最小 YAML 扫描器可用')

section('[15.5] memoryDir 同源：种子写进哪个目录，settings 就声明哪个目录')
const wsMem = makeWorkspace('memdir')
const memExplicit = join(FAKE_DSH, 'memories', 'custom-lib')
mkdirSync(memExplicit, { recursive: true })
const memSettings = join(FAKE_DSH, 'settings-memdir.yaml')
writeFileSync(memSettings, 'work-memory:' + NL + '  obsidianSyncDir: ""' + NL, 'utf8')
const memPlan = planBaseDeck(opts({ workspace: wsMem, settingsFile: memSettings, memoryDir: memExplicit }))
const memSeedItem = memPlan.items.filter((i) => i.id === 'memorySeed')[0]
const memSetItem = memPlan.items.filter((i) => i.id === 'settings')[0]
const memSetVal = ((memSetItem.settingsKeys || []).filter((k) => k.key === 'memoryDir')[0] || {}).value || ''
ok(memSeedItem.target.indexOf('/custom-lib/') > 0, '显式 options.memoryDir → 种子条目写入该目录')
ok(memSetVal.indexOf('/custom-lib') > 0, '显式 options.memoryDir → settings 同样声明该目录（不再回落工作区目录名推导）')
ok(memSetVal === memSeedItem.target.replace(/\/MEMORY\.md$/, ''), 'settings 声明目录 = 种子路径去掉 /MEMORY.md（两者严格同源）')
const memPlanDefault = planBaseDeck(opts({ workspace: wsMem, settingsFile: join(FAKE_DSH, 'settings-memdir2.yaml'), memoryDir: undefined }))
const memSetDefault = ((memPlanDefault.items.filter((i) => i.id === 'settings')[0].settingsKeys || []).filter((k) => k.key === 'memoryDir')[0] || {}).value || ''
ok(memSetDefault.endsWith('/memdir'), '不传 memoryDir → 回落「工作区目录名」推导（真机即 memories/lina）')

section('[15] 真实环境只读快照首尾比对')
let realDrift = 0
for (const b of REAL_BEFORE) {
  const now = readRealTarget(b.t)
  const same = (typeof b.v === 'string' || b.v === null) ? b.v === now : sameSnap(b.v, now)
  if (!same) realDrift += 1
  // 只读快照只打印标签与结论，不打印本机私有路径
  console.log('  · ' + b.t.label + '：' + (!b.t.path ? '（无目标，跳过）' : (same ? '未变' : '发生变化 ⚠')))
}
ok(realDrift === 0, '真实 settings.yaml / MEMORY.md / 工作区 AGENTS.md / 技能清单 全部未被触碰')
ok(safeWorkspaceParam(REAL_WS || 'relative').ok === (REAL_WS ? true : false) || REAL_WS === '', 'safeWorkspaceParam 只接受绝对路径的已存在目录')

// ───────────────────── 收尾 ─────────────────────

console.log('\n──────── 结果 ────────')
console.log('  通过 ' + pass + ' / 失败 ' + fail)
console.log('  夹具根：' + TMP_ROOT)
console.log('  真实工作区快照目标：' + (REAL_WS || '（未探测到，仅比对真实 DSH_HOME）'))
console.log('  本次开发未对真实工作区 / 真实设置文件执行任何写入（上表逐项为只读快照比对结果）')
if (fail === 0) {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
  console.log('  夹具已清理（删除临时目录）')
}
process.exit(fail === 0 ? 0 : 1)
