/**
 * dsh-doc-suite —— 文档能力模块（宿主半）
 *
 * 定位：本模块的**能力实现是 Python 脚本 + DSH 原生技能**（`scripts/` + `skills/`），
 * 宿主半只做一件事——提供**环境自检入口**（`/doc-doctor`），把 `doctor.py` 的结论回报给使用者，
 * 并在缺依赖时给出可直接复制的修复命令。刻意**不在 Node 侧重复实现文档处理**。
 *
 * 为什么要有这个入口：本模块有两个"硬前置"——Python >= 3.10 与 WPS Office（COM）。
 * DSH 插件安装器（pnpm/Node 侧）无法也不应替使用者安装解释器或商业软件，
 * 因此统一由 doctor.py 检测 → 给出修复命令 → 使用者确认后执行（"按需补全"）。
 *
 * @module dsh-doc-suite
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { installSettings, mediaSummary, SETTINGS_NS } from './settings.js'

export const name = 'dsh-doc-suite'
export const inject = ['commands', 'settings']

const MODULE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCTOR = join(MODULE_ROOT, 'doctor.py')

/** 在给定启动器名上跑 doctor.py（失败时回退试另一批启动器） */
function runDoctor(launcher, args, timeoutMs = 60000) {
  const parts = String(launcher || 'py -3').trim().split(/\s+/)
  const [cmd, ...pre] = parts
  return new Promise((resolve) => {
    execFile(cmd, [...pre, DOCTOR, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err && typeof err.code !== 'undefined' ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }))
  })
}

export function apply(ctx, config = {}) {
  const disposers = []
  const launcher = config.pythonLauncher || 'py -3'
  // 媒体设置（生图/生视频）：密钥默认空、不进日志；环境变量优先于设置项（脚本侧读取）
  const settings = installSettings(ctx, config)

  function mediaLine() {
    const s = mediaSummary(settings.read())
    return [
      '媒体设置：provider ' + s.provider,
      '生图 ' + (s.imageEnabled ? '开' : '关') + '（模型 ' + s.model + ' / 尺寸 ' + s.size + '）',
      'ARK 密钥 ' + (s.hasApiKey ? '已配置（不显示明文）' : '未配置 → 生图将回退代码矢量绘制'),
      '生视频 ' + (s.videoEnabled ? '开' : '关'),
      '设置命名空间 ' + SETTINGS_NS + ' ' + (settings.available ? '已注册（设置 → 插件 → dsh-doc-suite）' : '不可用（已降级为默认值，功能仍可用）'),
    ].join(' ｜ ')
  }

  disposers.push(ctx.commands.register({
    name: 'doc-doctor',
    description: '文档能力环境自检：检查 Python 版本、依赖库、WPS COM，缺什么给出修复命令（用法：/doc-doctor [--fix]）',
    handler: async ({ rawInput } = {}) => {
      if (!existsSync(DOCTOR)) {
        return { kind: 'error', text: '未找到 doctor.py：' + DOCTOR }
      }
      const wantFix = /--fix/.test(String(rawInput || ''))
      const attempts = [launcher, 'py -3', 'python3', 'python'].filter((v, i, a) => v && a.indexOf(v) === i)
      let last = null
      for (const l of attempts) {
        const r = await runDoctor(l, wantFix ? ['--fix'] : [])
        last = r
        if (r.ok) {
          return { kind: 'success', text: (r.stdout || '').trim() + '\n' + mediaLine() }
        }
        const out = (r.stdout || '') + (r.stderr || '')
        if (!/was not found|Microsoft Store|No such file|ENOENT/i.test(out)) {
          // 解释器能跑，但自检未通过（缺依赖/缺 WPS）——直接回报，别继续试别的启动器
          return { kind: out.includes('环境就绪') ? 'success' : 'error', text: out.trim() || '自检未通过' }
        }
      }
      const tail = last ? ((last.stdout || '') + (last.stderr || '')).trim() : ''
      return {
        kind: 'error',
        text: [
          '未找到可用的 Python 解释器（本模块要求 >= 3.10，建议 3.12）。',
          tail ? '\n最后一次尝试输出：\n' + tail.slice(0, 800) : '',
          '\n修复（二选一）：',
          '  1) winget install -e --id Python.Python.3.12',
          '  2) https://www.python.org/downloads/windows/',
          '\n注意：Windows 上请用 `py -3` 调用；`python` 可能是 Microsoft Store 别名 stub。',
        ].join('\n'),
      }
    },
  }))

  // 可选：启动自检（默认关，避免拖慢启动）
  if (config.doctorOnStartup === true) {
    runDoctor(launcher, []).then((r) => {
      if (!r.ok) ctx.logger?.warn?.('dsh-doc-suite: 环境自检未通过，可执行 /doc-doctor 查看修复命令')
      else ctx.logger?.debug?.('dsh-doc-suite: 环境自检通过')
    })
  }

  return () => {
    for (const d of disposers) {
      try { d() } catch { /* best-effort */ }
    }
  }
}
