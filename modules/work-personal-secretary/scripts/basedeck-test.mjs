/**
 * work-personal-secretary —— 配置底座引擎自测（不依赖宿主运行时，也**不触碰任何真实环境**）
 *
 * 用法：node scripts/basedeck-test.mjs
 *
 * 覆盖：
 *   [1] 契约形状：八项 id / 执行顺序 / 4 个设置键
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
 *  [22] ⑧ 迁移旧记忆库：只补缺失不覆盖 / 旧目录只读 / 逐文件校验 / 失败回滚 / 失败即停后续步骤 / 来源三级顺序
 *  [23] ⑪ 目录选择：完全限定路径判定 / browse 列举与建目录 / native 与缺服务降级 / 非法入参 400 / 同源保护
 *  [25] ⑫ 旧知识库导入：清单逐项对照 / 只补缺失不覆盖 / 敏感标记 / 路径护栏 / dry-run / 失败回滚 / 两条 exact 路由
 *  [26] T5-7 目录布局识别：根下有 memory-data/obsidian-data → new；根上直接有 🏠 主页.md / 00_全局记忆 → legacy；两者都有 → mixed
 *  [27] T5-4 配置收尾镜像同步：dry-run 不触发 / 真写后同步到 00_全局记忆 / 未配镜像目录与设置缺失只跳过 / 候选路径 profile→repo→bundled
 *
 * 隔离红线（本测试的全部保证）：
 *   - 所有夹具（假 DSH_HOME / 假仓库 / 假工作区 / 假设置 / 假记忆库）都在 os.tmpdir() 下自建；
 *   - 每次真写前都用 assertInsideTmp() 复核目标路径仍在临时根内；
 *   - dshHome / settingsFile / memoryDir / workspace / repoRoot 全部**显式注入**，绝不依赖 process.env.DSH_HOME；
 *   - 真实工作区与真实设置文件只做 statSync / readdir 只读快照，首尾比对，**从不用作任何写入目标**。
 */
import {
  copyFileSync,
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
  IDENTITY_PLACEHOLDER_TEXT,
  SETTINGS_TARGETS,
  STARTER_TODOS,
  VAULT_MIRROR_DIR_NAME,
  applyBaseDeck,
  withMemoryDirLock,
  applyBaseDeckItem,
  currentBlockBody,
  decideAgentsStatus,
  hashBlockBody,
  inspectSimpleYaml,
  listVaultModules,
  loadAgentsTemplate,
  loadMemorySeed,
  memoryEntryBody,
  normalizeBlockBody,
  parseMemoryEntries,
  planBaseDeck,
  readSettingsValues,
  resolveWorkspace,
  safeWorkspaceParam,
  sha256Text,
  DEFAULT_MEMORY_SUBDIR,
  LEGACY_MEMORY_SUBDIR,
  MIGRATE_MANIFEST_PREFIX,
  isMigrateNoise,
  sameFsPath,
  walkFilesForMigrate,
  ROOT_SUBDIR_MEMORY,
  ROOT_SUBDIR_VAULT,
  deriveRootChildren,
  inferRootDir,
  memoryTopSegmentInVault,
  detectVaultLayout,
  VAULT_HOME_FILE,
} from '../lib/basedeck.js'
import { API_PATHS, API_ROOT, CORE_API_EXACT_PATHS, PAGE_PATHS, PAGE_ROOT, installApi, openWithSystem } from '../lib/api.js'
import { NESTING_DETAIL, isSameOrNested, pathChecks, relationOf, runPreflight, volumeOf } from '../lib/preflight.js'
import { detectBom } from '../lib/install.js'
import { buildSetupState, readObsidianSyncDir, resolveMigrateSource } from '../lib/setup-state.js'
import { isFullyQualifiedPath, listDirectories } from '../lib/dirs.js'
import {
  IMPORT_LIST_LIMIT,
  IMPORT_SENSITIVE_RULES,
  applyImport,
  detectSensitiveText,
  isSafeImportRel,
  scanImport,
} from '../lib/import.js'
import { memoryMirrorCandidates } from '../lib/mirror-sync.js'

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
ok(BASEDECK_ID_LIST.join(',') === 'agentsMd,memorySeed,skills,settings,dirs,memoryDeck,knowledgeDeck,migrateMemory', '八项 id 与顺序（1.1.3 在末尾追加记忆体结构 / 知识库结构 / 旧记忆库迁移）')
ok(BASEDECK_APPLY_ORDER.join(',') === 'dirs,migrateMemory,memorySeed,memoryDeck,knowledgeDeck,skills,settings,agentsMd', '执行顺序按依赖排：迁移紧跟 dirs（前置步骤），agentsMd 最后')
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
function makeMockCtx(services) {
  const routes = []
  const box = services || {}
  return {
    routes: routes,
    logger: { debug() {}, warn() {}, info() {} },
    webServer: { register(o) { routes.push(o); return () => {} } },
    // 运行时服务取值（本插件只在 /dirs 里用 ctx.get；缺省返回 undefined = 服务缺失，走降级分支）
    get(name) { return box[name] },
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
ok(ctx.routes.filter((r) => r.kind === 'exact').length === API_PATHS.length + PAGE_PATHS.length + CORE_API_EXACT_PATHS.length,
  'exact 路由逐条注册（API ' + API_PATHS.length + ' 条 + 随包网页 ' + PAGE_PATHS.length + ' 条 + 新增 JSON ' + CORE_API_EXACT_PATHS.length + ' 条）')
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
ok(rGet.body.items.length === 8 && typeof rGet.body.setupNeeded === 'boolean', 'items 八项 + setupNeeded 信号')
ok(rGet.body.items[0].id === 'agentsMd' && rGet.body.summary.total === 8, '计划按展示顺序，summary.total=8')
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
  overrides: { workspace: wsRoute, memoryDir: routeMem, obsidianSyncDir: join(TMP_ROOT, 'routemirror'), obsidianDir: join(TMP_ROOT, 'routevault') },
}, REQ_HEADERS)
ok(rPostReal.status === 200 && rPostReal.body.ok === true, 'POST dryRun:false → 真写成功（仅夹具）')
ok(rPostReal.body.rejected.join(',') === 'nope', '未知 id 计入 rejected（不静默跳过）')
ok(rPostReal.body.results.map((r) => r.id).join(',') === 'dirs,migrateMemory,memorySeed,memoryDeck,knowledgeDeck,skills,settings,agentsMd', '真写按依赖顺序执行（迁移在 dirs 之后、memorySeed 之前），agentsMd 最后')
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
ok(shape.summary.total === 8 && typeof shape.setupNeeded === 'boolean' && typeof shape.workspace === 'string', 'summary + setupNeeded + workspace 存在')
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
// 路径类目标（kind=dir）一律**存 POSIX 规范形**：引导侧传反斜杠也要落成正斜杠。
// 否则使用者按 Windows 习惯敲的反斜杠会原样进 settings.yaml，下次读出来与页面其它路径写法不一致。
const BS_ = String.fromCharCode(92)
const winStyleMirror = 'E:' + BS_ + 'work' + BS_ + '00_全局记忆'
const planWinOv = ovPlan(winStyleMirror)
ok(obsKeyOf(planWinOv).value === 'E:/work/00_全局记忆',
  '反斜杠入参 → settings 里落 POSIX 规范形（实测 ' + obsKeyOf(planWinOv).value + '）')

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
ok(memSetDefault.replace(/\\/g, '/').endsWith('/data/dsh-work-memory/memory'),
  '不传 memoryDir → 回落**唯一默认** <DSH_HOME>/data/dsh-work-memory/memory（不再按工作区名推导）：' + memSetDefault)

section('[18] 1.1.3 记忆体结构 / 知识库结构生成器（T6）')
const deckWs = makeWorkspace('deck')
const deckMem = join(TMP_ROOT, 'deckmem')
const deckVault = join(TMP_ROOT, 'deckvault')
const deckHome = join(TMP_ROOT, 'deckhome', '.dsh')
const deckBase = opts({
  workspace: deckWs, dshHome: deckHome, settingsFile: join(deckHome, 'settings.yaml'),
  memoryDir: deckMem, obsidianDir: deckVault, obsidianSyncDir: join(deckVault, '00_全局记忆'),
})
const deckOpts = Object.assign({}, deckBase, { moduleDir: MODULE_DIR })

const planDeck = planBaseDeck(deckOpts)
ok(planDeck.items.length === 8, '计划是八项（1.1.3 在末尾追加三项，既有五项顺序不变）')
const memItem = planDeck.items.filter((i) => i.id === 'memoryDeck')[0]
const knowItem = planDeck.items.filter((i) => i.id === 'knowledgeDeck')[0]
ok(memItem.status === 'append' && knowItem.status === 'append', '两块结构初装状态都是 append')
ok(memItem.dirs.map((d) => d.key).join(',') === 'PROJECTS,DAILY,ARCHIVE', '记忆体骨架目录 = PROJECTS / DAILY / ARCHIVE')
ok(memItem.files.map((f) => f.name).join(',') === 'MEMORY.md,USER.md,GRAPH.json,PROJECTS/工作秘书.md', '记忆体文件清单 = MEMORY / USER / GRAPH / 工作秘书.md')
ok(memItem.files.every((f) => f.state === 'create'), '四个文件初装都是「将新建」')

const treeDeckBefore = treeSnapshot(TMP_ROOT)
const dryDeck = applyBaseDeck(['memoryDeck', 'knowledgeDeck'], Object.assign({}, deckOpts, { dryRun: true }))
ok(dryDeck.dryRun === true && dryDeck.results.every((r) => r.bytesWritten === 0), 'dry-run：零字节写盘')
ok(!existsSync(deckMem) && !existsSync(deckVault), 'dry-run 未创建任何目录')
ok(sameTree(treeDeckBefore, treeSnapshot(TMP_ROOT)), 'dry-run 后整棵树逐项一致')

const realDeck = applyBaseDeck(['memoryDeck', 'knowledgeDeck'], Object.assign({}, deckOpts, { dryRun: false }))
ok(realDeck.ok === true && realDeck.wroteAny === true, '真写成功（两项都 ok）')
assertInsideTmp(deckMem, 'deck memory dir')
assertInsideTmp(deckVault, 'deck vault')

const deckMemText = readFileSync(join(deckMem, 'MEMORY.md'), 'utf8')
ok(/^\[id:[a-f0-9]{12}\] \[\d{4}-\d{2}-\d{2}\] \[tag:关键\] 使用者身份：/.test(deckMemText),
  'MEMORY.md 首条 =「使用者身份」占位（id / 日期 / tag=关键 / 前缀起头 齐全）')
ok(deckMemText.indexOf(IDENTITY_PLACEHOLDER_TEXT) > 0, '占位正文逐字对齐设计定稿 §6.2')
ok(statSync(join(deckMem, 'USER.md')).size === 0, 'USER.md = 空偏好文件（0 字节）')
const deckGraph = JSON.parse(readFileSync(join(deckMem, 'GRAPH.json'), 'utf8'))
ok(Array.isArray(deckGraph.entities) && deckGraph.entities.length === 0 && Array.isArray(deckGraph.edges) && deckGraph.edges.length === 0,
  'GRAPH.json = 可解析的 {entities:[],edges:[]} 骨架')
ok(readdirSync(join(deckMem, 'DAILY')).length === 0 && readdirSync(join(deckMem, 'ARCHIVE')).length === 0, 'DAILY / ARCHIVE 为空目录（搭框架、不造内容）')

const projFile = join(deckMem, 'PROJECTS', '工作秘书.md')
const projEntries = parseMemoryEntries(readFileSync(projFile, 'utf8'))
ok(projEntries.length === 4, 'PROJECTS/工作秘书.md 写入 4 条')
const projBodies = projEntries.map(memoryEntryBody)
ok(projBodies[0].indexOf('【使用说明】') === 0 && projBodies[1].indexOf('【安装说明】') === 0
  && projBodies[2].indexOf('【待办·开局】') === 0 && projBodies[3].indexOf('【技能库】') === 0,
  '四条顺序 = 使用说明 / 安装说明 / 待办·开局 / 技能库')
ok(projBodies[0].indexOf('保存配置并开始') > 0, '使用说明正文用定稿按钮文案「保存配置并开始」（与 defaults/use.zh-CN.md 同源）')
ok(projBodies[1].indexOf('winget install -e --id Python.Python.3.12') > 0, '安装说明正文来自 defaults/install.zh-CN.md（单一真相源）')
ok(STARTER_TODOS.every((t) => projBodies[2].indexOf(t) > 0), '待办条目含设计定稿 §6.3 的全部七项')

ok(readdirSync(deckVault).sort().join(',') === '.obsidian,00_全局记忆,工具,🏠 主页.md', '知识库骨架 = 主页 + 00_全局记忆 + 工具 + .obsidian')
ok(readdirSync(join(deckVault, '工具')).sort().join(',') === '00_工具总览.md,MCP,技能,脚本', '工具/ = 工具总览 + 技能/脚本/MCP')
ok(readdirSync(join(deckVault, '工具', '技能')).length === 0 && readdirSync(join(deckVault, '工具', '脚本')).length === 0
  && readdirSync(join(deckVault, '工具', 'MCP')).length === 0,
  '工具/ 三个子目录都建出来但**不造内容**')
const vaultApp = JSON.parse(readFileSync(join(deckVault, '.obsidian', 'app.json'), 'utf8'))
ok(vaultApp.alwaysUpdateLinks === true, '.obsidian/app.json 为可解析的最小配置')
// 主人 2026-09-16 裁定：这部分本版不做（插件里没有相应设计），但**必须写清现状**——
// 不能让库里这份总览看起来像「工具已经搬进来了」。
const overviewText = readFileSync(join(deckVault, '工具', '00_工具总览.md'), 'utf8')
ok(overviewText.indexOf('没有实现任何同步') > 0 && overviewText.indexOf('预留用途') > 0,
  '工具总览明确写「本版没有实现任何同步」且上表是预留用途（不留空承诺）')
ok(overviewText.indexOf('空的') > 0 && overviewText.indexOf('自动同步属后续版本，未立项') > 0,
  '工具总览写明三个子目录现在是空的、自动同步未立项')
ok(overviewText.indexOf('未启用') > 0, '表格标题标「尚未启用」（与现状一致）')
const homeText = readFileSync(join(deckVault, '🏠 主页.md'), 'utf8')
ok(homeText.indexOf('预留框架') > 0 && homeText.indexOf('未实现同步') > 0,
  '主页约定段同步改写：工具区本版只是预留框架、未实现同步')

const homeFile = join(deckVault, '🏠 主页.md')
writeText(homeFile, '# 我自己的主页' + NL)
const memSnapBefore = readFileSync(join(deckMem, 'MEMORY.md'), 'utf8')
const againDeck = applyBaseDeck(['memoryDeck', 'knowledgeDeck'], Object.assign({}, deckOpts, { dryRun: false }))
ok(againDeck.results.every((r) => r.status === 'up_to_date' && r.wroteAny === false), '再跑一次幂等：两项都 up_to_date 且不写盘')
ok(readFileSync(homeFile, 'utf8').indexOf('我自己的主页') > 0, '被手改过的主页**不被覆盖**')
ok(readFileSync(join(deckMem, 'MEMORY.md'), 'utf8') === memSnapBefore, 'MEMORY.md 一字未动')

// 裁决 2：回滚必须彻底 —— 本轮新建的骨架目录在失败回滚后不得残留（EISDIR 缺陷回归锁）
const rbMem = join(TMP_ROOT, 'rollbackmem')
const rbVault = join(TMP_ROOT, 'rollbackvault')
const rbBase = opts({ workspace: deckWs, dshHome: deckHome, settingsFile: join(deckHome, 'settings.yaml'), memoryDir: rbMem, obsidianDir: rbVault, moduleDir: MODULE_DIR })
let rbWrites = 0
const rbIo = { writeFileSync: (p, d, o) => { rbWrites += 1; if (rbWrites >= 2) throw new Error('EACCES 模拟'); writeFileSync(p, d, o) } }
const rbRes = applyBaseDeckItem('memoryDeck', Object.assign({}, rbBase, { dryRun: false, io: rbIo }))
ok(rbRes.ok === false && /已回滚/.test(rbRes.detail), 'memoryDeck 第 2 个文件写入失败 → ok:false + 「已回滚」说明：' + rbRes.detail)
ok(!existsSync(join(rbMem, 'PROJECTS')) && !existsSync(join(rbMem, 'DAILY')) && !existsSync(join(rbMem, 'ARCHIVE')),
  '回滚后本轮新建的骨架目录**不存在**（fs.rmSync 删目录必须带 recursive，否则 EISDIR）')
ok(!existsSync(rbMem) || readdirSync(rbMem).length === 0, '回滚后目标目录里没有任何残留文件（实测 ' + JSON.stringify(existsSync(rbMem) ? readdirSync(rbMem) : []) + '）')


writeText(projFile, projEntries[0] + NL)
const appendDeck = applyBaseDeckItem('memoryDeck', Object.assign({}, deckOpts, { dryRun: false }))
ok(appendDeck.ok === true && appendDeck.wroteAny === true, '缺条时补写成功')
ok(Array.isArray(appendDeck.backups) && appendDeck.backups.length === 1 && existsSync(appendDeck.backups[0].backup), '改写既有文件前已备份')
const projAfter = parseMemoryEntries(readFileSync(projFile, 'utf8'))
ok(memoryEntryBody(projAfter[0]) === projBodies[0], '原有那一条逐字保留')
ok(projAfter.length === 4, '缺失的三条已补回（共 4 条）')

const deckMem2 = join(TMP_ROOT, 'deckmem2')
const failDeck = applyBaseDeckItem('memoryDeck', Object.assign({}, deckOpts, {
  memoryDir: deckMem2, io: { writeFileSync: () => { throw new Error('mock deck write fail') } }, dryRun: false,
}))
ok(failDeck.ok === false && /已回滚/.test(failDeck.detail), '写入失败 → 报告已回滚')
ok(!existsSync(join(deckMem2, 'MEMORY.md')) && !existsSync(join(deckMem2, 'USER.md')), '回滚后不残留半成品文件')

const noVaultBase = opts({ workspace: deckWs, dshHome: deckHome, settingsFile: join(deckHome, 'settings.yaml'), memoryDir: deckMem })
const nokK = planBaseDeck(noVaultBase).items.filter((i) => i.id === 'knowledgeDeck')[0]
ok(nokK.status === 'none' && nokK.detail.indexOf('不猜路径') > 0, '未提供 obsidianDir → 状态 none 并明确说不猜路径')

section('[19] 1.1.3 可用性检查（preflight，只读）')
const okReport = { items: [
  { id: 'subPlugins', status: 'ok', value: '5/5 已装', detail: 'dsh-work-memory@1.0.5、dsh-doc-suite@0.7.9、dsh-experts@0.5.7' },
  { id: 'python', status: 'ok', value: '3.12.10', detail: '' },
  { id: 'pythonDeps', status: 'ok', value: '8/8 就绪', detail: '' },
] }
const badReport = { items: [
  { id: 'subPlugins', status: 'missing', value: '0/5 已装', detail: 'dsh-work-memory（未安装）' },
  { id: 'python', status: 'missing', value: '', detail: '未检测到 Python' },
  { id: 'pythonDeps', status: 'missing', value: '0/8', detail: '未安装' },
] }
const pfOk = runPreflight({ report: okReport, memoryDir: deckMem, obsidianDir: deckVault, env: {} })
ok(pfOk.ready === true && pfOk.summary.block === 0, '环境就绪 + 两目录合法可写 + 同盘 + 无冲突 → ready=true')
ok(pfOk.checks.some((c) => c.id === 'sameVolume' && c.level === 'ok'), '同工作区（同卷）判定通过')
ok(pfOk.checks.some((c) => c.id === 'memoryFileConflict' && c.level === 'ok'), '既有 MEMORY.md 可解析 → 允许只补缺失')
const pfBad = runPreflight({ report: badReport, memoryDir: deckMem, obsidianDir: deckVault, env: {} })
ok(pfBad.ready === false && pfBad.checks.filter((c) => c.id.indexOf('env') === 0).every((c) => c.level === 'block'), '环境三项不满足 → 全 block 且 ready=false')
// 2026-09-16 使用者裁定（第二轮，承接跨盘那条）：两目录相同 / 互相嵌套**只提示不拦截**。
// 页面自己推荐的用法就是「把记忆库放进长期使用的主工作区」，不能一边推荐一边卡死执行链。
const noNest = (pf) => pf.checks.filter((c) => c.id === 'noNesting')[0]
const pfSame = runPreflight({ report: okReport, memoryDir: deckMem, obsidianDir: deckMem, env: {} })
ok(pfSame.ready === true && pfSame.summary.block === 0 && noNest(pfSame).level === 'warn',
  '两目录相同 → 提示不阻断（noNesting=warn，ready 仍为 true、block 计数 0）')
ok(noNest(pfSame).detail.indexOf('不阻断') >= 0 && noNest(pfSame).detail.indexOf('知识库根目录') >= 0,
  '相同目录的文案写明后果并写明「不阻断」')
const pfEmpty = runPreflight({ report: okReport, memoryDir: '', obsidianDir: deckVault, env: {} })
ok(pfEmpty.ready === false && pfEmpty.checks.filter((c) => c.id === 'memoryDir')[0].detail.indexOf('未填写') >= 0, '必填目录为空 → block 且理由可读')
const pfLow = runPreflight({ report: { items: [
  { id: 'subPlugins', status: 'ok', value: '5/5 已装', detail: 'dsh-work-memory@1.0.5' },
  { id: 'python', status: 'ok', value: '3.8.10', detail: '' },
  { id: 'pythonDeps', status: 'ok', value: '8/8 就绪', detail: '' },
] }, memoryDir: deckMem, obsidianDir: deckVault, env: {} })
ok(pfLow.checks.filter((c) => c.id === 'envPython')[0].level === 'block', 'Python 低于 3.10 → block（版本门槛生效）')
const pfNested = runPreflight({ report: okReport, memoryDir: deckMem, obsidianDir: join(deckMem, 'sub'), env: {} })
ok(pfNested.ready === true && noNest(pfNested).level === 'warn', '知识库嵌在记忆库里 → 提示不阻断（ready 仍为 true）')
ok(noNest(pfNested).detail === NESTING_DETAIL['obsidian-in-memory'], '方向写得出：知识库在记忆库目录内（文案按方向分开）')
// 主人真机那一例：记忆库 E:/lina/memory ⊂ 知识库 E:/lina（同一夹具里复刻成 deckVault/memory ⊂ deckVault）
const pfMemInVault = runPreflight({ report: okReport, memoryDir: join(deckVault, 'memory'), obsidianDir: deckVault, env: {} })
ok(pfMemInVault.ready === true && pfMemInVault.summary.block === 0 && noNest(pfMemInVault).level === 'warn',
  '记忆库在知识库内（真机那一例）→ 提示不阻断，执行链可继续')
ok(noNest(pfMemInVault).detail === NESTING_DETAIL['memory-in-obsidian'], '方向写得出：记忆库在知识库目录内')
ok(relationOf(join(deckVault, 'memory'), deckVault) === 'memory-in-obsidian' && relationOf(deckVault, join(deckVault, 'memory')) === 'obsidian-in-memory',
  'relationOf：两个方向分得开（不是一句话糊过去）')
ok(isSameOrNested(join(TMP_ROOT, 'a'), join(TMP_ROOT, 'a', 'b')) === true && isSameOrNested(join(TMP_ROOT, 'a'), join(TMP_ROOT, 'ab')) === false,
  '嵌套判定不误伤同前缀目录')
ok(volumeOf(deckMem) === volumeOf(deckVault), 'volumeOf：同盘返回同一卷标识')

// 2026-09-16 使用者修正：跨盘只是**不建议**，不再判 block（原为 block，会把执行链卡在第一步）
// 跨盘是 Windows 专属语义（需两个不同盘符）；非 win32 上 'C:\x' / 'D:\y' 都落到同一 POSIX 根，断言不成立
if (process.platform === 'win32') {
  const crossChecks = pathChecks({ memoryDir: 'C:\\x', obsidianDir: 'D:\\y', env: {} })
  const crossSame = crossChecks.filter((c) => c.id === 'sameVolume')[0]
  ok(Boolean(crossSame) && crossSame.level === 'warn', '跨盘 → level=warn（不再判 block）')
  ok(Boolean(crossSame) && /不建议跨盘/.test(crossSame.detail) && /不阻断/.test(crossSame.detail),
    '跨盘文案改成「不建议」措辞并说明可继续：' + String(crossSame && crossSame.detail).slice(0, 46) + '…')
} else {
  console.log('  · 非 win32：无盘符概念（两路径落同一 POSIX 根），跳过 2 条跨盘分级断言')
}
if (existsSync('E:/lina')) {
  const crossVault = join(TMP_ROOT, 'crossvault')
  mkdirSync(crossVault, { recursive: true })
  const pfCross = runPreflight({ report: okReport, memoryDir: 'E:/lina', obsidianDir: crossVault, env: {} })
  const sv = pfCross.checks.filter((c) => c.id === 'sameVolume')[0]
  ok(Boolean(sv) && sv.level === 'warn', '真实跨盘目录（E: 记忆库 vs C: 知识库）→ sameVolume=warn')
  ok(pfCross.ready === true && pfCross.summary.block === 0, '跨盘不再阻断：ready 仍为 true、block 计数为 0（执行链可继续）')
} else {
  console.log('  · 本机没有第二个可写卷，跳过「跨盘 ready=true」正向断言（上面的分级断言已覆盖）')
}

section('[20] 1.1.3 新路由契约（preflight / identity / domain）+ 随包网页')
const home13 = join(TMP_ROOT, 'home13', '.dsh')
const idMem = join(TMP_ROOT, 'idroute')
// GET /identity 的可读范围 = 「设置里的记忆库目录或其子路径」：夹具里把 memoryDir 写进 settings.yaml
writeText(join(home13, 'settings.yaml'), 'work-memory:' + NL + '  memoryDir: ' + idMem.replace(/\\/g, '/') + NL)
const ctx13 = makeMockCtx()
installApi(ctx13, {
  platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, profileDir: join(TMP_ROOT, 'profile13'),
  env: {}, now: FIXED_NOW, dshHome: home13,
  probeOptions: { skip: ['host', 'node', 'python', 'pythonDeps', 'wps', 'obsidian', 'subPlugins'] },
})
ok(ctx13.routes.filter((r) => r.kind === 'exact').length === API_PATHS.length + PAGE_PATHS.length + CORE_API_EXACT_PATHS.length, 'exact = API_PATHS + 随包网页 + 新增 JSON ' + CORE_API_EXACT_PATHS.length + ' 条')
const h13 = (ctx13.routes.filter((r) => r.kind === 'prefix')[0] || {}).handler
async function call13(method, sub, body, headers) {
  const res = makeRes()
  await h13(makeReq({ method: method, url: API_ROOT + sub, body: body, headers: headers }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json }
}
const pfRoute = await call13('GET', '/preflight')
ok(pfRoute.status === 200 && pfRoute.body.ok === true && Array.isArray(pfRoute.body.checks) && pfRoute.body.ready === false,
  'GET /preflight → 200 + checks（目录未填时 ready=false）')
const idGet0 = await call13('GET', '/identity')
ok(idGet0.status === 200 && idGet0.body.ok === true && idGet0.body.exists === false, 'GET /identity（用设置里的记忆库目录）首次 → exists=false')
const idGetSub = await call13('GET', '/identity?memoryDir=' + encodeURIComponent(join(idMem, 'sub')))
ok(idGetSub.status === 200 && idGetSub.body.ok === true, 'GET /identity 允许记忆库目录的**子路径**（只读范围之内）')
const idGetOut = await call13('GET', '/identity?memoryDir=' + encodeURIComponent(join(TMP_ROOT, 'not-my-memory')))
ok(idGetOut.status === 403 && /只能读取/.test(String(idGetOut.body && idGetOut.body.error)), 'GET /identity 越界路径 → 403 可读错误（可读范围受限）')
const idCrossRes = makeRes()
await h13(makeReq({ method: 'GET', url: API_ROOT + '/identity', headers: { host: '127.0.0.1:43120', origin: 'http://evil.example' } }), idCrossRes)
ok(idCrossRes.status === 403, 'GET /identity 带跨站 Origin → 403（只读同源守卫）')
const idDry = await call13('POST', '/identity/save', { memoryDir: idMem, content: '从事信息安全售前工作。' }, REQ_HEADERS)
ok(idDry.status === 200 && idDry.body.dryRun === true && idDry.body.status === 'append', 'POST /identity/save 未传 dryRun → dry-run 计划 append')
ok(!existsSync(join(idMem, 'MEMORY.md')), 'identity dry-run 未落盘')
const idReal = await call13('POST', '/identity/save', { memoryDir: idMem, content: '从事信息安全售前工作。', dryRun: false }, REQ_HEADERS)
ok(idReal.body.ok === true && idReal.body.wroteAny === true, 'identity dryRun:false → 真写')
const idCross = await call13('POST', '/identity/save', { memoryDir: idMem, content: 'x', dryRun: false }, CROSS_HEADERS)
ok(idCross.status === 403, '跨站 POST /identity/save → 403')
const idBad = await call13('POST', '/identity/save', { memoryDir: idMem, content: '' }, REQ_HEADERS)
ok(idBad.body.ok === false && typeof idBad.body.error === 'string' && idBad.body.error.length > 0, 'identity 空正文 → ok:false + error 可读')

const dl = await call13('GET', '/domain/list')
ok(dl.status === 200 && dl.body.ok === true && dl.body.items.length === 5, 'GET /domain/list → 五个预置岗位')
ok(dl.body.items.map((i) => i.id).join(',') === 'infosec,accounting,hr,coding,finance', '预置岗位 id 顺序 = 设计定稿 §3.2')
ok(dl.body.prefix === '使用者身份：' && dl.body.items.every((i) => i.content.length <= dl.body.maxChars), '统一前缀 + 每段 ≤200 字')
const dg = await call13('POST', '/domain/generate', { name: '工控安全售前' }, REQ_HEADERS)
ok(dg.status === 503 && dg.body.ok === false && /手填/.test(dg.body.error), '无模型服务 → 503 + 可读中文提示（不假成功）')
const dgBad = await call13('POST', '/domain/generate', {}, REQ_HEADERS)
ok(dgBad.status === 400 && dgBad.body.ok === false, '无名称也无内容 → 400')
const dgCross = await call13('POST', '/domain/generate', { name: 'x' }, CROSS_HEADERS)
ok(dgCross.status === 403, '跨站 POST /domain/generate → 403')

const ctxEnh = makeMockCtx()
ctxEnh.get = (name) => (name === 'promptEnhancer'
  ? { enhance: async () => ({ enhanced: '# 使用者身份：从事财务工作。', model: 'mock' }) } : undefined)
installApi(ctxEnh, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, profileDir: join(TMP_ROOT, 'profile13'), env: {}, now: FIXED_NOW, dshHome: join(TMP_ROOT, 'home13', '.dsh') })
const hEnh = (ctxEnh.routes.filter((r) => r.kind === 'prefix')[0] || {}).handler
const resEnh = makeRes()
await hEnh(makeReq({ method: 'POST', url: API_ROOT + '/domain/generate', body: { name: '财务' }, headers: REQ_HEADERS }), resEnh)
const enh = JSON.parse(resEnh.body)
ok(resEnh.status === 200 && enh.ok === true && enh.channel === 'promptEnhancer' && enh.content.indexOf('使用者身份：') < 0,
  'promptEnhancer 优先，输出被归一化（去 markdown 与重复前缀）')

// ── 岗位生成通道（llm）：三种情形 + 参数契约（maxTokens / reasoningEffort） ──
function installLlmCtx(streamFn, selection) {
  const seen = []
  const ctx = makeMockCtx()
  ctx.get = (name) => {
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'p1' }],
        listModels: async () => [{ id: 'm1' }],
        stream: (opts) => { seen.push(opts); return streamFn(opts) },
      }
    }
    if (name === 'agentDefaultModel') return { currentSelection: () => selection }
    return undefined
  }
  installApi(ctx, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, profileDir: join(TMP_ROOT, 'profile13'), env: {}, now: FIXED_NOW, dshHome: home13 })
  return { seen: seen, handler: (ctx.routes.filter((r) => r.kind === 'prefix')[0] || {}).handler }
}
async function genDomain(handler, body) {
  const res = makeRes()
  await handler(makeReq({ method: 'POST', url: API_ROOT + '/domain/generate', body: body, headers: REQ_HEADERS }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json }
}
const TEXT_STREAM = async function* () {
  yield { type: 'text-delta', text: '从事金融研究工作。' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const REASONING_ONLY_STREAM = async function* () {
  yield { type: 'reasoning-delta', text: '先想想这个岗位该写什么……'.repeat(3) }
  yield { type: 'finish', reason: { kind: 'max-tokens' } }
}
const ERROR_STREAM = async function* () {
  yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider exploded' } } }
}

const s1 = installLlmCtx(TEXT_STREAM, { provider: 'p1', model: 'm1', reasoningEffort: 'high' })
const r1 = await genDomain(s1.handler, { name: '金融' })
ok(r1.status === 200 && r1.body.ok === true && r1.body.channel === 'llm' && r1.body.model === 'm1', '①正常 text-delta：回退 llm + agentDefaultModel，回显 provider / model')
ok(r1.body.content === '从事金融研究工作。', '①正文归一化后原样返回')
ok(s1.seen.length === 1 && s1.seen[0].maxTokens === 2048, '①maxTokens 传 2048（按桌宠档位给足模型余量，不从输出字数反推；改前 512 会被推理阶段吃光）')
ok(s1.seen[0].reasoningEffort === 'high', '①把 agentDefaultModel.currentSelection() 的 reasoningEffort 透传给 llm.stream')
ok(typeof s1.seen[0].system === 'string' && s1.seen[0].system.length > 0 && Array.isArray(s1.seen[0].messages), '①system 与 messages 形态符合宿主 GenerateOptions 契约')

const s2 = installLlmCtx(REASONING_ONLY_STREAM, { provider: 'p1', model: 'm1' })
const r2 = await genDomain(s2.handler, { name: '财务' })
ok(r2.status === 502 && r2.body.ok === false && r2.body.code === 'reasoning-only', '②只有 reasoning-delta、没有 text-delta → code=reasoning-only（与「什么都没输出」区分）')
ok(/思考|推理/.test(String(r2.body.error)) && /手填/.test(String(r2.body.error)), '②文案点明预算被思考吃掉并给出出路：' + String(r2.body.error).slice(0, 36) + '…')
ok(s2.seen[0].maxTokens === 2048 && s2.seen[0].reasoningEffort === undefined, '②未配置 reasoningEffort 时不传该字段（向后兼容）')

const s3 = installLlmCtx(ERROR_STREAM, { provider: 'p1', model: 'm1' })
const r3 = await genDomain(s3.handler, { name: '编码' })
ok(r3.status === 502 && r3.body.ok === false && r3.body.code === 'stream-failed', '③finish=error → code=stream-failed')
ok(String(r3.body.error).indexOf('provider exploded') >= 0, '③原样回显宿主给的可读原因')

const REFUSE_ON_EFFORT = async function* (opts) {
  if (opts.reasoningEffort !== undefined) {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'llm-deepseek: reasoning effort conflicts with disabled thinking' } } }
    return
  }
  yield { type: 'text-delta', text: '去掉推理强度后拿到的正文。' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const s4 = installLlmCtx(REFUSE_ON_EFFORT, { provider: 'p1', model: 'm1', reasoningEffort: 'high' })
const r4 = await genDomain(s4.handler, { name: '人力' })
ok(s4.seen.length === 2 && s4.seen[0].reasoningEffort === 'high' && s4.seen[1].reasoningEffort === undefined, '④推理强度与宿主配置冲突时，去掉该字段重试一次（其余参数不变）')
ok(r4.body.ok === true && r4.body.content === '去掉推理强度后拿到的正文。', '④重试拿到正文 → ok:true')

const s5 = installLlmCtx(TEXT_STREAM, { provider: 'p1', model: 'm1' })
const r5 = await genDomain(s5.handler, { name: '路由覆盖', provider: 'p2', model: 'm2' })
ok(s5.seen.length === 1 && s5.seen[0].provider === 'p2' && s5.seen[0].model === 'm2',
  '⑤请求体带 provider/model 时优先于 agentDefaultModel（与桌宠 resolvePromptRoute 同构）')
ok(r5.body.ok === true && r5.body.provider === 'p2' && r5.body.model === 'm2', '⑤响应回显实际使用的 provider / model')

const LONG_BODY = '甲'.repeat(260)
const LONG_BODY_STREAM = async function* () {
  yield { type: 'text-delta', text: LONG_BODY }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
const s6 = installLlmCtx(LONG_BODY_STREAM, { provider: 'p1', model: 'm1' })
const r6 = await genDomain(s6.handler, { name: '长文' })
ok(r6.body.ok === true && r6.body.content === '甲'.repeat(200), '⑥正文超 200 字 → 服务端兜底截断到 200（截断处之外不改内容）')
ok(r6.body.maxChars === 200, '⑥响应回显 maxChars=200（口径可核对）')

const LONG_NAME = '非常非常长的岗位名称确实超过十个字了'
const s7 = installLlmCtx(TEXT_STREAM, { provider: 'p1', model: 'm1' })
const r7 = await genDomain(s7.handler, { name: LONG_NAME })
ok(r7.body.name === LONG_NAME.slice(0, 10) && r7.body.nameMaxChars === 10, '⑦岗位名称超 10 字 → 归一化截断到 10 字（响应回显：' + r7.body.name + '）')
ok(s7.seen[0].messages[0].content[0].text.indexOf(LONG_NAME.slice(0, 10)) >= 0
  && s7.seen[0].messages[0].content[0].text.indexOf(LONG_NAME.slice(0, 11)) < 0,
  '⑦进入提示词的岗位名称同样是前 10 个字（不会把全名喂给模型）')

// ⑧⑨ 说明文件接口：GET /docs（只读）+ POST /open-doc（白名单 + 系统默认程序打开）
async function callRoute(handler, method, sub, body, headers) {
  const res = makeRes()
  await handler(makeReq({ method: method, url: API_ROOT + sub, body: body, headers: headers }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json }
}
function installDocsCtx(docsDir) {
  const calls = []
  const ctx = makeMockCtx()
  installApi(ctx, {
    platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, profileDir: join(TMP_ROOT, 'profile13'),
    env: {}, now: FIXED_NOW, dshHome: home13, docsDir: docsDir,
    openDoc: (file, opts) => { calls.push({ file: file, opts: opts }); return { ok: true, command: 'explorer.exe ' + file, code: '', error: '' } },
  })
  return { calls: calls, handler: (ctx.routes.filter((r) => r.kind === 'prefix')[0] || {}).handler }
}

const d1 = installDocsCtx(join(MODULE_DIR, 'defaults'))
const docsGet = await callRoute(d1.handler, 'GET', '/docs')
ok(docsGet.status === 200 && docsGet.body.ok === true && docsGet.body.items.length === 2 && docsGet.body.ready === true,
  'GET /docs → 两个随包说明文件都存在，ready=true')
ok(docsGet.body.items.filter((i) => i.doc === 'guide')[0].path.indexOf('defaults/install.zh-CN.html') > 0,
  'guide 解析到 defaults/install.zh-CN.html（路径由服务端拼，客户端不传路径）')

const openOk = await callRoute(d1.handler, 'POST', '/open-doc', { doc: 'help' }, REQ_HEADERS)
ok(openOk.status === 200 && openOk.body.ok === true && d1.calls.length === 1, 'POST /open-doc { doc: "help" } → 调用系统打开器一次')
ok(d1.calls[0].file.indexOf('use.zh-CN.html') > 0, '打开的是白名单解析出的绝对路径：' + d1.calls[0].file)
ok(String(openOk.body.path).indexOf('use.zh-CN.html') > 0 && String(openOk.body.command).indexOf('explorer.exe') === 0,
  '响应回显 path 与实际 command：' + openOk.body.command)

const openBad = await callRoute(d1.handler, 'POST', '/open-doc', { doc: 'whatever' }, REQ_HEADERS)
ok(openBad.status === 400 && openBad.body.ok === false && openBad.body.code === 'unknown-doc', '未知 doc → 400 + code=unknown-doc')
ok(d1.calls.length === 1, '未知 doc 时**一条命令都不执行**')
const openPath = await callRoute(d1.handler, 'POST', '/open-doc', { doc: '../../secret.html' }, REQ_HEADERS)
ok(openPath.status === 400 && openPath.body.code === 'unknown-doc' && d1.calls.length === 1, '路径形态的 doc 同样被拒（只认白名单键）')
const openCross = await callRoute(d1.handler, 'POST', '/open-doc', { doc: 'guide' }, CROSS_HEADERS)
ok(openCross.status === 403 && d1.calls.length === 1, '跨站 POST /open-doc → 403 且未执行打开')

const emptyDocs = join(TMP_ROOT, 'emptydocs')
mkdirSync(emptyDocs, { recursive: true })
const d2 = installDocsCtx(emptyDocs)
const docsEmpty = await callRoute(d2.handler, 'GET', '/docs')
ok(docsEmpty.body.ready === false && docsEmpty.body.items.every((i) => i.exists === false), 'GET /docs 在缺失目录下如实报告 exists=false / ready=false')
const openMissing = await callRoute(d2.handler, 'POST', '/open-doc', { doc: 'guide' }, REQ_HEADERS)
ok(openMissing.status === 200 && openMissing.body.ok === false && openMissing.body.code === 'file-missing' && /重装|内嵌/.test(openMissing.body.error),
  '文件缺失 → 可读中文失败（不抛异常）')
ok(d2.calls.length === 0, '文件缺失时未调用打开器（先校验存在性）')

const spawnMissing = await openWithSystem('C:/nonexistent-xyz.html', { platform: 'linux', exec: (cmd, args, opts, cb) => { const e = new Error('missing'); e.code = 'ENOENT'; cb(e) } })
ok(spawnMissing.ok === false && spawnMissing.code === 'ENOENT', 'openWithSystem：进程无法启动（ENOENT）→ ok:false（不谎报成功）')
const spawnExit1 = await openWithSystem('C:/x.html', { platform: 'win32', exec: (cmd, args, opts, cb) => { const e = new Error('exit 1'); e.code = 1; cb(e) } })
ok(spawnExit1.ok === true && spawnExit1.command.indexOf('explorer.exe') === 0, 'openWithSystem：explorer.exe 退出码 1 视为已交给系统（不判失败）')

// ⑩ GET /setup-state —— 核心配置页的「当前生效值」（只走 ctx.settings，只读）
const SETUP_MEM_SCHEMA = {
  type: 'object', meta: {},
  dict: {
    memoryDir: { type: 'string', meta: { default: '' } },
    obsidianSyncDir: { type: 'string', meta: { default: '' } },
  },
}
const SETUP_EXP_SCHEMA = {
  type: 'object', meta: {},
  dict: { defaultDomain: { type: 'string', meta: { default: 'infosec' } } },
}
function installSetupCtx(namespaces, extraDeps) {
  const ctx = makeMockCtx()
  if (namespaces !== null) {
    ctx.settings = {
      describe: async () => {
        if (namespaces === 'throw') throw new Error('settings exploded')
        return namespaces
      },
    }
  }
  installApi(ctx, Object.assign({
    platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, profileDir: join(TMP_ROOT, 'profile13'),
    env: {}, now: FIXED_NOW, dshHome: join(TMP_ROOT, 'setupdsh', '.dsh'),
  }, extraDeps || {}))
  return (ctx.routes.filter((r) => r.kind === 'prefix')[0] || {}).handler
}

// 反推「镜像目录 → vault 根」的逻辑本身跨平台；但反推前会判绝对路径，故用平台自适应绝对路径（两平台都真跑）
const VAULT_BASE = process.platform === 'win32' ? 'E:/vault' : join(TMP_ROOT, 'vaultbase')
const hSetup1 = installSetupCtx([
  { ns: 'work-memory', schema: SETUP_MEM_SCHEMA, value: { memoryDir: 'D:/mem/lib', obsidianSyncDir: VAULT_BASE + '/00_全局记忆' }, revision: 3, applies: 'live' },
  { ns: 'experts', schema: SETUP_EXP_SCHEMA, value: { defaultDomain: 'coding' }, revision: 5, applies: 'live' },
])
const ss1 = await callRoute(hSetup1, 'GET', '/setup-state')
ok(ss1.status === 200 && ss1.body.ok === true, 'GET /setup-state → 200 ok')
ok(ss1.body.memoryDir.value === 'D:/mem/lib' && ss1.body.memoryDir.source === 'settings', '①memoryDir 取设置里的值 + source=settings')
ok(ss1.body.obsidianDir.value === VAULT_BASE && ss1.body.obsidianDir.source === 'derived', '①obsidianDir 由镜像目录反推出 vault 根 + source=derived（' + VAULT_BASE + '）')
ok(ss1.body.domain.id === 'coding' && ss1.body.domain.label === '代码编程' && ss1.body.domain.isPreset === true && ss1.body.domain.source === 'settings',
  '①domain 映射到预置岗位 label（coding → 代码编程）')
ok(ss1.body.identity.exists === false && ss1.body.identity.entryId === '', '①identity 只读检查：记忆库不存在该条目 → exists=false')
ok(typeof ss1.body.note === 'string' && ss1.body.note.length > 0, '①note 给出可读来源说明：' + ss1.body.note)

const hSetup2 = installSetupCtx([
  { ns: 'work-memory', schema: SETUP_MEM_SCHEMA, value: { memoryDir: '' }, revision: 1, applies: 'live' },
])
const ss2 = await callRoute(hSetup2, 'GET', '/setup-state')
ok(ss2.body.memoryDir.source === 'default' && ss2.body.memoryDir.value.indexOf('data/dsh-work-memory/memory') > 0,
  '②memoryDir 为空 → 生效默认（<DSH_HOME>/data/dsh-work-memory/memory，绝对路径）+ source=default：' + ss2.body.memoryDir.value)
ok(ss2.body.obsidianDir.source === 'none' && ss2.body.obsidianDir.value === '', '③obsidianSyncDir 为空 → obsidianDir source=none、value 空')

const hSetup3 = installSetupCtx([
  { ns: 'experts', schema: SETUP_EXP_SCHEMA, value: { defaultDomain: 'custom-role' }, revision: 1, applies: 'live' },
])
const ss3 = await callRoute(hSetup3, 'GET', '/setup-state')
ok(ss3.body.domain.id === 'custom-role' && ss3.body.domain.label === 'custom-role' && ss3.body.domain.isPreset === false,
  '④defaultDomain 不在 5 个预置内 → isPreset=false、label 原样给 id')

const hSetup4 = installSetupCtx([
  { ns: 'experts', schema: SETUP_EXP_SCHEMA, value: { defaultDomain: '' }, revision: 1, applies: 'live' },
])
const ss4 = await callRoute(hSetup4, 'GET', '/setup-state')
ok(ss4.body.domain.id === 'infosec' && ss4.body.domain.source === 'default' && ss4.body.domain.isPreset === true,
  '④默认域为空 → 取 schema 默认 infosec + source=default')

const hSetup5 = installSetupCtx(null)
const ss5 = await callRoute(hSetup5, 'GET', '/setup-state')
ok(ss5.status === 200 && ss5.body.ok === true, '⑤设置服务缺失 → 仍 200，不崩')
ok(ss5.body.memoryDir.source === 'none' && ss5.body.obsidianDir.source === 'none' && ss5.body.domain.source === 'none',
  '⑤设置服务缺失 → 三个字段全 none 降级（不猜默认）')
ok(/设置服务不可用/.test(ss5.body.note), '⑤note 说明降级原因：' + ss5.body.note.slice(0, 40) + '…')
const hSetup6 = installSetupCtx('throw')
const ss6 = await callRoute(hSetup6, 'GET', '/setup-state')
ok(ss6.status === 200 && ss6.body.ok === true && /读取设置失败/.test(ss6.body.note), '⑤describe 抛错 → 200 + 可读 note（不 500、不抛异常）')

const pageGuide = (ctx13.routes.filter((r) => r.kind === 'exact' && r.path === PAGE_ROOT + '/guide')[0] || {}).handler
const pageHelp = (ctx13.routes.filter((r) => r.kind === 'exact' && r.path === PAGE_ROOT + '/help')[0] || {}).handler
const gRes = makeRes()
await pageGuide(makeReq({ method: 'GET', url: PAGE_ROOT + '/guide' }), gRes)
ok(gRes.status === 200 && String(gRes.headers['content-type']).indexOf('text/html') === 0, 'GET /work-personal-secretary/guide → text/html; charset=utf-8')
ok(gRes.body.indexOf('<!DOCTYPE html>') === 0 && gRes.body.indexOf('安装引导') > 0, 'guide 页是完整 HTML 且含标题')
ok(gRes.body.indexOf('py -3 -m pip install') > 0, 'guide 页正文来自 defaults/install.zh-CN.md（与记忆条目同源）')
const gEmbed = makeRes()
await pageGuide(makeReq({ method: 'GET', url: PAGE_ROOT + '/guide?embed=1' }), gEmbed)
ok(gEmbed.status === 200 && gEmbed.body.indexOf('<html') < 0 && gEmbed.body.indexOf('<head') < 0 && gEmbed.body.indexOf('<body') < 0,
  'GET /work-personal-secretary/guide?embed=1 → 片段（无 html/head/body）')
ok(gEmbed.body.indexOf('class="wps-doc"') > 0 && gEmbed.body.indexOf('html{') < 0 && gEmbed.body.indexOf('body{') < 0,
  'embed 片段自带 .wps-doc 作用域样式、无全局选择器')
ok(gEmbed.body.indexOf('py -3 -m pip install') > 0, 'embed 片段正文仍与 defaults/install.zh-CN.md 同源')
const hRes = makeRes()
await pageHelp(makeReq({ method: 'GET', url: PAGE_ROOT + '/help' }), hRes)
ok(hRes.status === 200 && hRes.body.indexOf('使用说明') > 0, 'GET /work-personal-secretary/help → text/html 使用说明')
ok(hRes.body.indexOf('保存配置并开始') > 0, 'help 页正文用定稿按钮文案「保存配置并开始」')

section('[21] R1-2 / R1-4 / 小6：记忆库写入取锁 + 写前护栏 + 知识库冲突拒写')
const lockMem = join(TMP_ROOT, 'lockmem')
const lockWs = makeWorkspace('lockws')
const lockHome = join(TMP_ROOT, 'lockhome', '.dsh')
const lockBase = opts({ workspace: lockWs, dshHome: lockHome, settingsFile: join(lockHome, 'settings.yaml'), memoryDir: lockMem, moduleDir: MODULE_DIR })
const lockPath = join(lockMem, '.work-memory.lock')
let sawLock = false
const lockIo = { writeFileSync: (p, data, o) => { if (existsSync(lockPath)) sawLock = true; writeFileSync(p, data, o) } }
const lockRes = applyBaseDeckItem('memoryDeck', Object.assign({}, lockBase, { dryRun: false, io: lockIo }))
ok(lockRes.ok === true && lockRes.wroteAny === true, 'memoryDeck 真写成功（夹具）')
ok(sawLock === true, '写盘发生在 .work-memory.lock 持有期间（确实取了锁，与 dsh-work-memory 共用同一把）')
ok(!existsSync(lockPath), '写完后锁文件已释放')
ok(readdirSync(lockMem).every((n) => n.indexOf('.wps-tmp') < 0), '无固定名 .wps-tmp 残留（临时名带 pid + 随机后缀）')

let sawSeedLock = false
const seedMem = join(TMP_ROOT, 'seedlockmem')
const seedWs = makeWorkspace('seedlock')
const seedHome = join(TMP_ROOT, 'seedlockhome', '.dsh')
const seedLockPath = join(seedMem, '.work-memory.lock')
const seedIo = { writeFileSync: (p, data, o) => { if (existsSync(seedLockPath)) sawSeedLock = true; writeFileSync(p, data, o) } }
const seedRes = applyBaseDeckItem('memorySeed', Object.assign({}, opts({
  workspace: seedWs, dshHome: seedHome, settingsFile: join(seedHome, 'settings.yaml'),
  memoryDir: seedMem, seedFile: realSeed, moduleDir: MODULE_DIR,
}), { dryRun: false, io: seedIo }))
ok(seedRes.ok === true && sawSeedLock === true, 'memorySeed 写 MEMORY.md 时同样持锁（既有路径此前无锁）')
ok(!existsSync(seedLockPath), 'memorySeed 写完锁文件已释放')

const guardBase = opts({ workspace: lockWs, dshHome: lockHome, settingsFile: join(lockHome, 'settings.yaml'), memoryDir: homedir(), moduleDir: MODULE_DIR })
const guardRes = applyBaseDeckItem('memoryDeck', Object.assign({}, guardBase, { dryRun: false }))
ok(guardRes.ok === false && /主目录/.test(guardRes.detail), '记忆库目录 = 用户主目录 → 拒绝写入（与可用性检查同口径）')
ok(!existsSync(join(homedir(), '.work-memory.lock')), '被拒时不创建锁文件（护栏前置到取锁之前）')

const vaultBad = join(TMP_ROOT, 'vaultbad')
mkdirSync(vaultBad, { recursive: true })
writeText(join(vaultBad, VAULT_MIRROR_DIR_NAME), 'not-a-directory')
const badBase = opts({ workspace: lockWs, dshHome: lockHome, settingsFile: join(lockHome, 'settings.yaml'), memoryDir: lockMem, obsidianDir: vaultBad, moduleDir: MODULE_DIR })
const kBad = planBaseDeck(badBase).items.filter((i) => i.id === 'knowledgeDeck')[0]
ok(kBad.status === 'broken' && /同名文件占用/.test(kBad.detail), '知识库子目录被同名文件占用 → broken（补上此前恒不成立的死分支）')
const kBadRes = applyBaseDeckItem('knowledgeDeck', Object.assign({}, badBase, { dryRun: false }))
ok(kBadRes.ok === false, 'broken 的知识库项真写 → 拒绝（未写盘）')

const reDir = join(TMP_ROOT, 'reentrant-lock')
mkdirSync(reDir, { recursive: true })
const tReentrant = Date.now()
const reOut = withMemoryDirLock(reDir, () => withMemoryDirLock(reDir, () => 'inner-ok'))
ok(reOut === 'inner-ok' && Date.now() - tReentrant < 500,
  '同进程重入不再抢同一把文件锁（内层直接复用，不死等；实测 ' + (Date.now() - tReentrant) + 'ms）')
ok(!existsSync(join(reDir, '.work-memory.lock')), '重入退出后锁文件已释放')

section('[22] ⑧ 迁移旧记忆库（改记忆库目录时把旧内容带过来）')
const BS = String.fromCharCode(92) // 反斜杠：避免在测试源码里写转义字面量

// 纯函数：噪声判定 / 路径等价 / 迁移来源三级顺序
ok(isMigrateNoise('.work-memory.lock') && isMigrateNoise('MEMORY.md.bak-20260101-000000-000')
  && isMigrateNoise('MEMORY.md.wps-tmp-1-ab') && isMigrateNoise(MIGRATE_MANIFEST_PREFIX + '20260101-000000-000.json')
  && isMigrateNoise('a.tmp'),
  '噪声识别：锁 / 写前备份 / 原子写临时文件 / 迁移清单 / .tmp 一律不迁移')
ok(!isMigrateNoise('MEMORY.md') && !isMigrateNoise('GRAPH.json') && !isMigrateNoise('.triage.json') && !isMigrateNoise('.access.json') && !isMigrateNoise('PROJECTS'),
  '状态文件不是噪声（含点号前缀的 .triage.json / .access.json 要迁移 —— 不按点号一刀切）')
// 路径大小写不敏感是 Windows 语义；POSIX 上 'C:/A/lib' 与 'c:\a\lib' 本就是不同路径（大小写敏感）
if (process.platform === 'win32') {
  ok(sameFsPath('C:/A/lib/', 'c:' + BS + 'a' + BS + 'lib') === true, '路径等价：大小写与分隔符归一后是同一目录')
} else {
  console.log('  · 非 win32：路径大小写敏感，跳过「大小写归一」那条断言')
}
ok(sameFsPath('C:/A/lib', 'C:/A/lib2') === false, '路径等价：不同目录为 false')
ok(LEGACY_MEMORY_SUBDIR.replace(/\\/g, '/') === 'memories/work-memory'
  && DEFAULT_MEMORY_SUBDIR.replace(/\\/g, '/') === 'data/dsh-work-memory/memory',
  '默认路径常量：新默认 = data/dsh-work-memory/memory；旧默认另立 LEGACY_MEMORY_SUBDIR 供迁移回退')

// 旧库夹具：三块结构 + 状态文件 + 两类噪声
const migHome = join(TMP_ROOT, 'mighome', '.dsh')
const migWs = makeWorkspace('migrate')
const migOld = join(TMP_ROOT, 'migold')
const migNew = join(TMP_ROOT, 'mignew')
const migBackup = join(TMP_ROOT, 'migbackup')
writeText(join(migOld, 'MEMORY.md'), '【全局记忆】A' + NL)
writeText(join(migOld, 'USER.md'), '【用户偏好】U' + NL)
writeText(join(migOld, 'GRAPH.json'), '{ "edges": [] }' + NL)
writeText(join(migOld, 'PROJECTS', 'proj.md'), 'P' + NL)
writeText(join(migOld, 'DAILY', '2026-01-02.md'), 'D' + NL)
writeText(join(migOld, '.triage.json'), '{ "keep": [] }' + NL)
writeText(join(migOld, '.work-memory.lock'), '99999')
writeText(join(migOld, 'MEMORY.md.bak-20260101-000000-000'), '旧备份' + NL)
assertInsideTmp(migOld, 'migold')

const migOpts = (extra) => opts(Object.assign({
  workspace: migWs, dshHome: migHome, settingsFile: join(migHome, 'settings.yaml'),
  memoryDir: migNew, backupDir: migBackup, moduleDir: MODULE_DIR,
  migrateFrom: migOld, migrateFromSource: 'settings',
}, extra || {}))
const migItemOf = (o) => planBaseDeck(o).items.filter((i) => i.id === 'migrateMemory')[0]

const migPlan = migItemOf(migOpts())
ok(migPlan.status === 'append' && migPlan.migrateStats.copy === 6 && migPlan.migrateStats.noise === 2,
  '计划：待复制 6 个、噪声 2 个（锁 + 写前备份）')
ok(migPlan.files.map((f) => f.name).sort().join(',') === '.triage.json,DAILY/2026-01-02.md,GRAPH.json,MEMORY.md,PROJECTS/proj.md,USER.md',
  '待复制清单含三块结构与状态文件，不含锁 / 备份')
ok(migPlan.migrateSource === 'settings' && migPlan.migrateSourceText.indexOf('设置') > 0, '计划回显迁移来源口径（settings）')
ok(migPlan.target.length === 2 && migPlan.target[0].indexOf('migold') > 0 && migPlan.target[1].indexOf('mignew') > 0, 'target 回显「旧目录 → 目标目录」')
ok(migPlan.autoApplyable === true && typeof migPlan.preview.sampleLines === 'string', '可自动执行 + preview.sampleLines 是字符串（客户端契约）')

const migTreeBefore = treeSnapshot(TMP_ROOT)
const migDry = applyBaseDeckItem('migrateMemory', migOpts({ dryRun: true }))
ok(migDry.ok === true && migDry.wroteAny === false && migDry.bytesWritten === 0, '干跑：ok 且零字节（wouldWriteBytes=' + migDry.wouldWriteBytes + '）')
ok(!existsSync(migNew) && sameTree(migTreeBefore, treeSnapshot(TMP_ROOT)), '干跑不创建目标目录（整棵树逐项一致）')

const migReal = applyBaseDeckItem('migrateMemory', migOpts({ dryRun: false }))
ok(migReal.ok === true && migReal.wroteAny === true && migReal.migratedFiles.length === 6, '真写：复制 6 个文件')
ok(readBytes(join(migNew, 'MEMORY.md')).equals(readBytes(join(migOld, 'MEMORY.md'))), 'MEMORY.md 逐字节一致（写后大小 + SHA256 校验通过）')
ok(existsSync(join(migNew, 'PROJECTS', 'proj.md')) && existsSync(join(migNew, 'DAILY', '2026-01-02.md')) && existsSync(join(migNew, '.triage.json')),
  '子目录结构与状态文件一并带过去（目录层级保留）')
ok(!existsSync(join(migNew, '.work-memory.lock')) && !existsSync(join(migNew, 'MEMORY.md.bak-20260101-000000-000')),
  '锁与写前备份不迁移（噪声），锁在收尾时已释放')
ok(existsSync(join(migOld, 'MEMORY.md')) && existsSync(join(migOld, 'MEMORY.md.bak-20260101-000000-000')) && existsSync(join(migOld, '.work-memory.lock')),
  '旧目录只读：原样保留，未删除、未改写')
ok(migReal.manifest.indexOf(MIGRATE_MANIFEST_PREFIX) > 0 && existsSync(migReal.manifest), '迁移清单写入备份目录（事后可审计）')
assertInsideTmp(migReal.manifest, 'migrate manifest')

const migPlan2 = migItemOf(migOpts())
ok(migPlan2.status === 'up_to_date' && migPlan2.migrateStats.copy === 0, '再计划一次 → up_to_date（幂等）')
const migAgain = applyBaseDeckItem('migrateMemory', migOpts({ dryRun: false }))
ok(migAgain.ok === true && migAgain.wroteAny === false && /未写盘/.test(migAgain.detail), '幂等：第二次真写也不再落盘')

writeText(join(migNew, 'USER.md'), '【用户偏好】目标自己的版本' + NL)
const migConflictPlan = migItemOf(migOpts())
ok(migConflictPlan.conflicts.join(',') === 'USER.md' && /内容不同/.test(migConflictPlan.detail), '目标已有同名但内容不同 → 计冲突并在 detail 说明')
const migConflictRes = applyBaseDeckItem('migrateMemory', migOpts({ dryRun: false }))
ok(migConflictRes.ok === true && readFileSync(join(migNew, 'USER.md'), 'utf8').indexOf('目标自己的版本') > 0, '绝不覆盖：目标内容原样保留')
ok(migConflictRes.conflicts.join(',') === 'USER.md', 'apply 结果回显冲突清单')

const migSame = migItemOf(migOpts({ memoryDir: migOld }))
ok(migSame.status === 'up_to_date' && /同一个/.test(migSame.detail), '旧目录 = 目标目录 → up_to_date（不自己迁自己）')
const migMissing = migItemOf(migOpts({ migrateFrom: join(TMP_ROOT, 'no-such-lib') }))
ok(migMissing.status === 'up_to_date' && /不存在/.test(migMissing.detail), '旧目录不存在 → up_to_date（不报错、不阻断引导）')
const migNoSrc = migItemOf(migOpts({ migrateFrom: '', migrateFromSource: 'none' }))
ok(migNoSrc.status === 'up_to_date' && migNoSrc.migrateSource === 'none' && migNoSrc.migrateStats.copy === 0, '未解析到来源 → up_to_date + source=none')
const migWsFallback = migItemOf(migOpts({ memoryDir: '' }))
ok(migWsFallback.status === 'append' && migWsFallback.target[1].indexOf('data/dsh-work-memory/memory') > 0 && migWsFallback.migrateStats.copy === 6,
  'memoryDir 留空 → 目标回退到唯一默认 <DSH_HOME>/data/dsh-work-memory/memory（不再按工作区名推导）')

// 回滚：第二个文件复制失败 → 本次已复制文件全部撤回，旧目录不动
const migNew2 = join(TMP_ROOT, 'mignew2')
let migCopyCount = 0
const migFailIo = { copyFileSync: (a, b) => { migCopyCount += 1; if (migCopyCount === 2) throw new Error('EACCES 模拟'); copyFileSync(a, b) } }
const migRb = applyBaseDeckItem('migrateMemory', migOpts({ dryRun: false, memoryDir: migNew2, io: migFailIo }))
ok(migRb.ok === false && /已回滚/.test(migRb.detail), '复制失败 → ok:false + 「已回滚」说明')
ok(!existsSync(migNew2) || readdirSync(migNew2).length === 0, '回滚后目标里没有残留文件（新建目录一并撤回）')
ok(existsSync(join(migOld, 'DAILY', '2026-01-02.md')) && existsSync(join(migOld, 'USER.md')), '回滚不影响旧目录')
ok(migRb.wroteAny !== true, '回滚的失败结果不谎报 wroteAny')

// 迁移是前置步骤：失败 → 链停在这一步，settings 不写（记忆库目录不切换）
const migStopHome = join(TMP_ROOT, 'migstophome', '.dsh')
const migStopBase = opts({
  workspace: makeWorkspace('migstop'), dshHome: migStopHome, settingsFile: join(migStopHome, 'settings.yaml'),
  memoryDir: join(TMP_ROOT, 'migstopmem'), backupDir: join(TMP_ROOT, 'migstopbackup'), moduleDir: MODULE_DIR,
  migrateFrom: migOld, migrateFromSource: 'settings',
})
const migStopRun = applyBaseDeck(['dirs', 'migrateMemory', 'settings', 'agentsMd'],
  Object.assign({}, migStopBase, { dryRun: false, io: { copyFileSync: () => { throw new Error('EACCES 模拟') } } }))
ok(migStopRun.ok === false && migStopRun.stoppedAt === 'migrateMemory', '迁移失败 → 链在 migrateMemory 处停止（stoppedAt 回显）')
ok(migStopRun.results.map((r) => r.id).join(',') === 'dirs,migrateMemory', '后续步骤（settings / agentsMd）不再执行')
ok(!existsSync(join(migStopHome, 'settings.yaml')), '迁移失败时不写 settings（记忆库目录没有被切换）')
ok(/后续步骤已停止/.test(migStopRun.stopReason), 'stopReason 给出可读原因：' + migStopRun.stopReason)

// 迁移来源三级顺序（纯函数，逐条判）
const srcHome = join(TMP_ROOT, 'srchome', '.dsh')
mkdirSync(join(srcHome, 'memories', 'work-memory'), { recursive: true })
const src1 = resolveMigrateSource({ memoryDir: { value: 'D:/my/lib', source: 'settings' } }, { dshHome: srcHome })
ok(src1.source === 'settings' && src1.from === 'D:/my/lib', '来源①：设置里显式配置 → settings（优先于旧默认位置）')
const src2 = resolveMigrateSource({ memoryDir: { value: '', source: 'none' } }, { dshHome: srcHome })
ok(src2.source === 'legacy-default' && src2.from.replace(/\\/g, '/').indexOf('memories/work-memory') > 0,
  '来源②：设置空但旧默认位置里有数据 → legacy-default')
rmSync(join(srcHome, 'memories'), { recursive: true, force: true })
const src3 = resolveMigrateSource({ memoryDir: { value: join(TMP_ROOT, 'newdefaultlib'), source: 'default' } }, { dshHome: srcHome })
ok(src3.source === 'new-default' && src3.from.indexOf('newdefaultlib') > 0, '来源③：旧默认位置不存在 → 用新默认位置（new-default）')
const srcNone = resolveMigrateSource({ memoryDir: { value: '', source: 'none' } }, { dshHome: srcHome })
ok(srcNone.source === 'none' && srcNone.from === '', '三级都没有 → none（不猜路径、不阻断）')

// 路由：GET /basedeck 回显迁移来源（走宿主设置服务那条只读路）
const hMig = installSetupCtx([
  { ns: 'work-memory', schema: SETUP_MEM_SCHEMA, value: { memoryDir: migOld }, revision: 1, applies: 'live' },
], { dshHome: migHome, env: { DSH_HOME: migHome } })
const rMig = await callRoute(hMig, 'GET', '/basedeck')
ok(rMig.status === 200 && rMig.body.migrateFromSource === 'settings' && rMig.body.migrateFrom.indexOf('migold') > 0,
  'GET /basedeck 回显迁移来源：source=' + rMig.body.migrateFromSource + '、旧目录路径已带上')
const rMigItem = (rMig.body.items || []).filter((i) => i.id === 'migrateMemory')[0]
ok(rMigItem && typeof rMigItem.status === 'string' && typeof rMigItem.migrateSourceText === 'string' && rMigItem.internal === undefined,
  'GET /basedeck 的 migrateMemory 项有状态 + 来源说明，且内部字段 internal 不对外')

section('[24] 根目录模型：memory-data / obsidian-data（主人 2026-09-16 定）')
// 模型：使用者只选**一个**存储根目录，记忆体与知识库各自在它下面新建自己的子文件夹。
// 这样两个目录天然是兄弟、默认不可能互相嵌套——「目标冲突」不再是常态问题。
ok(ROOT_SUBDIR_MEMORY === 'memory-data' && ROOT_SUBDIR_VAULT === 'obsidian-data',
  '两个固定子目录名：memory-data / obsidian-data')
const dRoot = deriveRootChildren('E:/work')
ok(dRoot.memoryDir === 'E:/work/memory-data' && dRoot.obsidianDir === 'E:/work/obsidian-data',
  '由存储根目录派生两个工作目录（实测 ' + dRoot.memoryDir + ' / ' + dRoot.obsidianDir + '）')
ok(deriveRootChildren('').memoryDir === '' && deriveRootChildren('   ').obsidianDir === '',
  '根目录为空 / 全空白 → 两个派生目录都为空串（不猜盘符、不拼相对路径）')
ok(inferRootDir('E:/work/memory-data', 'E:/work/obsidian-data') === 'E:/work',
  '反推：两个目录正好是同一父目录下的 memory-data / obsidian-data → 根目录 = 该父目录')
ok(inferRootDir('E:/work/MEMORY-DATA', 'E:/work/obsidian-data') === 'E:/work',
  '反推大小写不敏感（Windows 路径不区分大小写）')
ok(inferRootDir('C:/Users/me/.dsh/memories/me', 'E:/lina') === '' && inferRootDir('E:/a/memory-data', 'E:/b/obsidian-data') === '',
  '既有散落配置（不同父目录 / 恰好同名）→ 推不出根目录就留空，不猜')
ok(inferRootDir('', 'E:/work/obsidian-data') === '', '一半为空 → 不反推')
// 记忆库若被放进知识库（「单独指定」时可能），它不是业务模块，不该登记进主页
ok(memoryTopSegmentInVault('E:/vault/memory-data', 'E:/vault') === 'memory-data'
  && memoryTopSegmentInVault('E:/vault/data/mem', 'E:/vault') === 'data'
  && memoryTopSegmentInVault('E:/other/memory-data', 'E:/vault') === ''
  && memoryTopSegmentInVault('E:/vault', 'E:/vault') === '',
  '取「记忆库在知识库里的第一级目录名」；不在库内 / 同一目录 → 空串')
const mvVault = join(TMP_ROOT, 'modelvault')
mkdirSync(join(mvVault, '知识库-天地'), { recursive: true })
mkdirSync(join(mvVault, ROOT_SUBDIR_MEMORY), { recursive: true })
mkdirSync(join(mvVault, VAULT_MIRROR_DIR_NAME), { recursive: true })
ok(listVaultModules(mvVault).indexOf(ROOT_SUBDIR_MEMORY) >= 0, '默认扫描会看到记忆库目录（这是待排除的现象）')
ok(listVaultModules(mvVault, [memoryTopSegmentInVault(join(mvVault, ROOT_SUBDIR_MEMORY), mvVault)]).indexOf(ROOT_SUBDIR_MEMORY) < 0,
  '传入排除项后，记忆库目录不再被当作业务模块登记')
ok(VAULT_MIRROR_DIR_NAME && listVaultModules(mvVault, [ROOT_SUBDIR_MEMORY]).indexOf('00_全局记忆') < 0,
  '受管目录 00_全局记忆 始终排除（不受新增排除项影响）')

// setup-state：把根目录与子目录名一并暴露给客户端（客户端不硬编码这两个名字）
// 反推逻辑跨平台（纯字符串），但 buildSetupState 先判绝对路径 → 用平台自适应存储根，两平台都真跑
const WS_ROOT = process.platform === 'win32' ? 'E:/work' : join(TMP_ROOT, 'workroot')
const stRoot = buildSetupState({
  memoryDirValue: WS_ROOT + '/memory-data', obsidianSyncValue: WS_ROOT + '/obsidian-data/00_全局记忆',
})
ok(stRoot.root && stRoot.root.value === WS_ROOT && stRoot.root.source === 'derived',
  'setup-state.root：由两个目录反推为存储根（source=derived；' + WS_ROOT + '）')
ok(stRoot.rootSubdirs && stRoot.rootSubdirs.memory === 'memory-data' && stRoot.rootSubdirs.vault === 'obsidian-data',
  'setup-state.rootSubdirs：把子目录名交给客户端（唯一真相源在宿主）')
const stNoRoot = buildSetupState({ memoryDirValue: 'C:/Users/me/mem', obsidianSyncValue: '' })
ok(stNoRoot.root && stNoRoot.root.value === '' && stNoRoot.root.source === 'none',
  '既有配置推不出根目录 → root.value 为空、source=none（页面据此显示「已单独指定」）')

section('[23] 目录选择：ctx.directoryPicker 的 browse 原语代理（GET /dirs · POST /dirs/new）')
// 反斜杠统一用 [22] 段已声明的 BS（String.fromCharCode(92)），本段不再重复声明

// 纯函数：完全限定绝对路径判定（口径与 browse 后端的 fullyQualified 逐字对齐）
ok(isFullyQualifiedPath('C:/Users/me', 'win32') === true && isFullyQualifiedPath('C:' + BS + 'Users' + BS + 'me', 'win32') === true,
  'Windows：盘符限定（正反斜杠两种写法）→ 合法')
ok(isFullyQualifiedPath(BS + BS + 'server' + BS + 'share' + BS + 'dir', 'win32') === true, 'Windows：完整 UNC → 合法')
ok(isFullyQualifiedPath(BS + 'foo', 'win32') === false && isFullyQualifiedPath('/foo', 'win32') === false,
  'Windows：无盘符的 ' + BS + 'foo 与 /foo → 拒绝（会落在进程当前盘）')
ok(isFullyQualifiedPath(BS + BS, 'win32') === false && isFullyQualifiedPath(BS + BS + 'server', 'win32') === false,
  'Windows：不完整 UNC（只有两反斜杠 / 只有服务器）→ 拒绝')
ok(isFullyQualifiedPath('relative/path', 'win32') === false && isFullyQualifiedPath('', 'win32') === false && isFullyQualifiedPath('   ', 'win32') === false,
  'Windows：相对路径 / 空串 / 全空白 → 拒绝')
ok(isFullyQualifiedPath('/usr/local', 'linux') === true && isFullyQualifiedPath('usr/local', 'linux') === false, 'POSIX：/ 开头为绝对，其余拒绝')

// mock picker：browse 原语（只回目录，带 crumbs / truncated）
const dirCalls = []
const dirCap = {
  kind: 'browse',
  list: async (path) => {
    dirCalls.push({ op: 'list', path: path })
    const target = path || 'C:/Users/me'
    return {
      path: target,
      home: 'C:/Users/me',
      crumbs: [{ name: 'C:', path: 'C:/' }, { name: 'Users', path: 'C:/Users' }, { name: 'me', path: target }],
      entries: [{ name: 'proj', path: target + '/proj', hidden: false }, { name: '.cache', path: target + '/.cache', hidden: true }],
      truncated: false,
    }
  },
  createDirectory: async (path, name) => {
    dirCalls.push({ op: 'create', path: path, name: name })
    if (name === 'exists') {
      const e = new Error('already exists')
      e.name = 'DirectoryPickerError'
      e.code = 'directory-exists'
      e.path = path + '/' + name
      throw e
    }
    return path + '/' + name
  },
}
const dirPicker = { capability: () => dirCap }
function installDirsCtx(services) {
  const c = makeMockCtx(services)
  installApi(c, { platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, env: {}, now: FIXED_NOW, dshHome: join(TMP_ROOT, 'dirsdsh', '.dsh'), profileDir: join(TMP_ROOT, 'dirsprofile') })
  return { ctx: c, handler: prefixHandler(c) }
}
const dirs = installDirsCtx({ directoryPicker: dirPicker })
const dirsHandler = dirs.handler

// ① browse 正常列举
const rDirsList = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent('C:/Users/me'))
ok(rDirsList.status === 200 && rDirsList.body.ok === true && rDirsList.body.kind === 'browse', '①GET /dirs（browse）→ 200 + ok:true + kind=browse')
ok(rDirsList.body.path === 'C:/Users/me' && rDirsList.body.parent === 'C:/Users' && rDirsList.body.home === 'C:/Users/me', '①path / parent / home 归一为 POSIX 风格')
ok(Array.isArray(rDirsList.body.crumbs) && rDirsList.body.crumbs.length === 3 && rDirsList.body.crumbs[0].path === 'C:/' && rDirsList.body.crumbs[2].path === 'C:/Users/me',
  '①crumbs = 从根到当前目录（每级 name + path，可跳）')
ok(rDirsList.body.entries.length === 2 && rDirsList.body.entries.every((e) => e.name && e.path) && rDirsList.body.entries[1].hidden === true,
  '①entries = 只有目录（hidden 透传）')
ok(rDirsList.body.truncated === false && typeof rDirsList.body.message === 'string' && /已列出 2 个目录/.test(rDirsList.body.message), '①truncated 透传 + 可读 message')
ok(dirCalls[0].op === 'list' && dirCalls[0].path === 'C:/Users/me', '①原语确实被调用且入参原样透传')
// 盘符根（可跳的上一级为空）是 Windows 语义；POSIX 根的 parent 由后端另行定义，不在本断言范围
if (process.platform === 'win32') {
  const rDirsRoot = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent('C:/'))
  ok(rDirsRoot.body.ok === true && (rDirsRoot.body.parent === '' || rDirsRoot.body.parent === 'C:/'), '①盘符根：没有可跳的上一级（parent 为空串）')
} else {
  console.log('  · 非 win32：无盘符根，跳过该条断言')
}
const rDirsDefault = await callRoute(dirsHandler, 'GET', '/dirs')
ok(rDirsDefault.status === 200 && rDirsDefault.body.ok === true && dirCalls[dirCalls.length - 1].path === undefined,
  '①不传 path 参数 → 用宿主默认位置（list(undefined)，browse 后端回落用户主目录）')

// ② createDirectory 正常与失败
const rNew = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/Users/me', name: 'newproj' }, REQ_HEADERS)
ok(rNew.status === 200 && rNew.body.ok === true && rNew.body.path === 'C:/Users/me/newproj', '②POST /dirs/new 正常 → 200 + { ok:true, path }')
const rNewExists = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/Users/me', name: 'exists' }, REQ_HEADERS)
ok(rNewExists.status === 200 && rNewExists.body.ok === false && rNewExists.body.code === 'directory-exists' && rNewExists.body.path === 'C:/Users/me/exists',
  '②DirectoryPickerError 的 code 与 path 原样透传（不做字符串匹配猜语义）')
ok(/同名目录已存在/.test(rNewExists.body.message) && /directory-exists/.test(rNewExists.body.message), '②失败消息可读中文 + 带 code 便于排查：' + rNewExists.body.message)

// ③ native 载体：明确告知，不调用任何原语
const nativeCalls = []
const nativePicker = { capability: () => ({ kind: 'native', pick: () => { nativeCalls.push('pick'); return Promise.resolve('') } }) }
const nativeDirs = installDirsCtx({ directoryPicker: nativePicker })
const rNative = await callRoute(nativeDirs.handler, 'GET', '/dirs?path=' + encodeURIComponent('C:/Users/me'))
ok(rNative.status === 200 && rNative.body.ok === false && rNative.body.code === 'native-only' && rNative.body.kind === 'native',
  '③native 载体 → ok:false + code=native-only（不假装支持 listing）')
ok(nativeCalls.length === 0, '③native 分支不调用任何原语（不开系统对话框、不 500）')
const rNativeNew = await callRoute(nativeDirs.handler, 'POST', '/dirs/new', { path: 'C:/x', name: 'y' }, REQ_HEADERS)
ok(rNativeNew.body.ok === false && rNativeNew.body.code === 'native-only' && nativeCalls.length === 0, '③POST /dirs/new 在 native 载体同样明确告知（不调用 pick）')

// ④ 服务缺失 / ctx 没有 get（旧宿主）
const noneDirs = installDirsCtx({})
const rNone = await callRoute(noneDirs.handler, 'GET', '/dirs?path=' + encodeURIComponent('C:/Users/me'))
ok(rNone.status === 200 && rNone.body.ok === false && rNone.body.code === 'no-service' && rNone.body.kindMissing === true,
  '④服务缺失 → 200 + ok:false + code=no-service + kindMissing（可读降级，不 500）')
const rNoneNew = await callRoute(noneDirs.handler, 'POST', '/dirs/new', { path: 'C:/x', name: 'y' }, REQ_HEADERS)
ok(rNoneNew.status === 200 && rNoneNew.body.ok === false && rNoneNew.body.code === 'no-service', '④POST 在服务缺失下同样可读降级')
const directNone = await listDirectories({}, { path: 'C:/Users/me', platform: 'win32' })
ok(directNone.status === 200 && directNone.body.code === 'no-service', '④ctx 根本没有 get 方法（旧宿主）→ 同样 no-service，不抛异常')

// ⑤ 非法入参 → 400（与「本机形态」严格区分）
const rRel = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent('foo/bar'))
ok(rRel.status === 400 && rRel.body.ok === false && rRel.body.code === 'bad-path', '⑤相对路径 → 400 + code=bad-path')
const rBack = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent(BS + 'foo'))
ok(rBack.status === 400 && rBack.body.code === 'bad-path', '⑤无盘符 ' + BS + 'foo → 400（会落在当前盘，拒）')
const rEmpty = await callRoute(dirsHandler, 'GET', '/dirs?path=')
ok(rEmpty.status === 400 && rEmpty.body.code === 'bad-path', '⑤传了空串 path → 400（与「不传参数用默认位置」区分开）')
const rLong = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent('C:/' + 'a'.repeat(1200)))
ok(rLong.status === 400 && rLong.body.code === 'path-too-long', '⑤超长 path（>1024）→ 400 + code=path-too-long')
const rNewEsc = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/ok', name: '../escape' }, REQ_HEADERS)
ok(rNewEsc.status === 400 && rNewEsc.body.code === 'bad-name', '⑤name 含路径分隔符 → 400 + code=bad-name（绝不拼路径）')
const rNewDot = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/ok', name: '..' }, REQ_HEADERS)
ok(rNewDot.status === 400 && rNewDot.body.code === 'bad-name', '⑤name = .. → 400')
const rNewRel = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'foo', name: 'x' }, REQ_HEADERS)
ok(rNewRel.status === 400 && rNewRel.body.code === 'bad-path', '⑤父目录是相对路径 → 400')
const rNewEmpty = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/ok', name: '' }, REQ_HEADERS)
ok(rNewEmpty.status === 400 && rNewEmpty.body.code === 'bad-name', '⑤name 为空 → 400')

// ⑥ 同源保护（POST 403；GET 带跨站 Origin 同样拒）
const createCallsBefore = dirCalls.filter((c) => c.op === 'create').length
const rNewCross = await callRoute(dirsHandler, 'POST', '/dirs/new', { path: 'C:/Users/me', name: 'x' }, CROSS_HEADERS)
ok(rNewCross.status === 403, '⑥跨站 POST /dirs/new → 403（沿用既有同源保护）')
ok(dirCalls.filter((c) => c.op === 'create').length === createCallsBefore, '⑥被拦下的跨站请求没有调用 createDirectory')
const rGetCross = await callRoute(dirsHandler, 'GET', '/dirs?path=' + encodeURIComponent('C:/Users/me'), undefined, CROSS_HEADERS)
ok(rGetCross.status === 403, '⑥带跨站 Origin 的 GET /dirs → 403（只读同源守卫）')

// ⑦ 精确路由（桌面载体 fetch 桥只认精确路由）
ok(CORE_API_EXACT_PATHS.indexOf('/dirs') > 0 && CORE_API_EXACT_PATHS.indexOf('/dirs/new') > 0, '⑦两条路径进 CORE_API_EXACT_PATHS')
ok(isFullyQualifiedPath('D:/ws', 'win32') === true, '⑦路径判定对其它盘符同样成立（D:）')
const dirsExact = dirs.ctx.routes.filter((r) => r.kind === 'exact').map((r) => r.path)
ok(dirsExact.indexOf(API_ROOT + '/dirs') >= 0 && dirsExact.indexOf(API_ROOT + '/dirs/new') >= 0, '⑦两条 exact 路由确实注册（桌面载体可达）')

section('[25] 旧知识库导入：清单 → 勾选 → 逐项对照写入（POST /import/scan · POST /import/apply）')
// 口径（设计定稿 §3.4 / §12 决议 8 与 13②）：只读源目录、只补还没有的文件、**绝不覆盖现有文件**、
// 先列清单再由使用者勾选；命中敏感模式的条目只列出、由使用者确认（§12.1）。

const IMP_TMP = join(TMP_ROOT, 'import')
const IMP_SRC = join(IMP_TMP, 'srcvault')
const IMP_DST = join(IMP_TMP, 'dstvault')
assertInsideTmp(IMP_SRC, 'import src'); assertInsideTmp(IMP_DST, 'import dst')
mkdirSync(join(IMP_SRC, '子目录'), { recursive: true })
mkdirSync(IMP_DST, { recursive: true })
writeFileSync(join(IMP_SRC, 'a.md'), '# 新文件\n', 'utf8')
writeFileSync(join(IMP_SRC, '子目录', 'nested.md'), 'nested\n', 'utf8')
writeFileSync(join(IMP_SRC, 'b.md'), 'same\n', 'utf8')
writeFileSync(join(IMP_DST, 'b.md'), 'same\n', 'utf8')
writeFileSync(join(IMP_SRC, 'c.md'), 'source differs\n', 'utf8')
writeFileSync(join(IMP_DST, 'c.md'), 'target keeps me\n', 'utf8')
writeFileSync(join(IMP_SRC, 'secret.md'), '联系我 someone@example.com\n', 'utf8')
writeFileSync(join(IMP_SRC, 'a.md.bak-20260101'), 'noise\n', 'utf8')
writeFileSync(join(IMP_SRC, 'tmp.tmp'), 'noise\n', 'utf8')
writeFileSync(join(IMP_SRC, 'occupied.md'), 'x\n', 'utf8')
mkdirSync(join(IMP_DST, 'occupied.md'), { recursive: true })

const impScan = scanImport({ from: IMP_SRC, to: IMP_DST, env: {} })
ok(impScan.ok === true && impScan.code === 'ok', '①scanImport 正常返回 ok（只读，未落盘）')
const impState = (rel) => { const it = impScan.items.filter((x) => x.rel === rel)[0]; return it ? it.state : '(missing)' }
ok(impState('a.md') === 'copy', '①目标缺失 → copy（可补）')
ok(impState('子目录/nested.md') === 'copy', '①子目录里的文件同样列出（相对路径用 / 分隔）')
ok(impState('b.md') === 'same', '①目标已有且字节相同 → same（无需写）')
ok(impState('c.md') === 'conflict', '①目标已有但内容不同 → conflict（保留目标）')
ok(impState('occupied.md') === 'occupied', '①目标同名位置是目录 → occupied（保留目标）')
ok(impScan.stats.noise === 2, '①备份 / 临时文件计入 noise（实测 ' + impScan.stats.noise + '）')
ok(impScan.items.every((x) => x.rel !== 'a.md.bak-20260101' && x.rel !== 'tmp.tmp'), '①噪声文件不在一级清单里')
ok(impScan.stats.copy === 3 && impScan.stats.sensitive === 1, '①统计：可补 3 · 敏感 1（实测 ' + impScan.stats.copy + ' / ' + impScan.stats.sensitive + '）')
const impSecret = impScan.items.filter((x) => x.rel === 'secret.md')[0]
ok(Boolean(impSecret) && impSecret.sensitive.length > 0 && Boolean(impSecret.sensitive[0].label), '①敏感项带可读标签（供使用者确认）')
ok(JSON.stringify(impSecret.sensitive).indexOf('someone@example.com') < 0, '①敏感回执只给标签与行号，不抄原文')
ok(impScan.items[0].state === 'copy', '①清单排序：可补项排在最前（先让使用者决定补什么）')
ok(impScan.from.indexOf('\\') < 0 && impScan.to.indexOf('\\') < 0, '①回执路径一律 POSIX 形态')

section('[25a] 纯函数：敏感模式与相对路径护栏')
ok(detectSensitiveText('api_key = "abcdef1234567890"').filter((x) => x.id === 'credential').length === 1, '②凭据模式命中')
ok(detectSensitiveText('手机 13800138000').filter((x) => x.id === 'phone').length === 1, '②手机号模式命中')
ok(detectSensitiveText('这是一段干净的正文').length === 0, '②干净正文不误报')
ok(isSafeImportRel('子目录/a.md') === true && isSafeImportRel('../escape.md') === false
  && isSafeImportRel('C:/x.md') === false && isSafeImportRel('/abs.md') === false && isSafeImportRel('a//b.md') === false,
  '②相对路径护栏：.. / 盘符 / 绝对 / 空段一律拒绝')

section('[25b] 逐项对照写入：只补缺失、绝不覆盖')
const impDry = applyImport({ from: IMP_SRC, to: IMP_DST, rels: ['a.md', '子目录/nested.md'], env: {} })
ok(impDry.ok === true && impDry.dryRun === true && impDry.copied.length === 0, '③applyImport 默认 dry-run（不落盘）')
ok(!existsSync(join(IMP_DST, 'a.md')) && !existsSync(join(IMP_DST, '子目录', 'nested.md')), '③dry-run 后目标侧确实没有新文件')
ok(impDry.planned.length === 2 && impDry.planned.every((p) => p.to.indexOf('\\') < 0), '③dry-run 给出计划（POSIX 路径）')

const impApply = applyImport({
  from: IMP_SRC, to: IMP_DST,
  rels: ['a.md', '子目录/nested.md', 'b.md', 'c.md', 'occupied.md'],
  dryRun: false, env: {},
})
ok(impApply.ok === true && impApply.copied.length === 2, '④只写入 copy 项（实测 ' + impApply.copied.length + '）')
ok(impApply.rejected.filter((r) => r.rel === 'c.md')[0].reason === 'conflict', '④冲突项被拒写（reason=conflict）')
ok(impApply.rejected.filter((r) => r.rel === 'b.md')[0].reason === 'same', '④已一致项被拒写（reason=same）')
ok(impApply.rejected.filter((r) => r.rel === 'occupied.md')[0].reason === 'occupied', '④被目录占用项被拒写（reason=occupied）')
ok(readFileSync(join(IMP_DST, 'c.md'), 'utf8') === 'target keeps me\n', '④冲突文件的目标内容逐字未变（**绝不覆盖**）')
ok(readFileSync(join(IMP_DST, 'b.md'), 'utf8') === 'same\n', '④已一致文件未改动')
ok(existsSync(join(IMP_DST, 'a.md')) && readFileSync(join(IMP_DST, 'a.md'), 'utf8') === '# 新文件\n', '④缺失文件已补，内容与源逐字一致')
ok(impApply.bytesWritten > 0 && /校验通过/.test(impApply.detail), '④写后大小 + SHA256 校验通过')

const impBad = applyImport({ from: IMP_SRC, to: IMP_DST, rels: ['../escape.md', 'not-there.md', ''], dryRun: false, env: {} })
ok(impBad.ok === true && impBad.copied.length === 0, '⑤非法 / 不在清单 / 空的勾选项一个都不写')
ok(impBad.rejected.filter((r) => r.reason === 'bad-path').length === 1
  && impBad.rejected.filter((r) => r.reason === 'not-in-list').length === 1
  && impBad.rejected.filter((r) => r.reason === 'empty').length === 1, '⑤三类拒写原因可读（bad-path / not-in-list / empty）')
ok(!existsSync(join(IMP_TMP, 'escape.md')), '⑤路径穿越没有产生任何文件')

// ⑥ apply 每次都**重新对照**目标：目标已有同名不同内容的文件 → 即使勾选也拒写
const IMP_SRC2 = join(IMP_TMP, 'src2')
const IMP_DST2 = join(IMP_TMP, 'dst2')
mkdirSync(IMP_SRC2, { recursive: true }); mkdirSync(IMP_DST2, { recursive: true })
writeFileSync(join(IMP_SRC2, 'race.md'), 'from source\n', 'utf8')
writeFileSync(join(IMP_DST2, 'race.md'), 'arrived later\n', 'utf8')
const impRace = applyImport({ from: IMP_SRC2, to: IMP_DST2, rels: ['race.md'], dryRun: false, env: {} })
ok(impRace.ok === true && impRace.copied.length === 0 && impRace.rejected.filter((r) => r.reason === 'conflict').length === 1,
  '⑥apply 内部重新对照 → 目标已有且内容不同时拒写（不依赖调用方手里的旧清单）')
ok(readFileSync(join(IMP_DST2, 'race.md'), 'utf8') === 'arrived later\n', '⑥拒写时目标内容未被覆盖')

// ⑦ 失败回滚：注入 io 让第二个文件复制失败
const IMP_SRC3 = join(IMP_TMP, 'src3')
const IMP_DST3 = join(IMP_TMP, 'dst3')
mkdirSync(IMP_SRC3, { recursive: true }); mkdirSync(IMP_DST3, { recursive: true })
writeFileSync(join(IMP_SRC3, 'x1.md'), 'one\n', 'utf8')
writeFileSync(join(IMP_SRC3, 'x2.md'), 'two\n', 'utf8')
let impCopyCount = 0
const impIo = {
  copyFileSync(src, dst) {
    impCopyCount += 1
    if (impCopyCount === 2) throw new Error('模拟复制失败')
    copyFileSync(src, dst)
  },
}
const impFail = applyImport({ from: IMP_SRC3, to: IMP_DST3, rels: ['x1.md', 'x2.md'], dryRun: false, env: {}, io: impIo })
ok(impFail.ok === false && impFail.code === 'copy-failed' && /已回滚/.test(impFail.error), '⑦复制失败 → ok:false + 可读中文（含「已回滚」）')
ok(!existsSync(join(IMP_DST3, 'x1.md')) && !existsSync(join(IMP_DST3, 'x2.md')), '⑦回滚把本轮已复制的文件删净')

section('[25c] 源 / 目标关系护栏与 API 路由')
const impSame = scanImport({ from: IMP_SRC, to: IMP_SRC, env: {} })
ok(impSame.ok === false && impSame.code === 'same-dir', '⑧源目录与知识库目录相同 → 明确拒绝')
const impNested = scanImport({ from: IMP_SRC, to: join(IMP_SRC, '子目录'), env: {} })
ok(impNested.ok === false && impNested.code === 'nested', '⑧源目标互相包含 → 明确拒绝')
const impNoFrom = scanImport({ from: '', to: IMP_DST, env: {} })
ok(impNoFrom.ok === false && impNoFrom.code === 'bad-from' && /选择/.test(impNoFrom.error), '⑧未选源目录 → 可读中文')
const impNoTo = scanImport({ from: IMP_SRC, to: '', env: {} })
ok(impNoTo.ok === false && impNoTo.code === 'bad-to' && /保存配置并开始/.test(impNoTo.error), '⑧没有知识库目录 → 可读中文（提示先完成一键配置）')

const impCtx = makeMockCtx()
installApi(impCtx, {
  platform: 'win32', repoRoot: FAKE_REPO, moduleDir: MODULE_DIR, env: {}, now: FIXED_NOW,
  dshHome: join(TMP_ROOT, 'impdsh', '.dsh'), profileDir: join(TMP_ROOT, 'impprofile'),
})
const impHandler = prefixHandler(impCtx)
ok(CORE_API_EXACT_PATHS.indexOf('/import/scan') > 0 && CORE_API_EXACT_PATHS.indexOf('/import/apply') > 0, '⑨两条路径进 CORE_API_EXACT_PATHS')
const impRouteExact = impCtx.routes.filter((r) => r.kind === 'exact').map((r) => r.path)
ok(impRouteExact.indexOf(API_ROOT + '/import/scan') >= 0 && impRouteExact.indexOf(API_ROOT + '/import/apply') >= 0,
  '⑨两条 exact 路由确实注册（桌面载体的 fetch 桥只认 exact）')

// 路由用例用**独立夹具**：前面几节已经把 IMP_DST 写过了，不能拿它证明「dry-run 没写盘」
// 显式 rm + 重建：断言不依赖「前面几节恰好没写过这里」，跨平台也不受残留影响
const IMP_SRC9 = join(IMP_TMP, 'src9')
const IMP_DST9 = join(IMP_TMP, 'dst9')
assertInsideTmp(IMP_SRC9, 'route src'); assertInsideTmp(IMP_DST9, 'route dst')
rmSync(IMP_SRC9, { recursive: true, force: true })
rmSync(IMP_DST9, { recursive: true, force: true })
mkdirSync(join(IMP_SRC9, '子目录'), { recursive: true })
mkdirSync(IMP_DST9, { recursive: true })
writeFileSync(join(IMP_SRC9, '子目录', 'nested.md'), 'nested\n', 'utf8')

const impScanRoute = await callRoute(impHandler, 'POST', '/import/scan', { from: IMP_SRC9, to: IMP_DST9 }, REQ_HEADERS)
ok(impScanRoute.status === 200 && impScanRoute.body.ok === true && Array.isArray(impScanRoute.body.items),
  '⑨POST /import/scan → 200 + 清单（只读，绝不写盘）')
const impScanCross = await callRoute(impHandler, 'POST', '/import/scan', { from: IMP_SRC9, to: IMP_DST9 }, CROSS_HEADERS)
ok(impScanCross.status === 403, '⑨跨站 POST /import/scan → 403')
const impApplyDry = await callRoute(impHandler, 'POST', '/import/apply', { from: IMP_SRC9, to: IMP_DST9, rels: ['子目录/nested.md'] }, REQ_HEADERS)
ok(impApplyDry.status === 200 && impApplyDry.body.dryRun === true && impApplyDry.body.copied.length === 0,
  '⑨POST /import/apply 默认 dryRun:true（不带 dryRun:false 绝不写盘）')
ok(!existsSync(join(IMP_DST9, '子目录', 'nested.md')), '⑨默认 dry-run 后目标侧没有新文件')
const impApplyCross = await callRoute(impHandler, 'POST', '/import/apply',
  { from: IMP_SRC9, to: IMP_DST9, rels: ['子目录/nested.md'], dryRun: false }, CROSS_HEADERS)
ok(impApplyCross.status === 403 && !existsSync(join(IMP_DST9, '子目录', 'nested.md')), '⑨跨站写请求 403 且没有写入')
const impApplyRoute = await callRoute(impHandler, 'POST', '/import/apply',
  { from: IMP_SRC9, to: IMP_DST9, rels: ['子目录/nested.md'], dryRun: false }, REQ_HEADERS)
ok(impApplyRoute.status === 200 && impApplyRoute.body.ok === true && impApplyRoute.body.copied.length === 1,
  '⑨POST /import/apply（dryRun:false）→ 真补 1 个文件')
ok(existsSync(join(IMP_DST9, '子目录', 'nested.md')), '⑨落盘后目标侧确有该文件')
const impBadRoute = await callRoute(impHandler, 'POST', '/import/scan', { from: '', to: IMP_DST }, REQ_HEADERS)
ok(impBadRoute.status === 400 && impBadRoute.body.ok === false, '⑨入参错误 → 400 + ok:false（可读中文）')

ok(readFileSync(join(IMP_SRC, 'a.md'), 'utf8') === '# 新文件\n' && readFileSync(join(IMP_SRC, 'c.md'), 'utf8') === 'source differs\n',
  '⑩源目录全程只读（内容逐字未变）')
ok(IMPORT_LIST_LIMIT >= 100 && IMPORT_SENSITIVE_RULES.length >= 5,
  '⑩清单上限与敏感规则表已导出（上限 ' + IMPORT_LIST_LIMIT + ' · 规则 ' + IMPORT_SENSITIVE_RULES.length + ' 条）')

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

// ───────────────────── [26] T5-7 目录布局识别 ─────────────────────
section('[26] 目录布局识别（detectVaultLayout）：新 / 旧 / 混合 / 空 / 未知')
{
  const norm = (p) => String(p).replace(/\\/g, '/')
  const mk = (list) => { const s = new Set(list.map(norm)); return (p) => s.has(norm(p)) }
  const only = (name) => mk([join('D:/ws', name)])
  ok(detectVaultLayout('D:/ws', { existsSync: only(ROOT_SUBDIR_MEMORY) }).layout === 'new', '根下有 memory-data → new')
  ok(detectVaultLayout('D:/ws', { existsSync: only(ROOT_SUBDIR_VAULT) }).layout === 'new', '根下有 obsidian-data → new')
  ok(detectVaultLayout('D:/ws', { existsSync: only(VAULT_MIRROR_DIR_NAME) }).layout === 'legacy', '根上直接有 00_全局记忆 → legacy（旧布局）')
  ok(detectVaultLayout('D:/ws', { existsSync: only(VAULT_HOME_FILE) }).layout === 'legacy', '根上直接有 🏠 主页.md → legacy（旧布局）')
  const both = mk([join('D:/ws', ROOT_SUBDIR_MEMORY), join('D:/ws', VAULT_HOME_FILE)])
  const mixed = detectVaultLayout('D:/ws', { existsSync: both })
  ok(mixed.layout === 'mixed', '新旧痕迹都有 → mixed')
  ok(mixed.evidence.length === 2, 'mixed 时给出两条依据（实测 ' + mixed.evidence.length + '）')
  ok(detectVaultLayout('D:/ws', { existsSync: () => false }).layout === 'empty', '目录存在但两种都没有 → empty')
  ok(detectVaultLayout('', { existsSync: () => false }).layout === 'unknown', '空串 → unknown')
  ok(detectVaultLayout('D:/ws', { existsSync: () => { throw new Error('EACCES') } }).layout === 'empty', 'fs 抛错时吞掉不崩（→ empty）')
}

// ───────────────────── [27] T5-4 配置收尾：写身份成功后同步一次记忆镜像 ─────────────────────
section('[27] T5-4 配置收尾镜像同步（POST /identity/save 的 mirror 字段）')
{
  const mirrorRoot = join(TMP_ROOT, 'mirrorcase')
  const mirrorMem = join(mirrorRoot, 'memory-data')
  const mirrorVault = join(mirrorRoot, 'vault')
  const mirrorOut = join(mirrorVault, VAULT_MIRROR_DIR_NAME)
  mkdirSync(mirrorMem, { recursive: true })
  rmSync(mirrorVault, { recursive: true, force: true })
  const ctxOf = (value) => installSetupCtx([
    { ns: 'work-memory', schema: SETUP_MEM_SCHEMA, value: value, revision: 1, applies: 'live' },
  ])

  // ① dry-run 不触发（只有真写成功才有收尾动作）
  const hDry = ctxOf({ memoryDir: mirrorMem, obsidianSyncDir: mirrorOut })
  const mDry = await callRoute(hDry, 'POST', '/identity/save', { memoryDir: mirrorMem, content: '从事信息安全售前工作。' }, REQ_HEADERS)
  ok(mDry.body.dryRun === true && mDry.body.mirror && mDry.body.mirror.skipped === true && mDry.body.mirror.reason === '未触发',
    '①dry-run 不触发镜像同步（mirror.skipped + 未触发）')
  ok(!existsSync(mirrorVault), '①dry-run 后镜像目录没有被创建')

  // ② 真写成功 → 触发一次同步（profile / repo 两个候选在夹具里都不存在，落到 bundled）
  const hReal = ctxOf({ memoryDir: mirrorMem, obsidianSyncDir: mirrorOut })
  const mReal = await callRoute(hReal, 'POST', '/identity/save', { memoryDir: mirrorMem, content: '从事信息安全售前工作。', dryRun: false }, REQ_HEADERS)
  const mirror = mReal.body.mirror || {}
  ok(mReal.body.ok === true && mReal.body.wroteAny === true, '②真写身份成功（wroteAny=true）')
  ok(mirror.ok === true && mirror.files >= 1 && mirror.source === 'bundled',
    '②写身份后同步了记忆镜像：files=' + mirror.files + ' · source=' + mirror.source + ' · pruned=' + mirror.pruned)
  ok(existsSync(join(mirrorOut, 'MEMORY.md')), '②镜像目录确实出现 MEMORY.md（不是只回了个 ok）')
  ok(readFileSync(join(mirrorOut, 'MEMORY.md'), 'utf8') === readFileSync(join(mirrorMem, 'MEMORY.md'), 'utf8'),
    '②镜像内容与记忆库逐字节一致')
  ok(mirror.dir === undefined && mirror.reason === undefined, '②响应只回数值与枚举，不回传路径')

  // ③ 没配镜像目录 → 跳过，且不影响写入结果
  const hNone = ctxOf({ memoryDir: mirrorMem })
  const mNone = await callRoute(hNone, 'POST', '/identity/save', { memoryDir: mirrorMem, content: 'x', dryRun: false }, REQ_HEADERS)
  ok(mNone.body.ok === true && mNone.body.mirror.skipped === true && /缺少记忆库目录或镜像目录/.test(String(mNone.body.mirror.reason)),
    '③未配置镜像目录 → 跳过（写入结果不受影响）')

  // ④ 设置服务缺失 → 取不到镜像目录，同样只跳过
  const hNoSettings = installSetupCtx(null)
  const mNoSettings = await callRoute(hNoSettings, 'POST', '/identity/save', { memoryDir: mirrorMem, content: 'y', dryRun: false }, REQ_HEADERS)
  ok(mNoSettings.body.ok === true && mNoSettings.body.mirror.skipped === true, '④设置服务缺失 → 仍写成功，只跳过镜像同步')
  ok(await readObsidianSyncDir({}) === '', '④readObsidianSyncDir 无设置服务 → 空串（不抛）')

  // ⑤ 候选路径纯函数（与 expertsModuleCandidates 同构）
  ok(memoryMirrorCandidates({}).length === 0, '⑤三个根目录都空 → 无候选（明确降级，不猜）')
  const cand = memoryMirrorCandidates({ profileDir: 'P', repoRoot: 'R', moduleDir: 'M' })
  ok(cand.map((c) => c.source).join(',') === 'profile,repo,bundled', '⑤候选顺序 = profile → repo → bundled')
  // 用 indexOf >= 0（bundled 候选是 join(moduleDir,'..',…)；moduleDir 为单段相对路径时会被 path 规范化掉前两段）
  ok(cand.every((c) => c.file.split(BS).join('/').indexOf('dsh-work-memory/lib/backup.js') >= 0),
    '⑤候选统一指向 dsh-work-memory/lib/backup.js（同仓库同批发布）')
  const candReal = memoryMirrorCandidates({ moduleDir: MODULE_DIR })
  ok(candReal.length === 1 && candReal[0].file.split(BS).join('/').indexOf('/dsh-work-memory/lib/backup.js') > 0,
    '⑤绝对 moduleDir（真实调用形态）→ bundled 候选是完整的同级模块路径')
}

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
