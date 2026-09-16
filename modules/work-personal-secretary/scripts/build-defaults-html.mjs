/**
 * work-personal-secretary —— 由 defaults/*.md 生成随包 HTML 说明页
 *
 * 用法：node scripts/build-defaults-html.mjs
 *
 * 定位：
 *   · **单一真相源仍是 defaults/*.md**；本脚本用 lib/md.js 的 renderPage 渲染出完整文档，
 *     写到 defaults/*.html —— 这两个 HTML 就是「打开插件目录里的说明文件」要打开的东西；
 *   · HTML 是**受校验的产物**：scripts/defaults-test.mjs 会逐字节比对「磁盘上的 HTML」与
 *     「用当前 md.js 现渲染的结果」，改了 md 忘了重生成，测试即红；
 *   · 只在维护时手动跑一次（不是运行时构建步骤），产物随包签入。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderMarkdown, renderPage } from '../lib/md.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULTS = join(HERE, '..', 'defaults')

/** 与 lib/api.js 的 DOC_SPECS 保持一致（md ↔ html ↔ 标题） */
const PAIRS = [
  { md: 'install.zh-CN.md', html: 'install.zh-CN.html', title: '工作秘书 · 安装引导' },
  { md: 'use.zh-CN.md', html: 'use.zh-CN.html', title: '工作秘书 · 使用说明' },
]

let written = 0
for (const p of PAIRS) {
  const md = readFileSync(join(DEFAULTS, p.md), 'utf8')
  const html = renderPage(p.title, renderMarkdown(md))
  writeFileSync(join(DEFAULTS, p.html), Buffer.from(html, 'utf8'))
  written += 1
  console.log('generated defaults/' + p.html + '（' + Buffer.byteLength(html, 'utf8') + ' 字节）')
}
console.log('done：' + written + ' 个 HTML 已按 defaults/*.md 重新生成')
