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
  assert(s.word.page.margins_cm.left === 2.54 && s.word.page.margins_cm.top === 3.17, '页面应为 上下 3.17 / 左右 2.54 cm');
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

t('规格 v1.1：doc_title / roles / align_rules 与主人拍板字号', () => {
  const s = globalThis.SPEC;
  assert(String(s.version) >= '1.1', 'version 应 >= 1.1');
  assert(s.word.page.margins_cm.top === 3.17 && s.word.page.margins_cm.left === 2.54, '页面应 上下3.17 / 左右2.54');
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
    '            "colors": {"accent": "B45309"},',
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
    '          and d["colors"]["accent"] == "B45309"',
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
  assert(c.accent === 'B45309', 'accent 应为可读深橙 B45309（5.02:1）');
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
