/**
 * work-memory — model tools: remember / recall / link.
 * 认知词汇原语（借鉴 Mnemon）：记 / 召回 / 关联。
 * 按官方规范使用 defineTool()：parameters DSL + execute(args, exec) + output。
 * @module work-memory/tools
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MemoryStore, makeEntry, withDirLock, genEntryId, extractEntryId, stripEntryId } from './store.js'
import { join } from 'node:path'
import { memoryFiles, sanitize } from './context.js'
import { resolveWriteScope, SCOPE_CRITERIA } from './scope.js'
import { registerEntry, linkEntries } from './graph.js'
import { runArchive, archiveEntries, promoteEntry } from './archive.js'
import { backupMemory, syncMemoryToObsidian } from './backup.js'
import { touchAccess } from './access.js'

/**
 * 创建三个工具定义（供 ctx.tools.register 使用）。
 * @param {object} deps - { root, getBranch(session), onSuggestion }
 * @returns {object[]} tool definitions
 */
export function createTools(deps) {
  const { root, getBranch, onSuggestion, archiveCfg, backupCfg, obsidianSyncDir } = deps

  /** 判断调用方是否为子代理（SessionHeader.origin/delegationDepth） */
  function isSubagentExec(exec) {
    try {
      const h = exec?.agent?.session?.header
      if (!h) return false
      return h.origin === 'subagent' || (h.delegationDepth ?? 0) > 0
    } catch {
      return false
    }
  }

  /** 写库后懒触发归档检查（防抖每天一次，失败不影响写入） */
  function maybeArchive() {
    if (!archiveCfg || archiveCfg.enabled === false) return
    try {
      runArchive(root, archiveCfg)
    } catch { /* best-effort */ }
  }

  /** 写库后懒触发备份（防抖每天一次，失败不影响写入） */
  function maybeBackup() {
    if (!backupCfg || backupCfg.enabled === false) return
    try {
      backupMemory(root, backupCfg)
    } catch { /* best-effort */ }
  }

  /** 写库后同步记忆到 Obsidian 镜像区（迁移恢复用，失败不影响写入） */
  function maybeSync() {
    if (!obsidianSyncDir) return
    try {
      syncMemoryToObsidian(root, obsidianSyncDir)
    } catch { /* best-effort */ }
  }

  function sessionBranch(session) {
    try {
      const b = getBranch ? getBranch(session) : null
      return b || null
    } catch {
      return null
    }
  }

  /** 待确认队列中是否已有相同内容（SUGGESTIONS.jsonl 逐行解析） */
  function suggestionQueueHas(files, content) {
    try {
      if (!existsSync(files.suggestions)) return false
      const rows = readFileSync(files.suggestions, 'utf8').split('\n').filter((l) => l.trim().startsWith('{'))
      for (const row of rows) {
        try {
          const j = JSON.parse(row)
          if (String(j.content || '').includes(content)) return true
        } catch { /* skip bad line */ }
      }
    } catch { /* best-effort */ }
    return false
  }

  function handleRemember(args, execInfo = {}) {
    const content = String(args.content || '').trim()
    if (!content) return { ok: false, error: 'content 不能为空' }
    const tag = args.tag || '常规'

    // ---- 分类护栏（2026-09-11 使用者批准）----
    // 决策收在 lib/scope.js（纯函数、可单测）：auto 有分支→project/无分支→daily；
    // project 无分支直接报错，**不再静默写进全局**；global/user 必须显式指定。
    const target = resolveWriteScope({
      requested: args.scope,
      explicitBranch: args.branch,
      sessionBranch: sessionBranch(execInfo.session),
    })
    if (target.error) return { ok: false, error: target.error }
    const scope = target.scope
    const branch = target.branch

    // 子代理门控：global/user 是使用者级记忆，只允许主代理直接写入
    if (execInfo.subagent && (scope === 'global' || scope === 'user')) {
      return { ok: false, error: '子代理不可直接写入全局/用户记忆，请由主代理（主对话）写入' }
    }

    const files = memoryFiles(root, { branch })
    const filePath = scope === 'global' ? files.global
      : scope === 'user' ? files.user
      : scope === 'daily' ? files.daily
      : files.project

    const entry = makeEntry(content, { branch: scope === 'project' ? branch : null, tag })

    const result = withDirLock(root, () => {
      const store = new MemoryStore(filePath)
      store.ensure()
      // 入库去重：正文（元数据前缀之后的部分）相同即视为重复，不重复写入
      const dup = store.entries().find((e) => stripEntryId(e).endsWith(content))
      if (dup) {
        return { ok: true, duplicate: true, message: '已有相同内容的记忆条目，未重复写入' }
      }
      if (tag === '关键' && onSuggestion) {
        if (suggestionQueueHas(files, content)) {
          return { ok: true, queued: true, duplicate: true, message: '该内容已在待确认队列中，未重复提交' }
        }
        onSuggestion({ content: entry, scope, branch: scope === 'project' ? branch : null, source: 'memory_remember' })
        return { ok: true, queued: true, message: '已进入待确认队列，等待使用者批准' }
      }
      store.add(entry)
      // 图谱登记（2026-09-11 使用者要求）：记忆落盘时就登记节点，
      // 不再只在 memory_link 时才出现——否则各范围图谱是空的
      registerEntry(root, entry)
      return { ok: true, file: filePath, tag }
    })
    // 懒任务放在**锁外**：它们内部各自取锁（归档 / 备份 / Obsidian 同步），
    // 放在锁内会与文件锁自身冲突（同进程重复抢锁 → 自旋超时 → 静默失败）
    if (result.ok) {
      maybeArchive()
      maybeBackup()
      maybeSync()
    }
    return result
  }

  function handleRecall(args) {
    const query = String(args.query || '').trim().toLowerCase()
    const scope = args.scope || 'all'
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20)
    const branch = args.branch || null
    const files = memoryFiles(root, { branch })

    // 归档范围：查 ARCHIVE（冷数据，默认不注入）；**命中即转热**（2026-09-11 定）：
    // 把命中的条目按原 id、原文写回它原来所属的范围，从冷区移出。
    if (scope === 'archive') {
      const pool = archiveEntries(root, Math.max(limit * 4, 40))
        .filter((c) => !query || c.entry.toLowerCase().includes(query))
        .slice(0, limit)
      const promoted = []
      for (const c of pool) {
        if (!c.id) continue
        try {
          const r = promoteEntry(root, c.id)
          if (r && r.ok) promoted.push({ scope: r.scope, entry: r.entry, to: r.file })
        } catch { /* best-effort */ }
      }
      if (promoted.length > 0) {
        touchAccess(root, promoted.map((p) => extractEntryId(p.entry)))
        maybeSync()
      }
      return {
        ok: true,
        count: promoted.length,
        total: pool.length,
        promoted: promoted.length,
        message: promoted.length > 0 ? '已转热 ' + promoted.length + ' 条（写回原范围）' : '归档中无命中',
        results: promoted.map((c) => ({ scope: 'archive→' + c.scope, entry: c.entry })),
      }
    }

    // project 范围：遍历 PROJECTS/ 全部文件（不依赖 branch 参数，避免漏查）
    const projectFiles = () => {
      const dir = join(root, 'PROJECTS')
      if (!existsSync(dir)) return []
      return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ['project/' + f, join(dir, f)])
    }
    const candidates = []
    const scopes = scope === 'all'
      ? [['global', files.global], ['user', files.user], ['daily', files.daily], ...projectFiles()]
      : scope === 'project'
        ? projectFiles()
        : [[scope, scope === 'global' ? files.global : scope === 'user' ? files.user : scope === 'daily' ? files.daily : files.project]]

    for (const [name, path] of scopes) {
      if (!path) continue
      const store = new MemoryStore(path)
      for (const entry of store.entries()) {
        if (!query || entry.toLowerCase().includes(query)) {
          candidates.push({ scope: name, entry })
        }
      }
    }

    const rank = { '关键': 0, '常规': 1, '临时': 2, '敏感': 3 }
    candidates.sort((a, b) => {
      const ta = (a.entry.match(/\[tag:([^\]]+)\]/) || [])[1] || '常规'
      const tb = (b.entry.match(/\[tag:([^\]]+)\]/) || [])[1] || '常规'
      const r = (rank[ta] ?? 1) - (rank[tb] ?? 1)
      if (r !== 0) return r
      return b.entry.localeCompare(a.entry)
    })

    const top = candidates.slice(0, limit)
    // 「被用到才算热」：命中即刷新访问时间，归档判定据此顺延（常用旧记忆不会被归档）
    touchAccess(root, top.map((c) => extractEntryId(c.entry)))
    return {
      ok: true,
      count: top.length,
      total: candidates.length,
      results: top.map((c) => ({ scope: c.scope, entry: c.entry })),
    }
  }

  function handleLink(args) {
    const from = String(args.from || '').trim()
    const to = String(args.to || '').trim()
    const relation = String(args.relation || '相关').trim()
    if (!from || !to) return { ok: false, error: 'from/to 不能为空' }
    const branch = args.branch || null
    const files = memoryFiles(root, { branch })

    return withDirLock(root, () => {
      const fromMatch = findEntry(files, from)
      const toMatch = findEntry(files, to)
      if (!fromMatch || !toMatch) {
        return { ok: false, error: '未找到匹配条目（from/to 需为条目中的唯一片段）' }
      }
      // 建边（并把两端节点登记进图谱）——统一走 lib/graph.js
      const edge = linkEntries(root, {
        from: { id: fromMatch.id, label: fromMatch.label || fromMatch.id },
        to: { id: toMatch.id, label: toMatch.label || toMatch.id },
        relation,
      })
      maybeSync()
      return { ok: true, edge }
    })
  }

  function findEntry(files, fragment) {
    const Store = MemoryStore
    for (const path of [files.global, files.user, files.project, files.daily]) {
      if (!path) continue
      const store = new Store(path)
      const found = store.entries().find((e) => e.includes(fragment))
      if (found) {
        const id = extractEntryId(found) || genEntryId()
        // 图谱节点名 = 正文摘要：剥掉 [id:..] [日期] [branch:..] [tag:..] 元信息前缀，
        // 否则截断后每个节点看起来都一样
        const label = stripEntryId(found).replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').trim().slice(0, 60) || id
        return { id, label }
      }
    }
    return null
  }

  return [
    defineTool({
      name: 'memory_remember',
      description:
        '记录一条长期记忆。内容进入记忆库：tag=关键 的条目会进入待确认队列等待使用者批准；tag=常规 直接写入。内容重复（与已存条目或待确认队列相同）时不会重复写入。子代理（subagent）不能直接写入 global/user 范围。'
        + '\n【分类判据·必须遵守，2026-09-11 定】' + SCOPE_CRITERIA
        + '\n判据口诀：**"换个项目还成立吗？"** 成立→global/user；不成立→project（带 branch）。'
        + ' 项目类记忆写进全局是最常见的误分类，务必避免；scope 省略时按 auto 处理（有项目分支→project，否则→daily）。',
      parameters: {
        content: { type: 'string', required: true, description: '记忆内容（一句话，具体明确）' },
        tag: { type: 'string', enum: ['关键', '常规', '临时', '敏感'], description: '重要性标签，默认 常规' },
        scope: { type: 'string', enum: ['auto', 'global', 'user', 'project', 'daily'], description: '写入范围，默认 auto：有项目分支→project，无分支→daily。global 仅限跨模块根本内容（身份/性格/红线/长期约定）；user=使用者画像与偏好；project=某项目/插件/任务相关（默认落点）；daily=当天流水。global/user 必须显式指定。' },
        branch: { type: 'string', description: '项目名（scope=project 时使用；省略则从会话工作目录推断，推断不出会报错而不会写进全局）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            queued: { type: 'boolean' },
            duplicate: { type: 'boolean' },
            message: { type: 'string' },
            file: { type: 'string' },
            tag: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        return handleRemember(args, { subagent: isSubagentExec(exec), session: exec?.agent?.session })
      },
    }),

    defineTool({
      name: 'memory_recall',
      description:
        '召回相关记忆。按关键词在全局记忆/用户偏好/项目记忆/今日日志/归档中检索，返回匹配条目。用于跨会话延续上下文、查历史决策、找用户偏好。',
      parameters: {
        query: { type: 'string', required: true, description: '检索关键词或主题' },
        scope: { type: 'string', enum: ['all', 'global', 'user', 'project', 'daily', 'archive'], description: '检索范围，默认 all（archive=冷归档）' },
        limit: { type: 'number', description: '返回条数上限，默认 5' },
        branch: { type: 'string', description: '项目分支/项目名（可选）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            count: { type: 'integer' },
            total: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  scope: { type: 'string' },
                  entry: { type: 'string' },
                },
              },
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return handleRecall(args)
      },
    }),

    defineTool({
      name: 'memory_link',
      description:
        '在两条记忆条目之间建立关联（写入 GRAPH.json）。用于表达"这件事和那件事有关"。',
      parameters: {
        from: { type: 'string', required: true, description: '源条目文本片段（唯一子串）' },
        to: { type: 'string', required: true, description: '目标条目文本片段（唯一子串）' },
        relation: { type: 'string', description: '关系描述，如"依赖""参考""冲突""同类"', default: '相关' },
        branch: { type: 'string', description: '项目分支/项目名（可选）' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            edge: {
              type: 'object',
              additionalProperties: false,
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                relation: { type: 'string' },
              },
            },
            error: { type: 'string' },
          },
        },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        return handleLink(args)
      },
    }),
  ]
}
