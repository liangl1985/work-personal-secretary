/**
 * work-personal-secretary —— 目录选择后端（宿主 `ctx.directoryPicker` 的能力分支代理）
 *
 * 背景（一手依据，2026-09-16 查证宿主包）：
 *   · `@deepseek-ai/dsh-host-directory-picker` 把目录选择做成**可判别能力**（discriminated
 *     capability）：`capability()` 返回 `{ kind:'native', pick() }` 或
 *     `{ kind:'browse', list(path, signal), createDirectory(path, name) }`；
 *     该包模块注释的口径是「消费方 switch on capability().kind，未知类型应隐藏入口而不是失败」。
 *   · `-native` 后端只在操作者能看到宿主屏幕时可用（darwin/win32 默认、linux 需 DISPLAY 加
 *     chooser 二进制，且要求 loopback 绑定、非 SSH 启动）；`-auto` 对不能确定的场景一律解析到 browse。
 *   · `-browse` 后端用 Node 标准库在宿主文件系统上作答：`list` 只回**目录**（含指向目录的软链），
 *     带 `crumbs`（从文件系统根到当前目录、每级可跳）与 `truncated`（有界窗口，默认 1000 条）；
 *     `createDirectory` 只建**一层**；失败抛 `DirectoryPickerError { code, path, message }`，
 *     code 是封闭业务码：directory-unreadable / directory-exists / directory-create-failed。
 *
 * 本模块的职责：把两个原语包成本插件两个路由的**纯逻辑**（返回 `{ status, body }`），
 * 由 lib/api.js 的 prefix 分发调用；本模块不碰 HTTP 对象，也不执行任何命令。
 *
 * 纪律：
 *   1. 服务**运行时取值**（`ctx.get('directoryPicker')`）——绝不写进 `inject`：
 *      没装该服务的环境不能让整个插件加载失败；
 *   2. 按 `kind` 分支：browse 走原语；native 明确告知「由系统对话框完成选择」；
 *      服务缺失 / 能力不可用给可读降级。三种情况都**不抛异常、不 500**；
 *   3. 入参只接受**完全限定的绝对路径**（与 browse 后端的 fullyQualified 同口径）：
 *      Windows 需盘符（如 C: 后接分隔符）或完整 UNC（两反斜杠 + 服务器 + 共享）；
 *      无盘符的 \foo 与 /foo 会落在进程当前盘，一律拒；
 *   4. 发布件中立：不写死任何使用者信息与本机绝对路径。
 *
 * @module work-personal-secretary/dirs
 */

import { dirname, posix as posixPath, win32 as win32Path } from 'node:path'

import { posix } from './install.js'

/** path 参数长度上限（与 /identity 的 1024 同口径） */
export const DIRS_PATH_MAX = 1024
/** 新目录名单段长度上限（Windows 单段文件名上限 255，取更保守的 128） */
export const DIRS_NAME_MAX = 128

/** 失败消息里回溯宿主原文的截断长度 */
const RAW_MSG_MAX = 200

/** DirectoryPickerError 业务码 → 可读中文（code 本身照原样透传，不做字符串匹配） */
export const DIRS_ERROR_TEXT = {
  'directory-unreadable': '读不到该目录（不存在 / 无权限 / 不是目录）',
  'directory-exists': '同名目录已存在',
  'directory-create-failed': '创建目录失败',
}

function clip(s, n) {
  const t = String(s == null ? '' : s)
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 完全限定绝对路径判定。**口径与 browse 后端 `fullyQualified` 逐字对齐**（见模块注释的查证依据）：
 * Windows 只有盘符限定或完整 UNC 才算「与进程状态无关的固定位置」。
 * @param {unknown} value 候选路径
 * @param {string} [platform] 默认 process.platform（测试可注入）
 */
export function isFullyQualifiedPath(value, platform = process.platform) {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return false
  if (platform === 'win32') return win32Path.isAbsolute(s) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(s)
  return posixPath.isAbsolute(s)
}

/**
 * 运行时取目录选择服务。拿不到（未安装该服务 / capability 不是函数）返回 null。
 * **绝不**把 directoryPicker 写进 inject —— 否则缺该服务的环境整个插件加载失败。
 */
export function getDirectoryPicker(ctx) {
  try {
    if (!ctx || typeof ctx.get !== 'function') return null
    const svc = ctx.get('directoryPicker')
    return (svc && typeof svc.capability === 'function') ? svc : null
  } catch (e) {
    return null
  }
}

/** 读 capability（可能抛、可能给非对象）→ 对象或 null */
export function pickerCapability(service) {
  try {
    const cap = service && typeof service.capability === 'function' ? service.capability() : null
    return (cap && typeof cap === 'object') ? cap : null
  } catch (e) {
    return null
  }
}

/** 服务缺失 / 能力不可用的可读降级（{status:200, body} 形态：这是「本机形态」而不是「你的入参错了」） */
export function pickerDegrade(serviceMissing, kind, missingOp) {
  if (!serviceMissing && kind === 'native') {
    return {
      status: 200,
      body: {
        ok: false, kind: 'native', code: 'native-only',
        message: '当前载体使用系统目录选择器，请在界面里点「浏览…」由系统对话框完成选择',
      },
    }
  }
  if (!serviceMissing && kind) {
    return {
      status: 200,
      body: {
        ok: false, kind: String(kind), code: 'unsupported-capability',
        message: '当前载体的目录选择能力是「' + String(kind) + '」，本接口只实现 browse（listing）与 native（系统对话框）两种'
          + (missingOp ? '；该能力未提供 ' + missingOp + ' 原语' : '') + '：请手动输入路径',
      },
    }
  }
  return {
    status: 200,
    body: {
      ok: false, kind: 'none', kindMissing: true, code: 'no-service',
      message: '宿主未提供目录选择服务（未安装目录选择插件 / 服务未注册）：请手动输入路径',
    },
  }
}

/** 入参错误（400）：这是「调用方给错了」，与「本机形态」严格区分 */
export function badInput(code, message) {
  return { status: 400, body: { ok: false, code: code, message: message } }
}

/** 把宿主抛出的 DirectoryPickerError 归一成 { code, path, message }（**只读字段，不做字符串猜语义**） */
export function pickerFailure(err) {
  const code = (err && typeof err.code === 'string') ? err.code : ''
  const path = (err && typeof err.path === 'string') ? posix(err.path) : ''
  const raw = String(err && err.message ? err.message : err)
  const zh = DIRS_ERROR_TEXT[code] || '目录操作失败'
  return {
    code: code || 'unknown',
    path: path,
    message: zh + '（code=' + (code || 'unknown') + '）' + (raw ? '：' + clip(raw, RAW_MSG_MAX) : ''),
  }
}

/** 取服务与能力；不可用时返回降级结果（调用方直接返回它） */
function pickerFor(ctx) {
  const service = getDirectoryPicker(ctx)
  if (!service) return { degrade: pickerDegrade(true, '', '') }
  const cap = pickerCapability(service)
  if (!cap) return { degrade: pickerDegrade(true, '', '') }
  const kind = typeof cap.kind === 'string' ? cap.kind : ''
  if (kind === 'native') return { degrade: pickerDegrade(false, 'native', '') }
  if (kind !== 'browse') return { degrade: pickerDegrade(false, kind, '') }
  if (typeof cap.list !== 'function') return { degrade: pickerDegrade(false, kind, 'list') }
  return { service: service, cap: cap, kind: kind }
}

/**
 * GET /dirs 的纯逻辑：列一层目录。
 * @param {object} ctx cordis context（运行时取 ctx.get('directoryPicker')）
 * @param {{path?:string, platform?:string, signal?:AbortSignal}} [options]
 * @returns {Promise<{status:number, body:object}>}
 */
export async function listDirectories(ctx, options = {}) {
  const platform = options.platform || process.platform
  const raw = typeof options.path === 'string' ? options.path.trim() : ''
  const picked = pickerFor(ctx)
  if (picked.degrade) return picked.degrade
  // 入参校验：**不传 path 参数**= 用宿主默认位置（浏览器的入口点，browse 后端会回落到用户主目录）；
  // 传了但为空 / 相对 / 超长 → 400（宁可不猜，也不把错误路径当默认）。
  if (options.path !== undefined && raw === '') return badInput('bad-path', 'path 不能为空：不传该参数表示用宿主默认位置，传了就必须是完全限定的绝对路径')
  if (raw.length > DIRS_PATH_MAX) return badInput('path-too-long', 'path 过长（上限 ' + DIRS_PATH_MAX + ' 字符，实测 ' + raw.length + '）')
  if (raw && !isFullyQualifiedPath(raw, platform)) {
    return badInput('bad-path', 'path 必须是完全限定的绝对路径：Windows 需盘符（如 C: 后接分隔符）或完整 UNC（两反斜杠 + 服务器 + 共享）；无盘符的 \\foo 与 /foo 会落在当前盘，已拒绝')
  }

  let result = null
  try {
    result = await picked.cap.list(raw || undefined, options.signal)
  } catch (err) {
    const fail = pickerFailure(err)
    return { status: 200, body: { ok: false, kind: 'browse', code: fail.code, path: fail.path || posix(raw), message: fail.message } }
  }
  const served = String((result && result.path) || raw || '')
  const entries = (Array.isArray(result && result.entries) ? result.entries : [])
    .map((e) => ({
      name: String((e && e.name) || ''),
      path: posix(String((e && e.path) || '')),
      hidden: Boolean(e && e.hidden),
    }))
    .filter((e) => e.name !== '' && e.path !== '')
  const crumbs = (Array.isArray(result && result.crumbs) ? result.crumbs : [])
    .map((c) => ({ name: String((c && c.name) || ''), path: posix(String((c && c.path) || '')) }))
    .filter((c) => c.path !== '')
  const up = dirname(served)
  const truncated = Boolean(result && result.truncated)
  return {
    status: 200,
    body: {
      ok: true,
      kind: 'browse',
      path: posix(served),
      parent: up && up !== served ? posix(up) : '',
      home: result && result.home ? posix(String(result.home)) : '',
      crumbs: crumbs,
      entries: entries,
      truncated: truncated,
      message: '已列出 ' + entries.length + ' 个目录' + (truncated ? '（该层目录过多，已按名称排序截断）' : ''),
    },
  }
}

/**
 * POST /dirs/new 的纯逻辑：在父目录下建一个子目录（只建一层）。
 * @param {object} ctx cordis context
 * @param {{path?:string, name?:string, platform?:string}} [options]
 * @returns {Promise<{status:number, body:object}>}
 */
export async function createChildDirectory(ctx, options = {}) {
  const platform = options.platform || process.platform
  const parent = typeof options.path === 'string' ? options.path.trim() : ''
  const name = typeof options.name === 'string' ? options.name.trim() : ''
  if (parent === '') return badInput('bad-path', 'path（父目录）不能为空：必须是完全限定的绝对路径')
  if (parent.length > DIRS_PATH_MAX) return badInput('path-too-long', 'path 过长（上限 ' + DIRS_PATH_MAX + ' 字符，实测 ' + parent.length + '）')
  if (!isFullyQualifiedPath(parent, platform)) {
    return badInput('bad-path', 'path 必须是完全限定的绝对路径：Windows 需盘符（如 C: 后接分隔符）或完整 UNC（两反斜杠 + 服务器 + 共享）；无盘符的 \\foo 与 /foo 会落在当前盘，已拒绝')
  }
  if (name === '') return badInput('bad-name', 'name 不能为空：只接受单个目录名（不含路径分隔符）')
  if (name.length > DIRS_NAME_MAX) return badInput('bad-name', 'name 过长（上限 ' + DIRS_NAME_MAX + ' 字符，实测 ' + name.length + '）')
  if (name === '.' || name === '..' || /[\\/]/.test(name)) {
    return badInput('bad-name', 'name 必须是单个目录名：不能是 . 或 ..，也不能含路径分隔符')
  }

  const picked = pickerFor(ctx)
  if (picked.degrade) return picked.degrade
  if (typeof picked.cap.createDirectory !== 'function') return pickerDegrade(false, picked.kind, 'createDirectory')

  try {
    const created = await picked.cap.createDirectory(parent, name)
    return { status: 200, body: { ok: true, path: posix(String(created || '')) } }
  } catch (err) {
    const fail = pickerFailure(err)
    return { status: 200, body: { ok: false, kind: 'browse', code: fail.code, path: fail.path, message: fail.message } }
  }
}
