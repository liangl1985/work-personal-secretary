/**
 * work-personal-secretary —— 配置底座引擎（安装器第四步：把配置底座分步落地）
 *
 * 职责：把集成体自带的**配置底座**落地到使用者环境。
 * 八项（前五项是 1.1.2 既有能力，后三项 1.1.3 新增，追加在 BASEDECK_ITEMS 末尾）：
 *   agentsMd     把 defaults/AGENTS.zh-CN.md 的**标记块区间**合并进 <workspace>/AGENTS.md
 *   memorySeed   把 defaults/global-memory.seed.md 的种子条目追加进记忆库 MEMORY.md（全局记忆）
 *   skills       把 <repoRoot>/modules/dsh-doc-suite/skills/<name>/SKILL.md 装到 <workspace>/.dsh/skills/<name>/
 *   settings     写 <DSH_HOME>/settings.yaml 的 work-memory / experts 段（只增改指定键）
 *   dirs         创建记忆库 / 备份 / Obsidian 镜像 / 桌宠素材目录（只创建缺失的）
 *   memoryDeck   记忆体结构（1.1.3）：PROJECTS / DAILY / ARCHIVE 骨架 + MEMORY.md 的「使用者身份」
 *                占位条目 + USER.md / GRAPH.json 骨架 + PROJECTS/工作秘书.md 四条（设计定稿 §6）
 *   knowledgeDeck 知识库结构（1.1.3）：🏠 主页.md + 00_全局记忆/ + 工具/（总览 + 技能·脚本·MCP）
 *                + .obsidian 最小配置（设计定稿 §7）
 *   migrateMemory 迁移旧记忆库（1.1.3）：把旧记忆库目录里缺失的文件补到新目录（只补缺失、绝不覆盖，
 *                旧目录只读保留；是「改记忆库目录」的前置步骤，失败即停后续步骤）
 *
 * 规范来源（已审查通过的 AGENTS 标记块规范）：
 *   标记块格式、块首元数据字段、content-hash 规范化口径、七状态判定算法、写回纪律、
 *   块内被使用者手改时的保守处置 —— 逐条落地在本文件（见各函数注释）。
 *
 * 形态：**配置引导（setup wizard）** —— 使用者填好首用必配项后一次性把各项写入。
 *   执行顺序的唯一来源是 `BASEDECK_APPLY_ORDER`（agentsMd 放最后，它是使用者最在意的文件）：
 *     dirs -> migrateMemory -> memorySeed -> memoryDeck -> knowledgeDeck -> skills -> settings -> agentsMd
 *
 * 红线（本文件）：
 * 1. **dry-run 是默认**：GET /basedeck 与不带 dryRun:false 的 POST /basedeck 都**绝不写盘**。
 * 2. **AGENTS.md 是使用者的私人指令文件**：只动标记块区间；块外**逐字节保留**，写回后必须能证明块外未变。
 * 3. **块内被手改**（content-hash 不匹配）默认**不覆盖**，把新版块另存候选文件并在结果里说明。
 * 4. 所有文本写入一律 Node fs（UTF-8 **无 BOM**）、**写前备份**、**写后校验**（可解析 / 无 BOM / 块外哈希一致）。
 * 5. 发布件中立：不写死任何使用者信息、本机绝对路径、称呼、私有目录名。
 * 6. **不触碰真实环境**：本文件只按调用方给的 workspace / settingsFile / memoryDir 操作；
 *    自测（scripts/basedeck-test.mjs）一律在 os.tmpdir() 夹具里跑，真实工作区只做只读快照。
 *
 * @module work-personal-secretary/basedeck
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { MODULE_DIR, detectBom, posix, resolveRepoRoot } from './install.js'
import { IDENTITY_PREFIX } from './domain.js'

// ───────────────────────────── 常量 ─────────────────────────────

/**
 * 八项配置底座的**唯一来源**（顺序 = 面板展示顺序 = GET 计划顺序）。
 * 前五项为 1.1.2 既有能力（顺序与语义一字未动）；后三项是 1.1.3 新增的
 * 记忆体结构（memoryDeck）、知识库结构（knowledgeDeck）生成器与旧记忆库迁移（migrateMemory），**追加在末尾**，
 * 保证既有调用方按下标取项的行为不受影响。
 */
export const BASEDECK_ITEMS = [
  { id: 'agentsMd', label: '指令层 AGENTS.md' },
  { id: 'memorySeed', label: '记忆种子' },
  { id: 'skills', label: '文档技能' },
  { id: 'settings', label: '设置用户层' },
  { id: 'dirs', label: '工作目录' },
  { id: 'memoryDeck', label: '记忆体结构' },
  { id: 'knowledgeDeck', label: '知识库结构' },
  { id: 'migrateMemory', label: '迁移旧记忆库' },
]

/** 八项 id 的字符串数组（查表 / 回显用） */
export const BASEDECK_ID_LIST = BASEDECK_ITEMS.map((it) => it.id)

/**
 * **默认执行顺序**：按依赖排，agentsMd 放最后（引导一次性写入时使用）。
 * migrateMemory 紧接 dirs 之后、memoryDeck 之前 —— 迁移是**前置步骤**：先把旧记忆库带过来，
 * 再建立/补齐新结构（迁移只补缺失、绝不覆盖，所以放前面不会覆盖任何既有内容）。
 * memoryDeck 排在 memorySeed 之后（两者都追加写 MEMORY.md，互不动对方的条目）；
 * knowledgeDeck 紧随其后，与记忆体结构配套（00_全局记忆 是两者的关联点）。
 */
export const BASEDECK_APPLY_ORDER = ['dirs', 'migrateMemory', 'memorySeed', 'memoryDeck', 'knowledgeDeck', 'skills', 'settings', 'agentsMd']

/** 输出上限（与 /fix 契约的 8000 保持一致） */
export const BASEDECK_OUTPUT_LIMIT = 8000

/** 备份名 = <文件>.bak-<YYYYMMDD-HHmmss-SSS>；保留最近 BACKUP_KEEP 份 */
export const BACKUP_SUFFIX = '.bak-'
export const BACKUP_KEEP = 5

/** 块内被手改时，新版块写到同目录的这个候选文件 */
export const AGENTS_CANDIDATE_NAME = 'AGENTS.wps-new.md'

/** 集成体标识与模板标识（写进块首元数据） */
export const GENERATOR_ID = 'work-personal-secretary'
export const TEMPLATE_ID = 'agents-zh-CN'

/** 标记块正则：begin 行 / end 行 / 完整块（非贪婪；块内正文不含 end 行） */
export const RE_BLOCK_BEGIN = /<!--\s*wps:begin\b([^>]*)-->/
export const RE_BLOCK_END = /<!--\s*wps:end\s*-->/
export const RE_BLOCK_FULL = /<!--\s*wps:begin\b([^>]*)-->([\s\S]*?)<!--\s*wps:end\s*-->/

/** 预览用的正文行数上限（客户端可自行截断到 20 行）/ 单行字符上限 */
export const SAMPLE_LINES = 20
export const SAMPLE_LINE_CHARS = 200

/** 记忆种子条目的 tag 规则（语言与协作红线 → 关键；其余 → 常规） */
export const SEED_TAG_RULES = [
  { match: '【语言偏好】', tag: '关键' },
  { match: '【协作方式】', tag: '关键' },
]
export const SEED_DEFAULT_TAG = '常规'

/**
 * 记忆库默认（与 dsh-work-memory 的 `store.js` `defaultMemoryRoot()` 同口径）：
 *   <DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/memory
 * 1.0.6 之前的默认是 <base>/memories/work-memory —— 那一个只作为「迁移来源」回退用
 * （见本文件末尾的 `LEGACY_MEMORY_SUBDIR`），不再是任何新建目标。
 */
export const DEFAULT_MEMORY_SUBDIR = join('data', 'dsh-work-memory', 'memory')
/**
 * 备份目录默认（与 dsh-work-memory 的 `backup.js` `defaultBackupDir()` 同口径）：
 *   <DSH_HOME 或 ~/.dsh>/data/dsh-work-memory/backup
 * 与记忆库同级、同在 data/dsh-work-memory/ 下；1.0.6 前是 <base>/memories/work-memory-backup。
 */
export const DEFAULT_BACKUP_SUBDIR = join('data', 'dsh-work-memory', 'backup')

/** 桌宠素材目录（与 workspace-tokenpet 的 skinsDir 一致：<dsh home>/data/workspace-tokenpet/skins） */
export const PET_SKINS_SUBDIR = join('data', 'workspace-tokenpet', 'skins')

/** 文档技能所在子模块与技能目录名 */
export const DOC_SUITE_MODULE = 'dsh-doc-suite'
export const SKILLS_DIR_NAME = 'skills'

/**
 * obsidianSyncDir 的**哨兵值**：客户端「不使用镜像」按钮会传它。
 * 语义与三态严格区分：
 *   ''         = 用探测到的现状 / 默认值（不覆盖）
 *   '<路径>'   = 写入该路径
 *   '__none__' = **显式写空值**（= 关闭镜像，等价 work-memory 的「留空 = 不同步」）
 */
export const NONE_SENTINEL_VALUE = '__none__'

/**
 * 设置目标：只增改这 4 个键，其余内容逐字节保留。
 * kind=dir  → 缺值时可由引导填值 / 推导建议值；
 * kind=keep → 安装器**不预设**（岗位域与身份专家是使用者画像，写死会把行业钉死），
 *             只有引导里显式填了 overrides 才写。
 */
export const SETTINGS_TARGETS = [
  { ns: 'work-memory', key: 'memoryDir', label: '记忆库目录', kind: 'dir' },
  { ns: 'work-memory', key: 'obsidianSyncDir', label: 'Obsidian 记忆镜像目录', kind: 'dir' },
  { ns: 'experts', key: 'defaultDomain', label: '岗位域', kind: 'keep' },
  { ns: 'experts', key: 'identityExpert', label: '身份专家', kind: 'keep' },
]

// ───────────────────────────── 小工具 ─────────────────────────────

/** 读文件（返回 buffer / utf8 文本 / BOM 标记；读不到返回 null，不抛） */
export function readFileRaw(file) {
  try {
    const buffer = readFileSync(file)
    return { buffer: buffer, text: buffer.toString('utf8'), bom: detectBom(buffer) }
  } catch (e) {
    return null
  }
}

/** 文本 SHA256（十六进制小写） */
export function sha256Text(text) {
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(String(text == null ? '' : text), 'utf8')
  return createHash('sha256').update(buf).digest('hex')
}

/** 文件 SHA256（读不到返回 null） */
export function sha256Of(file) {
  const raw = readFileRaw(file)
  return raw ? sha256Text(raw.buffer) : null
}

/** 检测原文主行尾（CRLF / LF），写回时沿用 */
export function detectEol(text) {
  const s = String(text == null ? '' : text)
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = s.split('\r\n').join('').split('\n').length - 1
  return crlf > lf ? '\r\n' : '\n'
}

/** 备份时间戳：YYYYMMDD-HHmmss-SSS（Windows 文件名安全，无冒号） */
export function stamp(date = new Date()) {
  const p = (n, w) => String(n).padStart(w || 2, '0')
  return String(date.getFullYear()) + p(date.getMonth() + 1) + p(date.getDate()) + '-'
    + p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds()) + '-'
    + p(date.getMilliseconds(), 3)
}

/** 本地日期 YYYY-MM-DD（块首 updated 用） */
export function formatDate(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return String(date.getFullYear()) + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate())
}

/** 现在（支持 Date / 函数两种注入） */
export function nowValue(now) {
  if (typeof now === 'function') return now()
  if (now instanceof Date) return now
  return new Date()
}

/** 计数（正则带 g 标志，避免 lastIndex 状态） */
export function countMatches(text, re) {
  const g = new RegExp(re.source, 'g')
  let n = 0
  while (g.exec(String(text == null ? '' : text)) !== null) n += 1
  return n
}

/** 截断到 n 个字符（预览用） */
export function clip(s, n = SAMPLE_LINE_CHARS) {
  const t = String(s == null ? '' : s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 取正文前 n 行、拼成**字符串**（预览用；每行截断）。
 * 契约：preview.sampleLines 是字符串（不是数组），客户端按行渲染并可自行截断到 20 行。
 */
export function sampleLines(text, n = SAMPLE_LINES) {
  return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n').slice(0, n).map((l) => clip(l)).join('\n')
}

/** 把若干行拼成**字符串**预览（同样每行截断、最多 n 行） */
export function sampleBlock(lines, n = SAMPLE_LINES) {
  return (Array.isArray(lines) ? lines : []).slice(0, n).map((l) => clip(l)).join('\n')
}

/** 去重 + 截断的 rejected 列表 */
export function pushRejected(list, value) {
  const s = typeof value === 'string' ? value.trim().slice(0, 64) : String(value == null ? '' : value).slice(0, 32)
  if (list.indexOf(s) === -1 && list.length < 50) list.push(s)
}

/** 版本号比较（数字段优先；返回 -1 / 0 / 1） */
export function compareVersions(a, b) {
  const pa = String(a == null ? '' : a).split(/[.+-]/)
  const pb = String(b == null ? '' : b).split(/[.+-]/)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const xa = pa[i] === undefined ? '0' : pa[i]
    const xb = pb[i] === undefined ? '0' : pb[i]
    const na = /^\d+$/.test(xa) ? Number(xa) : null
    const nb = /^\d+$/.test(xb) ? Number(xb) : null
    if (na !== null && nb !== null) {
      if (na !== nb) return na < nb ? -1 : 1
      continue
    }
    if (xa !== xb) return xa < xb ? -1 : 1
  }
  return 0
}

/** 可注入 IO 层（只覆盖写操作；读保持直读，避免 mock 面积过大） */
export function resolveIo(options) {
  const o = (options && options.io) || {}
  const pick = (name) => (typeof o[name] === 'function' ? o[name] : undefined)
  return {
    writeFileSync: pick('writeFileSync') || writeFileSync,
    renameSync: pick('renameSync') || renameSync,
    rmSync: pick('rmSync') || rmSync,
    mkdirSync: pick('mkdirSync') || mkdirSync,
    copyFileSync: pick('copyFileSync') || copyFileSync,
    sha256File: pick('sha256File') || ((f) => sha256Of(f)),
  }
}

/** 最小 YAML 标量序列化（含特殊字符才加引号；路径不加引号） */
export function yamlScalar(value) {
  const s = String(value == null ? '' : value)
  if (s === '') return "''"
  if (/^[A-Za-z0-9_./\\:+@-]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "''") + "'"
}

/** 最小 YAML 标量解析（去引号 / 去行内注释 / 空值归一为空串） */
export function yamlValue(raw) {
  let s = String(raw == null ? '' : raw).trim()
  if (s === '' || s === "''" || s === '""' || s === '~' || s === 'null') return ''
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'")
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1).replace(/\\"/g, '"')
  const i = s.indexOf(' #')
  if (i > 0) s = s.slice(0, i).trim()
  return s
}

// ───────────────────── 标记块：规范化与哈希（规范口径） ─────────────────────

/**
 * 规范化块内正文（content-hash 的计算口径）：
 *   1. 行尾统一 LF；2. 去掉每行**行尾**空白；3. 去掉正文首尾空行。
 * 只改行尾空白与空行，不动行首缩进与行内内容。
 */
export function normalizeBlockBody(raw) {
  const lines = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

/** 块内正文的 content-hash，形如 sha256:<64 位小写十六进制> */
export function hashBlockBody(raw) {
  return 'sha256:' + sha256Text(normalizeBlockBody(raw))
}

/** 解析块首元数据（key="value" 键值对） */
export function parseBlockMeta(head) {
  const out = {}
  const re = /([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(String(head == null ? '' : head))) !== null) out[m[1]] = m[2]
  return out
}

/** 生成块首行（字段顺序固定，便于逐字节比对） */
export function buildBeginLine(meta) {
  const order = ['generator', 'generator-version', 'template', 'template-version', 'content-hash', 'updated']
  const parts = order.map((k) => ' ' + k + '="' + String(meta[k] == null ? '' : meta[k]) + '"')
  return '<!-- wps:begin' + parts.join('') + ' -->'
}

/** 生成完整块文本（行尾用传入的 eol；末尾不带换行） */
export function buildBlockText(meta, body, eol = '\n') {
  const lines = normalizeBlockBody(body).split('\n')
  return buildBeginLine(meta) + eol + lines.join(eol) + eol + eol + '<!-- wps:end -->'
}

/** 读集成体版本（不硬编码；读不到返回 0.0.0） */
export function readGeneratorVersion(moduleDir = MODULE_DIR) {
  const raw = readFileRaw(join(moduleDir, 'package.json'))
  if (!raw) return '0.0.0'
  try {
    const pkg = JSON.parse(raw.text.replace(/^\uFEFF/, ''))
    return String((pkg && pkg.version) || '0.0.0')
  } catch (e) {
    return '0.0.0'
  }
}

/**
 * 读并编译指令层模板：从 defaults/AGENTS.zh-CN.md 提取块首元数据与块内正文，
 * 并生成**本次应写入**的块（content-hash 按规范化正文重算；generator-version / updated 覆盖）。
 * 哈希只覆盖正文、不覆盖 updated 等元数据 —— 否则每次重新生成都会被误判为「已变更」。
 *
 * @returns {{ok:boolean, error?:string, templateVersion:number, generatorVersion:string,
 *            contentHash:string, body:string, meta:object, text:string}}
 */
export function loadAgentsTemplate(templateFile, options = {}) {
  const raw = readFileRaw(templateFile)
  if (!raw) return { ok: false, error: '找不到指令层模板：' + posix(templateFile) }
  const text = raw.bom ? raw.text.replace(/^\uFEFF/, '') : raw.text
  const m = RE_BLOCK_FULL.exec(text)
  if (!m) return { ok: false, error: '模板里没有完整的 wps 标记块：' + posix(templateFile) }
  const base = parseBlockMeta(m[1])
  const body = normalizeBlockBody(m[2])
  const generatorVersion = String(options.generatorVersion || readGeneratorVersion(options.moduleDir))
  const templateVersion = Number(base['template-version'] || '0') || 1
  const meta = {
    generator: base.generator || GENERATOR_ID,
    'generator-version': generatorVersion,
    template: base.template || TEMPLATE_ID,
    'template-version': String(templateVersion),
    'content-hash': hashBlockBody(body),
    updated: formatDate(nowValue(options.now)),
  }
  return {
    ok: true,
    templateVersion: templateVersion,
    generatorVersion: generatorVersion,
    contentHash: meta['content-hash'],
    body: body,
    meta: meta,
    text: text,
  }
}

/**
 * 七状态判定（规范算法，逐条对应）：
 *   无块 -> append；begin/end 不配对 -> broken；多块 -> multiple；
 *   无 content-hash 或哈希不匹配 -> user_modified；块版本更高 -> ahead；
 *   版本更低 -> update；否则 -> up_to_date。
 * @returns {{status:string, detail:string, head?:object, body?:string}}
 */
export function decideAgentsStatus(text, template) {
  const s = String(text == null ? '' : text)
  const begins = countMatches(s, RE_BLOCK_BEGIN)
  const ends = countMatches(s, RE_BLOCK_END)

  if (begins === 0 && ends === 0) {
    return { status: 'append', detail: '未发现标记块，将在文件末尾追加完整块（块外内容不动）' }
  }
  if (begins === 0 || ends === 0) {
    return { status: 'broken', detail: '标记块不完整（wps:begin 与 wps:end 不配对），已停止写入，请手工修复' }
  }
  if (begins > 1 || ends > 1) {
    return { status: 'multiple', detail: '检测到多个标记块（begin ' + begins + ' / end ' + ends + '），已停止写入，请去重后重试' }
  }

  const m = RE_BLOCK_FULL.exec(s)
  const head = parseBlockMeta(m[1])
  const body = m[2]

  if (!head['content-hash']) {
    return { status: 'user_modified', detail: '块首缺少 content-hash（可能是手工写入的块），不自动覆盖', head: head, body: body }
  }
  if (hashBlockBody(body) !== head['content-hash']) {
    return { status: 'user_modified', detail: '块内正文与 content-hash 不一致（被手工改过），不自动覆盖', head: head, body: body }
  }

  const headTpl = Number(head['template-version'] || '0')
  if (headTpl > template.templateVersion) {
    return { status: 'ahead', detail: '工作区块版本（template-version ' + headTpl + '）高于安装器（' + template.templateVersion + '），保持不动', head: head, body: body }
  }
  if (headTpl < template.templateVersion || compareVersions(head['generator-version'], template.generatorVersion) < 0) {
    return {
      status: 'update',
      detail: '块版本（template-version ' + headTpl + ' / generator-version ' + (head['generator-version'] || '?')
        + '）低于安装器（' + template.templateVersion + ' / ' + template.generatorVersion + '），将只更新块区间',
      head: head, body: body,
    }
  }
  return { status: 'up_to_date', detail: '块版本与内容哈希都匹配，已是最新（不写盘）', head: head, body: body }
}

/** 替换块区间（纯函数）：返回新文本与块外切片 */
export function spliceBlockText(text, blockText) {
  const m = RE_BLOCK_FULL.exec(String(text == null ? '' : text))
  if (!m) return null
  const start = m.index
  const end = m.index + m[0].length
  const before = text.slice(0, start)
  const after = text.slice(end)
  return { next: before + blockText + after, before: before, after: after, outsideText: before + after, start: start, end: end }
}

/**
 * 追加块（纯函数）：块外部分**逐字节保留**，只在末尾补必要的分隔换行。
 * outsideText = **写后**块区间之外的内容（供写后比对）；originalText = 写前的全部内容
 * （写后必须仍以其为逐字节前缀 —— 这就是「块外未变」的证明）。
 */
export function appendBlockText(text, blockText, eol) {
  const s = String(text == null ? '' : text)
  if (s.trim() === '') return { next: blockText + eol, before: '', after: '', outsideText: eol, originalText: s }
  const sep = s.endsWith(eol) ? eol : eol + eol
  return { next: s + sep + blockText + eol, before: s, after: '', outsideText: s + sep + eol, originalText: s }
}

/** 取文本里标记块区间之外的内容（未匹配时返回原文） */
export function outerTextOf(text) {
  const s = String(text == null ? '' : text)
  const m = RE_BLOCK_FULL.exec(s)
  if (!m) return s
  return s.slice(0, m.index) + s.slice(m.index + m[0].length)
}

/** 取文本里标记块的正文 */
export function currentBlockBody(text) {
  const m = RE_BLOCK_FULL.exec(String(text == null ? '' : text))
  return m ? m[2] : ''
}

// ───────────────────── 最小 YAML 结构扫描（写前置校验） ─────────────────────

/**
 * 扫描 settings.yaml 的**结构**（不引入 YAML 依赖）。只回答两件事：
 *   1. 顶层命名空间与其中的二级键值（用于**精确到行**的只增改写回）；
 *   2. 结构是否可安全改写（problems）。
 * strictNamespaces 里的命名空间出现任何无法识别的行都算 fatal；其它命名空间里的
 * 列表 / 深层嵌套降级为 tolerated（那些行**逐字节不动**，不阻止写入）。
 *
 * @returns {{ok:boolean, problems:Array<{line:number,fatal:boolean,message:string}>,
 *            namespaces:object, order:object[], eol:string, lines:string[]}}
 */
export function inspectSimpleYaml(text, options = {}) {
  const strict = Array.isArray(options.strictNamespaces) ? options.strictNamespaces : []
  const eol = detectEol(text)
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
  const namespaces = {}
  const order = []
  const problems = []

  const addProblem = (lineNo, nsName, message) => {
    const fatal = nsName === null || strict.indexOf(nsName) >= 0
    problems.push({ line: lineNo, fatal: fatal, message: message })
  }

  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (line.indexOf('\t') >= 0) {
      addProblem(i + 1, current ? current.name : null, '含 TAB 缩进（YAML 不允许）')
      continue
    }
    const stripped = line.replace(/^\s+/, '')
    if (stripped[0] === '#') continue
    const isIndented = /^\s/.test(line)

    if (!isIndented) {
      const m = /^([^:#]+):(.*)$/.exec(line)
      if (!m) {
        addProblem(i + 1, null, '不是合法的顶层键值：' + clip(line, 60))
        current = null
        continue
      }
      const nsName = m[1].trim()
      if (namespaces[nsName]) {
        addProblem(i + 1, nsName, '顶层键重复：' + nsName)
        current = namespaces[nsName]
        continue
      }
      current = { name: nsName, lineIndex: i, inline: m[2].trim(), keys: {}, endLine: i, opaque: false }
      namespaces[nsName] = current
      order.push(current)
      continue
    }

    if (!current) {
      addProblem(i + 1, null, '缩进内容没有归属的顶层键')
      continue
    }
    if (/^-/.test(stripped)) {
      current.opaque = true
      addProblem(i + 1, current.name, '列表项不在支持范围（该段可能有复杂结构）')
      continue
    }
    const m = /^([^:#]+):(.*)$/.exec(stripped)
    if (!m) {
      current.opaque = true
      addProblem(i + 1, current.name, '不是合法的缩进键值：' + clip(stripped, 60))
      continue
    }
    const key = m[1].trim()
    if (current.keys[key]) {
      addProblem(i + 1, current.name, '段内键重复：' + current.name + '.' + key)
      continue
    }
    current.keys[key] = { line: i, value: yamlValue(m[2]), raw: m[2].trim() }
    current.endLine = i
  }

  const fatal = problems.filter((p) => p.fatal)
  return { ok: fatal.length === 0, problems: problems, namespaces: namespaces, order: order, eol: eol, lines: lines }
}

/** 读 settings.yaml 里目标键的现值（只读） */
export function readSettingsValues(settingsFile, options = {}) {
  const raw = readFileRaw(settingsFile)
  if (!raw) return { exists: false, values: {}, problems: [], bom: '', eol: '\n' }
  const text = raw.bom === 'UTF-8' ? raw.text.replace(/^\uFEFF/, '') : raw.text
  const scan = inspectSimpleYaml(text, options)
  const values = {}
  for (const t of SETTINGS_TARGETS) {
    const ns = scan.namespaces[t.ns]
    if (!ns) continue
    const entry = ns.keys[t.key]
    if (entry) values[t.ns + '.' + t.key] = entry.value
  }
  return { exists: true, values: values, problems: scan.problems, bom: raw.bom, eol: scan.eol, scan: scan, text: text }
}

/**
 * 计算 settings.yaml 的文本级改写计划（纯函数，不落盘）：
 *   只增改 writes 里的键；其余行**逐字节保留**。
 *   write.action === 'set' 时即使键已有值也覆盖；否则已有非空值一律保留。
 * @returns {{ok:boolean, error?:string, text?:string, changes:object[], skipped:object[], eol:string}}
 */
export function planSettingsWrite(text, writes, options = {}) {
  const eol = detectEol(text)
  const src = String(text == null ? '' : text)
  const scan = inspectSimpleYaml(src, options)
  const fatal = scan.problems.filter((p) => p.fatal)
  if (fatal.length > 0) {
    return {
      ok: false,
      error: 'YAML 结构无法安全改写，已拒绝写入：' + fatal.map((p) => '第 ' + p.line + ' 行 ' + p.message).join('；'),
      changes: [], skipped: [], eol: eol,
    }
  }

  const hadTrailingEol = src.endsWith('\n')
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '' && hadTrailingEol) lines.pop()
  if (src.trim() === '') lines.length = 0

  const changes = []
  const skipped = []

  for (const w of writes) {
    const ns = scan.namespaces[w.ns]
    if (!ns) {
      // 新建命名空间段（同一段的后续键会因重扫而走「段内插入」分支，不会重复段头）
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
      lines.push(w.ns + ':', '  ' + w.key + ': ' + yamlScalar(w.value))
      changes.push({ ns: w.ns, key: w.key, action: 'addNamespace', value: w.value, line: lines.length })
      const rescanNs = inspectSimpleYaml(lines.join('\n'), options)
      scan.namespaces = rescanNs.namespaces
      continue
    }
    const entry = ns.keys[w.key]
    if (entry) {
      if (entry.value !== '' && w.action !== 'set') {
        skipped.push({ ns: w.ns, key: w.key, action: 'keepExisting', value: entry.value })
        continue
      }
      if (entry.value === w.value) {
        skipped.push({ ns: w.ns, key: w.key, action: 'upToDate', value: entry.value })
        continue
      }
      lines[entry.line] = '  ' + w.key + ': ' + yamlScalar(w.value)
      changes.push({ ns: w.ns, key: w.key, action: w.action === 'set' ? 'set' : 'fill', value: w.value, line: entry.line + 1, from: entry.value })
      continue
    }
    // 段内插入：放在该段最后一个非空行之后
    // 段内插入：放在该段最后一个非空行之后
    let at = ns.endLine + 1
    while (at > ns.lineIndex + 1 && lines[at - 1] !== undefined && lines[at - 1].trim() === '') at -= 1
    lines.splice(at, 0, '  ' + w.key + ': ' + yamlScalar(w.value))
    changes.push({ ns: w.ns, key: w.key, action: 'add', value: w.value, line: at + 1 })
    const rescanAdd = inspectSimpleYaml(lines.join('\n'), options)
    scan.namespaces = rescanAdd.namespaces
  }

  return { ok: true, text: lines.join(eol) + eol, changes: changes, skipped: skipped, eol: eol }
}

// ───────────────────────────── 记忆种子 ─────────────────────────────

/** 从种子文件里提取种子条目（围栏代码块内的非空行） */
export function loadMemorySeed(seedFile) {
  const raw = readFileRaw(seedFile)
  if (!raw) return { ok: false, error: '找不到记忆种子文件：' + posix(seedFile), entries: [] }
  const text = raw.bom ? raw.text.replace(/^\uFEFF/, '') : raw.text
  const entries = []
  const re = /\x60\x60\x60[^\n]*\n([\s\S]*?)\x60\x60\x60/g
  let m
  while ((m = re.exec(text)) !== null) {
    for (const line of m[1].split(/\r?\n/)) {
      const s = line.trim()
      if (s) entries.push(s)
    }
  }
  return { ok: true, entries: entries }
}

/** 种子条目的匹配键（去全部空白，抗格式漂移） */
export function seedKey(text) {
  return String(text == null ? '' : text).replace(/\s+/g, '')
}

/** 记忆条目的正文（去掉 id / 日期 / branch / tag 前缀） */
export function entryContent(entry) {
  return String(entry == null ? '' : entry)
    .replace(/^\[id:[a-f0-9]+\]\s*/, '')
    .replace(/^\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '')
    .replace(/^\[branch:[^\]]*\]\s*/, '')
    .replace(/^\[tag:[^\]]*\]\s*/, '')
}

/** 种子是否已在现有条目里（正文前 30 字符前缀匹配，容忍使用者小改） */
export function isSeedPresent(seed, existingContents, prefixLen = 30) {
  const k = seedKey(seed)
  const head = k.slice(0, prefixLen)
  for (const c of existingContents) {
    const kc = seedKey(entryContent(c))
    if (kc === k) return true
    if (head.length >= 8 && kc.startsWith(head)) return true
  }
  return false
}

/** 种子条目的 tag（语言 / 协作红线 → 关键，其余 → 常规） */
export function seedTag(content) {
  for (const rule of SEED_TAG_RULES) {
    if (String(content).indexOf(rule.match) >= 0) return rule.tag
  }
  return SEED_DEFAULT_TAG
}

/** 生成记忆条目 id（确定性：同内容同 id，保证幂等） */
export function seedEntryId(content) {
  return sha256Text('wps-seed:' + seedKey(content)).slice(0, 12)
}

/** 拼装记忆条目（与 dsh-work-memory 的 makeEntry 格式一致） */
export function makeSeedEntry(content, options = {}) {
  const date = options.date || formatDate(nowValue(options.now))
  const tag = options.tag || seedTag(content)
  return '[id:' + (options.id || seedEntryId(content)) + '] [' + date + '] [tag:' + tag + '] ' + content
}

// ───────────────────────────── 工作区 / 路径解析 ─────────────────────────────

/** DSH_HOME（DSH_HOME → ~/.dsh） */
export function resolveDshHome(env = process.env) {
  const source = env || {}
  const explicit = String(source.DSH_HOME || '').trim()
  if (explicit) return resolve(explicit)
  return join(homedir(), '.dsh')
}

/**
 * 由**记忆镜像目录**反推知识库根目录（vault 根）：取父目录。
 * **单一实现**：resolveWorkspace 的 derived 分支与 setup-state 的 obsidianDir 都调用它，
 * 避免「反推逻辑写第二份」。
 * @param {string} mirrorDir 记忆镜像目录（如 <vault>/00_全局记忆）
 * @returns {string} 父目录绝对路径；入参为空返回空串
 */
export function deriveVaultRootFromMirror(mirrorDir) {
  const m = normalizePath(mirrorDir)
  return m ? dirname(m) : ''
}

/** 目录是否「看起来像工作区」（含 AGENTS.md / .dsh / .git 之一） */
export function looksLikeWorkspace(dir) {
  if (!dir) return false
  try {
    if (!statSync(dir).isDirectory()) return false
  } catch (e) {
    return false
  }
  for (const name of ['AGENTS.md', '.dsh', '.git']) {
    try {
      if (existsSync(join(dir, name))) return true
    } catch (e) { /* best-effort */ }
  }
  return false
}

/** 归一化路径（去空白 + resolve；空值返回空串） */
export function normalizePath(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return ''
  try {
    return resolve(s)
  } catch (e) {
    return s
  }
}

/** 目录是否存在且确实是目录（读不到返回 false，不抛） */
export function isDirectory(dir) {
  if (!dir) return false
  try {
    return statSync(dir).isDirectory()
  } catch (e) {
    return false
  }
}

/**
 * 是否为**用户主目录**。
 * 硬护栏：任何来源（client / config / derived / cwd / default）都不允许把工作区落到这里 ——
 * 「DSH_HOME 的上一级」正是用户主目录，且主目录下有 ~/.dsh，会把家目录误判成工作区，
 * 导致 AGENTS.md 被写进家目录、技能装到 ~/.dsh/skills（既不生效又污染主目录）。
 */
export function isHomePath(dir, env = process.env) {
  const d = normalizePath(dir)
  if (!d) return false
  const source = env || {}
  const home = normalizePath(String(source.USERPROFILE || source.HOME || '').trim() || homedir())
  if (!home) return false
  return d.toLowerCase() === home.toLowerCase()
}

/**
 * 解析工作区（**只读探测；绝不回退到用户主目录**）。
 * 优先级：
 *   ① 调用方显式传入（客户端表单 / 引导填值）                     → source = 'client'
 *   ② 设置项 workspace（部署默认层）                              → source = 'config'
 *   ③ 由 settings 的 work-memory.obsidianSyncDir **反推父目录**   → source = 'derived'
 *   ④ process.cwd()（须 looksLikeWorkspace）                      → source = 'cwd'
 *   ⑤ 显式注入的默认候选（确有合理默认时才由调用方传入）          → source = 'default'
 *   ⑥ 都不可用 → { workspace: null, source: 'none' }（显式失败，不产出任何路径）
 * @returns {{workspace:(string|null), source:'client'|'config'|'derived'|'cwd'|'default'|'none',
 *            derivedFrom?:string, tried:string[]}}
 */
export function resolveWorkspace(options = {}) {
  const env = options.env || process.env
  const dshHome = options.dshHome ? normalizePath(options.dshHome) : resolveDshHome(env)
  const tried = []
  const reject = (dir, why) => {
    const tag = String(dir || '') + '（' + why + '）'
    if (dir && tried.indexOf(tag) < 0) tried.push(tag)
  }
  const accept = (dir) => Boolean(dir) && dir !== dshHome && !isHomePath(dir, env) && isDirectory(dir)

  // ① 调用方显式传入
  const explicit = normalizePath(options.workspace)
  if (explicit) {
    if (accept(explicit)) return { workspace: explicit, source: options.source || 'client', tried: tried }
    reject(explicit, isHomePath(explicit, env) ? '是用户主目录，已拒绝' : '不是已存在的目录')
  }

  // ② 设置项 workspace
  const cfg = normalizePath(options.configWorkspace)
  if (cfg) {
    if (accept(cfg)) return { workspace: cfg, source: 'config', tried: tried }
    reject(cfg, isHomePath(cfg, env) ? '是用户主目录，已拒绝' : '不是已存在的目录')
  }

  // ③ 由记忆镜像目录反推（镜像目录通常是 vault 下的一个子目录，其父目录即工作区）
  const mirror = normalizePath(options.obsidianSyncDir)
  if (mirror) {
    const parent = deriveVaultRootFromMirror(mirror)
    if (accept(parent)) return { workspace: parent, source: 'derived', derivedFrom: mirror, tried: tried }
    if (accept(mirror)) return { workspace: mirror, source: 'derived', derivedFrom: mirror, tried: tried }
    reject(parent, '记忆镜像目录的父目录不可用（不存在 / 是用户主目录 / 等于 DSH_HOME）')
  }

  // ④ 当前进程目录
  const cwd = normalizePath(options.cwd || process.cwd())
  if (cwd) {
    if (accept(cwd) && looksLikeWorkspace(cwd)) return { workspace: cwd, source: 'cwd', tried: tried }
    reject(cwd, isHomePath(cwd, env) ? '是用户主目录，已拒绝' : '不像工作区（无 AGENTS.md / .dsh / .git）')
  }

  // ⑤ 调用方显式注入的默认候选
  const injected = Array.isArray(options.candidates) ? options.candidates : []
  for (const raw of injected) {
    const dir = normalizePath(raw)
    if (!dir) continue
    if (accept(dir) && looksLikeWorkspace(dir)) return { workspace: dir, source: 'default', tried: tried }
    reject(dir, '默认候选不可用')
  }

  return { workspace: null, source: 'none', tried: tried }
}

/**
 * 校验 workspace 入参（GET query / POST overrides 共用）。
 * 引导要求「工作区可任意指定」，因此只要求：非空 + 绝对路径 + 存在且是目录；
 * 不要求已含 AGENTS.md / .dsh（干净工作区首装时它们还不存在）。
 */
export function safeWorkspaceParam(value) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return { ok: false, empty: true, error: '未提供工作区路径' }
  const target = normalizePath(s)
  if (!isAbsolute(target)) return { ok: false, empty: false, error: '工作区必须是绝对路径：' + clip(s, 80) }
  if (isHomePath(target)) return { ok: false, empty: false, error: '工作区不能是用户主目录（会把 AGENTS.md 写到家目录且不生效）：' + posix(target) }
  if (!isDirectory(target)) return { ok: false, empty: false, error: '工作区不存在或不是目录：' + posix(target) }
  return { ok: true, workspace: target }
}

// ───────────────────────────── 上下文解析 ─────────────────────────────

/**
 * 解析一次计划 / 写回共用的上下文。
 * options.overrides（配置引导填值）：{ workspace, defaultDomain, identityExpert, memoryDir, obsidianSyncDir }
 *   - workspace 决定 AGENTS.md 与技能写到哪儿；
 *   - memoryDir / obsidianSyncDir 决定记忆库与镜像目录（同时写进 settings）；
 *   - defaultDomain / identityExpert 写进 settings 的 experts 段；
 *   - 未传的键视为「用探测到的现状 / 默认值」。
 */
export function resolveDeckContext(options = {}) {
  const env = options.env || process.env
  const now = nowValue(options.now)
  const overrides = (options.overrides && typeof options.overrides === 'object') ? options.overrides : {}
  const ovWorkspace = typeof overrides.workspace === 'string' ? overrides.workspace.trim() : ''
  const ovMemoryDir = typeof overrides.memoryDir === 'string' ? overrides.memoryDir.trim() : ''
  const ovObsidian = typeof overrides.obsidianSyncDir === 'string' ? overrides.obsidianSyncDir.trim() : ''
  const ovObsidianDir = typeof overrides.obsidianDir === 'string' ? overrides.obsidianDir.trim() : ''
  const ovDomain = typeof overrides.defaultDomain === 'string' ? overrides.defaultDomain.trim() : ''
  const ovIdentity = typeof overrides.identityExpert === 'string' ? overrides.identityExpert.trim() : ''

  const dshHome = options.dshHome ? normalizePath(options.dshHome) : resolveDshHome(env)
  const moduleDir = normalizePath(options.moduleDir) || MODULE_DIR

  // 先读设置：工作区可能要从记忆镜像目录（work-memory.obsidianSyncDir）反推
  const settingsFile = normalizePath(options.settingsFile) || join(dshHome, 'settings.yaml')
  const settingsRead = readSettingsValues(settingsFile, { strictNamespaces: ['work-memory', 'experts'] })
  const values = settingsRead.values || {}

  // 工作区解析（**绝不回退到用户主目录**）：client → config → derived → cwd → default → none
  const wsResolved = resolveWorkspace({
    workspace: ovWorkspace,
    configWorkspace: normalizePath(options.workspace) || normalizePath(options.configWorkspace),
    obsidianSyncDir: values['work-memory.obsidianSyncDir'],
    cwd: options.cwd,
    dshHome: dshHome,
    env: env,
    candidates: options.candidates,
  })
  const workspace = wsResolved.workspace
  const workspaceSource = workspace ? wsResolved.source : 'none'

  const repoRootInfo = options.repoRoot
    ? { repoRoot: normalizePath(options.repoRoot), source: 'config', sourceDetail: 'config' }
    : resolveRepoRoot({
      configRoot: options.configRepoRoot,
      moduleDir: moduleDir,
      env: env,
      commonCandidates: options.commonCandidates,
    })

  // 记忆库目录（**只有一个默认**）：显式填值 → 设置里的 memoryDir → 唯一默认
  //   <DSH_HOME>/data/dsh-work-memory/memory（与 dsh-work-memory 的 defaultMemoryRoot() 同口径）
  // 1.1.3 之前还有一条「不填就按工作区名分库：<DSH_HOME>/memories/<工作区名>」的推导，已废弃 ——
  // 上游记忆库自己只有一个默认位置，这里再留一个工作区名默认就是**两个默认**。
  // 要按工作区分库的使用者，在「核心配置」里显式填 memoryDir（引导会把它写进 settings 的 work-memory.memoryDir）。
  const memoryDir = normalizePath(ovMemoryDir)
    || normalizePath(options.memoryDir)
    || normalizePath(values['work-memory.memoryDir'])
    || join(dshHome, DEFAULT_MEMORY_SUBDIR)
  const backupDir = normalizePath(options.backupDir)
    || normalizePath(values['work-memory.backupDir'])
    || join(dshHome, DEFAULT_BACKUP_SUBDIR)
  // obsidianSyncDir：哨兵 __none__ = 显式关闭镜像（写空值，且不再回填默认）
  const obsidianExplicitOff = ovObsidian === NONE_SENTINEL_VALUE
  const obsidianSyncDir = obsidianExplicitOff ? ''
    : (normalizePath(ovObsidian)
      || normalizePath(options.obsidianSyncDir)
      || normalizePath(values['work-memory.obsidianSyncDir'])
      || (workspace ? join(workspace, 'work-memory') : ''))

  // obsidianDir（1.1.3）= **知识库根目录**（vault 根），与 obsidianSyncDir（镜像子目录）严格区分。
  // 只接受显式传入（overrides.obsidianDir / options.obsidianDir）：**绝不从镜像目录反推** ——
  // 结构生成器会在这条路径下建目录与文件，猜错会写进使用者其它目录。
  const obsidianDir = normalizePath(ovObsidianDir) || normalizePath(options.obsidianDir)

  // 记忆库名与记忆库根（供客户端做「使用默认」候选与路径拼接）
  const libraryName = memoryDir ? basename(memoryDir) : ''
  const memoryRoot = memoryDir ? dirname(memoryDir) : ''

  const templateFile = normalizePath(options.templateFile)
    || join(moduleDir, '..', '..', 'defaults', 'AGENTS.zh-CN.md')
  const seedFile = normalizePath(options.seedFile)
    || join(moduleDir, '..', '..', 'defaults', 'global-memory.seed.md')

  const skillsSourceDir = normalizePath(options.skillsSourceDir)
    || (repoRootInfo.repoRoot ? join(repoRootInfo.repoRoot, 'modules', DOC_SUITE_MODULE, SKILLS_DIR_NAME) : '')

  return {
    env: env,
    now: now,
    dshHome: dshHome,
    workspace: workspace,
    workspaceSource: workspaceSource,
    workspaceDerivedFrom: wsResolved.derivedFrom || '',
    workspaceTried: wsResolved.tried || [],
    repoRoot: repoRootInfo.repoRoot,
    repoRootSource: repoRootInfo.source,
    repoRootSourceDetail: repoRootInfo.sourceDetail,
    moduleDir: moduleDir,
    generatorVersion: options.generatorVersion || readGeneratorVersion(moduleDir),
    agentsFile: normalizePath(options.agentsFile) || (workspace ? join(workspace, 'AGENTS.md') : ''),
    settingsFile: settingsFile,
    settingsRead: settingsRead,
    memoryDir: memoryDir,
    // 迁移来源（旧记忆库目录）：由 api 层经**宿主设置服务**解析后注入；
    // basedeck 自己不读 settings.yaml（那是宿主的文件与格式，不归本插件管）
    migrateFrom: normalizePath(options.migrateFrom),
    migrateFromSource: typeof options.migrateFromSource === 'string' ? options.migrateFromSource : '',
    libraryName: libraryName,
    memoryRoot: memoryRoot,
    obsidianExplicitOff: obsidianExplicitOff,
    memoryFile: memoryDir ? join(memoryDir, 'MEMORY.md') : '',
    backupDir: backupDir,
    obsidianSyncDir: obsidianSyncDir,
    obsidianDir: obsidianDir,
    petSkinsDir: normalizePath(options.petSkinsDir) || join(dshHome, PET_SKINS_SUBDIR),
    skillsSourceDir: skillsSourceDir,
    skillsTargetDir: normalizePath(options.skillsTargetDir) || (workspace ? join(workspace, '.dsh', SKILLS_DIR_NAME) : ''),
    templateFile: templateFile,
    seedFile: seedFile,
    settingsTargets: options.settingsTargets || SETTINGS_TARGETS,
    overrides: {
      workspace: ovWorkspace,
      memoryDir: ovMemoryDir,
      obsidianSyncDir: ovObsidian,
      obsidianDir: ovObsidianDir,
      defaultDomain: ovDomain,
      identityExpert: ovIdentity,
    },
  }
}

// ───────────────────────────── 计划器 ─────────────────────────────

/** 组装一项计划（对外字段严格按接口契约；internal 仅供写回器使用，API 层需剔除） */
function makeItem(spec, patch) {
  return Object.assign({
    id: spec.id,
    label: spec.label,
    status: 'none',
    target: '',
    detail: '',
    autoApplyable: false,
    preview: { action: '', blockVersion: '', contentHash: '', sampleLines: '' },
  }, patch || {})
}

/** 汇总 summary（契约字段 + 说明性 none 计数） */
export function summarize(items) {
  const s = { total: items.length, toWrite: 0, upToDate: 0, blocked: 0, none: 0 }
  for (const it of items) {
    if (it.status === 'append' || it.status === 'update') s.toWrite += 1
    else if (it.status === 'up_to_date') s.upToDate += 1
    else if (it.status === 'none') s.none += 1
    else s.blocked += 1
  }
  return s
}

/** 引导触发信号：AGENTS.md 无标记块 / settings 缺 4 个键 / skills 有缺失 —— 任一成立即 true */
export function computeSetupNeeded(items) {
  const byId = {}
  for (const it of items) byId[it.id] = it
  const agents = byId.agentsMd
  if (agents && agents.status === 'append') return true
  const settings = byId.settings
  if (settings && Array.isArray(settings.settingsKeys)) {
    for (const k of settings.settingsKeys) {
      if (k.action === 'write') return true
    }
  }
  const skills = byId.skills
  if (skills && Array.isArray(skills.files)) {
    for (const f of skills.files) {
      if (f.state === 'missing') return true
    }
  }
  return false
}

/**
 * 工作区来源提示（界面必须让使用者看到「工作区是怎么来的」）。
 * derived 来源必须显式提示确认 —— 它是从记忆镜像目录反推的，不是使用者直接指定的。
 */
export function workspaceNoteFor(ctx) {
  if (!ctx.workspace) {
    return '未解析到工作区：请显式填写工作区目录（安装器不会回退到用户主目录）'
  }
  if (ctx.workspaceSource === 'derived') {
    return '工作区由记忆镜像目录反推（' + posix(ctx.workspaceDerivedFrom || '') + ' 的父目录：' + posix(ctx.workspace) + '），请确认'
  }
  if (ctx.workspaceSource === 'cwd') {
    return '工作区取自当前进程目录：' + posix(ctx.workspace) + '，请确认'
  }
  return ''
}

/** 生成整个配置底座的 dry-run 计划（**只读**，绝不写盘） */
export function planBaseDeck(options = {}) {
  const ctx = resolveDeckContext(options)
  const items = BASEDECK_ITEMS.map((spec) => {
    if (spec.id === 'agentsMd') return planAgentsMd(ctx)
    if (spec.id === 'memorySeed') return planMemorySeed(ctx)
    if (spec.id === 'skills') return planSkills(ctx)
    if (spec.id === 'settings') return planSettings(ctx)
    if (spec.id === 'memoryDeck') return planMemoryDeck(ctx)
    if (spec.id === 'knowledgeDeck') return planKnowledgeDeck(ctx)
    if (spec.id === 'migrateMemory') return planMigrateMemory(ctx)
    return planDirs(ctx)
  })
  const note = workspaceNoteFor(ctx)
  if (note && (ctx.workspaceSource === 'derived' || ctx.workspaceSource === 'cwd')) {
    // 受影响的两项（写工作区根 / 写工作区技能目录）把来源提示带进 detail
    for (const it of items) {
      if (it.id === 'agentsMd' || it.id === 'skills') it.detail = it.detail + '（' + note + '）'
    }
  }
  return {
    ok: true,
    workspace: ctx.workspace ? posix(ctx.workspace) : '',
    workspaceSource: ctx.workspaceSource || 'none',
    workspaceNote: note,
    workspaceDerivedFrom: ctx.workspaceDerivedFrom ? posix(ctx.workspaceDerivedFrom) : '',
    workspaceTried: ctx.workspaceTried || [],
    libraryName: ctx.libraryName || '',
    memoryRoot: ctx.memoryRoot ? posix(ctx.memoryRoot) : '',
    memoryDir: ctx.memoryDir ? posix(ctx.memoryDir) : '',
    migrateFrom: ctx.migrateFrom ? posix(ctx.migrateFrom) : '',
    migrateFromSource: ctx.migrateFromSource || '',
    items: items,
    summary: summarize(items),
    setupNeeded: computeSetupNeeded(items),
    ctx: ctx,
  }
}

// ── ① 指令层 AGENTS.md ──

function planAgentsMd(ctx) {
  const spec = BASEDECK_ITEMS[0]
  const template = loadAgentsTemplate(ctx.templateFile, { generatorVersion: ctx.generatorVersion, now: ctx.now, moduleDir: ctx.moduleDir })
  if (!template.ok) {
    return makeItem(spec, {
      status: 'broken',
      target: ctx.agentsFile ? posix(ctx.agentsFile) : '',
      detail: template.error,
      preview: { action: '模板不可用，无法处理', blockVersion: '', contentHash: '', sampleLines: '' },
    })
  }
  const internal = { blockText: '', eol: '\n', blockHash: template.contentHash }

  if (!ctx.workspace) {
    return makeItem(spec, {
      status: 'none',
      target: '',
      detail: '未解析到工作区（workspace 未填且默认探测落空）——这是显式失败，不猜路径',
      preview: { action: '未解析到工作区，无法处理', blockVersion: String(template.templateVersion), contentHash: template.contentHash, sampleLines: sampleLines(template.body) },
      internal: internal,
    })
  }

  const raw = readFileRaw(ctx.agentsFile)
  const eol = raw ? detectEol(raw.text) : '\n'
  const blockText = buildBlockText(template.meta, template.body, eol)
  internal.blockText = blockText
  internal.eol = eol
  internal.exists = Boolean(raw)

  if (raw && raw.bom) {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.agentsFile),
      detail: 'AGENTS.md 带 ' + raw.bom + ' BOM（DSH 侧会解析失败），已拒绝写入；请先另存为 UTF-8 无 BOM',
      preview: { action: '文件带 BOM，已拒绝写入（请先转为 UTF-8 无 BOM）', blockVersion: String(template.templateVersion), contentHash: template.contentHash, sampleLines: sampleLines(template.body) },
      internal: internal,
    })
  }

  const decided = decideAgentsStatus(raw ? raw.text : '', template)
  const actionText = decided.status === 'append' ? (raw ? '将在文件末尾追加标记块' : '将新建')
    : decided.status === 'update' ? '将只更新标记块区间'
      : decided.status === 'up_to_date' ? '已是最新无需写入'
        : decided.status === 'user_modified' ? '块内被手工改过不自动覆盖'
          : decided.status === 'ahead' ? '工作区块比安装器新，保持不动'
            : decided.status === 'broken' ? '标记块不完整，已停止写入'
              : '检测到多个标记块，已停止写入'

  const shownBody = decided.status === 'append' ? template.body : (decided.body || template.body)
  internal.decided = decided

  return makeItem(spec, {
    status: decided.status,
    target: posix(ctx.agentsFile),
    detail: decided.detail,
    autoApplyable: decided.status === 'append' || decided.status === 'update',
    preview: {
      action: actionText,
      blockVersion: String(decided.head ? (decided.head['template-version'] || template.templateVersion) : template.templateVersion),
      contentHash: template.contentHash,
      sampleLines: sampleLines(normalizeBlockBody(shownBody)),
    },
    internal: internal,
  })
}

// ── ② 记忆种子 ──

function planMemorySeed(ctx) {
  const spec = BASEDECK_ITEMS[1]
  const seed = loadMemorySeed(ctx.seedFile)
  if (!seed.ok) {
    return makeItem(spec, {
      status: 'broken',
      target: ctx.memoryFile ? posix(ctx.memoryFile) : '',
      detail: seed.error,
      preview: { action: '种子文件不可用', blockVersion: '', contentHash: '', sampleLines: '' },
    })
  }

  if (!ctx.memoryFile) {
    return makeItem(spec, {
      status: 'none',
      target: '',
      detail: '没有可用的记忆库目录（未解析到工作区且设置里没有 memoryDir），跳过（显式失败，不猜路径）',
      preview: { action: '没有可用的记忆库目录，无法处理', blockVersion: '', contentHash: '', sampleLines: '' },
      internal: { pending: [], newEntries: [], entries: [], text: '', exists: false },
    })
  }

  const raw = ctx.memoryFile ? readFileRaw(ctx.memoryFile) : null
  const text = raw ? raw.text : ''
  const entries = text.split('\n§\n').map((e) => e.trim()).filter((e) => e.length > 0)

  if (raw && raw.bom) {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.memoryFile),
      detail: 'MEMORY.md 带 ' + raw.bom + ' BOM，已拒绝写入；请先另存为 UTF-8 无 BOM',
      preview: { action: '文件带 BOM，已拒绝写入', blockVersion: '', contentHash: '', sampleLines: sampleLines(text) },
    })
  }
  if (raw && entries.length === 0 && text.trim() !== '') {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.memoryFile),
      detail: 'MEMORY.md 存在但读不出任何条目，已拒绝追加（避免覆盖你的记忆库）',
      preview: { action: '记忆库无法解析，已停止写入', blockVersion: '', contentHash: '', sampleLines: sampleLines(text) },
    })
  }

  const pending = []
  const present = []
  for (const item of seed.entries) {
    if (isSeedPresent(item, entries)) present.push(item)
    else pending.push(item)
  }

  const status = pending.length === 0 ? (entries.length > 0 ? 'up_to_date' : 'append')
    : (entries.length === 0 ? 'append' : 'update')
  const action = pending.length === 0 ? '已是最新无需写入'
    : (entries.length === 0 ? '将新建' : '将在记忆库末尾追加种子条目')
  const detail = pending.length === 0
    ? '种子条目 ' + present.length + ' 条都已存在（幂等，不写盘）'
    : (entries.length === 0
      ? '记忆库为空，将写入 ' + pending.length + ' 条种子条目（写入前备份）'
      : '将追加 ' + pending.length + ' 条种子条目（已有 ' + entries.length + ' 条一字不动，写入前备份）')

  const newEntries = pending.map((c) => makeSeedEntry(c, { now: ctx.now }))
  return makeItem(spec, {
    status: status,
    target: posix(ctx.memoryFile),
    detail: detail,
    autoApplyable: pending.length > 0,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(newEntries.join('\n§\n')),
      sampleLines: sampleLines(pending.join('\n')),
    },
    internal: { pending: pending, newEntries: newEntries, entries: entries, text: text, exists: Boolean(raw) },
  })
}

// ── ③ 文档技能 ──

function planSkills(ctx) {
  const spec = BASEDECK_ITEMS[2]
  const files = []
  let names = []
  try {
    names = readdirSync(ctx.skillsSourceDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch (e) {
    names = []
  }
  if (ctx.skillsSourceDir && names.length === 0) {
    return makeItem(spec, {
      status: 'broken',
      target: ctx.skillsTargetDir ? posix(ctx.skillsTargetDir) : '',
      detail: '找不到技能源（' + posix(ctx.skillsSourceDir) + '）：集成体仓库未解析或模块缺失',
      files: files,
      preview: { action: '技能源不可用', blockVersion: '', contentHash: '', sampleLines: '' },
    })
  }
  if (!ctx.workspace) {
    return makeItem(spec, {
      status: 'none',
      target: '',
      detail: '未解析到工作区（显式失败，不猜路径）',
      files: files,
      preview: { action: '未解析到工作区，无法处理', blockVersion: '', contentHash: '', sampleLines: sampleBlock(names) },
    })
  }

  let same = 0
  let missing = 0
  let modified = 0
  for (const name of names) {
    const srcFile = join(ctx.skillsSourceDir, name, 'SKILL.md')
    const dstFile = join(ctx.skillsTargetDir, name, 'SKILL.md')
    const srcRaw = readFileRaw(srcFile)
    if (!srcRaw) continue
    const dstRaw = readFileRaw(dstFile)
    let state
    let detail = ''
    if (!dstRaw) {
      state = 'missing'
      missing += 1
      detail = '本地缺失，将安装'
    } else if (sha256Text(srcRaw.buffer) === sha256Text(dstRaw.buffer)) {
      state = 'same'
      same += 1
      detail = '与仓库版本一致'
    } else {
      state = 'modified'
      modified += 1
      detail = '本地版本与仓库不一致（本地 ' + (dstRaw.text.split('\n').length - 1) + ' 行 vs 仓库 '
        + (srcRaw.text.split('\n').length - 1) + ' 行）：' + diffLines(srcRaw.text, dstRaw.text).join('；')
    }
    files.push({ name: name, state: state, source: posix(srcFile), target: posix(dstFile), detail: detail })
  }

  const needWrite = missing > 0
  const status = modified > 0 ? 'user_modified' : (needWrite ? (same === 0 ? 'append' : 'update') : 'up_to_date')
  const action = modified > 0 ? '部分技能被本地改过，只安装缺失的，不覆盖改动'
    : needWrite ? (same === 0 ? '将新建' : '将安装缺失的技能')
      : '已是最新无需写入'
  const detail = '共 ' + files.length + ' 个技能：一致 ' + same + ' / 缺失 ' + missing + ' / 本地改过 ' + modified
    + (modified > 0 ? '（改过的不覆盖，仅报告差异）' : '')

  return makeItem(spec, {
    status: status,
    target: posix(ctx.skillsTargetDir),
    detail: detail,
    autoApplyable: needWrite,
    files: files,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(files.map((f) => f.name + ':' + f.state).join('\n')),
      sampleLines: sampleBlock(files.map((f) => f.name + '  [' + f.state + ']')),
    },
    internal: { files: files, names: names, missing: missing, modified: modified, same: same },
  })
}

/** 逐行差异摘要（最多 3 处） */
export function diffLines(srcText, dstText) {
  const a = String(srcText == null ? '' : srcText).replace(/\r\n?/g, '\n').split('\n')
  const b = String(dstText == null ? '' : dstText).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < 3; i++) {
    if (a[i] !== b[i]) {
      out.push('第 ' + (i + 1) + ' 行 仓库版「' + clip(a[i] === undefined ? '（无）' : a[i], 40)
        + '」/ 本地版「' + clip(b[i] === undefined ? '（无）' : b[i], 40) + '」')
    }
  }
  return out
}

// ── ④ 设置用户层 ──

function planSettings(ctx) {
  const spec = BASEDECK_ITEMS[3]
  const raw = readFileRaw(ctx.settingsFile)
  const text = raw ? (raw.bom ? raw.text.replace(/^\uFEFF/, '') : raw.text) : ''
  const ov = ctx.overrides || {}

  // 路径类值统一写正斜杠（Windows 路径在 YAML 里更安全，也与既有 settings.yaml 风格一致）
  const asPath = (v) => (v ? posix(v) : '')
  // memoryDir 与 ctx.memoryDir **严格同源**：种子 / 记忆体结构写进哪个目录，settings 就声明哪个目录。
  // 否则种子条目会写进 A 目录（ctx.memoryDir），settings 却声明 B 目录，插件按 settings 去 B 处读取
  // → 首装即「记忆库为空」。ctx.memoryDir 为空时这里也给空串（宁可不写，也不猜第二个默认）。
  // 优先级链见 resolveDeckContext（唯一默认 = <DSH_HOME>/data/dsh-work-memory/memory，不再按工作区名推导）。
  const suggestedMemoryDir = ctx.memoryDir ? posix(ctx.memoryDir) : ''
  // 1.1.3：填了知识库根目录时，镜像目录的**建议值**改为 <知识库根>/00_全局记忆
  //（设计定稿 §3.3 第 3 步「把记忆镜像写入知识库的 00_全局记忆 区」）。
  // 未提供 obsidianDir 时保持 1.1.2 的口径（<工作区>/work-memory），既有测试与行为一字不变。
  const suggestedMirror = ctx.obsidianDir
    ? posix(join(ctx.obsidianDir, VAULT_MIRROR_DIR_NAME))
    : (ctx.workspace ? posix(join(ctx.workspace, 'work-memory')) : '')
  const suggested = {
    'work-memory.memoryDir': suggestedMemoryDir,
    'work-memory.obsidianSyncDir': suggestedMirror,
  }
  // 「不使用镜像」哨兵：写成空值（显式关闭），与「空串 = 用现状/默认」严格区分
  const obsidianOff = ov.obsidianSyncDir === NONE_SENTINEL_VALUE
  const overrideValues = {
    'work-memory.memoryDir': asPath(ov.memoryDir),
    'work-memory.obsidianSyncDir': obsidianOff ? '' : asPath(ov.obsidianSyncDir),
    'experts.defaultDomain': ov.defaultDomain,
    'experts.identityExpert': ov.identityExpert,
  }
  const forceSet = { 'work-memory.obsidianSyncDir': obsidianOff }

  // 「留空会发生什么」必须显式写进 detail：避免 obsidianSyncDir 的留空变成隐性副作用
  const obsidianCurrent = (ctx.settingsRead.values || {})['work-memory.obsidianSyncDir']
  const obsidianClosed = ctx.obsidianExplicitOff || obsidianCurrent === ''
  const obsidianHint = obsidianClosed
    ? 'obsidianSyncDir 为空值（显式关闭镜像同步，不会回填默认目录）'
    : (ctx.workspace
      ? 'obsidianSyncDir 留空将镜像到 ' + posix(join(ctx.workspace, 'work-memory'))
      : 'obsidianSyncDir 留空将镜像到 <工作区>/work-memory（当前未解析到工作区，无法给出具体路径）')
  const hintFor = (id) => (id === 'work-memory.obsidianSyncDir' ? '；' + obsidianHint : '')

  const writes = []
  const keys = []
  for (const t of ctx.settingsTargets) {
    const id = t.ns + '.' + t.key
    const current = (ctx.settingsRead.values || {})[id]
    const present = current !== undefined
    const hasCurrent = present && current !== ''
    const override = overrideValues[id] || ''
    const forced = Boolean(forceSet[id])

    if (override || forced) {
      writes.push({ ns: t.ns, key: t.key, value: override, action: 'set' })
      keys.push({
        ns: t.ns, key: t.key, label: t.label, value: override,
        action: forced ? (present && current === '' ? 'explicitOff' : 'setEmpty') : (hasCurrent && current === override ? 'upToDate' : 'write'),
        detail: forced
          ? '引导选择「不使用镜像」→ 显式写入空值（关闭镜像同步）'
          : '引导填值，将写入' + hintFor(id),
      })
      continue
    }
    // obsidianSyncDir 已存在且为空 = 使用者此前**显式关闭**了镜像 → 视为已决策，不再回填默认值
    if (id === 'work-memory.obsidianSyncDir' && present && current === '') {
      keys.push({ ns: t.ns, key: t.key, label: t.label, value: '', action: 'explicitOff', detail: '已显式关闭镜像（写入空值，不再回填默认）' })
      continue
    }
    if (t.kind === 'keep') {
      keys.push({
        ns: t.ns, key: t.key, label: t.label, value: hasCurrent ? current : '',
        action: hasCurrent ? 'keepExisting' : 'notSuggested',
        detail: (hasCurrent ? '已配置，保留原值' : '由 /expert setup 引导确定，安装器不预设（避免把行业 / 岗位写死）') + hintFor(id),
      })
      continue
    }
    if (hasCurrent) {
      keys.push({ ns: t.ns, key: t.key, label: t.label, value: current, action: 'keepExisting', detail: '已配置，保留原值（只增改，不覆盖）' + hintFor(id) })
      continue
    }
    const value = suggested[id] || ''
    if (!value) {
      keys.push({ ns: t.ns, key: t.key, label: t.label, value: '', action: 'notSuggested', detail: '未解析到工作区，无法给出建议值（显式跳过）' + hintFor(id) })
      continue
    }
    writes.push({ ns: t.ns, key: t.key, value: value })
    keys.push({ ns: t.ns, key: t.key, label: t.label, value: value, action: 'write', detail: '将写入建议值' + hintFor(id) })
  }

  const fileExists = Boolean(raw)
  if (raw && raw.bom) {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.settingsFile),
      detail: 'settings.yaml 带 ' + raw.bom + ' BOM，已拒绝写入；请先另存为 UTF-8 无 BOM',
      settingsKeys: keys,
      preview: { action: '文件带 BOM，已拒绝写入', blockVersion: '', contentHash: 'sha256:' + sha256Text(text), sampleLines: sampleLines(text) },
    })
  }

  const scan = inspectSimpleYaml(text, { strictNamespaces: ['work-memory', 'experts'] })
  const fatal = scan.problems.filter((p) => p.fatal)
  if (fatal.length > 0) {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.settingsFile),
      detail: 'settings.yaml 结构无法安全改写，已拒绝写入：' + fatal.map((p) => '第 ' + p.line + ' 行 ' + p.message).join('；'),
      settingsKeys: keys,
      preview: { action: '配置结构无法识别，已停止写入', blockVersion: '', contentHash: 'sha256:' + sha256Text(text), sampleLines: sampleLines(text) },
    })
  }

  const planned = writes.length > 0 ? planSettingsWrite(text, writes, { strictNamespaces: ['work-memory', 'experts'] }) : null
  if (planned && !planned.ok) {
    return makeItem(spec, {
      status: 'broken',
      target: posix(ctx.settingsFile),
      detail: planned.error,
      settingsKeys: keys,
      preview: { action: '配置结构无法安全改写，已停止写入', blockVersion: '', contentHash: 'sha256:' + sha256Text(text), sampleLines: sampleLines(text) },
    })
  }

  // 只有在真的会产生改动时才写盘（键已等于目标值时不算写入）
  const willWrite = writes.length > 0 && Boolean(planned) && planned.changes.length > 0
  const status = willWrite ? (fileExists ? 'update' : 'append') : (fileExists ? 'up_to_date' : 'none')
  const action = willWrite ? (fileExists ? '将只增改指定键，其余内容逐字节保留' : '将新建')
    : (fileExists ? '已是最新无需写入' : '没有可写入的值（未解析到工作区），跳过')
  const detail = (willWrite
    ? '将写入 ' + writes.map((w) => w.ns + '.' + w.key).join(' / ') + '；其余键与注释逐字节保留（写前备份）'
    : (fileExists ? '4 个目标键都已配置或无需预设（不写盘）' : '设置文件不存在且没有可写入的值'))
    + '；' + obsidianHint

  return makeItem(spec, {
    status: status,
    target: posix(ctx.settingsFile),
    detail: detail,
    autoApplyable: willWrite,
    settingsKeys: keys,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(planned ? planned.text : text),
      sampleLines: sampleBlock(keys.map((k) => k.ns + '.' + k.key + ': ' + (k.value || '（不预设）') + '  [' + k.action + ']')),
    },
    internal: { writes: writes, planned: planned, text: text, keys: keys, exists: fileExists },
  })
}

// ── ⑤ 工作目录 ──

function planDirs(ctx) {
  const spec = BASEDECK_ITEMS[4]
  const list = []
  const add = (key, label, dir, optional) => {
    if (!dir) {
      if (optional) list.push({ key: key, label: label, dir: '', state: 'skipped', detail: '未配置，跳过' })
      return
    }
    let exists = false
    try { exists = statSync(dir).isDirectory() } catch (e) { exists = false }
    list.push({ key: key, label: label, dir: posix(dir), state: exists ? 'exists' : 'missing', detail: exists ? '已存在，跳过' : '缺失，将创建' })
  }
  add('memoryDir', '记忆库目录', ctx.memoryDir, false)
  add('backupDir', '记忆备份目录', ctx.backupDir, false)
  add('obsidianSyncDir', 'Obsidian 记忆镜像目录', ctx.obsidianSyncDir, true)
  add('petSkinsDir', '桌宠素材目录', ctx.petSkinsDir, false)

  const withDir = list.filter((x) => x.dir)
  const missing = list.filter((x) => x.state === 'missing').length
  const exists = list.filter((x) => x.state === 'exists').length
  const status = missing > 0 ? (exists === 0 ? 'append' : 'update') : (exists > 0 ? 'up_to_date' : 'none')
  const action = missing > 0 ? (exists === 0 ? '将新建' : '将只创建缺失的目录')
    : (exists > 0 ? '已是最新无需写入' : '没有可创建的目录')
  return makeItem(spec, {
    status: status,
    target: withDir.map((x) => x.dir),
    detail: '共 ' + withDir.length + ' 个目录：已存在 ' + exists + ' / 缺失 ' + missing,
    autoApplyable: missing > 0,
    dirs: list,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(list.map((x) => x.key + ':' + x.state).join('\n')),
      sampleLines: sampleBlock(list.map((x) => (x.dir || x.label) + '  [' + x.state + ']')),
    },
    internal: { list: list },
  })
}

// ───────────────────── 目录锁（与 dsh-work-memory 共用同一把 .work-memory.lock） ─────────────────────
//
// 为什么放在本文件：basedeck 的写回（记忆种子 / 记忆体结构）与 identity 的身份写入都会写
// <记忆库目录>/MEMORY.md，两者**必须共用同一把锁**；锁实现只有一份（本文件），identity.js
// 通过 re-export 暴露同名导出，杜绝「各写一把锁」。
// 锁口径抄自 dsh-work-memory/lib/store.js 的 withDirLock：同进程重入计数 + 陈旧锁清理 + 超时。

/** 锁文件名（与 dsh-work-memory 一致） */
export const MEMORY_LOCK_NAME = '.work-memory.lock'
/** 陈旧锁判定：mtime 早于该值即可抢占 */
const STALE_LOCK_MS = 10 * 1000
/** 同步版等待上限（同步上下文无法让出事件循环，取小值） */
const LOCK_WAIT_SYNC_MS = 1000
/** 异步版等待上限（等待期间让出事件循环） */
const LOCK_WAIT_ASYNC_MS = 5 * 1000
const LOCK_RETRY_MS = 25
/** 拿不到锁时的统一可读失败信息 */
export const LOCK_BUSY_MESSAGE = '记忆库正被其它写入占用（等待 ' + MEMORY_LOCK_NAME + ' 超时）：本次写入已放弃，未改动任何文件，请稍后重试'

/** 同进程重入计数：外层已持锁时，内层调用直接复用（不再抢同一把文件锁） */
const heldLocks = new Map()

/** 抢占一把锁；返回释放函数 */
function acquireMemoryLock(dir, waitMs) {
  mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, MEMORY_LOCK_NAME)
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, String(process.pid), 'utf8')
      closeSync(fd)
      break
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err
      let stale = false
      try {
        const st = statSync(lockPath)
        stale = Date.now() - st.mtimeMs > STALE_LOCK_MS
      } catch (e) {
        continue
      }
      if (stale) {
        try { rmSync(lockPath, { force: true }) } catch (e) { /* best-effort */ }
        continue
      }
      if (Date.now() > deadline) throw new Error(LOCK_BUSY_MESSAGE)
      const t = Date.now()
      while (Date.now() - t < LOCK_RETRY_MS) { /* spin */ }
    }
  }
  return () => {
    try { rmSync(lockPath, { force: true }) } catch (e) { /* best-effort */ }
  }
}

/** 已持锁则复用（返回 leave 函数），否则返回 null */
function enterReentrant(dir) {
  const key = String(dir)
  const depth = heldLocks.get(key) || 0
  if (depth > 0) {
    heldLocks.set(key, depth + 1)
    return () => {
      const next = (heldLocks.get(key) || 1) - 1
      if (next <= 0) heldLocks.delete(key)
      else heldLocks.set(key, next)
    }
  }
  return null
}

/**
 * 同步版目录锁（供同步写回路径使用；等待上限 1s，避免长时间阻塞事件循环）。
 * @param {string} dir 记忆库目录
 * @param {Function} fn 临界区（同步）
 */
export function withMemoryDirLock(dir, fn) {
  const leave = enterReentrant(dir)
  if (leave) {
    try { return fn() } finally { leave() }
  }
  const release = acquireMemoryLock(dir, LOCK_WAIT_SYNC_MS)
  heldLocks.set(String(dir), 1)
  try {
    return fn()
  } finally {
    heldLocks.delete(String(dir))
    release()
  }
}

/**
 * 异步版目录锁：等待期间 await setTimeout **让出事件循环**（宿主进程不再被锁等待阻塞）。
 * @param {string} dir 记忆库目录
 * @param {Function} fn 临界区（可同步可异步）
 * @returns {Promise<*>}
 */
export async function withMemoryDirLockAsync(dir, fn) {
  const key = String(dir)
  const leave = enterReentrant(dir)
  if (leave) {
    try { return await fn() } finally { leave() }
  }
  mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, MEMORY_LOCK_NAME)
  const deadline = Date.now() + LOCK_WAIT_ASYNC_MS
  for (;;) {
    let acquired = false
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, String(process.pid), 'utf8')
      closeSync(fd)
      acquired = true
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err
      let stale = false
      try {
        const st = statSync(lockPath)
        stale = Date.now() - st.mtimeMs > STALE_LOCK_MS
      } catch (e) {
        continue
      }
      if (stale) {
        try { rmSync(lockPath, { force: true }) } catch (e) { /* best-effort */ }
        continue
      }
      if (Date.now() > deadline) throw new Error(LOCK_BUSY_MESSAGE)
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
    if (!acquired) continue
    heldLocks.set(key, 1)
    try {
      return await fn()
    } finally {
      heldLocks.delete(key)
      try { rmSync(lockPath, { force: true }) } catch (e) { /* best-effort */ }
    }
  }
}

/**
 * 严格读文件：把「不存在」与「存在但读不到」分开（ENOENT/ENOTDIR = 不存在；其余 = 读失败）。
 * 写前判定用：文件存在却读不到时必须**拒绝写入**，而不是当成不存在去新建。
 * @returns {{exists:boolean, readable:boolean, buffer?:Buffer, text?:string, bom?:string, code:string, error:string}}
 */
export function readFileStrict(file) {
  try {
    const buffer = readFileSync(file)
    return { exists: true, readable: true, buffer: buffer, text: buffer.toString('utf8'), bom: detectBom(buffer), code: '', error: '' }
  } catch (err) {
    const code = err && err.code ? String(err.code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exists: false, readable: false, code: code, error: '' }
    }
    return { exists: true, readable: false, code: code || 'EUNKNOWN', error: String(err && err.message ? err.message : err) }
  }
}

/**
 * 写目标护栏（与「核心配置 → 可用性检查」同口径）：落盘前统一校验目标目录。
 * 拒绝：未填写 / 非绝对路径 / 用户主目录 / 同名文件占用 / 不可写。
 * @returns {{ok:boolean, dir?:string, error?:string}}
 */
export function assertWritableDir(dir, label, env = process.env) {
  const name = label || '目标目录'
  const raw = typeof dir === 'string' ? dir.trim() : ''
  if (!raw) return { ok: false, error: name + '未填写' }
  const p = normalizePath(raw)
  if (!isAbsolute(p)) return { ok: false, error: name + '必须是绝对路径：' + raw }
  if (isHomePath(p, env)) return { ok: false, error: name + '不能是用户主目录（会把记忆与结构写进家目录）：' + posix(p) }
  let st = null
  try { st = statSync(p) } catch (e) { st = null }
  if (st && !st.isDirectory()) return { ok: false, error: name + '位置已被同名文件占用：' + posix(p) }
  let probe = p
  if (!st) {
    probe = ''
    let cur = p
    for (let i = 0; i < 64; i++) {
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
      try {
        if (statSync(cur).isDirectory()) { probe = cur; break }
      } catch (e) { /* 继续向上找 */ }
    }
    if (!probe) return { ok: false, error: name + '找不到可用的上级目录：' + posix(p) }
  }
  try {
    accessSync(probe, constants.W_OK)
  } catch (err) {
    const code = err && err.code ? String(err.code) : 'EACCES'
    return { ok: false, error: name + '不可写（' + code + '）：' + posix(probe) }
  }
  return { ok: true, dir: p }
}

// ───────────────────────────── 写回器 ─────────────────────────────

/** 轮转备份：保留最近 keep 份（best-effort，失败不阻断） */
export function pruneBackupsOf(file, io, keep = BACKUP_KEEP) {
  const dir = dirname(file)
  const prefix = basename(file) + BACKUP_SUFFIX
  let names = []
  try { names = readdirSync(dir) } catch (e) { return { pruned: 0, existing: 0 } }
  const mine = names.filter((n) => n.indexOf(prefix) === 0 && n.length > prefix.length).sort()
  const excess = mine.length + 1 - keep
  let pruned = 0
  if (excess > 0) {
    for (const name of mine.slice(0, excess)) {
      try { io.rmSync(join(dir, name), { force: true }); pruned += 1 } catch (e) { /* best-effort */ }
    }
  }
  return { pruned: pruned, existing: mine.length }
}

/** 备份文件（存在才备份）；返回备份绝对路径或空串 */
export function backupFile(file, io, date) {
  try {
    if (!existsSync(file)) return ''
  } catch (e) {
    return ''
  }
  pruneBackupsOf(file, io)
  const target = file + BACKUP_SUFFIX + stamp(date)
  io.copyFileSync(file, target)
  return target
}

/** 原子写（同目录临时文件 → rename），UTF-8 无 BOM */
export function atomicWriteText(file, text, io) {
  // 临时名带 pid + 随机后缀：两个进程（或两个并发请求）不会互踩同一个 .wps-tmp
  const tmp = file + '.wps-tmp-' + process.pid + '-' + randomBytes(4).toString('hex')
  io.writeFileSync(tmp, Buffer.from(String(text), 'utf8'))
  try {
    io.renameSync(tmp, file)
  } catch (err) {
    try { io.rmSync(tmp, { force: true }) } catch (e) { /* best-effort */ }
    throw err
  }
}

/** 写后通用校验：无 BOM */
export function verifyNoBom(file) {
  const raw = readFileRaw(file)
  if (!raw) return { ok: false, error: '写后读取失败：' + posix(file) }
  if (raw.bom) return { ok: false, error: '写后检测到 ' + raw.bom + ' BOM' }
  return { ok: true, text: raw.text }
}

/** 回滚：把备份复制回去（无备份则删除刚写的文件） */
function rollbackWrite(file, backup, io, hadFile) {
  try {
    if (backup) io.copyFileSync(backup, file)
    else if (!hadFile) io.rmSync(file, { force: true })
  } catch (e) { /* best-effort */ }
}

// ── apply：单项写回 ──

/**
 * 执行（或干跑）指定项。**dryRun 默认 true**。
 * @param {string} id 八项之一（BASEDECK_ID_LIST）
 * @param {object} options resolveDeckContext 的选项 + { dryRun:boolean, overrides:object }
 * @returns {object} 契约字段 + 各分支的补充证据字段
 */
export function applyBaseDeckItem(id, options = {}) {
  const dryRun = options.dryRun !== false
  const plan = planBaseDeck(options)
  const ctx = plan.ctx
  const io = resolveIo(options)
  const item = plan.items.filter((it) => it.id === id)[0]
  if (!item) {
    return { id: id, ok: false, dryRun: dryRun, action: '', target: '', plannedBackup: '', backup: '', wouldWriteBytes: 0, bytesWritten: 0, detail: '未知 id' }
  }

  const target = Array.isArray(item.target) ? item.target.join(' / ') : item.target
  const base = {
    id: id,
    ok: false,
    dryRun: dryRun,
    action: item.preview.action,
    target: target,
    plannedBackup: '',
    backup: '',
    wouldWriteBytes: 0,
    bytesWritten: 0,
    wroteAny: false,
    detail: item.detail,
    status: item.status,
  }

  if (id === 'agentsMd') return applyAgentsMd(ctx, item, item.internal || {}, io, dryRun, base)
  if (id === 'memorySeed') return applyMemorySeed(ctx, item, item.internal || {}, io, dryRun, base, options)
  if (id === 'skills') return applySkills(ctx, item, item.internal || {}, io, dryRun, base)
  if (id === 'settings') return applySettings(ctx, item, item.internal || {}, io, dryRun, base)
  if (id === 'migrateMemory') return applyMigrateMemory(ctx, item, item.internal || {}, io, dryRun, base, options)
  if (id === 'memoryDeck') return applyDeckFiles(ctx, item, item.internal || {}, io, dryRun, base, options)
  if (id === 'knowledgeDeck') return applyDeckFiles(ctx, item, item.internal || {}, io, dryRun, base, options)
  return applyDirs(ctx, item, item.internal || {}, io, dryRun, base)
}

function applyAgentsMd(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') {
    return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  }
  if (item.status === 'ahead' || item.status === 'broken' || item.status === 'multiple' || item.status === 'none') {
    return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  }
  if (!ctx.agentsFile || !internal.blockText) {
    return Object.assign(base, { ok: false, detail: '工作区未解析，未写盘' })
  }

  const raw = readFileRaw(ctx.agentsFile)
  const hadFile = Boolean(raw)
  const eol = internal.eol || '\n'
  let prepared
  let preserveOriginal = null
  if (item.status === 'append') {
    prepared = appendBlockText(raw ? raw.text : '', internal.blockText, eol)
    preserveOriginal = prepared.originalText
  } else {
    prepared = spliceBlockText(raw.text, internal.blockText)
    if (!prepared) return Object.assign(base, { ok: false, detail: '定位标记块失败，未写盘' })
  }
  const outsideBefore = sha256Text(prepared.outsideText)

  // 被手改：默认不覆盖，另存候选文件
  if (item.status === 'user_modified') {
    const candidate = join(dirname(ctx.agentsFile), AGENTS_CANDIDATE_NAME)
    const body = internal.blockText + eol
    base.action = '块内被手工改过，不自动覆盖（另存候选文件）'
    base.wouldWriteBytes = Buffer.byteLength(body, 'utf8')
    if (dryRun) {
      return Object.assign(base, {
        ok: true, candidate: posix(candidate),
        detail: item.detail + '；干跑：未写盘（真写时会把新版块另存到 ' + posix(candidate) + '）',
      })
    }
    try {
      atomicWriteText(candidate, body, io)
    } catch (err) {
      return Object.assign(base, { ok: false, detail: '候选文件写入失败：' + String(err && err.message ? err.message : err) })
    }
    const verify = verifyNoBom(candidate)
    if (!verify.ok) return Object.assign(base, { ok: false, detail: '候选文件写后校验失败：' + verify.error })
    return Object.assign(base, {
      ok: true,
      candidate: posix(candidate),
      bytesWritten: Buffer.byteLength(body, 'utf8'),
      wroteAny: true,
      detail: item.detail + '；已把新版块另存到 ' + posix(candidate) + '（原文件一字未动，可手工合并）',
    })
  }

  const body = prepared.next
  const bytes = Buffer.byteLength(body, 'utf8')
  base.wouldWriteBytes = bytes
  const plannedBackup = hadFile ? ctx.agentsFile + BACKUP_SUFFIX + stamp(ctx.now) : ''
  base.plannedBackup = plannedBackup ? posix(plannedBackup) : ''
  base.outsideHashBefore = outsideBefore

  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '；干跑：未写盘（预计写入 ' + bytes + ' 字节'
        + (plannedBackup ? '，写前备份到 ' + posix(plannedBackup) : '，文件原本不存在无需备份') + '）',
    })
  }

  let backup = ''
  try {
    backup = backupFile(ctx.agentsFile, io, ctx.now)
  } catch (err) {
    return Object.assign(base, { ok: false, detail: '写前备份失败，已放弃写入：' + String(err && err.message ? err.message : err) })
  }
  try {
    atomicWriteText(ctx.agentsFile, body, io)
  } catch (err) {
    rollbackWrite(ctx.agentsFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写入失败（已回滚）：' + String(err && err.message ? err.message : err) })
  }

  // 写后校验：无 BOM + 块内 hash 匹配 + **块外内容逐字节未变**
  const verify = verifyNoBom(ctx.agentsFile)
  if (!verify.ok) {
    rollbackWrite(ctx.agentsFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败（已回滚）：' + verify.error })
  }
  const actualHash = 'sha256:' + sha256Text(normalizeBlockBody(currentBlockBody(verify.text)))
  if (actualHash !== internal.blockHash) {
    rollbackWrite(ctx.agentsFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后块内哈希不一致（已回滚）' })
  }
  const outsideAfter = sha256Text(outerTextOf(verify.text))
  if (outsideAfter !== outsideBefore) {
    rollbackWrite(ctx.agentsFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后块外内容发生变化（已回滚）' })
  }
  if (preserveOriginal !== null && !verify.text.startsWith(preserveOriginal)) {
    rollbackWrite(ctx.agentsFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后原有内容前缀发生变化（已回滚）' })
  }

  return Object.assign(base, {
    ok: true,
    backup: backup ? posix(backup) : '',
    bytesWritten: bytes,
    wroteAny: true,
    outsideHashAfter: outsideAfter,
    outsideUnchanged: true,
    originalPrefixPreserved: preserveOriginal === null ? null : true,
    detail: item.detail + '；已写入 ' + bytes + ' 字节，块外内容 SHA256 与写前一致（'
      + outsideAfter.slice(0, 12) + '…）' + (backup ? '，备份 ' + posix(backup) : ''),
  })
}

/**
 * 记忆种子写回。
 * 1.1.3 起：写 **<记忆库目录>/** 的路径一律先取 .work-memory.lock（与 dsh-work-memory 共用），
 * 并在**锁内重算计划再写**（读-改-写必须在临界区内，否则并发的 memory_remember 会被覆盖）。
 */
function applyMemorySeed(ctx, item, internal, io, dryRun, base, options) {
  if (dryRun || !ctx.memoryDir) return applyMemorySeedLocked(ctx, item, internal, io, dryRun, base)
  const preGuard = assertWritableDir(ctx.memoryDir, '记忆库目录', ctx.env)
  if (!preGuard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + preGuard.error })
  try {
    return withMemoryDirLock(ctx.memoryDir, () => {
      const fresh = planBaseDeck(options || {}).items.filter((it) => it.id === 'memorySeed')[0]
      return applyMemorySeedLocked(ctx, fresh || item, (fresh && fresh.internal) || internal, io, false, base)
    })
  } catch (err) {
    return Object.assign(base, { ok: false, detail: '记忆库写入未执行（未改动任何文件）：' + String(err && err.message ? err.message : err) })
  }
}

function applyMemorySeedLocked(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  if (item.status === 'broken' || item.status === 'none') return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  if (!ctx.memoryFile || !internal.newEntries || internal.newEntries.length === 0) {
    return Object.assign(base, { ok: false, detail: '没有需要写入的种子条目，未写盘' })
  }

  const hadFile = internal.exists
  const oldText = internal.text || ''
  const body = appendEntriesText(oldText, internal.newEntries)
  const bytes = Buffer.byteLength(body, 'utf8')
  base.wouldWriteBytes = bytes
  const plannedBackup = hadFile ? ctx.memoryFile + BACKUP_SUFFIX + stamp(ctx.now) : ''
  base.plannedBackup = plannedBackup ? posix(plannedBackup) : ''

  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '；干跑：未写盘（预计写入 ' + bytes + ' 字节'
        + (plannedBackup ? '，写前备份到 ' + posix(plannedBackup) : '，记忆库原本不存在无需备份') + '）',
    })
  }

  // 落盘前护栏：与「可用性检查」同口径（拒绝主目录 / 非绝对路径 / 不可写 / 同名文件占用）
  const guard = assertWritableDir(ctx.memoryDir, '记忆库目录', ctx.env)
  if (!guard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + guard.error })

  let backup = ''
  try {
    io.mkdirSync(dirname(ctx.memoryFile), { recursive: true })
    backup = backupFile(ctx.memoryFile, io, ctx.now)
  } catch (err) {
    return Object.assign(base, { ok: false, detail: '写前备份失败，已放弃写入：' + String(err && err.message ? err.message : err) })
  }
  try {
    atomicWriteText(ctx.memoryFile, body, io)
  } catch (err) {
    rollbackWrite(ctx.memoryFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写入失败（已回滚）：' + String(err && err.message ? err.message : err) })
  }

  const verify = verifyNoBom(ctx.memoryFile)
  if (!verify.ok) {
    rollbackWrite(ctx.memoryFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败（已回滚）：' + verify.error })
  }
  if (verify.text !== body) {
    rollbackWrite(ctx.memoryFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败：文件内容与预期不一致（已回滚）' })
  }
  const tailMatch = /[ \t\r\n]*$/.exec(oldText)
  const head = oldText.slice(0, oldText.length - (tailMatch ? tailMatch[0].length : 0))
  if (head.trim() !== '' && !verify.text.startsWith(head)) {
    rollbackWrite(ctx.memoryFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败：原有内容前缀发生变化（已回滚）' })
  }
  const after = parseMemoryEntries(verify.text)

  return Object.assign(base, {
    ok: true,
    backup: backup ? posix(backup) : '',
    bytesWritten: bytes,
    wroteAny: true,
    entriesBefore: internal.entries.length,
    entriesAfter: after.length,
    preservedEntries: internal.entries.length,
    detail: item.detail + '；已写入 ' + bytes + ' 字节，原有 ' + internal.entries.length + ' 条与尾部空白逐字节保留'
      + (backup ? '，备份 ' + posix(backup) : ''),
  })
}

function applySkills(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  if (item.status === 'broken' || item.status === 'none') return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  const missing = (internal.files || []).filter((f) => f.state === 'missing')
  if (missing.length === 0) return Object.assign(base, { ok: true, detail: '没有被本地改过的技能，缺失 0 个，未写盘' })

  const totals = missing.reduce((acc, f) => {
    const raw = readFileRaw(f.source)
    return acc + (raw ? raw.buffer.length : 0)
  }, 0)
  base.wouldWriteBytes = totals
  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '；干跑：未写盘（将写入 ' + missing.length + ' 个缺失技能）',
      plannedFiles: missing.map((f) => f.target),
    })
  }
  const written = []
  for (const f of missing) {
    const raw = readFileRaw(f.source)
    if (!raw) {
      return Object.assign(base, { ok: false, written: written, detail: '读取技能源失败：' + f.source + '（已写入的保留，未覆盖任何本地改动）' })
    }
    try {
      io.mkdirSync(dirname(f.target), { recursive: true })
      atomicWriteText(f.target, raw.text, io)
    } catch (err) {
      return Object.assign(base, { ok: false, written: written, detail: '写入技能失败：' + f.target + '（' + String(err && err.message ? err.message : err) + '）' })
    }
    const verify = verifyNoBom(f.target)
    if (!verify.ok) return Object.assign(base, { ok: false, written: written, detail: '技能写后校验失败：' + f.target + ' ' + verify.error })
    const back = readFileRaw(f.target)
    if (!back || sha256Text(back.buffer) !== sha256Text(raw.buffer)) {
      return Object.assign(base, { ok: false, written: written, detail: '技能写后 SHA256 不一致：' + f.target })
    }
    written.push(f.target)
  }
  return Object.assign(base, {
    ok: true,
    bytesWritten: totals,
    wroteAny: true,
    writtenFiles: written,
    detail: '已安装 ' + written.length + ' 个缺失技能；本地改过的 ' + internal.modified + ' 个一字未动'
      + (internal.modified > 0 ? '（差异见 items[].files）' : ''),
  })
}

function applySettings(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  if (item.status === 'broken' || item.status === 'none') return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  if (!internal.planned || !internal.planned.ok) return Object.assign(base, { ok: false, detail: '没有可写入的键，未写盘' })
  if (internal.planned.changes.length === 0) return Object.assign(base, { ok: true, detail: '目标键已经是该值，无需写入（未写盘）' })

  const body = internal.planned.text
  const bytes = Buffer.byteLength(body, 'utf8')
  base.wouldWriteBytes = bytes
  const plannedBackup = internal.exists ? ctx.settingsFile + BACKUP_SUFFIX + stamp(ctx.now) : ''
  base.plannedBackup = plannedBackup ? posix(plannedBackup) : ''
  const targetIds = internal.keys.map((k) => k.ns + '.' + k.key)
  const beforeOutsideLines = dropTargetKeys(internal.text, targetIds)

  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '；干跑：未写盘（预计写入 ' + bytes + ' 字节'
        + (plannedBackup ? '，写前备份到 ' + posix(plannedBackup) : '，文件原本不存在无需备份') + '）',
      changes: internal.planned.changes,
    })
  }

  let backup = ''
  try {
    io.mkdirSync(dirname(ctx.settingsFile), { recursive: true })
    backup = backupFile(ctx.settingsFile, io, ctx.now)
  } catch (err) {
    return Object.assign(base, { ok: false, detail: '写前备份失败，已放弃写入：' + String(err && err.message ? err.message : err) })
  }
  try {
    atomicWriteText(ctx.settingsFile, body, io)
  } catch (err) {
    rollbackWrite(ctx.settingsFile, backup, io, internal.exists)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写入失败（已回滚）：' + String(err && err.message ? err.message : err) })
  }

  const verify = verifyNoBom(ctx.settingsFile)
  if (!verify.ok) {
    rollbackWrite(ctx.settingsFile, backup, io, internal.exists)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败（已回滚）：' + verify.error })
  }
  const rescan = inspectSimpleYaml(verify.text, { strictNamespaces: ['work-memory', 'experts'] })
  if (!rescan.ok) {
    rollbackWrite(ctx.settingsFile, backup, io, internal.exists)
    return Object.assign(base, {
      ok: false, backup: posix(backup),
      detail: '写后 YAML 结构校验失败（已回滚）：' + rescan.problems.filter((p) => p.fatal).map((p) => p.message).join('；'),
    })
  }
  const beforeRescan = inspectSimpleYaml(internal.text, { strictNamespaces: ['work-memory', 'experts'] })
  for (const nsName of Object.keys(beforeRescan.namespaces)) {
    for (const key of Object.keys(beforeRescan.namespaces[nsName].keys)) {
      const id = nsName + '.' + key
      if (targetIds.indexOf(id) >= 0) continue
      const was = beforeRescan.namespaces[nsName].keys[key].value
      const now = (rescan.namespaces[nsName] && rescan.namespaces[nsName].keys[key]) ? rescan.namespaces[nsName].keys[key].value : undefined
      if (was !== now) {
        rollbackWrite(ctx.settingsFile, backup, io, internal.exists)
        return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败：非目标键 ' + id + ' 发生变化（已回滚）' })
      }
    }
  }
  const afterOutsideLines = dropTargetKeys(verify.text, targetIds)
  if (!isSubsequence(beforeOutsideLines, afterOutsideLines)) {
    rollbackWrite(ctx.settingsFile, backup, io, internal.exists)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败：非目标内容发生变化（已回滚）' })
  }
  const outsideDigest = sha256Text(afterOutsideLines.join('\n'))

  return Object.assign(base, {
    ok: true,
    backup: backup ? posix(backup) : '',
    bytesWritten: bytes,
    wroteAny: true,
    changes: internal.planned.changes,
    keptKeys: internal.keys.filter((k) => k.action === 'keepExisting').length,
    outsideLinesPreserved: beforeOutsideLines.length,
    detail: item.detail + '；已写入 ' + bytes + ' 字节，非目标行 ' + beforeOutsideLines.length + ' 行逐字保留（' + outsideDigest.slice(0, 12) + '…）'
      + (backup ? '，备份 ' + posix(backup) : ''),
  })
}

/** 取出「与目标键无关」的原有行（删掉目标键所在行），用于证明其余内容逐字节未变 */
function dropTargetKeys(text, targets) {
  const src = String(text == null ? '' : text)
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const scan = inspectSimpleYaml(src, { strictNamespaces: [] })
  const drop = {}
  for (const id of targets) {
    const i = id.indexOf('.')
    const ns = scan.namespaces[id.slice(0, i)]
    if (!ns) continue
    const entry = ns.keys[id.slice(i + 1)]
    if (entry) drop[entry.line] = true
  }
  return lines.filter((l, i) => !drop[i])
}

/** before 是否为 after 的子序列（顺序一致，允许 after 插入新增行） */
export function isSubsequence(before, after) {
  let i = 0
  for (let j = 0; j < after.length && i < before.length; j++) {
    if (after[j] === before[i]) i += 1
  }
  return i === before.length
}

function applyDirs(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  if (item.status === 'none') return Object.assign(base, { ok: false, detail: item.detail })
  const list = internal.list || []
  const missing = list.filter((x) => x.state === 'missing')
  const existsCount = list.filter((x) => x.state === 'exists').length
  base.wouldWriteBytes = 0
  if (dryRun) {
    return Object.assign(base, { ok: true, detail: item.detail + '；干跑：未写盘（将创建 ' + missing.length + ' 个目录）', plannedDirs: missing.map((x) => x.dir) })
  }
  const created = []
  for (const x of missing) {
    try {
      io.mkdirSync(x.dir, { recursive: true })
      created.push(x.dir)
    } catch (err) {
      return Object.assign(base, { ok: false, created: created, detail: '创建目录失败：' + x.dir + '（' + String(err && err.message ? err.message : err) + '）' })
    }
  }
  return Object.assign(base, {
    ok: true,
    createdDirs: created,
    wroteAny: created.length > 0,
    detail: '已创建 ' + created.length + ' 个缺失目录；已存在的 ' + existsCount + ' 个跳过',
  })
}

/**
 * 批量执行 / 干跑。**dryRun 默认 true**（第一版客户端一律走 dry-run）。
 * 执行顺序按依赖排（BASEDECK_APPLY_ORDER），**忽略传入顺序**；未知 id 计入 rejected，不执行；
 * 单项失败**继续后续项**并逐项说明，不静默跳过。
 *
 * @returns {{ok:boolean, dryRun:boolean, results:object[], rejected:string[],
 *            workspace:(string|null), workspaceSource:string, durationMs:number}}
 */
export function applyBaseDeck(ids, options = {}) {
  const started = Date.now()
  const dryRun = options.dryRun !== false
  const input = Array.isArray(ids) ? ids : []
  const accepted = []
  const rejected = []
  for (const raw of input) {
    const s = typeof raw === 'string' ? raw.trim().slice(0, 64) : String(raw == null ? '' : raw).slice(0, 32)
    if (BASEDECK_ID_LIST.indexOf(s) >= 0) {
      if (accepted.indexOf(s) === -1) accepted.push(s)
    } else {
      pushRejected(rejected, s)
    }
  }
  const order = BASEDECK_APPLY_ORDER.filter((id) => accepted.indexOf(id) >= 0)
  const ctx = resolveDeckContext(options)
  const results = []
  let stoppedAt = ''
  let stopReason = ''
  for (const id of order) {
    let r
    try {
      r = applyBaseDeckItem(id, Object.assign({}, options, { dryRun: dryRun }))
    } catch (err) {
      r = {
        id: id, ok: false, dryRun: dryRun, action: '', target: '', plannedBackup: '', backup: '',
        wouldWriteBytes: 0, bytesWritten: 0, detail: '执行异常：' + String(err && err.message ? err.message : err),
      }
    }
    results.push(r)
    // 迁移是**前置步骤**：它失败时（旧记忆没带过来）后面一律不做 —— 尤其不写 settings，
    // 否则使用者会以为记忆库已切换、而旧记忆「不见了」。全流程唯一一处「失败即停」。
    if (id === 'migrateMemory' && r.ok !== true) {
      stoppedAt = 'migrateMemory'
      stopReason = '旧记忆库迁移未完成，后续步骤已停止：未写入任何设置，记忆库仍指向原目录'
      break
    }
  }
  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    dryRun: dryRun,
    results: results,
    rejected: rejected,
    wroteAny: results.some((r) => r.wroteAny === true),
    workspace: ctx.workspace ? posix(ctx.workspace) : '',
    workspaceSource: ctx.workspaceSource || 'none',
    workspaceNote: workspaceNoteFor(ctx),
    libraryName: ctx.libraryName || '',
    memoryRoot: ctx.memoryRoot ? posix(ctx.memoryRoot) : '',
    memoryDir: ctx.memoryDir ? posix(ctx.memoryDir) : '',
    migrateFrom: ctx.migrateFrom ? posix(ctx.migrateFrom) : '',
    migrateFromSource: ctx.migrateFromSource || '',
    stoppedAt: stoppedAt,
    stopReason: stopReason,
    durationMs: Date.now() - started,
  }
}

/** 供 API 层剔除内部字段（internal 不对外） */
export function publicPlan(plan) {
  return {
    ok: true,
    workspace: plan.workspace,
    workspaceSource: plan.workspaceSource,
    workspaceNote: plan.workspaceNote || '',
    workspaceDerivedFrom: plan.workspaceDerivedFrom || '',
    libraryName: plan.libraryName || '',
    memoryRoot: plan.memoryRoot || '',
    memoryDir: plan.memoryDir || '',
    migrateFrom: plan.migrateFrom || '',
    migrateFromSource: plan.migrateFromSource || '',
    items: plan.items.map((it) => {
      const out = {}
      for (const k of Object.keys(it)) {
        if (k === 'internal') continue
        out[k] = it[k]
      }
      return out
    }),
    summary: plan.summary,
    setupNeeded: plan.setupNeeded,
  }
}

// ═════════════════════ 1.1.3 新增：⑥ 记忆体结构 / ⑦ 知识库结构 ═════════════════════
//
// 设计定稿 §6（记忆库初始化）与 §7（知识库初始化）。
// 共同纪律：**只补缺失、不覆盖已有内容**；dry-run 默认；写前备份（仅改写既有文件时）；
// 临时文件 + rename；写后校验（无 BOM + SHA256 一致）；任一失败回滚本次全部改动。

/** 记忆体骨架目录（只创建缺失的） */
export const MEMORY_SKELETON_DIRS = ['PROJECTS', 'DAILY', 'ARCHIVE']

/** 记忆条目分隔符（与 dsh-work-memory/lib/store.js 的 ENTRY_DELIMITER 一致） */
export const ENTRY_SEP = '\n§\n'

/** 「使用者身份」占位条目正文（设计定稿 §6.2；正文以「使用者身份：」起头，身份写入模块据此定位） */
export const IDENTITY_PLACEHOLDER_TEXT = '（待指定）本条目记录使用者的身份与工作岗位；在「设置 → 工作秘书 → 核心配置」选定或填写岗位后，由该页整条写入本条。'

/** 开局待办七项（逐字对照设计定稿 §6.3） */
export const STARTER_TODOS = [
  '① 指定助手人设——告诉我你的称呼、我该怎么称呼你、我的身份与性格（未指定前我不臆造人格）',
  '② 建立并检查技能库——确认随包技能已落盘到 <工作区>\\.dsh\\skills\\；缺失时在「安装与检查」页重跑一键配置补装',
  '③ 核对环境——记忆库插件 / Python 解释器 / Python 工具 三项就绪',
  '④ 选定工作岗位——「核心配置」页选岗位并保存（写入使用者身份）',
  '⑤ 生成结构——「核心配置」页点「保存配置并开始」',
  '⑥ 导入旧内容（可选）——本机已有知识库或记忆文件时选文件夹带过来',
  '⑦ 最后一步：读一次《使用说明》（「安装与检查」页有入口）',
]

/** PROJECTS/工作秘书.md 的文件名（第一个项目） */
export const WORK_SECRETARY_FILE = '工作秘书.md'

/** 第四条【技能库】的预留占位正文（执行后由集成体生成摘要） */
export const SKILL_LIBRARY_STUB = '【技能库】（待生成）随包技能、工作区技能与已装插件的清单及同步状态；一键配置执行后生成摘要。'

/** 知识库根下的受管目录（不当作业务模块，也不重复登记） */
export const VAULT_MANAGED_DIRS = ['00_全局记忆', '工具']

/** 知识库固定名字 */
export const VAULT_HOME_FILE = '🏠 主页.md'
export const VAULT_MIRROR_DIR_NAME = '00_全局记忆'
export const VAULT_TOOLS_DIR_NAME = '工具'
export const VAULT_TOOL_SUBDIRS = ['技能', '脚本', 'MCP']
export const VAULT_TOOL_OVERVIEW_FILE = '00_工具总览.md'
export const VAULT_OBSIDIAN_DIR_NAME = '.obsidian'
export const VAULT_APP_JSON_FILE = 'app.json'

/**
 * 「选一个存储根目录，记忆体与知识库各自在它下面新建自己的文件夹」模型的两个固定子目录名。
 * **唯一真相源**：客户端不硬编码这两个名字，走 `GET /setup-state` 的 `rootSubdirs` 取值。
 * 使用者仍可单独改写任一目录（改写后即脱离自动派生）；本模型只保证**默认不冲突**。
 */
export const ROOT_SUBDIR_MEMORY = 'memory-data'
export const ROOT_SUBDIR_VAULT = 'obsidian-data'

/**
 * 由存储根目录派生两个工作目录（纯函数，只拼接、不碰磁盘）。
 * @param {string} rootDir 使用者选的那个文件夹
 * @returns {{memoryDir:string, obsidianDir:string}} 根目录为空时两项都为空串
 */
export function deriveRootChildren(rootDir) {
  const root = typeof rootDir === 'string' ? rootDir.trim() : ''
  if (!root) return { memoryDir: '', obsidianDir: '' }
  return {
    memoryDir: posix(join(root, ROOT_SUBDIR_MEMORY)),
    obsidianDir: posix(join(root, ROOT_SUBDIR_VAULT)),
  }
}

/**
 * 反向推断：两个目录是否正好是**同一个父目录**下的 memory-data / obsidian-data（大小写不敏感）。
 * 用途只有一个：页面载入时若既有配置本来就是这套布局，就把「存储根目录」填回去，
 * 让使用者看到自己填的是根目录而不是两个散落的绝对路径；推不出来就留空（**不猜**）。
 * @returns {string} 推断出的根目录（POSIX 风格），推不出返回空串
 */
export function inferRootDir(memoryDir, obsidianDir) {
  const m = typeof memoryDir === 'string' ? posix(memoryDir.trim()) : ''
  const v = typeof obsidianDir === 'string' ? posix(obsidianDir.trim()) : ''
  if (!m || !v) return ''
  const pm = dirname(m)
  const pv = dirname(v)
  if (!pm || pm !== pv) return ''
  if (basename(m).toLowerCase() !== ROOT_SUBDIR_MEMORY) return ''
  if (basename(v).toLowerCase() !== ROOT_SUBDIR_VAULT) return ''
  return posix(pm)
}

/**
 * 记忆库目录落在知识库里的**第一级目录名**（不在知识库内返回空串）。
 * 用途：记忆库不是业务模块，它若被放进知识库（使用者「单独指定」时可能），
 * 不该被 `listVaultModules` 登记进 `🏠 主页.md` 的「业务模块」段。
 */
export function memoryTopSegmentInVault(memoryDir, vaultDir) {
  const m = typeof memoryDir === 'string' ? posix(memoryDir.trim()).toLowerCase().replace(/[\\/]+$/, '') : ''
  const v = typeof vaultDir === 'string' ? posix(vaultDir.trim()).toLowerCase().replace(/[\\/]+$/, '') : ''
  if (!m || !v) return ''
  if (m === v) return '' // 同一个目录：交给别的检查说，这里不猜是哪一级
  if (m.indexOf(v + '/') !== 0) return ''
  const seg = m.slice(v.length + 1).split('/')[0]
  return seg || ''
}

/** .obsidian 最小配置（只放一个中性键；使用者已有配置一律不覆盖） */
export const VAULT_APP_JSON_TEXT = '{\n  "alwaysUpdateLinks": true\n}\n'

/** 条目标题前缀（幂等判定用：已有同前缀条目即跳过，绝不重复追加） */
export const WORK_SECRETARY_TITLES = ['【使用说明】', '【安装说明】', '【待办·开局】', '【技能库】']

// ── 记忆条目小工具（口径与 dsh-work-memory 的 store.js 一致） ──

/** 拆条目 */
export function parseMemoryEntries(text) {
  return String(text == null ? '' : text).split(ENTRY_SEP).map((e) => e.trim()).filter((e) => e.length > 0)
}

/** 拼条目（结尾一个换行） */
export function serializeMemoryEntries(entries) {
  return entries.join(ENTRY_SEP) + '\n'
}

/** 剥掉条目头部的 [id:…] [日期] [tag:…] 等元数据，得到正文 */
export function memoryEntryBody(entry) {
  return String(entry == null ? '' : entry).replace(/^(?:\s*\[[^\]]*\]\s*)+/, '')
}

/** 拼一条记忆条目 */
export function makeMemoryEntry(content, options = {}) {
  const id = options.id || memoryEntryId(content)
  const date = options.date || formatDate(nowValue(options.now))
  const tag = options.tag || '常规'
  return '[id:' + id + '] [' + date + '] [tag:' + tag + '] ' + content
}

/** 确定性条目 id（同内容同 id，保证幂等） */
export function memoryEntryId(content) {
  return sha256Text('wps-deck:' + String(content)).slice(0, 12)
}

/**
 * 在既有文本末尾追加条目。
 * **不再全量序列化**：原文去掉尾随空白后的部分（head）与尾随空白（tail）逐字节保留，
 * 只把「分隔符 + 新条目」插在两者之间 —— 既有条目与文件尾部空白都不被规范化。
 * @returns {string}
 */
export function appendEntriesText(existingText, newEntries) {
  const src = String(existingText == null ? '' : existingText)
  const list = Array.isArray(newEntries) ? newEntries.filter((e) => typeof e === 'string' && e.length > 0) : []
  if (list.length === 0) return src
  const add = list.join(ENTRY_SEP)
  const m = /[ \t\r\n]*$/.exec(src)
  const tailLen = m ? m[0].length : 0
  const cut = src.length - tailLen
  const head = src.slice(0, cut)
  const tail = src.slice(cut)
  if (head.trim() === '') return add + '\n'
  return head + ENTRY_SEP + add + tail
}

/** 读取数据文件（读不到返回空串） */
function readTextOf(file) {
  const raw = readFileRaw(file)
  return raw ? raw.text : ''
}

/** 文件是否存在且是普通文件 */
function fileExists(file) {
  try { return statSync(file).isFile() } catch (e) { return false }
}

// ── ⑥ 记忆体结构 ──

function planMemoryDeck(ctx) {
  const spec = BASEDECK_ITEMS[5]
  const emptyInternal = { dirs: [], writes: [] }
  if (!ctx.memoryDir) {
    return makeItem(spec, {
      status: 'none',
      target: '',
      detail: '没有可用的记忆库目录（显式失败，不猜路径）：请先在「核心配置」里填写记忆库目录',
      dirs: [],
      files: [],
      preview: { action: '没有可用的记忆库目录，无法处理', blockVersion: '', contentHash: '', sampleLines: '' },
      internal: emptyInternal,
    })
  }

  // ① 骨架目录：PROJECTS / DAILY / ARCHIVE（只创建缺失的）
  const dirs = []
  for (const name of MEMORY_SKELETON_DIRS) {
    const dir = join(ctx.memoryDir, name)
    let exists = false
    try { exists = statSync(dir).isDirectory() } catch (e) { exists = false }
    dirs.push({ key: name, label: name, dir: posix(dir), state: exists ? 'exists' : 'missing', detail: exists ? '已存在，跳过' : '缺失，将创建' })
  }

  const files = []
  const writes = []
  let broken = ''

  // ② MEMORY.md 写入「使用者身份」占位（已有同前缀条目则跳过）
  const memoryFile = ctx.memoryFile
  // 「不存在」与「存在但读不到」严格区分：后者必须拒写（否则会把 EACCES 当成首装去新建）
  const memStrict = memoryFile ? readFileStrict(memoryFile) : { exists: false, readable: false, code: '', error: '' }
  const rawMem = memStrict.readable ? { text: memStrict.text, bom: memStrict.bom } : null
  const memText = rawMem ? rawMem.text : ''
  if (memStrict.exists && !memStrict.readable) {
    broken = 'MEMORY.md 存在但读不到（' + (memStrict.code || 'EACCES') + '）：已拒绝写入，避免覆盖；请检查文件权限或占用后重试'
  }
  if (!broken && rawMem && rawMem.bom) broken = 'MEMORY.md 带 ' + rawMem.bom + ' BOM，已拒绝写入；请先另存为 UTF-8 无 BOM'
  const memEntries = rawMem ? parseMemoryEntries(memText) : []
  if (!broken && rawMem && memText.trim() !== '' && memEntries.length === 0) {
    broken = 'MEMORY.md 存在但读不出任何条目，已拒绝追加（避免覆盖你的记忆库）'
  }
  if (!broken) {
    const already = memEntries.some((e) => memoryEntryBody(e).indexOf(IDENTITY_PREFIX) === 0)
    const entry = makeMemoryEntry(IDENTITY_PREFIX + IDENTITY_PLACEHOLDER_TEXT, { id: memoryEntryId('identity-placeholder'), now: ctx.now, tag: '关键' })
    if (already) {
      files.push({ name: 'MEMORY.md', path: posix(memoryFile), state: 'exists', detail: '已有「使用者身份」条目，跳过（只补缺失，不覆盖）' })
    } else {
      const content = appendEntriesText(memText, [entry])
      writes.push({ name: 'MEMORY.md', path: memoryFile, mode: rawMem ? 'append' : 'create', hadFile: Boolean(rawMem), content: content, bytes: Buffer.byteLength(content, 'utf8') })
      files.push({ name: 'MEMORY.md', path: posix(memoryFile), state: rawMem ? 'append' : 'create', detail: '将写入「使用者身份」占位条目（tag=关键）' })
    }
  }

  // ③ USER.md / GRAPH.json 骨架（不存在才建；GRAPH.json 结构与 work-memory 的 readGraph 对齐）
  if (!broken) {
    const userFile = join(ctx.memoryDir, 'USER.md')
    if (fileExists(userFile)) {
      files.push({ name: 'USER.md', path: posix(userFile), state: 'exists', detail: '已存在，跳过' })
    } else {
      writes.push({ name: 'USER.md', path: userFile, mode: 'create', hadFile: false, content: '', bytes: 0 })
      files.push({ name: 'USER.md', path: posix(userFile), state: 'create', detail: '将新建空偏好文件（首条偏好由 memory_remember 写入）' })
    }
    const graphFile = join(ctx.memoryDir, 'GRAPH.json')
    if (fileExists(graphFile)) {
      files.push({ name: 'GRAPH.json', path: posix(graphFile), state: 'exists', detail: '已存在，跳过' })
    } else {
      const graphText = JSON.stringify({ entities: [], edges: [] }, null, 2)
      writes.push({ name: 'GRAPH.json', path: graphFile, mode: 'create', hadFile: false, content: graphText, bytes: Buffer.byteLength(graphText, 'utf8') })
      files.push({ name: 'GRAPH.json', path: posix(graphFile), state: 'create', detail: '将新建关联图骨架' })
    }
  }

  // ④ PROJECTS/工作秘书.md：四条（使用说明 / 安装说明 / 待办·开局 / 技能库），只补缺失的
  if (!broken) {
    const projectFile = join(ctx.memoryDir, 'PROJECTS', WORK_SECRETARY_FILE)
    const projectStrict = readFileStrict(projectFile)
    const projectRaw = projectStrict.readable ? { text: projectStrict.text, bom: projectStrict.bom } : null
    if (projectStrict.exists && !projectStrict.readable) {
      broken = 'PROJECTS/' + WORK_SECRETARY_FILE + ' 存在但读不到（' + (projectStrict.code || 'EACCES') + '）：已拒绝写入'
    } else if (projectRaw && projectRaw.bom) {
      broken = 'PROJECTS/' + WORK_SECRETARY_FILE + ' 带 ' + projectRaw.bom + ' BOM，已拒绝写入'
    } else {
      const projectText = projectRaw ? projectRaw.text : ''
      const existing = projectRaw ? parseMemoryEntries(projectText) : []
      const bodies = existing.map((e) => memoryEntryBody(e))
      const useText = readTextOf(join(ctx.moduleDir, 'defaults', 'use.zh-CN.md'))
      const installText = readTextOf(join(ctx.moduleDir, 'defaults', 'install.zh-CN.md'))
      const wanted = [
        { title: WORK_SECRETARY_TITLES[0], content: '【使用说明】\n' + (useText || '（随包说明缺失：请重装集成体）'), tag: '常规' },
        { title: WORK_SECRETARY_TITLES[1], content: '【安装说明】\n' + (installText || '（随包说明缺失：请重装集成体）'), tag: '常规' },
        { title: WORK_SECRETARY_TITLES[2], content: '【待办·开局】\n' + STARTER_TODOS.join('\n'), tag: '关键' },
        { title: WORK_SECRETARY_TITLES[3], content: SKILL_LIBRARY_STUB, tag: '常规' },
      ]
      const missingEntries = []
      const presentTitles = []
      for (const w of wanted) {
        if (bodies.some((b) => b.indexOf(w.title) === 0)) { presentTitles.push(w.title); continue }
        missingEntries.push(makeMemoryEntry(w.content, { id: memoryEntryId('wsmd:' + w.title), now: ctx.now, tag: w.tag }))
      }
      if (missingEntries.length === 0) {
        files.push({ name: 'PROJECTS/' + WORK_SECRETARY_FILE, path: posix(projectFile), state: 'exists', detail: '四条（使用说明 / 安装说明 / 待办·开局 / 技能库）都已存在，跳过' })
      } else {
        const content = appendEntriesText(projectText, missingEntries)
        writes.push({ name: 'PROJECTS/' + WORK_SECRETARY_FILE, path: projectFile, mode: projectRaw ? 'append' : 'create', hadFile: Boolean(projectRaw), content: content, bytes: Buffer.byteLength(content, 'utf8') })
        files.push({
          name: 'PROJECTS/' + WORK_SECRETARY_FILE,
          path: posix(projectFile),
          state: projectRaw ? 'append' : 'create',
          detail: '将补写 ' + missingEntries.length + ' 条（' + wanted.filter((w) => missingEntries.some((m) => m.indexOf(w.title) >= 0)).map((w) => w.title).join(' ') + '）' + (presentTitles.length ? '；已有 ' + presentTitles.join(' ') + ' 逐字保留' : ''),
        })
      }
    }
  }

  const missingDirs = dirs.filter((d) => d.state === 'missing')
  const bytes = writes.reduce((acc, w) => acc + w.bytes, 0)
  const status = broken ? 'broken' : (missingDirs.length === 0 && writes.length === 0 ? 'up_to_date' : (dirs.every((d) => d.state === 'missing') && writes.every((w) => w.mode === 'create') ? 'append' : 'update'))
  const action = broken ? '结构不可安全写入，已停止' : (status === 'up_to_date' ? '已是最新无需写入' : '将只补缺失的目录与条目（不覆盖任何已有内容）')
  const detail = broken || ('骨架目录 ' + (MEMORY_SKELETON_DIRS.length - missingDirs.length) + '/' + MEMORY_SKELETON_DIRS.length + ' 已存在；待写入 ' + writes.length + ' 个文件')

  return makeItem(spec, {
    status: status,
    target: posix(ctx.memoryDir),
    detail: detail,
    autoApplyable: !broken && (missingDirs.length > 0 || writes.length > 0),
    dirs: dirs,
    files: files,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(dirs.map((d) => d.key + ':' + d.state).join('\n') + '\n' + files.map((x) => x.name + ':' + x.state).join('\n')),
      sampleLines: sampleBlock(dirs.map((d) => d.dir + '  [' + d.state + ']').concat(files.map((x) => x.name + '  [' + x.state + ']'))),
    },
    internal: { dirs: dirs, writes: writes, missingDirs: missingDirs.map((d) => d.dir) },
  })
}

// ── ⑦ 知识库结构 ──

/**
 * 扫描知识库根下已存在的一级业务模块目录（排除受管目录、点目录，以及额外排除项）。
 * @param {string} vaultDir 知识库根
 * @param {string[]} [extraExclude] 额外不登记的目录名（如被误放进库里的记忆库目录）
 */
export function listVaultModules(vaultDir, extraExclude) {
  const extra = Array.isArray(extraExclude) ? extraExclude : []
  let ents = []
  try { ents = readdirSync(vaultDir, { withFileTypes: true }) } catch (e) { return [] }
  return ents
    .filter((d) => d.isDirectory() && d.name[0] !== '.' && VAULT_MANAGED_DIRS.indexOf(d.name) < 0 && extra.indexOf(d.name) < 0)
    .map((d) => d.name)
    .sort()
}

/** 主页正文（不写死任何业务模块名，模块清单来自扫描结果） */
export function buildVaultHomeText(modules) {
  const list = Array.isArray(modules) ? modules : []
  const rows = list.length > 0
    ? list.map((m) => '- [' + m + '](<./' + m + '>)：业务知识与资料').join('\n')
    : '- （还没有业务模块目录；可在本库新建，或在「核心配置」里指定）'
  return [
    '# 🏠 主页',
    '',
    '本库由「工作秘书」集成体建立：业务知识、工具索引与记忆镜像都从这里进入。',
    '',
    '## 记忆镜像',
    '',
    '- [00_全局记忆](<./00_全局记忆>)：由记忆库自动镜像，请勿在此手改（改动走记忆工具或面板）。',
    '',
    '## 工具',
    '',
    '- [' + VAULT_TOOL_OVERVIEW_FILE.replace(/\.md$/, '') + '](<./' + VAULT_TOOLS_DIR_NAME + '/' + VAULT_TOOL_OVERVIEW_FILE + '>)：技能 / 脚本 / MCP 三个子目录的入口。',
    '',
    '## 业务模块',
    '',
    rows,
    '',
    '## 约定',
    '',
    '- 本库是知识库的真相源；记忆镜像区只读，改动走记忆工具。',
    '- `工具/` 三个子目录本版只是**预留框架**（只建目录与总览，未实现同步）；要放什么先手工放。',
    '',
  ].join('\n')
}

/**
 * 工具总览正文。
 *
 * ⚠️ 措辞纪律：本版**没有实现任何同步**（只建目录与这份总览），所以下面写的是**预留用途**，
 * 并且必须显式说明「现在是空的」—— 不能让库里这份文件看起来像「工具已经搬进来了」。
 * 真同步未立项；要放什么先手工放。
 */
export function buildToolOverviewText() {
  return [
    '# 00_工具总览',
    '',
    '本目录集中放工具与技能，三个子目录各自预留一类用途：',
    '',
    '| 子目录 | 预留用途（尚未启用） |',
    '|---|---|',
    '| 技能/ | DSH 技能与插件随包技能的同步副本 + 索引 |',
    '| 脚本/ | 工作区与知识库脚本的说明与用法 |',
    '| MCP/ | MCP 服务登记（本机没有就空着） |',
    '',
    '## 现状（重要：别当成已生效）',
    '',
    '- 本版（1.1.3）**只建了这三个目录和这份总览，没有实现任何同步**。',
    '- 所以现在这三个子目录是**空的**；上表写的是**规划用途**，不是当前行为。',
    '- 需要放什么，请先手工放进对应子目录；自动同步属后续版本，未立项。',
    '- 若将来实现，遵守的纪律是：单向（源 → 本目录，不反向写回）、幂等（内容未变则跳过）、',
    '  库里副本被手改过就不覆盖只提示、技能含附属文件时只在索引里标注。',
    '',
  ].join('\n')
}

function planKnowledgeDeck(ctx) {
  const spec = BASEDECK_ITEMS[6]
  const emptyInternal = { dirs: [], writes: [] }
  if (!ctx.obsidianDir) {
    return makeItem(spec, {
      status: 'none',
      target: '',
      detail: '没有指定 Obsidian 知识库目录（显式失败，不猜路径）：请先在「核心配置」里填写',
      dirs: [],
      files: [],
      preview: { action: '没有知识库目录，无法处理', blockVersion: '', contentHash: '', sampleLines: '' },
      internal: emptyInternal,
    })
  }

  const vault = ctx.obsidianDir
  const dirTargets = [
    { key: 'mirror', label: VAULT_MIRROR_DIR_NAME, dir: join(vault, VAULT_MIRROR_DIR_NAME) },
    { key: 'tools', label: VAULT_TOOLS_DIR_NAME, dir: join(vault, VAULT_TOOLS_DIR_NAME) },
  ]
  for (const sub of VAULT_TOOL_SUBDIRS) {
    dirTargets.push({ key: 'tools/' + sub, label: VAULT_TOOLS_DIR_NAME + '/' + sub, dir: join(vault, VAULT_TOOLS_DIR_NAME, sub) })
  }

  const dirs = dirTargets.map((t) => {
    let exists = false
    try { exists = statSync(t.dir).isDirectory() } catch (e) { exists = false }
    return { key: t.key, label: t.label, dir: posix(t.dir), state: exists ? 'exists' : 'missing', detail: exists ? '已存在，跳过' : '缺失，将创建' }
  })

  // 记忆库目录若被放进知识库（使用者「单独指定」时可能），它不是业务模块，不登记进主页
  const modules = listVaultModules(vault, [memoryTopSegmentInVault(ctx.memoryDir, vault)])
  const files = []
  const writes = []
  let broken = ''
  // 冲突判定（1.1.3 修：此前 broken 恒为空，是死分支）——受管子目录位置被同名**文件**占用即拒写
  for (const t of dirTargets) {
    let st = null
    try { st = statSync(t.dir) } catch (e) { st = null }
    if (st && !st.isDirectory()) {
      broken = '知识库子目录位置被同名文件占用：' + posix(t.dir)
      break
    }
  }
  const fileSpecs = [
    { name: VAULT_HOME_FILE, path: join(vault, VAULT_HOME_FILE), content: buildVaultHomeText(modules), note: '总入口（含已登记的 ' + modules.length + ' 个业务模块）' },
    { name: VAULT_TOOLS_DIR_NAME + '/' + VAULT_TOOL_OVERVIEW_FILE, path: join(vault, VAULT_TOOLS_DIR_NAME, VAULT_TOOL_OVERVIEW_FILE), content: buildToolOverviewText(), note: '工具入口与同步纪律' },
    { name: VAULT_OBSIDIAN_DIR_NAME + '/' + VAULT_APP_JSON_FILE, path: join(vault, VAULT_OBSIDIAN_DIR_NAME, VAULT_APP_JSON_FILE), content: VAULT_APP_JSON_TEXT, note: '.obsidian 最小配置' },
  ]
  for (const s of fileSpecs) {
    const strict = readFileStrict(s.path)
    if (strict.exists && !strict.readable) {
      broken = s.name + ' 存在但读不到（' + (strict.code || 'EACCES') + '）：已拒绝写入，请检查文件权限或占用后重试'
      break
    }
    let st = null
    try { st = statSync(s.path) } catch (e) { st = null }
    if (st && !st.isFile()) {
      broken = s.name + ' 位置被同名目录占用：' + posix(s.path)
      break
    }
    if (fileExists(s.path)) {
      files.push({ name: s.name, path: posix(s.path), state: 'exists', detail: '已存在，保留不覆盖（' + s.note + '）' })
      continue
    }
    writes.push({ name: s.name, path: s.path, mode: 'create', hadFile: false, content: s.content, bytes: Buffer.byteLength(s.content, 'utf8') })
    files.push({ name: s.name, path: posix(s.path), state: 'create', detail: '将新建：' + s.note })
  }

  const missingDirs = dirs.filter((d) => d.state === 'missing')
  const bytes = writes.reduce((acc, w) => acc + w.bytes, 0)
  const status = broken ? 'broken' : (missingDirs.length === 0 && writes.length === 0 ? 'up_to_date' : (dirs.every((d) => d.state === 'missing') ? 'append' : 'update'))
  const action = broken ? '结构不可安全写入，已停止'
    : (status === 'up_to_date' ? '已是最新无需写入' : '将只补缺失的目录与文件（不覆盖任何已有内容）')
  const detail = broken || ('模块骨架登记 ' + modules.length + ' 个（' + (modules.join('、') || '暂无') + '）；目录缺失 ' + missingDirs.length + ' / ' + dirs.length + '；待写入 ' + writes.length + ' 个文件')

  return makeItem(spec, {
    status: status,
    target: posix(vault),
    detail: detail,
    autoApplyable: status !== 'up_to_date' && !broken,
    dirs: dirs,
    files: files,
    modules: modules,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(files.map((x) => x.name + ':' + x.state).join('\n')),
      sampleLines: sampleBlock(dirs.map((d) => d.dir + '  [' + d.state + ']').concat(files.map((x) => x.name + '  [' + x.state + ']'))),
    },
    internal: { dirs: dirs, writes: writes, missingDirs: missingDirs.map((d) => d.dir) },
  })
}

// ── ⑥⑦ 共用写回器 ──

/**
 * ⑥⑦ 共用写回器。
 * 1.1.3 起：写 <记忆库目录>/ 的项（memoryDeck）先取 .work-memory.lock 并在**锁内重算**再写
 * （否则并发的 memory_remember / 自动记日志会与本项互相覆盖）；knowledgeDeck 写的是知识库目录，
 * 不是记忆库，不共用这把锁。两项落盘前都过 assertWritableDir 护栏（与「可用性检查」同口径）。
 */
function applyDeckFiles(ctx, item, internal, io, dryRun, base, options) {
  const lockDir = item.id === 'memoryDeck' ? (ctx.memoryDir || '') : ''
  if (!dryRun && lockDir) {
    // 护栏前置到取锁之前：被拒的目标目录不该被创建锁文件
    const preGuard = assertWritableDir(lockDir, '记忆库目录', ctx.env)
    if (!preGuard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + preGuard.error })
    try {
      return withMemoryDirLock(lockDir, () => {
        const fresh = planBaseDeck(options || {}).items.filter((it) => it.id === item.id)[0]
        return applyDeckFilesLocked(ctx, fresh || item, (fresh && fresh.internal) || internal, io, false, base)
      })
    } catch (err) {
      return Object.assign(base, { ok: false, detail: '记忆库写入未执行（未改动任何文件）：' + String(err && err.message ? err.message : err) })
    }
  }
  return applyDeckFilesLocked(ctx, item, internal, io, dryRun, base)
}

function applyDeckFilesLocked(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') {
    return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  }
  if (item.status === 'broken' || item.status === 'none') {
    return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  }
  const dirs = (internal.dirs || []).filter((d) => d.state === 'missing')
  const writes = internal.writes || []
  const totalBytes = writes.reduce((acc, w) => acc + (w.bytes || 0), 0)
  base.wouldWriteBytes = totalBytes
  base.plannedDirs = dirs.map((d) => d.dir)
  base.plannedFiles = writes.map((w) => ({ name: w.name, path: posix(w.path), mode: w.mode }))
  base.plannedBackups = writes.filter((w) => w.hadFile).map((w) => posix(w.path + BACKUP_SUFFIX + stamp(ctx.now)))

  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '；干跑：未写盘（将创建 ' + dirs.length + ' 个目录、写入 ' + writes.length + ' 个文件，共 ' + totalBytes + ' 字节）',
    })
  }

  // 落盘前护栏（与「可用性检查」同口径）：拒绝主目录 / 非绝对路径 / 不可写 / 同名文件占用
  const guardDir = item.id === 'knowledgeDeck' ? ctx.obsidianDir : ctx.memoryDir
  const guardLabel = item.id === 'knowledgeDeck' ? 'Obsidian 知识库目录' : '记忆库目录'
  const guard = assertWritableDir(guardDir, guardLabel, ctx.env)
  if (!guard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + guard.error })

  const createdDirs = []
  const createdFiles = []
  const backups = []
  const rollbackAll = () => {
    for (const p of createdFiles.slice().reverse()) {
      const b = backups.filter((x) => x.path === p)[0]
      try {
        if (b && b.backup) io.copyFileSync(b.backup, p)
        else io.rmSync(p, { force: true })
      } catch (e) { /* best-effort */ }
    }
    for (const d of createdDirs.slice().reverse()) {
      // fs.rmSync 删目录**必须**带 recursive，否则抛 EISDIR（空目录也删不掉）——
      // 不带 recursive 会让「已回滚」留下空目录，回滚不彻底等于回滚失败。
      // 这里删的都是本轮新建的目录，其中的文件已在上一步删掉，不会碰到使用者原有内容。
      try { io.rmSync(d, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
    }
  }

  for (const d of dirs) {
    try {
      io.mkdirSync(d.dir, { recursive: true })
      createdDirs.push(d.dir)
    } catch (err) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '创建目录失败（已回滚）：' + posix(d.dir) + '（' + String(err && err.message ? err.message : err) + '）' })
    }
  }
  for (const w of writes) {
    try {
      io.mkdirSync(dirname(w.path), { recursive: true })
      let backup = ''
      if (w.hadFile) {
        backup = backupFile(w.path, io, ctx.now)
        backups.push({ path: w.path, backup: backup })
      }
      atomicWriteText(w.path, w.content, io)
      createdFiles.push(w.path)
    } catch (err) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '写入失败（已回滚）：' + posix(w.path) + '（' + String(err && err.message ? err.message : err) + '）' })
    }
  }

  // 写后校验：无 BOM + SHA256 与预期一致
  for (const w of writes) {
    const verify = readFileRaw(w.path)
    if (!verify) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '写后读取失败（已回滚）：' + posix(w.path) })
    }
    if (verify.bom) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '写后检测到 ' + verify.bom + ' BOM（已回滚）：' + posix(w.path) })
    }
    if (sha256Text(verify.buffer) !== sha256Text(Buffer.from(w.content, 'utf8'))) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '写后 SHA256 不一致（已回滚）：' + posix(w.path) })
    }
  }

  return Object.assign(base, {
    ok: true,
    bytesWritten: totalBytes,
    wroteAny: createdDirs.length > 0 || createdFiles.length > 0,
    createdDirs: createdDirs.map((d) => posix(d)),
    writtenFiles: createdFiles.map((x) => posix(x)),
    backups: backups.map((b) => ({ path: posix(b.path), backup: b.backup ? posix(b.backup) : '' })),
    detail: item.detail + '；已创建 ' + createdDirs.length + ' 个目录、写入 ' + createdFiles.length + ' 个文件（' + totalBytes + ' 字节），写后校验通过'
      + (backups.length > 0 ? '；改写前已备份 ' + backups.length + ' 个文件' : '；全部为新建，无需备份'),
  })
}

// ═════════════════ 1.1.3 新增：⑧ 迁移旧记忆库（改记忆库目录时把旧内容带过来） ═════════════════
//
// 场景：使用者在「核心配置」里把记忆库目录改到别处。旧目录里的记忆必须先**带过去**再切换，
// 否则新目录是空的、看起来像「记忆丢了」。
//
// 迁移专属纪律（在通用写回纪律之上再加四条）：
//   1. **只补缺失、绝不覆盖**：目标已有同名文件时一律跳过（内容一致）或计冲突（内容不同），不比对不合并；
//   2. **旧目录只读**：迁移从不删除、从不改写旧目录里的任何文件（迁完旧目录原样保留，由使用者自行处理）；
//   3. **逐文件校验**：复制后按「大小 + SHA256」与源比对，任一不一致即回滚本次已复制的文件；
//   4. **对目标取记忆库锁**：与记忆写入共用同一把 .work-memory.lock，并在锁内**重算**再复制。
//
// 另：本项是**前置步骤**（dirs 之后、memorySeed 之前）。失败时 applyBaseDeck 停止后续步骤，
// 尤其不写 settings —— 迁移没成功就不切换记忆库目录。

/** 迁移清单文件名前缀（写在备份目录，供事后审计；它不是记忆库内容，迁移时按噪声跳过） */
export const MIGRATE_MANIFEST_PREFIX = '.wps-migrate-'

/** 旧的默认记忆库相对路径（1.0.6 / 1.1.2 及更早）；只用于「迁移来源」回退，不再作为任何新建目标 */
export const LEGACY_MEMORY_SUBDIR = join('memories', 'work-memory')

/** 迁移来源的四种口径：让使用者看得见「旧目录是怎么定出来的」 */
export const MIGRATE_SOURCE_LABELS = {
  settings: '当前设置里生效的记忆库目录',
  'legacy-default': '旧的默认位置（<DSH_HOME>/memories/work-memory）',
  'new-default': '新的默认位置（<DSH_HOME>/data/dsh-work-memory/memory）',
  none: '未解析到来源',
}

/**
 * 迁移时要跳过的「噪声」文件：锁、写前备份、原子写临时文件、迁移清单与 .tmp。
 * 这些是运行时状态而不是记忆内容，搬过去只会造成误解（例如把一个陈旧锁搬进新库）。
 * 注意：**不按点号前缀一刀切** —— .triage.json / .access.json / ARCHIVE/.last-run 等状态文件要迁移。
 */
export function isMigrateNoise(name) {
  const n = String(name == null ? '' : name)
  if (!n) return true
  if (n === MEMORY_LOCK_NAME) return true
  if (n.indexOf(BACKUP_SUFFIX) >= 0) return true
  if (n.indexOf('.wps-tmp') >= 0) return true
  if (n.indexOf(MIGRATE_MANIFEST_PREFIX) === 0) return true
  if (/\.tmp$/i.test(n)) return true
  return false
}

/** 路径等价判定（Windows 不分区大小写；先规范化再去掉末尾分隔符） */
export function sameFsPath(a, b) {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  if (!na || !nb) return false
  const ca = posix(na).replace(/\/+$/, '')
  const cb = posix(nb).replace(/\/+$/, '')
  return process.platform === 'win32' ? ca.toLowerCase() === cb.toLowerCase() : ca === cb
}

/** 静默 stat（不存在 / 无权限都返回 null，由调用方按「拿不到」处理） */
function statQuiet(p) {
  try { return statSync(p) } catch (e) { return null }
}

/**
 * 递归列出源目录下的**普通文件**（相对路径一律用 / 分隔）。
 * 只读；不跟随符号链接（可能是环，也可能指到库外）；读写异常向上抛给计划器转成 broken。
 * @param {string} root 源根目录
 * @param {string} [rel] 当前相对路径
 * @param {object[]} [out] 收集到的文件
 * @param {string[]} [noise] 收集到的噪声文件（只用于回显计数）
 */
export function walkFilesForMigrate(root, rel = '', out = [], noise = []) {
  const dir = rel ? join(root, rel) : root
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error('读取旧记忆库目录失败：' + posix(dir) + '（' + String(err && err.message ? err.message : err) + '）')
  }
  const byName = new Map()
  for (const e of entries) byName.set(e.name, e)
  const names = entries.map((e) => e.name).sort()
  for (const name of names) {
    const ent = byName.get(name)
    const childRel = rel ? rel + '/' + name : name
    if (isMigrateNoise(name)) { noise.push(childRel); continue }
    if (ent && typeof ent.isSymbolicLink === 'function' && ent.isSymbolicLink()) continue
    if (ent && typeof ent.isDirectory === 'function' && ent.isDirectory()) {
      walkFilesForMigrate(root, childRel, out, noise)
      continue
    }
    const st = statQuiet(join(root, childRel))
    if (st && st.isFile()) out.push({ rel: childRel, path: join(root, childRel), bytes: st.size })
  }
  return out
}

/**
 * ⑧ 迁移旧记忆库的计划（**只读**，绝不落盘）。
 * 输入：ctx.migrateFrom（旧目录，由 api 层经宿主设置服务解析）/ ctx.migrateFromSource（来源口径）/ ctx.memoryDir（目标）。
 */
function planMigrateMemory(ctx) {
  const spec = BASEDECK_ITEMS[7]
  const from = ctx.migrateFrom || ''
  const to = ctx.memoryDir || ''
  const sourceKind = ctx.migrateFromSource || (from ? 'settings' : 'none')
  const sourceText = MIGRATE_SOURCE_LABELS[sourceKind] || ('来源：' + sourceKind)

  const stop = (status, detail) => makeItem(spec, {
    status: status,
    target: (from || to) ? [posix(from), posix(to)] : '',
    detail: detail,
    autoApplyable: false,
    migratedFrom: from ? posix(from) : '',
    migrateSource: sourceKind,
    migrateSourceText: sourceText,
    files: [],
    conflicts: [],
    copies: 0,
    skips: 0,
    migrateStats: { copy: 0, skip: 0, conflict: 0, noise: 0, bytes: 0 },
    oldDirKept: true,
    preview: { action: detail, blockVersion: '', contentHash: '', sampleLines: '' },
    internal: { from: from, to: to, source: sourceKind, copies: [], conflicts: [], skips: [], noise: [] },
  })

  if (!to) return stop('none', '没有可用的记忆库目录（显式失败，不猜路径）：请先在「核心配置」里填写记忆库目录')
  if (!from) return stop('up_to_date', '未解析到旧记忆库来源（设置服务不可用或未配置），本项跳过')
  if (sameFsPath(from, to)) {
    return stop('up_to_date', '旧记忆库与目标目录是同一个（' + posix(to) + '，来源：' + sourceText + '），无需迁移')
  }
  const fromStat = statQuiet(from)
  if (!fromStat || !fromStat.isDirectory()) {
    return stop('up_to_date', '旧记忆库目录不存在或不是目录（' + posix(from) + '，来源：' + sourceText + '），无需迁移')
  }
  const toStat = statQuiet(to)
  if (toStat && !toStat.isDirectory()) {
    return stop('broken', '目标记忆库位置已被同名文件占用（' + posix(to) + '）：已拒绝迁移，请先处理该文件')
  }

  let walked = []
  const noise = []
  try {
    walked = walkFilesForMigrate(from, '', [], noise)
  } catch (err) {
    return stop('broken', String(err && err.message ? err.message : err) + '：已拒绝迁移，未改动任何文件')
  }

  const copies = []
  const conflicts = []
  const skips = []
  for (const f of walked) {
    const target = join(to, f.rel)
    const st = statQuiet(target)
    if (st && !st.isFile()) { conflicts.push({ rel: f.rel, reason: 'occupied' }); continue }
    const srcSha = sha256Of(f.path)
    if (st && srcSha && st.size === f.bytes && sha256Of(target) === srcSha) {
      skips.push({ rel: f.rel, reason: 'identical' })
      continue
    }
    if (st) { conflicts.push({ rel: f.rel, reason: 'differs' }); continue }
    copies.push({ rel: f.rel, from: f.path, to: target, bytes: f.bytes, sha256: srcSha })
  }

  const stats = {
    copy: copies.length,
    skip: skips.length,
    conflict: conflicts.length,
    noise: noise.length,
    bytes: copies.reduce((acc, c) => acc + (c.bytes || 0), 0),
  }
  const status = copies.length === 0 ? 'up_to_date' : (skips.length === 0 && conflicts.length === 0 ? 'append' : 'update')
  const action = copies.length === 0 ? '无需迁移（目标侧没有要补的文件）'
    : '将从旧目录复制 ' + copies.length + ' 个文件（只补缺失、绝不覆盖，旧目录原样保留）'
  const detail = status === 'up_to_date'
    ? '无需迁移：' + (conflicts.length > 0
      ? '目标已有 ' + conflicts.length + ' 个同名文件且内容不同，一律保留目标内容（不覆盖）'
      : '目标侧已包含全部可迁移文件')
      + '；旧目录 ' + posix(from) + '（' + sourceText + '）'
    : '旧记忆库 ' + posix(from) + '（' + sourceText + '）→ ' + posix(to)
      + '：待复制 ' + copies.length + ' 个文件（' + stats.bytes + ' 字节）'
      + '；已存在且内容一致 ' + skips.length + ' 个（跳过）'
      + '；同名但内容不同 ' + conflicts.length + ' 个（保留目标，不覆盖）'
      + '；噪声 ' + noise.length + ' 个（锁 / 备份 / 临时文件，不迁移）'

  const fileList = copies.map((c) => ({ name: c.rel, path: posix(c.to), state: 'copy', detail: '缺失，将复制（' + c.bytes + ' 字节）' }))
    .concat(conflicts.map((c) => ({ name: c.rel, path: posix(join(to, c.rel)), state: 'conflict', detail: '目标已有同名文件且内容不同，保留目标' })))
  const listNote = stats.copy > 500 ? '（只列前 500 项）' : ''

  return makeItem(spec, {
    status: status,
    target: [posix(from), posix(to)],
    detail: detail,
    autoApplyable: copies.length > 0,
    migratedFrom: posix(from),
    migrateSource: sourceKind,
    migrateSourceText: sourceText,
    migrateStats: stats,
    files: fileList.slice(0, 500),
    conflicts: conflicts.map((c) => c.rel),
    copies: stats.copy,
    skips: stats.skip,
    oldDirKept: true,
    preview: {
      action: action,
      blockVersion: '',
      contentHash: 'sha256:' + sha256Text(copies.map((c) => c.rel + ':' + c.sha256).join('\n')),
      sampleLines: sampleBlock(fileList.slice(0, SAMPLE_LINES).map((x) => x.name + '  [' + x.state + ']' + listNote)),
    },
    internal: { from: from, to: to, source: sourceKind, copies: copies, conflicts: conflicts, skips: skips, noise: noise, stats: stats },
  })
}

/**
 * ⑧ 写回器：复制缺失文件。干跑只统计；执行在**目标记忆库锁内重算**后逐文件复制 + 校验 + 失败回滚。
 * 与 ⑥⑦ 的差别：本项**从旧目录读、往新目录写**，且**从不删除旧目录**。
 */
function applyMigrateMemory(ctx, item, internal, io, dryRun, base, options) {
  const to = internal.to || ''
  if (!dryRun && to) {
    // 护栏前置到取锁之前：被拒的目标目录不该被创建锁文件
    const preGuard = assertWritableDir(to, '记忆库目录', ctx.env)
    if (!preGuard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + preGuard.error })
    try {
      return withMemoryDirLock(to, () => {
        const fresh = planBaseDeck(options || {}).items.filter((it) => it.id === 'migrateMemory')[0]
        return applyMigrateMemoryLocked(ctx, fresh || item, (fresh && fresh.internal) || internal, io, false, base)
      })
    } catch (err) {
      return Object.assign(base, { ok: false, detail: '迁移未执行（未改动任何文件）：' + String(err && err.message ? err.message : err) })
    }
  }
  return applyMigrateMemoryLocked(ctx, item, internal, io, dryRun, base)
}

/** 记录式建目录：从最上层逐个建（便于回滚时按空目录删掉，不误删使用者原有目录） */
function ensureDirsTracked(dir, io, created) {
  const pending = []
  let cur = dir
  for (let i = 0; i < 64; i++) {
    if (!cur || existsSync(cur)) break
    pending.unshift(cur)
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  for (const p of pending) {
    io.mkdirSync(p, { recursive: true })
    created.push(p)
  }
}

function applyMigrateMemoryLocked(ctx, item, internal, io, dryRun, base) {
  const from = internal.from || ''
  const to = internal.to || ''
  const copies = internal.copies || []
  const conflicts = internal.conflicts || []
  const skips = internal.skips || []
  const stats = internal.stats || {
    copy: copies.length,
    skip: skips.length,
    conflict: conflicts.length,
    noise: (internal.noise || []).length,
    bytes: copies.reduce((acc, c) => acc + (c.bytes || 0), 0),
  }
  base.wouldWriteBytes = stats.bytes
  base.migrateStats = stats
  base.migratedFrom = from ? posix(from) : ''
  base.migrateSource = internal.source || ''
  base.oldDirKept = from ? posix(from) : ''

  if (item.status === 'up_to_date') {
    return Object.assign(base, {
      ok: true,
      detail: item.detail + '（未写盘）',
      migratedFiles: [],
      conflicts: conflicts.map((c) => c.rel),
    })
  }
  if (item.status === 'broken' || item.status === 'none') {
    return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  }
  if (dryRun) {
    return Object.assign(base, {
      ok: true,
      plannedFiles: copies.map((c) => ({ from: posix(c.from), to: posix(c.to), bytes: c.bytes })),
      detail: item.detail + '；干跑：未写盘（将复制 ' + copies.length + ' 个文件，共 ' + stats.bytes + ' 字节）',
    })
  }

  const guard = assertWritableDir(to, '记忆库目录', ctx.env)
  if (!guard.ok) return Object.assign(base, { ok: false, detail: '已拒绝写入：' + guard.error })

  const createdDirs = []
  const copied = []
  const rollbackAll = () => {
    for (const p of copied.slice().reverse()) {
      try { io.rmSync(p, { force: true }) } catch (e) { /* best-effort */ }
    }
    for (const d of createdDirs.slice().reverse()) {
      // 注意：fs.rmSync 对目录必须带 recursive，否则抛 EISDIR（空目录也删不掉）。
      // 这里删的都是本轮**新建**的目录，里面的文件已在上一步删掉，递归删不会碰到使用者的原有内容。
      try { io.rmSync(d, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
    }
  }

  for (const c of copies) {
    try {
      ensureDirsTracked(dirname(c.to), io, createdDirs)
      io.copyFileSync(c.from, c.to)
      copied.push(c.to)
    } catch (err) {
      rollbackAll()
      return Object.assign(base, {
        ok: false,
        detail: '复制失败（已回滚本次已复制的文件，旧目录未改动）：' + posix(c.from) + ' → ' + posix(c.to)
          + '（' + String(err && err.message ? err.message : err) + '）',
      })
    }
  }

  // 写后校验：目标的大小与 SHA256 必须与源一致（源在计划阶段已算好）
  for (const c of copies) {
    const st = statQuiet(c.to)
    if (!st || !st.isFile() || st.size !== c.bytes) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '复制后大小不一致（已回滚，旧目录未改动）：' + posix(c.to) })
    }
    if (c.sha256 && sha256Of(c.to) !== c.sha256) {
      rollbackAll()
      return Object.assign(base, { ok: false, detail: '复制后 SHA256 不一致（已回滚，旧目录未改动）：' + posix(c.to) })
    }
  }

  // 迁移清单（审计用；写在备份目录，写失败不影响迁移结果）
  let manifest = ''
  const backupDir = ctx.backupDir || ''
  if (backupDir) {
    try {
      io.mkdirSync(backupDir, { recursive: true })
      manifest = join(backupDir, MIGRATE_MANIFEST_PREFIX + stamp(ctx.now) + '.json')
      const body = JSON.stringify({
        generator: GENERATOR_ID,
        at: formatDate(ctx.now) + ' ' + stamp(ctx.now),
        from: posix(from),
        to: posix(to),
        source: internal.source || '',
        stats: stats,
        files: copied.map((p) => posix(p)),
      }, null, 2)
      atomicWriteText(manifest, body + '\n', io)
    } catch (e) {
      manifest = ''
    }
  }

  return Object.assign(base, {
    ok: true,
    bytesWritten: stats.bytes,
    wroteAny: copied.length > 0,
    migratedFiles: copied.map((p) => posix(p)),
    conflicts: conflicts.map((c) => c.rel),
    skippedFiles: skips.map((s) => s.rel),
    manifest: manifest ? posix(manifest) : '',
    detail: '已从旧目录 ' + posix(from) + ' 复制 ' + copied.length + ' 个文件（' + stats.bytes + ' 字节）到 ' + posix(to)
      + '；写后大小 + SHA256 校验通过'
      + (skips.length > 0 ? '；已存在且一致 ' + skips.length + ' 个跳过' : '')
      + (conflicts.length > 0 ? '；同名但内容不同 ' + conflicts.length + ' 个保留目标内容（未覆盖）' : '')
      + '；旧目录原样保留，未删除、未改写'
      + (manifest ? '；迁移清单 ' + posix(manifest) : ''),
  })
}

