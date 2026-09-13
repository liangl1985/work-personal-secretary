/**
 * work-personal-secretary —— 配置底座引擎（安装器第四步：把配置底座分步落地）
 *
 * 职责：把集成体自带的**配置底座**（指令层 / 记忆种子 / 技能 / 设置 / 目录）落地到使用者环境。
 * 五项：
 *   agentsMd   把 defaults/AGENTS.zh-CN.md 的**标记块区间**合并进 <workspace>/AGENTS.md
 *   memorySeed 把 defaults/global-memory.seed.md 的种子条目追加进记忆库 MEMORY.md（全局记忆）
 *   skills     把 <repoRoot>/modules/dsh-doc-suite/skills/<name>/SKILL.md 装到 <workspace>/.dsh/skills/<name>/
 *   settings   写 <DSH_HOME>/settings.yaml 的 work-memory / experts 段（只增改指定键）
 *   dirs       创建记忆库 / 备份 / Obsidian 镜像 / 桌宠素材目录（只创建缺失的）
 *
 * 规范来源（已审查通过的 AGENTS 标记块规范）：
 *   标记块格式、块首元数据字段、content-hash 规范化口径、七状态判定算法、写回纪律、
 *   块内被使用者手改时的保守处置 —— 逐条落地在本文件（见各函数注释）。
 *
 * 形态：**配置引导（setup wizard）** —— 使用者填好首用必配项后一次性把五项全部写入。
 *   执行顺序按依赖排（agentsMd 放最后，它是使用者最在意的文件）：
 *     dirs -> memorySeed -> skills -> settings -> agentsMd
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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { MODULE_DIR, detectBom, posix, resolveRepoRoot } from './install.js'

// ───────────────────────────── 常量 ─────────────────────────────

/** 五项配置底座的**唯一来源**（顺序 = 面板展示顺序 = GET 计划顺序，接口契约定死） */
export const BASEDECK_ITEMS = [
  { id: 'agentsMd', label: '指令层 AGENTS.md' },
  { id: 'memorySeed', label: '记忆种子' },
  { id: 'skills', label: '文档技能' },
  { id: 'settings', label: '设置用户层' },
  { id: 'dirs', label: '工作目录' },
]

/** 五项 id 的字符串数组（查表 / 回显用） */
export const BASEDECK_ID_LIST = BASEDECK_ITEMS.map((it) => it.id)

/** **默认执行顺序**：按依赖排，agentsMd 放最后（引导一次性写入时使用） */
export const BASEDECK_APPLY_ORDER = ['dirs', 'memorySeed', 'skills', 'settings', 'agentsMd']

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

/** 记忆库默认（与 dsh-work-memory 的 store.js / backup.js 保持一致） */
export const DEFAULT_MEMORY_SUBDIR = join('memories', 'work-memory')
export const DEFAULT_BACKUP_SUBDIR = join('memories', 'work-memory-backup')

/** 桌宠素材目录（与 dsh-token-pet 的 skinsDir 一致：<dsh home>/data/dsh-token-pet/skins） */
export const PET_SKINS_SUBDIR = join('data', 'dsh-token-pet', 'skins')

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
    const parent = dirname(mirror)
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

  const memoryDir = normalizePath(ovMemoryDir)
    || normalizePath(options.memoryDir)
    || normalizePath(values['work-memory.memoryDir'])
    || (workspace ? join(dshHome, 'memories', basename(workspace)) : join(dshHome, DEFAULT_MEMORY_SUBDIR))
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
    libraryName: libraryName,
    memoryRoot: memoryRoot,
    obsidianExplicitOff: obsidianExplicitOff,
    memoryFile: memoryDir ? join(memoryDir, 'MEMORY.md') : '',
    backupDir: backupDir,
    obsidianSyncDir: obsidianSyncDir,
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
  const suggested = {
    'work-memory.memoryDir': ctx.workspace ? posix(join(ctx.dshHome, 'memories', basename(ctx.workspace))) : '',
    'work-memory.obsidianSyncDir': ctx.workspace ? posix(join(ctx.workspace, 'work-memory')) : '',
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
  const tmp = file + '.wps-tmp'
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
 * @param {string} id 五项之一
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
  if (id === 'memorySeed') return applyMemorySeed(ctx, item, item.internal || {}, io, dryRun, base)
  if (id === 'skills') return applySkills(ctx, item, item.internal || {}, io, dryRun, base)
  if (id === 'settings') return applySettings(ctx, item, item.internal || {}, io, dryRun, base)
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

function applyMemorySeed(ctx, item, internal, io, dryRun, base) {
  if (item.status === 'up_to_date') return Object.assign(base, { ok: true, detail: item.detail + '（未写盘）' })
  if (item.status === 'broken' || item.status === 'none') return Object.assign(base, { ok: false, detail: item.detail + '（未写盘）' })
  if (!ctx.memoryFile || !internal.newEntries || internal.newEntries.length === 0) {
    return Object.assign(base, { ok: false, detail: '没有需要写入的种子条目，未写盘' })
  }

  const hadFile = internal.exists
  const oldText = internal.text || ''
  const trimmed = oldText.replace(/[\r\n]+$/, '')
  const body = (trimmed === '' ? '' : trimmed + '\n§\n') + internal.newEntries.join('\n§\n') + '\n'
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
  const after = verify.text.split('\n§\n').map((e) => e.trim()).filter((e) => e.length > 0)
  const preserved = internal.entries.every((e, i) => after[i] === e)
  const added = internal.newEntries.every((e) => after.indexOf(e) >= 0)
  if (!preserved || !added) {
    rollbackWrite(ctx.memoryFile, backup, io, hadFile)
    return Object.assign(base, { ok: false, backup: posix(backup), detail: '写后校验失败：既有条目未被完整保留（已回滚）' })
  }

  return Object.assign(base, {
    ok: true,
    backup: backup ? posix(backup) : '',
    bytesWritten: bytes,
    wroteAny: true,
    entriesBefore: internal.entries.length,
    entriesAfter: after.length,
    preservedEntries: internal.entries.length,
    detail: item.detail + '；已写入 ' + bytes + ' 字节，原有 ' + internal.entries.length + ' 条逐条保留'
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
