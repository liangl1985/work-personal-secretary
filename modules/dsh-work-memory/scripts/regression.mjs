/**
 * work-memory — 回归测试（node scripts/regression.mjs）
 * 覆盖：存储层（解析/序列化/去重比对）、归档（DAILY 按月合并/条目 TTL/关键保留/防抖）、
 * 快照（活动日志过滤）、子代理门控（在可解析 dsh-tools 的环境下）。
 * 零外部依赖可跑核心部分；门控部分在 DSH 安装环境自动启用。
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const lib = join(here, '..', 'lib')

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name) }
}

// ---------- 1. 存储层 ----------
const { MemoryStore, makeEntry, parseEntries, serializeEntries, stripEntryId, extractEntryId, DAILY_ACTIVITY_PREFIX } = await import(pathToFileURL(join(lib, 'store.js')).href)
{
  const root = join(here, '..', '.regression-tmp')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const store = new MemoryStore(join(root, 'MEMORY.md'))
  store.ensure()
  store.add(makeEntry('测试条目一', { tag: '常规' }))
  store.add(makeEntry('测试条目二', { tag: '关键' }))
  const entries = store.entries()
  check('存储：读改写追加 2 条且无双重分隔符', entries.length === 2 && entries.every((e) => e.trim().length > 0))
  check('存储：stripEntryId 去掉 id 前缀', !stripEntryId(entries[0]).startsWith('[id:'))
  check('存储：extractEntryId 可取回 id', entries.every((e) => /^[a-f0-9]{12}$/.test(extractEntryId(e) || '')))
  check('存储：去重比对（endsWith 元数据前缀）', stripEntryId(entries[0]).endsWith('测试条目一'))
  rmSync(root, { recursive: true, force: true })
}

// ---------- 2. 归档 ----------
const { runArchive, listArchive, archiveEntries, promoteEntry, readArchiveIndex, daysSinceMaintain, markMaintain } = await import(pathToFileURL(join(lib, 'archive.js')).href)
const { touchAccess } = await import(pathToFileURL(join(lib, 'access.js')).href)
const { todayStamp, addDays } = await import(pathToFileURL(join(lib, 'clock.js')).href)
{
  const root = join(here, '..', '.regression-tmp')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'DAILY'), { recursive: true })
  mkdirSync(join(root, 'PROJECTS'), { recursive: true })
  const today = todayStamp()
  const d = (n) => addDays(today, n)
  writeFileSync(join(root, 'DAILY', d(-40) + '.md'), serializeEntries([makeEntry('40天前的日志', { date: d(-40), tag: '常规' })]), 'utf8')
  writeFileSync(join(root, 'DAILY', d(-2) + '.md'), serializeEntries([makeEntry('2天前的日志', { date: d(-2), tag: '关键' })]), 'utf8')
  // 起始点用例：文件日期已超期，但里面有条目今天被用过 → 整个文件顺延、不按周合并
  writeFileSync(join(root, 'DAILY', d(-30) + '.md'), serializeEntries([makeEntry('30天前的日志（今天被召回，应顺延）', { date: d(-30), tag: '常规' })]), 'utf8')
  // 全局：永不归档（含 100 天前的常规）
  writeFileSync(join(root, 'MEMORY.md'), serializeEntries([
    makeEntry('100天前的全局常规（应永不归档）', { date: d(-100), tag: '常规' }),
    makeEntry('全局关键', { date: d(-100), tag: '关键' }),
  ]), 'utf8')
  // 偏好：TTL 90
  writeFileSync(join(root, 'USER.md'), serializeEntries([
    makeEntry('100天前的偏好常规（应归档）', { date: d(-100), tag: '常规' }),
    makeEntry('偏好关键（永不）', { date: d(-100), tag: '关键' }),
  ]), 'utf8')
  // 项目：TTL 30；其中一条"最近被用到过"应顺延保留
  writeFileSync(join(root, 'PROJECTS', '测试项目.md'), serializeEntries([
    makeEntry('40天前的项目常规（应归档）', { date: d(-40), tag: '常规' }),
    makeEntry('40天前但最近用过（应保留）', { date: d(-40), tag: '常规' }),
    makeEntry('正好30天前（最后一天，应保留）', { date: d(-30), tag: '常规' }),
    makeEntry('31天前（应归档）', { date: d(-31), tag: '常规' }),
  ]), 'utf8')
  const projEntries = new MemoryStore(join(root, 'PROJECTS', '测试项目.md')).entries()
  const usedId = extractEntryId(projEntries[1])
  touchAccess(root, usedId)
  // DAILY 顺延用例：给 30 天前那天的条目打一次"今天用过"
  const dailyTouchedId = extractEntryId(new MemoryStore(join(root, 'DAILY', d(-30) + '.md')).entries()[0])
  touchAccess(root, dailyTouchedId)

  // 本段考的是**纯 TTL 机制**，故显式关掉转冷预审（预审行为另见 4.9）
  const rep = runArchive(root, { dailyRetentionDays: 5, projectTtlDays: 30, userTtlDays: 90, triageEnabled: false })
  check('归档：过期 DAILY 按周合并删除', rep.dailies === 1 && !existsSync(join(root, 'DAILY', d(-40) + '.md')))
  check('归档：近期 DAILY 保留', existsSync(join(root, 'DAILY', d(-2) + '.md')))
  check('归档：DAILY 合并到按周文件', listArchive(root).some((f) => /^daily-\d{4}-W\d{2}\.md$/.test(f.file)))
  check('归档：30 天前的 DAILY 因「今天用过」而顺延保留（起始点规则）',
    existsSync(join(root, 'DAILY', d(-30) + '.md'))
    && rep.due.some((x) => x.scope === 'daily' && x.basis === 'used'))
  check('归档：偏好过期常规移入 entries.md', rep.entries === 3 && archiveEntries(root, 50).some((x) => x.entry.includes('100天前的偏好常规')) && archiveEntries(root, 50).some((x) => x.entry.includes('40天前的项目常规（应归档）')))
  const memTxt = readFileSync(join(root, 'MEMORY.md'), 'utf8')
  check('归档：全局永不归档（100 天前的常规仍在 MEMORY.md）', memTxt.includes('100天前的全局常规（应永不归档）'))
  check('归档：关键条目永不归档', memTxt.includes('全局关键') && readFileSync(join(root, 'USER.md'), 'utf8').includes('偏好关键（永不）'))
  const projTxt = readFileSync(join(root, 'PROJECTS', '测试项目.md'), 'utf8')
  check('归档：「被用到过」的旧条目顺延保留', projTxt.includes('40天前但最近用过（应保留）'))
  check('归档：TTL 边界——正好 30 天前仍是最后一天（保留）', projTxt.includes('正好30天前（最后一天，应保留）'))
  check('归档：TTL 边界——第 31 天转冷', !projTxt.includes('31天前（应归档）') && archiveEntries(root, 50).some((x) => x.entry.includes('31天前（应归档）')))
  check('归档：索引记录了来源范围', Object.values(readArchiveIndex(root)).some((m) => m.scope === 'project'))
  check('归档：当日防抖 skipped', runArchive(root, { dailyRetentionDays: 5, projectTtlDays: 30, userTtlDays: 90, triageEnabled: false }).skipped === true)

  // 冷 → 热：转回原范围并保留原 id
  const idx = readArchiveIndex(root)
  const pid = Object.keys(idx).find((k) => idx[k].scope === 'project')
  const beforePromote = readFileSync(join(root, 'PROJECTS', '测试项目.md'), 'utf8')
  const pr = promoteEntry(root, pid)
  check('转热：写回原范围且成功', pr.ok === true && String(pr.file || '').includes('PROJECTS'))
  check('转热：原范围文件里出现了该 id', readFileSync(join(root, 'PROJECTS', '测试项目.md'), 'utf8').includes(pid) && !beforePromote.includes(pid))
  check('转热：归档索引里已移除', !readArchiveIndex(root)[pid])
  check('转热：归档内容里也不再保留', !archiveEntries(root, 200).some((x) => x.id === pid))

  // 周保养标记
  check('周保养：初始无标记', daysSinceMaintain(root) === null)
  markMaintain(root)
  check('周保养：标记后为 0 天', daysSinceMaintain(root) === 0)
  rmSync(root, { recursive: true, force: true })
}

// ---------- 3. 快照过滤 ----------
const { buildSnapshot } = await import(pathToFileURL(join(lib, 'context.js')).href)
{
  const root = join(here, '..', '.regression-tmp')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'DAILY'), { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const daily = new MemoryStore(join(root, 'DAILY', today + '.md'))
  daily.ensure()
  daily.add(makeEntry('今日：真实日志条目', { tag: '常规' }))
  daily.add(makeEntry(DAILY_ACTIVITY_PREFIX + '（10:00）', { tag: '常规' }))
  const snap = buildSnapshot({ root, maxChars: 2000 })
  check('快照：包含真实日志', snap.includes('今日：真实日志条目'))
  check('快照：过滤活动日志行', !snap.includes(DAILY_ACTIVITY_PREFIX))
  rmSync(root, { recursive: true, force: true })
}


// ---------- 3.5 备份 ----------
const { backupMemory, listBackups } = await import(pathToFileURL(join(lib, 'backup.js')).href)
{
  const root = join(here, '..', '.regression-tmp')
  const bdir = join(here, '..', '.regression-tmp-bak')
  rmSync(root, { recursive: true, force: true })
  rmSync(bdir, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const store = new MemoryStore(join(root, 'MEMORY.md'))
  store.ensure()
  store.add(makeEntry('备份测试条目', { tag: '常规' }))
  const r1 = backupMemory(root, { backupDir: bdir, keep: 3 })
  check('备份：全量复制成功', r1.ok === true && r1.files >= 1 && existsSync(join(bdir, 'backup-' + new Date().toISOString().slice(0, 10), 'MEMORY.md')))
  const r2 = backupMemory(root, { backupDir: bdir, keep: 3 })
  check('备份：当日防抖 skipped', r2.skipped === true)
  // keep 清理：删除今日目录模拟次日 + 伪造 3 个更早备份（共 4 份 > keep=3）
  rmSync(join(bdir, 'backup-' + new Date().toISOString().slice(0, 10)), { recursive: true, force: true })
  mkdirSync(join(bdir, 'backup-2000-01-01'), { recursive: true })
  mkdirSync(join(bdir, 'backup-2000-01-02'), { recursive: true })
  mkdirSync(join(bdir, 'backup-2000-01-03'), { recursive: true })
  const r3 = backupMemory(root, { backupDir: bdir, keep: 3 })
  check('备份：保留最近 N 份', r3.ok === true && listBackups(root, { backupDir: bdir }).length === 3 && !existsSync(join(bdir, 'backup-2000-01-01')))
  rmSync(root, { recursive: true, force: true })
  rmSync(bdir, { recursive: true, force: true })
}

// ---------- 3.6 Obsidian 镜像同步（含冷归档 + 镜像清理） ----------
{
  const { syncMemoryToObsidian } = await import(pathToFileURL(join(lib, 'backup.js')).href)
  const root = join(here, '..', '.regression-tmp-mirror')
  const mir = join(here, '..', '.regression-tmp-mirror-out')
  rmSync(root, { recursive: true, force: true })
  rmSync(mir, { recursive: true, force: true })
  mkdirSync(join(root, 'DAILY'), { recursive: true })
  mkdirSync(join(root, 'ARCHIVE'), { recursive: true })
  mkdirSync(join(mir, 'DAILY'), { recursive: true })
  mkdirSync(join(mir, '历史归档'), { recursive: true })
  writeFileSync(join(mir, '历史归档', '手工笔记.md'), '手工维护，不该被镜像清理动到', 'utf8')
  writeFileSync(join(root, 'MEMORY.md'), serializeEntries([makeEntry('镜像用例', { tag: '常规' })]), 'utf8')
  writeFileSync(join(root, 'DAILY', '2026-09-11.md'), serializeEntries([makeEntry('今日', { tag: '常规' })]), 'utf8')
  writeFileSync(join(root, 'ARCHIVE', 'entries.md'), serializeEntries([makeEntry('冷条目', { tag: '常规' })]), 'utf8')
  writeFileSync(join(mir, 'DAILY', '2026-01-01.md'), '主库已合并掉的旧日志', 'utf8')
  const r = syncMemoryToObsidian(root, mir)
  check('镜像：同步主库 + 冷归档（ARCHIVE）', r.ok === true && existsSync(join(mir, 'ARCHIVE', 'entries.md')) && existsSync(join(mir, 'MEMORY.md')))
  check('镜像：主库已删除的旧日志从镜像清掉', !existsSync(join(mir, 'DAILY', '2026-01-01.md')) && r.pruned >= 1)
  check('镜像：不动同步范围外的目录（历史归档）', existsSync(join(mir, '历史归档', '手工笔记.md')))
  rmSync(root, { recursive: true, force: true })
  rmSync(mir, { recursive: true, force: true })
}

// ---------- 4.5 机制回归（2026-09-11：归档/备份静默失效的两个坑） ----------
{
  const storeMod = await import(pathToFileURL(join(lib, 'store.js')).href)
  const { defaultBackupDir } = await import(pathToFileURL(join(lib, 'backup.js')).href)

  // 坑 1：写库路径在 withDirLock 内调用归档 → 同进程重复抢同一把文件锁
  //        → 自旋 5 秒后抛 lock timeout → 被静默吞掉（归档从未真正执行）
  const lockDir = join(here, '..', '.regression-lock')
  rmSync(lockDir, { recursive: true, force: true })
  mkdirSync(lockDir, { recursive: true })
  const t0 = Date.now()
  storeMod.withDirLock(lockDir, () => {
    storeMod.withDirLock(lockDir, () => {
      writeFileSync(join(lockDir, 'inner.txt'), 'ok')
    })
  })
  const nestedMs = Date.now() - t0
  check('机制：嵌套 withDirLock 可重入（<500ms，修复前 5000ms 超时）', nestedMs < 500)
  check('机制：嵌套结束后锁文件已释放', !existsSync(join(lockDir, '.work-memory.lock')))
  check('机制：嵌套内层确实执行了', existsSync(join(lockDir, 'inner.txt')))
  rmSync(lockDir, { recursive: true, force: true })

  // 坑 2：backupMemory 传 backupDir:null 时，展开默认值会被 null 顶掉 → join(null) 抛错
  //        → 自动备份静默失效（旧备份一直停在 8 月）
  const bkRoot = join(here, '..', '.regression-tmp-bknull')
  rmSync(bkRoot, { recursive: true, force: true })
  mkdirSync(bkRoot, { recursive: true })
  writeFileSync(join(bkRoot, 'MEMORY.md'), '[id:deadbeef0001] [2026-09-11] [tag:常规] 备份空值用例\n', 'utf8')
  const rNull = backupMemory(bkRoot, { backupDir: null, keep: 999 })
  // 当天备份已存在时返回 skipped（此时无 dir 字段）；两种结果都说明 null 没把默认目录顶掉
  check('机制：backupDir=null 不抛错且指向默认目录', rNull.ok === true && (rNull.skipped === true || String(rNull.dir || '').startsWith(defaultBackupDir())))
  if (rNull.ok && rNull.dir) rmSync(rNull.dir, { recursive: true, force: true }) // 清理，别污染真实备份区
  rmSync(bkRoot, { recursive: true, force: true })
}

// ---------- 4.6 分类护栏（2026-09-11：防"项目类写进全局"漂移） ----------
{
  const { resolveWriteScope, SCOPE_CRITERIA } = await import(pathToFileURL(join(lib, 'scope.js')).href)
  const { buildSnapshot } = await import(pathToFileURL(join(lib, 'context.js')).href)
  const j = (v) => JSON.stringify(v)

  check('护栏：auto + 有项目分支 → project',
    j(resolveWriteScope({ requested: 'auto', sessionBranch: 'DSH插件' })) === j({ scope: 'project', branch: 'DSH插件' }))
  check('护栏：auto + 无分支 → daily（不会落全局）',
    j(resolveWriteScope({ requested: 'auto' })) === j({ scope: 'daily', branch: null }))
  check('护栏：project 无 branch → 明确报错（旧行为是静默落全局）',
    typeof resolveWriteScope({ requested: 'project' }).error === 'string')
  check('护栏：project 显式 branch 正常',
    j(resolveWriteScope({ requested: 'project', explicitBranch: '金融分析' })) === j({ scope: 'project', branch: '金融分析' }))
  check('护栏：global 必须显式且不受分支影响',
    j(resolveWriteScope({ requested: 'global', sessionBranch: 'x' })) === j({ scope: 'global', branch: null }))
  check('护栏：未知 scope 报错',
    typeof resolveWriteScope({ requested: 'nope' }).error === 'string')
  check('护栏：分类判据文案非空（工具描述与它同源）',
    typeof SCOPE_CRITERIA === 'string' && SCOPE_CRITERIA.includes('project='))

  // 全局规模护栏：超阈值时注入快照出现整理提醒
  const gRoot = join(here, '..', '.regression-tmp-globalwarn')
  rmSync(gRoot, { recursive: true, force: true })
  mkdirSync(gRoot, { recursive: true })
  const gs = new MemoryStore(join(gRoot, 'MEMORY.md'))
  gs.ensure()
  for (let i = 0; i < 23; i += 1) gs.add(makeEntry('全局告警测试条目 ' + i, { tag: '常规' }))
  const snapWarn = buildSnapshot({ root: gRoot, globalWarnCount: 20 })
  check('护栏：全局超阈值（23 > 20）时快照出现整理提醒', snapWarn.includes('⚠️ 全局记忆已 23 条'))
  const snapNoWarn = buildSnapshot({ root: gRoot, globalWarnCount: 0 })
  check('护栏：阈值 0 可关闭告警', !snapNoWarn.includes('⚠️'))
  rmSync(gRoot, { recursive: true, force: true })
}

// ---------- 4.7 图谱登记（2026-09-11：记忆落盘即登记节点） ----------
{
  const g = await import(pathToFileURL(join(lib, 'graph.js')).href)
  const root = join(here, '..', '.regression-tmp-graph')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const a = makeEntry('图谱登记测试A', { tag: '常规' })
  const b = makeEntry('图谱登记测试B', { tag: '常规' })
  g.registerEntry(root, a)
  g.registerEntry(root, b)
  let gr = g.readGraph(root)
  check('图谱：写入即登记节点（2 个、0 条边）', gr.entities.length === 2 && gr.edges.length === 0)

  const idA = extractEntryId(a)
  const idB = extractEntryId(b)
  g.linkEntries(root, { from: { id: idA, label: g.labelOfEntry(a) }, to: { id: idB, label: g.labelOfEntry(b) }, relation: '相关' })
  gr = g.readGraph(root)
  check('图谱：建边后可读回（1 条、关系名保留）', gr.edges.length === 1 && gr.edges[0].relation === '相关')
  check('图谱：节点标签已剥掉 [id]/[日期]/[tag] 前缀', gr.entities.every((e) => !/^\[/.test(String(e.label))))

  g.pruneEntity(root, idA)
  gr = g.readGraph(root)
  check('图谱：删除条目后节点与其相关边一并摘除', gr.entities.length === 1 && gr.edges.length === 0)
  rmSync(root, { recursive: true, force: true })
}

// ---------- 4.8 TTL 起始点（2026-09-11 使用者提醒：7 天的起点必须是被使用那天） ----------
{
  const { ttlRef, daysUntilCold } = await import(pathToFileURL(join(lib, 'archive.js')).href)
  const { readAccess, pruneAccess, touchAccess } = await import(pathToFileURL(join(lib, 'access.js')).href)
  const { buildSnapshot } = await import(pathToFileURL(join(lib, 'context.js')).href)

  // 基准日 = max(写入日, 最后使用日)
  check('起始点：无使用记录时基准日 = 写入日', ttlRef('2026-09-01', null) === '2026-09-01')
  check('起始点：最近被用过 → 基准日被顶到使用日', ttlRef('2026-09-01', '2026-09-10') === '2026-09-10')
  check('起始点：使用日比写入日早（异常数据）不倒退', ttlRef('2026-09-10', '2026-09-01') === '2026-09-10')
  check('起始点：两者都缺 → null（不判到期）', ttlRef(null, null) === null)
  // 边界：TTL 天内（含第 TTL 天）仍算热，第 TTL+1 天才转冷
  check('起始点：第 7 天仍是热的最后一天（left=0）', daysUntilCold('2026-09-04', 7, '2026-09-11') === 0)
  check('起始点：第 8 天转冷（left=-1）', daysUntilCold('2026-09-03', 7, '2026-09-11') === -1)
  check('起始点：今天用过 → 满额剩余（left=7）', daysUntilCold('2026-09-11', 7, '2026-09-11') === 7)
  check('起始点：TTL≤0 表示关闭该级判期', daysUntilCold('2026-01-01', 0, '2026-09-11') === null)

  // 关联即使用：memory_link 建边后两端的使用时间被刷新
  const g = await import(pathToFileURL(join(lib, 'graph.js')).href)
  const lRoot = join(here, '..', '.regression-tmp-ttl')
  rmSync(lRoot, { recursive: true, force: true })
  mkdirSync(lRoot, { recursive: true })
  const a = makeEntry('起始点用例A', { tag: '常规' })
  const b = makeEntry('起始点用例B', { tag: '常规' })
  const idA = extractEntryId(a)
  const idB = extractEntryId(b)
  g.linkEntries(lRoot, { from: { id: idA, label: g.labelOfEntry(a) }, to: { id: idB, label: g.labelOfEntry(b) }, relation: '相关' })
  const acc = readAccess(lRoot)
  check('起始点：关联即使用（link 后两端都有访问记录）', Boolean(acc[idA]?.last) && Boolean(acc[idB]?.last))
  const ttlProj = join(lRoot, 'PROJECTS')
  mkdirSync(ttlProj, { recursive: true })
  writeFileSync(join(ttlProj, '用例.md'), serializeEntries([
    makeEntry('40天前但被关联过（应保留）', { date: new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10), tag: '常规' }),
  ]), 'utf8')
  const lentId = extractEntryId(new MemoryStore(join(ttlProj, '用例.md')).entries()[0])
  g.linkEntries(lRoot, { from: { id: lentId, label: 'x' }, to: { id: idA, label: 'y' }, relation: '相关' })
  runArchive(lRoot, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: false })
  check('起始点：被关联过的旧项目条目顺延、未转冷',
    readFileSync(join(ttlProj, '用例.md'), 'utf8').includes('40天前但被关联过（应保留）'))

  // 红线：每轮注入（快照）**不算**使用，否则 TTL 永不生效
  const gStore = new MemoryStore(join(lRoot, 'MEMORY.md'))
  gStore.ensure()
  gStore.add(makeEntry('注入红线用例（全局常规）', { tag: '常规' }))
  const accBeforeSnap = JSON.stringify(readAccess(lRoot))
  const snap = buildSnapshot({ root: lRoot, maxChars: 4000 })
  const accAfterSnap = JSON.stringify(readAccess(lRoot))
  check('起始点：注入快照不刷新使用时间（只读红线）',
    accBeforeSnap === accAfterSnap && snap.includes('注入红线用例'))

  // 使用记录清理：只保留仍然存在的条目（热区 + 冷区），避免 .access.json 无限增长
  touchAccess(lRoot, ['keepme000001', 'dropme000001'])
  pruneAccess(lRoot, new Set(['keepme000001']))
  const accPruned = readAccess(lRoot)
  check('起始点：使用记录清理只留仍存在的条目',
    Object.keys(accPruned).length === 1 && Boolean(accPruned.keepme000001))
  rmSync(lRoot, { recursive: true, force: true })
}

// ---------- 4.9 转冷预审（2026-09-11 使用者定：到期≠立即冷，先做辅助判断） ----------
{
  const tri = await import(pathToFileURL(join(lib, 'triage.js')).href)
  const a = await import(pathToFileURL(join(lib, 'archive.js')).href)
  const gmod = await import(pathToFileURL(join(lib, 'graph.js')).href)
  const { buildSnapshot } = await import(pathToFileURL(join(lib, 'context.js')).href)
  const { writeTriage } = tri
  const root = join(here, '..', '.regression-tmp-triage')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'DAILY'), { recursive: true })
  mkdirSync(join(root, 'PROJECTS'), { recursive: true })
  const today = todayStamp()
  const d = (n) => addDays(today, n)

  // 判定纯函数：三类信号
  const jKeep = tri.judgeEntry(makeEntry('【待办】插件 A 的权限模型还需使用者确认，下一步做 B', { date: d(-40), tag: '常规' }), {
    today, recentDailyTexts: ['今天继续做插件 A 的权限模型'], graphDegree: 1, accessCount: 0,
  })
  check('预审：未完结 + 图谱关联 + 与近 7 天日志相关 → keep', jKeep.decision === 'keep' && jKeep.score >= 3)
  const jCold = tri.judgeEntry(makeEntry('【插件 B 已装·2026-08-16】已完成安装并验证通过', { date: d(-40), tag: '常规' }), { today })
  check('预审：完成/一次性信号 → cold', jCold.decision === 'cold' && jCold.score < 0)
  const jAsk = tri.judgeEntry(makeEntry('插件 C 的某个实现细节记录', { date: d(-40), tag: '常规' }), { today })
  check('预审：无信号 → ask（交助手判断，不推给使用者）', jAsk.decision === 'ask' && jAsk.score === 0)
  check('预审：关键条目永不判冷', tri.judgeEntry(makeEntry('全局红线', { date: d(-400), tag: '关键' }), { today }).decision === 'keep')
  const jSuperseded = tri.judgeEntry(makeEntry('插件 D 的配置方式：改 X 文件', { date: d(-60), tag: '常规' }), {
    today, hotTexts: [makeEntry('插件 D 的配置方式：改 X 文件（已改为 Y 方式）', { date: d(-1), tag: '常规' })],
  })
  check('预审：同主题有更新条目 → 偏冷（负分）', jSuperseded.score <= 0 && jSuperseded.reasons.some((x) => x.includes('更新')))

  // 集成：三类条目在同一次归档里走三条路
  writeFileSync(join(root, 'DAILY', today + '.md'), serializeEntries([
    makeEntry('今天继续做插件 A 的权限模型', { date: today, tag: '常规' }),
  ]), 'utf8')
  writeFileSync(join(root, 'MEMORY.md'), serializeEntries([
    makeEntry('通用协作铁律：插件 A 的权限模型以使用者确认为准', { date: d(-100), tag: '关键' }),
  ]), 'utf8')
  const keepEntryRaw = makeEntry('【待办】插件 A 的权限模型还需使用者确认，下一步做 B', { date: d(-40), tag: '常规' })
  const coldEntryRaw = makeEntry('【插件 B 已装·2026-08-16】已完成安装并验证通过', { date: d(-40), tag: '常规' })
  const askEntryRaw = makeEntry('插件 C 的某个实现细节记录', { date: d(-40), tag: '常规' })
  writeFileSync(join(root, 'PROJECTS', '预审用例.md'), serializeEntries([keepEntryRaw, coldEntryRaw, askEntryRaw]), 'utf8')
  gmod.registerEntry(root, keepEntryRaw)
  const idKeep = extractEntryId(keepEntryRaw)
  const idCold = extractEntryId(coldEntryRaw)
  const idAsk = extractEntryId(askEntryRaw)

  const r1 = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: true, triageGraceDays: 7 })
  const txt1 = readFileSync(join(root, 'PROJECTS', '预审用例.md'), 'utf8')
  check('预审集成：自动保留（keep）条目留在热区', txt1.includes('[id:' + idKeep + ']') && r1.kept.some((k) => k.id === idKeep && k.by === 'auto'))
  check('预审集成：完成类条目自然转冷', !txt1.includes('[id:' + idCold + ']') && r1.entries === 1)
  check('预审集成：待判断（ask）条目留在热区并进队列', txt1.includes('[id:' + idAsk + ']') && r1.ask.some((x) => x.id === idAsk) && a.listPending(root).some((p) => p.id === idAsk))
  check('预审集成：保留记录带理由与到期日', String(tri.readTriage(root).kept[idKeep]?.reason || '').length > 0 && Boolean(tri.readTriage(root).kept[idKeep]?.until))
  check('预审集成：快照提示有待判断', buildSnapshot({ root, maxChars: 4000, triageAsk: true }).includes('⏳ 转冷待判断 1 条'))
  check('预审集成：快照提示可关闭', !buildSnapshot({ root, maxChars: 4000, triageAsk: false }).includes('⏳'))

  // 宽限期：待判断超期 → 自然转冷（不无限拖）
  const st = tri.readTriage(root)
  st.pending[idAsk].since = d(-9)
  writeTriage(root, st)
  const r2 = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: true, triageGraceDays: 7 })
  check('预审：待判断超宽限 → 自然转冷', !readFileSync(join(root, 'PROJECTS', '预审用例.md'), 'utf8').includes('[id:' + idAsk + ']')
    && r2.coldTimeout.some((x) => x.id === idAsk) && r2.entries >= 1)

  // 助手手动判定：keep / cold
  const rKeep = a.keepEntry(root, idKeep, { days: 30, reason: '使用者明确要求长期留热' })
  check('预审：/memory_triage keep 记保留窗口', rKeep.ok === true && String(rKeep.record.reason).includes('长期'))
  const rCold = a.archiveEntryById(root, idKeep, { reason: '助手判定：一次性内容' })
  const caseeFile = join(root, 'PROJECTS', '预审用例.md')
  const txtAfterCold = existsSync(caseeFile) ? readFileSync(caseeFile, 'utf8') : ''
  check('预审：/memory_triage cold 立即转冷并可检索', rCold.ok === true
    && !txtAfterCold.includes('[id:' + idKeep + ']')
    && a.archiveEntries(root, 50).some((x) => x.id === idKeep))
  check('预审：判定后从保留/待判断清单里移除', !tri.readTriage(root).kept[idKeep] && !tri.readTriage(root).pending[idKeep])
  check('预审：转冷条目可转热回原范围', a.promoteEntry(root, idKeep).ok === true)

  // 关掉预审 → 到期即冷（旧行为）
  const rawOff = makeEntry('插件 E 的普通记录（到期即冷）', { date: d(-40), tag: '常规' })
  writeFileSync(join(root, 'PROJECTS', '预审关闭.md'), serializeEntries([rawOff]), 'utf8')
  const r3 = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: false })
  check('预审：开关关闭时回到「到期即转冷」', r3.entries >= 1 && !existsSync(join(root, 'PROJECTS', '预审关闭.md')))

  // 已判定为冷：未到期只记判定，到期直接冷、不再询问
  const preColdRaw = makeEntry('插件 I 的机制说明（已判冷，尚未到期）', { date: d(-25), tag: '常规' })
  writeFileSync(join(root, 'PROJECTS', '判冷用例.md'), serializeEntries([preColdRaw]), 'utf8')
  const idPreCold = extractEntryId(preColdRaw)
  const rc = a.archiveEntryById(root, idPreCold, { reason: '助手判定：机制已入 README', ttlDays: 30 })
  check('预审：未到期判冷 → 只记判定并推迟到到期日', rc.ok === true && rc.deferred === true && Boolean(rc.until))
  const r4 = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: true })
  check('预审：已判冷条目未到期时不提前搬走、也不再进待判断',
    r4.entries === 0 && !r4.ask.some((x) => x.id === idPreCold) && existsSync(join(root, 'PROJECTS', '判冷用例.md')))
  // 把它挪到"已到期"，同一判定应直接生效
  const old = readFileSync(join(root, 'PROJECTS', '判冷用例.md'), 'utf8')
  writeFileSync(join(root, 'PROJECTS', '判冷用例.md'), old.replace(d(-25), d(-40)), 'utf8')
  const r5 = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: true })
  check('预审：已判冷条目到期后直接转冷（不再询问）',
    r5.entries >= 1 && !existsSync(join(root, 'PROJECTS', '判冷用例.md')) && !tri.readTriage(root).cold[idPreCold])
  rmSync(root, { recursive: true, force: true })
}

// ---------- 4.10 提前预审（到期前 7 天就判，别等到冷的那一刻） ----------
{
  const a = await import(pathToFileURL(join(lib, 'archive.js')).href)
  const tri = await import(pathToFileURL(join(lib, 'triage.js')).href)
  const root = join(here, '..', '.regression-tmp-triage2')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'DAILY'), { recursive: true })
  mkdirSync(join(root, 'PROJECTS'), { recursive: true })
  const today = todayStamp()
  const d = (n) => addDays(today, n)
  writeFileSync(join(root, 'DAILY', today + '.md'), serializeEntries([
    makeEntry('今天继续做插件 F 的权限模型', { date: today, tag: '常规' }),
  ]), 'utf8')
  // 三条都还没到期（TTL 30）：left = 5 / 4 / 3
  const soonKeep = makeEntry('【待办】插件 F 的权限模型还需使用者确认', { date: d(-25), tag: '常规' })
  const soonCold = makeEntry('【插件 G 已装】已完成安装并验证通过', { date: d(-26), tag: '常规' })
  const soonAsk = makeEntry('插件 H 的某个实现细节记录', { date: d(-27), tag: '常规' })
  writeFileSync(join(root, 'PROJECTS', '预判用例.md'), serializeEntries([soonKeep, soonCold, soonAsk]), 'utf8')
  const idKeep2 = extractEntryId(soonKeep)
  const idCold2 = extractEntryId(soonCold)
  const idAsk2 = extractEntryId(soonAsk)

  const r = a.runArchive(root, { projectTtlDays: 30, userTtlDays: 90, dailyRetentionDays: 7, force: true, triageEnabled: true, triageGraceDays: 7 })
  const txt = readFileSync(join(root, 'PROJECTS', '预判用例.md'), 'utf8')
  check('提前预审：到期前判定为 keep 的条目预先记保留（未等到期）',
    r.entries === 0 && r.kept.some((k) => k.id === idKeep2 && k.pre === true) && txt.includes('[id:' + idKeep2 + ']'))
  check('提前预审：到期前判定为 cold 的只记「预判自然转冷」，不提前搬走',
    r.preCold.some((x) => x.id === idCold2) && txt.includes('[id:' + idCold2 + ']') && r.entries === 0)
  check('提前预审：到期前判定为 ask 的提前进待判断队列',
    r.ask.some((x) => x.id === idAsk2 && x.pre === true) && a.listPending(root).some((p) => p.id === idAsk2))
  check('提前预审：due 清单带 verdict（在保养时能看到"将冷/预判"）',
    r.due.some((x) => x.verdict === 'cold') && r.due.every((x) => typeof x.inDays === 'number'))
  rmSync(root, { recursive: true, force: true })
}

// ---------- 4. 子代理门控（可解析 dsh-tools 时启用） ----------
try {
  const { createTools } = await import(pathToFileURL(join(lib, 'tools.js')).href)
  const root = join(here, '..', '.regression-tmp')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const suggestions = []
  const tools = createTools({
    root,
    getBranch: () => null,
    archiveCfg: { enabled: false },
    onSuggestion: (item) => suggestions.push(item),
  })
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
  const exec = async (name, args, e) => byName[name].execute(args, e || {})
  const sub = { agent: { session: { header: { origin: 'subagent', delegationDepth: 1 } } } }
  let r = await exec('memory_remember', { content: '门控：子代理写global', tag: '常规', scope: 'global' }, sub)
  check('门控：子代理写 global 拒绝', r.ok === false && /子代理/.test(r.error || ''))
  r = await exec('memory_remember', { content: '门控：子代理写user', tag: '常规', scope: 'user' }, sub)
  check('门控：子代理写 user 拒绝', r.ok === false)
  r = await exec('memory_remember', { content: '门控：子代理写daily', tag: '常规', scope: 'daily' }, sub)
  check('门控：子代理写 daily 允许', r.ok === true)
  r = await exec('memory_remember', { content: '门控：主代理写global', tag: '常规', scope: 'global' }, { agent: { session: { header: {} } } })
  check('门控：主代理写 global 允许', r.ok === true)
  // 去重
  r = await exec('memory_remember', { content: '门控：主代理写global', tag: '常规', scope: 'global' }, { agent: { session: { header: {} } } })
  check('去重：重复内容返回 duplicate', r.duplicate === true)
  // recall archive 范围
  r = await exec('memory_recall', { query: 'x', scope: 'archive', limit: 3 })
  check('召回：scope=archive 正常', r.ok === true)
  // recall project 范围（遍历 PROJECTS 全部，不依赖 branch）
  mkdirSync(join(root, 'PROJECTS'), { recursive: true })
  writeFileSync(join(join(root, 'PROJECTS'), '甲项目.md'), serializeEntries([makeEntry('甲项目待办条目', { tag: '常规', branch: '甲项目' })]), 'utf8')
  writeFileSync(join(join(root, 'PROJECTS'), '乙项目.md'), serializeEntries([makeEntry('乙项目待办条目', { tag: '常规', branch: '乙项目' })]), 'utf8')
  r = await exec('memory_recall', { query: '待办', scope: 'project', limit: 5 })
  check('召回：scope=project 遍历全部项目', r.count === 2 && r.results.some((x) => x.entry.includes('甲项目')) && r.results.some((x) => x.entry.includes('乙项目')))
  r = await exec('memory_recall', { query: '待办', scope: 'all', limit: 5 })
  check('召回：scope=all 含项目待办', r.results.some((x) => x.entry.includes('甲项目待办条目')))

  rmSync(root, { recursive: true, force: true })
} catch {
  console.log('  ⏭ 门控测试跳过（当前环境无法解析 @deepseek-ai/dsh-tools）')
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail > 0) process.exit(1)
