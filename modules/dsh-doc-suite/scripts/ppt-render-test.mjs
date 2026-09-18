// dsh-doc-suite · PPT 渲染器回归（零依赖；CI 无 Python 依赖时自动 SKIP）
// 覆盖：manifest 契约（11 类页型）· 实现关键点 · 实现与规格一致 · 校验/容错退出码 ·
//       渲染产物（页数 / 备注 / 表格列宽 / 告警）· list-layouts
// 夹具：每次都建一次性临时目录（mkdtemp），进程退出时清理；不触碰使用者目录与 profile。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(here, '..');
const OFF = path.join(mod, 'scripts', 'office');
const RENDER = path.join(OFF, 'ppt_render.py');
const PPT_TOOL = path.join(OFF, 'ppt_tool.py');
const SCHEMA = path.join(mod, 'specs', 'ppt-manifest.schema.json');
const SPEC = path.join(mod, 'specs', 'standard.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ppt-render-test-'));
process.on('exit', function () { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 句柄可能仍被占用 */ } });

let pass = 0, fail = 0, skip = 0;
const ok = function (n) { console.log('  ✅ ' + n); pass++; };
const bad = function (n, e) { console.log('  ❌ ' + n + ' — ' + e); fail++; };
const t = function (n, fn) { try { const r = fn(); if (r === 'skip') { console.log('  ⏭ ' + n + '（跳过）'); skip++; } else ok(n); } catch (e) { bad(n, e.message || e); } };
const assert = function (c, m) { if (!c) throw new Error(m); };
const pyLine = function (lines) { return lines.join('\n'); };

function pyRun(script, args) {
  const candidates = [['py', ['-3']], ['python3', []], ['python', []]];
  for (const pair of candidates) {
    const r = spawnSync(pair[0], pair[1].concat([script]).concat(args || []),
      { encoding: 'utf8', cwd: OFF, timeout: 180000 });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}
function pyProbe(code) {
  const candidates = [['py', ['-3']], ['python3', []], ['python', []]];
  for (const pair of candidates) {
    const r = spawnSync(pair[0], pair[1].concat(['-c', code]), { encoding: 'utf8', cwd: OFF, timeout: 60000 });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}
const HAS_PY = !!pyProbe('print(1)');
const HAS_PPTX = HAS_PY && (function () { const r = pyProbe('import pptx; print(1)'); return !!r && r.status === 0; })();
const FONT = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msyh.ttc');
const HAS_FONT = fs.existsSync(FONT);

// WPS 演示（KWPP）可用性：只在注册表里查 ProgID，**不实例化**——实例化会启动或接管使用者正开着的 WPS。
function wpsPptAvailable() {
  const code = pyLine([
    'import sys',
    'try:',
    '    import win32com.client  # noqa: F401',
    'except Exception:',
    '    sys.exit(1)',
    'try:',
    '    import winreg',
    '    winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "KWPP.Application").Close()',
    'except Exception:',
    '    sys.exit(1)',
    'print("yes")',
  ]);
  const r = pyProbe(code);
  return !!r && r.status === 0;
}

const NEED = ['cover', 'bullets', 'cards', 'toc', 'section', 'compare', 'data', 'chart', 'table', 'quote', 'closing',
  'image', 'process', 'timeline', 'case', 'qa'];

function writeJson(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  return p;
}
function manifest11() {
  return {
    schema: 'dsh-doc-suite/ppt-manifest@1',
    theme: 'standard',
    notes: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11'],
    slides: [
      { layout: 'cover', title: '封面标题', subtitle: '副标题', kicker: '2026' },
      { layout: 'toc', title: '目录', items: [{ index: '01', title: '一', page: '03' }, { index: '02', title: '二', page: '05' }] },
      { layout: 'section', index: '01', title: '章节' },
      { layout: 'bullets', title: '要点', bullets: ['第一条要点', '第二条要点'] },
      { layout: 'cards', title: '卡片', cards: [{ icon: 'shield', title: 'A', body: '甲' }, { title: 'B', body: '乙' }] },
      { layout: 'compare', title: '对比', left: { title: '前', body: ['a'] }, right: { title: '后', body: ['b'] } },
      { layout: 'data', title: '数据', items: [{ value: '98%', label: '覆盖率' }], body: ['说明一句'] },
      { layout: 'chart', title: '图表', type: 'bar', categories: ['1月', '2月'], series: [{ name: 'A', values: [1, 2] }] },
      { layout: 'table', title: '表格', header: ['序号', '设备类型说明列'], rows: [['1', '工业防火墙'], ['2', '流量审计']] },
      { layout: 'quote', text: '引用一句话。', attribution: '— 来源' },
      { layout: 'closing', title: '谢谢', subtitle: '后缀' },
    ],
  };
}
function manifest16() {
  const m = manifest11();
  m.slides = m.slides.concat([
    { layout: 'image', title: '图文', image: 'assets/icons/shield.png', caption: '图注', body: ['要点一', '要点二'] },
    { layout: 'process', title: '步骤', steps: [{ index: '01', title: 'A', body: 'a' }, { index: '02', title: 'B', body: 'b' }] },
    { layout: 'timeline', title: '时间线', milestones: [{ when: 'W1', title: 'X', body: 'x' }] },
    { layout: 'case', title: '案例', cases: [{ title: '客户甲', body: '项目说明', tag: '2025' }] },
    { layout: 'qa', title: '问答', items: [{ question: '问一', answer: '答一' }] },
  ]);
  m.notes = m.notes.concat(['n12', 'n13', 'n14', 'n15', 'n16']);
  return m;
}

function ruleWidth(p, pageIndex) {
  const py = pyLine([
    'import json, sys',
    'from pptx import Presentation',
    'EMU = 914400.0',
    'prs = Presentation(sys.argv[1])',
    'out = None',
    'for i, s in enumerate(prs.slides):',
    '    if i != int(sys.argv[2]):',
    '        continue',
    '    for sh in s.shapes:',
    '        if sh.top is not None and abs(sh.top - int(1.5 * EMU)) < 30000 and sh.height and sh.height < int(0.12 * EMU):',
    '            out = int(sh.width)',
    'print(json.dumps({"w": out}))',
  ]);
  const r = pyRun('-c', [py, p, String(pageIndex)]);
  if (!r || r.status !== 0) return null;
  const lines = r.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]).w;
}

function readPptx(p) {
  const py = pyLine([
    'import json, sys',
    'from pptx import Presentation',
    'prs = Presentation(sys.argv[1])',
    'out = {"pages": len(prs.slides._sldIdLst), "notes": [], "tables": []}',
    'for s in prs.slides:',
    '    out["notes"].append(s.notes_slide.notes_text_frame.text if s.has_notes_slide else "")',
    '    for sh in s.shapes:',
    '        if sh.has_table:',
    '            out["tables"].append([int(c.width) for c in sh.table.columns])',
    'print(json.dumps(out, ensure_ascii=False))',
  ]);
  const r = pyRun('-c', [py, p]);
  if (!r || r.status !== 0) return null;
  const lines = r.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

console.log('== PPT 渲染器回归（③a）==');

t('manifest 契约：schema 合法且含 11 类页型定义', function () {
  const s = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  for (const k of NEED) assert(s.$defs[k], 'schema 缺 $defs.' + k);
  assert(s.$defs.slide && Array.isArray(s.$defs.slide.allOf), 'slide.allOf 缺失');
  assert(s.$defs.slide.allOf.length >= 11, 'allOf 分支少于 11 类');
});

t('实现关键点齐全（行高口径 / 组件 / 原生对象 / 图标）', function () {
  const src = fs.readFileSync(RENDER, 'utf8');
  for (const k of ['SINGLE_LINE_EM', 'ICON_MARKS', '_draw_standard_page', '_draw_component',
    '_draw_chart', '_draw_table', '_draw_icon', 'CategoryChartData', 'add_table']) {
    assert(src.includes(k), '缺少 ' + k);
  }
});

t('实现页型与组件集合 = 规格集合', function () {
  const py = pyLine([
    'import json, sys',
    'sys.path.insert(0, ' + JSON.stringify(OFF) + ')',
    'sys.path.insert(0, ' + JSON.stringify(path.join(mod, 'scripts')) + ')',
    'import ppt_render as R',
    'spec = json.load(open(' + JSON.stringify(SPEC) + ', encoding="utf-8"))["pptx"]',
    'lays = [k for k in spec["layouts"] if not k.startswith("_")]',
    'comps = [k for k in spec["components"] if not k.startswith("_")]',
    'print(json.dumps({"il": list(R.IMPLEMENTED_LAYOUTS), "sl": lays, "ic": list(R.IMPLEMENTED_COMPONENTS), "sc": comps}))',
  ]);
  const r = pyRun('-c', [py]);
  if (!r) return 'skip';
  assert(r.status === 0, 'Python 读取失败：' + (r.stderr || '').slice(0, 200));
  const d = JSON.parse(r.stdout.trim().split('\n').pop());
  assert(d.sl.length === 16, '规格页型应为 16 类，实得 ' + d.sl.length);
  for (const k of d.sl) assert(d.il.includes(k), '实现未覆盖页型 ' + k);
  for (const k of d.ic) assert(d.sc.includes(k), '实现组件不在规格内：' + k);
});

t('validate：合法整册 → exit 0 且 11 类页型齐', function () {
  const r = pyRun(RENDER, ['validate', writeJson('ok.json', manifest11())]);
  if (!r) return 'skip';
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
  assert((r.stdout + r.stderr).includes('11 页'), '未报告 11 页');
});

t('validate：cover 缺 title → exit 2 且指名页号', function () {
  const m = manifest11(); delete m.slides[0].title;
  const r = pyRun(RENDER, ['validate', writeJson('miss-cover.json', m)]);
  if (!r) return 'skip';
  assert(r.status === 2, 'exit=' + r.status);
  assert(r.stderr.includes('manifest.slides[0]') && r.stderr.includes('title'), '错误未指名页号：' + r.stderr.slice(0, 200));
});

t('validate：toc 缺 items / quote 缺 text → exit 2', function () {
  const a = manifest11(); delete a.slides[1].items;
  const ra = pyRun(RENDER, ['validate', writeJson('miss-toc.json', a)]);
  const b = manifest11(); delete b.slides[9].text;
  const rb = pyRun(RENDER, ['validate', writeJson('miss-quote.json', b)]);
  if (!ra || !rb) return 'skip';
  assert(ra.status === 2, 'toc exit=' + ra.status);
  assert(rb.status === 2, 'quote exit=' + rb.status);
});

t('validate：chart series values 为空 → exit 2（minItems）', function () {
  const m = manifest11(); m.slides[7].series = [{ name: 'A', values: [] }];
  const r = pyRun(RENDER, ['validate', writeJson('bad-series.json', m)]);
  if (!r) return 'skip';
  assert(r.status === 2, 'exit=' + r.status);
});

t('validate：未知 layout → 退化 bullets 并告警', function () {
  const m = manifest11(); m.slides[3].layout = 'roadmap';   // 真正未实现的页型（timeline 已在 ③b 实现）
  const r = pyRun(RENDER, ['validate', writeJson('unknown.json', m)]);
  if (!r) return 'skip';
  assert(r.status === 0, 'exit=' + r.status);
  assert((r.stdout + r.stderr).includes('退化'), '未给出退化告警');
});

t('validate：未知字段忽略 → exit 0', function () {
  const m = manifest11(); m.slides[3].whatever = { a: 1 }; m.junk = [1, 2];
  const r = pyRun(RENDER, ['validate', writeJson('unknown-field.json', m)]);
  if (!r) return 'skip';
  assert(r.status === 0, 'exit=' + r.status);
});

t('validate：JSON 带 BOM / 非法 JSON → exit 2', function () {
  const bom = path.join(TMP, 'bom.json');
  fs.writeFileSync(bom, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(JSON.stringify(manifest11()), 'utf8')]));
  const rb = pyRun(RENDER, ['validate', bom]);
  const bad = path.join(TMP, 'bad.json');
  fs.writeFileSync(bad, '{ not json', 'utf8');
  const rj = pyRun(RENDER, ['validate', bad]);
  if (!rb || !rj) return 'skip';
  assert(rb.status === 2 && rb.stderr.includes('BOM'), 'BOM 未拦截：' + rb.stderr.slice(0, 120));
  assert(rj.status === 2 && rj.stderr.includes('合法 JSON'), '非法 JSON 未拦截');
});

t('validate：缺文件 → exit 2（cli_guard 中文提示）', function () {
  const r = pyRun(RENDER, ['validate', path.join(TMP, 'nope.json')]);
  if (!r) return 'skip';
  assert(r.status === 2 && r.stderr.includes('不存在'), 'exit=' + r.status + ' ' + r.stderr.slice(0, 120));
});

t('list-layouts：11 类已实现 + 5 类未实现', function () {
  const r = pyRun(RENDER, ['list-layouts']);
  if (!r) return 'skip';
  assert(r.status === 0, 'exit=' + r.status);
  const txt = r.stdout;
  assert((txt.match(/✔/g) || []).length >= 20, '✔ 数量不足（页型 16 + 组件 8）');
  for (const k of NEED) assert(txt.includes(k), 'list-layouts 未列出 ' + k);
});

t('随包主题模板齐备且可加载（report + WPS 三套 · 不需 python-pptx · CI 真跑）', function () {
  const themes = [['report', 'A34A00'], ['dusk', '4F6C97'], ['azure', '0060E0'], ['crimson', 'BC0300']];
  for (const pair of themes) {
    const id = pair[0], accent = pair[1];
    const specFile = path.join(mod, 'specs', id + '.json');
    assert(fs.existsSync(specFile), '内置模板缺失：specs/' + id + '.json');
    const cfg = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    assert(cfg.id === id && cfg.extends === 'standard', id + ' 规格基本字段不符');
    assert(cfg.colors && cfg.colors.accent === accent, id + ' 强调色应为 ' + accent + '，实得 ' + ((cfg.colors || {}).accent));
  }
  for (const pair of themes) {
    const id = pair[0];
    const r = pyRun(RENDER, ['list-layouts', '--theme', id]);
    if (!r) return 'skip';
    assert(r.status === 0, id + ' list-layouts exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
    assert(r.stdout.includes(id), '未报告主题 id：' + id);
    assert((r.stdout.match(/✔/g) || []).length >= 20, id + ' 几何不完整（✔ 不足）');
  }
});

t('render：11 页整册 → exit 0 且页数正确', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'deck11.pptx');
  const r = pyRun(RENDER, ['render', writeJson('deck11.json', manifest11()), out]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
  const d = readPptx(out);
  assert(d && d.pages === 11, '页数应为 11，实得 ' + (d ? d.pages : 'null'));
});

t('render：演讲者备注逐页写入', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'notes.pptx');
  const r = pyRun(RENDER, ['render', writeJson('notes.json', manifest11()), out]);
  assert(r.status === 0, 'exit=' + r.status);
  const d = readPptx(out);
  assert(d && d.notes.length === 11 && d.notes.every(function (x) { return x && x.trim(); }), '备注未逐页写入：' + JSON.stringify(d && d.notes));
});

t('render：表格列宽按内容分配（不等宽）', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'table.pptx');
  const r = pyRun(RENDER, ['render', writeJson('table.json', manifest11()), out]);
  assert(r.status === 0, 'exit=' + r.status);
  const d = readPptx(out);
  assert(d && d.tables.length === 1, '未找到表格');
  const w = d.tables[0];
  assert(w.length === 2, '列数应为 2');
  assert(Math.abs(w[0] - w[1]) > 100000, '列宽疑似等分：' + JSON.stringify(w));
  assert(w[1] > w[0], '内容更长的列应更宽：' + JSON.stringify(w));
});

t('render：chart 空 series 被契约拦下 → exit 2（渲染器告警属防御路径）', function () {
  if (!HAS_PPTX) return 'skip';
  const m = manifest11(); m.slides[7].series = [];
  const r = pyRun(RENDER, ['render', writeJson('chart-empty.json', m), path.join(TMP, 'chart-empty.pptx')]);
  assert(r.status === 2, 'exit=' + r.status + '（应由 schema 的 minItems 拦下）');
  assert(!fs.existsSync(path.join(TMP, 'chart-empty.pptx')), '被拒的 manifest 不应产出文件');
});

t('render：categories 少于数值个数 → 自动补索引且不报错', function () {
  if (!HAS_PPTX) return 'skip';
  const m = manifest11();
  m.slides[7].categories = ['1月'];
  m.slides[7].series = [{ name: 'A', values: [1, 2, 3] }];
  const out = path.join(TMP, 'chart-short-cats.pptx');
  const r = pyRun(RENDER, ['render', writeJson('chart-short.json', m), out]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  assert(fs.existsSync(out), '未产出文件');
});

t('render：max_slides 裁剪 → 只出前 N 页并告警', function () {
  if (!HAS_PPTX) return 'skip';
  const m = manifest11(); m.limits = { max_slides: 3 };
  const out = path.join(TMP, 'cut.pptx');
  const r = pyRun(RENDER, ['render', writeJson('cut.json', m), out]);
  assert(r.status === 0, 'exit=' + r.status);
  const d = readPptx(out);
  assert(d && d.pages === 3, '应裁到 3 页，实得 ' + (d ? d.pages : 'null'));
  assert((r.stdout + r.stderr).includes('max_slides'), '未告警裁剪');
});

t('render：超容量自动缩字号（依赖本机字体）', function () {
  if (!HAS_PPTX || !HAS_FONT) return 'skip';
  const m = manifest11();
  m.slides[3].bullets = [];
  for (let i = 0; i < 8; i++) {
    m.slides[3].bullets.push('这是一条刻意写得很长的要点，用来把要点区彻底撑满并触发渲染器自动缩字号的判定逻辑，' +
      '正文区只有四点八五英寸高而这条要点本身就要占掉两行以上，因此它必须触发容量判定第 ' + (i + 1) + ' 条');
  }
  const r = pyRun(RENDER, ['render', writeJson('overflow.json', m), path.join(TMP, 'overflow.pptx')]);
  assert(r.status === 0, 'exit=' + r.status);
  assert((r.stdout + r.stderr).includes('→') || (r.stdout + r.stderr).includes('17pt'), '未触发缩字号：' + (r.stdout || '').slice(-200));
});

t('render：16 页整册（含扩展 5 类）→ exit 0 且页数正确', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'deck16.pptx');
  const r = pyRun(RENDER, ['render', writeJson('deck16.json', manifest16()), out]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
  const d = readPptx(out);
  assert(d && d.pages === 16, '页数应为 16，实得 ' + (d ? d.pages : 'null'));
});

t('render：image 图缺失 → 占位并告警；图存在则无告警', function () {
  if (!HAS_PPTX) return 'skip';
  const miss = manifest16();
  miss.slides[11].image = 'assets/icons/__nope__.png';
  const r1 = pyRun(RENDER, ['render', writeJson('img-miss.json', miss), path.join(TMP, 'img-miss.pptx')]);
  assert(r1.status === 0, 'exit=' + r1.status);
  assert((r1.stdout + r1.stderr).includes('占位框'), '缺图未告警：' + (r1.stdout || '').slice(-160));
  const r2 = pyRun(RENDER, ['render', writeJson('img-ok.json', manifest16()), path.join(TMP, 'img-ok.pptx')]);
  assert(r2.status === 0 && !(r2.stdout + r2.stderr).includes('占位框'), '图存在时不应出现占位告警');
});

t('render：qa 页固定文本 Q 写入圆标', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'qa.pptx');
  const r = pyRun(RENDER, ['render', writeJson('qa16.json', manifest16()), out]);
  assert(r.status === 0, 'exit=' + r.status);
  const py = pyLine([
    'import json, sys',
    'from pptx import Presentation',
    'prs = Presentation(sys.argv[1])',
    'texts = []',
    'for s in prs.slides:',
    '    for sh in s.shapes:',
    '        if sh.has_text_frame:',
    '            texts.append(sh.text_frame.text)',
    'print(json.dumps({"has_q": any(t.strip() == "Q" for t in texts)}))',
  ]);
  const rr = pyRun('-c', [py, out]);
  assert(rr && rr.status === 0, '读回失败：' + (rr && rr.stderr));
  const d = JSON.parse(rr.stdout.trim().split('\n').pop());
  assert(d.has_q, '未找到固定文本 Q');
});

t('render：装饰线宽跟随标题文字长度（follow_text）', function () {
  if (!HAS_PPTX) return 'skip';
  const shortM = manifest11();
  const longM = manifest11();
  longM.slides[3].title = '这是一个明显更长的页面标题用来验证装饰线跟随';
  const a = path.join(TMP, 'rule-short.pptx');
  const b = path.join(TMP, 'rule-long.pptx');
  const ra = pyRun(RENDER, ['render', writeJson('rule-s.json', shortM), a]);
  const rb = pyRun(RENDER, ['render', writeJson('rule-l.json', longM), b]);
  assert(ra.status === 0 && rb.status === 0, 'render 失败：' + ra.status + '/' + rb.status);
  const wa = ruleWidth(a, 3);
  const wb = ruleWidth(b, 3);
  assert(wa && wb, '未找到装饰线：' + JSON.stringify([wa, wb]));
  assert(wb > wa + 500000, '长标题的装饰线应明显更宽：' + wa + ' → ' + wb);
});

t('render：--dry-run 不写文件', function () {
  if (!HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'dry.pptx');
  const r = pyRun(RENDER, ['render', '--dry-run', writeJson('dry.json', manifest11()), out]);
  assert(r.status === 0, 'exit=' + r.status);
  assert(!fs.existsSync(out), '--dry-run 不应写文件');
  assert((r.stdout + r.stderr).includes('--dry-run'), '未声明 dry-run');
});

t('render → 导出 PDF（WPS COM；本机才跑，CI 自动 SKIP）', function () {
  if (!HAS_PPTX || !HAS_FONT) return 'skip';
  if (!wpsPptAvailable()) return 'skip';
  const deck = path.join(TMP, 'pdf-src.pptx');
  const r1 = pyRun(RENDER, ['render', writeJson('pdf.json', manifest11()), deck]);
  assert(r1.status === 0, '渲染失败：' + (r1.stderr || r1.stdout || '').slice(0, 200));
  const pdf = path.join(TMP, 'pdf-out.pdf');
  const r2 = pyRun(PPT_TOOL, ['convert', deck, pdf]);
  assert(r2.status === 0, 'convert exit=' + r2.status + ' ' + (r2.stderr || r2.stdout || '').slice(0, 200));
  assert(fs.existsSync(pdf), '未产出 PDF');
  const head = fs.readFileSync(pdf).subarray(0, 5).toString('latin1');
  assert(head === '%PDF-', 'PDF 文件头不符：' + JSON.stringify(head));
});

console.log('');
console.log('  PPT 渲染器回归: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
if (fail > 0) process.exit(1);
