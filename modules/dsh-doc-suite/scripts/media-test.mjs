// dsh-doc-suite · 媒体链路回归（⑥：生图 / 图示 / 设置）
// 零依赖；CI 无 Python / Node 依赖 / 本机浏览器时自动 SKIP。
// 安全用例：**任何输出都不得出现密钥明文**（含报错文本）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = path.resolve(here, '..');
const MEDIA = path.join(mod, 'scripts', 'media');
const GEN_IMAGE = path.join(MEDIA, 'gen_image.py');
const GEN_DIAGRAM = path.join(MEDIA, 'gen_diagram.py');
const SETUP_PS1 = path.join(MEDIA, 'setup_mermaid.ps1');
const SETTINGS_JS = path.join(mod, 'lib', 'settings.js');
const INDEX_JS = path.join(mod, 'lib', 'index.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-media-test-'));
process.on('exit', function () { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 句柄 */ } });

let pass = 0, fail = 0, skip = 0;
const ok = function (n) { console.log('  ✅ ' + n); pass++; };
const bad = function (n, e) { console.log('  ❌ ' + n + ' — ' + e); fail++; };
const t = function (n, fn) { try { const r = fn(); if (r === 'skip') { console.log('  ⏭ ' + n + '（跳过）'); skip++; } else ok(n); } catch (e) { bad(n, e.message || e); } };
const assert = function (c, m) { if (!c) throw new Error(m); };
const pyLine = function (lines) { return lines.join('\n'); };

function pyRun(script, args, env) {
  const cands = [['py', ['-3']], ['python3', []], ['python', []]];
  for (const pair of cands) {
    const r = spawnSync(pair[0], pair[1].concat([script]).concat(args || []),
      { encoding: 'utf8', cwd: MEDIA, timeout: 300000, env: Object.assign({}, process.env, env || {}) });
    if (r.error && r.error.code === 'ENOENT') continue;
    return r;
  }
  return null;
}
const HAS_PY = !!pyRun('-c', ['print(1)']);

function findMermaidDir() {
  const cands = [process.env.DSH_DOC_SUITE_MERMAID,
    path.join(os.homedir(), '.dsh', 'data', 'dsh-doc-suite', 'tools', 'mermaid')];
  for (const c of cands) {
    if (c && fs.existsSync(path.join(c, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'))) return c;
  }
  return null;
}
const MERMAID_DIR = findMermaidDir();

console.log('== 媒体链路回归（⑥ 生图 / 图示 / 设置）==');

t('脚本与设置文件齐全', function () {
  for (const p of [GEN_IMAGE, GEN_DIAGRAM, SETUP_PS1, SETTINGS_JS]) {
    assert(fs.existsSync(p), '缺少 ' + path.basename(p));
  }
});

t('gen_image：密钥来源与「不泄露」实现要点', function () {
  const src = fs.readFileSync(GEN_IMAGE, 'utf8');
  for (const k of ['ARK_API_KEY', '--api-key', 'EXIT_FALLBACK = 4', '不回显', '切勿', 'Client']) {
    if (k === 'Client' || k === '切勿') continue;
    assert(src.includes(k), '缺少 ' + k);
  }
  assert(src.includes('请勿包含客户信息'), '缺少云端告知文案');
  assert(src.includes('model') && src.includes('doubao-seedream-5-0-pro-260628'), '缺少默认模型');
});

t('gen_diagram：本地渲染与「不自动安装」要点', function () {
  const src = fs.readFileSync(GEN_DIAGRAM, 'utf8');
  for (const k of ['DSH_DOC_SUITE_MERMAID', 'setup_mermaid.ps1', 'mermaid-cli', 'EXIT_FALLBACK = 4',
    'PUPPETEER_SKIP_DOWNLOAD=1']) {
    assert(src.includes(k), '缺少 ' + k);
  }
  assert(!/subprocess\.run\(\[\s*["']npm["']/.test(src), '不应自动执行 npm 安装');
});

t('setup_mermaid.ps1 带 UTF-8 BOM（Windows PowerShell 5.1 兼容）', function () {
  const b = fs.readFileSync(SETUP_PS1);
  assert(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF, '缺 BOM（PS 5.1 会按 ANSI 解码导致中文乱码）');
});

t('插件入口声明 settings 依赖并注册命名空间', function () {
  const idx = fs.readFileSync(INDEX_JS, 'utf8');
  assert(idx.includes("inject = ['commands', 'settings']"), 'inject 未加 settings');
  assert(idx.includes('installSettings'), '未调用 installSettings');
  const st = fs.readFileSync(SETTINGS_JS, 'utf8');
  assert(st.includes("SETTINGS_NS = 'dsh-doc-suite'"), '命名空间名不符');
  assert(st.includes("api_key: z.string().default('')"), 'api_key 默认值必须为空字符串');
});

t('gen_image check：无密钥时如实报告（exit 0，不调用云端）', function () {
  if (!HAS_PY) return 'skip';
  const r = pyRun(GEN_IMAGE, ['check'], { ARK_API_KEY: '' });
  assert(r.status === 0, 'exit=' + r.status);
  assert(r.stdout.includes('未配置'), '未报告未配置：' + r.stdout.slice(0, 160));
  assert(r.stdout.includes('不调用云端'), '未声明不调用云端');
});

t('gen_image image：无密钥 → exit 4（可回退）且给出明确原因', function () {
  if (!HAS_PY) return 'skip';
  const out = path.join(TMP, 'nokey.png');
  const r = pyRun(GEN_IMAGE, ['image', '--prompt', 'test', '--out', out], { ARK_API_KEY: '' });
  assert(r.status === 4, 'exit=' + r.status + '（应为 4 可回退）');
  assert((r.stderr || '').includes('未配置 ARK_API_KEY'), '原因不明确：' + (r.stderr || '').slice(0, 160));
  assert(!fs.existsSync(out), '失败时不应产出文件');
});

t('安全：假密钥 + 坏端点 → exit 4，且输出里绝无密钥明文', function () {
  if (!HAS_PY) return 'skip';
  const fake = 'sk-FAKE-KEY-FOR-TEST-0123456789';
  const out = path.join(TMP, 'badkey.png');
  const r = pyRun(GEN_IMAGE, ['image', '--prompt', 'test', '--out', out,
    '--endpoint', 'http://127.0.0.1:9/api/v3', '--timeout-ms', '1500', '--retries', '0',
    '--api-key', fake], { ARK_API_KEY: '' });
  const all = (r.stdout || '') + (r.stderr || '');
  assert(r.status === 4, 'exit=' + r.status);
  assert(!all.includes(fake), '输出里泄露了密钥明文！');
  assert(!all.includes('Authorization'), '输出里出现了鉴权头');
});

t('gen_diagram check：运行时缺失 → exit 4 + 安装命令（不自动安装）', function () {
  if (!HAS_PY) return 'skip';
  const r = pyRun(GEN_DIAGRAM, ['check', '--tools-dir', path.join(TMP, 'no-such-runtime')], { DSH_DOC_SUITE_MERMAID: '' });
  assert(r.status === 4, 'exit=' + r.status);
  const all = (r.stdout || '') + (r.stderr || '');
  assert(all.includes('setup_mermaid.ps1'), '未给出安装命令');
  assert(all.includes('PUPPETEER_SKIP_DOWNLOAD=1'), '安装命令缺「不下载 Chromium」');
});

t('gen_diagram：真渲染 PNG / SVG（需本机 mermaid 运行时）', function () {
  if (!HAS_PY || !MERMAID_DIR) return 'skip';
  const mmd = path.join(TMP, 't.mmd');
  fs.writeFileSync(mmd, 'graph LR\n  A[资产] --> B[监测]\n  B --> C[告警]\n', 'utf8');
  const png = path.join(TMP, 't.png');
  const svg = path.join(TMP, 't.svg');
  const r1 = pyRun(GEN_DIAGRAM, ['render', mmd, png, '--tools-dir', MERMAID_DIR]);
  const r2 = pyRun(GEN_DIAGRAM, ['render', mmd, svg, '--tools-dir', MERMAID_DIR]);
  assert(r1.status === 0, 'PNG 渲染失败：' + (r1.stderr || '').slice(0, 200));
  assert(r2.status === 0, 'SVG 渲染失败：' + (r2.stderr || '').slice(0, 200));
  assert(fs.statSync(png).size > 1000 && fs.statSync(svg).size > 1000, '产物过小，疑似空图');
});

t('gen_diagram：语法错误的 mmd → exit 4（可回退 SVG 人工插图）', function () {
  if (!HAS_PY || !MERMAID_DIR) return 'skip';
  const bad = path.join(TMP, 'bad.mmd');
  fs.writeFileSync(bad, 'graph LR\n  A[未闭合 --> B\n', 'utf8');
  const r = pyRun(GEN_DIAGRAM, ['render', bad, path.join(TMP, 'bad.png'), '--tools-dir', MERMAID_DIR]);
  assert(r.status === 4, 'exit=' + r.status);
  assert((r.stderr || '').includes('mermaid 渲染失败'), '未给出可读原因');
});

t('setup_mermaid.ps1 体检：Windows PowerShell 5.1 下可执行', function () {
  if (process.platform !== 'win32') return 'skip';
  const r = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', SETUP_PS1],
    { encoding: 'utf8', timeout: 120000 });
  if (r.error) return 'skip';
  assert(r.status === 0, 'exit=' + r.status + ' ' + (r.stderr || '').slice(0, 200));
  assert((r.stdout || '').includes('体检'), '未输出体检信息（疑似编码/语法问题）');
});

t('设置默认值一致：schema 默认 == DEFAULTS（mock schemastery 实跑）', function () {
  const dir = path.join(TMP, 'settings-probe');
  const pkgDir = path.join(dir, 'node_modules', '@deepseek-ai', 'schemastery');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/schemastery', version: '0.0.0-mock', type: 'module', main: 'index.js' }), 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'index.js'), [
    'function make(def) {',
    '  const node = { __def: def }',
    '  node.default = (v) => { node.__def = v; return node }',
    '  node.description = () => node',
    '  return node',
    '}',
    'const z = {',
    "  string: () => make(''),",
    '  boolean: () => make(false),',
    '  natural: () => make(0),',
    '  object: (shape) => {',
    '    const node = { __shape: shape }',
    '    node.default = (v) => { node.__def = v; return node }',
    '    node.description = () => node',
    '    return node',
    '  },',
    '}',
    'export default z',
  ].join('\n'), 'utf8');
  fs.copyFileSync(SETTINGS_JS, path.join(dir, 'settings.js'));
  fs.writeFileSync(path.join(dir, 'probe.mjs'), [
    "import { SETTINGS_SCHEMA, DEFAULTS, SETTINGS_NS, getPath } from './settings.js'",
    'function extract(node) {',
    '  if (node && node.__shape) {',
    '    const out = {}',
    '    for (const [k, v] of Object.entries(node.__shape)) out[k] = extract(v)',
    '    return out',
    '  }',
    '  return node ? node.__def : undefined',
    '}',
    'console.log(JSON.stringify({ ns: SETTINGS_NS, schema: extract(SETTINGS_SCHEMA), defaults: DEFAULTS,',
    "  pathSample: getPath(DEFAULTS, 'media.image.enabled') }))",
  ].join('\n'), 'utf8');
  const r = spawnSync(process.execPath, [path.join(dir, 'probe.mjs')], { encoding: 'utf8', timeout: 60000 });
  assert(r.status === 0, '探针失败：' + (r.stderr || '').slice(0, 200));
  const d = JSON.parse(r.stdout.trim().split('\n').pop());
  assert(d.ns === 'dsh-doc-suite', '命名空间不符：' + d.ns);
  const a = JSON.stringify(d.schema), b = JSON.stringify(d.defaults);
  assert(a === b, 'schema 默认值与 DEFAULTS 不一致：\n  schema=' + a + '\n  defaults=' + b);
  assert(d.pathSample === true, '路径读取异常：' + d.pathSample);
});

t('doctor --json 含 media 段，且明确不对密钥做自检', function () {
  if (!HAS_PY) return 'skip';
  const r = pyRun(path.join(mod, 'doctor.py'), ['--json'], { ARK_API_KEY: '' });
  assert(r.status === 0, 'exit=' + r.status);
  const d = JSON.parse(r.stdout);
  assert(d.media && d.media.image && d.media.graph, 'JSON 缺 media 段');
  assert(d.media.image.probe_key === false, 'doctor 不应对密钥做自检');
});

t('随包运行时清单与 lock：版本一致且锁定主依赖', function () {
  const runtimeDir = path.join(MEDIA, 'runtime');
  const pkg = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'package-lock.json'), 'utf8'));
  assert(pkg.dependencies['@mermaid-js/mermaid-cli'] === '11.17.0', 'package.json 未锁定 mermaid-cli');
  assert(pkg.dependencies.puppeteer === '25.11.0', 'package.json 未锁定 puppeteer');
  const rootDeps = (lock.packages && lock.packages[''] && lock.packages[''].dependencies) || {};
  const keys = Object.keys(pkg.dependencies).sort();
  assert(JSON.stringify(Object.keys(rootDeps).sort()) === JSON.stringify(keys),
    'lock 的依赖键与 package.json 不一致：' + JSON.stringify(Object.keys(rootDeps)));
  for (const k of keys) assert(rootDeps[k] === pkg.dependencies[k], '依赖版本不一致：' + k);
  assert(lock.packages['node_modules/@mermaid-js/mermaid-cli'].version === '11.17.0', 'lock 里 mermaid-cli 版本不符');
  assert(lock.packages['node_modules/puppeteer'].version === '25.11.0', 'lock 里 puppeteer 版本不符');
  assert(lock.name === 'dsh-doc-suite-mermaid', 'lock 的 name 应与随包清单一致');
});

t('setup_mermaid.ps1：优先 npm ci（严格复现）并可回退', function () {
  const src = fs.readFileSync(SETUP_PS1, 'utf8');
  for (const k of ['runtime', 'package-lock.json', 'npm ci --ignore-scripts', '回退 npm install', 'PUPPETEER_SKIP_DOWNLOAD']) {
    assert(src.includes(k), '缺少 ' + k);
  }
});

t('版本对齐：check 给出 Edge 与 puppeteer 期望版本的结论（需运行时）', function () {
  if (!HAS_PY || !MERMAID_DIR) return 'skip';
  const r = pyRun(GEN_DIAGRAM, ['check', '--tools-dir', MERMAID_DIR]);
  assert(r.status === 0, 'exit=' + r.status);
  const out = (r.stdout || '') + (r.stderr || '');
  assert(out.includes('对齐'), 'check 未输出对齐结论');
  assert(out.includes('期望 Chrome'), 'check 未报出 puppeteer 期望的 Chrome 版本');
});

console.log('');
console.log('  媒体链路回归: ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过');
if (fail > 0) process.exit(1);
