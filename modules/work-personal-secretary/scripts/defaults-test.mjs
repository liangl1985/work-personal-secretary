/**
 * work-personal-secretary —— 随包说明真相源自检（实施单 T9 验收）
 *
 * 用法：node scripts/defaults-test.mjs
 *
 * 覆盖：
 *   [1] 两个说明文件存在、UTF-8 无 BOM、非空
 *   [2] **敏感过滤自检**：md 与渲染出的 HTML 都不含个人路径 / 称呼姓名 / 凭据 / 客户与项目名
 *   [3] 网页正文与 md **同源**：每个段落 / 标题 / 列表项逐字出现在 HTML 里
 *   [4] HTML 干净：无 <script>、无外部资源引用、声明 charset 与样式
 *   [5] 记忆条目与 md 同源：memoryDeck 写进 PROJECTS/工作秘书.md 的【使用说明】正文 = use.zh-CN.md 全文
 *   [6] package.json：files 白名单含 defaults、exports 暴露 ./defaults/*
 *
 * 隔离：全部写盘发生在 os.tmpdir() 夹具内；只读读取真实 defaults 与 package.json。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { escapeHtml, renderFragment, renderMarkdown, renderPage } from '../lib/md.js'
import { applyBaseDeck } from '../lib/basedeck.js'
import { entryBody, parseEntries } from '../lib/identity.js'

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_DIR = join(HERE, '..')
const DEFAULTS = join(MODULE_DIR, 'defaults')
const FILES = [
  { file: 'use.zh-CN.md', title: '工作秘书 · 使用说明' },
  { file: 'install.zh-CN.md', title: '工作秘书 · 安装引导' },
]

/** 发布件红线：这些串出现在随包说明里就是事故 */
const BANNED = [
  'C:\\Users', '/Users/', 'liangl',
  'E:\\lina', 'D:\\lina', '知识库-天地', '知识库-金融', '生活笔记',
  '天地和兴', '莉娜', '主人',
  'apiKey', 'api_key', 'ARK_API_KEY', 'sk-', 'Bearer ', 'password', 'password=',
  'C:\\', 'D:\\', 'E:\\',
]

/**
 * 把一行 md 拆成「应逐字出现在 HTML 里」的纯文本片段：
 * 行首块级标记去掉，行内 **粗体** / 行内代码按标记切段（HTML 里它们会被包成 <strong>/<code>，
 * 所以不能拿整行做子串比较）。
 */
function fragmentsOf(line) {
  const s = String(line)
    .replace(/^#{1,6}[ \t]+/, '')
    .replace(/^[-*][ \t]+/, '')
    .replace(/^[0-9]+\.[ \t]+/, '')
    .replace(/^>[ \t]?/, '')
  return s.split(/(\*\*[^*]+\*\*|[\u0060][^\u0060]*[\u0060])/g)
    .map((part) => {
      if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') return part.slice(2, -2)
      if (part.length > 2 && part[0] === '\u0060' && part[part.length - 1] === '\u0060') return part.slice(1, -1)
      return part
    })
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const ROOT = mkdtempSync(join(tmpdir(), 'wps-defaults-test-'))
console.log('defaults-test · 夹具 ' + ROOT)

// ───────────────────── [1] 文件健康 ─────────────────────
section('[1] 两个说明文件：存在 / 无 BOM / 非空')
const texts = {}
for (const spec of FILES) {
  const p = join(DEFAULTS, spec.file)
  ok(existsSync(p) && statSync(p).isFile(), 'defaults/' + spec.file + ' 存在')
  const buf = readFileSync(p)
  ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), 'defaults/' + spec.file + ' 无 BOM')
  const text = buf.toString('utf8')
  texts[spec.file] = text
  ok(text.trim().length > 200, 'defaults/' + spec.file + ' 有实质内容（' + text.length + ' 字符）')
  ok(text.indexOf('\r') < 0, 'defaults/' + spec.file + ' 用 LF 行尾')
}

// ───────────────────── [2] 敏感过滤 ─────────────────────
section('[2] 敏感过滤自检（md + 渲染 HTML）')
for (const spec of FILES) {
  const text = texts[spec.file]
  const html = renderPage(spec.title, renderMarkdown(text))
  const hits = BANNED.filter((k) => text.indexOf(k) >= 0)
  ok(hits.length === 0, 'defaults/' + spec.file + ' 不含发布件禁用串' + (hits.length ? '（命中：' + hits.join(' / ') + '）' : ''))
  const htmlHits = BANNED.filter((k) => html.indexOf(k) >= 0)
  ok(htmlHits.length === 0, spec.file + ' 渲染 HTML 不含发布件禁用串' + (htmlHits.length ? '（命中：' + htmlHits.join(' / ') + '）' : ''))
}

// ───────────────────── [3] 网页与 md 同源 ─────────────────────
section('[3] 网页正文与 md 同源（逐段逐字）')
for (const spec of FILES) {
  const text = texts[spec.file]
  const html = renderMarkdown(text)
  const lines = text.split('\n')
  let checked = 0
  const missing = []
  for (const line of lines) {
    if (/^[ \t]*$/.test(line)) continue
    if (/^[ \t]*\|/.test(line)) continue   // 表格行由渲染器拆成单元格，不做整行比对
    if (/^[ \t]*[\u0060]{3}/.test(line)) continue // 代码围栏
    for (const frag of fragmentsOf(line)) {
      checked += 1
      if (html.indexOf(escapeHtml(frag)) < 0) missing.push(frag.slice(0, 30))
    }
  }
  ok(checked > 20 && missing.length === 0, spec.file + '：' + checked + ' 个正文片段全部逐字出现在 HTML 里'
    + (missing.length ? '（缺：' + missing.slice(0, 3).join(' | ') + '）' : ''))
}

// ───────────────────── [4] HTML 干净 ─────────────────────
section('[4] HTML 不含脚本 / 外部资源')
for (const spec of FILES) {
  const html = renderPage(spec.title, renderMarkdown(texts[spec.file]))
  ok(html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('<meta charset="utf-8">') > 0, spec.file + ' HTML 声明 doctype 与 charset')
  ok(html.indexOf('<script') < 0, spec.file + ' 无 <script>')
  ok(html.indexOf('<a href="http') < 0 && html.indexOf('src=') < 0 && html.indexOf('<link') < 0, spec.file + ' 无外部资源与外部跳转')
  ok(html.indexOf('<style>') > 0 && html.indexOf('.wps-doc h1') > 0, spec.file + ' 自带样式（作用域在 .wps-doc，不依赖外部 CSS）')
  const e1 = renderPage('t', renderMarkdown('<script>alert(1)</script>'))
  ok(e1.indexOf('<script>') < 0 && e1.indexOf('&lt;script&gt;') > 0, 'md 里的原始 HTML 会被转义（不直出）')
  const e2 = renderPage('t', renderMarkdown('[x](javascript:alert(1))'))
  ok(e2.indexOf('javascript:') < 0, 'javascript: 链接被降级（防注入）')
}

// ───────────────────── [5] 记忆条目与 md 同源 ─────────────────────
section('[5] 记忆条目【使用说明】【安装说明】与 md 逐字同源')
const HOME = join(ROOT, 'dsh')
const MEM = join(ROOT, 'mem')
const res = applyBaseDeck(['memoryDeck'], {
  dryRun: false, memoryDir: MEM, dshHome: HOME, settingsFile: join(HOME, 'settings.yaml'),
  workspace: join(ROOT, 'ws'), obsidianDir: join(ROOT, 'vault'), moduleDir: MODULE_DIR,
  env: {}, now: new Date('2026-09-16T10:00:00'),
})
ok(res.ok === true, 'memoryDeck 在夹具里真写成功')
const projectText = readFileSync(join(MEM, 'PROJECTS', '工作秘书.md'), 'utf8')
const entries = parseEntries(projectText)
ok(entries.length === 4, '工作秘书.md 共 4 条')
const bodyUse = entryBody(entries[0]).replace('【使用说明】\n', '')
const bodyInstall = entryBody(entries[1]).replace('【安装说明】\n', '')
// 条目读取时 parseEntries 会对整条 trim，末尾那一个换行不在正文里；其余部分必须逐字相等
ok(bodyUse === texts['use.zh-CN.md'].replace(/\n$/, ''), '第 1 条正文 = defaults/use.zh-CN.md 全文（逐字，仅差条目末尾换行）')
ok(bodyInstall === texts['install.zh-CN.md'].replace(/\n$/, ''), '第 2 条正文 = defaults/install.zh-CN.md 全文（逐字，仅差条目末尾换行）')
ok(bodyUse.indexOf('保存配置并开始') > 0 && bodyUse.indexOf('一键配置结构') < 0, '使用说明用定稿按钮文案（不含旧稿「一键配置结构」）')

// ───────────────────── [6] package.json 发布件白名单 ─────────────────────
section('[7] embed=1 片段形态（客户端页内展开注入宿主 GUI 用）')
for (const spec of FILES) {
  const text = texts[spec.file]
  const body = renderMarkdown(text)
  const frag = renderFragment(spec.title, body)
  ok(frag.indexOf('<html') < 0 && frag.indexOf('<head') < 0 && frag.indexOf('<body') < 0,
    'defaults/' + spec.file + ' 片段不含 <html>/<head>/<body>')
  ok(frag.indexOf('html{') < 0 && frag.indexOf('body{') < 0 && frag.indexOf('*{') < 0,
    'defaults/' + spec.file + ' 片段不含全局选择器（html{ / body{ / *{）')
  ok(frag.indexOf('<style>') === 0 && frag.indexOf('class="wps-doc"') > 0, 'defaults/' + spec.file + ' 片段自带作用域样式与 .wps-doc 容器')
  const css = frag.slice(0, frag.indexOf('</style>'))
  const selectors = css.split('\n')
    .filter((l) => l.indexOf('{') > 0)
    .reduce((acc, l) => acc.concat(l.slice(0, l.indexOf('{')).split(',').map((x) => x.trim()).filter(Boolean)), [])
  const outside = selectors.filter((sel) => sel.indexOf('.wps-doc') !== 0)
  ok(selectors.length > 8 && outside.length === 0,
    'defaults/' + spec.file + ' 片段里 ' + selectors.length + ' 个选择器全部以 .wps-doc 开头' + (outside.length ? '（越界：' + outside.slice(0, 2).join(' / ') + '）' : ''))
  const missing = []
  for (const line of text.split('\n')) {
    if (/^[ \t]*$/.test(line) || /^[ \t]*\|/.test(line) || /^[ \t]*[\u0060]{3}/.test(line)) continue
    for (const fr of fragmentsOf(line)) if (frag.indexOf(escapeHtml(fr)) < 0) missing.push(fr.slice(0, 20))
  }
  ok(missing.length === 0, 'defaults/' + spec.file + ' 片段正文与 md 逐字一致' + (missing.length ? '（缺：' + missing.slice(0, 2).join(' | ') + '）' : ''))
  const full = renderPage(spec.title, body)
  ok(full.indexOf('<!DOCTYPE html>') === 0 && full.indexOf('<html lang="zh-CN">') > 0 && full.indexOf('<body>') > 0 && full.indexOf('class="wps-doc"') > 0,
    'defaults/' + spec.file + ' 默认（不带 embed）仍是完整文档')
}

section('[8] 链接白名单：protocol-relative 与 javascript: 一律降级')
const linkHtml = renderMarkdown('[a](//evil.example.com/x) [b](javascript:alert(1)) [c](https://ok.example.com/y) [d](/local)')
ok(linkHtml.indexOf('evil.example.com') < 0, '协议相对地址（//host/…）被拒绝（不再放行跨站地址）')
ok(linkHtml.indexOf('javascript:') < 0, 'javascript: 被拒绝')
ok(linkHtml.indexOf('https://ok.example.com/y') > 0 && linkHtml.indexOf('href="/local"') > 0, 'https 与根相对路径仍放行')

section('[6] package.json：files / exports 覆盖 defaults')
const pkg = JSON.parse(readFileSync(join(MODULE_DIR, 'package.json'), 'utf8'))
ok(Array.isArray(pkg.files) && pkg.files.indexOf('defaults') >= 0, 'package.json files 白名单含 defaults')
ok(pkg.exports && typeof pkg.exports['./defaults/*'] === 'string', 'exports 暴露 ./defaults/*')
ok(existsSync(join(DEFAULTS, 'use.zh-CN.md')) && existsSync(join(DEFAULTS, 'install.zh-CN.md')), '两个文件确实在 defaults/ 下（白名单与实际一致）')

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' defaults-test：' + pass + ' 通过 / ' + fail + ' 失败')
try { rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
process.exitCode = fail === 0 ? 0 : 1
