/**
 * work-personal-secretary —— 极简 Markdown → HTML 渲染（随包两个说明网页用）
 *
 * 定位：给 GET /work-personal-secretary/guide（安装引导）与 /help（使用说明）把
 * defaults/install.zh-CN.md、defaults/use.zh-CN.md 渲染成网页。**单一真相源是那两个 md**，
 * 本文件只做呈现，不持有任何说明文字（避免两处措辞漂移）。
 *
 * 纪律：
 * 1. 零运行时依赖（只用字符串处理），宿主 peer 缺失时不影响加载；
 * 2. 输出**转义**后的 HTML：md 里的一切文本先 escape，再识别语法，不接受原始 HTML 直出；
 * 3. 链接只放行 http(s) / # / 根相对路径，其余一律降级为 #（防 javascript: 注入）；
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
      const safe = /^(https?:\/\/|#|\/)/i.test(raw) ? raw : '#'
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
 * Markdown → HTML 片段。
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

/** 页面样式（随 webServer 直出；不含任何外部资源与外链） */
export const PAGE_CSS = [
  ':root{--ink:#1f2328;--ink3:#6b7280;--line:#eef0f2;--brand:#1d4ed8}',
  '*{box-sizing:border-box}',
  'html,body{margin:0;padding:0}',
  'body{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;font-size:15px;line-height:1.75;color:var(--ink);background:#f4f6f8}',
  '.doc{max-width:760px;margin:0 auto;padding:32px 32px 56px;background:#fff;min-height:100vh}',
  '.doc h1{font-size:22px;margin:0 0 6px}',
  '.doc h2{font-size:17px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}',
  '.doc h3{font-size:15px;margin:16px 0 4px}',
  '.doc p{margin:8px 0}',
  '.doc ul,.doc ol{margin:8px 0;padding-left:24px}',
  '.doc li{margin:4px 0}',
  '.doc code{font-family:Consolas,"Courier New",monospace;font-size:13px;background:#f2f4f7;padding:1px 5px;border-radius:4px}',
  '.doc pre{background:#20242b;color:#e6e9ee;padding:12px 14px;border-radius:9px;overflow-x:auto;font-size:13px;margin:10px 0}',
  '.doc pre code{background:transparent;color:inherit;padding:0;font-size:13px}',
  '.doc table{width:100%;border-collapse:collapse;font-size:14px;margin:10px 0}',
  '.doc th,.doc td{border-bottom:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}',
  '.doc th{color:var(--ink3);font-weight:600;font-size:13px}',
  '.doc .callout{border-left:3px solid #cfd8e3;background:#fbfcfd;padding:9px 13px;margin:12px 0;border-radius:0 6px 6px 0}',
  '.doc .callout p{margin:4px 0}',
  '.doc a{color:var(--brand)}',
].join(String.fromCharCode(10))

/**
 * 套上完整 HTML 外壳。
 * @param {string} title 页面标题（同时进 title 与页首）
 * @param {string} bodyHtml renderMarkdown 的输出
 * @returns {string}
 */
export function renderPage(title, bodyHtml) {
  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + escapeHtml(title) + '</title>\n'
    + '<style>\n' + PAGE_CSS + '\n</style>\n'
    + '</head>\n<body>\n<article class="doc">\n'
    + bodyHtml
    + '\n</article>\n</body>\n</html>\n'
}
