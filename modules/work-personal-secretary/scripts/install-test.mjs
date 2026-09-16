/**
 * work-personal-secretary —— 子插件安装引擎自测（不依赖宿主运行时）
 *
 * 用法：node scripts/install-test.mjs
 *
 * 覆盖：
 *   [1] SUB_PLUGIN_IDS：五个 id 与顺序（与 lib/index.js 的 SUB_PLUGINS、lib/probe.js 的 SUB_PLUGIN_NAMES 一致）
 *   [2] resolveRepoRoot：设置项 / 相对探测 / 常见位置 / 无效设置项降级 / 找不到 → null
 *   [3] listSubPlugins：形状、bundled 版本、installMode（file / link / copy）、summary
 *   [4] installSubPlugin 全流程（临时目录）：复制 → 排除 node_modules/.git/__pycache__ → 旧目标先删
 *       → profile/package.json 更新 → 备份存在 → JSON 可解析 → 无 BOM → 逐文件 SHA256 一致
 *   [5] 未知 id 被拒且**不产生任何复制**
 *   [6] 路由：GET /plugins、POST /install、POST /install-all、同源保护（403）
 *   [7] 原子替换与失败回滚（注入 mock 失败）：复制中途失败 / 校验不通过 / 替换失败 → 原目录逐文件
 *       SHA256 完好、.wps-new 清理、profile/package.json 未被改动；以及前置失败不触碰目标
 *       G 备份轮转：package.json.bak-* 只保留最近 BACKUP_KEEP（10）份，prunedBackups 如实回报
 *   [8] 隔离与中立性：全部写入都在 os.tmpdir() 下；真实 profile 仅做 **只读 mtime/size 快照**
 *   [9] 桌宠素材部署（workspace-tokenpet 专属）：缺失才补 / 已存在绝不覆盖 / 源无 skins 时 skipped 且不影响安装
 *
 * 红线：本测试**绝不触碰真实的 ~/.dsh/profiles**——所有 repoRoot / profileDir 都在 os.tmpdir() 下自建，
 * 且每次调用前都用 assertInsideTmp() 复核；测试首尾只**读取**真实 profile 的 stat 快照用于证明未被写入。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'

import {
  SUB_PLUGIN_IDS,
  SUB_PLUGIN_ID_LIST,
  EXCLUDED_DIRS,
  BACKUP_KEEP,
  listBackups,
  resolveRepoRoot,
  readProfileRepoRoot,
  writeProfileRepoRoot,
  listSubPlugins,
  installSubPlugin,
  resolveInstallAllPlan,
  walkFiles,
  sha256File,
  detectBom,
  BACKUP_SUFFIX,
  PET_SKINS_PLUGIN_ID,
  resolveDshHome,
  deployPetSkins,
  describePetSkins,
} from '../lib/install.js'

import { API_ROOT, API_PATHS, CORE_API_EXACT_PATHS, PAGE_PATHS, installApi } from '../lib/api.js'
import { SUB_PLUGINS, apply as applyHost } from '../lib/index.js'
import { SUB_PLUGIN_NAMES, maskUserPath } from '../lib/probe.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

// ───────────────────── 隔离护栏：所有写入必须在 tmp 下 ─────────────────────

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'wps-install-test-'))

function assertInsideTmp(p, where) {
  const s = String(p == null ? '' : p).replace(/\\/g, '/').toLowerCase()
  const root = TMP_ROOT.replace(/\\/g, '/').toLowerCase()
  if (s.indexOf(root) !== 0) {
    throw new Error('隔离护栏拦截：' + (where || 'path') + ' 不在临时目录内：' + p)
  }
}
/** 只读 stat 快照（证明"未被写入"，绝不修改目标文件） */
function snapshot(file) {
  try {
    const st = statSync(file)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch (e) {
    return null
  }
}
function sameSnapshot(a, b) {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

// ───────────────────── 临时夹具 ─────────────────────

const FAKE_REPO = join(TMP_ROOT, 'repo')
const FAKE_PROFILE = join(TMP_ROOT, 'profile')
const VERSIONS = {
  'dsh-work-memory': '9.9.9',
  'dsh-doc-suite': '8.8.8',
  'dsh-experts': '7.7.7',
  'dsh-mermaid': '6.6.6',
  'workspace-tokenpet': '5.5.5',
}

/** 造一个带"应当被排除"目录的源子插件 */
function makePluginSource(id) {
  const dir = join(FAKE_REPO, 'modules', id)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: id, version: VERSIONS[id], main: 'lib/index.js' }, null, 2) + '\n')
  writeFileSync(join(dir, 'lib', 'index.js'), 'export const name = ' + JSON.stringify(id) + '\n')
  writeFileSync(join(dir, 'README.md'), '# ' + id + '\n')
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), '// 不应被复制\n')
  mkdirSync(join(dir, '.git'), { recursive: true })
  writeFileSync(join(dir, '.git', 'config'), 'gitdir: x\n')
  mkdirSync(join(dir, '__pycache__'), { recursive: true })
  writeFileSync(join(dir, '__pycache__', 'cached.pyc'), 'x\n')
  return dir
}

function makeProfile() {
  mkdirSync(join(FAKE_PROFILE, 'node_modules'), { recursive: true })
  writeFileSync(join(FAKE_PROFILE, 'package.json'), JSON.stringify({
    name: 'desktop',
    private: true,
    dependencies: {
      'dsh-work-memory': 'file:node_modules/dsh-work-memory',
      'dsh-mermaid': '0.4.0',
      'workspace-tokenpet': 'link:../somewhere/workspace-tokenpet',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-work-memory'] } },
  }, null, 2) + '\n')
}

for (const id of SUB_PLUGIN_ID_LIST) makePluginSource(id)
makeProfile()

// ───────────────────── mock req / res（沿用 probe-test 的做法） ─────────────────────

function makeMockCtx() {
  const routes = []
  return {
    routes: routes,
    logger: { debug() {}, warn() {}, info() {} },
    webServer: { register(opts) { routes.push(opts); return () => {} } },
  }
}
function prefixHandler(ctx) {
  const r = ctx.routes.filter((x) => x.kind === 'prefix')[0]
  return r ? r.handler : null
}
function makeReq(over) {
  const o = over || {}
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
    status: 0,
    headers: null,
    body: '',
    writeHead(s, h) { this.status = s; this.headers = h || null },
    end(t) { this.body = t || '' },
  }
}
const ORIGIN_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' }
const CROSS_HEADERS = { 'content-type': 'application/json', host: '127.0.0.1:43120', origin: 'http://evil.example' }

const realProfilePkg = join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json')
const realBefore = snapshot(realProfilePkg)

// ═══════════════════════════ 主流程 ═══════════════════════════

section('[1] SUB_PLUGIN_IDS：五个固定 id 与顺序')
ok(SUB_PLUGIN_ID_LIST.length === 5, '共五个 id')
ok(SUB_PLUGIN_ID_LIST.join(',') === 'dsh-work-memory,dsh-doc-suite,dsh-experts,dsh-mermaid,workspace-tokenpet', '顺序与契约一致')
ok(SUB_PLUGIN_IDS.every((s) => s.label && s.kind), '每项都有中文 label 与 kind')
ok(SUB_PLUGIN_IDS.every((s) => s.kind === '自研' || s.kind === '独立项目模块' || s.kind === '第三方'),
  'kind 只取 自研 / 独立项目模块 / 第三方')
ok(SUB_PLUGINS.map((s) => s.name).join(',') === SUB_PLUGIN_ID_LIST.join(','), '与 lib/index.js 的 SUB_PLUGINS 一致')
ok(SUB_PLUGIN_NAMES.join(',') === SUB_PLUGIN_ID_LIST.join(','), '与 lib/probe.js 的 SUB_PLUGIN_NAMES 一致')

section('[2] resolveRepoRoot：四种来源解析（只读）')
const rConfig = resolveRepoRoot({ configRoot: FAKE_REPO, moduleDir: join(TMP_ROOT, 'nowhere') })
ok(rConfig.repoRoot === FAKE_REPO, '设置项来源命中')
ok(rConfig.source === 'config' && rConfig.sourceDetail === 'config', 'source=config')
const rAncestor = resolveRepoRoot({ configRoot: '', moduleDir: join(FAKE_REPO, 'modules', 'work-personal-secretary', 'lib') })
ok(rAncestor.repoRoot === FAKE_REPO, '相对探测命中（从模块目录逐级向上）')
ok(rAncestor.source === 'relative' && rAncestor.sourceDetail === 'ancestor', 'source=relative / detail=ancestor')
const rCommon = resolveRepoRoot({ configRoot: '', moduleDir: join(TMP_ROOT, 'nowhere'), commonCandidates: [join(TMP_ROOT, 'nope'), FAKE_REPO] })
ok(rCommon.repoRoot === FAKE_REPO, '常见位置命中')
ok(rCommon.source === 'relative' && rCommon.sourceDetail === 'common', 'source=relative / detail=common')
const rNone = resolveRepoRoot({ configRoot: '', moduleDir: join(TMP_ROOT, 'nowhere'), commonCandidates: [join(TMP_ROOT, 'nope')], env: {} })
ok(rNone.repoRoot === null && rNone.source === 'none', '全部落空 → repoRoot=null / source=none')
const rDegrade = resolveRepoRoot({ configRoot: join(TMP_ROOT, 'not-a-repo'), moduleDir: join(FAKE_REPO, 'modules', 'work-personal-secretary') })
ok(rDegrade.repoRoot === FAKE_REPO && rDegrade.source === 'relative', '无效设置项自动降级到相对探测')
const rNoModules = resolveRepoRoot({ configRoot: TMP_ROOT, moduleDir: join(TMP_ROOT, 'nowhere'), commonCandidates: [] })
ok(rNoModules.repoRoot === null, '缺 modules/ 的目录不被当作仓库根')

// ── 2026-09-14 增补：repoRoot 四层优先级（设置值 → 部署配置 → profile patch → 自动探测） ──

/** 造一个最小可用仓库根（只要有 modules/<白名单 id>/package.json 即被认作仓库根） */
function makeMiniRepo(dir, tag) {
  mkdirSync(join(dir, 'modules', 'dsh-mermaid'), { recursive: true })
  writeFileSync(join(dir, 'modules', 'dsh-mermaid', 'package.json'),
    JSON.stringify({ name: 'dsh-mermaid', version: '0.0.' + tag }, null, 2) + '\n')
  return dir
}
const REPO_SET = makeMiniRepo(join(TMP_ROOT, 'repo-settings'), '1')
const REPO_PATCH = makeMiniRepo(join(TMP_ROOT, 'repo-patch'), '2')
const REPO_ANC = makeMiniRepo(join(TMP_ROOT, 'repo-ancestor'), '3')
const PATCH_PROFILE = join(TMP_ROOT, 'profile-patch')
mkdirSync(PATCH_PROFILE, { recursive: true })
writeFileSync(join(PATCH_PROFILE, 'cordis.patch.yml'),
  '# 测试夹具：profile 的用户覆盖层\n- id: work-personal-secretary\n  config:\n    repoRoot: '
  + "'" + REPO_PATCH.replace(/\\/g, '/') + "'" + '\n')
const ANC_MODULE_DIR = join(REPO_ANC, 'modules', 'work-personal-secretary')
const patchTried = { profileDir: PATCH_PROFILE, moduleDir: ANC_MODULE_DIR, commonCandidates: [], env: {} }

const rPrio1 = resolveRepoRoot(Object.assign({ settingsRoot: REPO_SET, configRoot: REPO_PATCH }, patchTried))
ok(rPrio1.repoRoot === REPO_SET && rPrio1.sourceDetail === 'settings',
  '优先级 ①：设置值 > 部署配置 / patch / 祖先（sourceDetail=settings）')
const rPrio2 = resolveRepoRoot(Object.assign({ settingsRoot: '', configRoot: REPO_PATCH }, patchTried))
ok(rPrio2.repoRoot === REPO_PATCH && rPrio2.sourceDetail === 'config',
  '优先级 ②：部署配置命中（sourceDetail=config）')
const rPrio3 = resolveRepoRoot(Object.assign({ settingsRoot: '', configRoot: '' }, patchTried))
ok(rPrio3.repoRoot === REPO_PATCH && rPrio3.sourceDetail === 'patch',
  '优先级 ③：profile 的 cordis.patch.yml 命中（sourceDetail=patch），且优先于祖先探测')
const rPrio4 = resolveRepoRoot({ settingsRoot: '', configRoot: '', moduleDir: ANC_MODULE_DIR, commonCandidates: [], env: {} })
ok(rPrio4.repoRoot === REPO_ANC && rPrio4.sourceDetail === 'ancestor',
  '优先级 ④：都没有 → 祖先探测（sourceDetail=ancestor）')
const rPrio5 = resolveRepoRoot(Object.assign({ settingsRoot: join(TMP_ROOT, 'not-a-repo'), configRoot: '' }, patchTried))
ok(rPrio5.repoRoot === REPO_PATCH && rPrio5.settingsError.indexOf('无效') >= 0,
  '设置值非空但无效 → 不静默（settingsError 文案）且降级到 patch')
ok(rPrio5.settingsError.indexOf('modules/<id>/package.json') >= 0, '无效设置的报错文案给出口径（应包含 modules/<id>/package.json）')
ok(rPrio1.settingsError === '' && rPrio4.settingsError === '', '设置值为空时不产生 settingsError')
ok(readProfileRepoRoot(PATCH_PROFILE) === REPO_PATCH, 'readProfileRepoRoot 能从 patch 里读出 repoRoot')
ok(readProfileRepoRoot(FAKE_PROFILE) === '' && readProfileRepoRoot('') === '', '无 patch 文件 / 空目录 → 空串（不抛）')
ok(readProfileRepoRoot(PATCH_PROFILE) === REPO_PATCH && readFileSync(join(PATCH_PROFILE, 'cordis.patch.yml'), 'utf8').indexOf("'") > 0,
  'patch 解析兼容带引号写法（值带单引号也能读出）')

section('[3] listSubPlugins：形状与 installMode（临时 repo + 临时 profile）')
const listing0 = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE })
ok(listing0.items.length === 5, 'items 五项')
ok(listing0.summary.total === 5 && listing0.summary.installed === 0 && listing0.summary.upToDate === 0, 'summary 初始为 5/0/0')
const keys = Object.keys(listing0.items[0]).sort().join(',')
ok(keys === 'bundleHit,bundledVersion,dirPresent,id,installMode,installed,installedVersion,kind,label,registered,upToDate',
  'item 字段与契约一致（2026-09-14 增补 registered / bundleHit / dirPresent，既有字段一字未改）')
ok(listing0.items[0].bundledVersion === VERSIONS['dsh-work-memory'], 'bundledVersion 取自 <repoRoot>/modules/<id>/package.json')
ok(listing0.items[0].installMode === 'file', 'file: 依赖 → installMode=file')
ok(listing0.items[3].installMode === 'copy', '版本号依赖 → installMode=copy')
ok(listing0.items[4].installMode === 'link', 'link: 依赖 → installMode=link')
ok(listing0.items[1].installMode === null && listing0.items[1].installed === false, '无依赖条目 → installMode=null')
ok(listing0.repoRoot.indexOf('\\') === -1 && listing0.profileDir.indexOf('\\') === -1, '路径输出为 POSIX 风格')
ok(listSubPlugins({ repoRoot: null, profileDir: null }).items.every((it) => it.bundledVersion === '' && it.installed === false), 'repoRoot/profileDir 为空时仍返回完整形状')

// ── 2026-09-14 增补：installed 改为「登记为准」—— 残留 / 缺目录 / 登记齐全 ──

/** 造一个只读判定用的 profile 夹具：dependencies / bundles / node_modules 目录三者可控 */
function makeRegistryProfile(tag, deps, bundles, dirIds) {
  const dir = join(TMP_ROOT, 'profile-reg-' + tag)
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'desktop', private: true,
    dependencies: deps || {},
    dsh: { profile: { bundles: bundles || [] } },
  }, null, 2) + '\n')
  for (const id of (dirIds || [])) {
    mkdirSync(join(dir, 'node_modules', id), { recursive: true })
    writeFileSync(join(dir, 'node_modules', id, 'package.json'),
      JSON.stringify({ name: id, version: VERSIONS[id] || '0.0.0' }, null, 2) + '\n')
  }
  return dir
}
const REG_RESIDUE = makeRegistryProfile('residue', {}, [], ['dsh-mermaid'])
const residueItem = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: REG_RESIDUE }).items[3]
ok(residueItem.installed === false && residueItem.dirPresent === true,
  '卸载残留（目录在、依赖与 bundles 都没登记）→ installed=false / dirPresent=true')
ok(residueItem.registered === false && residueItem.bundleHit === false, '残留项：registered=false / bundleHit=false')
ok(residueItem.installedVersion === null && residueItem.upToDate === false,
  '残留项不给 installedVersion / 不标已是最新（否则面板不出安装按钮）')
ok(listSubPlugins({ repoRoot: FAKE_REPO, profileDir: REG_RESIDUE }).summary.installed === 0, '残留项不计入 summary.installed')

const REG_NO_DIR = makeRegistryProfile('nodir', { 'dsh-experts': 'file:node_modules/dsh-experts' }, ['dsh-experts'], [])
const noDirItem = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: REG_NO_DIR }).items[2]
ok(noDirItem.registered === true && noDirItem.bundleHit === true && noDirItem.dirPresent === false,
  'bundles 命中但目录缺失：registered / bundleHit = true、dirPresent=false')
ok(noDirItem.installed === false, 'bundles 命中但目录缺失 → 未安装')

const REG_OK = makeRegistryProfile('full', { 'dsh-mermaid': 'file:node_modules/dsh-mermaid' }, ['dsh-mermaid'], ['dsh-mermaid'])
const regOkItem = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: REG_OK }).items[3]
ok(regOkItem.installed === true && regOkItem.dirPresent === true && regOkItem.registered === true && regOkItem.bundleHit === true,
  '登记齐全（依赖 + bundles + 目录）→ 已安装')
ok(regOkItem.installedVersion === VERSIONS['dsh-mermaid'] && regOkItem.upToDate === true,
  '登记齐全且版本一致 → installedVersion 正常 + upToDate=true')

const REG_DEP_ONLY = makeRegistryProfile('deponly', { 'dsh-mermaid': 'file:node_modules/dsh-mermaid' }, [], ['dsh-mermaid'])
const depOnlyItem = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: REG_DEP_ONLY }).items[3]
ok(depOnlyItem.registered === true && depOnlyItem.bundleHit === false && depOnlyItem.installed === false,
  '只有依赖登记、bundles 缺 → 未安装（登记为准）')

// ── 2026-09-14 增补：repoRoot 写回 profile 配置（写前备份 / 同值不写 / 失败只返回错误） ──
section('[3b] writeProfileRepoRoot：写回 profile 的 cordis.patch.yml（写前备份）')
const WP = join(TMP_ROOT, 'profile-wpatch')
mkdirSync(WP, { recursive: true })
const wpNow = new Date(2026, 0, 2, 3, 4, 5, 678)
const wNew = writeProfileRepoRoot(WP, FAKE_REPO, { now: wpNow })
ok(wNew.ok === true && wNew.changed === true && wNew.backup === '', '文件不存在 → 新建条目成功（无需备份）')
const wpText = readFileSync(join(WP, 'cordis.patch.yml'), 'utf8')
ok(wpText.indexOf('- id: work-personal-secretary') >= 0 && wpText.indexOf('repoRoot: ') > 0, '写入内容为「- id + config.repoRoot」')
ok(readProfileRepoRoot(WP) === FAKE_REPO, '写后能读回同一个仓库根')
const wSame = writeProfileRepoRoot(WP, FAKE_REPO, { now: wpNow })
ok(wSame.ok === true && wSame.changed === false && wSame.backup === '', '同值 → changed=false 且不写盘、不备份')
const wNext = writeProfileRepoRoot(WP, REPO_PATCH, { now: new Date(2026, 0, 2, 3, 4, 6, 0) })
ok(wNext.ok === true && wNext.changed === true && wNext.backup.indexOf('cordis.patch.yml.bak-') > 0, '改值 → 写前备份（*.bak-<时间戳>）')
ok(readProfileRepoRoot(WP) === REPO_PATCH, '读回新值')
ok(readdirSync(WP).filter((n) => n.indexOf('cordis.patch.yml.bak-') === 0).length === 1, '恰好留下 1 份备份')
const WP_NO_CFG = join(TMP_ROOT, 'profile-wpatch2')
mkdirSync(WP_NO_CFG, { recursive: true })
writeFileSync(join(WP_NO_CFG, 'cordis.patch.yml'), '- id: work-personal-secretary\n')
const wNoCfg = writeProfileRepoRoot(WP_NO_CFG, FAKE_REPO, { now: wpNow })
ok(wNoCfg.ok === true && readProfileRepoRoot(WP_NO_CFG) === FAKE_REPO, '有条目但缺 config 段 → 自动补 config + repoRoot')
const WP_BOM = join(TMP_ROOT, 'profile-wpatch3')
mkdirSync(WP_BOM, { recursive: true })
writeFileSync(join(WP_BOM, 'cordis.patch.yml'), '\uFEFF- id: work-personal-secretary\n')
const wBom = writeProfileRepoRoot(WP_BOM, FAKE_REPO, { now: wpNow })
ok(wBom.ok === false && String(wBom.error).indexOf('BOM') >= 0, '带 BOM 的 profile 配置 → 拒绝写入并给出可读原因')
const wEmpty = writeProfileRepoRoot(WP, '', { now: wpNow })
ok(wEmpty.ok === false && String(wEmpty.error).indexOf('为空') >= 0, '空仓库根 → 拒绝写入（不静默）')
const wFail = writeProfileRepoRoot(WP, REPO_ANC, {
  now: wpNow,
  io: {
    copyFileSync: copyFileSync, mkdirSync: mkdirSync, rmSync: rmSync, renameSync: renameSync,
    writeFileSync: () => { throw new Error('disk full') },
  },
})
ok(wFail.ok === false && String(wFail.error).indexOf('失败') >= 0, '注入写失败 → ok=false + 可读原因（**不抛异常**，调用方可不阻断）')

section('[4] installSubPlugin 全流程（临时目录）')
assertInsideTmp(FAKE_REPO, 'fakeRepo')
assertInsideTmp(FAKE_PROFILE, 'fakeProfile')
const srcDoc = join(FAKE_REPO, 'modules', 'dsh-doc-suite')
const dstDoc = join(FAKE_PROFILE, 'node_modules', 'dsh-doc-suite')
ok(!existsSync(dstDoc), '安装前目标不存在')

const fixedNow = new Date(2026, 0, 2, 3, 4, 5, 678)
const resInstall = installSubPlugin('dsh-doc-suite', { repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE, now: fixedNow })
ok(resInstall.ok === true, 'ok=true')
ok(resInstall.id === 'dsh-doc-suite', 'id 正确')
ok(resInstall.from === srcDoc.replace(/\\/g, '/'), 'from = <repoRoot>/modules/<id>')
ok(resInstall.to === dstDoc.replace(/\\/g, '/'), 'to = <profileDir>/node_modules/<id>')
ok(resInstall.files === 3, 'files=3（package.json / lib/index.js / README.md）')
ok(resInstall.verified === true, 'verified=true（逐文件 SHA256 一致）')
ok(resInstall.replaced === false, '首次安装 replaced=false（目标原本不存在）')
ok(resInstall.overwrite === false, '首次安装 overwrite=false')
ok(!existsSync(dstDoc + '.wps-new') && !existsSync(dstDoc + '.wps-old'), '安装成功后不残留 .wps-new / .wps-old')
ok(typeof resInstall.durationMs === 'number' && resInstall.durationMs >= 0, 'durationMs 为数字')
ok(resInstall.output.indexOf('SHA256') >= 0, 'output 含校验结论')

// 复制结果 + 排除项
ok(existsSync(join(dstDoc, 'package.json')) && existsSync(join(dstDoc, 'lib', 'index.js')), '目标文件已就位')
ok(!existsSync(join(dstDoc, 'node_modules')), 'node_modules 已排除')
ok(!existsSync(join(dstDoc, '.git')), '.git 已排除')
ok(!existsSync(join(dstDoc, '__pycache__')), '__pycache__ 已排除')
ok(readdirSync(join(dstDoc, 'lib')).join(',') === 'index.js', '目录结构正确')
let shaAllSame = true
const walked = walkFiles(srcDoc)
for (const rel of walked) {
  if (sha256File(join(srcDoc, rel)) !== sha256File(join(dstDoc, rel))) shaAllSame = false
}
ok(walked.length === 3 && shaAllSame, '源与目标逐文件 SHA256 全部一致')
ok(walked.indexOf('node_modules/dep/index.js') === -1, 'walkFiles 已排除 node_modules')

// profile/package.json：备份 / JSON / BOM / 追加去重
const profRaw = readFileSync(join(FAKE_PROFILE, 'package.json'))
ok(detectBom(profRaw) === '', 'profile/package.json 写入后无 BOM')
const profJson = JSON.parse(profRaw.toString('utf8'))
ok(profJson.dependencies['dsh-doc-suite'] === 'file:node_modules/dsh-doc-suite', 'dependencies 写入 file:node_modules/<id>')
ok(profJson.dsh.profile.bundles.indexOf('dsh-doc-suite') === profJson.dsh.profile.bundles.length - 1, 'bundles 追加到末尾')
ok(profJson.dsh.profile.bundles.filter((b) => b === 'dsh-doc-suite').length === 1, 'bundles 不重复')
ok(profJson.dsh.profile.bundles.length === 3, '原有 bundles 条目保留')
ok(resInstall.backup.endsWith(BACKUP_SUFFIX + '20260102-030405-678'), '备份名 = package.json.bak-<时间戳>')
assertInsideTmp(resInstall.backup, 'backup')
ok(existsSync(resInstall.backup), '备份文件已生成')
const bakJson = JSON.parse(readFileSync(resInstall.backup, 'utf8'))
ok(bakJson.dependencies['dsh-doc-suite'] === undefined, '备份保存的是**写前**内容')
ok(detectBom(readFileSync(resInstall.backup)) === '', '备份同样无 BOM')

// 重复安装：目标先整目录删除（旧残留不残留）+ 幂等
writeFileSync(join(dstDoc, 'stale.txt'), 'stale\n')
const resAgain = installSubPlugin('dsh-doc-suite', { repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE, now: fixedNow })
ok(resAgain.ok === true && resAgain.files === 3, '重复安装仍 ok=true / files=3')
ok(!existsSync(join(dstDoc, 'stale.txt')), '原子替换：旧目录里的残留文件不会带进新目录')
ok(resAgain.replaced === true, '覆盖安装 replaced=true（目标原本存在）')
ok(resAgain.overwrite === true, '同版本覆盖重装 overwrite=true')
ok(resAgain.output.indexOf('覆盖重装') >= 0, 'output 标注「覆盖重装」')
const profJson2 = JSON.parse(readFileSync(join(FAKE_PROFILE, 'package.json'), 'utf8'))
ok(profJson2.dsh.profile.bundles.filter((b) => b === 'dsh-doc-suite').length === 1, '重复安装后 bundles 仍不重复')

// 装完后 listSubPlugins 反映已装 / 已最新
const listing1 = listSubPlugins({ repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE })
ok(listing1.summary.installed === 1 && listing1.summary.upToDate === 1, 'summary.installed/upToDate 随安装更新')
ok(listing1.items[1].installedVersion === VERSIONS['dsh-doc-suite'], 'installedVersion 取自目标 package.json')
ok(listing1.items[1].upToDate === true, '版本一致 → upToDate=true')

// 缺 repoRoot / 缺 profile 的拒绝路径（不写盘）
const resNoRepo = installSubPlugin('dsh-experts', { repoRoot: null, profileDir: FAKE_PROFILE })
ok(resNoRepo.ok === false && !existsSync(join(FAKE_PROFILE, 'node_modules', 'dsh-experts')), 'repoRoot=null 被拒且不复制')
const resNoProfile = installSubPlugin('dsh-experts', { repoRoot: FAKE_REPO, profileDir: null })
ok(resNoProfile.ok === false && !existsSync(join(FAKE_PROFILE, 'node_modules', 'dsh-experts')), 'profileDir=null 被拒且不复制')

section('[5] 未知 id 被拒且不产生任何复制')
const nmBefore = readdirSync(join(FAKE_PROFILE, 'node_modules')).sort().join(',')
const profBefore = readFileSync(join(FAKE_PROFILE, 'package.json'), 'utf8')
const resEvil = installSubPlugin('dsh-evil', { repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE })
ok(resEvil.ok === false && resEvil.error === '未知子插件 id', '未知 id → ok=false / error=未知子插件 id')
ok(resEvil.files === 0 && resEvil.verified === false, '未知 id 不产出文件与校验')
ok(!existsSync(join(FAKE_PROFILE, 'node_modules', 'dsh-evil')), '未创建任何目录')
ok(!existsSync(join(FAKE_REPO, 'modules', 'dsh-evil')), '未触碰源仓库')
ok(readdirSync(join(FAKE_PROFILE, 'node_modules')).sort().join(',') === nmBefore, 'node_modules 清单一字未变')
ok(readFileSync(join(FAKE_PROFILE, 'package.json'), 'utf8') === profBefore, 'profile/package.json 一字未变')
ok(installSubPlugin('../escape', { repoRoot: FAKE_REPO, profileDir: FAKE_PROFILE }).ok === false, '路径穿越写法同样被白名单拒绝')

section('[6] 路由：GET /plugins、POST /install、POST /install-all、同源保护')
const plan = resolveInstallAllPlan(['dsh-mermaid', 'nope', 'dsh-experts', 'dsh-experts'])
ok(plan.order.join(',') === 'dsh-experts,dsh-mermaid', '批量计划按服务端固定顺序（忽略传入顺序）并去重')
ok(plan.rejected.join(',') === 'nope', '未知 id 计入 rejected')

const ctx = makeMockCtx()
installApi(ctx, {
  platform: 'win32',
  repoRoot: '',
  profileDir: FAKE_PROFILE,
  moduleDir: join(FAKE_REPO, 'modules', 'work-personal-secretary'),
  commonCandidates: [join(TMP_ROOT, 'nope')],
  env: {},
  now: fixedNow,
})
ok(ctx.routes.filter((r) => r.kind === 'prefix').length === 1, 'prefix 路由已注册')
ok(API_PATHS.join(',') === '/check,/fix,/fix-all,/plugins,/install,/install-all,/basedeck', 'API_PATHS 含三条新路由与配置底座路由')
ok(ctx.routes.filter((r) => r.kind === 'exact').length === API_PATHS.length + PAGE_PATHS.length + CORE_API_EXACT_PATHS.length, 'exact 路由逐条注册（API ' + API_PATHS.length + ' 条 + 随包网页 ' + PAGE_PATHS.length + ' 条 + 新增 JSON ' + CORE_API_EXACT_PATHS.length + ' 条）')
const handler = prefixHandler(ctx)

async function call(method, sub, body, headers) {
  const res = makeRes()
  await handler(makeReq({ method: method, url: API_ROOT + sub, body: body, headers: headers }), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, body: json }
}

const rPlugins = await call('GET', '/plugins')
ok(rPlugins.status === 200 && rPlugins.body.ok === true, 'GET /plugins → 200 ok')
ok(rPlugins.body.items.length === 5, 'GET /plugins items 五项')
ok(rPlugins.body.repoRootSource === 'relative' && rPlugins.body.repoRoot === FAKE_REPO.replace(/\\/g, '/'), 'GET /plugins 用相对探测解析 repoRoot')
ok(rPlugins.body.summary.installed === 1, 'GET /plugins 是只读快照（未触发新安装）')
ok(rPlugins.body.settingsRepoRoot === null && rPlugins.body.profileRepoRoot === null,
  'GET /plugins 增补 settingsRepoRoot / profileRepoRoot 来源回显（此时都为空）')

// ── 2026-09-14 增补：GET / POST /repo-root（设置值可读可写；无效值 400 且不写盘） ──
const PATCH_FILE = join(FAKE_PROFILE, 'cordis.patch.yml')
const rRepoGet = await call('GET', '/repo-root')
ok(rRepoGet.status === 200 && rRepoGet.body.ok === true && rRepoGet.body.repoRootSourceDetail === 'ancestor',
  'GET /repo-root → 200，回显当前来源（自动推导）')
ok(rRepoGet.body.repoRoot === FAKE_REPO.replace(/\\/g, '/') && rRepoGet.body.settingsAvailable === false,
  'GET /repo-root 回显解析结果；无 ctx.settings 时 settingsAvailable=false')
const rRepoBad = await call('POST', '/repo-root', { repoRoot: join(TMP_ROOT, 'not-a-repo') }, ORIGIN_HEADERS)
ok(rRepoBad.status === 400 && rRepoBad.body.error === 'repo-root-invalid',
  'POST /repo-root 无效目录 → 400 repo-root-invalid')
ok(String(rRepoBad.body.message).indexOf('未写盘') >= 0 && String(rRepoBad.body.message).indexOf('modules/<id>/package.json') >= 0,
  '无效值报错文案给出口径并声明未写盘（不静默）')
ok(!existsSync(PATCH_FILE), '无效值未产生任何写盘（profile 的 cordis.patch.yml 未创建）')
const rRepoCross = await call('POST', '/repo-root', { repoRoot: FAKE_REPO }, CROSS_HEADERS)
ok(rRepoCross.status === 403, '跨站 POST /repo-root → 403（同源保护）')

const rInstall = await call('POST', '/install', { id: 'dsh-mermaid' }, ORIGIN_HEADERS)
ok(rInstall.status === 200 && rInstall.body.ok === true && rInstall.body.id === 'dsh-mermaid', 'POST /install → 200 ok')
ok(rInstall.body.repoRootRecorded && rInstall.body.repoRootRecorded.ok === true
  && rInstall.body.repoRootRecorded.written === 'patch',
  '安装成功后把自动探测出的 repoRoot 写回 profile 配置（written=patch；设置服务缺失时的兜底）')
ok(existsSync(PATCH_FILE) && readProfileRepoRoot(FAKE_PROFILE) === FAKE_REPO,
  'profile 的 cordis.patch.yml 已生成且能读回仓库根')
const rPlugins2 = await call('GET', '/plugins')
ok(rPlugins2.body.repoRootSourceDetail === 'patch' && rPlugins2.body.profileRepoRoot === FAKE_REPO.replace(/\\/g, '/'),
  '写回后再查：来源变为 patch（不重复写、可区分来源）')
ok(rInstall.body.files === 3 && rInstall.body.verified === true, 'POST /install 复制并校验通过')
ok(rInstall.body.backup.indexOf('.bak-') > 0, 'POST /install 返回备份路径')
ok(typeof rInstall.body.prunedBackups === 'number', 'POST /install 透传 prunedBackups（备份轮转计数）')

const rBadId = await call('POST', '/install', { id: '../x' }, ORIGIN_HEADERS)
ok(rBadId.status === 200 && rBadId.body.ok === false, 'POST /install 未知 id → 200 ok=false')
ok(!existsSync(join(TMP_ROOT, 'x')) && !existsSync(join(TMP_ROOT, 'escape')), '未知 id 未越界写入')

const rAll = await call('POST', '/install-all', { ids: ['dsh-mermaid', 'nope', 'workspace-tokenpet'] }, ORIGIN_HEADERS)
ok(rAll.status === 200 && rAll.body.results.length === 2, 'POST /install-all 只执行白名单项')
ok(rAll.body.results[0].id === 'workspace-tokenpet' || rAll.body.results[0].id === 'dsh-mermaid', 'install-all 结果为白名单项')
ok(rAll.body.results.map((x) => x.id).join(',') === 'dsh-mermaid,workspace-tokenpet', 'install-all 按固定顺序串行')
ok(rAll.body.rejected.join(',') === 'nope', 'install-all 未知 id 计入 rejected')
ok(rAll.body.ok === true && rAll.body.results.every((x) => x.ok === true), 'install-all ok=true')

const rAllBad = await call('POST', '/install-all', { ids: 1 }, ORIGIN_HEADERS)
ok(rAllBad.status === 200 && rAllBad.body.ok === false && rAllBad.body.results.length === 0, 'install-all ids 非法 → 200 ok=false')
const rAllEmpty = await call('POST', '/install-all', { ids: ['ghost'] }, ORIGIN_HEADERS)
ok(rAllEmpty.body.ok === false && rAllEmpty.body.rejected.join(',') === 'ghost', 'install-all 全部未知 → ok=false / rejected')

const rCross = await call('POST', '/install', { id: 'dsh-experts' }, CROSS_HEADERS)
ok(rCross.status === 403, '跨站 POST /install → 403')
ok(!existsSync(join(FAKE_PROFILE, 'node_modules', 'dsh-experts')), '被拦下的跨站请求没有产生安装')
const rCrossAll = await call('POST', '/install-all', { ids: ['dsh-experts'] }, CROSS_HEADERS)
ok(rCrossAll.status === 403, '跨站 POST /install-all → 403')
const rNoCt = await call('POST', '/install', { id: 'dsh-experts' }, { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' })
ok(rNoCt.status === 403, '缺少 application/json 也被拒（403）')

// 既有路由行为未被改动
const rCheck = await call('GET', '/check')
ok(rCheck.status === 200 && rCheck.body.items.length === 7, '既有 GET /check 仍返回七项（未被改动）')
const rFixCross = await call('POST', '/fix', { id: 'python' }, CROSS_HEADERS)
ok(rFixCross.status === 403, '既有 POST /fix 同源保护仍生效')
const r404 = await call('GET', '/nope')
ok(r404.status === 404, '未知子路径仍 404')

// ── 2026-09-14 增补：repoRoot 写回失败**不阻断安装**（设置与 profile 配置都写不进去时） ──
section('[6b] repoRoot 写回失败不阻断安装（配置文件带 BOM + 无设置服务）')
const RR_BOM_PROFILE = join(TMP_ROOT, 'profile-bom')
mkdirSync(join(RR_BOM_PROFILE, 'node_modules'), { recursive: true })
writeFileSync(join(RR_BOM_PROFILE, 'package.json'), JSON.stringify({
  name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}, null, 2) + '\n')
writeFileSync(join(RR_BOM_PROFILE, 'cordis.patch.yml'), '\uFEFF# 带 BOM 的夹具：本引擎必须拒绝改写\n')
const rrCtx = makeMockCtx()
installApi(rrCtx, {
  platform: 'win32', repoRoot: '', profileDir: RR_BOM_PROFILE,
  moduleDir: join(FAKE_REPO, 'modules', 'work-personal-secretary'),
  commonCandidates: [join(TMP_ROOT, 'nope')], env: {}, now: fixedNow,
})
const rrHandler = prefixHandler(rrCtx)
const rrRes = makeRes()
await rrHandler(makeReq({
  method: 'POST', url: API_ROOT + '/install', body: { id: 'dsh-experts' }, headers: ORIGIN_HEADERS,
}), rrRes)
const rrBody = { status: rrRes.status, body: JSON.parse(rrRes.body) }
ok(rrBody.body.ok === true, '写回失败不阻断：安装本身仍 ok=true')
ok(rrBody.body.repoRootRecorded && rrBody.body.repoRootRecorded.ok === false
  && String(rrBody.body.repoRootRecorded.message).indexOf('不影响安装') >= 0,
  'repoRootRecorded.ok=false 且文案声明「不影响安装」')
ok(existsSync(join(RR_BOM_PROFILE, 'node_modules', 'dsh-experts')), '插件目录照常安装到位（写回失败无副作用）')
const rrGetRes = makeRes()
await rrHandler(makeReq({ method: 'GET', url: API_ROOT + '/repo-root' }), rrGetRes)
const rrGet = JSON.parse(rrGetRes.body)
ok(rrGet.ok === true && rrGet.repoRootSourceDetail === 'ancestor',
  'GET /repo-root 仍可用：来源为自动推导（BOM 文件被忽略）')

section('[7] 原子替换与失败回滚（注入 mock 失败）')

/** 造一个独立的临时 profile（每个原子性用例一份，互不干扰） */
function makeFreshProfile(tag) {
  const dir = join(TMP_ROOT, 'profile-' + tag)
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2) + '\n')
  return dir
}
/** 目录逐文件 SHA256 指纹（相对路径 → hash），用于断言「原目录完好」 */
function fingerprint(dir) {
  if (!existsSync(dir)) return null
  const out = {}
  for (const rel of walkFiles(dir)) out[rel] = sha256File(join(dir, rel))
  return out
}
function sameFingerprint(a, b) {
  if (!a || !b) return a === b
  const ka = Object.keys(a).sort().join(',')
  const kb = Object.keys(b).sort().join(',')
  if (ka !== kb) return false
  return Object.keys(a).every((k) => a[k] === b[k])
}

// ── A. 复制中途失败：原目录必须完好 ──
const profA = makeFreshProfile('atomic-copy')
assertInsideTmp(profA, 'profA')
const seedA = installSubPlugin('dsh-experts', { repoRoot: FAKE_REPO, profileDir: profA, now: fixedNow })
ok(seedA.ok === true && seedA.replaced === false, 'A 前置：首次安装成功（replaced=false）')
const dirA = join(profA, 'node_modules', 'dsh-experts')
const fpA = fingerprint(dirA)
const pkgA = readFileSync(join(profA, 'package.json'), 'utf8')
let copyCalls = 0
const resCopyFail = installSubPlugin('dsh-experts', {
  repoRoot: FAKE_REPO, profileDir: profA, now: fixedNow,
  io: {
    copyFileSync(from, to) {
      copyCalls += 1
      if (copyCalls >= 2) throw new Error('mock 写入失败（模拟磁盘满 / 权限 / 中断）')
      copyFileSync(from, to)
    },
  },
})
ok(resCopyFail.ok === false && resCopyFail.error === '复制失败', 'A 复制中途失败 → ok=false / error=复制失败')
ok(resCopyFail.replaced === false, 'A 未发生替换（replaced=false）')
ok(sameFingerprint(fingerprint(dirA), fpA), 'A 原目录逐文件 SHA256 与失败前一致（未被弄坏）')
ok(!existsSync(dirA + '.wps-new'), 'A 临时目录 .wps-new 已清理')
ok(!existsSync(dirA + '.wps-old'), 'A 未产生 .wps-old')
ok(readFileSync(join(profA, 'package.json'), 'utf8') === pkgA, 'A profile/package.json 未被改动')
ok(String(resCopyFail.rollback).indexOf('未被触碰') >= 0, 'A 返回里说明「目标目录未被触碰」')

// ── B. 校验不通过：不得替换 ──
const profB = makeFreshProfile('atomic-verify')
assertInsideTmp(profB, 'profB')
const seedB = installSubPlugin('dsh-mermaid', { repoRoot: FAKE_REPO, profileDir: profB, now: fixedNow })
ok(seedB.ok === true, 'B 前置：首次安装成功')
const dirB = join(profB, 'node_modules', 'dsh-mermaid')
const fpB = fingerprint(dirB)
const pkgB = readFileSync(join(profB, 'package.json'), 'utf8')
const resVerifyFail = installSubPlugin('dsh-mermaid', {
  repoRoot: FAKE_REPO, profileDir: profB, now: fixedNow,
  io: {
    sha256File(file) {
      return file.indexOf('.wps-new') >= 0 ? 'deadbeef'.repeat(8) : sha256File(file)
    },
  },
})
ok(resVerifyFail.ok === false && resVerifyFail.error === 'SHA256 校验失败', 'B 校验不通过 → ok=false / error=SHA256 校验失败')
ok(resVerifyFail.replaced === false && resVerifyFail.verified === false, 'B 未替换（replaced=false）')
ok(sameFingerprint(fingerprint(dirB), fpB), 'B 原目录逐文件 SHA256 完好')
ok(!existsSync(dirB + '.wps-new') && !existsSync(dirB + '.wps-old'), 'B 临时目录已清理、未产生暂存目录')
ok(readFileSync(join(profB, 'package.json'), 'utf8') === pkgB, 'B profile/package.json 未被改动')

// ── C. 替换阶段失败：回滚后原目录必须完好 ──
const profC = makeFreshProfile('atomic-swap')
assertInsideTmp(profC, 'profC')
const seedC = installSubPlugin('workspace-tokenpet', { repoRoot: FAKE_REPO, profileDir: profC, now: fixedNow })
ok(seedC.ok === true, 'C 前置：首次安装成功')
const dirC = join(profC, 'node_modules', 'workspace-tokenpet')
const fpC = fingerprint(dirC)
const pkgC = readFileSync(join(profC, 'package.json'), 'utf8')
let renameCalls = 0
const resSwapFail = installSubPlugin('workspace-tokenpet', {
  repoRoot: FAKE_REPO, profileDir: profC, now: fixedNow,
  io: {
    renameSync(from, to) {
      renameCalls += 1
      if (renameCalls === 2) throw new Error('mock 替换失败（模拟改名被占用 / 杀软拦截）')
      renameSync(from, to)
    },
  },
})
ok(resSwapFail.ok === false && resSwapFail.error === '替换失败', 'C 替换失败 → ok=false / error=替换失败')
ok(resSwapFail.replaced === false, 'C 未完成替换（replaced=false）')
ok(sameFingerprint(fingerprint(dirC), fpC), 'C 回滚后原目录逐文件 SHA256 完好')
ok(!existsSync(dirC + '.wps-new'), 'C 临时目录 .wps-new 已清理')
ok(!existsSync(dirC + '.wps-old'), 'C 暂存目录已改回原位（无 .wps-old 残留）')
ok(readFileSync(join(profC, 'package.json'), 'utf8') === pkgC, 'C profile/package.json 未被改动')
ok(String(resSwapFail.rollback).length > 0, 'C 返回里给出回滚说明：' + String(resSwapFail.rollback).slice(0, 40))

// ── D. 正常覆盖重装：replaced/overwrite 标记 + 暂存目录删除 ──
const resOver = installSubPlugin('workspace-tokenpet', { repoRoot: FAKE_REPO, profileDir: profC, now: fixedNow })
ok(resOver.ok === true && resOver.replaced === true && resOver.overwrite === true, 'D 同版本重装 → replaced=true / overwrite=true')
ok(resOver.output.indexOf('覆盖重装') >= 0, 'D output 标注覆盖重装')
ok(!existsSync(dirC + '.wps-old') && !existsSync(dirC + '.wps-new'), 'D 成功后暂存目录已删除')
ok(sameFingerprint(fingerprint(dirC), fpC), 'D 替换后内容与源一致（指纹同前）')

// ── E. 前置失败不触碰目标（含 .wps-new） ──
const profE = makeFreshProfile('atomic-preflight')
assertInsideTmp(profE, 'profE')
const bomPkg = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"name":"desktop"}\n', 'utf8')])
writeFileSync(join(profE, 'package.json'), bomPkg)
const resBom = installSubPlugin('dsh-doc-suite', { repoRoot: FAKE_REPO, profileDir: profE, now: fixedNow })
ok(resBom.ok === false && String(resBom.error).indexOf('BOM') >= 0, 'E profile/package.json 带 BOM → 复制前失败')
ok(readFileSync(join(profE, 'package.json')).equals(bomPkg), 'E 前置失败未改写 package.json（BOM 原样保留）')
ok(!existsSync(join(profE, 'node_modules', 'dsh-doc-suite')) && !existsSync(join(profE, 'node_modules', 'dsh-doc-suite.wps-new')), 'E 未触碰目标目录（含 .wps-new）')
ok(resBom.output.indexOf('未触碰任何文件') >= 0, 'E output 说明未触碰任何文件')

const partialRepo = join(TMP_ROOT, 'partial-repo')
mkdirSync(join(partialRepo, 'modules', 'dsh-experts'), { recursive: true })
writeFileSync(join(partialRepo, 'modules', 'dsh-experts', 'index.js'), 'x\n')
mkdirSync(join(partialRepo, 'modules', 'dsh-work-memory'), { recursive: true })
writeFileSync(join(partialRepo, 'modules', 'dsh-work-memory', 'package.json'), '{"name":"dsh-work-memory","version":"1.0.0"}\n')
const resNoSrc = installSubPlugin('dsh-experts', { repoRoot: partialRepo, profileDir: profE, now: fixedNow })
ok(resNoSrc.ok === false && resNoSrc.error === '源子插件不存在', 'E 源缺 package.json → 复制前失败')
ok(!existsSync(join(profE, 'node_modules', 'dsh-experts')) && !existsSync(join(profE, 'node_modules', 'dsh-experts.wps-new')), 'E 源缺失时不触碰目标目录')

// ── F. 上一轮崩溃遗留的 .wps-new 会在安装前被清理 ──
const profF = makeFreshProfile('atomic-residue')
assertInsideTmp(profF, 'profF')
mkdirSync(join(profF, 'node_modules', 'dsh-mermaid.wps-new', 'junk'), { recursive: true })
writeFileSync(join(profF, 'node_modules', 'dsh-mermaid.wps-new', 'junk', 'x.txt'), 'leftover\n')
const resResidue = installSubPlugin('dsh-mermaid', { repoRoot: FAKE_REPO, profileDir: profF, now: fixedNow })
ok(resResidue.ok === true, 'F 安装成功')
ok(!existsSync(join(profF, 'node_modules', 'dsh-mermaid.wps-new', 'junk')), 'F 遗留的 .wps-new 已被清理')
ok(existsSync(join(profF, 'node_modules', 'dsh-mermaid', 'package.json')), 'F 新目录就位')

// ── G. 备份轮转：package.json.bak-* 只保留最近 BACKUP_KEEP 份 ──
const profG = makeFreshProfile('backup-rotate')
assertInsideTmp(profG, 'profG')
for (let i = 1; i <= 12; i++) {
  writeFileSync(join(profG, 'package.json.bak-20260101-000000-' + String(i).padStart(3, '0')), '{"old":' + i + '}\n')
}
const isOwnBak = (n) => /^package\.json\.bak-\d{8}-\d{6}-\d{3}$/.test(n)
const countBaks = () => readdirSync(profG).filter(isOwnBak).sort()
const countAllBaks = () => readdirSync(profG).filter((n) => n.indexOf('package.json.bak-') === 0).length
ok(countBaks().length === 12, 'G 前置：预置 12 份本引擎格式历史备份')
// 再放一份**历史 ISO 风格**备份（真实 profile 里就存在这种）与一份**不可解析时间**的备份
writeFileSync(join(profG, 'package.json.bak-2025-12-31T23-59-59'), '{"iso":true}\n')
writeFileSync(join(profG, 'package.json.bak-dsh-experts'), '{"legacy":true}\n')
ok(BACKUP_KEEP === 10, 'G BACKUP_KEEP = 10')
ok(listBackups(profG).length === 13 && listBackups(profG)[0].name === 'package.json.bak-20260101-000000-012', 'G listBackups 识别本引擎 + 历史 ISO 格式，按时间倒序（新的在前）')
ok(listBackups(profG)[12].name === 'package.json.bak-2025-12-31T23-59-59', 'G 跨格式时间比较正确（更旧的 ISO 备份排在最后）')

const resRot = installSubPlugin('dsh-work-memory', { repoRoot: FAKE_REPO, profileDir: profG, now: fixedNow })
ok(resRot.ok === true && resRot.prunedBackups === 4, 'G 13+1 份候选 → 清理 4 份（prunedBackups=4，含最旧的历史 ISO 备份）')
const baksG = countBaks()
ok(baksG.length === BACKUP_KEEP, 'G 备份只保留最近 ' + BACKUP_KEEP + ' 份')
ok(baksG.indexOf('package.json.bak-20260101-000000-001') === -1 && baksG.indexOf('package.json.bak-20260101-000000-003') === -1, 'G 最旧的 3 份已删除')
ok(baksG.indexOf('package.json.bak-20260101-000000-004') >= 0, 'G 第 4 旧的仍保留（只裁掉更早的）')
ok(baksG.indexOf('package.json.bak-20260102-030405-678') >= 0, 'G 新备份已写入并被保留')
ok(baksG[baksG.length - 1] === 'package.json.bak-20260102-030405-678', 'G 保留的正是最新 ' + BACKUP_KEEP + ' 份（新备份在末位）')
ok(resRot.output.indexOf('备份轮转') >= 0 && resRot.output.indexOf('已清理更早的 4 份') >= 0, 'G output 说明轮转结果（已清理 4 份，保留最近 10 份）')
ok(existsSync(resRot.backup), 'G 返回的 backup 指向最新备份')
ok(countAllBaks() === BACKUP_KEEP + 1, 'G 非本引擎命名的备份不计入轮转（10 份自有 + 1 份遗留）')
ok(existsSync(join(profG, 'package.json.bak-dsh-experts')), 'G 遗留备份 package.json.bak-dsh-experts 未被删除')
ok(!existsSync(join(profG, 'package.json.bak-2025-12-31T23-59-59')), 'G 最旧的历史 ISO 备份已按轮转删除（超出 10 份）')

const resRot2 = installSubPlugin('dsh-work-memory', {
  repoRoot: FAKE_REPO, profileDir: profG, now: new Date(2026, 0, 2, 3, 4, 6, 0),
})
ok(resRot2.ok === true && resRot2.prunedBackups === 1, 'G 第二次安装清理 1 份（11 → 10）')
ok(countBaks().length === BACKUP_KEEP, 'G 第二次安装后仍为 ' + BACKUP_KEEP + ' 份')
ok(countBaks().indexOf('package.json.bak-20260101-000000-004') === -1, 'G 第二轮把上一轮的次旧备份裁掉')
ok(countBaks().indexOf('package.json.bak-20260102-030405-678') >= 0, 'G 上一轮的新备份仍在（严格按时间戳倒序保留）')
ok(countBaks().indexOf('package.json.bak-20260102-030406-000') >= 0, 'G 本轮新备份已写入')
ok(countAllBaks() === BACKUP_KEEP + 1 && existsSync(join(profG, 'package.json.bak-dsh-experts')), 'G 第二轮后遗留备份仍完好')

section('[8] 隔离（绝不触碰真实 profile）与发布件中立性')
ok(TMP_ROOT.indexOf(tmpdir()) === 0, '全部夹具位于 os.tmpdir() 下：' + maskUserPath(TMP_ROOT))
ok(FAKE_PROFILE.indexOf(tmpdir()) === 0 && FAKE_REPO.indexOf(tmpdir()) === 0, 'repoRoot / profileDir 均在 tmp 下')
const realAfter = snapshot(realProfilePkg)
ok(sameSnapshot(realBefore, realAfter), '真实 profile/package.json 只读快照前后一致（size + mtimeMs 未变）')
ok(true, realBefore === null ? '真实 profile 不存在（跳过只读快照比对）' : '真实 profile 只被 statSync 读取，从未打开写入')
for (const dir of readdirSync(join(FAKE_PROFILE, 'node_modules'))) assertInsideTmp(join(FAKE_PROFILE, 'node_modules', dir), 'installed')
ok(true, '写入目标全部通过 assertInsideTmp 复核')

// 中立性用「运行时才知道的本机用户名」做检测——测试脚本自身不写死任何个人化字符串
const localUserSegment = String(basename(homedir()) || '')
const srcInstall = readFileSync(join(MODULE_DIR, 'lib', 'install.js'), 'utf8')
const srcApi = readFileSync(join(MODULE_DIR, 'lib', 'api.js'), 'utf8')
const srcHost = readFileSync(join(MODULE_DIR, 'lib', 'index.js'), 'utf8')
ok(localUserSegment.length > 0 && srcInstall.indexOf(localUserSegment) === -1, 'install.js 不含本机用户名片段')
ok(srcApi.indexOf(localUserSegment) === -1 && srcHost.indexOf(localUserSegment) === -1, 'api.js / index.js 不含本机用户名片段')
const absPathLiteral = /['"][A-Za-z]:\\/
ok(!absPathLiteral.test(srcInstall) && !absPathLiteral.test(srcApi) && !absPathLiteral.test(srcHost), 'lib/ 新增代码不含写死的盘符绝对路径字面量')
ok(srcInstall.indexOf('Set-Content') === -1 && srcApi.indexOf('Set-Content') === -1, '未使用 PowerShell 文本写入命令')
ok(srcInstall.indexOf('writeFileSync(') > 0, '改用 Node fs.writeFileSync 写入（UTF-8 无 BOM）')
ok(srcInstall.indexOf('execFile') === -1 && srcInstall.indexOf('execSync') === -1 && srcInstall.indexOf('spawn') === -1, '安装引擎不调用任何外部命令')

// cordis config 接入（apply 可接受可选 repoRoot 且不抛）
const ctxHost = makeMockCtx()
let hostDisposer = null
try {
  hostDisposer = applyHost(ctxHost, { repoRoot: TMP_ROOT, selfCheckOnStartup: false })
  ok(typeof hostDisposer === 'function', 'apply(ctx, { repoRoot }) 正常挂载并返回 disposer')
} catch (err) {
  ok(false, 'apply(ctx, { repoRoot }) 抛出异常：' + (err && err.message ? err.message : err))
}
try { if (hostDisposer) hostDisposer() } catch (e) { /* best-effort */ }

// ───────────────────── [9] 桌宠素材部署（workspace-tokenpet 专属） ─────────────────────

section('[9] 桌宠素材部署（只补缺失 / 绝不覆盖 / 不影响安装结果）')
const SKIN_REPO = join(TMP_ROOT, 'repo-skins')
const SKIN_PROFILE = join(TMP_ROOT, 'profile-skins')
const SKIN_PROFILE2 = join(TMP_ROOT, 'profile-skins2')
const SKIN_HOME = join(TMP_ROOT, 'dshhome')
const SKIN_HOME2 = join(TMP_ROOT, 'dshhome2')

function makeEmptyProfile(dir) {
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2) + '\n')
}

// 专用假仓库：workspace-tokenpet 带两套套装（各 manifest.json + 两条条带）
{
  const dir = join(SKIN_REPO, 'modules', 'workspace-tokenpet')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'workspace-tokenpet', version: '5.5.5', main: 'lib/index.js' }, null, 2) + '\n')
  writeFileSync(join(dir, 'lib', 'index.js'), 'export const name = "workspace-tokenpet"\n')
  for (const pack of ['lina-pure', 'lina-lazy']) {
    const p = join(dir, 'skins', pack)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: pack, name: pack, animations: { idle: { file: 'idle.webp', frames: 4 } } }, null, 2) + '\n')
    writeFileSync(join(p, 'idle.webp'), 'fake-webp-' + pack + '\n')
    writeFileSync(join(p, 'preview.webp'), 'preview-' + pack + '\n')
  }
  makeEmptyProfile(SKIN_PROFILE)
  makeEmptyProfile(SKIN_PROFILE2)
}
const skinTarget = join(SKIN_HOME, 'data', 'workspace-tokenpet', 'skins')
assertInsideTmp(SKIN_REPO, 'skinRepo')
assertInsideTmp(SKIN_HOME, 'skinHome')

const resSkin = installSubPlugin(PET_SKINS_PLUGIN_ID, { repoRoot: SKIN_REPO, profileDir: SKIN_PROFILE, dshHome: SKIN_HOME, now: fixedNow })
ok(resSkin.ok === true, '装 workspace-tokenpet 成功（素材部署不改变安装结果）')
ok(Boolean(resSkin.skins) && resSkin.skins.ok === true, 'skins.ok=true')
ok(resSkin.skins.deployed.join(',') === 'lina-lazy,lina-pure', '两套套装都部署（按名排序）：' + resSkin.skins.deployed.join(','))
ok(resSkin.skins.files === 6, '部署文件数 = 6（每套 manifest+idle+preview）：' + resSkin.skins.files)
ok(resSkin.skins.kept.length === 0, '首次部署无跳过项')
ok(existsSync(join(skinTarget, 'lina-pure', 'manifest.json')) && existsSync(join(skinTarget, 'lina-lazy', 'idle.webp')), '运行时素材目录出现两套套装')
assertInsideTmp(skinTarget, 'skinTarget')
ok(readFileSync(join(skinTarget, 'lina-pure', 'idle.webp'), 'utf8') === 'fake-webp-lina-pure\n', '套装文件逐字节复制')
ok(resSkin.output.indexOf('桌宠素材：已部署 2 套') >= 0, '安装回显含素材部署结果')

// 使用者改过的素材：重装绝不覆盖（只补新增套装）
writeFileSync(join(skinTarget, 'lina-pure', 'idle.webp'), '使用者自己改过的内容\n')
const resSkin2 = installSubPlugin(PET_SKINS_PLUGIN_ID, { repoRoot: SKIN_REPO, profileDir: SKIN_PROFILE, dshHome: SKIN_HOME, now: fixedNow })
ok(resSkin2.ok === true, '重复安装仍成功')
ok(resSkin2.skins.deployed.length === 0 && resSkin2.skins.kept.join(',') === 'lina-lazy,lina-pure', '目标已存在 → 两套全部跳过：' + resSkin2.skins.kept.join(','))
ok(readFileSync(join(skinTarget, 'lina-pure', 'idle.webp'), 'utf8') === '使用者自己改过的内容\n', '使用者改过的素材**未被覆盖**')

// 源模块没有 skins → skipped，且不影响安装
const resSkin3 = installSubPlugin(PET_SKINS_PLUGIN_ID, { repoRoot: FAKE_REPO, profileDir: SKIN_PROFILE2, dshHome: SKIN_HOME2, now: fixedNow })
ok(resSkin3.ok === true, '源无 skins 时安装仍成功')
ok(Boolean(resSkin3.skins) && resSkin3.skins.skipped === true, '素材部署标记 skipped：' + (resSkin3.skins ? resSkin3.skins.reason : '(无 skins 字段)'))
ok(!existsSync(join(SKIN_HOME2, 'data', 'workspace-tokenpet', 'skins', 'lina-pure')), '未凭空造出套装内容')

// 非 workspace-tokenpet 子插件：不做素材部署
const resOther = installSubPlugin('dsh-experts', { repoRoot: FAKE_REPO, profileDir: SKIN_PROFILE2, dshHome: SKIN_HOME2, now: fixedNow })
ok(resOther.ok === true && resOther.skins === null, '非 workspace-tokenpet 结果 skins=null（形状稳定）')
ok(installSubPlugin('dsh-evil', { repoRoot: FAKE_REPO, profileDir: SKIN_PROFILE2 }).skins === null, '失败分支同样带 skins=null（形状稳定）')
ok(typeof resSkin.skins.target === 'string' && resSkin.skins.target.indexOf('workspace-tokenpet') >= 0, 'skins.target 指向运行时素材目录')

// resolveDshHome：显式 → 环境变量 → 默认 ~/.dsh（与 basedeck 同源）
ok(resolveDshHome({ dshHome: SKIN_HOME }) === SKIN_HOME, 'resolveDshHome 优先显式 dshHome')
ok(resolveDshHome({ env: { DSH_HOME: SKIN_HOME } }) === SKIN_HOME, 'resolveDshHome 次选环境变量 DSH_HOME')
ok(resolveDshHome({ env: {} }) === join(homedir(), '.dsh'), 'resolveDshHome 兜底 ~/.dsh')

// deployPetSkins 直接调用：坏源目录不抛异常
ok(deployPetSkins('', '', {}).skipped === true, 'deployPetSkins 空源 → skipped 不抛错')
ok(describePetSkins(null) === '不适用', 'describePetSkins(null) 回显「不适用」')

// ── [9b] 数据目录迁移：新址缺套装而旧址（data/dsh-token-pet/skins）有 → 复制迁移 ──
const SKIN_HOME3 = join(TMP_ROOT, 'dshhome3')
const SKIN_PROFILE3 = join(TMP_ROOT, 'profile-skins3')
const legacySkins = join(SKIN_HOME3, 'data', 'dsh-token-pet', 'skins')
const newSkins = join(SKIN_HOME3, 'data', 'workspace-tokenpet', 'skins')
{
  mkdirSync(join(legacySkins, 'lina-pure'), { recursive: true })
  writeFileSync(join(legacySkins, 'lina-pure', 'manifest.json'), '{"id":"lina-pure"}\n')
  writeFileSync(join(legacySkins, 'lina-pure', 'idle.webp'), 'legacy-lina-pure\n')
  // 旧址还多出一套模块里没有的套装（同样应迁移过来）
  mkdirSync(join(legacySkins, 'lina-custom'), { recursive: true })
  writeFileSync(join(legacySkins, 'lina-custom', 'manifest.json'), '{"id":"lina-custom"}\n')
  writeFileSync(join(legacySkins, 'lina-custom', 'idle.webp'), 'legacy-lina-custom\n')
  // 新址已有 lina-lazy（使用者自己放/改过）→ 必须保持不动
  mkdirSync(join(newSkins, 'lina-lazy'), { recursive: true })
  writeFileSync(join(newSkins, 'lina-lazy', 'idle.webp'), '使用者版本\n')
  makeEmptyProfile(SKIN_PROFILE3)
  assertInsideTmp(SKIN_HOME3, 'skinHome3')
}
const resMig = installSubPlugin(PET_SKINS_PLUGIN_ID, { repoRoot: SKIN_REPO, profileDir: SKIN_PROFILE3, dshHome: SKIN_HOME3, now: fixedNow })
ok(resMig.ok === true, '旧址迁移场景：安装成功')
ok(resMig.skins.migrated.join(',') === 'lina-custom,lina-pure', '旧址同名套装被复制迁移：' + resMig.skins.migrated.join(','))
ok(resMig.skins.deployed.length === 0, '旧址优先：不再从模块内重复部署这些套装')
ok(resMig.skins.kept.join(',') === 'lina-lazy', '新址已有套装不覆盖：' + resMig.skins.kept.join(','))
ok(readFileSync(join(newSkins, 'lina-pure', 'idle.webp'), 'utf8') === 'legacy-lina-pure\n', '迁移内容逐字节来自旧址')
ok(readFileSync(join(legacySkins, 'lina-pure', 'idle.webp'), 'utf8') === 'legacy-lina-pure\n', '旧址数据保留（复制而非移动）')
ok(readFileSync(join(newSkins, 'lina-lazy', 'idle.webp'), 'utf8') === '使用者版本\n', '新址使用者内容未被迁移覆盖')
ok(resMig.output.indexOf('已从旧址迁移 2 套') >= 0, '安装回显含迁移结果')
const resMig2 = installSubPlugin(PET_SKINS_PLUGIN_ID, { repoRoot: SKIN_REPO, profileDir: SKIN_PROFILE3, dshHome: SKIN_HOME3, now: fixedNow })
ok(resMig2.skins.migrated.length === 0 && resMig2.skins.kept.length === 3, '二次安装：3 套全部已在 → 全跳过（迁移不重复）')

// ───────────────────── 收尾 ─────────────────────
rmSync(TMP_ROOT, { recursive: true, force: true })
ok(!existsSync(TMP_ROOT), '临时目录已清理')

console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 存在失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败')
console.log('（本次运行未写入任何真实 profile：全部夹具都建在 os.tmpdir() 下并已删除）')
if (fail > 0) process.exitCode = 1
