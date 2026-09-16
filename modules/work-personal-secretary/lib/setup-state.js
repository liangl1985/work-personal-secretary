/**
 * work-personal-secretary —— 核心配置页的「当前生效值」（GET /api/setup-state 的宿主侧实现）
 *
 * **本文件最重要的一条纪律**：取值只走**宿主设置服务**（`ctx.settings.describe`，与本模块既有
 * `/settings` 路由同源那条路），**绝不自己去读 `~/.dsh/settings.yaml`** —— 那是宿主的文件与
 * 格式，路径与层级都不归本插件管。本文件**只读不写**，任何失败都降级为 `source:'none'` + 可读 note，
 * 绝不抛异常、绝不让调用方 500。
 *
 * 取值口径：
 *   · memoryDir   ← work-memory.memoryDir；空则给**生效默认**（`<DSH_HOME>/data/dsh-work-memory/memory`，
 *                   与 dsh-work-memory 的 `defaultMemoryRoot()` 同口径）并标 source='default'；
 *   · obsidianDir ← 由 work-memory.obsidianSyncDir（镜像目录）**反推 vault 根**，标 source='derived'；
 *                   反推复用 lib/basedeck.js 的 `deriveVaultRootFromMirror`（只有一份实现）；
 *   · domain      ← experts.defaultDomain，映射到 5 个预置岗位的 label；不在预置内则 isPreset=false；
 *   · identity    ← 只读检查 MEMORY.md 是否已有正文以「使用者身份：」起头的条目（复用 lib/identity.js）。
 *
 * @module work-personal-secretary/setup-state
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'

import { posix } from './install.js'
import { DEFAULT_MEMORY_SUBDIR, LEGACY_MEMORY_SUBDIR, deriveVaultRootFromMirror, resolveDshHome } from './basedeck.js'
import { DOMAIN_PRESETS } from './domain.js'
import { readIdentity } from './identity.js'
import { buildSettingsView } from './settings-api.js'

/** 本接口关心的两个设置命名空间 */
export const SETUP_STATE_NAMESPACES = ['work-memory', 'experts']

/** 取值时用到的键（逐条对应上面的口径） */
export const SETUP_STATE_KEYS = {
  memoryDir: { ns: 'work-memory', key: 'memoryDir' },
  obsidianSyncDir: { ns: 'work-memory', key: 'obsidianSyncDir' },
  defaultDomain: { ns: 'experts', key: 'defaultDomain' },
}

function clean(v) {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
}

function msgOf(err) {
  return String(err && err.message ? err.message : err).slice(0, 200)
}

/**
 * 从 `buildSettingsView` 的视图里取某 ns / 某键的「生效值」与该键的 schema 默认。
 * @returns {{value:string, default:string}}
 */
export function pickKeyValue(view, ns, key) {
  const empty = { value: '', default: '' }
  if (!view || !Array.isArray(view.namespaces)) return empty
  const entry = view.namespaces.filter((n) => n && n.ns === ns)[0]
  if (!entry) return empty
  const raw = (entry.value && typeof entry.value === 'object') ? entry.value[key] : undefined
  const field = Array.isArray(entry.fields) ? entry.fields.filter((f) => f && f.key === key)[0] : null
  const def = field && typeof field.default === 'string' ? field.default : ''
  return { value: clean(raw), default: clean(def) }
}

/**
 * 纯函数：由三份原始值 + 身份检查结果算出 setup-state（便于单测，不碰任何服务）。
 * @param {{memoryDirValue?:string, memoryDirDefault?:string, obsidianSyncValue?:string,
 *          domainValue?:string, domainDefault?:string,
 *          identity?:{exists:boolean, entryId:string}}} input
 */
export function buildSetupState(input = {}) {
  const memoryDirRaw = clean(input.memoryDirValue)
  const memoryDefault = clean(input.memoryDirDefault)
  let memoryDir
  if (memoryDirRaw) memoryDir = { value: posix(memoryDirRaw), source: 'settings' }
  else if (memoryDefault) memoryDir = { value: posix(memoryDefault), source: 'default' }
  else memoryDir = { value: '', source: 'none' }

  const sync = clean(input.obsidianSyncValue)
  const obsidianDir = sync
    ? { value: posix(deriveVaultRootFromMirror(sync)), source: 'derived' }
    : { value: '', source: 'none' }

  const domainValue = clean(input.domainValue)
  const domainDefault = clean(input.domainDefault)
  const domainId = domainValue || domainDefault
  const preset = domainId ? (DOMAIN_PRESETS.filter((p) => p.id === domainId)[0] || null) : null
  const domain = domainId
    ? {
      id: domainId,
      label: preset ? preset.label : domainId,
      isPreset: Boolean(preset),
      source: domainValue ? 'settings' : 'default',
    }
    : { id: '', label: '', isPreset: false, source: 'none' }

  const identityIn = (input.identity && typeof input.identity === 'object') ? input.identity : {}
  const identity = {
    exists: identityIn.exists === true,
    entryId: typeof identityIn.entryId === 'string' ? identityIn.entryId : '',
  }

  return { ok: true, memoryDir, obsidianDir, domain, identity, note: buildNote(memoryDir, obsidianDir, domain) }
}

/** 一行来源说明（给使用者看；不出现任何个人路径之外的隐私内容） */
function buildNote(memoryDir, obsidianDir, domain) {
  const where = (source, okText, defaultText) => (source === 'settings' ? okText : (source === 'default' ? defaultText : '未配置'))
  const parts = []
  parts.push('记忆库目录：' + where(memoryDir.source, '来自设置', '用默认位置'))
  parts.push('知识库目录：' + (obsidianDir.source === 'derived' ? '由记忆镜像目录反推' : '未配置'))
  parts.push('工作岗位：' + (domain.source === 'none'
    ? '未配置'
    : domain.label + '（' + (domain.isPreset ? '预置岗位' : '自定义，不在预置清单内') + (domain.source === 'default' ? '，取默认' : '') + '）'))
  return parts.join('；')
}

/**
 * 读宿主设置服务并组装 setup-state。**只读**、**不抛异常**。
 * @param {object} ctx cordis context（需 ctx.settings；缺失则整体降级）
 * @param {object} [deps] { env, dshHome, readIdentity:fn }（测试可注入）
 * @returns {Promise<object>}
 */
export async function readSetupState(ctx, deps = {}) {
  const env = deps.env || process.env
  const notes = []
  let view = null

  const settings = (ctx && ctx.settings && typeof ctx.settings.describe === 'function') ? ctx.settings : null
  if (!settings) {
    notes.push('设置服务不可用（ctx.settings 缺失或只读），三个字段按「未配置」处理')
  } else {
    try {
      const described = await settings.describe({ redactSecrets: true })
      view = buildSettingsView(described, { writable: false })
    } catch (err) {
      notes.push('读取设置失败：' + msgOf(err) + '（三个字段按「未配置」处理）')
      view = null
    }
  }

  const mem = pickKeyValue(view, SETUP_STATE_KEYS.memoryDir.ns, SETUP_STATE_KEYS.memoryDir.key)
  const sync = pickKeyValue(view, SETUP_STATE_KEYS.obsidianSyncDir.ns, SETUP_STATE_KEYS.obsidianSyncDir.key)
  const dom = pickKeyValue(view, SETUP_STATE_KEYS.defaultDomain.ns, SETUP_STATE_KEYS.defaultDomain.key)

  // memoryDir 为空时的「生效默认」：与 dsh-work-memory 的 defaultMemoryRoot() 同口径
  // （1.0.6 起是 <DSH_HOME>/data/dsh-work-memory/memory，见 basedeck.js 的 DEFAULT_MEMORY_SUBDIR）
  // 只在**设置服务可用**时才给「生效默认」：服务不可用时给一个可能不对的绝对路径反而误导
  let memoryDirDefault = ''
  if (view && !mem.value) {
    const dshHome = deps.dshHome ? String(deps.dshHome) : resolveDshHome(env)
    memoryDirDefault = dshHome ? join(dshHome, DEFAULT_MEMORY_SUBDIR) : ''
  }

  // 身份条目：只读检查（复用 lib/identity.js 的定位实现）
  let identityIn = { exists: false, entryId: '' }
  const effectiveMemoryDir = mem.value || memoryDirDefault
  if (effectiveMemoryDir) {
    try {
      const check = typeof deps.readIdentity === 'function'
        ? deps.readIdentity({ memoryDir: effectiveMemoryDir })
        : readIdentity({ memoryDir: effectiveMemoryDir })
      if (check && check.ok === true && check.count >= 1) {
        identityIn = { exists: true, entryId: typeof check.entryId === 'string' ? check.entryId : '' }
      } else if (check && check.exists === true && check.ok !== true) {
        notes.push('记忆库存在但读不到（' + (check.message || '未知原因') + '），未检测身份条目')
      }
    } catch (err) {
      notes.push('检查身份条目失败：' + msgOf(err))
    }
  }

  const state = buildSetupState({
    memoryDirValue: mem.value,
    memoryDirDefault: memoryDirDefault,
    obsidianSyncValue: sync.value,
    domainValue: dom.value,
    domainDefault: dom.default,
    identity: identityIn,
  })
  if (notes.length > 0) state.note = state.note + '（' + notes.join('；') + '）'
  return state
}

/** 目录存在性判定（静默：不存在 / 无权限都算「不是目录」） */
function isDirQuiet(dir) {
  try { return statSync(dir).isDirectory() } catch (e) { return false }
}

/**
 * 解析「迁移来源」＝ 旧记忆库现在可能在哪。**只读**、不抛异常。
 *
 * 顺序固定（回显里必须让人看见是哪一种，别让人猜）：
 *   ① source='settings'       设置里显式配置的 memoryDir；
 *   ② source='legacy-default' 旧的默认位置 <DSH_HOME>/memories/work-memory（**仅当该目录确实存在**）；
 *   ③ source='new-default'    新的默认位置 <DSH_HOME>/data/dsh-work-memory/memory。
 *
 * 为什么要留 ②：1.0.6 之前的默认位置里可能还躺着使用者的记忆；默认位置已经搬到 ③，
 * 但「老库还留在老地方」这件事只能靠存在性检查发现。
 *
 * @param {object} state readSetupState / buildSetupState 的结果（只读 memoryDir 字段）
 * @param {object} [deps] { env, dshHome }
 * @returns {{from:string, source:'settings'|'legacy-default'|'new-default'|'none'}}
 */
export function resolveMigrateSource(state, deps = {}) {
  const mem = (state && state.memoryDir && typeof state.memoryDir === 'object') ? state.memoryDir : {}
  const value = clean(mem.value)
  const kind = clean(mem.source)
  if (kind === 'settings' && value) return { from: value, source: 'settings' }
  const dshHome = deps.dshHome ? String(deps.dshHome) : resolveDshHome(deps.env || process.env)
  const legacy = dshHome ? join(dshHome, LEGACY_MEMORY_SUBDIR) : ''
  if (legacy && isDirQuiet(legacy)) return { from: legacy, source: 'legacy-default' }
  if (value) return { from: value, source: 'new-default' }
  return { from: '', source: 'none' }
}

