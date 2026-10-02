/**
 * work-personal-secretary —— 岗位信息卡（一张卡一个文件）
 *
 * 设计（使用者 2026-10-02 定稿）：
 *   · 下拉里的岗位**统一来自"岗位信息卡"**；
 *   · **预置 5 张**来自源码常量（lib/domain.js 的 DOMAIN_PRESETS，随插件发布、只读、不可改）；
 *   · **新建的岗位 = 独立的卡片文件**，一张卡一个文件，放在**配置文件指向的目录**里
 *     （插件配置 domainsDir；默认 <DSH_HOME>/data/work-personal-secretary/domains）；
 *   · 新建 = **用程序创建一张新卡片**（写文件）+ 配置文件指向该目录 → **目录里有几张卡就显示几个岗位**；
 *   · 建出来的就是**普通岗位**，不再叫"自定义"（使用者 2026-10-02 明确）。
 *
 * 卡片文件格式（*.json，UTF-8 无 BOM）：
 *   { "id":"card:工控信息安全售前", "name":"工控信息安全售前",
 *     "label":"工控信息安全售前", "content":"…", "updatedAt":"2026-10-02T21:50:00+08:00" }
 *
 * 安全与一致性：
 *   · 文件名由 id 派生并做**白名单化**（只留中英文、数字、下划线、点、连字符），解析后必须仍在目录内 —— 防路径穿越；
 *   · 写入用**临时文件 + rename 原子替换**，避免半个文件；
 *   · 名称与正文按 lib/domain.js 的上限截断（10 / 200 字），与预置口径一致；
 *   · 读目录时**容错**：单个坏文件跳过并计入 invalid，不影响其他卡片。
 *
 * @module work-personal-secretary/domainCards
 */
import { join, resolve, relative, isAbsolute, basename } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { DOMAIN_MAX_CHARS, DOMAIN_NAME_MAX_CHARS, normalizeDomainText } from './domain.js'

/** 卡片文件后缀 */
export const CARD_SUFFIX = '.json'
/** 卡片 id 前缀：与预置 id（infosec 等）区分；不再使用 custom: 字样 */
export const CARD_ID_PREFIX = 'card:'
/** 默认卡片目录（相对 DSH_HOME）——配置里 domainsDir 留空时用它 */
export const DEFAULT_DOMAINS_SUBDIR = join('data', 'work-personal-secretary', 'domains')
/** 单目录卡片数上限（防御：目录被塞爆时不至于拖垮配置页） */
export const MAX_CARDS = 200

/** 名称 → 卡片 id */
export function cardIdFor(name) {
  const n = String(name == null ? '' : name).trim()
  return n ? CARD_ID_PREFIX + n : ''
}

/** id → 卡片文件名（白名单化；空则返回空串） */
export function cardFileName(id) {
  const raw = String(id == null ? '' : id).trim()
  if (!raw) return ''
  // 去掉前缀后，只保留安全字符；中文允许（Windows/macOS 均支持 UTF-8 文件名）
  const body = raw.slice(raw.indexOf(':') >= 0 ? raw.indexOf(':') + 1 : 0)
  const safe = body.replace(/[^0-9A-Za-z\u4e00-\u9fa5._-]/g, '_').replace(/^\.+/, '_').slice(0, 80)
  return safe ? safe + CARD_SUFFIX : ''
}

/** 卡片文件绝对路径（越界返回空串） */
export function cardPath(dir, id) {
  const base = String(dir == null ? '' : dir).trim()
  const name = cardFileName(id)
  if (!base || !name) return ''
  const root = resolve(base)
  const full = resolve(join(root, name))
  // 必须仍在目录内（防 ".." 与绝对路径注入）
  const rel = relative(root, full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return ''
  return full
}

/** 把任意对象归一化成卡片（非法则返回 null） */
export function normalizeCard(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id == null ? '' : raw.id).trim()
  const name = String(raw.name == null ? '' : raw.name).trim().slice(0, DOMAIN_NAME_MAX_CHARS)
  const content = normalizeDomainText(raw.content == null ? '' : raw.content, DOMAIN_MAX_CHARS)
  if (!id || !name) return null
  return {
    id: id,
    name: name,
    // 建出来的就是普通岗位：label 与 name 一致，不再加"（自定义）"后缀
    label: String(raw.label == null ? '' : raw.label).trim() || name,
    content: content,
    updatedAt: String(raw.updatedAt == null ? '' : raw.updatedAt).trim() || String(now || ''),
  }
}

/** 读取目录里的全部卡片；返回 { cards:[], invalid:[文件名], dir } */
export function listCards(dir, io) {
  const f = io || {}
  const base = String(dir == null ? '' : dir).trim()
  const out = { cards: [], invalid: [], dir: base, exists: false }
  if (!base) return out
  try {
    if (typeof f.existsSync === 'function') { if (!f.existsSync(base)) return out } else if (!existsSync(base)) return out
    out.exists = true
    const names = (typeof f.readdirSync === 'function' ? f.readdirSync(base) : readdirSync(base)) || []
    for (const n of names) {
      const name = String(n)
      if (name.slice(-CARD_SUFFIX.length) !== CARD_SUFFIX) continue
      if (out.cards.length >= MAX_CARDS) break
      try {
        const text = (typeof f.readFileSync === 'function' ? f.readFileSync(join(base, name), 'utf8') : readFileSync(join(base, name), 'utf8'))
        const card = normalizeCard(JSON.parse(String(text).replace(/^\uFEFF/, '')), '')
        if (card) out.cards.push(card); else out.invalid.push(name)
      } catch { out.invalid.push(name) }
    }
  } catch { /* 目录不可读 → 当没有卡片，不抛 */ }
  out.cards.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
  return out
}

/** 原子写一张卡片；返回 { ok, path, error } */
export function writeCard(dir, card, io, now) {
  const f = io || {}
  const base = String(dir == null ? '' : dir).trim()
  if (!base) return { ok: false, path: '', error: '卡片目录未配置' }
  const norm = normalizeCard(card, now)
  if (!norm) return { ok: false, path: '', error: '卡片内容不合法（需要 id 与名称）' }
  const full = cardPath(base, norm.id)
  if (!full) return { ok: false, path: '', error: '卡片文件名不合法（已拒绝，防路径穿越）' }
  const tmp = full + '.tmp'
  let text = JSON.stringify(norm, null, 2) + '\n'
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  try {
    if (typeof f.mkdirSync === 'function') f.mkdirSync(base, { recursive: true }); else mkdirSync(base, { recursive: true })
    if (typeof f.writeFileSync === 'function') f.writeFileSync(tmp, text, 'utf8'); else writeFileSync(tmp, text, 'utf8')
    if (typeof f.renameSync === 'function') f.renameSync(tmp, full); else renameSync(tmp, full)
    return { ok: true, path: full, error: '' }
  } catch (err) {
    try { if (typeof f.unlinkSync === 'function') f.unlinkSync(tmp); else unlinkSync(tmp) } catch { /* 清理失败无妨 */ }
    return { ok: false, path: full, error: String((err && err.message) || err) }
  }
}

/** 删除一张卡片；返回 { ok, removed, error } */
export function deleteCard(dir, id, io) {
  const f = io || {}
  const full = cardPath(dir, id)
  if (!full) return { ok: false, removed: false, error: '卡片文件名不合法' }
  try {
    if (typeof f.existsSync === 'function' ? !f.existsSync(full) : !existsSync(full)) return { ok: true, removed: false, error: '' }
    if (typeof f.unlinkSync === 'function') f.unlinkSync(full); else unlinkSync(full)
    return { ok: true, removed: true, error: '' }
  } catch (err) { return { ok: false, removed: false, error: String((err && err.message) || err) } }
}

/** 卡片 → 公开形状（与 /domain/list 的 items 一致：id/label/content） */
export function cardToItem(card) {
  return { id: String(card.id || ''), label: String(card.label || card.name || ''), content: String(card.content || '') }
}
export { basename }
