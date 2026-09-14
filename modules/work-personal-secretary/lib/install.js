/**
 * work-personal-secretary —— 子插件安装引擎（安装器第三步：安装子插件）
 *
 * 职责：把**集成体仓库自带的五个子插件**（<repoRoot>/modules/<id>）安装到当前 profile：
 *   1. 解析集成体仓库根（2026-09-14 起四层）：① 设置页设置值（settingsRoot，最高优先级）
 *      ② 部署配置层（configRoot：组合配置 / cordis.patch.yml 经宿主注入的 config）
 *      ③ profile 的 cordis.patch.yml 里显式写的 repoRoot（readProfileRepoRoot）
 *      ④ 相对探测（本体模块目录逐级向上找含 modules/ 的目录）+ 常见位置；都不成立 → null；
 *   2. 只读列出五个子插件的 bundled / installed 版本与 installMode；
 *   3. 安装（**原子替换**，原目录保留到最后一刻）：
 *      复制到同级临时目录 <id>.wps-new（排除 node_modules/.git/__pycache__）
 *      → 在临时目录上逐文件 SHA256 校验 → 替换（<id> → <id>.wps-old，<id>.wps-new → <id>）
 *      → 更新 profile 的 package.json（写前备份、写后 JSON + BOM 校验）→ 删除 <id>.wps-old。
 *      **任何一步失败都回滚**：临时目录清理、旧目录改回原位；package.json 更新失败时目录也回滚，
 *      绝不出现「删除成功、复制失败」导致使用者原有插件目录被弄坏的情形。
 *
 * 红线（本文件）：
 * 1. **来源只由服务端拼接**：<repoRoot>/modules/<id>；id 只用于查白名单表，
 *    **绝不接受客户端传入的源 / 目标路径**。
 * 2. 路径解析（resolveRepoRoot / listSubPlugins）**只读**；会写盘的只有 installSubPlugin
 *    与 writeProfileRepoRoot（把 repoRoot 写回 profile 的 cordis.patch.yml，写前备份；由 api.js
 *    在「已安装但仓库根从未登记」时调用，失败只 warn 不阻断），
 *    写入范围仅限 <profileDir>/node_modules/<id>（含 .wps-new / .wps-old 暂存名）、
 *    <profileDir>/package.json（含 .bak- 备份）、<profileDir>/cordis.patch.yml（含 .bak- 备份），
 *    以及**仅当安装 workspace-tokenpet 时**的桌宠素材目录
 *    <dshHome>/data/workspace-tokenpet/skins/<套装>（**只补缺失、绝不覆盖**使用者已有套装；
 *    新址缺套装而旧址 <dshHome>/data/dsh-token-pet/skins 有同名套装时**复制迁移**，旧址数据保留）。
 * 3. 所有文本写入一律 Node fs（writeFileSync）+ UTF-8 **无 BOM**；不使用 PowerShell 的文本写入命令
 *    （其编码开关会引入 BOM，本引擎与自测都显式禁止）。
 * 4. 发布件中立：不写死任何使用者信息 / 本机绝对路径 / 称呼。
 *
 * 契约字段说明：
 * - 接口契约的 repoRootSource 只有 config / relative / none 三个值，而解析优先级有四种来源；
 *   本模块把「常见位置」归入 relative，并用附加字段 sourceDetail ∈
 *   settings|config|patch|ancestor|common|none 保留精确来源。
 * - **installed 判定（2026-09-14 增补）**：installed = registered（dependencies[id]）+ bundleHit
 *   （dsh.profile.bundles 命中）+ dirPresent（<profileDir>/node_modules/<id> 在）；
 *   items[] 另增 registered / bundleHit / dirPresent 三个只读字段（既有字段一律不动）。
 * - 安装结果在契约字段之外增加 replaced（目标原本存在并被替换）与 overwrite（本次是对「已是最新版本」的
 *   强制覆盖重装）两个布尔字段，供面板标注；前端可忽略。
 *
 * @module work-personal-secretary/install
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { truncate } from './probe.js'

/** 本模块根目录（<repoRoot>/modules/work-personal-secretary）；相对探测的默认起点 */
export const MODULE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/** 集成体仓库内子插件的父目录名 */
export const MODULES_DIR_NAME = 'modules'

/** 本体（集成体）包名 / 设置命名空间名（两处必须一致） */
export const MODULE_ID = 'work-personal-secretary'

/** profile 的用户覆盖层文件名（既有机制：按 id 定向覆盖插件 config） */
export const PROFILE_PATCH_FILE = 'cordis.patch.yml'

/** 复制时排除的目录名（node_modules / .git / __pycache__） */
export const EXCLUDED_DIRS = ['node_modules', '.git', '__pycache__']

/** 相对探测向上查找的最大层数（防止在极深目录树里长跑） */
export const MAX_ANCESTOR_LEVELS = 8

/** 安装输出回显上限（与 /fix 契约的 8000 保持一致） */
export const INSTALL_OUTPUT_LIMIT = 8000

/** profile/package.json 的备份后缀（备份名 = package.json.bak-<时间戳>） */
export const BACKUP_SUFFIX = '.bak-'

/** 备份保留份数：写入新备份前清理更早的，保证装完 profile 里最多留这么多份 */
export const BACKUP_KEEP = 10

/** 本引擎备份名的时间戳格式（YYYYMMDD-HHmmss-SSS） */
export const BACKUP_STAMP_RE = /^\d{8}-\d{6}-\d{3}$/

/**
 * 轮转可识别的**历史 / 其它实现**备份名格式（如 package.json.bak-2026-09-13T08-34-17）。
 * 凡是能解析出「年月日时分秒」的备份都参与轮转（按时间倒序，只保留最近 BACKUP_KEEP 份）；
 * **解析不出时间的备份名一律不列、不删**（宁可少清理，也不误删使用者或宿主自己留下的文件）。
 */
export const BACKUP_STAMP_ALT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/

/**
 * 把备份名后缀解析成可比较的时间键（等长 YYYYMMDDHHmmssSSS）；无法解析返回 ''。
 * 支持：① 本引擎 20260102-030405-678 ② 历史 2026-09-13T08-34-17（毫秒补 000）。
 */
export function backupStampKey(stamp) {
  const s = String(stamp == null ? '' : stamp)
  const own = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})$/.exec(s)
  if (own) return own[1] + own[2] + own[3] + own[4] + own[5] + own[6] + own[7]
  const alt = BACKUP_STAMP_ALT_RE.exec(s)
  if (alt) return alt[1] + alt[2] + alt[3] + alt[4] + alt[5] + alt[6] + '000'
  return ''
}

/** 原子替换：新内容先落到同级临时目录 <id>.wps-new（校验通过后才动目标） */
export const ATOMIC_NEW_SUFFIX = '.wps-new'

/** 原子替换：旧目录暂存名 <id>.wps-old（替换成功后删除；失败时改名回来） */
export const ATOMIC_OLD_SUFFIX = '.wps-old'

/** 唯一带形象素材的子插件：只有它在安装后需要把套装部署到 DSH 运行时目录 */
export const PET_SKINS_PLUGIN_ID = 'workspace-tokenpet'

/** 套装素材在子插件模块内的目录名（<repoRoot>/modules/workspace-tokenpet/skins） */
export const SKINS_DIR_NAME = 'skins'

/** 桌宠运行时读取的素材目录（与 workspace-tokenpet 的 skinsDir 完全一致）：<dsh home>/data/workspace-tokenpet/skins */
export const PET_SKINS_SUBDIR = join('data', 'workspace-tokenpet', 'skins')

/**
 * **旧址**：独立化之前 dsh-token-pet 的运行时素材目录（<dsh home>/data/dsh-token-pet/skins）。
 * 新址缺某套装而旧址有同名套装时，从旧址**复制迁移**到新址：旧址数据保留、不删除，
 * 新址已有内容绝不覆盖。旧 id 只在此常量与迁移代码里出现（数据搬家用，不是依赖）。
 */
export const LEGACY_PET_SKINS_PLUGIN_ID = 'dsh-token-pet'
export const LEGACY_PET_SKINS_SUBDIR = join('data', 'dsh-token-pet', 'skins')

/** 五个子插件 id 的**唯一来源**（顺序 = 面板展示顺序 = /install-all 的串行顺序，接口契约定死） */
export const SUB_PLUGIN_IDS = [
  { id: 'dsh-work-memory', label: '记忆库', kind: '自研' },
  { id: 'dsh-doc-suite', label: '文档能力', kind: '自研' },
  { id: 'dsh-experts', label: '专家库', kind: '自研' },
  { id: 'dsh-mermaid', label: '思维链与图表', kind: '第三方' },
  { id: 'workspace-tokenpet', label: '桌面形象', kind: '独立项目模块' },
]

/** 五个 id 的字符串数组（查表 / 回显用） */
export const SUB_PLUGIN_ID_LIST = SUB_PLUGIN_IDS.map((s) => s.id)

// ───────────────────────────── 小工具 ─────────────────────────────

/** 统一输出 POSIX 风格路径（避免 JSON 里出现转义反斜杠；fs 两种分隔符都接受） */
export function posix(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/')
}

/** 归一化目录入参（去空白 + resolve；空值返回空串） */
function normalizeDir(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return ''
  try {
    return resolve(s)
  } catch (e) {
    return s
  }
}

/**
 * 可注入的 IO 层（便于自测注入失败；默认即 node:fs 原函数）。
 * 只覆盖安装流程真正用到的几个写操作，避免 mock 面积过大。
 */
export function resolveIo(options) {
  const o = (options && options.io) || {}
  return {
    copyFileSync: typeof o.copyFileSync === 'function' ? o.copyFileSync : copyFileSync,
    renameSync: typeof o.renameSync === 'function' ? o.renameSync : renameSync,
    rmSync: typeof o.rmSync === 'function' ? o.rmSync : rmSync,
    mkdirSync: typeof o.mkdirSync === 'function' ? o.mkdirSync : mkdirSync,
    writeFileSync: typeof o.writeFileSync === 'function' ? o.writeFileSync : writeFileSync,
    sha256File: typeof o.sha256File === 'function' ? o.sha256File : sha256File,
  }
}

/** 按 id 取白名单条目（null = 不在五个固定 id 内） */
export function subPluginSpec(id) {
  const safe = typeof id === 'string' ? id.trim() : ''
  for (const s of SUB_PLUGIN_IDS) {
    if (s.id === safe) return s
  }
  return null
}

/** 是否 ≤ 五个固定 id 之一（唯一白名单入口） */
export function isSubPluginId(id) {
  return subPluginSpec(id) !== null
}

/**
 * 桌宠素材目录的 DSH home 解析：options.dshHome → 环境变量 DSH_HOME → ~/.dsh。
 * 与 lib/basedeck.js 的 resolveDshHome 同源（两处口径必须一致，改一处要同步另一处）。
 */
export function resolveDshHome(options = {}) {
  const explicit = normalizeDir(options.dshHome)
  if (explicit) return explicit
  const env = options.env || process.env
  const fromEnv = String((env && env.DSH_HOME) || '').trim()
  if (fromEnv) return normalizeDir(fromEnv) || fromEnv
  return join(homedir(), '.dsh')
}

/** 错误信息压成一行（回显用，避免多行堆栈进面板） */
function skinsErrText(err) {
  const s = String(err && err.message ? err.message : err)
  return s.split('\n')[0].slice(0, 200)
}

/**
 * 把子插件模块内的套装素材部署到 DSH 运行时素材目录（**只补缺失、绝不覆盖**）。
 *
 * 为什么必须做：桌宠插件运行时只从 <dsh home>/data/workspace-tokenpet/skins/ 读套装
 * （见 workspace-tokenpet/lib/skins.js 的 skinsDir），模块内的 skins/ **运行时不会被读取**；
 * 安装器若只复制模块，使用者装完只剩 client 内置的默认形象 —— 自研套装全部不出现
 * （2026-09-13 灰度测试实测：新环境里两套套装都没加载）。
 *
 * **落地顺序（新址优先）**：① 新址已有该套装 → 跳过（使用者可能改过素材，绝不覆盖）；
 * ② 新址缺、但**旧址** <dsh home>/data/dsh-token-pet/skins 有同名套装 → 从旧址**复制迁移**
 *   （旧址数据保留，不移动、不删除；只补新址缺的那一套）；③ 都缺 → 从模块内随包素材复制部署。
 *
 * 红线：① 目标已存在的套装**一律跳过**（使用者可能改过素材，绝不覆盖）；
 *      ② 单套失败只清理该套的半成品，**不影响插件安装结果**（插件已装好，素材可重试）；
 *      ③ 源目录与旧址都没有套装时视为 skipped，不算错误。
 * @returns {{ok:boolean, skipped:boolean, reason:string, source:string, legacy:string, target:string,
 *            deployed:string[], migrated:string[], kept:string[], failed:string[], files:number}}
 */
export function deployPetSkins(sourceDir, targetDir, options = {}) {
  const io = resolveIo(options)
  const src = normalizeDir(sourceDir)
  const dst = normalizeDir(targetDir)
  // 旧址（独立化之前 dsh-token-pet 的运行时目录）：只用于**复制迁移**，绝不作为删除源
  const legacy = normalizeDir(options.legacyDir)
  const result = {
    ok: false,
    skipped: false,
    reason: '',
    source: posix(src),
    legacy: posix(legacy),
    target: posix(dst),
    deployed: [],
    migrated: [],
    kept: [],
    failed: [],
    files: 0,
  }
  if (!dst) {
    result.skipped = true
    result.reason = '未解析出运行时素材目录'
    return result
  }
  /** 列出某目录下带 manifest.json 的套装名（目录不存在 / 读不了 → 空数组，不抛） */
  const packsIn = (dir) => {
    if (!dir || !existsSync(dir)) return []
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'manifest.json')))
        .map((e) => e.name)
    } catch (err) {
      return []
    }
  }
  const sourcePacks = packsIn(src)
  const legacyPacks = (legacy && legacy !== dst) ? packsIn(legacy) : []
  const packs = Array.from(new Set(sourcePacks.concat(legacyPacks))).sort()
  if (packs.length === 0) {
    result.skipped = true
    result.reason = (!src || !existsSync(src))
      ? '模块内没有 skins 目录（该模块不含套装素材）'
      : '模块内没有带 manifest.json 的套装'
    return result
  }
  try {
    io.mkdirSync(dst, { recursive: true })
  } catch (err) {
    result.reason = '无法创建素材目录：' + skinsErrText(err)
    return result
  }
  for (const pack of packs) {
    const packDst = join(dst, pack)
    if (existsSync(packDst)) {
      result.kept.push(pack) // 新址已有该套装（新址优先）：绝不覆盖
      continue
    }
    // ① 新址缺 → ② 旧址同名套装**复制迁移** → ③ 模块内随包素材复制部署
    let packSrc = ''
    let fromLegacy = false
    if (legacyPacks.indexOf(pack) >= 0) {
      packSrc = join(legacy, pack)
      fromLegacy = true
    } else if (sourcePacks.indexOf(pack) >= 0) {
      packSrc = join(src, pack)
    } else {
      continue
    }
    const files = walkFiles(packSrc)
    try {
      for (const rel of files) {
        const target = join(packDst, rel)
        io.mkdirSync(dirname(target), { recursive: true })
        io.copyFileSync(join(packSrc, rel), target)
      }
      if (fromLegacy) result.migrated.push(pack)
      else result.deployed.push(pack)
      result.files += files.length
    } catch (err) {
      try { io.rmSync(packDst, { recursive: true, force: true }) } catch (e2) { /* best-effort */ }
      result.failed.push(pack)
      if (!result.reason) result.reason = '套装 ' + pack + ' 部署失败：' + skinsErrText(err)
    }
  }
  result.ok = result.failed.length === 0
  return result
}

/** 素材部署结果的一行人话（进安装回显） */
export function describePetSkins(skins) {
  if (!skins) return '不适用'
  if (skins.skipped) return '跳过（' + skins.reason + '）'
  const migrated = skins.migrated || []
  if (skins.deployed.length === 0 && migrated.length === 0 && skins.kept.length === 0
    && skins.failed.length === 0) return '跳过（无可部署套装）'
  const bits = []
  if (skins.deployed.length > 0) {
    bits.push('已部署 ' + skins.deployed.length + ' 套（' + skins.deployed.join(', ')
      + '，' + skins.files + ' 个文件）')
  }
  if (migrated.length > 0) {
    bits.push('已从旧址迁移 ' + migrated.length + ' 套（' + migrated.join(', ') + '，旧数据保留）')
  }
  if (skins.kept.length > 0) {
    bits.push('已存在跳过 ' + skins.kept.length + ' 套（' + skins.kept.join(', ') + '，不覆盖）')
  }
  if (skins.failed.length > 0) bits.push('失败 ' + skins.failed.length + ' 套（' + skins.failed.join(', ') + '）')
  return bits.join('；') + ' → ' + skins.target
}

/** 检测 BOM。返回 'UTF-8' / 'UTF-16LE' / 'UTF-16BE' / 'UTF-32LE' / ''（无 BOM）。 */
export function detectBom(buf) {
  if (!buf || buf.length < 2) return ''
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'UTF-8'
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return (buf.length >= 4 && buf[2] === 0x00 && buf[3] === 0x00) ? 'UTF-32LE' : 'UTF-16LE'
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'UTF-16BE'
  return ''
}

/** 读文件（返回 buffer / utf8 文本 / BOM 标记；读不到返回 null，不抛） */
function readUtf8(file) {
  try {
    const buffer = readFileSync(file)
    return { buffer: buffer, text: buffer.toString('utf8'), bom: detectBom(buffer) }
  } catch (e) {
    return null
  }
}

/** 读 package.json 的 version（读不到 / 无 version → null，不抛） */
export function readPackageVersion(pkgFile) {
  const raw = readUtf8(pkgFile)
  if (!raw) return null
  try {
    const text = raw.bom === 'UTF-8' ? raw.text.replace(/^\uFEFF/, '') : raw.text
    const pkg = JSON.parse(text)
    const v = String(pkg && pkg.version ? pkg.version : '').trim()
    return v || null
  } catch (e) {
    return null
  }
}

/** 单文件 SHA256（十六进制小写；读不到返回 null） */
export function sha256File(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch (e) {
    return null
  }
}

/** 备份时间戳：YYYYMMDD-HHmmss-SSS（Windows 文件名安全，无冒号） */
export function backupStamp(date = new Date()) {
  const p = (n, w) => String(n).padStart(w || 2, '0')
  return String(date.getFullYear()) + p(date.getMonth() + 1) + p(date.getDate()) + '-'
    + p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds()) + '-'
    + p(date.getMilliseconds(), 3)
}

// ───────────────────── 集成体仓库根解析（只读） ─────────────────────

/**
 * 常见位置候选（使用者主目录下的约定目录 × 仓库名）。
 * 仅作只读探测；不接受任何外部输入拼接。
 */
export function commonRepoRootCandidates(env = process.env) {
  const source = env || {}
  const home = String(source.USERPROFILE || source.HOME || '').trim() || homedir()
  const names = ['work-personal-secretary', 'dsh-work-personal-secretary']
  const bases = [
    home,
    join(home, 'Documents'),
    join(home, 'Downloads'),
    join(home, 'Desktop'),
    join(home, 'repos'),
    join(home, 'Projects'),
    join(home, 'source', 'repos'),
  ]
  const out = []
  for (const b of bases) {
    for (const n of names) out.push(join(b, n))
  }
  return out
}

/**
 * 候选目录是否为集成体仓库根：存在 <dir>/modules 目录，且其中至少一个子插件带 package.json。
 */
export function isRepoRoot(dir, options = {}) {
  const target = normalizeDir(dir)
  if (!target) return false
  try {
    if (!statSync(target).isDirectory()) return false
    if (!statSync(join(target, MODULES_DIR_NAME)).isDirectory()) return false
  } catch (e) {
    return false
  }
  const ids = Array.isArray(options.ids) && options.ids.length > 0 ? options.ids : SUB_PLUGIN_ID_LIST
  for (const id of ids) {
    try {
      if (existsSync(join(target, MODULES_DIR_NAME, id, 'package.json'))) return true
    } catch (e) { /* best-effort */ }
  }
  return false
}

/**
 * 去 YAML 单/双引号（路径值可能带引号）。
 */
function unquoteYaml(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (s.length >= 2 && ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"'))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * 在 cordis.patch.yml 文本里定位本体的 patch 条目（纯文本行级解析，**不引入 YAML 依赖**）。
 * 只认数组条目 `- id: <id>` 及其下的 `config:` 段。
 *
 * @returns {{entryLine:number, entryIndent:number, configLine:number, configIndent:number,
 *            repoRootLine:number, repoRootIndent:number, repoRootValue:string, eol:string, lines:string[]}}
 *          entryLine / configLine / repoRootLine 为 -1 表示未找到
 */
export function locatePatchEntry(text, id = MODULE_ID) {
  const src = String(text == null ? '' : text)
  const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
  const lines = src.split(/\r?\n/)
  const wantId = String(id == null ? '' : id).trim()
  const indentOf = (line) => line.length - line.trimStart().length
  const info = {
    entryLine: -1, entryIndent: -1,
    configLine: -1, configIndent: -1,
    repoRootLine: -1, repoRootIndent: -1, repoRootValue: '',
    eol: eol, lines: lines,
  }
  let active = false
  let inConfig = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.charAt(0) === '#') continue
    const indent = indentOf(raw)
    const body = trimmed
    const idMatch = /^-\s*id\s*:\s*(.*)$/.exec(body)
    if (idMatch) {
      active = unquoteYaml(idMatch[1]) === wantId
      inConfig = false
      if (active) {
        info.entryLine = i
        info.entryIndent = indent
      }
      continue
    }
    if (!active) continue
    if (indent <= info.entryIndent) { active = false; inConfig = false; continue }
    if (/^config\s*:/.test(body)) {
      info.configLine = i
      info.configIndent = indent
      inConfig = true
      continue
    }
    if (inConfig && indent > info.configIndent) {
      const m = /^repoRoot\s*:\s*(.*)$/.exec(body)
      if (m) {
        info.repoRootLine = i
        info.repoRootIndent = indent
        info.repoRootValue = unquoteYaml(m[1])
      }
      continue
    }
    if (inConfig && indent <= info.configIndent) inConfig = false
  }
  return info
}

/**
 * 读 profile 用户覆盖层 cordis.patch.yml 里本体的 repoRoot（**只读**）。
 * 解析不到 / 文件不存在 / 不是数组条目 → 返回空串（调用方继续降级探测）。
 */
export function readProfileRepoRoot(profileDir, id = MODULE_ID) {
  const dir = normalizeDir(profileDir)
  if (!dir) return ''
  const raw = readUtf8(join(dir, PROFILE_PATCH_FILE))
  if (!raw || !raw.text || raw.bom) return ''
  const info = locatePatchEntry(raw.text, id)
  return normalizeDir(info.repoRootValue) || info.repoRootValue
}

/**
 * 把集成体仓库根写回 profile 的 cordis.patch.yml（**写入前备份；失败只返回错误，绝不抛**）。
 *
 * - 已有 `- id: work-personal-secretary` 条目：在该条目 config 段内替换 / 追加 repoRoot；
 * - 有条目但没有 config 段：在条目下补 config + repoRoot；
 * - 没有条目：文件末尾追加最小条目（保留原文件内容与 EOL 风格）；
 * - 值未变化 → changed=false，**不写盘、不备份**；
 * - 带 BOM 的文件**拒绝写入**（与 profile/package.json 同纪律）。
 *
 * @param {string} profileDir
 * @param {string} repoRoot 目标仓库根（非空）
 * @param {{now?:(Date|Function), io?:object, id?:string}} [options]
 * @returns {{ok:boolean, changed:boolean, file:string, backup:string, error?:string}}
 */
export function writeProfileRepoRoot(profileDir, repoRoot, options = {}) {
  const io = resolveIo(options)
  const dir = normalizeDir(profileDir)
  const value = normalizeDir(repoRoot)
  const file = dir ? join(dir, PROFILE_PATCH_FILE) : ''
  const out = { ok: false, changed: false, file: posix(file), backup: '' }
  if (!dir) return Object.assign(out, { error: '未指定 profile 目录，未写入' })
  if (!value) return Object.assign(out, { error: '仓库目录为空，未写入' })
  const nowOpt = options.now
  const now = typeof nowOpt === 'function' ? nowOpt() : (nowOpt instanceof Date ? nowOpt : new Date())

  let existed = false
  let text = ''
  try { existed = existsSync(file) } catch (e) { existed = false }
  if (existed) {
    const raw = readUtf8(file)
    if (!raw) return Object.assign(out, { error: '无法读取 ' + PROFILE_PATCH_FILE + '：' + posix(file) })
    if (raw.bom) return Object.assign(out, { error: PROFILE_PATCH_FILE + ' 带 ' + raw.bom + ' BOM，已拒绝覆盖（请先另存为 UTF-8 无 BOM）' })
    text = raw.text
  }

  const quote = (v) => "'" + String(v).replace(/'/g, "''") + "'"
  const info = locatePatchEntry(text, options.id || MODULE_ID)
  const lines = info.lines.slice()
  if (text === '' && lines.length === 1 && lines[0] === '') lines.pop()
  const eol = info.eol

  if (info.repoRootLine >= 0) {
    if (unquoteYaml(info.repoRootValue) === value) return Object.assign(out, { ok: true, changed: false })
    lines[info.repoRootLine] = ' '.repeat(info.repoRootIndent) + 'repoRoot: ' + quote(posix(value))
  } else if (info.configLine >= 0) {
    lines.splice(info.configLine + 1, 0, ' '.repeat(info.configIndent + 2) + 'repoRoot: ' + quote(posix(value)))
  } else if (info.entryLine >= 0) {
    const ind = ' '.repeat(info.entryIndent + 2)
    lines.splice(info.entryLine + 1, 0, ind + 'config:', ind + '  repoRoot: ' + quote(posix(value)))
  } else {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push('- id: ' + (options.id || MODULE_ID), '  config:', '    repoRoot: ' + quote(posix(value)))
  }
  const next = lines.join(eol)
  if (next === text) return Object.assign(out, { ok: true, changed: false })

  if (existed) {
    const backup = file + BACKUP_SUFFIX + backupStamp(now)
    try {
      io.copyFileSync(file, backup)
      out.backup = posix(backup)
    } catch (e) {
      return Object.assign(out, { error: '备份失败：' + String(e && e.message ? e.message : e) })
    }
  }
  try {
    io.mkdirSync(dir, { recursive: true })
    io.writeFileSync(file, Buffer.from(next, 'utf8'))
  } catch (e) {
    return Object.assign(out, { error: '写入 ' + PROFILE_PATCH_FILE + ' 失败：' + String(e && e.message ? e.message : e) })
  }
  const back = readUtf8(file)
  if (!back || back.bom) {
    return Object.assign(out, { error: '写后校验失败（读不回或带 BOM）：' + posix(file) })
  }
  return Object.assign(out, { ok: true, changed: true })
}

/**
 * 解析集成体仓库根（**只读探测**）。
 * 优先级（2026-09-14 起）：① 设置页设置项 repoRoot（settingsRoot）
 * ② 部署配置层（configRoot：组合配置 / cordis.patch.yml 经宿主注入的 config）
 * ③ profile 的 cordis.patch.yml 里显式的 repoRoot（profileRoot / profileDir 自动读取）
 * ④ 相对探测（moduleDir 逐级向上）⑤ 常见位置 ⑥ 都不成立 → null。
 *
 * 降级纪律：设置值**非空但无效**时不静默 —— 返回值带 settingsError 可读文案，
 * 同时仍继续降级探测（保证旧行为：无效设置项不会把可用仓库挡在门外）。
 *
 * @param {object} [options]
 * @param {string} [options.settingsRoot] 设置页（settings ns）里的 repoRoot（可空，优先级最高）
 * @param {string} [options.configRoot] 部署配置层 repoRoot（可空；兼容旧调用）
 * @param {string} [options.profileRoot] 显式给出的 patch repoRoot（可空）
 * @param {string} [options.profileDir] profile 目录（用于自动读 cordis.patch.yml）
 * @param {string} [options.moduleDir] 本体模块目录（默认本文件所在模块目录）
 * @param {object} [options.env] 环境变量来源（测试注入）
 * @param {string[]} [options.commonCandidates] 常见位置候选（测试注入，默认 commonRepoRootCandidates）
 * @param {boolean} [options.readPatch] false = 不读 profile 的 cordis.patch.yml（测试注入）
 * @returns {{repoRoot:(string|null), source:('config'|'relative'|'none'),
 *            sourceDetail:('settings'|'config'|'patch'|'ancestor'|'common'|'none'),
 *            settingsError:string, tried:string[]}}
 */
export function resolveRepoRoot(options = {}) {
  const env = options.env || process.env
  const tried = []
  let settingsError = ''

  // ① 设置页设置项（最高优先级；非空但无效 → 记可读错误后继续降级，不静默）
  const settingsRoot = normalizeDir(options.settingsRoot)
  if (settingsRoot) {
    tried.push(settingsRoot)
    if (isRepoRoot(settingsRoot)) {
      return { repoRoot: settingsRoot, source: 'config', sourceDetail: 'settings', settingsError: '', tried: tried }
    }
    settingsError = '设置里的集成体仓库目录无效（应包含 modules/<id>/package.json）：' + posix(settingsRoot)
  }

  // ② 部署配置层（组合配置 / 宿主注入的 patch config；兼容旧参数名 configRoot）
  const configRoot = normalizeDir(options.configRoot)
  if (configRoot && configRoot !== settingsRoot) {
    tried.push(configRoot)
    if (isRepoRoot(configRoot)) {
      return { repoRoot: configRoot, source: 'config', sourceDetail: 'config', settingsError: settingsError, tried: tried }
    }
  }

  // ③ profile 的 cordis.patch.yml 里显式写的 repoRoot（宿主未注入 config 时的兜底）
  if (options.readPatch !== false) {
    const explicit = normalizeDir(options.profileRoot)
    const patchRoot = explicit || readProfileRepoRoot(options.profileDir)
    if (patchRoot && patchRoot !== settingsRoot && patchRoot !== configRoot) {
      tried.push(patchRoot)
      if (isRepoRoot(patchRoot)) {
        return { repoRoot: patchRoot, source: 'config', sourceDetail: 'patch', settingsError: settingsError, tried: tried }
      }
    }
  }

  // ④ 相对探测：从本模块目录逐级向上
  const start = normalizeDir(options.moduleDir) || MODULE_DIR
  let cursor = start
  for (let i = 0; i < MAX_ANCESTOR_LEVELS; i++) {
    if (cursor && tried.indexOf(cursor) === -1) tried.push(cursor)
    if (isRepoRoot(cursor)) {
      return { repoRoot: cursor, source: 'relative', sourceDetail: 'ancestor', settingsError: settingsError, tried: tried }
    }
    const parent = dirname(cursor)
    if (!parent || parent === cursor) break
    cursor = parent
  }

  // ⑤ 常见位置
  const common = Array.isArray(options.commonCandidates) ? options.commonCandidates : commonRepoRootCandidates(env)
  for (const raw of common) {
    const cand = normalizeDir(raw)
    if (!cand || tried.indexOf(cand) >= 0) continue
    tried.push(cand)
    if (isRepoRoot(cand)) {
      return { repoRoot: cand, source: 'relative', sourceDetail: 'common', settingsError: settingsError, tried: tried }
    }
  }

  return { repoRoot: null, source: 'none', sourceDetail: 'none', settingsError: settingsError, tried: tried }
}

// ───────────────────── 子插件清单（只读） ─────────────────────

/**
 * 读 profile 的 package.json 里本安装器关心的两处登记（**只读，容错**）：
 *   - dependencies：依赖登记（dependencies[id] 存在且非空）；
 *   - dsh.profile.bundles：DSH 装载登记（bundles 数组里命中 id）。
 * 读不到 / 不是合法 JSON / 带 BOM 一律返回空登记（不抛）。
 *
 * @returns {{dependencies:object, bundles:string[]}}
 */
export function readProfileRegistry(profileDir) {
  const out = { dependencies: {}, bundles: [] }
  const dir = normalizeDir(profileDir)
  if (!dir) return out
  const raw = readUtf8(join(dir, 'package.json'))
  if (!raw || raw.bom === 'UTF-8') return out
  let pkg = null
  try {
    pkg = JSON.parse(raw.text)
  } catch (e) {
    return out
  }
  if (!pkg || Array.isArray(pkg) || typeof pkg !== 'object') return out
  if (pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) {
    out.dependencies = pkg.dependencies
  }
  const profile = (pkg.dsh && typeof pkg.dsh === 'object' && !Array.isArray(pkg.dsh)) ? pkg.dsh.profile : null
  if (profile && typeof profile === 'object' && !Array.isArray(profile) && Array.isArray(profile.bundles)) {
    out.bundles = profile.bundles.filter((x) => typeof x === 'string' && x.trim() !== '')
  }
  return out
}

/**
 * 列出五个子插件的 bundled / installed 版本与安装模式（**只读**）。
 * installMode 来自 profile 的 package.json dependencies[id]：link: → 'link'，
 * file: → 'file'，其它非空写法（版本号等）→ 'copy'，无条目 → null。
 *
 * **installed 判定（2026-09-14 口径，改为「登记为准」）**：
 * `installed = registered && bundleHit && dirPresent` ——
 *   ① registered：dependencies[id] 已登记；② bundleHit：dsh.profile.bundles 命中；
 *   ③ dirPresent：<profileDir>/node_modules/<id> 目录在。
 * 只按目录存在判定是**假阳性来源**：卸载后残留的目录（junction / 复制件）会被当成已安装，
 * 面板显示「已是最新」且不给安装按钮，使用者反而装不上。未安装时 installedVersion 一律 null
 * （避免客户端把残留目录里的版本当成「已装版本」）。
 *
 * @param {{repoRoot?:string, profileDir?:string}} [options]
 * @returns {{repoRoot:(string|null), profileDir:(string|null), items:object[], summary:{total:number, installed:number, upToDate:number}}}
 */
export function listSubPlugins(options = {}) {
  const repoRoot = normalizeDir(options.repoRoot)
  const profileDir = normalizeDir(options.profileDir)
  const registry = readProfileRegistry(profileDir)
  const dependencies = registry.dependencies
  const bundles = registry.bundles

  const items = SUB_PLUGIN_IDS.map((spec) => {
    const bundledVersion = repoRoot
      ? (readPackageVersion(join(repoRoot, MODULES_DIR_NAME, spec.id, 'package.json')) || '')
      : ''
    const installedDir = profileDir ? join(profileDir, 'node_modules', spec.id) : ''
    let dirPresent = false
    if (installedDir) {
      try { dirPresent = existsSync(installedDir) } catch (e) { dirPresent = false }
    }
    const dep = dependencies[spec.id]
    const registered = typeof dep === 'string' && dep.trim() !== ''
    const bundleHit = bundles.indexOf(spec.id) >= 0
    const installed = Boolean(registered && bundleHit && dirPresent)
    const installedVersion = installed ? readPackageVersion(join(installedDir, 'package.json')) : null
    let installMode = null
    if (registered) {
      if (/^link:/i.test(dep)) installMode = 'link'
      else if (/^file:/i.test(dep)) installMode = 'file'
      else installMode = 'copy'
    }
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      bundledVersion: bundledVersion,
      installed: installed,
      installedVersion: installedVersion,
      installMode: installMode,
      upToDate: Boolean(bundledVersion && installedVersion && bundledVersion === installedVersion),
      // ── 2026-09-14 增补字段（只增不改：既有字段语义与顺序保持） ──
      registered: registered,
      bundleHit: bundleHit,
      dirPresent: dirPresent,
    }
  })

  const summary = { total: items.length, installed: 0, upToDate: 0 }
  for (const it of items) {
    if (it.installed) summary.installed += 1
    if (it.upToDate) summary.upToDate += 1
  }

  return {
    repoRoot: repoRoot ? posix(repoRoot) : null,
    profileDir: profileDir ? posix(profileDir) : null,
    items: items,
    summary: summary,
  }
}

// ───────────────────── 复制与校验 ─────────────────────

/**
 * 递归列出源目录下的全部文件（相对路径，POSIX 风格，字典序）。
 * 排除 node_modules / .git / __pycache__（目录名命中即整棵跳过）。
 */
export function walkFiles(root, options = {}) {
  const exclude = {}
  const list = Array.isArray(options.exclude) && options.exclude.length > 0 ? options.exclude : EXCLUDED_DIRS
  for (const name of list) exclude[name] = true
  const maxDepth = options.maxDepth || 32
  const out = []

  const visit = (dir, prefix, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const ent of entries) {
      if (exclude[ent.name]) continue
      const rel = prefix ? prefix + '/' + ent.name : ent.name
      const abs = join(dir, ent.name)
      let isDir = ent.isDirectory()
      if (!isDir && ent.isSymbolicLink()) {
        try { isDir = statSync(abs).isDirectory() } catch (e) { continue } // 断链：跳过
      }
      if (isDir) visit(abs, rel, depth + 1)
      else out.push(rel)
    }
  }

  visit(root, '', 0)
  out.sort()
  return out
}

/**
 * 逐文件 SHA256 比对（源 vs 目标）。options.sha256 可注入（自测模拟校验不通过）。
 * @returns {{checked:number, mismatches:string[], mismatchCount:number}}
 */
export function compareTrees(srcRoot, destRoot, files, options = {}) {
  const sample = options.sample || 20
  const hash = typeof options.sha256 === 'function' ? options.sha256 : sha256File
  const mismatches = []
  let mismatchCount = 0
  let checked = 0
  for (const rel of files) {
    const a = hash(join(srcRoot, rel))
    const b = hash(join(destRoot, rel))
    checked += 1
    if (!a || !b) {
      mismatchCount += 1
      if (mismatches.length < sample) mismatches.push(rel + '（读取失败）')
      continue
    }
    if (a !== b) {
      mismatchCount += 1
      if (mismatches.length < sample) mismatches.push(rel + '（SHA256 不一致）')
    }
  }
  return { checked: checked, mismatches: mismatches, mismatchCount: mismatchCount }
}

// ───────────────────── profile/package.json 更新 ─────────────────────

/**
 * 列出 profile 目录下**可识别时间戳的** package.json.bak-<时间戳> 备份（本引擎格式 + 历史 ISO 风格），
 * 按时间倒序（新 → 旧）。只读目录名，不读文件内容。
 * 解析不出时间的 .bak-* 文件（如 package.json.bak-dsh-experts）不会被列出，也就不会被轮转删除。
 * @returns {Array<{name:string, file:string, stamp:string, key:string}>}
 */
export function listBackups(profileDir) {
  const prefix = 'package.json' + BACKUP_SUFFIX
  let names = []
  try {
    names = readdirSync(profileDir)
  } catch (e) {
    return []
  }
  const out = []
  for (const name of names) {
    if (name.indexOf(prefix) !== 0 || name.length <= prefix.length) continue
    const stamp = name.slice(prefix.length)
    const key = backupStampKey(stamp)
    if (!key) continue // 解析不出时间 → 不参与轮转
    out.push({ name: name, file: join(profileDir, name), stamp: stamp, key: key })
  }
  // 归一化时间键等长，字典序即时间序（跨格式可比）
  out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  return out
}

/**
 * 备份轮转：写入新备份**之前**清理更早的备份，保证写入后最多保留 keep 份。
 * 清理失败只跳过该文件（best-effort），绝不影响安装本身。
 *
 * @param {string} profileDir
 * @param {{keep?:number, extra?:number, io?:object}} [options] extra = 即将新增的备份数（默认 1）
 * @returns {{pruned:number, kept:number, files:string[]}}
 */
export function pruneBackups(profileDir, options = {}) {
  const keep = options.keep || BACKUP_KEEP
  const extra = typeof options.extra === 'number' ? options.extra : 1
  const io = options.io || resolveIo({})
  const all = listBackups(profileDir)
  const excess = all.length + extra - keep
  if (excess <= 0) return { pruned: 0, kept: all.length + extra, files: [] }
  const victims = all.slice(all.length - excess) // 最旧的若干份
  const files = []
  let pruned = 0
  for (const v of victims) {
    try {
      io.rmSync(v.file, { force: true })
      pruned += 1
      files.push(v.name)
    } catch (e) { /* best-effort */ }
  }
  return { pruned: pruned, kept: all.length + extra - pruned, files: files }
}

/**
 * 只读预检 profile/package.json（在**复制之前**跑，前置不满足就直接失败，绝不触碰目标目录）。
 * @returns {{ok:boolean, existed?:boolean, error?:string}}
 */
export function preflightProfilePackage(profileDir) {
  const file = join(profileDir, 'package.json')
  let existed = false
  try { existed = existsSync(file) } catch (e) { existed = false }
  if (!existed) return { ok: true, existed: false }
  const raw = readUtf8(file)
  if (!raw) return { ok: false, existed: true, error: '无法读取 profile/package.json：' + posix(file) }
  if (raw.bom) return { ok: false, existed: true, error: 'profile/package.json 带 ' + raw.bom + ' BOM（请先另存为 UTF-8 无 BOM）' }
  let pkg = null
  try {
    pkg = JSON.parse(raw.text)
  } catch (e) {
    return { ok: false, existed: true, error: 'profile/package.json 不是合法 JSON：' + String(e && e.message ? e.message : e) }
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { ok: false, existed: true, error: 'profile/package.json 顶层不是对象' }
  }
  return { ok: true, existed: true }
}

/**
 * 更新 profile 的 package.json：dependencies[id] = "file:node_modules/<id>"，
 * dsh.profile.bundles 追加且去重。**写前备份（并轮转，只保留最近 BACKUP_KEEP 份）**
 * → 写入（UTF-8 无 BOM）→ 写后 BOM + JSON.parse 校验，校验失败时 best-effort 回滚到备份。
 *
 * @returns {{ok:boolean, error?:string, file?:string, backup?:string, prunedBackups?:number,
 *            depChanged?:boolean, bundleChanged?:boolean, bundles?:string[]}}
 */
export function updateProfilePackage(profileDir, id, now = new Date(), io) {
  const fsio = io || resolveIo({})
  const file = join(profileDir, 'package.json')
  const existed = existsSync(file)
  let backup = ''
  let prunedBackups = 0

  const rollback = () => {
    try {
      if (backup) fsio.copyFileSync(backup, file)
      else if (!existed) fsio.rmSync(file, { force: true })
    } catch (e) { /* best-effort */ }
  }

  let pkg = null
  if (existed) {
    const raw = readUtf8(file)
    if (!raw) return { ok: false, error: '无法读取 profile/package.json：' + posix(file) }
    if (raw.bom) return { ok: false, error: 'profile/package.json 带 ' + raw.bom + ' BOM，已拒绝覆盖（请先另存为 UTF-8 无 BOM）' }
    try {
      pkg = JSON.parse(raw.text)
    } catch (e) {
      return { ok: false, error: 'profile/package.json 不是合法 JSON：' + String(e && e.message ? e.message : e) }
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      return { ok: false, error: 'profile/package.json 顶层不是对象，已拒绝覆盖' }
    }
  } else {
    pkg = { name: basename(profileDir) || 'dsh-profile', private: true }
  }

  // 写前备份 + 备份轮转（先清理更早的，保证写入后最多保留 BACKUP_KEEP 份）
  if (existed) {
    backup = file + BACKUP_SUFFIX + backupStamp(now)
    try {
      prunedBackups = pruneBackups(profileDir, { keep: BACKUP_KEEP, extra: 1, io: fsio }).pruned
    } catch (e) {
      prunedBackups = 0
    }
    try {
      fsio.copyFileSync(file, backup)
    } catch (e) {
      return { ok: false, error: '备份失败：' + String(e && e.message ? e.message : e), prunedBackups: prunedBackups }
    }
  }

  // dependencies + dsh.profile.bundles
  const depValue = 'file:node_modules/' + id
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies)) pkg.dependencies = {}
  const depChanged = pkg.dependencies[id] !== depValue
  pkg.dependencies[id] = depValue

  if (!pkg.dsh || typeof pkg.dsh !== 'object' || Array.isArray(pkg.dsh)) pkg.dsh = {}
  if (!pkg.dsh.profile || typeof pkg.dsh.profile !== 'object' || Array.isArray(pkg.dsh.profile)) pkg.dsh.profile = {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles.slice() : []
  const bundleChanged = bundles.indexOf(id) === -1
  if (bundleChanged) bundles.push(id)
  pkg.dsh.profile.bundles = bundles

  // 写入（Node fs，UTF-8 无 BOM）
  const text = JSON.stringify(pkg, null, 2) + '\n'
  try {
    fsio.writeFileSync(file, Buffer.from(text, 'utf8'))
  } catch (e) {
    rollback()
    return {
      ok: false,
      error: '写入 profile/package.json 失败：' + String(e && e.message ? e.message : e),
      prunedBackups: prunedBackups,
    }
  }

  // 写后校验：BOM + JSON.parse
  const back = readUtf8(file)
  if (!back) {
    rollback()
    return { ok: false, error: '写后读取 profile/package.json 失败', prunedBackups: prunedBackups }
  }
  if (back.bom) {
    rollback()
    return { ok: false, error: '写后检测到 ' + back.bom + ' BOM（已回滚）', prunedBackups: prunedBackups }
  }
  try {
    JSON.parse(back.text)
  } catch (e) {
    rollback()
    return {
      ok: false,
      error: '写后 JSON 校验失败（已回滚）：' + String(e && e.message ? e.message : e),
      prunedBackups: prunedBackups,
    }
  }

  return {
    ok: true,
    file: posix(file),
    backup: posix(backup),
    prunedBackups: prunedBackups,
    depChanged: depChanged,
    bundleChanged: bundleChanged,
    bundles: bundles.slice(),
  }
}

// ───────────────────── 安装（原子替换） ─────────────────────

/**
 * 安装单个子插件（**唯一会写盘的操作**，采用原子替换，原目录保留到最后一刻）。
 *
 * 流程：
 *   0. 前置检查（只读）：白名单 id → repoRoot 有效 → 源目录 + 源 package.json 存在 → profile 存在
 *      → profile/package.json 可解析且无 BOM。**前置不满足时在复制前失败返回，绝不触碰目标目录**。
 *   1. 复制到同级临时目录 <id>.wps-new（排除 node_modules/.git/__pycache__）。
 *   2. 在**临时目录**上逐文件 SHA256 校验（源 vs 临时）。
 *   3. 校验通过才替换：<id> → <id>.wps-old（若存在）→ <id>.wps-new → <id>。
 *   4. 更新 profile/package.json（写前备份、写后 JSON + BOM 校验）。
 *   5. 成功后删除 <id>.wps-old；任何一步失败都回滚（旧目录改回原位、清理 .wps-new）。
 *
 * @param {string} id 五个固定 id 之一
 * @param {{repoRoot?:string, profileDir?:string, now?:(Date|Function), io?:object}} [options]
 *        options.io 可注入 { copyFileSync, renameSync, rmSync, mkdirSync, writeFileSync, sha256File }
 *        （自测用来模拟复制失败 / 校验不通过 / 替换失败）。
 * @returns {{ok:boolean, id:string, from:string, to:string, files:number, verified:boolean,
 *            replaced:boolean, overwrite:boolean, backup:string, prunedBackups:number,
 *            durationMs:number, output:string, error?:string, rollback?:string}}
 */
export function installSubPlugin(id, options = {}) {
  const started = Date.now()
  const nowOpt = options.now
  const now = typeof nowOpt === 'function' ? nowOpt() : (nowOpt instanceof Date ? nowOpt : new Date())
  const io = resolveIo(options)
  const safeId = typeof id === 'string' ? id.trim().slice(0, 64) : ''
  const spec = subPluginSpec(safeId)
  const repoRoot = normalizeDir(options.repoRoot)
  const profileDir = normalizeDir(options.profileDir)
  const fromDir = (repoRoot && spec) ? join(repoRoot, MODULES_DIR_NAME, spec.id) : ''
  const toDir = (profileDir && spec) ? join(profileDir, 'node_modules', spec.id) : ''
  const newDir = toDir ? toDir + ATOMIC_NEW_SUFFIX : ''
  const oldDir = toDir ? toDir + ATOMIC_OLD_SUFFIX : ''

  const build = (patch) => Object.assign({
    ok: false,
    id: safeId,
    from: posix(fromDir),
    to: posix(toDir),
    files: 0,
    verified: false,
    replaced: false,
    overwrite: false,
    backup: '',
    prunedBackups: 0,
    /** 桌宠素材部署结果（只有 workspace-tokenpet 会得到对象；其余与失败分支一律 null，保证形状稳定） */
    skins: null,
    durationMs: Date.now() - started,
    output: '',
  }, patch || {})

  const cleanupDir = (dir) => {
    if (!dir) return
    try { io.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
  }

  // ── 0. 前置检查（全部只读；不满足时**绝不触碰目标目录**） ──
  if (!spec) {
    const why = '未知子插件 id：' + (safeId || '(空)') + '；只接受 ' + SUB_PLUGIN_ID_LIST.join(' / ')
    return build({ output: why + '（未触碰任何文件）', error: '未知子插件 id' })
  }
  if (!repoRoot) {
    const why = '未找到集成体仓库目录，请在设置里指定集成体仓库目录（repoRoot）'
    return build({ output: why + '（未触碰任何文件）', error: '未找到集成体仓库目录' })
  }
  if (!isRepoRoot(repoRoot)) {
    const why = '集成体仓库目录无效（应包含 modules/<id>/package.json）：' + posix(repoRoot)
    return build({ output: why + '（未触碰任何文件）', error: '集成体仓库目录无效' })
  }
  if (!existsSync(join(fromDir, 'package.json'))) {
    const why = '源子插件不存在或缺少 package.json：' + posix(fromDir)
    return build({ output: why + '（未触碰任何文件）', error: '源子插件不存在' })
  }
  if (!profileDir) {
    const why = '未找到当前 profile 目录（可用 DSH_PROFILE_DIR / DSH_PROFILE 指定，默认 ~/.dsh/profiles/desktop）'
    return build({ output: why + '（未触碰任何文件）', error: '未找到 profile 目录' })
  }
  try {
    if (!statSync(profileDir).isDirectory()) throw new Error('not a directory')
  } catch (e) {
    return build({ output: 'profile 目录不存在：' + posix(profileDir) + '（未触碰任何文件）', error: 'profile 目录不存在' })
  }
  const pre = preflightProfilePackage(profileDir)
  if (!pre.ok) {
    return build({ output: '安装前检查未通过，未触碰任何文件（含目标目录）：' + pre.error, error: pre.error })
  }

  // 只读快照：目标是否已存在 / 是否已是最新（用于 replaced 与「覆盖重装」标记）
  let targetExisted = false
  let targetVersion = null
  try {
    targetExisted = existsSync(toDir)
    if (targetExisted) targetVersion = readPackageVersion(join(toDir, 'package.json'))
  } catch (e) {
    targetExisted = false
  }
  const bundledVersion = readPackageVersion(join(fromDir, 'package.json'))
  const overwrite = Boolean(targetExisted && bundledVersion && targetVersion && bundledVersion === targetVersion)

  const files = walkFiles(fromDir)
  if (files.length === 0) {
    return build({ output: '源目录没有可复制的文件：' + posix(fromDir) + '（未触碰任何文件）', error: '源目录为空' })
  }

  // ── 1. 复制到同级临时目录（目标目录保持原样） ──
  cleanupDir(newDir) // 清理上一轮异常遗留的临时目录
  try {
    io.mkdirSync(newDir, { recursive: true })
    for (const rel of files) {
      const target = join(newDir, rel)
      io.mkdirSync(dirname(target), { recursive: true })
      io.copyFileSync(join(fromDir, rel), target)
    }
  } catch (err) {
    cleanupDir(newDir)
    const rollback = '目标目录未被触碰；已清理临时目录 ' + basename(newDir)
    return build({
      files: 0,
      replaced: false,
      overwrite: overwrite,
      error: '复制失败',
      rollback: rollback,
      output: '复制到临时目录失败：' + String(err && err.message ? err.message : err)
        + '\n回滚：' + rollback + '（原有安装保持不变）',
    })
  }

  // ── 2. 在临时目录上做逐文件 SHA256 校验（通过后才动目标） ──
  const compare = compareTrees(fromDir, newDir, files, { sha256: io.sha256File })
  if (compare.mismatchCount > 0) {
    cleanupDir(newDir)
    const lines = ['源：' + posix(fromDir), '临时目录：' + posix(newDir), '文件：' + files.length + ' 个',
      'SHA256：' + compare.mismatchCount + ' 个文件不一致']
    for (const m of compare.mismatches) lines.push('  - ' + m)
    lines.push('回滚：未替换目标目录；已清理临时目录 ' + basename(newDir) + '（原有安装保持不变）')
    return build({
      files: files.length,
      replaced: false,
      overwrite: overwrite,
      error: 'SHA256 校验失败',
      rollback: '未替换目标目录；已清理临时目录 ' + basename(newDir),
      output: truncate(lines.join('\n'), INSTALL_OUTPUT_LIMIT),
    })
  }

  // ── 3. 原子替换（旧目录改名暂存 → 新目录改名就位） ──
  cleanupDir(oldDir) // 清理上一轮替换后崩溃遗留的暂存目录
  let movedOld = false
  try {
    if (targetExisted) {
      io.renameSync(toDir, oldDir)
      movedOld = true
    }
    io.renameSync(newDir, toDir)
  } catch (err) {
    let rollback = ''
    try {
      if (movedOld && !existsSync(toDir) && existsSync(oldDir)) {
        io.renameSync(oldDir, toDir)
        rollback = '已把原目录从 ' + basename(oldDir) + ' 改回 ' + basename(toDir) + '，原有安装完好'
      } else if (!movedOld) {
        rollback = '目标目录未被改动'
      } else {
        rollback = '原目录仍保留在 ' + basename(oldDir) + '（可手动改名回 ' + basename(toDir) + '）'
      }
    } catch (err2) {
      rollback = '自动回滚失败：原目录仍保留在 ' + basename(oldDir) + '（可手动改名回 ' + basename(toDir) + '）'
    }
    cleanupDir(newDir)
    return build({
      files: files.length,
      replaced: false,
      overwrite: overwrite,
      error: '替换失败',
      rollback: rollback,
      output: '替换阶段失败：' + String(err && err.message ? err.message : err)
        + '\n回滚：' + rollback + '；临时目录 ' + basename(newDir) + ' 已清理',
    })
  }

  // ── 4. 更新 profile/package.json（此时旧目录仍在 .wps-old，可回滚） ──
  const updated = updateProfilePackage(profileDir, spec.id, now, io)
  if (!updated.ok) {
    let rollback = ''
    try {
      if (movedOld && existsSync(oldDir)) {
        io.rmSync(toDir, { recursive: true, force: true })
        io.renameSync(oldDir, toDir)
        rollback = '已把原目录改回 ' + basename(toDir) + '，原有安装完好'
      } else {
        io.rmSync(toDir, { recursive: true, force: true })
        rollback = '已移除本次新装目录，恢复为未安装状态'
      }
    } catch (err) {
      rollback = '自动回滚失败：原目录仍保留在 ' + basename(oldDir) + '（可手动改名回 ' + basename(toDir) + '）'
    }
    return build({
      files: files.length,
      verified: true,
      replaced: false,
      overwrite: overwrite,
      error: updated.error,
      rollback: rollback,
      prunedBackups: updated.prunedBackups || 0,
      output: '文件校验已通过，但 profile/package.json 更新失败：' + updated.error + '\n回滚：' + rollback,
    })
  }

  // ── 5. 成功：删除暂存的旧目录 ──
  let oldRemoved = true
  if (movedOld) {
    try { io.rmSync(oldDir, { recursive: true, force: true }) } catch (e) { oldRemoved = false }
  }

  const lines = [
    '源：' + posix(fromDir),
    '目标：' + posix(toDir),
    '方式：原子替换（临时目录 ' + basename(newDir) + ' 校验通过后才替换，旧目录保留到最后）',
    '文件：' + files.length + ' 个（已排除 ' + EXCLUDED_DIRS.join(' / ') + '）',
    'SHA256：' + files.length + '/' + files.length + ' 一致（在临时目录上校验）',
    '目标状态：' + (targetExisted ? '覆盖替换（原有目录已替换）' : '首次安装'),
  ]
  if (overwrite) {
    lines.push('覆盖重装：目标原本已是仓库内置版本 v' + bundledVersion + '，本次为强制覆盖重装')
  }
  lines.push('profile/package.json：已更新（dependencies["' + spec.id + '"] = file:node_modules/' + spec.id
    + '；dsh.profile.bundles ' + (updated.bundleChanged ? '已追加' : '已存在（去重）') + '）')
  lines.push('备份：' + (updated.backup || '（profile/package.json 原本不存在，无需备份）'))
  lines.push('备份轮转：' + ((updated.prunedBackups || 0) > 0
    ? '已清理更早的 ' + updated.prunedBackups + ' 份（保留最近 ' + BACKUP_KEEP + ' 份）'
    : '保留最近 ' + BACKUP_KEEP + ' 份（本次无需清理）'))
  if (!oldRemoved) {
    lines.push('提示：暂存目录 ' + posix(oldDir) + ' 未能删除（不影响使用，可手动清理）')
  }

  // ── 6. 桌宠素材部署（只有 workspace-tokenpet；**只补缺失、绝不覆盖**） ──
  // 运行时只认 <dsh home>/data/workspace-tokenpet/skins/，模块内的 skins/ 不会被读取；
  // 只复制模块会导致装完只剩内置形象（2026-09-13 灰度测试实测）。
  let skins = null
  if (spec.id === PET_SKINS_PLUGIN_ID) {
    const dshHome = resolveDshHome(options)
    skins = deployPetSkins(join(fromDir, SKINS_DIR_NAME), join(dshHome, PET_SKINS_SUBDIR), {
      io,
      // 旧址（独立化之前 dsh-token-pet 的素材目录）：新址缺套装时从那里复制迁移
      legacyDir: join(dshHome, LEGACY_PET_SKINS_SUBDIR),
    })
    lines.push('桌宠素材：' + describePetSkins(skins))
  }

  return build({
    ok: true,
    files: files.length,
    verified: true,
    replaced: targetExisted,
    overwrite: overwrite,
    backup: updated.backup || '',
    prunedBackups: updated.prunedBackups || 0,
    skins: skins,
    output: truncate(lines.join('\n'), INSTALL_OUTPUT_LIMIT),
  })
}

/**
 * 批量安装计划：过滤白名单、去重，并按**服务端固定顺序**排列（忽略传入顺序）。
 * 未知 id 计入 rejected，不执行。
 * @returns {{order:string[], rejected:string[]}}
 */
export function resolveInstallAllPlan(ids) {
  const input = Array.isArray(ids) ? ids : []
  const accepted = {}
  const rejected = []
  for (const raw of input) {
    const s = typeof raw === 'string' ? raw.trim().slice(0, 64) : String(raw == null ? '' : raw).slice(0, 32)
    if (SUB_PLUGIN_ID_LIST.indexOf(s) >= 0) accepted[s] = true
    else if (rejected.indexOf(s) === -1 && rejected.length < 50) rejected.push(s)
  }
  const order = SUB_PLUGIN_ID_LIST.filter((id) => accepted[id])
  return { order: order, rejected: rejected }
}
