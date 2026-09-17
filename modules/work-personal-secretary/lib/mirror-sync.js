/**
 * 记忆镜像同步 · 集成体侧触发（T5-4）
 *
 * 背景：镜像同步（`syncMemoryToObsidian`）原本只在 work-memory 的三条写路径后触发
 * （remember / link / 冷召回转热，`modules/dsh-work-memory/lib/tools.js:61`）。
 * 于是使用者「一键配置」跑完之后，镜像区（知识库里的 `00_全局记忆`）**仍是空的** ——
 * 配置动作本身不经过那三条写路径。本模块提供**尽力而为**的一次触发：集成体在执行链
 * 收尾（写身份成功）后调它，让「配置完就能看到镜像内容」成立。
 *
 * 入口怎么选（2026-09-17 实测，三条路都试过）：
 *   · **不**用裸包名 `import('dsh-work-memory')` —— 集成体是零依赖插件，repo 直跑时
 *     解析链里没有该包（子插件按 profile / repo / bundled 三个候选目录加载，见
 *     `lib/settings-api.js:284` 对 dsh-experts 的同款处理）；
 *   · **不**导 `lib/index.js` —— 它顶层 import 了宿主 peer `@deepseek-ai/dsh-tools`，
 *     集成体侧无法保证可解析；实测 `ERR_MODULE_NOT_FOUND`（本地与 CI 一致）；
 *   · 因此按**候选目录 → `lib/backup.js`** 加载：该文件只用 node 内置（+ 同包 `clock.js`），
 *     与 work-memory 同仓库、同批次发布，路径由两边 CHANGELOG 同步维护。
 *
 * 设计约束：
 *   · **绝不阻断主流程**：三个候选都找不到 / 导入失败 / 同步抛错，一律吞掉并返回可读 reason，
 *     调用方照常判定执行链成功；
 *   · 只读入参来自调用方（记忆库目录、镜像目录与三个候选根目录），本模块自己不解析设置；
 *   · 返回体只带**数值与枚举**（files / pruned / source），不回传路径。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * work-memory 镜像同步实现的候选位置（顺序即优先级：profile → repo → bundled）。
 * 与 `lib/settings-api.js` 的 `expertsModuleCandidates()` 同构。
 * @param {{profileDir?:string, repoRoot?:string, moduleDir?:string}} paths
 * @returns {Array<{source:string, file:string}>}
 */
export function memoryMirrorCandidates(paths = {}) {
  const out = []
  const profileDir = typeof paths.profileDir === 'string' ? paths.profileDir.trim() : ''
  const repoRoot = typeof paths.repoRoot === 'string' ? paths.repoRoot.trim() : ''
  const moduleDir = typeof paths.moduleDir === 'string' ? paths.moduleDir.trim() : ''
  if (profileDir) out.push({ source: 'profile', file: join(profileDir, 'node_modules', 'dsh-work-memory', 'lib', 'backup.js') })
  if (repoRoot) out.push({ source: 'repo', file: join(repoRoot, 'modules', 'dsh-work-memory', 'lib', 'backup.js') })
  if (moduleDir) out.push({ source: 'bundled', file: join(moduleDir, '..', 'dsh-work-memory', 'lib', 'backup.js') })
  return out
}

/** 单行化 + 截断，避免把多行栈或超长文本回给客户端 */
function oneline(v, max = 200) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * 动态载入 work-memory 的镜像同步实现。
 * @returns {Promise<{fn:Function, source:string}|null>} 拿不到返回 null（不抛）
 */
async function loadSyncFn(paths) {
  for (const c of memoryMirrorCandidates(paths)) {
    if (!existsSync(c.file)) continue
    try {
      const mod = await import(pathToFileURL(c.file).href)
      const fn = mod && mod.syncMemoryToObsidian
      if (typeof fn === 'function') return { fn: fn, source: c.source }
    } catch (e) {
      // 单个候选坏掉不影响下一个（例如该副本被截断 / 依赖不齐）
    }
  }
  return null
}

/**
 * 尽力而为地同步一次记忆镜像。
 * @param {{memoryDir?:string, obsidianDir?:string,
 *          paths?:{profileDir?:string, repoRoot?:string, moduleDir?:string},
 *          logger?:{info?:Function, warn?:Function}}} o
 * @returns {Promise<{ok:boolean, skipped:boolean, source?:string, files?:number,
 *          pruned?:number, reason?:string}>} 永远 resolve，绝不 reject。
 */
export async function syncMirrorBestEffort(o = {}) {
  const memoryDir = typeof o.memoryDir === 'string' ? o.memoryDir.trim() : ''
  const obsidianDir = typeof o.obsidianDir === 'string' ? o.obsidianDir.trim() : ''
  if (!memoryDir || !obsidianDir) {
    return { ok: false, skipped: true, reason: '缺少记忆库目录或镜像目录，跳过镜像同步' }
  }
  const found = await loadSyncFn(o.paths)
  if (found === null) {
    return { ok: false, skipped: true, reason: '未找到 dsh-work-memory 的镜像同步实现（未安装或版本过旧），跳过镜像同步' }
  }
  try {
    const result = await found.fn(memoryDir, obsidianDir)
    if (!result || result.ok !== true) {
      return { ok: false, skipped: true, source: found.source, reason: '镜像同步未完成：' + oneline((result && result.error) || '未知原因') }
    }
    const files = Number(result.files) || 0
    const pruned = Number(result.pruned) || 0
    try { o.logger?.info?.('[work-personal-secretary] 记忆镜像已同步（' + found.source + '）：' + files + ' 个文件') } catch (e) { /* 日志失败不影响 */ }
    return { ok: true, skipped: false, source: found.source, files: files, pruned: pruned }
  } catch (e) {
    const reason = oneline((e && e.message) || e)
    try { o.logger?.warn?.('[work-personal-secretary] 记忆镜像同步失败（不阻断配置）：' + reason) } catch (e2) { /* 同上 */ }
    return { ok: false, skipped: true, source: found.source, reason: '镜像同步失败（不影响配置结果）：' + reason }
  }
}
