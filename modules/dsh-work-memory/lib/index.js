/**
 * work-memory — 执行层记忆插件（DSH 标准插件 host 半）。
 *
 * 核心能力（对齐官方规范）：
 * 1. 热记忆注入：ctx.systemPrompt.context() 注入记忆快照（每轮常驻）
 * 2. 记忆工具：ctx.tools.register({ name, description, parameters, output, execute })
 * 3. 确认命令：ctx.commands.register()
 * 4. Web API：ctx.webServer.register() 可视化记忆管理
 * 5. 运行时可配置：ctx.settings.register() 原生设置命名空间（设置→插件 卡片）
 *
 * 零依赖（node:fs），本地优先（默认 ~/.dsh/memories/work-memory，可在设置里改）。
 * @module work-memory
 */

import { join } from 'node:path'
import { mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { MemoryStore, withDirLock, makeEntry, todayStamp, DAILY_ACTIVITY_PREFIX, stripEntryId, extractEntryDate, extractEntryId } from './store.js'
import { buildSnapshot, memoryFiles } from './context.js'
import { createTools } from './tools.js'
import { installApi } from './api.js'
import { runArchive, listArchive, archiveEntries, promoteEntry, daysSinceMaintain, markMaintain, keepEntry, archiveEntryById, listPending, NOTICE_DAYS } from './archive.js'
import { backupMemory, listBackups, syncMemoryToObsidian } from './backup.js'
import { nowHHMM, localIso } from './clock.js'
import { readGraph } from './graph.js'
import { readAccess, pruneAccess } from './access.js'
import { readTriage } from './triage.js'
import { installSettings } from './settings.js'

export const name = 'work-memory'
export const inject = ['systemPrompt', 'tools', 'commands', 'settings', 'webServer']

export function apply(ctx, config = {}) {
  // 0.3.0：配置来自原生设置命名空间（组合配置作 base 层，设置页写用户覆盖层）
  const settings = installSettings(ctx, config)
  let cfg = settings.read()
  // tools/archive/backup 在创建时捕获选项对象，这里保持同一引用、就地更新，使设置改动免重启生效
  const liveArchiveCfg = {
    enabled: cfg.archiveEnabled,
    dailyRetentionDays: cfg.dailyRetentionDays,
    projectTtlDays: cfg.projectTtlDays,
    userTtlDays: cfg.userTtlDays,
    triageEnabled: cfg.triageEnabled,
    triageGraceDays: cfg.triageGraceDays,
  }
  const liveBackupCfg = { enabled: cfg.backupEnabled, backupDir: cfg.backupDir, keep: cfg.backupKeep }
  settings.watch((next) => {
    cfg = next
    Object.assign(liveArchiveCfg, {
      enabled: next.archiveEnabled,
      dailyRetentionDays: next.dailyRetentionDays,
      projectTtlDays: next.projectTtlDays,
      userTtlDays: next.userTtlDays,
      triageEnabled: next.triageEnabled,
      triageGraceDays: next.triageGraceDays,
    })
    Object.assign(liveBackupCfg, {
      enabled: next.backupEnabled,
      backupDir: next.backupDir,
      keep: next.backupKeep,
    })
    ctx.logger?.debug?.('work-memory: 设置已更新')
  })

  const root = cfg.memoryDir || join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'memories', 'work-memory')
  mkdirSync(root, { recursive: true })
  for (const dir of ['DAILY', 'PROJECTS']) mkdirSync(join(root, dir), { recursive: true })

  const disposers = []

  // ---- 1. 热记忆注入（systemPrompt.context，官方 API） ----
  // 常驻注册：injectMemory 开关在回调内判断，因此切开关免重启生效。
  // 注意：order 在注册时固定，改动需重启 DSH。
  {
    let lastSnapshot = ''
    let lastText = ''
    let lastDailyLogAt = 0
    const dailyLog = () => {
      if (!cfg.dailyAutoLog) return
      try {
        const now = Date.now()
        if (now - lastDailyLogAt < 600_000) return // 10 分钟防抖
        lastDailyLogAt = now
        const t = todayStamp()
        const hhmm = nowHHMM()
        const store = new MemoryStore(join(root, 'DAILY', t + '.md'))
        store.ensure()
        store.add(makeEntry(DAILY_ACTIVITY_PREFIX + '（' + hhmm + '）', { tag: '常规' }))
      } catch { /* best-effort，不影响对话 */ }
    }
    disposers.push(ctx.systemPrompt.context({
      name: 'work-memory:snapshot',
      order: cfg.snapshotOrder,
      text: (context) => {
        if (!cfg.injectMemory) return ''
        dailyLog()
        const session = context?.agent?.session
        let branch = null
        try {
          const cwd = session?.header?.cwd
          if (cwd) {
            const parts = String(cwd).split(/[\\/]/).filter(Boolean)
            if (parts.length > 0) branch = parts[parts.length - 1]
          }
        } catch { /* best-effort */ }
        const snapshot = buildSnapshot({
          root,
          maxChars: cfg.snapshotMaxChars,
          branch,
          globalWarnCount: cfg.globalWarnCount,
          limits: {
            global: cfg.snapshotLimitGlobal,
            user: cfg.snapshotLimitUser,
            project: cfg.snapshotLimitProject,
            daily: cfg.snapshotLimitDaily,
          },
          maintainDays: daysSinceMaintain(root),
          maintainWarnDays: cfg.maintainWarnDays,
          triageAsk: cfg.triageAskInSnapshot,
        })
        // 官方要求 text 回调必须返回字符串（返回 null 会导致组装时
        // indexOf 崩溃）。无变化时返回上次文本（官方按内容 diff 保持缓存稳定）。
        if (snapshot === lastSnapshot) return lastText
        lastSnapshot = snapshot
        // 标题词可配（默认「记忆」，可在设置里改成任意名称）
        lastText = snapshot ? '【' + (cfg.personaLabel || '记忆') + '】\n' + snapshot : ''
        return lastText
      },
    }))
  }

  // ---- 2. 记忆工具（官方 ToolDefinition 形态） ----
  const toolDefs = createTools({
    root,
    archiveCfg: liveArchiveCfg,
    backupCfg: liveBackupCfg,
    obsidianSyncDir: cfg.obsidianSyncDir || null,

    getBranch: (session) => {
      try {
        const cwd = session?.header?.cwd
        if (!cwd) return null
        const parts = String(cwd).split(/[\\/]/).filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : null
      } catch {
        return null
      }
    },
    onSuggestion: (item) => {
      if (!cfg.reviewEnabled) return
      const file = memoryFiles(root).suggestions
      const line = JSON.stringify({ ...item, at: localIso(), id: Date.now() })
      try {
        if (!existsSync(file)) mkdirSync(root, { recursive: true })
        appendFileSync(file, line + '\n', 'utf8')
      } catch { /* best-effort */ }
    },
  })

  for (const def of toolDefs) {
    disposers.push(ctx.tools.register(def))
  }

  // ---- 3. 确认命令 /memory_review（官方 CommandResult 格式） ----
  disposers.push(ctx.commands.register({
    name: 'memory_review',
    description: '查看待确认的记忆建议',
    handler: async () => {
      const file = memoryFiles(root).suggestions
      if (!existsSync(file)) return { kind: 'success', text: '建议队列为空' }
      const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().startsWith('{'))
      if (rows.length === 0) return { kind: 'success', text: '建议队列为空' }
      const text = '待确认记忆（' + rows.length + ' 条）：\n' + rows.map((r, i) => {
        try {
          const j = JSON.parse(r)
          return (i + 1) + '. [' + (j.scope || '?') + '] ' + String(j.content || '').slice(0, 120)
        } catch {
          return (i + 1) + '. (解析失败)'
        }
      }).join('\n') + '\n\n在右侧边栏「记忆库」面板中批准/拒绝。'
      return { kind: 'success', text }
    },
  }))

  // ---- 3.5 归档命令 /memory_archive ----
  disposers.push(ctx.commands.register({
    name: 'memory_archive',
    description: '执行记忆衰减归档（过期 DAILY 按月合并、常规条目超期移入 ARCHIVE）',
    handler: async () => {
      try {
        // 分级 TTL：三个都要传。
        // （原先只传 dailyRetentionDays 且带了已废弃的 entryTtlDays —— 后者在 archive.js 里
        //   并不存在，导致手动 /memory_archive 在自定义「项目 TTL / 偏好 TTL」时不生效）
        const result = runArchive(root, {
          dailyRetentionDays: cfg.dailyRetentionDays,
          projectTtlDays: cfg.projectTtlDays,
          userTtlDays: cfg.userTtlDays,
        })
        if (result.skipped) return { kind: 'success', text: result.reason }
        const files = listArchive(root)
        const total = files.reduce((n, f) => n + f.entries, 0)
        return {
          kind: 'success',
          text: '归档完成：DAILY 归档 ' + result.dailies + ' 个文件，条目归档 ' + result.entries + ' 条；归档区共 ' + files.length + ' 个文件 / ' + total + ' 条。',
        }
      } catch (err) {
        return { kind: 'error', text: '归档失败：' + (err?.message || err) }
      }
    },
  }))

  // ---- 3.6 备份命令 /memory_backup ----
  disposers.push(ctx.commands.register({
    name: 'memory_backup',
    description: '手动备份记忆库（全量复制到备份目录，保留最近 N 份）',
    handler: async () => {
      try {
        const result = backupMemory(root, { backupDir: cfg.backupDir, keep: cfg.backupKeep })
        if (result.skipped) {
          const list = listBackups(root, { backupDir: cfg.backupDir })
          return { kind: 'success', text: result.reason + '（' + list.join(', ') + '）' }
        }
        return { kind: 'success', text: '备份完成：' + result.files + ' 个文件 → ' + result.dir + '（保留 ' + result.kept + ' 份）' }
      } catch (err) {
        return { kind: 'error', text: '备份失败：' + (err?.message || err) }
      }
    },
  }))

  // ---- 3.7 分类巡检 /memory_audit（2026-09-11 定：防"项目类写进全局"漂移） ----
  disposers.push(ctx.commands.register({
    name: 'memory_audit',
    description: '记忆分类巡检：各范围条数 + 可疑条目（项目类内容落在全局、长期未归档等）',
    handler: async () => {
      try {
        const read = (p) => existsSync(p) ? new MemoryStore(p).entries() : []
        const files = memoryFiles(root)
        const globalEntries = read(files.global)
        const userEntries = read(files.user)
        const projDir = join(root, 'PROJECTS')
        const projects = existsSync(projDir) ? readdirSync(projDir).filter((f) => f.endsWith('.md')) : []
        const dailyDir = join(root, 'DAILY')
        const dailies = existsSync(dailyDir) ? readdirSync(dailyDir).filter((f) => f.endsWith('.md')) : []
        let projCount = 0
        for (const f of projects) projCount += read(join(projDir, f)).length
        const archFiles = listArchive(root)
        const archCount = archFiles.reduce((n, f) => n + f.entries, 0)

        // 可疑判据：global 里出现明显的项目/工具踪迹（URL、版本号、插件名、路径）
        const suspicious = []
        const suspiciousRe = /(https?:\/\/|dsh[-_][a-z]|@[a-z0-9-]+\/|\bv\d+\.\d+|profile|bundle|插件|皮肤|会话维护|安装)/
        const oldThreshold = Date.now() - 45 * 86400000
        for (const raw of globalEntries) {
          const body = stripEntryId(raw)
          if (suspiciousRe.test(body)) suspicious.push(body.slice(0, 44))
          else {
            const d = extractEntryDate(raw)
            if (d && new Date(d).getTime() < oldThreshold) suspicious.push('[超45天]' + body.slice(0, 40))
          }
        }
        const lines = [
          '记忆分类巡检（阈值：全局 > ' + String(cfg.globalWarnCount) + ' 条告警）',
          '· 全局 MEMORY.md：' + globalEntries.length + ' 条' + (globalEntries.length > cfg.globalWarnCount ? '  ⚠️ 超阈值' : '  ✅'),
          '· 偏好 USER.md：' + userEntries.length + ' 条',
          '· 项目：' + projects.length + ' 个文件 / ' + projCount + ' 条',
          '· 日志：' + dailies.length + ' 个文件',
          '· 冷归档：' + archFiles.length + ' 个文件 / ' + archCount + ' 条',
        ]
        if (suspicious.length > 0) {
          lines.push('· 可疑条目（疑似项目类内容留在全局，建议移入 PROJECTS/）：' + suspicious.length + ' 条')
          for (const s of suspicious.slice(0, 8)) lines.push('    - ' + s)
        } else {
          lines.push('· 分类看起来干净 ✅')
        }

        // 图谱治理（2026-09-11 起：图谱降级为"关系数据"，巡检负责枢纽/孤儿）
        try {
          const g = readGraph(root)
          const deg = new Map()
          for (const e of g.edges) {
            deg.set(e.from, (deg.get(e.from) || 0) + 1)
            deg.set(e.to, (deg.get(e.to) || 0) + 1)
          }
          const labelOf = (id) => (g.entities.find((x) => x && x.id === id)?.label || id)
          const hubs = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          const linked = new Set(deg.keys())
          const orphans = g.entities.filter((x) => x && x.id && !linked.has(x.id))
          lines.push('· 图谱：' + g.entities.length + ' 节点 / ' + g.edges.length + ' 关系')
          if (hubs.length > 0) {
            lines.push('  枢纽（被关联最多）：')
            for (const [id, n] of hubs) lines.push('    - ' + String(labelOf(id)).slice(0, 34) + '（' + n + '）')
          }
          if (orphans.length > 0) {
            lines.push('  孤儿节点 ' + orphans.length + ' 个（无任何关联，可考虑用 memory_link 补链或忽略）：')
            for (const o of orphans.slice(0, 5)) lines.push('    - ' + String(o.label || o.id).slice(0, 34))
          }
        } catch { /* 图谱巡检 best-effort */ }

        const since = daysSinceMaintain(root)
        try {
          const tri = readTriage(root)
          const keptN = Object.keys(tri.kept || {}).length
          const pendN = Object.keys(tri.pending || {}).length
          const coldN = Object.keys(tri.cold || {}).length
          lines.push('· 转冷预审：保留 ' + keptN + ' / 待判断 ' + pendN + ' / 已判冷 ' + coldN + ' 条'
            + (pendN > 0 ? '（/memory_triage 查看并 keep/cold；超 ' + String(cfg.triageGraceDays ?? 7) + ' 天自动转冷）' : ''))
        } catch { /* best-effort */ }
        lines.push('· 周保养：' + (since === null ? '尚未做过（建议跑 /memory_maintain）' : '距上次 ' + since + ' 天'))
        return { kind: 'success', text: lines.join('\n') }
      } catch (err) {
        return { kind: 'error', text: '巡检失败：' + (err?.message || err) }
      }
    },
  }))

  // ---- 3.8 周保养 /memory_maintain（2026-09-11 定：每周处理一次记忆） ----
  disposers.push(ctx.commands.register({
    name: 'memory_maintain',
    description: '记忆周保养：到期转冷 + 转热候选 + 分类巡检（建议每周一次）',
    handler: async () => {
      try {
        const before = listArchive(root)
        const report = runArchive(root, { ...liveArchiveCfg, force: true })
        const after = listArchive(root)
        markMaintain(root)
        // 访问记录清理：热区（全局/偏好/项目/各天日志）+ 冷区都算"仍存在"，
        // 其余 id（条目已被彻底删除）摘掉，避免 .access.json 无限增长
        try {
          const files = memoryFiles(root, { branch: null })
          const ids = new Set()
          const collect = (p) => {
            if (!p || !existsSync(p)) return
            for (const e of new MemoryStore(p).entries()) {
              const id = extractEntryId(e)
              if (id) ids.add(id)
            }
          }
          collect(files.global)
          collect(files.user)
          const dailyDir = join(root, 'DAILY')
          if (existsSync(dailyDir)) for (const f of readdirSync(dailyDir)) if (f.endsWith('.md')) collect(join(dailyDir, f))
          const projDir = join(root, 'PROJECTS')
          if (existsSync(projDir)) for (const f of readdirSync(projDir)) if (f.endsWith('.md')) collect(join(projDir, f))
          for (const c of archiveEntries(root, 5000)) if (c.id) ids.add(c.id)
          pruneAccess(root, ids)
        } catch { /* 访问记录清理 best-effort */ }
        // 转热候选：归档里最近被召回过的条目（有访问记录优先）
        const access = readAccess(root)
        const cold = archiveEntries(root, 200)
        const candidates = cold
          .filter((c) => c.id && access[c.id])
          .sort((a, b) => String(access[b.id]?.last || '').localeCompare(String(access[a.id]?.last || '')))
          .slice(0, 5)
        const lines = [
          '记忆周保养完成（' + todayStamp() + '）',
          '· 周期：DAILY ' + String(liveArchiveCfg.dailyRetentionDays ?? 7) + ' 天（按周合并）/ 项目 ' + String(liveArchiveCfg.projectTtlDays ?? 30) + ' / 偏好 ' + String(liveArchiveCfg.userTtlDays ?? 90) + '；关键与全局永不转冷',
          '· 起始点：基准日 = max(写入日, 最后使用日)——7 天内被召回/关联过的条目自动顺延',
          '· 转冷：DAILY ' + report.dailies + ' 个文件、条目 ' + report.entries + ' 条',
          '· 冷区：' + before.length + ' → ' + after.length + ' 个文件',
        ]
        // 转冷预审结果（2026-09-11 定：到期≠立即冷，先自动判断）
        if (liveArchiveCfg.triageEnabled !== false) {
          const autoKept = (report.kept || []).filter((k) => k.by === 'auto')
          const heldByMe = (report.kept || []).filter((k) => k.by !== 'auto')
          const preCold = report.preCold || []
          lines.push('· 转冷预审（到期前 ' + NOTICE_DAYS + ' 天先判一遍）：自动保留 ' + autoKept.length + ' 条'
            + (heldByMe.length ? '、既往保留生效 ' + heldByMe.length + ' 条' : '')
            + '、预判自然转冷 ' + preCold.length + ' 条'
            + '、本次转冷 ' + (report.entries || 0) + ' 条'
            + ((report.coldTimeout || []).length ? '（其中超宽限 ' + report.coldTimeout.length + ' 条）' : ''))
          for (const k of autoKept.slice(0, 6)) lines.push('    ✔ 保留 [' + String(k.scope || '') + '] ' + String(k.reason || '').slice(0, 70))
          for (const c of preCold.slice(0, 6)) lines.push('    ✖ 预判将冷 [' + String(c.scope || '') + '] ' + String(c.label || '').slice(0, 34) + '（还有 ' + c.inDays + ' 天）')
          const ask = report.ask || []
          if (ask.length > 0) {
            lines.push('· ⏳ 待判断 ' + ask.length + ' 条（信号不足/矛盾，由助手判定，不推给使用者；超 ' + String(liveArchiveCfg.triageGraceDays ?? 7) + ' 天未判则自然转冷）：')
            for (const a of ask.slice(0, 10)) {
              lines.push('    - ' + a.id + ' [' + String(a.excerpt || a.label || '').slice(0, 40) + ']'
                + (a.pre ? '（尚未到期）' : '')
                + (a.reasons && a.reasons.length ? '　理由：' + a.reasons.join('；').slice(0, 60) : '　（无明显信号）'))
            }
            lines.push('    → 判定：/memory_triage keep <id> 或 /memory_triage cold <id>')
          } else {
            lines.push('· ✅ 无需判断的到期条目（预审已全部判定）')
          }
        }
        if (report.due && report.due.length > 0) {
          lines.push('· 未来 7 天将转冷 ' + report.due.length + ' 条：')
          for (const d of report.due.slice(0, 8)) {
            lines.push('    - ' + String(d.date || '') + ' [' + (d.label || d.scope) + '] 还有 ' + d.inDays + ' 天'
              + (d.basis === 'used' ? '（曾使用，已顺延）' : ''))
          }
        } else {
          lines.push('· 未来 7 天无到期条目 ✅')
        }
        if (candidates.length > 0) {
          lines.push('· 转热候选（曾被用到过的冷记忆，可用 /memory_promote <id> 取回）：')
          for (const c of candidates) lines.push('    - ' + c.id + '  ' + String(c.entry).slice(0, 60))
        }
        lines.push('· 详细分类/图谱巡检：/memory_audit')
        return { kind: 'success', text: lines.join('\n') }
      } catch (err) {
        return { kind: 'error', text: '周保养失败：' + (err?.message || err) }
      }
    },
  }))

  // ---- 3.9 转热 /memory_promote <id>（冷记忆取出使用 → 写回原范围） ----
  disposers.push(ctx.commands.register({
    name: 'memory_promote',
    description: '把归档中的某条记忆转回热记忆（按原 id、原文写回原范围），用法：/memory_promote <id>',
    handler: async ({ rawInput } = {}) => {
      const id = String(rawInput || '').trim().split(/\s+/)[0]
      if (!id) return { kind: 'error', text: '用法：/memory_promote <条目id>（id 见 /memory_audit 或面板条目元信息）' }
      try {
        const r = promoteEntry(root, id)
        if (!r.ok) return { kind: 'error', text: r.error || '转热失败' }
        return { kind: 'success', text: '已转热：' + id + ' → ' + r.file + '\n' + String(r.entry).slice(0, 120) }
      } catch (err) {
        return { kind: 'error', text: '转热失败：' + (err?.message || err) }
      }
    },
  }))

  // ---- 3.10 转冷预审判定 /memory_triage（2026-09-11 定：到期≠立即冷） ----
  disposers.push(ctx.commands.register({
    name: 'memory_triage',
    description: '转冷预审判定：列出「待判断」条目，或 /memory_triage keep <id>（保留并顺延）、/memory_triage cold <id>（现在转冷）',
    handler: async ({ rawInput } = {}) => {
      try {
        const parts = String(rawInput || '').trim().split(/\s+/).filter(Boolean)
        const action = parts[0] || ''
        const id = parts[1] || ''
        const reason = parts.slice(2).join(' ')
        if (action === 'keep' || action === 'cold') {
          if (!id) return { kind: 'error', text: '用法：/memory_triage ' + action + ' <条目id>' }
          const ttl = liveArchiveCfg.projectTtlDays || 30
          if (action === 'keep') {
            const r = keepEntry(root, id, { days: ttl, reason: reason || '助手判定：仍需留在热区' })
            if (!r.ok) return { kind: 'error', text: r.error || '保留失败' }
            return { kind: 'success', text: '已保留到 ' + r.record.until + '（' + r.label + '）\n理由：' + r.record.reason }
          }
          const r = archiveEntryById(root, id, { reason: reason || '助手判定：自然转冷', ttlDays: ttl })
          if (!r.ok) return { kind: 'error', text: r.error || '转冷失败' }
          if (r.deferred) return { kind: 'success', text: '已判定转冷（尚未到期）：' + id + '（' + r.label + '）\n到期日 ' + r.until + ' 自动转冷，之后不再询问\n理由：' + r.record.reason }
          return { kind: 'success', text: '已转冷：' + id + '（' + r.label + '）→ ARCHIVE/entries.md\n仍可用 memory_recall(scope=archive) 检索，命中即转热' }
        }
        // 无参数：列出待判断队列
        const pend = listPending(root)
        const tri = readTriage(root)
        const keptList = Object.entries(tri.kept)
        const coldList = Object.entries(tri.cold || {})
        const out = ['转冷预审状态（' + todayStamp() + '）',
          '· 保留生效中：' + keptList.length + ' 条',
          '· 已判定为冷（到期自动转冷，不再询问）：' + coldList.length + ' 条',
          '· 待判断：' + pend.length + ' 条']
        if (pend.length === 0) {
          out.push('· ✅ 没有待判断条目')
        } else {
          out.push('· 规则：预审拿不准的才进这里；超 ' + String(liveArchiveCfg.triageGraceDays ?? 7) + ' 天未判则自然转冷')
          for (const p of pend.slice(0, 20)) {
            out.push('')
            out.push('- ' + p.id + '　[' + (p.scope || '') + '] ' + String(p.label || ''))
            out.push('  摘要：' + String(p.excerpt || '').slice(0, 70))
            out.push('  信号：' + (p.reasons && p.reasons.length ? p.reasons.join('；') : '（无明显信号）') + '（评分 ' + String(p.score ?? 0) + '）')
            out.push('  入队：' + String(p.since || '') + '　判定：/memory_triage keep ' + p.id + ' 或 /memory_triage cold ' + p.id)
          }
        }
        return { kind: 'success', text: out.join('\n') }
      } catch (err) {
        return { kind: 'error', text: '预审判定失败：' + (err?.message || err) }
      }
    },
  }))

  try {
    disposers.push(installApi(ctx, { root }))
  } catch (err) {
    ctx.logger?.warn?.('work-memory: web API 安装失败: ' + (err?.message || err))
  }
  return () => {
    for (const d of disposers) {
      try { d() } catch { /* best-effort */ }
    }
  }
}
