/**
 * dsh-experts — 能力层（层 3）：**工具 / 技能专家**（能力轴，与行业域正交）
 *
 * 定位（design-v2 第 7 节 + 使用者 2026-09-14 口径③④）：
 *   - 无论本轮代入哪位 persona，都先去找能力条目 —— **有则带上、无则不带**（不编造）；
 *   - 只注入「**做法指针**」，绝不注入做法原文（原文由 skill 工具按需加载）；
 *   - 独立排序、独立守门：**不占** persona 配额（expertInjectMax），**不受** enabledDomains 收窄；
 *   - 命中按**开放**走（不先保守），靠强信号（技能名 / 关键词）入选 + 字符预算收口。
 *
 * 数据源策略（2026-09-14 调研结论）：
 *   ① **首选宿主 skill 注册表** `ctx.skills.snapshot({ cwd })` —— 它已合并全部 provider、
 *      完成重名裁决、带 Chokidar 热监视与缓存，比本插件自己扫目录更准更省；
 *      但该 API 是 **async**，而 systemPrompt 的 text 回调是同步的 —— 因此这里做
 *      「异步预取 + 同步读缓存」（TTL + cwd 变化触发刷新），首轮可能为空、次轮生效。
 *   ② **兜底** `experts/skills.auto.json`（由 scripts/skill-index.mjs 离线生成、可入库），
 *      用于无宿主运行时的环境（CI / 单测）。
 *
 * @module dsh-experts/capability
 */

import { COST_SKILL_LINE } from './limits.js'

/** 技能名的中文别名与触发关键词（已知技能走表；未知技能回退 name / description） */
export const SKILL_HINTS = {
  'office-word': { label: 'Word 文档处理', when: '读写 docx/doc、红线修订比对、导出 PDF 时', keywords: ['word', 'docx', '文档比对', '红线', '修订', 'wps 文字'] },
  'office-excel': { label: 'Excel 表格处理', when: '表格读写、公式重算、透视、图表、合并、导出时', keywords: ['excel', 'xlsx', 'xls', '表格', '透视', '重算', 'csv'] },
  'office-ppt': { label: 'PPT 演示处理', when: '读写 pptx/dps、套模板、导出 PDF 或逐页出图时', keywords: ['ppt', 'pptx', '幻灯片', '演示文稿', '汇报'] },
  'pdf-tools': { label: 'PDF 处理', when: '提取文本表格、合并拆分选页、页面转图时', keywords: ['pdf', '扫描件', '提取表格', '合并 pdf', '拆分 pdf'] },
  'knowledge-base': { label: '业务知识库', when: '归档资料、全文检索、维护双索引、查法规产品时', keywords: ['知识库', '归档', '检索', '法规查询', '索引'] },
  'web-fetch': { label: '网页抓取', when: '按链接抓取网页正文或检查原始 HTML 时', keywords: ['网页', '抓取', '链接', 'url', 'http'] },
  'workflow-authoring': { label: '多智能体工作流', when: '把大任务拆成多个子代理并行/分阶段执行时', keywords: ['工作流', 'workflow', '多智能体', '并行', '编排'] },
  'skill-management': { label: '技能管理', when: '加载、新建、修改技能或核对 SKILL.md 规范时', keywords: ['技能', 'skill', 'skill.md', '新建技能'] },
  'image-vision': { label: '批量读图（已弃用）', when: '批量脚本化处理本地图片时（日常读图直接用原生图片输入）', keywords: ['读图', 'ocr', '图片识别', '批量图片'] },
  vibe: { label: 'Vibe 编排（VCO）', when: '需要冻结需求、限定执行、强制验证的受治理运行时入口时', keywords: ['vibe', 'vco', '受治理', '冻结需求'] },
}

/** 截断到 max 字符（超长加省略号；指针行必须短，避免吃掉预算） */
export function shorten(text, max = 60) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

/**
 * 宿主 skill summary → 能力条目（对外结构见 design-v2 第 4 节）。
 * @param {object} summary - { name, description, whenToUse?, source, provider, resourceBase? }
 * @returns {object|null}
 */
export function toCapabilityEntry(summary) {
  const name = String(summary?.name || '').trim()
  if (!name) return null
  const hint = SKILL_HINTS[name] || {}
  return {
    id: 'skill:' + name,
    kind: 'skill',
    skill: name,
    name: hint.label || name,
    when_to_use: hint.when || shorten(summary?.description, 60),
    trigger_keywords: Array.isArray(hint.keywords) && hint.keywords.length > 0 ? hint.keywords : [name],
    source: {
      origin: String(summary?.provider || summary?.source || 'skills'),
      path: summary?.resourceBase?.path || '',
    },
  }
}

/**
 * 指针行（约 100 字符；只放"去哪拿"，不放做法原文）。
 * 例：【工具·office-ppt】读写 pptx/dps、套模板、导出 PDF 或逐页出图时 · skill 加载
 */
export function capabilityLine(entry) {
  return '【工具·' + entry.skill + '】' + shorten(entry.when_to_use, 48) + ' · skill 加载'
}

/**
 * 本轮命中的能力（开放命中 + 预算守门）。
 * 只看**强信号**：技能名或关键词出现在任务文本里（不沾岗位先验）。
 * @param {Array} entries - 能力条目
 * @param {string} taskText - 本轮任务文本
 * @param {object} opts - { budgetChars, maxLines }
 * @returns {string[]} 指针行（按命中强度降序，受预算与条数上限约束）
 */
export function routeCapabilities(entries, taskText, { budgetChars = 300, maxLines = 3 } = {}) {
  const text = String(taskText || '').toLowerCase()
  if (!text) return []
  const hits = []
  for (const e of entries || []) {
    if (!e?.skill) continue
    const keys = [e.skill, ...(Array.isArray(e.trigger_keywords) ? e.trigger_keywords : [])]
    const matched = keys.filter((k) => k && text.includes(String(k).toLowerCase()))
    if (matched.length === 0) continue
    hits.push({ entry: e, score: matched.length })
  }
  hits.sort((a, b) => (b.score - a.score) || String(a.entry.skill).localeCompare(String(b.entry.skill)))
  // 成本预判（design-v2 第 6 节「按成本装填」）：先按保守常量估条数上限，再用真实行长度守门
  const byCost = Math.floor(Number(budgetChars) / COST_SKILL_LINE)
  const cap = byCost > 0 ? Math.min(maxLines, byCost) : maxLines
  const out = []
  let used = 0
  for (const h of hits) {
    if (out.length >= cap) break
    const line = capabilityLine(h.entry)
    if (out.length > 0 && used + line.length + 1 > budgetChars) break
    out.push(line)
    used += line.length + 1
  }
  return out
}

/** 能力层成本的粗估（仅用于预算规划，不裁剪渲染文本） */
export function estimateCapabilityCost(lines) {
  return (Array.isArray(lines) ? lines.length : 0) * COST_SKILL_LINE
}

/**
 * 运行时技能源：**异步预取 + 同步读缓存**（TTL + cwd 变化触发刷新）。
 * 这样 systemPrompt 的同步 text 回调也能拿到宿主注册表的数据，且每轮成本≈0。
 * @param {object} opts - { ttlMs }
 * @returns {{ refresh(sctx:object, cwd:string):void, entries():Array, state:object, usingFallback():boolean }}
 */
export function createSkillSource({ ttlMs = 60_000 } = {}) {
  const state = { list: [], complete: true, ready: false, cwd: '', at: 0, error: '' }
  let inflight = false

  function refresh(sctx, cwd) {
    if (!sctx?.skills?.snapshot) return
    const now = Date.now()
    const stale = !state.ready || state.cwd !== (cwd || '') || (now - state.at) > ttlMs
    if (inflight || !stale) return
    inflight = true
    Promise.resolve()
      .then(() => sctx.skills.snapshot({ cwd: cwd || undefined }))
      .then((snap) => {
        const list = Array.isArray(snap?.skills) ? snap.skills : []
        state.list = list.filter((s) => s?.invocation?.modelInvocable !== false)
        state.complete = snap?.complete !== false
        state.ready = true
        state.cwd = cwd || ''
        state.at = Date.now()
        state.error = ''
      })
      .catch((err) => {
        // 不完整/失败的观察不覆盖上一次好结果（宿主契约：incomplete 不缓存）
        state.error = String(err?.message || err)
      })
      .finally(() => {
        inflight = false
      })
  }

  function entries() {
    return state.list.map(toCapabilityEntry).filter(Boolean)
  }

  return { refresh, entries, state, usingFallback: () => !state.ready || state.list.length === 0 }
}
