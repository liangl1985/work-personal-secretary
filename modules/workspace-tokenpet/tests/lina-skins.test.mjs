import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  isSafeSkinFile, isSafeSkinId, listSkinManifests, listSkinPacks,
  manifestForClient, parseSkinManifest, readSkinFile, skinFileUrl, skinsDir,
} from '../lib/skins.js'

async function makeHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'pet-skins-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  return home
}

async function writePack(home, id, manifest, files = {}) {
  const dir = join(skinsDir(home), id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  for (const [name, data] of Object.entries(files)) {
    const target = join(dir, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
  return dir
}

/** 随源码发布的 3 套内置形象（使用者 2026-10-02 定：内置随源码下载、列表直接显示） */
const BUILTIN_IDS = ['default', 'lina-lazy', 'lina-pure']
const userPacks = (list) => list.filter((m) => !BUILTIN_IDS.includes(m.id))

const validPack = {
  schemaVersion: 1, id: 'my-pack', name: '小秘书·纯欲乖巧版', canvas: { width: 360, height: 540 },
  bodyHeight: 480, feetY: 520, preview: 'preview.webp',
  animations: { idle: { file: 'idle.webp', frames: 32, fps: 10 }, 'tool-success': { file: 'deep/tool.webp', frames: 32, fps: 10 } },
}

test('ids and file references cannot escape a pack directory', () => {
  assert.equal(isSafeSkinId('my-pack'), true)
  assert.equal(isSafeSkinId('../evil'), false)
  assert.equal(isSafeSkinId('a/b'), false)
  assert.equal(isSafeSkinFile('idle.webp'), true)
  assert.equal(isSafeSkinFile('frames/idle.webp'), true)
  assert.equal(isSafeSkinFile('../secret.webp'), false)
  assert.equal(isSafeSkinFile('/etc/passwd'), false)
  assert.equal(isSafeSkinFile('idle.svg'), false)
  assert.equal(isSafeSkinFile('idle.webp.exe'), false)
})

test('a valid pack is listed with its actions and unresolved files rewritten to URLs', async (t) => {
  const home = await makeHome(t)
  await writePack(home, 'my-pack', validPack, { 'idle.webp': 'IDLE', 'preview.webp': 'PREVIEW', 'deep/tool.webp': 'TOOL' })
  const manifests = await listSkinManifests(home)
  const mine = userPacks(manifests)
  assert.equal(mine.length, 1)
  const client = manifestForClient(mine[0])
  assert.deepEqual(client.actions, ['idle', 'tool-success'])
  assert.equal(client.animations.idle.file, '/workspace-tokenpet/skins/file?id=my-pack&file=idle.webp')
  assert.equal(client.animations['tool-success'].file, '/workspace-tokenpet/skins/file?id=my-pack&file=deep%2Ftool.webp')
  assert.equal(client.preview, '/workspace-tokenpet/skins/file?id=my-pack&file=preview.webp')
  const packs = userPacks(await listSkinPacks(home))
  assert.equal(packs.length, 1)
  assert.equal(packs[0].actions.length, 2)
  assert.equal(packs[0].manifestUrl, '/workspace-tokenpet/skins/file?id=my-pack&file=manifest.json')
})

test('files are read from disk, and traversal or unknown files are refused', async (t) => {
  const home = await makeHome(t)
  await writePack(home, 'my-pack', validPack, { 'idle.webp': 'IDLE' })
  const found = await readSkinFile(home, 'my-pack', 'idle.webp')
  assert.equal(found?.contentType, 'image/webp')
  assert.equal(found?.data.toString(), 'IDLE')
  assert.equal(await readSkinFile(home, 'my-pack', '../manifest.json'), null)
  assert.equal(await readSkinFile(home, 'my-pack', 'missing.webp'), null)
  assert.equal(await readSkinFile(home, '../outside', 'idle.webp'), null)
})

test('unusable packs are skipped instead of breaking the listing', async (t) => {
  const home = await makeHome(t)
  await writePack(home, 'broken-json', '{ not json')
  await writePack(home, 'no-actions', { id: 'no-actions', name: 'empty', animations: {} })
  await writePack(home, 'mismatch', { ...validPack, id: 'other-id' })
  await writePack(home, 'ok-pack', { id: 'ok-pack', name: 'ok', animations: { idle: { file: 'idle.webp' } } })
  const manifests = await listSkinManifests(home)
  assert.deepEqual(userPacks(manifests).map(m => m.id), ['ok-pack'])
})

test('an action naming an unsafe file is dropped, not the whole pack', async (t) => {
  const home = await makeHome(t)
  await writePack(home, 'partial', {
    id: 'partial', name: 'partial',
    animations: { idle: { file: '../escape.webp' }, working: { file: 'working.webp' } },
  })
  const manifests = userPacks(await listSkinManifests(home))
  assert.equal(manifests.length, 1)
  assert.deepEqual(Object.keys(manifests[0].animations), ['working'])
})

test('the three built-in packs ship with the source and are always listed', async (t) => {
  const home = await makeHome(t)   // 空的 home：没有任何使用者放的包
  const manifests = await listSkinManifests(home)
  assert.deepEqual(manifests.map(m => m.id).sort(), ['default', 'lina-lazy', 'lina-pure'])
  // 且能**直接从源码目录**读到图与预览（无需先复制到 home）
  const art = await readSkinFile(home, 'lina-lazy', 'idle.webp')
  assert.equal(art?.contentType, 'image/webp')
  assert.ok(art !== null && art.data.byteLength > 1000, '内置图应可读且非空')
  const preview = await readSkinFile(home, 'lina-pure', 'preview.webp')
  assert.ok(preview !== null && preview.data.byteLength > 100, '内置预览图应可读')
})

test('manifest parsing drops unknown actions, bad numbers and non-string labels', () => {
  const parsed = parseSkinManifest({
    id: 'x', name: 'X', animations: { idle: { file: 'idle.webp', frames: 0, fps: 999 }, notAnAction: { file: 'nope.webp' } },
    nameLocalized: { 'zh-CN': 'X 中文', 'en-US': 42 },
  })
  assert.deepEqual(Object.keys(parsed.animations), ['idle'])
  assert.equal(parsed.animations.idle.frames, undefined)
  assert.equal(parsed.animations.idle.fps, undefined)
  assert.deepEqual(parsed.nameLocalized, { 'zh-CN': 'X 中文' })
  assert.equal(parseSkinManifest({ id: 'x' }), null)
  assert.equal(parseSkinManifest(null), null)
})

test('a missing user skins directory is not an error and yields no user packs', async (t) => {
  const home = await makeHome(t)
  // 使用者目录为空：**不报错**，且没有任何"使用者的包"。
  // 内置 3 套照常列出 —— 它们随源码发布，与本机是否放过皮肤无关（使用者 2026-10-02 定的口径）。
  assert.deepEqual(userPacks(await listSkinManifests(home)), [])
  assert.deepEqual(userPacks(await listSkinPacks(home)), [])
})

test('skinFileUrl is an exact route carrying id and file as query parameters', () => {
  assert.equal(skinFileUrl('my-pack', 'idle.webp'), '/workspace-tokenpet/skins/file?id=my-pack&file=idle.webp')
  assert.equal(skinFileUrl('my-pack', 'deep/tool.webp'), '/workspace-tokenpet/skins/file?id=my-pack&file=deep%2Ftool.webp')
})
