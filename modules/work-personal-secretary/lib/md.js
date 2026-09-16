/**
 * work-personal-secretary —— 极简 Markdown → HTML 渲染（随包两个说明网页用）
 *
 * 定位：给 GET /work-personal-secretary/guide（安装引导）与 /help（使用说明）把
 * defaults/install.zh-CN.md、defaults/use.zh-CN.md 渲染成网页。**单一真相源是那两个 md**，
 * 本文件只做呈现，不持有任何说明文字（避免两处措辞漂移）。
 *
 * 两种输出形态（1.1.3 返工 R1-3）：
 *   renderPage(title, body)     —— 完整 HTML 文档（浏览器直接访问用；默认形态）
 *   renderFragment(title, body) —— **片段**（embed=1 用）：无 <html>/<head>/<body>，
 *                                 只带作用域化样式 + <article class="wps-doc">，供客户端
 *                                 注入宿主 GUI 容器（不污染宿主全局样式）。
 * 样式一律作用域到 .wps-doc（无 html/body/* 这类全局选择器）。
 *
 * 纪律：
 * 1. 零运行时依赖（只用字符串处理），宿主 peer 缺失时不影响加载；
 * 2. 输出**转义**后的 HTML：md 里的一切文本先 escape，再识别语法，不接受原始 HTML 直出；
 * 3. 链接只放行 http(s) / # / 根相对路径；protocol-relative（//host/…）与其余一律降级为 '#'；
 * 4. 只覆盖两个 md 实际用到的语法：标题 / 段落 / 列表 / 表格 / 代码块 / 引用块 / 行内代码 / 粗体。
 *
 * @module work-personal-secretary/md
 */

/** 反引号（用 charCode 生成，避免源码里出现裸反引号） */
const TICK = String.fromCharCode(96)
/** 三个反引号 = 代码围栏 */
const FENCE = TICK + TICK + TICK
/** 行内代码：(反引号 ... 反引号) */
const RE_INLINE_CODE = new RegExp('(' + TICK + '[^' + TICK + ']*' + TICK + ')', 'g')
/** 代码围栏起始行 */
const RE_FENCE = new RegExp('^[ \\t]*' + FENCE)
/** 段落终止（块级语法起始） */
const RE_BLOCK_START = new RegExp('^[ \\t]*(' + FENCE + '|#{1,6}[ \\t]|>|\\||[-*][ \\t]|[0-9]+\\.[ \\t])')

/** HTML 文本转义（& < > " '） */
export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 行内语法：先转义，再识别 行内代码 / **粗体** / [文本](链接) */
export function renderInline(text) {
  const parts = String(text == null ? '' : text).split(RE_INLINE_CODE)
  return parts.map((part) => {
    if (part.length >= 2 && part[0] === TICK && part[part.length - 1] === TICK) {
      return '<code>' + escapeHtml(part.slice(1, -1)) + '</code>'
    }
    let s = escapeHtml(part)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
      const raw = String(href).trim()
      // 先拒协议相对地址（//host/path）——浏览器会把它当跨站地址，属放行漏洞
      const safe = /^\/\//.test(raw) ? '#' : (/^(https?:\/\/|#|\/)/i.test(raw) ? raw : '#')
      return '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noreferrer noopener">' + label + '</a>'
    })
    return s
  }).join('')
}

/** 拆表格行：去掉首尾竖线后按竖线切分 */
function splitRow(line) {
  const s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '')
  return s.split('|').map((c) => c.trim())
}

/** 表格分隔行：| --- | :---: | */
function isTableRule(line) {
  return /^[ \\t]*\|?[ \\t:|-]+\|?[ \\t]*$/.test(line) && line.indexOf('-') >= 0
}

/**
 * Markdown → HTML 片段（不含外层容器与样式）。
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (RE_FENCE.test(line)) {
      const buf = []
      i += 1
      while (i < lines.length && !RE_FENCE.test(lines[i])) { buf.push(lines[i]); i += 1 }
      if (i < lines.length) i += 1
      out.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>')
      continue
    }

    if (/^[ \t]*$/.test(line)) { i += 1; continue }

    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      out.push('<h' + level + '>' + renderInline(heading[2].trim()) + '</h' + level + '>')
      i += 1
      continue
    }

    if (/^[ \t]*\|/.test(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows = []
      while (i < lines.length && /^[ \t]*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i += 1 }
      const head = header.map((c) => '<th>' + renderInline(c) + '</th>').join('')
      const bodyRows = rows.map((r) => '<tr>' + header.map((_, k) => '<td>' + renderInline(r[k] || '') + '</td>').join('') + '</tr>').join('')
      out.push('<table><thead><tr>' + head + '</tr></thead><tbody>' + bodyRows + '</tbody></table>')
      continue
    }

    if (/^[ \t]*>[ \t]?/.test(line)) {
      const buf = []
      while (i < lines.length && /^[ \t]*>[ \t]?/.test(lines[i])) { buf.push(lines[i].replace(/^[ \t]*>[ \t]?/, '')); i += 1 }
      out.push('<div class="callout">' + renderMarkdown(buf.join('\n')) + '</div>')
      continue
    }

    if (/^[ \t]*([-*]|[0-9]+\.)[ \t]+/.test(line)) {
      const ordered = /^[ \t]*[0-9]+\.[ \t]+/.test(line)
      const items = []
      while (i < lines.length && /^[ \t]*([-*]|[0-9]+\.)[ \t]+/.test(lines[i])) {
        items.push(lines[i].replace(/^[ \t]*([-*]|[0-9]+\.)[ \t]+/, ''))
        i += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push('<' + tag + '>' + items.map((t) => '<li>' + renderInline(t) + '</li>').join('') + '</' + tag + '>')
      continue
    }

    const buf = []
    while (i < lines.length && !/^[ \t]*$/.test(lines[i]) && !RE_BLOCK_START.test(lines[i])) { buf.push(lines[i]); i += 1 }
    if (buf.length === 0) { buf.push(lines[i]); i += 1 }
    out.push('<p>' + renderInline(buf.join(' ')) + '</p>')
  }
  return out.join('\n')
}

/** 作用域根类名（客户端嵌入宿主页面时靠它隔离样式） */
export const DOC_SCOPE_CLASS = 'wps-doc'

/**
 * 页面样式：**全部选择器都作用域在 .wps-doc 下**。
 * 不出现 html / body / * 这类全局选择器 —— 片段注入宿主 GUI 时不会污染全局样式。
 * （因此也不能用 .wps-doc * 这种通配写法，box-sizing 显式列元素。）
 */
export const PAGE_CSS = [
  '.wps-doc{--ink:#1f2328;--ink3:#6b7280;--line:#eef0f2;--brand:#1d4ed8}',
  '.wps-doc{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;font-size:15px;line-height:1.75;color:var(--ink);background:#fff;max-width:760px;margin:0 auto;padding:28px 28px 40px}',
  '.wps-doc,.wps-doc h1,.wps-doc h2,.wps-doc h3,.wps-doc p,.wps-doc ul,.wps-doc ol,.wps-doc li,.wps-doc table,.wps-doc th,.wps-doc td,.wps-doc pre,.wps-doc code,.wps-doc .callout{box-sizing:border-box}',
  '.wps-doc h1{font-size:22px;margin:0 0 6px}',
  '.wps-doc h2{font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}',
  '.wps-doc h3{font-size:15px;margin:16px 0 4px}',
  '.wps-doc p{margin:8px 0}',
  '.wps-doc ul,.wps-doc ol{margin:8px 0;padding-left:24px}',
  '.wps-doc li{margin:4px 0}',
  '.wps-doc code{font-family:Consolas,"Courier New",monospace;font-size:13px;background:#f2f4f7;padding:1px 5px;border-radius:4px}',
  '.wps-doc pre{background:#20242b;color:#e6e9ee;padding:12px 14px;border-radius:9px;overflow-x:auto;font-size:13px;margin:10px 0}',
  '.wps-doc pre code{background:transparent;color:inherit;padding:0;font-size:13px}',
  '.wps-doc table{width:100%;border-collapse:collapse;font-size:14px;margin:10px 0}',
  '.wps-doc th,.wps-doc td{border-bottom:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}',
  '.wps-doc th{color:var(--ink3);font-weight:600;font-size:13px}',
  '.wps-doc .callout{border-left:3px solid #cfd8e3;background:#fbfcfd;padding:9px 13px;margin:12px 0;border-radius:0 6px 6px 0}',
  '.wps-doc .callout p{margin:4px 0}',
  '.wps-doc a{color:var(--brand)}',
].join(String.fromCharCode(10))

/** 完整文档额外的一条页面底色（**只出现在 renderPage**；片段里不含任何全局选择器） */
const PAGE_DOC_EXTRA_CSS = 'body{margin:0;padding:0;background:#f4f6f8}'

/**
 * 片段形态（embed=1）：无 <html>/<head>/<body>，样式作用域在 .wps-doc。
 * @param {string} title 只用于容器 aria-label（不产出 <head>）
 * @param {string} bodyHtml renderMarkdown 的输出
 * @returns {string}
 */
export function renderFragment(title, bodyHtml) {
  const NL = String.fromCharCode(10)
  const label = title ? ' aria-label="' + escapeHtml(title) + '"' : ''
  return '<style>' + NL + PAGE_CSS + NL + '</style>' + NL
    + '<article class="' + DOC_SCOPE_CLASS + '"' + label + '>' + NL
    + bodyHtml
    + NL + '</article>' + NL
}

/**
 * 完整文档形态（默认）：浏览器可直接访问。
 * @param {string} title 页面标题
 * @param {string} bodyHtml renderMarkdown 的输出
 * @returns {string}
 */
export function renderPage(title, bodyHtml) {
  const NL = String.fromCharCode(10)
  return '<!DOCTYPE html>' + NL + '<html lang="zh-CN">' + NL + '<head>' + NL
    + '<meta charset="utf-8">' + NL
    + '<meta name="viewport" content="width=device-width, initial-scale=1">' + NL
    + '<title>' + escapeHtml(title) + '</title>' + NL
    + '<style>' + NL + PAGE_CSS + NL + PAGE_DOC_EXTRA_CSS + NL + '</style>' + NL
    + '</head>' + NL + '<body>' + NL
    + '<article class="' + DOC_SCOPE_CLASS + '" aria-label="' + escapeHtml(title) + '">' + NL
    + bodyHtml
    + NL + '</article>' + NL + '</body>' + NL + '</html>' + NL
}
