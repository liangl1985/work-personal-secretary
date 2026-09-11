/**
 * lina-memory —— 记忆插件 · Web 客户端半（DSH 0.1.5-rc.1 原生架构）
 *
 * 0.2.0 的 UI 是「conversation.view 列表槽 + 手写 fetch + useState 轮询」，
 * 属于 0.1.2 时代的写法。0.3.0 起改为官方原生扩展点：
 *
 *   1. 数据层  ctx.resources.register({ protocol, open })  → 组件用 useResource(address) 读活数据
 *   2. 状态层  defineStore({ init, persist, actions })      → 挂在 sidebar tab 的 store 席位上
 *   3. 面板位  ctx.sidebarRightTabs.register(...) + sidebar.right.pane.tab 正文槽（原生右侧停靠面）
 *   4. 入口    tab 类型的 guide 入口框 → ctx.sidebarRight.openTab(kind)
 *   5. 配置    host 侧 settings 命名空间 → 设置页「插件」分区自动生成配置卡片
 *
 * 记忆数据的真相源仍是 host 侧的纯 Markdown 库（记忆库目录）；
 * host 只通过 /lina-memory/api 路由提供读写，客户端不再拼接裸 URL。
 */

window.__ModuleLoader__.load({
  id: 'dsh-lina-memory',
  factory: (require) => {
    const React = require('react')
    const { defineStore } = require('@deepseek-ai/dsh-client-store')
    const h = React.createElement

    const NS = 'lina-memory'
    const PROTOCOL = 'lina-memory'
    const API = '/lina-memory/api'
    const TAB_ID = 'lina-memory'
    const TAB_KIND = 'lina-memory'
    const POLL_MS = 5000
    /** 构建标记：面板页脚可见，用来确认渲染进程跑的到底是哪一版 bundle */
    const BUILD = 'v1.0.2'

    /**
     * host 路由的基址。
     * 浏览器载体下页面 origin 是真的 http origin；桌面外壳用 file:// 加载 dist，
     * `location.origin` 返回字符串 "null"，此时必须回退到合成 origin
     * `http://dsh.internal`（外壳的 fetch 桥会把它转发给 host）——这是一方
     * `@deepseek-ai/dsh-client-file-upload` 的既有做法；裸相对路径在桌面载体下取不到数据。
     */
    const HOST_BASE = (() => {
      try {
        const origin = typeof window !== 'undefined' && window.location ? window.location.origin : undefined
        if (origin === undefined || origin === '' || origin === 'null') return 'http://dsh.internal'
        return origin
      } catch {
        return 'http://dsh.internal'
      }
    })()

    /** 剥掉条目行/标签里的 `[id:..] [日期] [branch:..] [tag:..]` 元信息前缀 */
    function cleanLabel(value) {
      return String(value ?? '').replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').trim()
    }

    function hostUrl(path, query) {
      const qs = query ? '?' + new URLSearchParams(query).toString() : ''
      return new URL(API + path + qs, HOST_BASE).toString()
    }

    /**
     * 条目解析：host 的 /entries 返回的是**原始行字符串数组**
     * （形如 `[id:xxxx] [2026-09-11] [branch:DSH插件] [tag:关键] 正文`），
     * 不是对象——所以这里把元信息拆出来，正文与原文分开用。
     */
    function parseEntry(value) {
      if (value && typeof value === 'object') {
        return { id: value.id, date: value.date, branch: value.branch, tag: value.tag, content: value.content ?? '', raw: value.raw ?? String(value.content ?? '') }
      }
      const text = String(value ?? '')
      const pick = (re) => { const m = re.exec(text); return m ? m[1] : undefined }
      return {
        id: pick(/\[id:([^\]]+)\]/),
        date: pick(/\[(\d{4}-\d{2}-\d{2})\]/),
        branch: pick(/\[branch:([^\]]+)\]/),
        tag: pick(/\[tag:([^\]]+)\]/),
        content: text.replace(/^(?:\s*\[[^\]]*\]\s*)+/, '').trim() || text,
        raw: text,
      }
    }

    // ---------------------------------------------------------------- i18n
    const ZH = {
      'tab.title': '记忆',
      'guide.title': '记忆库',
      'guide.description': '执行层记忆：统计 · 条目 · 待确认 · 关系',
      'panel.title': '记忆库',
      'panel.loading': '读取中…',
      'panel.search': '检索条目…',
      'panel.archive': '冷归档（不注入，可查）',
      'stat.global': '全局(条)',
      'stat.user': '偏好(条)',
      'stat.project': '项目(条)',
      'stat.review': '待确认',
      'pick.project': '选择项目',
      'pick.daily': '选择日期',
      'pick.unit': '条',
      'project.newPlaceholder': '新项目分类名（如 客户A项目）',
      'project.create': '新建',
      'project.created': '已新建项目',
      'project.archive': '归档此项目',
      'project.archiveConfirm': '确认归档？',
      'project.archived': '已归档',
      'panel.empty': '暂无内容',
      'panel.entries': '条目',
      'panel.suggestions': '待确认',
      'panel.graph': '图谱',
      'panel.relations': '关联',
      'relations.hint': '明细见各条目的「相关」',
      'entry.related': '相关',
      'entry.noRelated': '本条暂无关联（可用 memory_link 建立）',
      'graph.nodes': '节点',
      'graph.edges': '关系',
      'graph.empty': '本范围暂无关联记忆（用 memory_link 关联两条即可出现关系）',
      'graph.scopeCount': '本范围共',
      'panel.write': '写入',
      'panel.placeholder': '写入新记忆条目…',
      'panel.approve': '批准',
      'panel.reject': '拒绝',
      'panel.remove': '删除',
      'panel.footer': 'lina-memory · 本地 Markdown 记忆库',
      'panel.failed': '读取失败',
      'panel.none': '资源通道未就绪（无提供方）',
      'panel.admin': '配置请在 设置 → 插件 中调整',
    }
    const EN = {
      'tab.title': 'Memory',
      'guide.title': 'Memory',
      'guide.description': 'Execution-layer memory: stats, entries, review queue, relations',
      'panel.title': 'Memory',
      'panel.loading': 'Loading…',
      'panel.search': 'Search entries…',
      'panel.archive': 'Cold archive (not injected)',
      'stat.global': 'Global',
      'stat.user': 'Prefs',
      'stat.project': 'Projects',
      'stat.review': 'Review',
      'pick.project': 'Pick project',
      'pick.daily': 'Pick date',
      'pick.unit': 'entries',
      'project.newPlaceholder': 'New project category name',
      'project.create': 'Create',
      'project.created': 'Project created',
      'project.archive': 'Archive project',
      'project.archiveConfirm': 'Confirm archive?',
      'project.archived': 'Archived',
      'panel.empty': 'Nothing here yet',
      'panel.entries': 'Entries',
      'panel.suggestions': 'Review',
      'panel.graph': 'Graph',
      'panel.relations': 'Relations',
      'relations.hint': 'see each entry\'s Related',
      'entry.related': 'Related',
      'entry.noRelated': 'No relations yet (use memory_link)',
      'graph.nodes': 'nodes',
      'graph.edges': 'links',
      'graph.empty': 'No relations in this scope yet (link two memories with memory_link)',
      'graph.scopeCount': 'in scope:',
      'panel.write': 'Write',
      'panel.placeholder': 'Write a new memory entry…',
      'panel.approve': 'Approve',
      'panel.reject': 'Reject',
      'panel.remove': 'Remove',
      'panel.footer': 'lina-memory · local Markdown memory',
      'panel.failed': 'Read failed',
      'panel.none': 'Resource channel unavailable (no provider)',
      'panel.admin': 'Configure under Settings → Plugins',
    }
    const localT = (key) => ZH[key] ?? key

    // ------------------------------------------------------- resource 地址
    // 地址即身份：把 revision 编进地址，写操作后 bump 一次即可让所有
    // useResource 重新订阅并拿到最新值（原生缓存语义，不手写轮询）。
    const addr = (path, query) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(query ?? {})) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
      }
      const q = params.toString()
      return `dsh-resource://${PROTOCOL}/${path}${q ? '?' + q : ''}`
    }

    /** 地址（path + 查询）→ host 只读路由 */
    function hostGet(pathname, params, signal) {
      const path = pathname.replace(/^\/+|\/+$/g, '')
      if (path === 'overview') return getJson('/overview', null, signal)
      if (path === 'entries') return getJson('/entries', { scope: params.get('scope') || 'global', name: params.get('name') || '' }, signal)
      if (path === 'suggestions') return getJson('/suggestions', null, signal)
      if (path === 'graph') return getJson('/graph', null, signal)
      if (path === 'archive') return getJson('/archive', null, signal)
      if (path === 'lists') return getJson('/lists', { kind: params.get('kind') || 'projects' }, signal)
      throw new Error('unknown memory resource: ' + path)
    }

    /**
     * 带超时的 host 请求：先按**市场同款**（相对 document.baseURI 的根相对路径），
     * 失败再按**一方 file-upload 同款**（合成宿主 http://dsh.internal 的绝对 URL）。
     * 两条都失败就抛出合并原因，面板会显示出来——绝不再无声挂起。
     */
    async function requestJson(pathWithQuery, signal, init) {
      const rel = API + pathWithQuery
      const attempts = [rel, new URL(rel, HOST_BASE).toString()]
      let lastErr = null
      for (const url of attempts) {
        const ctl = new AbortController()
        const onAbort = () => ctl.abort()
        if (signal) {
          if (signal.aborted) { probe.lastError = 'aborted by subscription'; return undefined }
          signal.addEventListener('abort', onAbort, { once: true })
        }
        const timer = setTimeout(() => ctl.abort(), 8000)
        try {
          const res = await fetch(url, { ...(init ?? {}), signal: ctl.signal })
          if (!res.ok) throw new Error('HTTP ' + String(res.status))
          const body = await res.json()
          probe.lastError = ''
          probe.lastUrl = url
          return body
        } catch (err) {
          lastErr = String(err?.message || err) + ' @' + url
          probe.lastError = lastErr
        } finally {
          clearTimeout(timer)
          if (signal) signal.removeEventListener('abort', onAbort)
        }
        if (signal?.aborted) return undefined
      }
      throw new Error(lastErr || 'request failed')
    }

    async function getJson(sub, query, signal) {
      const qs = query ? '?' + new URLSearchParams(query).toString() : ''
      return await requestJson(sub + qs, signal, { headers: { accept: 'application/json' } })
    }

    /** 写操作（同源保护在 host 侧） */
    async function postJson(sub, body) {
      const value = await requestJson(sub, null, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return value ?? { ok: false, error: 'no response' }
    }

    function delay(ms, signal) {
      return new Promise((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(done, ms)
        signal.addEventListener('abort', done, { once: true })
        function done() {
          clearTimeout(timer)
          signal.removeEventListener('abort', done)
          resolve()
        }
      })
    }

    // -------------------------------------------------- 原生数据：resource
    /**
     * 诊断探针：面板上直接显示「提供方是否注册 / 是否开流过 / 最近错误 / 基址」，
     * 出问题时不必猜（首次渲染时可能还是未注册态，重新打开标签页即为准）。
     */
    const probe = { build: BUILD, base: HOST_BASE, registered: false, registerError: '', opened: 0, lastError: '', lastUrl: '' }

    function installResourceProvider(ctx) {
      ctx.inject(['resources'], (scope) => {
        try {
          scope.effect(() => scope.resources.register({
            protocol: PROTOCOL,
            async *open(address, { signal }) {
              const url = new URL(address)
              probe.opened += 1
              let last = ''
              for (;;) {
                try {
                  const payload = await hostGet(url.pathname, url.searchParams, signal)
                  probe.lastError = ''
                  const digest = JSON.stringify(payload)
                  if (digest !== last) {
                    last = digest
                    // 帧信封（RemoteResult）：成功必须是 { ok:true, value:载荷 }，
                    // 失败是 { ok:false, error }。直接 yield 载荷会让框架取到
                    // value === undefined（于是 status 一直是 live 但永远没有值）。
                    yield { ok: true, value: payload }
                  }
                } catch (err) {
                  if (signal.aborted) return
                  probe.lastError = String(err?.message || err)
                  yield { ok: false, error: probe.lastError }
                  return
                }
                await delay(POLL_MS, signal)
                if (signal.aborted) return
              }
            },
          }), 'lina-memory: resource protocol')
          probe.registered = true
        } catch (err) {
          probe.registerError = String(err?.message || err)
          console.warn('lina-memory client: resource provider 注册失败', err)
        }
      })
    }

    // ------------------------------------------------ 原生状态：store 席位
    const panelStore = defineStore({
      persist: 'lina-memory.panel',
      init: () => ({ scope: 'global', name: '', newName: '', confirmArchive: false, expanded: '', draft: '', search: '', revision: 0, busy: false, message: '' }),
      actions: {
        setScope: (d, scope) => { d.scope = scope; d.confirmArchive = false; d.expanded = '' },
        setName: (d, value) => { d.name = value; d.confirmArchive = false; d.expanded = '' },
        setNewName: (d, value) => { d.newName = value },
        setConfirmArchive: (d, value) => { d.confirmArchive = value },
        /** 展开/收起某条记忆的「相关」列表（再点一次收起） */
        toggleExpanded: (d, id) => { d.expanded = d.expanded === id ? '' : id },
        setDraft: (d, value) => { d.draft = value },
        setSearch: (d, value) => { d.search = value },
        setBusy: (d, value) => { d.busy = value },
        setMessage: (d, value) => { d.message = value },
        /** 写操作成功后调用：让所有 resource 地址换一份，触发重新拉取 */
        bump: (d) => { d.revision += 1 },
      },
    })

    // ------------------------------------------------------------- 样式
    const css = [
      '.lm-panel { padding: 12px; font-size: 13px; color: inherit; overflow-y: auto; height: 100%; display: flex; flex-direction: column; gap: 10px; }',
      '.lm-panel h3 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.75; }',
      '.lm-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }',
      '.lm-stat { background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 8px; padding: 6px 4px; text-align: center; font-size: 11px; opacity: 0.9; }',
      '.lm-stat b { display: block; font-size: 15px; font-weight: 700; margin-bottom: 2px; }',
      '.lm-scopes { display: flex; gap: 4px; background: color-mix(in srgb, currentColor 5%, transparent); border-radius: 8px; padding: 4px; }',
      '.lm-scope { flex: 1; background: transparent; border: 0; border-radius: 6px; padding: 5px 0; cursor: pointer; font-size: 12px; opacity: 0.7; color: inherit; }',
      '.lm-scope.active { background: color-mix(in srgb, currentColor 12%, transparent); opacity: 1; font-weight: 600; }',
      '.lm-section { background: color-mix(in srgb, currentColor 3%, transparent); border-radius: 10px; padding: 10px; }',
      '.lm-row { display: flex; gap: 6px; margin-top: 8px; }',
      '.lm-btn { border: 0; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; font-weight: 500; background: color-mix(in srgb, currentColor 12%, transparent); color: inherit; }',
      '.lm-btn.primary { background: #2563eb; color: #fff; }',
      '.lm-btn.ok { background: #059669; color: #fff; }',
      '.lm-btn.danger { background: #dc2626; color: #fff; }',
      '.lm-btn.small { padding: 3px 8px; font-size: 11px; border-radius: 5px; }',
      '.lm-btn:disabled { opacity: 0.45; cursor: default; }',
      '.lm-entries { display: flex; flex-direction: column; gap: 6px; max-height: 34vh; overflow-y: auto; }',
      '.lm-entry { background: color-mix(in srgb, currentColor 4%, transparent); border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }',
      '.lm-entry .meta { font-size: 10px; opacity: 0.55; margin-bottom: 3px; font-family: ui-monospace, monospace; }',
      '.lm-suggestion { border-left: 3px solid #f59e0b; }',
      '.lm-empty { text-align: center; padding: 14px; font-size: 12px; opacity: 0.5; }',
      '.lm-input { background: color-mix(in srgb, currentColor 4%, transparent); border: 1px solid color-mix(in srgb, currentColor 15%, transparent); color: inherit; border-radius: 6px; padding: 6px 10px; font-size: 12px; flex: 1; outline: none; }',
      '.lm-input:focus { border-color: #2563eb; }',
      '.lm-node { display: inline-block; background: color-mix(in srgb, currentColor 8%, transparent); border-radius: 6px; padding: 2px 8px; font-size: 11px; margin: 2px; }',
      '.lm-related { margin-top: 6px; padding-top: 6px; border-top: 1px dashed color-mix(in srgb, currentColor 15%, transparent); display: flex; flex-direction: column; gap: 3px; }',
      '.lm-related-row { display: flex; gap: 6px; align-items: baseline; font-size: 11px; }',
      '.lm-related-rel { flex: none; opacity: 0.55; font-family: ui-monospace, monospace; }',
      '.lm-related-label { opacity: 0.85; word-break: break-word; }',
      '.lm-edge { font-size: 12px; opacity: 0.85; }',
      '.lm-msg { font-size: 11px; opacity: 0.7; }',
      '.lm-footer { margin-top: auto; font-size: 10px; opacity: 0.4; text-align: center; }',
    ].join('\n')

    // --------------------------------------------------------- 面板组件
    function MemoryPanel(props) {
      const { useResource, useStore, actions, t } = props
      const probe = props.probe ?? { build: BUILD, base: HOST_BASE, registered: false, registerError: '', opened: 0, lastError: '' }
      const tr = typeof t === 'function' ? t : localT

      const scope = useStore((s) => s.scope)
      const name = useStore((s) => s.name)
      const draft = useStore((s) => s.draft)
      const expanded = useStore((s) => s.expanded)
      const search = useStore((s) => s.search)
      const revision = useStore((s) => s.revision)
      const busy = useStore((s) => s.busy)
      const message = useStore((s) => s.message)

      // 项目/日志是「按文件」的范围：需要先选文件（host /entries 要 name），
      // 归档则完全走另一个端点（冷归档文件列表，不是条目）。不需要的资源传空地址 → 不开流。
      const fileScope = scope === 'project' || scope === 'daily'
      const newName = useStore((s) => s.newName)
      const confirmArchive = useStore((s) => s.confirmArchive)
      const listKind = scope === 'daily' ? 'dailies' : 'projects'
      const listsRes = useResource(fileScope ? addr('lists', { kind: listKind, r: revision }) : '')
      const fileList = Array.isArray(listsRes?.value?.list) ? listsRes.value.list : []
      const cleanNames = (listKind === 'dailies' ? [...fileList].sort().reverse() : [...fileList].sort())
        .map((f) => String(f).replace(/\.md$/, ''))
      // 选中的文件：优先用记忆里的选择，失效则回退到第一个（避免空白）
      const pickedName = cleanNames.includes(name) ? name : (cleanNames[0] ?? '')

      const overviewRes = useResource(addr('overview', { r: revision }))
      const entriesRes = useResource(fileScope
        ? (pickedName ? addr('entries', { scope, name: pickedName, r: revision }) : '')
        : (scope === 'archive' ? '' : addr('entries', { scope, r: revision })))
      const archiveRes = useResource(scope === 'archive' ? addr('archive', { r: revision }) : '')
      const suggestionsRes = useResource(addr('suggestions', { r: revision }))
      const graphRes = useResource(addr('graph', { r: revision }))

      const overview = overviewRes?.value ?? null
      const counts = overview?.counts ?? null
      const allEntries = Array.isArray(entriesRes?.value?.entries) ? entriesRes.value.entries : []
      // 检索在客户端做（host 的 name 参数是「文件名」不是内容检索）
      const q = String(search ?? '').trim().toLowerCase()
      const entries = q ? allEntries.filter((raw) => parseEntry(raw).content.toLowerCase().includes(q)) : allEntries
      const archiveFiles = Array.isArray(archiveRes?.value?.files) ? archiveRes.value.files : []
      const suggestions = Array.isArray(suggestionsRes?.value?.entries) ? suggestionsRes.value.entries : []
      const graph = graphRes?.value?.graph ?? { entities: [], edges: [] }
      const loading = overviewRes?.value === undefined

      // ---- 关系数据（2026-09-11 使用者定：图谱降级为"关系数据 + 条目相关列表"）----
      // GRAPH.json 仍是关系真源；面板不再画 SVG 图，而是给每条记忆标注「相关 N」并可展开。
      const rawNodes = Array.isArray(graph?.entities) ? graph.entities : []
      const labelById = new Map(rawNodes.map((n, i) => [typeof n === 'string' ? n : String(n?.id ?? i),
        cleanLabel(typeof n === 'string' ? n : (n?.label || n?.name)) || String(typeof n === 'string' ? n : (n?.id ?? i))]))
      const relationsById = new Map()
      for (const e of (Array.isArray(graph?.edges) ? graph.edges : [])) {
        if (!e || !e.from || !e.to) continue
        if (!relationsById.has(e.from)) relationsById.set(e.from, [])
        if (!relationsById.has(e.to)) relationsById.set(e.to, [])
        relationsById.get(e.from).push({ id: e.to, relation: e.relation || '相关', dir: '→' })
        relationsById.get(e.to).push({ id: e.from, relation: e.relation || '相关', dir: '←' })
      }
      const relatedOf = (id) => (id ? (relationsById.get(id) || []) : [])
      const labelOfId = (id) => labelById.get(id) || id

      // 当前范围的关联统计 + 枢纽（被关联最多的记忆）——替代原来的整张 SVG 图
      const scopeEntryIds = new Set(allEntries.map((raw) => parseEntry(raw).id).filter(Boolean))
      const scopeDeg = new Map()
      for (const [from, list] of relationsById) {
        if (!scopeEntryIds.has(from)) continue
        for (const r of list) {
          if (!scopeEntryIds.has(r.id)) continue
          scopeDeg.set(from, (scopeDeg.get(from) || 0) + 1)
        }
      }
      const scopeEdgeCount = Math.round([...scopeDeg.values()].reduce((a, b) => a + b, 0) / 2)
      const scopeHubs = [...scopeDeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

      /** 某条记忆的「相关」区块：展开某条时列出它关联的记忆 */
      function renderRelated(entryId) {
        const rel = relatedOf(entryId)
        if (rel.length === 0) return h('div', { className: 'lm-msg' }, tr('entry.noRelated'))
        return h('div', { className: 'lm-related' }, rel.map((r, i) => h('div', { className: 'lm-related-row', key: i },
          h('span', { className: 'lm-related-rel' }, r.dir + ' ' + r.relation),
          h('span', { className: 'lm-related-label', title: labelOfId(r.id) }, String(labelOfId(r.id)).slice(0, 60)),
        )))
      }

      // 诊断：resource 层拿不到值时把原因显示出来（不再永远停在“读取中”）
      const diagValue = suggestionsRes?.value ?? entriesRes?.value ?? overviewRes?.value
      const diag = (diagValue && diagValue.ok === false)
        ? tr('panel.failed') + '：' + String(diagValue.error || '?')
        : (overviewRes?.status === 'none' ? tr('panel.none') : (overviewRes?.failure ? tr('panel.failed') + '：' + String(overviewRes.failure?.message || overviewRes.failure) : ''))

      /** 写操作：POST 后 bump 一次 revision，所有 resource 自动重取 */
      async function act(sub, body) {
        actions.setBusy(true)
        actions.setMessage('')
        try {
          const res = await postJson(sub, body)
          if (res && res.ok === false) actions.setMessage(res.error || 'failed')
          actions.bump()
        } catch (err) {
          actions.setMessage(String(err?.message || err))
        } finally {
          actions.setBusy(false)
        }
      }

      /** 写操作的目标：项目/日志要带文件名（host /write 按 scope+name 定位文件） */
      function target(extra) {
        return { scope, ...(fileScope && pickedName ? { name: pickedName } : {}), ...extra }
      }

      function submitDraft() {
        const content = String(draft ?? '').trim()
        if (content === '') return
        act('/write', target({ action: 'add', content }))
        actions.setDraft('')
      }

      function removeEntry(raw) {
        // host 侧 /write 的 remove 分支按 body.match 匹配原始行
        act('/write', target({ action: 'remove', match: raw }))
      }

      /** 新建项目分类（PROJECTS/<name>.md）——不弹 prompt（Electron 渲染进程不支持） */
      async function createProject() {
        const name = String(newName ?? '').trim()
        if (name === '') return
        actions.setBusy(true)
        actions.setMessage('')
        try {
          const res = await postJson('/project', { action: 'create', name })
          if (res && res.ok === false) actions.setMessage(String(res.error || '创建失败'))
          else { actions.setMessage(tr('project.created') + '：' + name); actions.setName(name); actions.setNewName('') }
          actions.bump()
        } catch (err) {
          actions.setMessage(String(err?.message || err))
        } finally {
          actions.setBusy(false)
        }
      }

      /** 归档当前项目分类：整文件移入 ARCHIVE/（两步确认，不物理删除） */
      async function archiveProject() {
        if (!pickedName) return
        if (!confirmArchive) { actions.setConfirmArchive(true); return }
        actions.setBusy(true)
        actions.setMessage('')
        try {
          const res = await postJson('/project', { action: 'archive', name: pickedName })
          if (res && res.ok === false) actions.setMessage(String(res.error || '归档失败'))
          else { actions.setMessage(tr('project.archived') + '：' + pickedName + ' → ARCHIVE/'); actions.setName('') }
          actions.setConfirmArchive(false)
          actions.bump()
        } catch (err) {
          actions.setMessage(String(err?.message || err))
        } finally {
          actions.setBusy(false)
        }
      }

      function stat(label, n) {
        return h('div', { className: 'lm-stat', key: label }, h('b', null, String(n ?? 0)), label)
      }

      function scopeBtn(label, key) {
        return h('button', {
          key,
          className: 'lm-scope' + (scope === key ? ' active' : ''),
          onClick: () => actions.setScope(key),
        }, label)
      }

      const scopes = [
        ['全局', 'global'],
        ['偏好', 'user'],
        ['项目', 'project'],
        ['日志', 'daily'],
        ['归档', 'archive'],
      ]

      /** 图谱标题里的范围名（项目/日志带上具体文件名） */
      function scopeTitle() {
        const base = (scopes.find(([, key]) => key === scope) || [scope])[0]
        return fileScope && pickedName ? base + ' · ' + pickedName : base
      }

      return h('div', { className: 'lm-panel' },
        h('style', null, css),
        h('div', { className: 'lm-stats' },
          stat(tr('stat.global'), counts?.global),
          stat(tr('stat.user'), counts?.user),
          stat(tr('stat.project'), counts?.projectEntries ?? counts?.projects),
          stat(tr('stat.review'), counts?.suggestions),
        ),
        h('div', { className: 'lm-scopes' }, scopes.map(([label, key]) => scopeBtn(label, key))),
        diag ? h('div', { className: 'lm-msg' }, diag) : null,
        // 项目/日志：先选文件（条目按文件存放）；项目还能新建 / 归档分类
        fileScope ? h('div', { className: 'lm-row', style: { flexWrap: 'wrap', gap: '4px' } },
          h('span', { className: 'lm-msg', style: { width: '100%', marginBottom: '2px' } },
            (scope === 'daily' ? tr('pick.daily') : tr('pick.project')) + ' · ' + String(cleanNames.length) + ' ' + tr('pick.unit')),
          cleanNames.length === 0
            ? h('span', { className: 'lm-msg' }, tr('panel.empty'))
            : cleanNames.map((n) => h('button', {
                key: n,
                className: 'lm-btn small' + (n === pickedName ? ' primary' : ''),
                onClick: () => actions.setName(n),
              }, n)),
          // —— 项目分类管理（仅项目范围）：新建 / 归档当前项目 ——
          scope === 'project' ? h('div', { className: 'lm-row', style: { width: '100%', marginTop: '4px' } },
            h('input', {
              className: 'lm-input',
              placeholder: tr('project.newPlaceholder'),
              value: newName,
              onChange: (e) => actions.setNewName(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') createProject() },
            }),
            h('button', { className: 'lm-btn small primary', disabled: busy, onClick: createProject }, tr('project.create')),
            pickedName ? h('button', {
              className: 'lm-btn small' + (confirmArchive ? ' danger' : ''),
              disabled: busy,
              onClick: archiveProject,
            }, confirmArchive ? tr('project.archiveConfirm') : tr('project.archive')) : null,
          ) : null,
        ) : null,
        scope === 'archive' ? null : h('div', { className: 'lm-row' },
          h('input', {
            className: 'lm-input',
            placeholder: tr('panel.search'),
            value: search,
            onChange: (e) => actions.setSearch(e.target.value),
          }),
        ),
        h('div', { className: 'lm-section' },
          h('h3', null, scope === 'archive' ? tr('panel.archive') : tr('panel.entries') + (scope === 'archive' ? '' : ' · ' + (fileScope ? pickedName || '-' : String(entries.length)))),
          scope === 'archive'
            ? h('div', { style: { marginTop: '8px' } },
                archiveFiles.length === 0
                  ? h('div', { className: 'lm-empty' }, tr('panel.empty'))
                  : h('div', { className: 'lm-entries' }, archiveFiles.map((item, i) =>
                      h('div', { className: 'lm-entry', key: i },
                        h('div', { className: 'meta' }, String(item.file || '?') + ' · ' + String(item.entries ?? 0) + ' ' + tr('pick.unit')),
                      ))),
              )
            : h('div', { className: 'lm-row' },
                h('input', {
                  className: 'lm-input',
                  placeholder: tr('panel.placeholder'),
                  value: draft,
                  onChange: (e) => actions.setDraft(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter') submitDraft() },
                }),
                h('button', { className: 'lm-btn primary', disabled: busy, onClick: submitDraft }, tr('panel.write')),
              ),
          scope === 'archive' ? null : h('div', { style: { marginTop: '8px' } },
            loading
              ? h('div', { className: 'lm-empty' },
                  tr('panel.loading') + '（status=' + String(overviewRes?.status ?? '?') + '）',
                  probe.registered ? null : h('div', null, '提供方未注册 ' + (probe.registerError || '')),
                  probe.lastError ? h('div', null, '错误：' + probe.lastError) : null,
                  h('div', null, '基址：' + probe.base + ' · opened=' + String(probe.opened)),
                )
              : entries.length === 0
                ? h('div', { className: 'lm-empty' }, tr('panel.empty'))
                : h('div', { className: 'lm-entries' }, entries.map((rawEntry, i) => {
                    const e = parseEntry(rawEntry)
                    const relCount = relatedOf(e.id).length
                    return h('div', { className: 'lm-entry', key: e.id || i },
                      h('div', { className: 'meta' },
                        (e.id ? '[' + e.id + '] ' : '') + (e.date || '') + (e.branch ? ' [branch:' + e.branch + ']' : '') + (e.tag ? ' [' + e.tag + ']' : ''),
                        relCount > 0 ? h('button', {
                          className: 'lm-btn small',
                          style: { marginLeft: '6px' },
                          onClick: () => actions.toggleExpanded(e.id),
                        }, tr('entry.related') + ' ' + relCount + (expanded === e.id ? ' ▾' : ' ▸')) : null,
                        h('button', {
                          className: 'lm-btn small danger',
                          style: { float: 'right' },
                          disabled: busy,
                          onClick: () => removeEntry(e.raw),
                        }, tr('panel.remove')),
                      ),
                      h('div', null, e.content),
                      expanded === e.id ? renderRelated(e.id) : null,
                    )
                  })),
          ),
        ),
        h('div', { className: 'lm-section' },
          h('h3', null, tr('panel.suggestions') + (suggestions.length ? ' · ' + suggestions.length : '')),
          h('div', { style: { marginTop: '8px' } },
            suggestions.length === 0
              ? h('div', { className: 'lm-empty' }, tr('panel.empty'))
              : suggestions.map((item, i) =>
                  h('div', { className: 'lm-entry lm-suggestion', key: i },
                    h('div', { className: 'meta' }, '[' + (item.scope || '?') + ']' + (item.tag ? ' [' + item.tag + ']' : '')),
                    h('div', null, String(item.content || '').slice(0, 240)),
                    h('div', { className: 'lm-row' },
                      h('button', { className: 'lm-btn ok small', disabled: busy, onClick: () => act('/suggestions/approve', { index: i }) }, tr('panel.approve')),
                      h('button', { className: 'lm-btn danger small', disabled: busy, onClick: () => act('/suggestions/reject', { index: i }) }, tr('panel.reject')),
                    ),
                  ),
                ),
          ),
        ),
        // 关联概览（替代原来的整张 SVG 图）：日志与归档不显示
        (scope === 'archive' || scope === 'daily') ? null : h('div', { className: 'lm-section' },
          h('h3', null, tr('panel.relations') + ' · ' + scopeTitle()),
          h('div', { style: { marginTop: '8px' } },
            scopeEdgeCount === 0
              ? h('div', { className: 'lm-empty' }, tr('graph.empty'))
              : h('div', null,
                  h('div', { className: 'lm-msg' }, String(scopeDeg.size) + ' ' + tr('graph.nodes') + ' / ' + String(scopeEdgeCount) + ' ' + tr('graph.edges') + '（' + tr('relations.hint') + '）'),
                  scopeHubs.map(([id, n], i) => h('div', { className: 'lm-related-row', key: i },
                    h('span', { className: 'lm-related-rel' }, n + '×'),
                    h('span', { className: 'lm-related-label', title: labelOfId(id) }, String(labelOfId(id)).slice(0, 52)),
                  )),
                ),
          ),
        ),
        message ? h('div', { className: 'lm-msg' }, message) : null,
        h('div', { className: 'lm-footer' },
          tr('panel.footer') + ' · ' + tr('panel.admin'),
          h('div', null, 'build ' + BUILD + ' · 提供方' + (probe.registered ? '已注册' : '未注册') + ' · opened=' + String(probe.opened) + ' · ' + probe.base),
        ),
      )
    }

    // --------------------------------------------- 原生面板位：右侧边栏 tab
    function installSidebarTab(ctx, tr) {
      ctx.inject(['sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => tr('tab.title'),
          guide: [{
            order: 20,
            title: () => tr('guide.title'),
            description: () => tr('guide.description'),
            icon: () => h('span', { style: { fontSize: '18px' } }, '🧠'),
          }],
        }), 'lina-memory: sidebar tab type')
      })

      ctx.inject(['slots'], (scope) => {
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          store: panelStore,
          // 诊断探针随 props 进组件（面板会显示提供方状态与最近错误）
          inject: () => ({ probe }),
        }, MemoryPanel)), 'lina-memory: sidebar tab body')
      })
    }

    // ------------------------------------------------------------- 装配
    const apply = (ctx) => {
      const disposeLocale = []
      try {
        ctx.inject(['locale'], (scope) => {
          disposeLocale.push(scope.effect(() => {
            const a = scope.locale.register(NS, 'zh', ZH)
            const b = scope.locale.register(NS, 'en', EN)
            return () => { a?.(); b?.() }
          }, 'lina-memory: dictionaries'))
        })
      } catch (err) {
        console.warn('lina-memory client: locale 注册失败（回退内置中文）', err)
      }

      installResourceProvider(ctx)
      installSidebarTab(ctx, localT)

      return () => {
        for (const d of disposeLocale) {
          try { d() } catch { /* best-effort */ }
        }
      }
    }

    return { apply, inject: ['slots'] }
  },
})
