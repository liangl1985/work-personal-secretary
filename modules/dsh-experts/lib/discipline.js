/**
 * dsh-experts — 交付层（层 4）：**纪律块**（自检红线的新家）
 *
 * 设计口径（design-v2 第 8 节 + 使用者 2026-09-14 六条口径①）：
 *   - 自检红线**不写在 persona 里**，统一放交付层，随每轮纪律块注入；
 *   - 真相源与最终落盘 = **项目记忆**（本模块只读 + 指纹，绝不修改记忆文件）；
 *   - 读不到时**不静默**（明示一行）；阶段裁剪时**永不丢弃**。
 *
 * 记忆里的格式契约（与 dsh-work-memory 的条目语法兼容，见其 store.js:66-71 makeEntry）：
 *
 *   [id:<12hex>] [YYYY-MM-DD] [branch:dsh-experts] [tag:关键] 【纪律块 v1】
 *   - 红线一：……
 *   - 红线二：……
 *
 *   —— 即"一条标准记忆条目 + 固定正文前缀 + 列表行"。条目之间用 "\n§\n" 分隔；
 *      **不要**用 `## 标题` 作段标记：解析器只认 § 行，标题会被并入相邻条目正文。
 *      `tag=关键` 让 work-memory 永不把它转冷（archive.js:212-213）。
 *
 * 为什么自实现而不 import dsh-work-memory：对方的 package.json exports 不含 lib 子路径，
 * 且耦合对方内部布局会让本模块在未装 work-memory 的环境（CI / 单测）加载失败。
 *
 * @module dsh-experts/discipline
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 纪律条目的固定正文前缀（**格式契约**，改这里等于改记忆里的写法） */
export const DISCIPLINE_MARK = '【纪律块 v1】'

/** 默认读取的项目记忆文件（相对记忆根） */
export const DISCIPLINE_FILE = join('PROJECTS', 'dsh-experts.md')

/** 默认最多注入几条红线（防止记忆里越写越长把上下文顶满） */
export const DISCIPLINE_MAX_LINES = 6

/** 条目分隔符（与 dsh-work-memory 的 ENTRY_DELIMITER 一致） */
const ENTRY_DELIMITER = '\n§\n'

/** 记忆条目头部标记（id / 日期 / branch / tag，顺序固定，可缺省） */
const ENTRY_HEAD = /^(?:\[id:[a-f0-9]+\]\s*)?(?:\[\d{4}-\d{2}-\d{2}\]\s*)?(?:\[branch:[^\]]*\]\s*)?(?:\[tag:[^\]]*\]\s*)?/

/** 剥掉记忆条目头部，得到正文 */
export function entryBody(entry) {
  return String(entry ?? '').replace(ENTRY_HEAD, '').trim()
}

/**
 * 解析记忆文件文本 → 纪律红线列表。
 *
 * **判定必须是「正文以 DISCIPLINE_MARK 开头」**，而不是「正文包含它」：
 * 别的记忆条目很可能在正文里提到「【纪律块 v1】」（例如记录这项机制的决策条目），
 * 若按包含判定就会把那条无关条目的正文当成红线内容（2026-09-14 实测踩到）。
 * 支持多条纪律块条目（按文件顺序合并）。
 *
 * @param {string} text - 记忆文件全文
 * @returns {string[]} 红线列表（无纪律条目时为空数组）
 */
export function parseDiscipline(text) {
  const entries = String(text ?? '')
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
  const out = []
  for (const entry of entries) {
    const body = entryBody(entry)
    if (!body.startsWith(DISCIPLINE_MARK)) continue
    const after = body.slice(DISCIPLINE_MARK.length)
    for (const line of after.split(/\r?\n/)) {
      const item = line.replace(/^\s*[-*•]\s+/, '').trim()
      if (item) out.push(item)
    }
  }
  return out
}

/**
 * 记忆库根目录解析（只读；优先级与 dsh-work-memory 对齐）：
 *   ① 本模块设置项 disciplineMemoryDir（手填最高优先）；
 *   ② ctx.settings.get('work-memory').memoryDir（宿主 settings 服务，未注册 ns 返回 undefined）；
 *   ③ $DSH_HOME/data/dsh-work-memory/memory；
 *   ④ ~/.dsh/data/dsh-work-memory/memory。
 * @param {object} ctx - cordis context
 * @param {object} cfg - 归一化设置
 * @returns {string} 记忆库根目录
 */
export function resolveMemoryRoot(ctx, cfg = {}) {
  const explicit = String(cfg.disciplineMemoryDir || '').trim()
  if (explicit) return explicit
  try {
    const wm = ctx?.settings?.get?.('work-memory')
    const dir = wm && typeof wm === 'object' ? String(wm.memoryDir || '').trim() : ''
    if (dir) return dir
  } catch {
    /* 设置服务不可用 → 继续走环境变量/默认路径 */
  }
  const dshHome = String(process.env.DSH_HOME || '').trim()
  const base = dshHome.length > 0 ? dshHome : join(homedir(), '.dsh')
  // 兜底：真实记忆库未必叫 memory —— 使用者在 work-memory 设置里可以指向任意目录名。
  // 读不到对方设置时，扫 <base>/memories/*（1.0.6 之前的老位置）里**含 PROJECTS 子目录**的目录当候选。
  for (const dir of memoryDirs(base)) return dir
  return join(base, 'data', 'dsh-work-memory', 'memory')
}

/** 扫描记忆根下的候选记忆库（含 PROJECTS 子目录者为真库）；结果缓存 60 秒，避免每轮 readdir */
let dirCache = { base: '', at: 0, dirs: [] }
function memoryDirs(base) {
  if (dirCache.base === base && (Date.now() - dirCache.at) < 60_000) return dirCache.dirs
  const dirs = []
  try {
    const memRoot = join(base, 'memories')
    for (const name of readdirSync(memRoot)) {
      if (name.startsWith('.')) continue
      const dir = join(memRoot, name)
      try {
        if (statSync(join(dir, 'PROJECTS')).isDirectory()) dirs.push(dir)
      } catch {
        /* 不是记忆库，跳过 */
      }
    }
  } catch {
    /* 没有 memories 目录 */
  }
  dirCache = { base, at: Date.now(), dirs }
  return dirs
}

/** 模块级缓存：键 = 绝对路径，值 = { fp, value }（指纹未变不重读；写入是原子替换，mtime 必变） */
const cache = new Map()

/**
 * 只读加载纪律块（按 mtime+size 指纹失效缓存）。
 * @param {object} args - { root, file }
 * @returns {{ status:'ok'|'absent'|'unreadable', lines:string[], file:string, fingerprint:string }}
 *   - ok：读到了纪律条目；
 *   - absent：文件可读但没有纪律条目（**正常的"未配置"状态**，调用方应静默）；
 *   - unreadable：文件不存在 / 读失败（**异常状态**，调用方应明示一行，不静默）。
 */
export function loadDiscipline({ root, file = DISCIPLINE_FILE } = {}) {
  const full = join(String(root || ''), file)
  if (!root) return { status: 'unreadable', lines: [], file: full, fingerprint: '' }
  let st = null
  try {
    st = statSync(full)
  } catch {
    return { status: 'unreadable', lines: [], file: full, fingerprint: '' }
  }
  const fp = String(st.mtimeMs) + ':' + String(st.size)
  const cached = cache.get(full)
  if (cached && cached.fp === fp) return cached.value
  let text = ''
  try {
    text = readFileSync(full, 'utf8')
  } catch {
    return { status: 'unreadable', lines: [], file: full, fingerprint: '' }
  }
  const lines = parseDiscipline(text)
  const value = {
    status: lines.length > 0 ? 'ok' : 'absent',
    lines,
    file: full,
    fingerprint: fp,
  }
  cache.set(full, { fp, value })
  return value
}

/**
 * 渲染纪律块文本（交付层，每轮注入）。
 *   - status ok → 标题 + 逐条红线；
 *   - status unreadable → 明示一行（**不静默**，design-v2 第 8 节）；
 *   - status absent → 空串（未配置纪律属正常状态，不刷屏）。
 * @param {object} result - loadDiscipline() 的返回值
 * @param {object} opts - { maxLines }
 * @returns {string}
 */
export function formatDiscipline(result, { maxLines = DISCIPLINE_MAX_LINES } = {}) {
  if (!result) return ''
  if (result.status === 'absent') return ''
  if (result.status === 'unreadable') {
    return '【交付层·纪律】未加载（项目记忆不可读：' + result.file + '）'
  }
  const lines = result.lines.slice(0, maxLines)
  const more = result.lines.length > lines.length ? '\n· …（还有 ' + (result.lines.length - lines.length) + ' 条，见项目记忆）' : ''
  return '【交付层·纪律】（每轮生效，不随阶段裁剪丢弃）\n'
    + lines.map((l) => '· ' + l).join('\n') + more
}
