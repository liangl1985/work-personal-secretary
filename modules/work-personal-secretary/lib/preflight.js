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
 *   - 同工作区：两个目标目录**建议**同盘。设计定稿决议 9 原写「跨盘 → 拦截并给出理由」，
 *     但**使用者 2026-09-16 真机验收时修正为「仅提示不拦截」**（跨盘只是不建议，不构成实际限制）：
 *     该项判 'warn'，不参与 ready 判定，执行链可以继续；确实出现写入失败或同步中断时再考虑同盘。
 *   - 目标冲突：两目录**相同或互相嵌套只提示、不拦截**（使用者 2026-09-16 真机验收第二轮裁定，与「跨盘」同口径：
 *     属「不建议」而非「不允许」，检查不得成为实际限制）。判定按方向分开给文案（相同 / 记忆库在知识库内 /
 *     知识库在记忆库内），因为三种形态的后果不同。既有 MEMORY.md 必须能被解析为条目结构，否则拒绝
 *     （绝不覆盖使用者数据）—— **这一条仍是 block**，与嵌套无关。
 *
 * @module work-personal-secretary/preflight
 */

import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { parseEntries } from './identity.js'
import { isHomePath, normalizePath, readFileStrict } from './basedeck.js'

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

/**
 * 记忆库目录与知识库目录的关系形态（大小写不敏感：Windows 路径不区分大小写）。
 * 分开判方向是**为了把话说对**：三种形态的后果不同，提示文案必须各说各的。
 * @param {string} memoryDir 记忆库目录
 * @param {string} obsidianDir 知识库（Obsidian vault）目录
 * @returns {'same'|'memory-in-obsidian'|'obsidian-in-memory'|'separate'}
 */
export function relationOf(memoryDir, obsidianDir) {
  const x = normalizePath(memoryDir).toLowerCase().replace(/[\\/]+$/, '')
  const y = normalizePath(obsidianDir).toLowerCase().replace(/[\\/]+$/, '')
  if (!x || !y) return 'separate'
  if (x === y) return 'same'
  const withSep = (p) => p + sep
  if (x.indexOf(withSep(y)) === 0) return 'memory-in-obsidian'
  if (y.indexOf(withSep(x)) === 0) return 'obsidian-in-memory'
  return 'separate'
}

/** a 与 b 是否相同、或一个包含另一个（判定唯一实现在 relationOf，避免两份口径漂移） */
export function isSameOrNested(a, b) {
  return relationOf(a, b) !== 'separate'
}

/**
 * 关系形态 → 提示文案。**全部是提示、不是拦截**：每种都写明后果 + 写明「不阻断」。
 * 为什么要有这张表：一句话把三种形态揉在一起说，使用者看不出自己那样放到底会怎样。
 */
export const NESTING_DETAIL = {
  same: '两个目录相同：记忆库正文（MEMORY.md / USER.md / PROJECTS / DAILY / ARCHIVE / GRAPH.json）会直接落在知识库根目录（**不阻断**，可继续；若不希望知识库根目录混入记忆文件，给记忆库单独一个空文件夹即可）',
  'memory-in-obsidian': '记忆库在知识库目录内：同一份内容会在知识库里出现两次（记忆库原目录 + 00_全局记忆 镜像），记忆文件也会被 Obsidian 一并索引（**不阻断**，可继续）',
  'obsidian-in-memory': '知识库在记忆库目录内：知识库整棵树会落在记忆库底下，记忆库的归档与检索会一并看到知识库文件（**不阻断**，可继续；反过来放更清爽）',
  separate: '两个目录相互独立，无嵌套',
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
    out.push(check('sameVolume', '同工作区', vm === vo ? 'ok' : 'warn',
      vm === vo
        ? '两个目录在同一卷（' + vm + '）'
        : '两个目录跨盘（' + vm + ' vs ' + vo + '）：不建议跨盘——跨盘写入与镜像同步可能受权限范围限制（不阻断，可继续；若后续出现写入失败或同步中断，再考虑改到同一盘符）'))

    // 目标冲突：**只提示、不阻断**。使用者 2026-09-16 真机验收第二轮裁定（承接跨盘那条）：
    // 「把记忆库放进长期使用的主工作区」本来就是本页字段说明自己推荐的用法，
    // 不能一边推荐一边把执行链卡死在第一步。level 恒为 ok / warn，**永不 block**，不参与 ready。
    const rel = relationOf(memoryDir, obsidianDir)
    out.push(check('noNesting', '目标无冲突', rel === 'separate' ? 'ok' : 'warn', NESTING_DETAIL[rel]))

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
    const strict = readFileStrict(memoryFile)
    let st = null
    try { st = statSync(memoryFile) } catch (e) { st = null }
    if (st && !st.isFile()) {
      out.push(check('memoryFileConflict', '记忆库目标', 'block', 'MEMORY.md 位置已被同名目录占用：' + memoryFile.replace(/\\/g, '/')))
    } else if (strict.exists && !strict.readable) {
      // 小5：EACCES / EBUSY 等读失败**不能**当成「不存在」——否则会误判「将新建」，
      // 真写时才发现在一个读不到的文件上踩空。这里直接判 block。
      out.push(check('memoryFileConflict', '记忆库目标', 'block',
        '既有 MEMORY.md 存在但读不到（' + (strict.code || 'EACCES') + '）：已拒绝写入；请检查文件权限或占用后重试'))
    } else if (strict.readable) {
      const entries = parseEntries(strict.text)
      if (strict.text.trim() !== '' && entries.length === 0) {
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
