// dsh-doc-suite · 主题库回归（ppt_theme：list / inspect / import / 字体解析）
// 零依赖；CI 无 Python 时自动 SKIP。**不依赖任何使用者业务文件**（用自造 pptx 当母版样本）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(here, '..');
const OFF = path.join(mod, 'scripts', 'office');
const THEME = path.join(OFF, 'ppt_theme.py');
const CONTRAST = path.join(OFF, 'ppt_contrast.py');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-theme-test-'));
process.on('exit', function () { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 句柄 */ } });

let pass = 0, fail = 0, skip = 0;
const ok = function (n) { console.log('  ✅ ' + n); pass++; };
const bad = function (n, e) { console.log('  ❌ ' + n + ' — ' + e); fail++; };
const t = function (n, fn) { try { const r = fn(); if (r === 'skip') { console.log('  ⏭ ' + n + '（跳过）'); skip++; } else ok(n); } catch (e) { bad(n, e.message || e); } };
const assert = function (c, m) { if (!c) throw new Error(m); };

function py(script, args, env) {
  const cands = [['py', ['-3']], ['python3', []], ['python', []]];
  for (const pair of cands) {
    const r = spawnSync(pair[0], pair[1].concat([script]).concat(args || []),
      { encoding: 'utf8', cwd: OFF, timeout: 300000, env: Object.assign({}, process.env, env || {}) });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}
const HAS_PY = !!py('-c', ['print(1)']);
// python-pptx guard: CI runs py_compile only and installs no pip packages; sample-dependent cases must SKIP, not FAIL.
const HAS_PPTX = HAS_PY && (function () { const r = py('-c', ['import pptx; print(1)']); return !!r && r.status === 0; })();

// 自造「母版样本」：python-pptx 生成的 pptx 自带 theme1.xml / slideMaster / slideLayouts
const MAKE = [
  'import sys',
  'from pptx import Presentation',
  'from pptx.util import Inches',
  'prs = Presentation()',
  'prs.slide_width = Inches(13.3333); prs.slide_height = Inches(7.5)',
  'prs.slides.add_slide(prs.slide_layouts[0])',
  'prs.slides.add_slide(prs.slide_layouts[1])',
  'prs.save(sys.argv[1])',
].join('\n');
const SAMPLE = path.join(TMP, 'master-sample.pptx');
if (HAS_PPTX) {
  const r = py('-c', [MAKE, SAMPLE]);
  if (!r || r.status !== 0) console.log('  （样本生成失败：' + (r && r.stderr || '').slice(0, 120) + '）');
}

console.log('== 主题库回归（ppt_theme）==');

t('实现要点齐全', function () {
  const src = fs.readFileSync(THEME, 'utf8');
  for (const k of ['def cmd_list', 'def cmd_inspect', 'def cmd_import', 'def darken_to_aa',
    'allowed_fonts', 'OFFICE_DEFAULT_ACCENTS', 'EXIT_EXISTS', '不搬内容']) {
    assert(src.includes(k), 'ppt_theme.py 缺少 ' + k);
  }
  const tool = fs.readFileSync(path.join(OFF, 'ppt_tool.py'), 'utf8');
  assert(tool.includes('"microsoft yahei ui": "msyh.ttc"'), '字体映射缺 microsoft yahei ui');
  assert(tool.includes('"calibri light": "calibril.ttf"'), '字体映射缺 calibri light');
});

t('list：列出内置与自定义层主题', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const r = py(THEME, ['list']);
  assert(r.status === 0, 'exit=' + r.status);
  for (const id of ['standard', 'graphite', 'teal', 'wine', 'dusk', 'azure', 'crimson']) {
    assert(r.stdout.includes(id), '清单缺可用于 PPT 的 ' + id);
  }
  for (const id of ['compact', 'report', 'govdoc']) {
    assert(!new RegExp('^' + id + '\\s', 'm').test(r.stdout), '文档规格不应出现在 PPT 主题清单：' + id);
  }
  assert(r.stdout.includes('内置'), '未标注来源');
});

t('inspect：只读检视母版（不写文件）', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const r = py(THEME, ['inspect', SAMPLE]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  for (const k of ['主题', '母版', '色板', '字体']) {
    assert(r.stdout.includes(k), '报告缺「' + k + '」');
  }
});

t('import：从母版生成自定义层主题（结构完整）', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'imported.json');
  const r = py(THEME, ['import', SAMPLE, '--id', 'probe', '--name', 'Probe Master', '--out', out]);
  assert(r.status === 0 || r.status === 4, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
  assert(fs.existsSync(out), '未生成主题文件');
  const cfg = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert(cfg.id === 'probe' && cfg.extends === 'standard', '基本字段不符');
  for (const k of ['primary', 'secondary', 'accent', 'accent_decor']) {
    assert(/^[0-9A-F]{6}$/.test(cfg.colors[k]), '颜色字段不符：' + k);
  }
  assert(cfg.pptx.fonts.heading.ea && cfg.pptx.fonts.body.ea, '字体未写入');
  assert(Array.isArray(cfg.pptx.allowed_fonts) && cfg.pptx.allowed_fonts.length > 0, 'allowed_fonts 未写入');
  assert(/^[0-9A-F]{6}$/.test(cfg.pptx.color_roles.chart_series.s1), 'chart_series 未写入');
  assert(cfg.pptx.slide.width_emu > 0, '页面尺寸未写入');
  assert(String(cfg._note).includes('不搬内容'), '_note 未声明只搬视觉令牌');
});

t('import：目标已存在时 exit 3（需 --force）', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'exists.json');
  fs.writeFileSync(out, '{}', 'utf8');
  const r = py(THEME, ['import', SAMPLE, '--id', 'exists', '--out', out]);
  assert(r.status === 3, 'exit=' + r.status + '（期望 3）');
  assert((r.stderr || '').includes('已存在'), '未说明原因');
});

t('压暗算法：白底与备用底同时达标', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const probe = [
    'import sys',
    'sys.path.insert(0, r"' + OFF + '")',
    'from ppt_theme import darken_to_aa',
    'from ppt_contrast import ratio',
    'c, f, ok = darken_to_aa("6096E6")',
    'print(c, f, ok, round(ratio(c, "FFFFFF"), 2), round(ratio(c, "F2F2F2"), 2))',
  ].join('\n');
  const r = py('-c', [probe]);
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 160));
  const parts = r.stdout.trim().split(/\s+/);
  assert(parts[2] === 'True', '未达标：' + r.stdout.trim());
  assert(parseFloat(parts[3]) >= 4.5 && parseFloat(parts[4]) >= 4.5, '双背景未同时达标：' + r.stdout.trim());
});

t('导入结果过对比度门禁（自造母版）', function () {
  if (!HAS_PY || !HAS_PPTX) return 'skip';
  const out = path.join(TMP, 'gate.json');
  py(THEME, ['import', SAMPLE, '--id', 'gate', '--out', out, '--force']);
  const r = py(CONTRAST, ['check', '--spec', out]);
  assert(r.status === 0, '对比度不达标：' + (r.stdout || '').slice(0, 200));
});

console.log('');
console.log('  主题库回归: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
if (fail > 0) process.exit(1);
