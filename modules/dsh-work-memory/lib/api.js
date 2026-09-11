/**
 * work-memory — Web GUI API.
 * 记忆可视化管理的后端：列表/详情/编辑/批准/拒绝/归档/图谱。
 * 同源保护（Content-Type JSON + Origin 校验）。
 * @module work-memory/api
 */

import { URL } from 'node:url'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { MemoryStore, parseEntries, stripEntryId, extractEntryId, withDirLock } from './store.js'
import { registerEntry, pruneEntity } from './graph.js'
import { todayStamp, localIso } from './clock.js'
import { memoryFiles, sanitize } from './context.js'
import { listArchive, runArchive } from './archive.js'
import { listBackups, backupMemory, defaultBackupDir } from './backup.js'

const API_ROOT = '/work-memory/api'

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message })
}

async function readBody(req, maxBytes = 128 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
}

/** 同源保护：写操作必须由 Web UI 发起 */
function sameOriginGuard(req) {
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') return '请求必须为 application/json'
  const host = String(req.headers.host ?? '')
  const origin = String(req.headers.origin ?? '')
  if (origin === '') return '缺少 Origin 头'
  try {
    if (new URL(origin).host !== host) return '跨站请求已拒绝'
  } catch {
    return '跨站请求已拒绝'
  }
  return null
}

/**
 * 安装 Web API 路由。
 * @param {object} ctx - cordis context（需 webServer）
 * @param {object} deps - { root, resolveCwd(sessionId), getBranch(sessionId) }
 */
export function installApi(ctx, deps) {
  const { root, resolveCwd, getBranch } = deps

  // 极简访问日志：桌面载体下客户端请求是否真的到达 host，一眼可查（超 256KB 清空，避免轮询刷爆）
  const accessLog = join(root, '.api-access.log')
  const logAccess = (req) => {
    try {
      if (existsSync(accessLog) && statSync(accessLog).size > 256 * 1024) writeFileSync(accessLog, '', 'utf8')
      appendFileSync(accessLog, localIso() + ' ' + String(req.method) + ' ' + String(req.url) + ' host=' + String(req.headers?.host ?? '') + '\n', 'utf8')
    } catch { /* best-effort */ }
  }

  const handler = async (req, res) => {
    logAccess(req)
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const path = url.pathname
      if (!path.startsWith(API_ROOT)) {
        res.writeHead(404); res.end(); return
      }
      const sub = path.slice(API_ROOT.length)

      // GET /overview — 记忆总览（各范围条数 + 待确认数）
      if (req.method === 'GET' && sub === '/overview') {
        const files = memoryFiles(root, { branch: null })
        const count = (p) => existsSync(p) ? parseEntries(readFileSync(p, 'utf8')).length : 0
        const suggestions = existsSync(files.suggestions)
          ? readFileSync(files.suggestions, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).length
          : 0
        const projects = existsSync(join(root, 'PROJECTS')) ? readdirSync(join(root, 'PROJECTS')).filter((f) => f.endsWith('.md')) : []
        const dailies = existsSync(join(root, 'DAILY')) ? readdirSync(join(root, 'DAILY')).filter((f) => f.endsWith('.md')).sort().reverse() : []
        // 项目/日志的「条目总量」：与「文件个数」区分开，面板上两个口径都要能说清
        const countIn = (dir, list) => list.reduce((sum, f) => sum + count(join(dir, f)), 0)
        sendJson(res, 200, {
          ok: true,
          counts: {
            global: count(files.global),
            user: count(files.user),
            daily: count(files.daily),
            projects: projects.length,
            dailies: dailies.length,
            projectEntries: countIn(join(root, 'PROJECTS'), projects),
            dailyEntries: countIn(join(root, 'DAILY'), dailies),
            suggestions,
          },
        })
        return
      }

      // GET /entries?scope=global|user|daily|project&name=xxx
      if (req.method === 'GET' && sub === '/entries') {
        const scope = String(url.searchParams.get('scope') || 'global')
        const name = String(url.searchParams.get('name') || '')
        const files = memoryFiles(root, { branch: null })
        let filePath = null
        if (scope === 'global') filePath = files.global
        else if (scope === 'user') filePath = files.user
        else if (scope === 'daily') filePath = join(root, 'DAILY', sanitize(name) + '.md')
        else if (scope === 'project') filePath = join(root, 'PROJECTS', sanitize(name) + '.md')
        if (!filePath) return sendError(res, 400, '未知 scope')
        const store = new MemoryStore(filePath)
        sendJson(res, 200, { ok: true, scope, name, entries: store.entries() })
        return
      }

      // GET /lists?kind=projects|dailies
      if (req.method === 'GET' && sub === '/lists') {
        const kind = String(url.searchParams.get('kind') || 'projects')
        const dir = join(root, kind === 'dailies' ? 'DAILY' : 'PROJECTS')
        const list = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []
        sendJson(res, 200, { ok: true, kind, list })
        return
      }

      // GET /graph — 关系图谱
      if (req.method === 'GET' && sub === '/graph') {
        const graphPath = memoryFiles(root).graph
        let graph = { entities: [], edges: [] }
        try {
          if (existsSync(graphPath)) graph = JSON.parse(readFileSync(graphPath, 'utf8'))
        } catch { /* fresh */ }
        // 兜底：旧数据只有 edges 时，确保边引用的节点存在于 entities
        if (!Array.isArray(graph.entities)) graph.entities = []
        const idSet = new Set()
        for (const ed of graph.edges || []) {
          if (ed && ed.from) idSet.add(ed.from)
          if (ed && ed.to) idSet.add(ed.to)
        }
        for (const id of idSet) {
          if (!graph.entities.some((x) => x && x.id === id)) graph.entities.push({ id })
        }
        // 补标签：没有 label 的实体去记忆库里按 [id:xxx] 找回条目正文摘要，
        // 这样关系图上的节点就是「能读懂的内容」，而不是一串 id。
        const needLabel = graph.entities.filter((x) => x && x.id && !x.label)
        if (needLabel.length > 0) {
          const files = memoryFiles(root, { branch: null })
          const sources = [files.global, files.user]
          const pushDir = (dir, filter) => {
            try {
              if (!existsSync(dir)) return
              for (const f of readdirSync(dir)) if (filter(f)) sources.push(join(dir, f))
            } catch { /* best-effort */ }
          }
          pushDir(join(root, 'PROJECTS'), (f) => f.endsWith('.md'))
          pushDir(join(root, 'DAILY'), (f) => f.endsWith('.md'))
          const labelOf = new Map()
          for (const file of sources) {
            try {
              if (!file || !existsSync(file)) continue
              for (const line of parseEntries(readFileSync(file, 'utf8'))) {
                const id = extractEntryId(line)
                if (id && !labelOf.has(id)) labelOf.set(id, stripEntryId(line).trim().slice(0, 60))
              }
            } catch { /* best-effort */ }
          }
          for (const node of needLabel) node.label = labelOf.get(node.id) || node.id
        }
        // 标签清洗：历史 label 常带 `[id:..] [日期] [tag:..]` 前缀，截断后节点名全一样；
        // 统一剥掉元信息前缀只留正文摘要（新旧数据都受益）。
        for (const node of graph.entities) {
          if (node && typeof node.label === 'string') {
            const clean = node.label.replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').trim()
            if (clean) node.label = clean
          }
        }
        sendJson(res, 200, { ok: true, graph })
        return
      }

      // GET /backup — 备份列表
      if (req.method === 'GET' && sub === '/backup') {
        sendJson(res, 200, { ok: true, dir: defaultBackupDir(), files: listBackups(root) })
        return
      }

      // GET /archive — 归档区列表（冷存储，可查不注入）
      if (req.method === 'GET' && sub === '/archive') {
        sendJson(res, 200, { ok: true, files: listArchive(root) })
        return
      }

      // GET /suggestions — 待确认队列
      if (req.method === 'GET' && sub === '/suggestions') {
        const file = memoryFiles(root).suggestions
        const rows = existsSync(file)
          ? readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
          : []
        sendJson(res, 200, { ok: true, entries: rows })
        return
      }

      // ---- 写操作（同源保护） ----
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        const guard = sameOriginGuard(req)
        if (guard) return sendError(res, 403, guard)
      }

      // POST /backup/run — 手动执行备份
      if (req.method === 'POST' && sub === '/backup/run') {
        try {
          const result = backupMemory(root, {})
          return sendJson(res, 200, { ok: true, result })
        } catch (err) {
          return sendError(res, 500, String(err?.message || err))
        }
      }

      // POST /archive/run — 手动执行归档
      if (req.method === 'POST' && sub === '/archive/run') {
        try {
          const result = runArchive(root, {})
          return sendJson(res, 200, { ok: true, result })
        } catch (err) {
          return sendError(res, 500, String(err?.message || err))
        }
      }

      // POST /write { scope, name, action: add|remove, content|match }
      if (req.method === 'POST' && sub === '/write') {
        const body = await readBody(req)
        const { scope, name, action } = body
        const files = memoryFiles(root)
        let filePath = null
        if (scope === 'global') filePath = files.global
        else if (scope === 'user') filePath = files.user
        else if (scope === 'daily') filePath = join(root, 'DAILY', sanitize(name || todayStamp()) + '.md')
        else if (scope === 'project') filePath = join(root, 'PROJECTS', sanitize(name) + '.md')
        if (!filePath) return sendError(res, 400, '未知 scope')

        const result = withDirLock(root, () => {
          const store = new MemoryStore(filePath)
          store.ensure()
          if (action === 'add') {
            const entry = String(body.content || '').trim()
            if (!entry) return { ok: false, error: 'content 不能为空' }
            store.add(entry)
            // 图谱登记：面板写入的条目也要立刻进图谱（与 memory_remember 一致）
            registerEntry(root, store.entries().slice(-1)[0] || entry)
            return { ok: true }
          }
          if (action === 'remove') {
            const match = String(body.match || '').trim()
            if (!match) return { ok: false, error: 'match 不能为空' }
            const removedId = extractEntryId(match)
            const r = store.remove(match)
            if (r && r.ok && removedId) pruneEntity(root, removedId)
            return r
          }
          return { ok: false, error: '未知 action' }
        })
        if (result.ok) return sendJson(res, 200, { ok: true })
        return sendError(res, 400, result.error || '操作失败')
      }

      // POST /suggestions/approve { index } /reject { index }
      if (req.method === 'POST' && (sub === '/suggestions/approve' || sub === '/suggestions/reject')) {
        const body = await readBody(req)
        const index = Number(body.index)
        const file = memoryFiles(root).suggestions
        const approve = sub.endsWith('/approve')
        const result = withDirLock(root, () => {
          if (!existsSync(file)) return { ok: false, error: '队列为空' }
          const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0)
          if (index < 0 || index >= lines.length) return { ok: false, error: '索引越界' }
          const row = lines[index]
          let parsed = null
          try { parsed = JSON.parse(row) } catch { /* skip */ }
          lines.splice(index, 1)
          writeFileSync(file, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8')
          if (approve && parsed) {
            // 按建议自身的 scope 落地（此前 project 掉进 else 被错写进 DAILY）：
            //   global→MEMORY.md、user→USER.md、project→PROJECTS/<branch>.md、daily→DAILY/<条目日期>.md
            const { scope, content, branch } = parsed
            const text = String(content || '')
            const dayMatch = /\[(\d{4}-\d{2}-\d{2})\]/.exec(text)
            const day = dayMatch ? dayMatch[1] : todayStamp()
            const files = memoryFiles(root)
            let target = null
            if (scope === 'global') target = files.global
            else if (scope === 'user') target = files.user
            else if (scope === 'project') target = join(root, 'PROJECTS', sanitize(branch || '未分类') + '.md')
            else target = join(root, 'DAILY', sanitize(day) + '.md')
            if (target) {
              const store = new MemoryStore(target)
              store.ensure()
              store.add(text)
              // 批准落盘的条目同样登记图谱节点
              registerEntry(root, store.entries().slice(-1)[0] || text)
            }
            return { ok: true, written: target }
          }
          return { ok: true }
        })
        if (result.ok) return sendJson(res, 200, { ok: true })
        return sendError(res, 400, result.error || '处理失败')
      }

      // POST /project { action: 'create' | 'archive', name }
      //   创建新的项目分类（PROJECTS/<name>.md）；
      //   归档某项目分类 = 整文件移入 ARCHIVE/project-<name>-<日期>.md（**不物理删除**，可恢复）
      if (req.method === 'POST' && sub === '/project') {
        const body = await readBody(req)
        const action = String(body.action || '').trim()
        const name = sanitize(String(body.name || '').trim())
        if (!name || name === 'default') return sendError(res, 400, '项目名不能为空')
        const projDir = join(root, 'PROJECTS')
        const target = join(projDir, name + '.md')
        if (action === 'create') {
          if (existsSync(target)) return sendError(res, 400, '项目已存在：' + name)
          mkdirSync(projDir, { recursive: true })
          new MemoryStore(target).ensure()
          return sendJson(res, 200, { ok: true, created: name })
        }
        if (action === 'archive') {
          if (!existsSync(target)) return sendError(res, 400, '项目不存在：' + name)
          const archDir = join(root, 'ARCHIVE')
          mkdirSync(archDir, { recursive: true })
          const stamp = todayStamp()
          const dest = join(archDir, 'project-' + name + '-' + stamp + '.md')
          renameSync(target, dest)
          return sendJson(res, 200, { ok: true, archived: name, file: dest })
        }
        return sendError(res, 400, '未知 action（可用 create / archive）')
      }

      sendError(res, 404, 'not found')
    } catch (err) {
      sendError(res, 500, String(err?.message || err))
    }
  }

  // 同时注册 prefix 与 exact 两类路由：
  //   - prefix：浏览器载体（web profile）走普通 HTTP 路由，前缀匹配足够；
  //   - exact ：桌面载体（Electron / file://）的 fetch 桥只认**精确路由**，
  //             所以把每个具体路径也注册一遍，两种载体都能取到数据。
  const disposers = [ctx.webServer.register({ kind: 'prefix', path: API_ROOT, handler })]
  const EXACT_PATHS = [
    '/overview', '/entries', '/lists', '/graph', '/backup', '/archive', '/suggestions',
    '/backup/run', '/archive/run', '/write', '/project', '/suggestions/approve', '/suggestions/reject',
  ]
  for (const p of EXACT_PATHS) {
    try {
      disposers.push(ctx.webServer.register({ kind: 'exact', path: API_ROOT + p, handler }))
    } catch (err) {
      ctx.logger?.warn?.('work-memory: 精确路由注册失败 ' + p + '：' + (err?.message || err))
    }
  }
  return () => {
    for (const d of disposers) {
      try { d() } catch { /* best-effort */ }
    }
  }
}
