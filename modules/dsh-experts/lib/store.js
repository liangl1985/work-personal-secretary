/**
 * dsh-experts — 专家索引与 persona 读取（真相源：experts/ 目录）
 *
 * 数据分层（刻意不引入 YAML 解析依赖）：
 *   - `experts/index.json` —— **元数据**：id / 展示名 / 域 / 角色标签 / 何时使用 /
 *     触发关键词 / 正文文件 / 来源与许可（`source`）；
 *   - `experts/<域>/<id>.md` —— **正文**：纯 Markdown（角色 / 工作方法 / 交付与自检），
 *     实测约 1.3–1.8 千字（UTF-8 约 3.3–4.9KB），人可读可改，改完无需重启（每次读取按 mtime 失效缓存）。
 *
 * 与社区 `expert-manifest` 规范的差异：目录形状一致（`experts/<域>/<名>/`），
 * 我们用扁平 `.md` + 集中 `index.json`，避免每个专家一个目录、也避免 frontmatter 解析。
 *
 * @module dsh-experts/store
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 模块根目录 */
export const MODULE_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** 专家数据根目录 */
export const EXPERTS_ROOT = join(MODULE_ROOT, 'experts')

/** 六个域（顺序即设置页/命令输出里的展示顺序） */
export const DOMAINS = [
  { id: 'presales', name: '售前', desc: '方案·投标·客户与需求·工控安全与网络安全售前' },
  { id: 'aftersales', name: '售后·技术支持', desc: '网络安全/工控安全技术支持、等保测评、渗透测试服务' },
  { id: 'finance', name: '会计财务', desc: '会计·税务·出纳·财务分析·内控合规（中国口径）' },
  { id: 'legal', name: '法务', desc: '民法咨询·刑法咨询' },
  { id: 'doc', name: '文档', desc: '文档处理·报告与方案排版·PPT（与 dsh-doc-suite 能力对齐）' },
  { id: 'general', name: '核查·通用', desc: '事实核查与溯源' },
]

/** 域 id → 域定义 */
export function domainById(id) {
  return DOMAINS.find((d) => d.id === id) || null
}

/** 逗号/中文逗号/空白分隔 → 去重数组 */
export function splitList(value) {
  return String(value ?? '')
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

let cache = { at: 0, index: null }

/**
 * 读取专家索引（按 index.json 的 mtime 失效缓存）。
 * @returns {{version:number, experts:Array<object>}}
 */
export function readIndex() {
  const file = join(EXPERTS_ROOT, 'index.json')
  let mtime = 0
  try {
    mtime = statSync(file).mtimeMs
  } catch {
    return { version: 0, experts: [] }
  }
  if (cache.index && cache.at === mtime) return cache.index
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const experts = Array.isArray(parsed?.experts) ? parsed.experts : []
    cache = { at: mtime, index: { version: parsed?.version ?? 1, experts } }
    return cache.index
  } catch {
    return { version: 0, experts: [] }
  }
}

/** 全部专家元数据 */
export function allExperts() {
  return readIndex().experts
}

/** 按 id 取专家元数据（支持简写：省略域前缀时后缀匹配，如 `accountant` → `finance-accountant`） */
export function findExpert(id) {
  const key = String(id ?? '').trim().toLowerCase()
  if (!key) return null
  const list = allExperts()
  return (
    list.find((e) => String(e.id).toLowerCase() === key) ||
    list.find((e) => String(e.id).toLowerCase().endsWith('-' + key)) ||
    null
  )
}

/**
 * 计算「参与自动匹配」的专家集合。
 *
 * 语义（关键，2026-09-12 修正）：
 *   - **默认 = 全部专家参与匹配**；`defaultDomain`（本人岗位）只作**打分先验**加权，
 *     **不充当白名单** —— 否则跨域任务永远命中不了本域之外的专家
 *     （例："客户要做三级等保测评"，会被本域售前专家挡住，而正确答案是等保测评专家）；
 *   - `enabledExperts` 非空 → 显式白名单，只在这些 id 里选（允许跨域）；
 *   - `enabledDomains` 非空 → 收窄到这些域；
 *   - 两者都留空 → 全量参与，靠打分决定注入谁。
 *
 * @param {object} cfg - 归一化后的设置
 * @returns {Array<object>} 参与自动匹配的专家元数据
 */
export function activeExperts(cfg) {
  const list = allExperts()
  const ids = splitList(cfg?.enabledExperts)
  if (ids.length > 0) {
    const want = new Set(ids.map((s) => s.toLowerCase()))
    return list.filter((e) => want.has(String(e.id).toLowerCase()))
  }
  const domains = splitList(cfg?.enabledDomains)
  if (domains.length > 0) {
    const want = new Set(domains.map((s) => s.toLowerCase()))
    return list.filter((e) => want.has(String(e.domain).toLowerCase()))
  }
  return list
}

/**
 * 读取某位专家的 persona 正文。
 * @param {object} entry - index.json 里的专家条目
 * @returns {string} 正文（读取失败返回空串）
 */
export function loadPersona(entry) {
  if (!entry?.file) return ''
  try {
    return readFileSync(join(EXPERTS_ROOT, entry.file), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * 「身份专家」：**常驻注入的唯一一位**，代表使用者的默认身份视角。
 *   - 设置了 `identityExpert` → 用它（找不到就回退到岗位域第一位）；
 *   - 否则取 `defaultDomain`（本人岗位）域的**第一位**；
 *   - 再不行 → 全部专家的第一位。
 *
 * 其余专家不常驻：由「问题归属判断」决定是否补充注入（受 `expertInjectMax` 限制）
 * 或派子代理激活（`expert_recall` 取 persona 内联进 `subagent.prompt`）。
 *
 * @param {object} cfg - 归一化后的设置
 * @returns {object|null} 身份专家条目
 */
export function identityExpertOf(cfg) {
  const list = allExperts()
  if (list.length === 0) return null
  const want = String(cfg?.identityExpert || '').trim()
  if (want) {
    const hit = findExpert(want)
    if (hit) return hit
  }
  const home = String(cfg?.defaultDomain || '').toLowerCase()
  const inHome = list.filter((e) => String(e.domain).toLowerCase() === home)
  return inHome[0] || list[0] || null
}

/** 列出专家（命令输出用）：按域分组 */
export function groupByDomain(list) {
  const out = []
  for (const d of DOMAINS) {
    const items = list.filter((e) => e.domain === d.id)
    if (items.length > 0) out.push({ domain: d, items })
  }
  return out
}
