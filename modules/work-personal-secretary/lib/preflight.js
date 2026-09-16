/**
 * work-personal-secretary —— 可用性检查（保存即执行链第 0 步）
 *
 * 对应设计定稿 §3.3 的第一步：「环境就绪 · 两目录路径合法可写 · 同工作区 · 目标无冲突」。
 * 全部为**只读**判断：本文件不创建目录、不写任何文件、不加锁。
 *
 * 返回结构（供客户端逐项渲染）：
 *   checks[] = { id, label, level: 'ok'|'warn'|'block', ok, detail }
 *   ready = 不存在任何 level==='block' 的项
 *
 * 判定口径：
 *   - 环境就绪三项**复用 /check 的探针结果**（不新增探针）：记忆库子插件 / Python ≥3.10 / 8 个 pip 包；
 *   - 路径：绝对路径 + 不是用户主目录 + 目标（或其最近存在的上级）可写；
 *   - 同工作区：两个目标目录必须同盘（跨盘写入与同步会受权限范围限制，决议 9 判「拦截并给出理由」）；
 *   - 无冲突：两目录不得相同或互相嵌套；既有 MEMORY.md 必须能被解析为条目结构，否则拒绝（绝不覆盖使用者数据）。
 *
 * @module work-personal-secretary/preflight
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { parseEntries } from './identity.js'
import { isHomePath, normalizePath } from './basedeck.js'

/** 环境就绪三项（门禁口径，与设计定稿 §3.1 一致） */
export const PREFLIGHT_ENV_IDS = ['subPlugins', 'python', 'pythonDeps']

/** 记忆库插件名（环境就绪第一项） */
export const MEMORY_PLUGIN_NAME = 'dsh-work-memory'

/** 最低 Python 版本 */
export const MIN_PYTHON = '3.10'

function check(id, label, level, detail) {
  return { id: id, label: label, level: level, ok: level === 'ok', detail: detail }
}

/** 路径所在卷（Windows 盘符 / POSIX 根） */
export function volumeOf(p) {
  const s = resolve(String(p == null ? '' : p))
  const m = /^([A-Za-z]):/.exec(s)
  if (m) return m[1].toUpperCase() + ':'
  return sep
}

/** a 与 b 是否相同、或一个包含另一个（大小写不敏感：Windows 路径不区分大小写） */
export function isSameOrNested(a, b) {
  const x = normalizePath(a).toLowerCase().replace(/[\\/]+$/, '')
  const y = normalizePath(b).toLowerCase().replace(/[\\/]+$/, '')
  if (!x || !y) return false
  if (x === y) return true
  const withSep = (p) => p + sep
  return x.indexOf(withSep(y)) === 0 || y.indexOf(withSep(x)) === 0
}

/** 目录可写判定（不写盘：只做 access 检查） */
export function canWriteTo(dir) {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 目标路径状态（存在 / 可写 / 最近的已存在上级）。
 * @returns {{ok:boolean, exists:boolean, isFile:boolean, writable:boolean, ancestor:string, why:string}}
 */
export function targetState(dir) {
  const p = normalizePath(dir)
  if (!p) return { ok: false, exists: false, isFile: false, writable: false, ancestor: '', why: '路径为空' }
  let st = null
  try { st = statSync(p) } catch (e) { st = null }
  if (st) {
    if (!st.isDirectory()) {
      return { ok: false, exists: true, isFile: true, writable: false, ancestor: '', why: '同名路径已被文件占用（应为目录）' }
    }
    const w = canWriteTo(p)
    return { ok: w, exists: true, isFile: false, writable: w, ancestor: p, why: w ? '' : '目录存在但没有写权限' }
  }
  let cur = p
  for (let i = 0; i < 64; i++) {
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
    try {
      if (statSync(cur).isDirectory()) {
        const w = canWriteTo(cur)
        return { ok: w, exists: false, isFile: false, writable: w, ancestor: cur, why: w ? '' : '上级目录 ' + cur + ' 没有写权限' }
      }
    } catch (e) { /* 继续向上 */ }
  }
  return { ok: false, exists: false, isFile: false, writable: false, ancestor: '', why: '找不到可写的上级目录' }
}

/** 单个目录路径合法性 + 可写性（返回一条 check） */
export function checkDirectory(id, label, dir, env) {
  const raw = typeof dir === 'string' ? dir.trim() : ''
  if (!raw) return check(id, label, 'block', '未填写：该目录为必填项')
  const p = normalizePath(raw)
  if (!isAbsolute(p)) return check(id, label, 'block', '必须是绝对路径：' + raw)
  if (isHomePath(p, env)) return check(id, label, 'block', '不能是用户主目录（会把结构与记忆写进家目录）：' + p.replace(/\\/g, '/'))
  const st = targetState(p)
  if (!st.ok) return check(id, label, 'block', st.why || '路径不可用')
  if (st.exists) return check(id, label, 'ok', '目录已存在且可写：' + p.replace(/\\/g, '/'))
  return check(id, label, 'warn', '目录不存在，将按需新建（上级 ' + String(st.ancestor).replace(/\\/g, '/') + ' 可写）')
}

/**
 * 环境就绪三项（复用 /check 的探针结果）。
 * @param {object} report runProbes 的返回
 * @returns {object[]}
 */
export function environmentChecks(report) {
  const items = (report && Array.isArray(report.items)) ? report.items : []
  const byId = {}
  for (const it of items) byId[it.id] = it
  const out = []

  const sub = byId.subPlugins
  if (!sub) {
    out.push(check('envMemoryPlugin', '记忆库插件', 'block', '环境检查里没有子插件项（/check 未返回），无法判定'))
  } else {
    const detail = String(sub.detail || '')
    const name = MEMORY_PLUGIN_NAME
    const installed = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '@').test(detail)
    out.push(check('envMemoryPlugin', '记忆库插件', installed ? 'ok' : 'block',
      installed ? name + ' 已安装' : '未安装 ' + name + '：到「安装与检查」页安装后重启 DSH'))
  }

  const py = byId.python
  if (!py) {
    out.push(check('envPython', 'Python 解释器', 'block', '环境检查里没有 Python 项，无法判定'))
  } else if (py.status !== 'ok') {
    out.push(check('envPython', 'Python 解释器', 'block', '不可用：' + (py.detail || py.value || '未检测到可用的 Python')))
  } else {
    const m = /(\d+)\.(\d+)/.exec(String(py.value || ''))
    const major = m ? Number(m[1]) : 0
    const minor = m ? Number(m[2]) : 0
    const enough = major > 3 || (major === 3 && minor >= 10)
    out.push(check('envPython', 'Python 解释器', enough ? 'ok' : 'block',
      enough ? 'Python ' + py.value + '（需 ' + MIN_PYTHON + ' 以上）' : '版本过低：' + py.value + '（需 ' + MIN_PYTHON + ' 以上，建议 3.12）'))
  }

  const deps = byId.pythonDeps
  if (!deps) {
    out.push(check('envPythonDeps', 'Python 工具', 'block', '环境检查里没有 Python 依赖项，无法判定'))
  } else {
    out.push(check('envPythonDeps', 'Python 工具', deps.status === 'ok' ? 'ok' : 'block',
      deps.status === 'ok' ? '依赖就绪：' + (deps.value || '') : '依赖不齐：' + (deps.value || '') + '（' + (deps.detail || '') + '）'))
  }
  return out
}

/**
 * 路径与冲突检查。
 * @param {{memoryDir?:string, obsidianDir?:string, workspace?:string, env?:object}} options
 * @returns {object[]}
 */
export function pathChecks(options = {}) {
  const env = options.env || process.env
  const memoryDir = typeof options.memoryDir === 'string' ? options.memoryDir.trim() : ''
  const obsidianDir = typeof options.obsidianDir === 'string' ? options.obsidianDir.trim() : ''
  const out = []

  out.push(checkDirectory('memoryDir', '记忆库目录', memoryDir, env))
  out.push(checkDirectory('obsidianDir', 'Obsidian 知识库目录', obsidianDir, env))

  const memOk = memoryDir && isAbsolute(normalizePath(memoryDir)) && !isHomePath(normalizePath(memoryDir), env)
  const obsOk = obsidianDir && isAbsolute(normalizePath(obsidianDir)) && !isHomePath(normalizePath(obsidianDir), env)

  if (memOk && obsOk) {
    const vm = volumeOf(memoryDir)
    const vo = volumeOf(obsidianDir)
    out.push(check('sameVolume', '同工作区', vm === vo ? 'ok' : 'block',
      vm === vo ? '两个目录在同一卷（' + vm + '）' : '两个目录跨盘（' + vm + ' vs ' + vo + '）：跨盘写入与镜像同步可能受权限范围限制，请改到同一盘符下'))

    const nested = isSameOrNested(memoryDir, obsidianDir)
    if (nested) {
      out.push(check('noNesting', '目标无冲突', 'block', '两个目录相同或互相嵌套：请各选一个独立目录（记忆库与知识库不能放在同一处）'))
    } else {
      out.push(check('noNesting', '目标无冲突', 'ok', '两个目录相互独立，无嵌套'))
    }

    const ws = typeof options.workspace === 'string' ? options.workspace.trim() : ''
    if (ws) {
      const vw = volumeOf(ws)
      const sameAsMem = vw === vm
      out.push(check('workspaceVolume', '工作区同盘', sameAsMem ? 'ok' : 'warn',
        sameAsMem ? '工作区与两个目录同盘' : '工作区在 ' + vw + '、目标目录在 ' + vm + '：跨盘时技能与指令层写入可能受限（不阻断，仅提示）'))
    }
  } else {
    out.push(check('sameVolume', '同工作区', 'block', '两个目录都填写且合法后才能判定同工作区'))
    out.push(check('noNesting', '目标无冲突', 'block', '两个目录都填写且合法后才能判定冲突'))
  }

  // 既有 MEMORY.md 的结构判定：能解析出条目才继续（绝不覆盖使用者数据）
  if (memOk) {
    const memoryFile = join(normalizePath(memoryDir), 'MEMORY.md')
    let text = null
    try { text = existsSync(memoryFile) ? statSync(memoryFile).isFile() ? 'file' : 'dir' : null } catch (e) { text = null }
    if (text === 'dir') {
      out.push(check('memoryFileConflict', '记忆库目标', 'block', 'MEMORY.md 位置已被同名目录占用：' + memoryFile.replace(/\\/g, '/')))
    } else if (text === 'file') {
      let content = ''
      try { content = readFileSync(memoryFile, 'utf8') } catch (e) { content = '' }
      const entries = parseEntries(content)
      if (content.trim() !== '' && entries.length === 0) {
        out.push(check('memoryFileConflict', '记忆库目标', 'block', '既有 MEMORY.md 读不出任何条目（不是本集成体的记忆库格式）：已拒绝写入，避免覆盖你的数据'))
      } else {
        out.push(check('memoryFileConflict', '记忆库目标', 'ok', '既有 MEMORY.md 可解析（' + entries.length + ' 条）：只补缺失、不覆盖'))
      }
    } else {
      out.push(check('memoryFileConflict', '记忆库目标', 'ok', '还没有 MEMORY.md：将新建'))
    }
  }

  // 知识库目标：主页 / 00_全局记忆 / .obsidian 已存在时一律「保留不覆盖」
  if (obsOk) {
    const vault = normalizePath(obsidianDir)
    const home = join(vault, '🏠 主页.md')
    const mirror = join(vault, '00_全局记忆')
    const obsidian = join(vault, '.obsidian')
    const parts = []
    parts.push(existsSync(home) ? '主页已存在（保留不覆盖）' : '主页将新建')
    if (existsSync(mirror)) {
      let isDir = false
      try { isDir = statSync(mirror).isDirectory() } catch (e) { isDir = false }
      parts.push(isDir ? '00_全局记忆 已存在（保留）' : '00_全局记忆 被同名文件占用（冲突）')
      if (!isDir) {
        out.push(check('vaultConflict', '知识库目标', 'block', '00_全局记忆 位置已被同名文件占用：' + mirror.replace(/\\/g, '/')))
      }
    } else {
      parts.push('00_全局记忆 将新建')
    }
    parts.push(existsSync(obsidian) ? '.obsidian 已存在（只补缺失配置）' : '.obsidian 将新建最小配置')
    if (!out.some((c) => c.id === 'vaultConflict')) out.push(check('vaultConflict', '知识库目标', 'ok', parts.join('；')))
  }

  return out
}

/**
 * 跑一次可用性检查（**只读**）。
 * @param {{report?:object, memoryDir?:string, obsidianDir?:string, workspace?:string, env?:object}} options
 * @returns {{ok:boolean, ready:boolean, checks:object[], summary:object}}
 */
export function runPreflight(options = {}) {
  const checks = environmentChecks(options.report).concat(pathChecks(options))
  const summary = { total: checks.length, ok: 0, warn: 0, block: 0 }
  for (const c of checks) {
    if (c.level === 'ok') summary.ok += 1
    else if (c.level === 'warn') summary.warn += 1
    else summary.block += 1
  }
  return { ok: true, ready: summary.block === 0, checks: checks, summary: summary }
}
