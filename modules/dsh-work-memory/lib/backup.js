/**
 * work-memory — 记忆库自动备份。
 *
 * 全量复制记忆库到备份目录（默认 ~/.dsh/memories/work-memory-backup，
 * 与主库分离，防误删/故障），按天目录 backup-YYYY-MM-DD，
 * 保留最近 backupKeep 份（默认 7）。
 * 与归档同一节奏：写库懒触发（每天至多一次，当天目录存在即跳过）。
 * @module work-memory/backup
 */

import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { todayStamp } from './clock.js'

/**
 * 默认备份根目录：~/.dsh/memories/work-memory-backup（可在设置里改 backupDir）。
 * 注意：不要硬编码盘符路径——非 Windows 平台会把 `E:\…` 当相对路径，凭空建出怪目录。
 */
export function defaultBackupDir() {
  const candidates = []
  candidates.push(join(homedir(), '.dsh', 'memories', 'work-memory-backup'))
  for (const c of candidates) {
    try {
      mkdirSync(c, { recursive: true })
      return c
    } catch { /* try next */ }
  }
  return join(homedir(), '.dsh', 'memories', 'work-memory-backup')
}

/**
 * 执行一次全量备份（当天已备份则跳过）。
 * @param {string} root - 记忆库根目录
 * @param {object} opts - { backupDir, keep }
 * @returns {object} { ok, skipped?, dir, files, kept }
 */
export function backupMemory(root, opts = {}) {
  // 注意：`backupDir: null` 曾被展开覆盖掉默认值 → join(null) 抛错被静默吞掉（自动备份失效）。
  // 因此这里用 `||` 而不是展开默认值。
  const cfg = {
    backupDir: opts.backupDir || defaultBackupDir(),
    keep: opts.keep ?? 7,
  }
  if (!existsSync(root)) return { ok: false, error: '记忆库不存在: ' + root }
  const today = todayStamp()
  const target = join(cfg.backupDir, 'backup-' + today)
  if (existsSync(target)) {
    return { ok: true, skipped: true, reason: '今日已备份' }
  }
  mkdirSync(cfg.backupDir, { recursive: true })

  let files = 0
  const copyTree = (src, dst) => {
    mkdirSync(dst, { recursive: true })
    for (const it of readdirSync(src, { withFileTypes: true })) {
      if (it.name.endsWith('.tmp') || it.name.endsWith('.lock')) continue
      const s = join(src, it.name)
      const d = join(dst, it.name)
      if (it.isDirectory()) copyTree(s, d)
      else {
        cpSync(s, d)
        files++
      }
    }
  }
  copyTree(root, target)

  // 清理：只保留最近 keep 份（backup-YYYY-MM-DD 名称可排序）
  const all = readdirSync(cfg.backupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^backup-\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
  while (all.length > cfg.keep) {
    rmSync(join(cfg.backupDir, all.shift()), { recursive: true, force: true })
  }
  return { ok: true, dir: target, files, kept: Math.min(all.length, cfg.keep) }
}

/** 列出备份目录（命令/API 用） */
export function listBackups(root, opts = {}) {
  const dir = (opts && opts.backupDir) || defaultBackupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^backup-\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse()
}

/**
 * 复制记忆库（同名结构）到 Obsidian 镜像目录，用于整体迁移/恢复。
 *
 * 同步范围：MEMORY.md / USER.md / GRAPH.json / PROJECTS / DAILY / **ARCHIVE**（含 `.archive-index.json`）。
 * - 含 ARCHIVE 是为了"迁走镜像即完整迁走记忆"：冷归档也进镜像，DAILY 按周合并后不会有内容只留在主库。
 * - `prune`（默认开）：**镜像里**多出来、主库已不存在的文件会被删掉（镜像始终等于主库快照）；
 *   只在本函数同步的名字范围内清理，镜像目录里其它内容（如手工维护的「历史归档」）不动。
 * - 跳过临时/锁文件；镜像与主库同名，回填无损。
 *
 * @param {string} root - 记忆库根目录
 * @param {string} obsidianDir - Obsidian 镜像目录（设置项 obsidianSyncDir）
 * @param {object} opts - { prune = true }
 * @returns {object} { ok, dir, files, pruned, error? }
 */
export function syncMemoryToObsidian(root, obsidianDir, opts = {}) {
  if (!root || !obsidianDir) return { ok: false, error: 'root/obsidianDir 缺失' }
  if (!existsSync(root)) return { ok: false, error: '记忆库不存在: ' + root }
  mkdirSync(obsidianDir, { recursive: true })
  const names = ['MEMORY.md', 'USER.md', 'GRAPH.json', 'PROJECTS', 'DAILY', 'ARCHIVE']
  let files = 0
  const copy = (s, d) => {
    const st = statSync(s)
    if (st.isDirectory()) {
      mkdirSync(d, { recursive: true })
      for (const it of readdirSync(s, { withFileTypes: true })) {
        if (it.name.endsWith('.tmp') || it.name.endsWith('.lock')) continue
        copy(join(s, it.name), join(d, it.name))
      }
    } else {
      cpSync(s, d)
      files++
    }
  }
  for (const name of names) {
    const s = join(root, name)
    if (existsSync(s)) copy(s, join(obsidianDir, name))
  }

  // 清理镜像里已被主库删除的文件（仅限同步范围，保持镜像 = 主库快照）
  let pruned = 0
  const pruneStale = (s, d) => {
    if (!existsSync(s) || !existsSync(d)) return
    for (const it of readdirSync(d, { withFileTypes: true })) {
      const ss = join(s, it.name)
      const dd = join(d, it.name)
      if (!existsSync(ss)) { rmSync(dd, { recursive: true, force: true }); pruned += 1; continue }
      if (it.isDirectory()) pruneStale(ss, dd)
    }
  }
  if (opts.prune !== false) {
    for (const name of names) {
      const s = join(root, name)
      const d = join(obsidianDir, name)
      if (existsSync(s) && existsSync(d) && statSync(s).isDirectory()) pruneStale(s, d)
    }
  }
  return { ok: true, dir: obsidianDir, files, pruned }
}
