// dsh-doc-suite · PPT 存量美化回归（④；零依赖，CI 无 Python 依赖时自动 SKIP）
// 覆盖：实现关键点 · 端到端套样式（字体统一 / 文本零改动 / 备份）· dry-run · --out · --text-color ·
//       白名单校验 · 零改动断言的 exit 3 语义
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(here, '..');
const OFF = path.join(mod, 'scripts', 'office');
const STYLE = path.join(OFF, 'ppt_style.py');
const SPECS = path.join(mod, 'specs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ppt-style-test-'));
process.on('exit', function () { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 句柄 */ } });

let pass = 0, fail = 0, skip = 0;
const ok = function (n) { console.log('  ✅ ' + n); pass++; };
const bad = function (n, e) { console.log('  ❌ ' + n + ' — ' + e); fail++; };
const t = function (n, fn) { try { const r = fn(); if (r === 'skip') { console.log('  ⏭ ' + n + '（跳过）'); skip++; } else ok(n); } catch (e) { bad(n, e.message || e); } };
const assert = function (c, m) { if (!c) throw new Error(m); };
const pyLine = function (lines) { return lines.join('\n'); };

function pyRun(script, args) {
  const cands = [['py', ['-3']], ['python3', []], ['python', []]];
  for (const pair of cands) {
    const r = spawnSync(pair[0], pair[1].concat([script]).concat(args || []),
      { encoding: 'utf8', cwd: OFF, timeout: 180000 });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}
const HAS_PPTX = (function () { const r = pyRun('-c', ['import pptx; print(1)']); return !!r && r.status === 0; })();

const MAKE_SAMPLE = pyLine([
  'import sys',
  'from pptx import Presentation',
  'from pptx.util import Inches, Pt',
  'prs = Presentation()',
  'prs.slide_width = Inches(13.3333); prs.slide_height = Inches(7.5)',
  'for i in range(2):',
  '    s = prs.slides.add_slide(prs.slide_layouts[6])',
  '    tb = s.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(11), Inches(1))',
  '    tb.text_frame.text = "第 %d 页标题" % (i + 1)',
  '    for p in tb.text_frame.paragraphs:',
  '        for r in p.runs:',
  '            r.font.size = Pt(32); r.font.name = "宋体"',
  '    tb2 = s.shapes.add_textbox(Inches(0.8), Inches(2), Inches(11), Inches(2))',
  '    tb2.text_frame.text = "正文：生产网与管理网未有效隔离"',
  '    for p in tb2.text_frame.paragraphs:',
  '        for r in p.runs:',
  '            r.font.size = Pt(18); r.font.name = "宋体"',
  '    if i == 0:',
  '        tb3 = s.shapes.add_table(2, 2, Inches(0.8), Inches(4.5), Inches(6), Inches(1)).table',
  '        tb3.cell(0, 0).text = "表头甲"; tb3.cell(0, 1).text = "表头乙"',
  '        tb3.cell(1, 0).text = "值一"; tb3.cell(1, 1).text = "值二"',
  '        for row in tb3.rows:',
  '            for c in row.cells:',
  '                for p in c.text_frame.paragraphs:',
  '                    for r in p.runs:',
  '                        r.font.name = "宋体"',
  '    s.notes_slide.notes_text_frame.text = "第 %d 页备注" % (i + 1)',
  'prs.save(sys.argv[1])',
]);

const READ_BACK = pyLine([
  'import json, sys',
  'sys.stdout.reconfigure(encoding="utf-8", errors="replace")',
  'from pptx import Presentation',
  'from pptx.oxml.ns import qn',
  'prs = Presentation(sys.argv[1])',
  'fonts = {}; texts = []; colors = set()',
  'for s in prs.slides:',
  '    frames = []',
  '    for sh in s.shapes:',
  '        if sh.has_text_frame: frames.append(sh.text_frame)',
  '        if getattr(sh, "has_table", False):',
  '            for row in sh.table.rows:',
  '                for c in row.cells: frames.append(c.text_frame)',
  '    for tf in frames:',
  '        texts.append(tf.text)',
  '        for p in tf.paragraphs:',
  '            for r in p.runs:',
  '                rPr = r.font._rPr',
  '                for tag in ("a:latin", "a:ea"):',
  '                    el = rPr.find(qn(tag))',
  '                    if el is not None:',
  '                        k = el.get("typeface"); fonts[k] = fonts.get(k, 0) + 1',
  '                try:',
  '                    if r.font.color is not None and r.font.color.type is not None:',
  '                        colors.add(str(r.font.color.rgb))',
  '                except Exception:',
  '                    pass',
  '    if s.has_notes_slide: texts.append(s.notes_slide.notes_text_frame.text)',
  'print(json.dumps({"fonts": fonts, "texts": texts, "colors": sorted(colors)}, ensure_ascii=False))',
]);

function makeSample(name) {
  const p = path.join(TMP, name);
  const r = pyRun('-c', [MAKE_SAMPLE, p]);
  assert(r && r.status === 0, '造样本失败：' + (r && r.stderr));
  return p;
}
function readBack(p) {
  const r = pyRun('-c', [READ_BACK, p]);
  assert(r && r.status === 0, '读回失败：' + (r && r.stderr));
  const lines = r.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

console.log('== PPT 存量美化回归（④ apply-style）==');

t('实现关键点齐全（快照 / 原子落盘 / exit 3 / 白名单）', function () {
  const src = fs.readFileSync(STYLE, 'utf8');
  for (const k of ['pptx_snapshot', 'commit_style', 'ContentChangedError', 'allowed_fonts',
    'a:ea', '--text-color', 'exit_code']) {
    assert(src.includes(k), 'ppt_style.py 缺少 ' + k);
  }
  const ss = fs.readFileSync(path.join(OFF, 'style_spec.py'), 'utf8');
  assert(ss.includes('def pptx_snapshot'), 'style_spec 缺 pptx_snapshot');
  assert(ss.includes('kind == "pptx"'), 'style_spec 的 _diff_lines 缺 pptx 分支');
});

t('端到端：dry-run 报告且不写文件', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('dry.pptx');
  const before = fs.statSync(src).mtimeMs;
  const r = pyRun(STYLE, ['apply-style', src, '--dry-run']);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  assert(r.stdout.includes('--dry-run'), '未声明 dry-run');
  assert(fs.statSync(src).mtimeMs === before, 'dry-run 不应改动文件');
  assert(!fs.readdirSync(TMP).some(function (f) { return f.includes('.bak-'); }), 'dry-run 不应产生备份');
});

t('端到端：--out 另存（原文件不动、字体统一、文本零改动）', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('out-src.pptx');
  const out = path.join(TMP, 'out-dst.pptx');
  const textsBefore = readBack(src).texts;
  const r = pyRun(STYLE, ['apply-style', src, '--out', out]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  assert(fs.existsSync(out), '未产出');
  const fonts = readBack(out).fonts;
  assert(fonts['微软雅黑'] > 0 && !fonts['宋体'], '字体未统一：' + JSON.stringify(fonts));
  const textsAfter = readBack(out).texts;
  assert(JSON.stringify(textsBefore) === JSON.stringify(textsAfter), '文本发生变化（零改动断言应已拦下）');
  assert(JSON.stringify(readBack(src).texts) === JSON.stringify(textsBefore), '原文件文本被改动');
});

t('端到端：就地改 → 生成 .bak- 备份且文本零改动', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('inplace.pptx');
  const textsBefore = readBack(src).texts;
  const r = pyRun(STYLE, ['apply-style', src]);
  assert(r.status === 0, 'exit=' + r.status);
  const baks = fs.readdirSync(TMP).filter(function (f) { return f.startsWith('inplace.pptx.bak-'); });
  assert(baks.length === 1, '未生成唯一备份：' + JSON.stringify(baks));
  const fonts = readBack(src).fonts;
  assert(fonts['微软雅黑'] > 0 && !fonts['宋体'], '字体未统一：' + JSON.stringify(fonts));
  assert(JSON.stringify(readBack(src).texts) === JSON.stringify(textsBefore), '文本被改动');
});

t('端到端：表格单元格与备注的字体同时被统一', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('tblnotes.pptx');
  const r = pyRun(STYLE, ['apply-style', src]);
  assert(r.status === 0, 'exit=' + r.status);
  const fonts = readBack(src).fonts;
  assert(Object.keys(fonts).join() === '微软雅黑', '仍存在其它字体：' + JSON.stringify(fonts));
  assert(fonts['微软雅黑'] >= 12, '统一到的 run 数偏少：' + JSON.stringify(fonts));
});

t('端到端：--spec report 套样式（内容零改动 · 原文件不动）', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('report-spec.pptx');
  const out = path.join(TMP, 'report-spec-out.pptx');
  const textsBefore = readBack(src).texts;
  const r = pyRun(STYLE, ['apply-style', src, '--spec', 'report', '--out', out]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  assert(fs.existsSync(out), '未产出');
  assert(JSON.stringify(readBack(out).texts) === JSON.stringify(textsBefore), '文本发生变化（零改动断言应已拦下）');
  assert(JSON.stringify(readBack(src).texts) === JSON.stringify(textsBefore), '原文件文本被改动');
});

t('端到端：--text-color 只改未显式设色的 run', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('color.pptx');
  const r = pyRun(STYLE, ['apply-style', src, '--text-color', 'text_on_light']);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  const d = readBack(src);
  assert(d.colors.includes('404040'), '未写入 text_on_light(404040)：' + JSON.stringify(d.colors));
});

t('--text-color 非法值 → exit 2', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('badcolor.pptx');
  const r = pyRun(STYLE, ['apply-style', src, '--text-color', 'no-such-role']);
  assert(r.status === 2, 'exit=' + r.status);
  assert((r.stderr || '').includes('无法解析'), '未给出可读原因：' + (r.stderr || '').slice(0, 160));
});

t('规格不含 pptx 段 → exit 2', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('nospec.pptx');
  const specPath = path.join(TMP, 'word-only.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema: 'dsh-doc-suite/style-spec@1', id: 'word-only', name: '仅 Word',
    word: { page: { size: 'A4' }, fonts: { body: { latin: '仿宋', ea: '仿宋' } } },
  }), 'utf8');
  const r = pyRun(STYLE, ['apply-style', src, '--spec', specPath]);
  assert(r.status === 2, 'exit=' + r.status);
  assert((r.stderr || '').includes('不含 pptx 段'), '未给出可读原因：' + (r.stderr || '').slice(0, 160));
});

t('字体白名单：规格外字体 → 拒绝（exit 2）', function () {
  if (!HAS_PPTX) return 'skip';
  const src = makeSample('allowlist.pptx');
  const specPath = path.join(TMP, 'strict.json');
  fs.writeFileSync(specPath, JSON.stringify({
    schema: 'dsh-doc-suite/style-spec@1', id: 'strict', extends: 'standard',
    pptx: { allowed_fonts: ['仿宋'] },
  }), 'utf8');
  const r = pyRun(STYLE, ['apply-style', src, '--spec', specPath]);
  assert(r.status === 2, 'exit=' + r.status);
  assert((r.stderr || '').includes('白名单'), '未给出白名单原因：' + (r.stderr || '').slice(0, 160));
});

t('零改动断言：文本变化即拦截，退出码语义 = 3', function () {
  if (!HAS_PPTX) return 'skip';
  const py = pyLine([
    'import sys',
    'sys.path.insert(0, ' + JSON.stringify(path.join(mod, 'scripts')) + ')',
    'sys.path.insert(0, ' + JSON.stringify(OFF) + ')',
    'import style_spec',
    'before = {"slides": [{"texts": ["原文"], "notes": ""}]}',
    'after = {"slides": [{"texts": ["被改过"], "notes": ""}]}',
    'try:',
    '    style_spec.assert_content_unchanged(before, after, "pptx")',
    '    print("NOT-BLOCKED")',
    'except style_spec.ContentChangedError as exc:',
    '    print("BLOCKED", style_spec.ContentChangedError.exit_code)',
  ]);
  const r = pyRun('-c', [py]);
  assert(r && r.status === 0, '探针失败：' + (r && r.stderr));
  assert(r.stdout.trim() === 'BLOCKED 3', '断言语义不符：' + r.stdout.trim());
});

t('缺文件 → exit 2（cli_guard 中文提示）', function () {
  const r = pyRun(STYLE, ['apply-style', path.join(TMP, 'nope.pptx')]);
  if (!r) return 'skip';
  assert(r.status === 2 && (r.stderr || '').includes('不存在'), 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 120));
});

console.log('');
console.log('  PPT 存量美化回归: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
if (fail > 0) process.exit(1);
