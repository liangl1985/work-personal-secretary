/**
 * work-personal-secretary —— 身份写入模块自测（不依赖宿主运行时，也**不触碰任何真实环境**）
 *
 * 用法：node scripts/identity-test.mjs
 *
 * 覆盖（实施单 T7 验收项）：
 *   [1] 定位：无文件 / 单条命中 / 正文前缀必须是开头
 *   [2] dry-run：计划为 append 且零写盘
 *   [3] 追加真写：条目格式 / tag=关键 / 日期当天 / 无文件则无备份 / 锁已清理
 *   [4] 改写：保留原 id、日期更新、正文整条替换、其余条目逐字未变
 *   [5] **助手人设条目不被改动**
 *   [6] 多命中：拒绝并给可读原因，且不写盘
 *   [7] 回滚：写入抛错 → 文件恢复原样
 *   [8] 回滚：写后校验失败 → 文件恢复原样
 *   [9] BOM 拒绝 / 空正文拒绝
 *  [10] 陈旧锁被清理后仍可写入，写完锁文件不残留
 *
 * 隔离红线：全部夹具在 os.tmpdir() 下自建；本脚本不读写任何真实记忆库。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  ENTRY_DELIMITER,
  PERSONA_MARK,
  applyIdentity,
  entryBody,
  locateIdentity,
  makeIdentityEntry,
  readIdentity,
  todayStamp,
} from '../lib/identity.js'

let pass = 0
let fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; console.log('  ❌ ' + label) }
}
function section(title) { console.log('\n' + title) }

const ROOT = mkdtempSync(join(tmpdir(), 'wps-identity-test-'))
const memDir = join(ROOT, 'mem')
const memFile = join(memDir, 'MEMORY.md')
const lockPath = join(memDir, '.work-memory.lock')
const NOW = new Date('2026-09-16T10:00:00')
const NOW2 = new Date('2026-09-17T09:30:00')

function treeSnapshot(dir) {
  const out = {}
  const walk = (d, prefix) => {
    let ents = []
    try { ents = readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      const rel = prefix ? prefix + '/' + e.name : e.name
      const abs = join(d, e.name)
      if (e.isDirectory()) { out[rel] = 'dir'; walk(abs, rel) }
      else {
        try { const st = statSync(abs); out[rel] = st.size + ':' + st.mtimeMs } catch (err) { out[rel] = 'gone' }
      }
    }
  }
  walk(dir, '')
  return out
}
function sameTree(a, b) {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.join('|') !== kb.join('|')) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

console.log('identity-test · 夹具 ' + ROOT)

// ───────────────────── [1] 定位 ─────────────────────
section('[1] 定位与正文剥离')
const e1 = '[id:aaa111] [2026-01-01] [tag:关键] 使用者身份：内容'
ok(entryBody(e1) === '使用者身份：内容', 'entryBody 剥掉 id / 日期 / tag 元数据')
ok(locateIdentity([e1, '其它条目']).join(',') === '0', '唯一命中下标 0')
ok(locateIdentity(['【技能库】使用者身份：不在开头']).length === 0, '前缀必须在正文开头（不在开头不算命中）')
ok(locateIdentity([e1, e1]).length === 2, '同一前缀两条 → 命中两条')
ok(todayStamp(NOW) === '2026-09-16', 'todayStamp 用本地日期：' + todayStamp(NOW))

const rd0 = readIdentity({ memoryDir: memDir })
ok(rd0.ok === true && rd0.exists === false && rd0.count === 0, '记忆库还没有 MEMORY.md → exists=false / count=0')
ok(rd0.message.indexOf('还没有 MEMORY.md') > 0, '给出可读说明：' + rd0.message)

// ───────────────────── [2] dry-run ─────────────────────
section('[2] dry-run：append 计划且零写盘')
const tree0 = treeSnapshot(ROOT)
const r2dry = applyIdentity({ memoryDir: memDir, content: '从事信息安全售前工作。', now: NOW })
ok(r2dry.ok === true && r2dry.dryRun === true && r2dry.status === 'append', 'dry-run 计划为 append')
ok(r2dry.wroteAny === false && r2dry.bytesWritten === 0, 'dry-run 未写盘')
ok(!existsSync(memFile), 'dry-run 未创建 MEMORY.md')
ok(sameTree(tree0, treeSnapshot(ROOT)), 'dry-run 整棵树逐项一致')

// ───────────────────── [3] 追加真写 ─────────────────────
section('[3] 追加真写：格式 / tag / 日期 / 备份 / 锁')
const r3 = applyIdentity({ memoryDir: memDir, content: '从事信息安全售前工作。', now: NOW, dryRun: false, id: 'abc123def456' })
ok(r3.ok === true && r3.wroteAny === true && r3.status === 'append', '追加成功（wroteAny=true）')
ok(r3.backup === '', '文件原本不存在 → 无备份')
ok(r3.entryId === 'abc123def456', '新条目 id 可注入（便于测试）')
const t3 = readFileSync(memFile, 'utf8')
ok(t3 === '[id:abc123def456] [2026-09-16] [tag:关键] 使用者身份：从事信息安全售前工作。' + '\n', '文件内容逐字符合条目格式')
ok(!existsSync(lockPath), '写完锁文件已清理（与 work-memory 共用同一把 .work-memory.lock）')
const rd3 = readIdentity({ memoryFile: memFile })
ok(rd3.count === 1 && rd3.entryId === 'abc123def456' && rd3.content === '从事信息安全售前工作。', 'readIdentity 回读一致')

// ───────────────────── [4] 改写 ─────────────────────
section('[4] 改写：保留 id / 日期更新 / 其余条目逐字未变')
const persona = '[id:persona0001] [2026-09-01] [tag:关键] ' + PERSONA_MARK + '：知性、温柔、包容、温顺。'
const other = '[id:daily00001] [2026-09-15] [tag:常规] 今日日志：与主人过了一遍方案。'
writeFileSync(memFile, t3.replace(/\n$/, '') + ENTRY_DELIMITER + persona + ENTRY_DELIMITER + other + '\n', 'utf8')
const before4 = readFileSync(memFile, 'utf8')
const r4 = applyIdentity({ memoryFile: memFile, content: '从事财务与会计工作。', now: NOW2, dryRun: false })
ok(r4.ok === true && r4.status === 'rewrite' && r4.count === 1, '单命中 → 整条改写')
ok(r4.entryId === 'abc123def456', '原 id 被保留：' + r4.entryId)
ok(r4.entryBefore.indexOf('使用者身份：从事信息安全售前工作。') > 0, '改写前条目可回显')
const t4 = readFileSync(memFile, 'utf8')
ok(t4.indexOf('使用者身份：从事财务与会计工作。') > 0, '正文已整条替换')
ok(t4.indexOf('[2026-09-17]') > 0 && t4.indexOf('[2026-09-16]') < 0, '日期更新为写入当天')
ok(t4.indexOf('使用者身份：从事信息安全售前工作。') < 0, '旧正文不再存在（是改写不是追加）')
ok(t4.indexOf(persona) > 0 && t4.indexOf(other) > 0, '其余条目逐字保留')
ok(t4.indexOf(PERSONA_MARK + '：知性、温柔、包容、温顺。') > 0, '助手人设条目未被改动')
ok(r4.backup !== '' && existsSync(r4.backup), '写前备份存在：' + r4.backup.replace(/\\/g, '/'))
ok(r4.personaUntouched === true && r4.othersUntouched === true, '写入结果带 personaUntouched / othersUntouched 证据')
ok(!existsSync(lockPath), '改写完锁文件已清理')

// ───────────────────── [5] 多命中拒绝 ─────────────────────
section('[5] 多命中：拒绝且不写盘')
const dup = t4.replace(/\n$/, '') + ENTRY_DELIMITER + '[id:dup000000001] [2026-09-16] [tag:关键] 使用者身份：第二条身份。' + '\n'
writeFileSync(memFile, dup, 'utf8')
const r5 = applyIdentity({ memoryFile: memFile, content: '不该写入。', now: NOW, dryRun: false })
ok(r5.ok === false && r5.count === 2, '命中 2 条 → 拒绝（count=2）')
ok(/无法确定改哪一条/.test(r5.detail), '可读原因：' + r5.detail.slice(0, 60) + '…')
ok(readFileSync(memFile, 'utf8') === dup, '拒绝时一字未写')

// ───────────────────── [6] dry-run 不改既有文件 ─────────────────────
section('[6] 有既有文件时的 dry-run：不改动')
writeFileSync(memFile, t4, 'utf8')
const snap6 = treeSnapshot(ROOT)
const r6 = applyIdentity({ memoryFile: memFile, content: '干跑新内容。', now: NOW })
ok(r6.ok === true && r6.dryRun === true && r6.status === 'rewrite', 'dry-run 计划为 rewrite')
ok(!existsSync(join(memDir, 'MEMORY.md.bak-placeholder')), '无占位文件')
ok(sameTree(snap6, treeSnapshot(ROOT)), 'dry-run 未产生任何文件变化（无备份、无临时文件）')
ok(r6.plannedBackup !== '', 'dry-run 仍给出预计备份路径：' + r6.plannedBackup)

// ───────────────────── [7] 回滚：写入抛错 ─────────────────────
section('[7] 回滚：写入抛错 → 恢复原文件')
const before7 = readFileSync(memFile, 'utf8')
const r7 = applyIdentity({
  memoryFile: memFile, content: '不应写入的内容。', now: NOW, dryRun: false,
  io: { writeFileSync: () => { throw new Error('mock write fail') } },
})
ok(r7.ok === false && /已回滚/.test(r7.detail), '写入失败 → 报告已回滚：' + r7.detail.slice(0, 50) + '…')
ok(readFileSync(memFile, 'utf8') === before7, '文件内容与写前逐字一致')
ok(!existsSync(lockPath), '失败后锁文件也已清理')

// ───────────────────── [8] 回滚：写后校验失败 ─────────────────────
section('[8] 回滚：写后校验失败 → 恢复原文件')
const before8 = readFileSync(memFile, 'utf8')
const r8 = applyIdentity({
  memoryFile: memFile, content: '不应写入的内容。', now: NOW, dryRun: false,
  io: { writeFileSync: (file, data, opts) => { writeFileSync(file, '这不是条目格式', opts) } },
})
ok(r8.ok === false && /已回滚/.test(r8.detail), '写后校验失败 → 报告已回滚：' + r8.detail.slice(0, 50) + '…')
ok(readFileSync(memFile, 'utf8') === before8, '文件内容与写前逐字一致')

// ───────────────────── [9] BOM / 空正文 ─────────────────────
section('[9] BOM 拒绝与空正文拒绝')
writeFileSync(memFile, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(t4, 'utf8')]))
const r9 = applyIdentity({ memoryFile: memFile, content: 'x', now: NOW, dryRun: false })
ok(r9.ok === false && /BOM/.test(r9.detail), '带 BOM 的记忆库被拒绝写入')
const r9b = applyIdentity({ memoryFile: memFile, content: '   ', now: NOW })
ok(r9b.ok === false && /正文为空/.test(r9b.detail), '空正文被拒绝：' + r9b.detail.slice(0, 40) + '…')
const r9c = applyIdentity({ content: 'x' })
ok(r9c.ok === false && /没有可用的记忆库目录/.test(r9c.detail), '缺记忆库目录 → 可读拒绝')

// ───────────────────── [10] 陈旧锁 ─────────────────────
section('[10] 陈旧锁被清理后仍可写入，写完不残留')
writeFileSync(memFile, t4, 'utf8')
mkdirSync(memDir, { recursive: true })
writeFileSync(lockPath, '999999', 'utf8')
const old = new Date(Date.now() - 20000)
utimesSync(lockPath, old, old)
const r10 = applyIdentity({ memoryFile: memFile, content: '陈旧锁不应阻塞。', now: NOW, dryRun: false })
ok(r10.ok === true && r10.wroteAny === true, '陈旧锁被清理后写入成功')
ok(!existsSync(lockPath), '写完锁文件不残留')
ok(readFileSync(memFile, 'utf8').indexOf('使用者身份：陈旧锁不应阻塞。') > 0, '内容已写入')

// ───────────────────── 汇总 ─────────────────────
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' identity-test：' + pass + ' 通过 / ' + fail + ' 失败')
try { rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* best-effort */ }
process.exitCode = fail === 0 ? 0 : 1
