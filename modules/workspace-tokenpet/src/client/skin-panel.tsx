import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { parseSkinPack, skinDisplayName, type SkinPackManifest, type SkinManifest } from './skin.ts'
import { saveSettings } from './settings.ts'
import { useSettings } from './settings-hook.ts'
import { type Language } from './i18n.ts'

/**
 * Character pack picker.
 *
 * Packs are discovered by the host from `<dsh home>/data/workspace-tokenpet/skins/`
 * and listed over `GET /workspace-tokenpet/skins`, so adding or removing a character is
 * a file-system operation: drop the folder in, refresh the page, pick it here.
 * Nothing is uploaded, bundled or rebuilt.
 */
const PACK_LIST_TIMEOUT_MS = 10_000

const TEXT = {
  section: { zh: '形象套装', en: 'Character packs' },
  current: { zh: '当前套装', en: 'Active pack' },
  defaultPack: { zh: '默认形象（内置）', en: 'Default (built-in)' },
  loading: { zh: '正在读取套装目录…', en: 'Reading the pack directory…' },
  none: { zh: '还没有安装套装。', en: 'No pack installed yet.' },
  count: { zh: '{n} 个动作', en: '{n} actions' },
  selectedDefault: { zh: '已切换到默认形象。', en: 'Switched to the default character.' },
  selectedPack: { zh: '已切换到「{name}」。', en: 'Switched to "{name}".' },
  folderHint: {
    zh: '新增形象：把套装文件夹放到 ~/.dsh/data/workspace-tokenpet/skins/<套装id>/（内含 manifest.json 与动作条带），刷新页面即可出现在这里，无需重启。',
    en: 'To add a character, drop a pack folder into ~/.dsh/data/workspace-tokenpet/skins/<pack-id>/ (manifest.json plus action strips) and refresh — no restart needed.',
  },
  fallbackNote: {
    zh: '套装里缺少的动作会自动回退到内置素材。',
    en: 'Actions a pack does not ship fall back to the built-in artwork.',
  },
  listFailed: { zh: '读取套装失败：{detail}', en: 'Could not read packs: {detail}' },
  setDefault: { zh: '设为默认形象', en: 'Set as default' },
  alreadyDefault: { zh: '已是默认形象', en: 'Already the default' },
  currentDefault: { zh: '默认形象：{name}', en: 'Default: {name}' },
  savedDefault: { zh: '已将「{name}」设为默认形象。', en: '"{name}" is now the default character.' },
  defaultHint: {
    zh: '默认形象在首次安装、清空缓存或重装后生效；上方下拉框只切换"当前使用"。',
    en: 'The default applies on a fresh install, after clearing cache or reinstalling; the dropdown above only switches what is in use now.',
  },
} as const

function text(language: Language, key: keyof typeof TEXT, params?: Record<string, string | number>): string {
  const entry: string = TEXT[key][language === 'en' ? 'en' : 'zh']
  if (params === undefined) return entry
  return Object.entries(params).reduce<string>((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), entry)
}

export function SkinImportPanel(p: { onImport?: (bundle: unknown) => void; language?: Language }) {
  const settings = useSettings()
  const language = p.language ?? settings.language
  const selected = settings.skinId
  const mounted = useRef(true)
  const [packs, setPacks] = useState<SkinPackManifest[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PACK_LIST_TIMEOUT_MS)
    setDetail(text(language, 'loading'))
    fetch('/workspace-tokenpet/skins', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json() as { skins?: unknown }
        const parsed = Array.isArray(payload.skins)
          ? payload.skins.map(parseSkinPack).filter((pack): pack is SkinPackManifest => pack !== null)
          : []
        if (mounted.current) { setPacks(parsed); setDetail(parsed.length === 0 ? text(language, 'none') : null) }
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setDetail(text(language, 'listFailed', { detail: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => clearTimeout(timer))
    return () => { mounted.current = false; clearTimeout(timer); controller.abort() }
  }, [language])

  const options = useMemo(() => {
    const map = new Map<string, { id: string; label: string; actions?: number }>()
    map.set('default', { id: 'default', label: text(language, 'defaultPack') })
    for (const pack of packs) {
      map.set(pack.id, {
        id: pack.id,
        label: pack.shippedActions === undefined ? skinDisplayName(pack, language) : `${skinDisplayName(pack, language)} · ${text(language, 'count', { n: pack.shippedActions.length })}`,
        actions: pack.shippedActions?.length,
      })
    }
    return [...map.values()]
  }, [packs, language])

  const choose = (id: string) => {
    saveSettings({ skinId: id })
    const pack = packs.find(item => item.id === id)
    if (pack === undefined) setStatus(text(language, 'selectedDefault'))
    else setStatus(text(language, 'selectedPack', { name: skinDisplayName(pack, language) }))
  }

  const selectedPack: SkinPackManifest | undefined = packs.find(pack => pack.id === selected)

  // 「设为默认」：只改 defaultSkinId（首次安装 / 清缓存后回落到它），并同步当前使用。
  const defaultId = settings.defaultSkinId
  const labelOf = (id: string): string => options.find(option => option.id === id)?.label ?? id
  const setAsDefault = () => {
    saveSettings({ defaultSkinId: selected, skinId: selected })
    setStatus(text(language, 'savedDefault', { name: labelOf(selected) }))
  }

  return h('section', {
    'aria-label': text(language, 'section'),
    style: { display: 'grid', gap: 8, marginTop: 6, minWidth: 0, overflowWrap: 'anywhere' },
  }, [
    h('label', { key: 'select', style: { display: 'grid', gap: 5, minWidth: 0 } }, [
      text(language, 'current'),
      h('select', {
        key: 'select',
        style: { width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', color: 'inherit', background: 'rgba(128,128,160,.08)', padding: 7, borderRadius: 6, border: '1px solid rgba(128,128,160,.35)' },
        value: selected,
        onChange: (event: { target: { value: string } }) => choose(event.target.value),
      }, options.map(option => h('option', { key: option.id, value: option.id }, option.label))),
    ]),
    selectedPack?.preview !== undefined
      ? h('img', { key: 'preview', src: selectedPack.preview, alt: '', draggable: false, style: { maxWidth: 96, maxHeight: 140, imageRendering: 'auto' } })
      : null,
    h('div', { key: 'default-row', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
      h('button', {
        key: 'set-default',
        type: 'button',
        disabled: selected === defaultId,
        onClick: setAsDefault,
        style: {
          color: 'inherit', background: 'rgba(128,128,160,.12)', padding: '5px 10px', borderRadius: 6,
          border: '1px solid rgba(128,128,160,.45)', cursor: selected === defaultId ? 'default' : 'pointer',
          opacity: selected === defaultId ? .55 : 1, fontSize: 12,
        },
      }, selected === defaultId ? text(language, 'alreadyDefault') : text(language, 'setDefault')),
      h('small', { key: 'default-note', style: { opacity: .8 } }, text(language, 'currentDefault', { name: labelOf(defaultId) })),
    ]),
    h('small', { key: 'default-hint', style: { opacity: .7, lineHeight: 1.5 } }, text(language, 'defaultHint')),
    status === null ? null : h('div', { key: 'status', role: 'status', style: { fontSize: 11, opacity: .85 } }, status),
    h('small', { key: 'hint', style: { opacity: .8, lineHeight: 1.5 } }, text(language, 'folderHint')),
    h('small', { key: 'fallback', style: { opacity: .7, lineHeight: 1.5 } }, text(language, 'fallbackNote')),
    detail === null ? null : h('small', { key: 'detail', style: { opacity: .7 } }, detail),
  ])
}
