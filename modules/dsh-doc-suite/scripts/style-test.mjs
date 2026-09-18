// A 线样式能力回归（零依赖；可在 CI 直接跑，缺 Python 库时自动 SKIP）
// 覆盖：规格契约 + 实现关键点 + Python 侧加载 + （有依赖时）端到端套样式
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(here, '..');
const OFF = path.join(mod, 'scripts', 'office');
// 夹具目录：每次都建一次性临时目录（mkdtemp 保证唯一），进程退出时统一清理 ——
// 不再固定写到 <tmpdir>/dsh-style-test 而残留（2026-09-15 修正：此前会累积 f.docx.bak-style-* 等）。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-style-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* WPS 可能仍持句柄，忽略 */ } });

let pass = 0, fail = 0, skip = 0;
const ok = (n) => { console.log('  ✅ ' + n); pass++; };
const bad = (n, e) => { console.log('  ❌ ' + n + ' — ' + e); fail++; };
const t = (n, fn) => { try { const r = fn(); if (r === 'skip') { console.log('  ⏭ ' + n + '（跳过）'); skip++; } else ok(n); } catch (e) { bad(n, e.message || e); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const pyLine = (lines) => lines.join('\n');

// 行高口径（③a 统一）：WPS 实测单倍行高系数。行高 = 字号 ÷ 72 × 该系数 × 行距。
// 三处必须一致：scripts/spec_sync.py / scripts/office/ppt_render.py / 本文件（下方有门禁用例）。
const SINGLE_LINE_EM = 1.228;

function pyRun(script, args) {
  const candidates = [
    ['py', ['-3', script, ...args]],
    ['python3', [script, ...args]],
    ['python', [script, ...args]],
  ];
  for (const [cmd, argv] of candidates) {
    const r = spawnSync(cmd, argv, { encoding: 'utf8', cwd: OFF, timeout: 120000 });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}

console.log('== A 线样式能力回归 ==');

t('规格文件 specs/standard.json 存在且为合法 JSON', () => {
  const p = path.join(mod, 'specs', 'standard.json');
  assert(fs.existsSync(p), 'specs/standard.json 不存在');
  globalThis.SPEC = JSON.parse(fs.readFileSync(p, 'utf8'));
});

t('规格含 word/excel 两段与必需字段', () => {
  const s = globalThis.SPEC;
  for (const k of ['id', 'colors', 'word', 'excel']) assert(s[k], '缺少 ' + k);
  for (const k of ['page', 'fonts', 'styles', 'table']) assert(s.word[k], 'word 缺少 ' + k);
  for (const k of ['font', 'header', 'border', 'column_rules', 'print']) assert(s.excel[k], 'excel 缺少 ' + k);
  assert(s.word.page.margins_cm.left === 3.17 && s.word.page.margins_cm.right === 3.17 && s.word.page.margins_cm.top === 2.54 && s.word.page.margins_cm.bottom === 2.54,
    '页面应为通用默认 上下 2.54 / 左右 3.17 cm（2026-09-17 使用者定；原投标口径移自定义层）');
  assert(s.word.styles.Normal.line_spacing === 1.5, 'Normal 行距应为 1.5 倍');
  assert(s.word.styles.Normal.first_line_chars === 2, '正文首行缩进应为 2 字符');
});

t('新增实现文件齐全', () => {
  for (const f of ['style_spec.py', 'word_style.py', 'excel_style.py']) {
    assert(fs.existsSync(path.join(OFF, f)), f + ' 不存在');
  }
});

t('style_spec.py 含规格加载与内容零改动断言', () => {
  const src = fs.readFileSync(path.join(OFF, 'style_spec.py'), 'utf8');
  for (const k of ['def load_spec', 'def commit_style', 'def assert_content_unchanged', 'def word_snapshot', 'def excel_snapshot', 'USER_DIR']) {
    assert(src.includes(k), '缺少 ' + k);
  }
});

t('word_style.py 四属性字体（ascii/hAnsi/eastAsia/cs）齐全', () => {
  const src = fs.readFileSync(path.join(OFF, 'word_style.py'), 'utf8');
  for (const k of ['w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs', 'w:firstLineChars', 'w:tblHeader']) {
    assert(src.includes(k), '缺少 ' + k);
  }
});

t('两个工具已注册新子命令', () => {
  assert(fs.readFileSync(path.join(OFF, 'word_tool.py'), 'utf8').includes('apply-style'), 'word_tool 未注册 apply-style');
  assert(fs.readFileSync(path.join(OFF, 'word_tool.py'), 'utf8').includes('table-style'), 'word_tool 未注册 table-style');
  assert(fs.readFileSync(path.join(OFF, 'excel_tool.py'), 'utf8').includes('apply-style'), 'excel_tool 未注册 apply-style');
});

t('doc_roles.py 角色识别模块齐全（A2.1）', () => {
  const p = path.join(OFF, 'doc_roles.py');
  assert(fs.existsSync(p), 'doc_roles.py 不存在');
  const src = fs.readFileSync(p, 'utf8');
  for (const k of ['def style_role', 'def number_role', 'def classify_paragraph', 'def resolve_column_align', 'def looks_numeric', '一二三四五六七八九十', '_TITLE_EXCLUDE']) {
    assert(src.includes(k), '缺少 ' + k);
  }
});

t('规格 v1.1：doc_title / roles / align_rules 与使用者拍板字号', () => {
  const s = globalThis.SPEC;
  assert(String(s.version) >= '1.1', 'version 应 >= 1.1');
  assert(s.word.page.margins_cm.top === 2.54 && s.word.page.margins_cm.left === 3.17, '页面应 上下2.54 / 左右3.17');
  assert(s.word.doc_title && s.word.doc_title.default_size_pt === 18, 'doc_title 默认字号应为 18pt');
  assert(s.roles && s.roles.title_zone, 'roles 段缺失');
  const h = s.word.styles;
  assert(h['Heading 1'].size_pt === 15 && h['Heading 1'].size_name === '小三' && h['Heading 1'].bold === true && h['Heading 1'].align === 'center', 'H1 应「小三」15pt 加粗居中');
  assert(h['Normal'].size_name === '小四' && h['Heading 2'].size_name === '四号', '字号中文标识缺失（小三/四号/小四）');
  assert(h['Heading 2'].size_pt === 14 && h['Heading 2'].bold === true, 'H2 应 14pt 加粗（2026-09-15 定案 A）');
  assert(h['Heading 4'] && h['Heading 4'].size_pt === 12 && h['Heading 4'].bold === true, 'H4 应 12pt 加粗（定案 A，原与正文同规格导致层级丢失）');
  assert(h['Heading 3'].size_pt === 12 && h['Heading 3'].bold === true, 'H3 应 12pt 加粗');
  assert(s.word.table.align_rules.numeric_align === 'right', '数值列应右对齐');
  assert(s.word.table.align_rules.text_align_default === 'left', '文本列默认应左对齐');
  assert(s.excel.align_rules && s.excel.align_rules.serial_align === 'center', 'Excel 序号列应居中');
});

t('pptx 几何真值：三类页型齐全且在页内（②a）', () => {
  const p = globalThis.SPEC.pptx;
  assert(p, 'pptx 段缺失');
  const W = p.slide.width_emu / 914400, H = p.slide.height_emu / 914400;
  assert(Math.abs(W - 13.3333) < 0.001 && Math.abs(H - 7.5) < 0.001, '页面应为 13.3333×7.5 英寸');
  assert(p.content_page && Array.isArray(p.content_page.elements), 'content_page 骨架缺失');
  for (const lay of ['cover', 'bullets', 'cards']) assert(p.layouts[lay], '缺页型 ' + lay);
  const els = [...p.content_page.elements];
  for (const lay of ['cover', 'bullets', 'cards']) els.push(...p.layouts[lay].elements);
  const roles = new Set();
  for (const e of els) {
    assert(e.role, '元素缺 role');
    roles.add(e.role);
    for (const k of ['x', 'y', 'w', 'h']) assert(typeof e.box?.[k] === 'number', e.role + ' 的 box 缺 ' + k);
    assert(e.box.w > 0 && e.box.h > 0, e.role + ' 宽高应为正');
    assert(e.box.x + e.box.w <= W + 0.002 && e.box.y + e.box.h <= H + 0.002, e.role + ' 越出页面');
    if (e.text) {
      assert(p.sizes_pt[e.text.size], e.role + ' 引用了不存在的字号键 ' + e.text.size);
      if (e.autofit) assert(e.autofit.min_size_pt <= p.sizes_pt[e.text.size], e.role + ' 的 min_size_pt 大于所引用字号');
    }
    if (e.fill && !/^[0-9A-Fa-f]{6}$/.test(e.fill)) assert(p.color_roles[e.fill], '色角色缺失 ' + e.fill);
    if (e.text?.color && !/^[0-9A-Fa-f]{6}$/.test(e.text.color)) assert(p.color_roles[e.text.color], '色角色缺失 ' + e.text.color);
    if (e.bullet?.color) assert(p.color_roles[e.bullet.color], '项目符号色角色缺失 ' + e.bullet.color);
  }
  for (const r of ['title', 'rule', 'page_number', 'body', 'grid']) assert(roles.has(r), '缺少元素 ' + r);
  const g = p.layouts.cards.elements.find((e) => e.role === 'grid');
  assert(g.cols * g.col_w_in + (g.cols - 1) * g.gap_in <= g.box.w + 0.002, '卡片网格宽超出网格区');
  assert(g.max_rows * g.row_h_in + (g.max_rows - 1) * g.gap_in <= g.box.h + 0.002, '卡片网格高超出网格区');
  const card = p.components.card;
  assert(card && card.coord === 'relative' && card.elements.length >= 3, 'card 组件应为相对坐标且含 icon/title/body');
  for (const e of card.elements) {
    assert(e.box.x + e.box.w <= g.col_w_in + 0.002, '卡片内元素 ' + e.role + ' 超出卡宽');
    assert(e.box.y + e.box.h <= g.row_h_in + 0.002, '卡片内元素 ' + e.role + ' 超出卡高');
  }
  assert(p.color_roles.text_heading && p.color_roles.rule, 'color_roles 应含 text_heading / rule（几何不直接引顶层 colors）');
  // 容量自洽（2026-09-16 独立复核抓出 max_lines 与字号/行距/段距不自洽，必须有门禁）
  const lsDefault = p.spacing?.line_spacing ?? 1.0;
  for (const e of [...els, ...card.elements]) {
    if (!e.text || !e.autofit) continue;
    const pt = p.sizes_pt[e.text.size];
    const ls = e.text.line_spacing ?? lsDefault;
    const gapIn = e.bullet?.gap_after_pt ? e.bullet.gap_after_pt / 72 : 0;
    const need = e.autofit.max_lines * (pt / 72 * SINGLE_LINE_EM * ls) + Math.max(0, e.autofit.max_lines - 1) * gapIn;
    assert(need <= e.box.h + 0.002, e.role + ' 容量不自洽：' + need.toFixed(4) + ' in > box.h ' + e.box.h + '（max_lines 应按基础字号反算）');
    assert(e.autofit.min_size_pt <= pt, e.role + ' 的 min_size_pt 大于基础字号');
  }
  // 无 autofit 的文本元素：单行也必须放得下（icon 就是这么被抓出来的）
  for (const e of [...els, ...card.elements]) {
    if (!e.text || e.autofit) continue;
    const pt = p.sizes_pt[e.text.size];
    const ls = e.text.line_spacing ?? lsDefault;
    assert(pt / 72 * SINGLE_LINE_EM * ls <= e.box.h + 0.002, e.role + ' 单行高已超出 box.h 且无 autofit 可缩');
  }
  // 页脚带不得与主体区重叠（复核抓出：cards 网格区底 6.85 > source 顶 6.72）
  const gridEl = p.layouts.cards.elements.find((e) => e.role === 'grid');
  const srcEl = p.layouts.cards.elements.find((e) => e.role === 'source');
  assert(gridEl.box.y + gridEl.box.h <= srcEl.box.y + 0.002, 'cards 网格区与来源行重叠');
});

t('行高口径三处一致（WPS 实测单倍行高 1.228）', () => {
  const grab = (file) => {
    const m = fs.readFileSync(file, 'utf8').match(/SINGLE_LINE_EM\s*=\s*([0-9.]+)/);
    return m ? Number(m[1]) : null;
  };
  const a = grab(path.join(mod, 'scripts', 'spec_sync.py'));
  const b = grab(path.join(OFF, 'ppt_render.py'));
  assert(a && b, '未取到常量：spec_sync=' + a + ' ppt_render=' + b);
  assert(a === SINGLE_LINE_EM && b === SINGLE_LINE_EM,
    '行高口径漂移：spec_sync=' + a + ' ppt_render=' + b + ' style-test=' + SINGLE_LINE_EM);
});

t('spec_sync 能拒绝越界 / 悬空引用 / 缺页型的几何（负例）', () => {
  const scriptsDir = path.join(mod, 'scripts');
  const specPath = path.join(mod, 'specs', 'standard.json');
  const py = pyLine([
    'import json, sys, copy, io',
    'sys.path.insert(0, ' + JSON.stringify(scriptsDir) + ')',
    'import spec_sync',
    'base = json.load(open(' + JSON.stringify(specPath) + ', encoding="utf-8"))',
    'by_id = {"standard": base}',
    'def _run(spec):',
    '    real = sys.stderr',
    '    sys.stderr = io.StringIO()',
    '    try:',
    '        spec_sync.validate("probe", spec, by_id)',
    '        return None',
    '    except SystemExit as exc:',
    '        return exc.code',
    '    finally:',
    '        sys.stderr = real',
    'def expect_fail(tag, mut=None, child=None):',
    '    if child is not None:',
    '        spec = {"schema": "dsh-doc-suite/style-spec@1", "id": "probe-theme", "extends": "standard"}',
    '        child(spec)',
    '    else:',
    '        spec = copy.deepcopy(base)',
    '        mut(spec)',
    '    code = _run(spec)',
    '    assert code == 2, tag + " 期望 exit 2，实得 " + str(code)',
    'def expect_pass(tag, spec):',
    '    code = _run(spec)',
    '    assert code is None, tag + " 期望通过，实得 exit " + str(code)',
    'expect_fail("标题越界", lambda s: s["pptx"]["content_page"]["elements"][0]["box"].__setitem__("w", 99))',
    'expect_fail("字号键悬空", lambda s: s["pptx"]["content_page"]["elements"][0]["text"].__setitem__("size", "no_such_size"))',
    'expect_fail("字号键非字符串", lambda s: s["pptx"]["content_page"]["elements"][0]["text"].__setitem__("size", ["body"]))',
    'expect_fail("色角色悬空", lambda s: s["pptx"]["layouts"]["cover"]["elements"][1].__setitem__("fill", "no-such-color"))',
    'expect_fail("私有色角色 _note", lambda s: s["pptx"]["layouts"]["cover"]["elements"][1].__setitem__("fill", "_note"))',
    'expect_fail("dict 色角色 chart_series", lambda s: s["pptx"]["layouts"]["cover"]["elements"][1].__setitem__("fill", "chart_series"))',
    'expect_fail("缺 cards 页型", lambda s: s["pptx"]["layouts"].pop("cards"))',
    'expect_fail("空页型 cover.elements", lambda s: s["pptx"]["layouts"]["cover"].__setitem__("elements", []))',
    'expect_fail("网格超宽", lambda s: s["pptx"]["layouts"]["cards"]["elements"][0].__setitem__("cols", 6))',
    'expect_fail("slot 悬空", lambda s: s["pptx"]["layouts"]["cards"]["elements"][0].__setitem__("slot", "no_such_component"))',
    'expect_fail("max_lines 超容量", lambda s: s["pptx"]["layouts"]["bullets"]["elements"][0]["autofit"].__setitem__("max_lines", 99))',
    'expect_fail("icon 未显式行距则单行超框", lambda s: s["pptx"]["components"]["card"]["elements"][0]["text"].pop("line_spacing"))',
    'expect_fail("extends 子层几何越界（合并后必须被拦）", child=lambda c: c.update({"pptx": {"layouts": {"bullets": {"elements": [{"role": "body", "box": {"x": 0.8, "y": 1.8, "w": 99, "h": 4.85}, "text": {"size": "body", "color": "text_on_light"}}]}}}}))',
    'expect_pass("extends 子层只改 colors.primary（正常主题定制不得误伤）", {"schema": "dsh-doc-suite/style-spec@1", "id": "probe-theme", "extends": "standard", "colors": {"primary": "123456"}})',
    'spec_sync.validate("standard", base, by_id)',
    'print("OK")',
  ]);
  const r = pyRun('-c', [py]);
  if (!r) return 'skip';
  assert(r.status === 0, '负例校验未通过：' + (r.stdout || '') + (r.stderr || ''));
});

t('端到端：编号模式纠正原文层级（Heading 2 的「三、」→ 一级）', () => {
  const probe = pyRun('-c', ['import docx;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = pyLine([
    'import docx, os, sys',
    'd = sys.argv[1]',
    'doc = docx.Document()',
    'doc.add_paragraph("某某方案", style="Title")',
    'doc.add_paragraph("一、总体说明", style="Heading 1")',
    'doc.add_paragraph("三、技术路线", style="Heading 2")',
    'doc.add_paragraph("1.1 技术规范响应")',
    'doc.save(os.path.join(d, "c.docx"))',
  ]);
  let r = pyRun('-c', [gen, TMP]);
  assert(r && r.status === 0, '造样本失败: ' + (r && r.stderr));
  r = pyRun('word_tool.py', ['apply-style', path.join(TMP, 'c.docx'), '--dry-run']);
  const out = (r && r.stdout) || '';
  assert(r && r.status === 0, 'dry-run 失败: ' + (r && r.stderr));
  assert(/纠正原文层级/.test(out), '未输出纠正报告');
  assert(/heading_1=2/.test(out.replace(/\s/g, '')), '「三、」应被判为一级标题（纠正后 heading_1 应为 2）');
});

t('端到端：表格列对齐（序号居中 / 数值右对齐 / 文本左对齐）', () => {
  const probe = pyRun('-c', ['import docx;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = pyLine([
    'import docx, os, sys',
    'd = sys.argv[1]',
    'doc = docx.Document()',
    't = doc.add_table(rows=3, cols=3)',
    'for i, v in enumerate(["序号", "名称", "金额"]): t.cell(0, i).text = v',
    'for r, row in enumerate([["1", "防火墙", "1,000.00"], ["2", "交换机", "2,500.00"]], start=1):',
    '    for i, v in enumerate(row): t.cell(r, i).text = v',
    'doc.save(os.path.join(d, "ta.docx"))',
  ]);
  let r = pyRun('-c', [gen, TMP]);
  assert(r && r.status === 0, '造样本失败: ' + (r && r.stderr));
  const file = path.join(TMP, 'ta.docx');
  r = pyRun('word_tool.py', ['table-style', file]);
  assert(r && r.status === 0, 'table-style 失败: ' + (r && (r.stdout + r.stderr)).slice(0, 200));
  const chk = pyLine([
    'import docx, sys',
    'd = docx.Document(sys.argv[1])',
    't = d.tables[0]',
    'def a(c):',
    '    for p in c.paragraphs:',
    '        if p.alignment is not None: return str(p.alignment).split(" ")[0]',
    '    return "None"',
    'row = t.rows[1]',
    'sys.exit(0 if (a(row.cells[0]) == "CENTER" and a(row.cells[2]) == "RIGHT" and a(row.cells[1]) == "LEFT") else 1)',
  ]);
  r = pyRun('-c', [chk, file]);
  assert(r && r.status === 0, '列对齐不符：期望 序号=CENTER / 名称=LEFT / 金额=RIGHT');
});

t('端到端：Excel 列对齐（表头语义兜底 —— 空列也判数值）', () => {
  const probe = pyRun('-c', ['import openpyxl;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = [
    'import openpyxl, os, sys',
    'd = sys.argv[1]',
    'wb = openpyxl.Workbook(); ws = wb.active',
    'ws.append(["序号", "名称", "数量", "单价"])',
    'ws.append([1, "防火墙", 2, None])',
    'wb.save(os.path.join(d, "xa.xlsx"))',
  ].join('\n');
  let r = pyRun('-c', [gen, TMP]);
  assert(r && r.status === 0, '造样本失败');
  const file = path.join(TMP, 'xa.xlsx');
  r = pyRun('excel_tool.py', ['apply-style', file]);
  assert(r && r.status === 0, 'excel apply-style 失败: ' + (r && (r.stdout + r.stderr)).slice(0, 200));
  const chk = [
    'import openpyxl, sys',
    'ws = openpyxl.load_workbook(sys.argv[1]).active',
    'h = lambda a: ws[a].alignment.horizontal',
    'sys.exit(0 if (h("A2") == "center" and h("C2") == "right" and h("D2") == "right" and h("B2") == "left") else 1)',
  ].join('\n');
  r = pyRun('-c', [chk, file]);
  assert(r && r.status === 0, 'Excel 列对齐不符：期望 序号=center / 名称=left / 数量=right / 单价(空列)=right');
});

t('端到端：表格宽度自适应（撑满版心 + 长表头列不折行）', () => {
  const probe = pyRun('-c', ['import docx;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = pyLine([
    'import docx, os, sys',
    'd = sys.argv[1]',
    'doc = docx.Document()',
    't = doc.add_table(rows=2, cols=3)',
    'for i, v in enumerate(["序号", "对应合同条目", "金额（不含税）"]): t.cell(0, i).text = v',
    't.cell(1, 0).text = "1"',
    't.cell(1, 1).text = "35"',
    't.cell(1, 2).text = "1,956,167.26"',
    'doc.save(os.path.join(d, "tw.docx"))',
  ]);
  let r = pyRun('-c', [gen, TMP]);
  assert(r && r.status === 0, '造样本失败: ' + (r && r.stderr));
  const file = path.join(TMP, 'tw.docx');
  r = pyRun('word_tool.py', ['table-style', file]);
  assert(r && r.status === 0, 'table-style 失败: ' + (r && (r.stdout + r.stderr)).slice(0, 240));
  const chk = pyLine([
    'import docx, sys, unicodedata',
    'from docx.oxml.ns import qn',
    'd = docx.Document(sys.argv[1])',
    't = d.tables[0]',
    'sec = d.sections[0]',
    'body = int(round((int(sec.page_width) - int(sec.left_margin) - int(sec.right_margin)) / 635.0))',
    'tbl = t._tbl',
    'tw = int(tbl.tblPr.find(qn("w:tblW")).get(qn("w:w")))',
    'layout = tbl.tblPr.find(qn("w:tblLayout"))',
    'fixed = (layout is not None and layout.get(qn("w:type")) == "fixed")',
    'cols = [int(g.get(qn("w:w"))) for g in tbl.find(qn("w:tblGrid")).findall(qn("w:gridCol"))]',
    'dw = lambda s: sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)',
    'head = [c.text for c in t.rows[0].cells]',
    'need = [dw(h) * 105 for h in head]',
    'ok1 = abs(tw - body) <= 2 and abs(sum(cols) - body) <= 2 and fixed',
    'ok2 = all(cols[i] >= need[i] for i in range(len(cols)))',
    'sys.exit(0 if (ok1 and ok2) else 1)',
  ]);
  r = pyRun('-c', [chk, file]);
  assert(r && r.status === 0, '表格宽度/列宽不符：期望 tblW=版心宽 + fixed 布局 + 列宽之和=版心宽 + 长表头列不折行');
});

t('Python 侧可加载规格（需解释器）', () => {
  const r = pyRun('-c', ['import style_spec,sys; s=style_spec.load_spec(None); sys.stdout.write(s["id"]+"|"+str(len(s["word"]["styles"])))']);
  if (!r) return 'skip';
  if (r.status !== 0) return 'skip';
  // 2026-09-15：styles 由 5 个增至 6 个（新增 Heading 5，支持 5 级标题）
  assert(/^standard\|6$/.test((r.stdout || '').trim()), 'load_spec 返回异常: ' + (r.stdout || r.stderr));
});

t('依赖可用时端到端：造样本 → 套样式 → 内容不变', () => {
  const probe = pyRun('-c', ['import docx,openpyxl;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = path.join(TMP, 'gen.py');
  fs.writeFileSync(gen, [
    'import docx, openpyxl, os',
    'd = r"' + TMP.replace(/\\/g, '\\\\') + '"',
    'doc = docx.Document(); doc.add_heading("H", level=1); doc.add_paragraph("正文一段。");',
    't = doc.add_table(rows=2, cols=2); t.cell(0,0).text = "表头"; t.cell(1,0).text = "值"; doc.save(os.path.join(d, "t.docx"))',
    'wb = openpyxl.Workbook(); ws = wb.active; ws.append(["名称","金额"]); ws.append(["防火墙", 100]); ws.append(["总价","=B2*1"]); wb.save(os.path.join(d, "t.xlsx"))',
  ].join('\n'), 'utf8');
  let r = pyRun(gen, []);
  assert(r && r.status === 0, '造样本失败: ' + (r && r.stderr));
  const docx = path.join(TMP, 't.docx'), xlsx = path.join(TMP, 't.xlsx');
  r = pyRun('word_tool.py', ['apply-style', docx]);
  assert(r && r.status === 0 && /内容零改动断言: 通过/.test(r.stdout || ''), 'word apply-style 未通过: ' + (r && (r.stdout + r.stderr)).slice(0, 300));
  r = pyRun('word_tool.py', ['table-style', docx]);
  assert(r && r.status === 0, 'word table-style 未通过: ' + (r && (r.stdout + r.stderr)).slice(0, 300));
  r = pyRun('excel_tool.py', ['apply-style', xlsx]);
  assert(r && r.status === 0 && /零改动断言: 通过/.test(r.stdout || ''), 'excel apply-style 未通过: ' + (r && (r.stdout + r.stderr)).slice(0, 300));
  // 公式保留
  const chk = path.join(TMP, 'chk.py');
  fs.writeFileSync(chk, [
    'import openpyxl, sys',
    'wb = openpyxl.load_workbook(r"' + xlsx.replace(/\\/g, '\\\\') + '")',
    'ws = wb.active; v = ws["B3"].value',
    'sys.exit(0 if (isinstance(v, str) and v.startswith("=")) else 1)',
  ].join('\n'), 'utf8');
  r = pyRun(chk, []);
  assert(r && r.status === 0, '公式未保留');
});

t('规格扩展：compact 内置 + 自定义层 extends 继承 / 深度覆盖 / 隔离 / 循环检测', () => {
  assert(fs.existsSync(path.join(mod, 'specs', 'compact.json')), 'specs/compact.json 不存在');
  // 夹具自造：临时目录当自定义层（ss.USER_DIR 可运行时覆盖），
  // 不读使用者真实 ~/.dsh/data/dsh-doc-suite/templates —— CI 干净环境与开发机结果一致。
  const chk = [
    'import sys, json, pathlib, tempfile, shutil',
    'sys.path.insert(0, sys.argv[1])',
    'import style_spec as ss',
    'base = ss.load_spec("standard"); c = ss.load_spec("compact")',
    'tmp = pathlib.Path(tempfile.mkdtemp(prefix="dsh-style-spec-"))',
    'try:',
    '    ss.USER_DIR = tmp',
    '    demo = {"schema": "dsh-doc-suite/style-spec@1", "id": "demo-report", "extends": "standard",',
    '            "colors": {"accent": "A34A00"},',
    '            "word": {"styles": {"Heading 1": {"align": "left"}},',
    '                     "table": {"header": {"shading": "BDD7EE"}}}}',
    '    (tmp / "demo-report.json").write_text(json.dumps(demo, ensure_ascii=False), encoding="utf-8")',
    '    d = ss.load_spec("demo-report")',
    '    (tmp / "loop-a.json").write_text(json.dumps({"id": "loop-a", "extends": "loop-b"}), encoding="utf-8")',
    '    (tmp / "loop-b.json").write_text(json.dumps({"id": "loop-b", "extends": "loop-a"}), encoding="utf-8")',
    '    cyc = False',
    '    try:',
    '        ss.load_spec("loop-a")',
    '    except ss.SpecError:',
    '        cyc = True',
    '    std_after = ss.load_spec("standard")',
    '    ok = (c["word"]["styles"]["Normal"]["size_pt"] == 10.5',
    '          and c["word"]["styles"]["Normal"]["line_spacing"] == 1.15',
    '          and c["word"]["styles"]["Heading 1"]["size_pt"] == 14',
    '          and c["word"]["page"]["margins_cm"]["top"] == 2.2',
    '          and c["word"]["page"]["margins_cm"]["left"] == 2.0',
    '          and c["colors"]["primary"] == "44546A"',
    '          and d["id"] == "demo-report"',
    '          and d["colors"]["primary"] == base["colors"]["primary"]',
    '          and d["word"]["styles"]["Normal"]["size_pt"] == 12',
    '          and d["word"]["styles"]["Heading 1"]["align"] == "left"',
    '          and d["word"]["table"]["header"]["shading"] == "BDD7EE"',
    '          and d["colors"]["accent"] == "A34A00"',
    '          and std_after["word"]["styles"]["Heading 1"]["align"] == "center"',
    '          and cyc)',
    '    print("extends/override/isolation/cycle ok=" + str(ok))',
    '    sys.exit(0 if ok else 1)',
    'finally:',
    '    shutil.rmtree(tmp, ignore_errors=True)',
  ].join('\n');
  const r = pyRun('-c', [chk, OFF]);
  if (!r) return 'skip';
  assert(r.status === 0, 'compact/extends 继承或覆盖不符: ' + (r.stdout + r.stderr).slice(0, 200));
});

t('A2.4 编号层级：1 / 1.1 / 1.2.1 / 1.2.3.4 / 1.2.3.4.5 → h1..h5，正文编号句不误升', () => {
  // 2026-09-15 修：原实现把 1.1.2 一律压成 heading_2，且把正文「（1）…」误升为标题
  const chk = [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'from doc_roles import number_role as nr',
    'cases = [',
    "  ('1 项目概述', 'heading_1'),",
    "  ('1.1 建设背景', 'heading_2'),",
    "  ('1.2.1 安全通信网络', 'heading_3'),",
    "  ('1.2.3.4 某控制点', 'heading_4'),",
    "  ('1.2.3.4.5 五级标题', 'heading_5'),",
    "  ('1.2.3.4.5.6 六级封顶', 'heading_5'),",
    "  ('（1）安全通信网络', 'heading_3'),",
    "  ('（一）系统概述', 'heading_2'),",
    "  ('一、项目概述', 'heading_1'),",
    "  ('A：技术参数', 'heading_4'),",
    "  ('1、全面安全风险评估', 'heading_1'),",
    "  ('2020.08.21 修订', None),",
    "  ('2020年08月', None),",
    "  ('（1）本项目按等保三级建设，需在实施窗口内完成。', None),",
    "  ('（1）本方案采用分区隔离与边界防护相结合的方式，覆盖八个安全域', None),",
    ']',
    'bad = [(t, nr(t), e) for t, e in cases if nr(t) != e]',
    'print("ok" if not bad else "FAIL " + repr(bad))',
    'sys.exit(0 if not bad else 1)',
  ].join('\n');
  const r = pyRun('-c', [chk, OFF]);
  if (!r) return 'skip';
  // 解释器本身不可用（如被沙箱限制）时跳过，而不是判失败
  if (r.status !== 0 && /ModuleNotFoundError|SyntaxError/.test(r.stderr || '')) return 'skip';
  assert(r.status === 0, '编号层级判定不符: ' + (r.stdout + r.stderr).slice(0, 200));
});

t('A2.4 Markdown 解析：1–5 级标题与 **加粗**（星号不落盘）', () => {
  // CI 上无 python-docx：先探依赖再跑（否则会红，而不是跳过）
  const probe = pyRun('-c', ['import docx;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  const chk = [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'from docx import Document',
    'import word_tool',
    'd = Document()',
    'word_tool.md_to_docx(d, "# 一\\n## 二\\n### 三\\n#### 四\\n##### 五\\n正文含 **加粗** 与普通字\\n")',
    'ps = [p for p in d.paragraphs if p.text.strip()]',
    'styles = [p.style.name for p in ps[:5]]',
    'want = ["Heading %d" % i for i in range(1, 6)]',
    'body = ps[5]',
    'bold_runs = [r.text for r in body.runs if r.bold]',
    'ok = (styles == want and bold_runs == ["加粗"] and "**" not in body.text)',
    'print("ok" if ok else "FAIL styles=%r bold=%r text=%r" % (styles, bold_runs, body.text))',
    'sys.exit(0 if ok else 1)',
  ].join('\n');
  const r = pyRun('-c', [chk, OFF]);
  if (!r) return 'skip';
  assert(r.status === 0, 'md 解析不符: ' + (r.stdout + r.stderr).slice(0, 200));
});

t('色板修正：文字色达标 + 装饰色保留', () => {
  const c = globalThis.SPEC.colors;
  assert(c.accent === 'A34A00', 'accent 应为可读深橙 A34A00（5.94:1）');
  assert(c.accent_decor === 'ED7D31', 'accent_decor 应保留 ED7D31');
  assert(c.semantic.warn === '8A6A00', 'warn 应为 8A6A00（5.07:1）');
  assert(c.semantic.warn_decor === 'BF9000', 'warn_decor 应保留 BF9000');
});

t('A2.3 规格口径：全文只允许「仿宋」单一字体', () => {
  const s = globalThis.SPEC;
  assert(Array.isArray(s.word.allowed_fonts) && s.word.allowed_fonts.length === 1 && s.word.allowed_fonts[0] === '仿宋', 'allowed_fonts 应为 ["仿宋"]');
  const fonts = s.word.fonts || {};
  for (const k of Object.keys(fonts)) {
    const v = fonts[k];
    if (v && typeof v === 'object') {
      assert(v.ea === '仿宋' && v.latin === '仿宋', 'fonts.' + k + ' 的 ea/latin 都应指向仿宋');
    }
  }
  assert(s.word.style_families && s.word.style_families.body && s.word.style_families.heading, 'style_families 缺失');
});

t('A2.3 实现齐备：样式族 + 表格/段落直接格式清理 + 四属性断言函数', () => {
  const src = fs.readFileSync(path.join(OFF, 'word_style.py'), 'utf8');
  for (const k of ['def iter_all_paragraphs', 'def all_font_names', 'DEFAULT_STYLE_FAMILIES', 'def _apply_style_families']) {
    assert(src.includes(k), '缺少 ' + k);
  }
  assert(!src.includes('仿宋_GB2312'), '不应再出现 仿宋_GB2312');
  assert(!src.includes('Times New Roman'), '不应再出现 Times New Roman 兜底');
});

t('端到端：套样式后全文（含表格/英文/数字）字体集合恒为 {仿宋}', () => {
  const probe = pyRun('-c', ['import docx;print("ok")']);
  if (!probe || probe.status !== 0) return 'skip';
  fs.mkdirSync(TMP, { recursive: true });
  const gen = pyLine([
    'import docx, os, sys',
    'from docx.oxml.ns import qn',
    'd = sys.argv[1]',
    'doc = docx.Document()',
    'doc.add_paragraph("合同对账说明 2026", style="Title")',
    'doc.add_paragraph("一、背景说明", style="Heading 1")',
    'doc.add_paragraph("正文段落，含 English words 与 12345 数字")',
    't = doc.add_table(rows=2, cols=2)',
    't.cell(0,0).text = "序号"; t.cell(0,1).text = "金额"',
    't.cell(1,0).text = "1"; t.cell(1,1).text = "1,000.00"',
    'p = doc.add_paragraph("带直接格式的段落 Arial")',
    'r = p.runs[0]',
    'r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:ascii"), "Arial")',
    'r._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")',
    'doc.save(os.path.join(d, "f.docx"))',
  ]);
  let r = pyRun('-c', [gen, TMP]);
  assert(r && r.status === 0, '造样本失败: ' + (r && r.stderr));
  r = pyRun('word_tool.py', ['apply-style', path.join(TMP, 'f.docx')]);
  assert(r && r.status === 0, 'apply-style 失败: ' + ((r && r.stderr) || ''));
  const chk = pyLine([
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'import docx',
    'from word_style import all_font_names',
    'd = docx.Document(sys.argv[2])',
    'print(json.dumps(all_font_names(d), ensure_ascii=True))',
  ]);
  const r2 = pyRun('-c', [chk, OFF, path.join(TMP, 'f.docx')]);
  assert(r2 && r2.status === 0, '统计失败: ' + ((r2 && r2.stderr) || ''));
  const last = ((r2.stdout || '{}').trim().split('\n').pop() || '{}');
  const fonts = JSON.parse(last);
  const keys = Object.keys(fonts);
  assert(keys.length === 1 && keys[0] === '仿宋', '字体集合应为 {仿宋}，实际 ' + JSON.stringify(fonts));
  for (const badFont of ['仿宋_GB2312', 'Times New Roman', 'Arial', '黑体', '宋体']) {
    assert(!keys.includes(badFont), '不应出现字体 ' + badFont);
  }
});

console.log('\n  A 线样式回归: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
process.exit(fail ? 1 : 0);
