/**
 * Skin pack discovery and serving (runtime-selectable character sets).
 *
 * A skin pack is a directory under `<dsh home>/data/workspace-tokenpet/skins/<id>/`
 * holding a manifest plus one strip per action. Adding or removing a pack is a
 * pure file-system operation: no rebuild, no restart, no code change — the
 * client asks this module for the list and for each strip.
 *
 * Design constraints inherited from the plugin's own action contract:
 *   - the 12 PetAction names are fixed; a pack may omit some and the client
 *     falls back to the built-in strip for that action;
 *   - pressure bands never select a different pack (that stays a user choice);
 *   - every path a pack can name is validated here, because the pack directory
 *     is user-writable and its contents are served over the host's webServer.
 * @module workspace-tokenpet/skins
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
/** Only these action names may appear in a pack (the plugin's fixed 12). */
export const SKIN_ACTIONS = [
    'idle', 'working', 'eating', 'digesting', 'warning', 'evolve',
    'click', 'archive', 'tool-success', 'tool-failure', 'prompt-enhancing', 'prompt-ready',
];
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const FILE_RE = /^[a-z0-9][a-z0-9._-]*\.(?:webp|png|json)$/i;
/** The directory packs live in. */
export function skinsDir(home) {
    return join(home, 'data', 'workspace-tokenpet', 'skins');
}
/** A pack id is safe when it cannot escape its own directory. */
export function isSafeSkinId(id) {
    return typeof id === 'string' && id.length <= 64 && ID_RE.test(id) && id !== '.' && id !== '..';
}
/**
 * A pack-relative file reference is safe when every segment is a plain name and
 * the extension is one we serve. Nested paths are allowed so a pack may keep
 * its frames in a subdirectory, but no segment may traverse.
 */
export function isSafeSkinFile(file) {
    if (typeof file !== 'string' || file.length === 0 || file.length > 256)
        return false;
    if (file.includes('\\') || file.startsWith('/') || file.includes('://'))
        return false;
    const segments = file.split('/');
    if (segments.length === 0 || segments.length > 4)
        return false;
    const last = segments[segments.length - 1];
    if (last === undefined || !FILE_RE.test(last))
        return false;
    return segments.every(segment => SEGMENT_RE.test(segment));
}
/**
 * The public URL that serves one pack file.
 *
 * Served by an EXACT route carrying the pack id and file as query parameters.
 * Measured on DSH Desktop 0.1.5-rc.1: the desktop carrier resolves exact routes
 * only — the plugin's own prefix strip route answers 404 there — while an exact
 * route with a query string resolves normally (`/workspace-tokenpet/usage/trend?...`).
 * A prefix form is registered too, for open-web carriers that serve real HTTP.
 */
export function skinFileUrl(id, file) {
    return `/workspace-tokenpet/skins/file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}
/** Content type for a pack file name. */
export function skinContentType(file) {
    if (/\.json$/i.test(file))
        return 'application/json';
    if (/\.png$/i.test(file))
        return 'image/png';
    return 'image/webp';
}
function localized(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && item.trim() !== '')
            out[key] = item;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
function positiveInt(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
        ? Math.floor(value)
        : undefined;
}
/**
 * Parse an untrusted manifest into a pack, or null when it is unusable.
 *
 * Unusable means: no safe id, no display name, or no usable action at all.
 * Individual bad action entries are dropped rather than failing the pack, so a
 * half-finished pack still shows up with its good actions.
 */
export function parseSkinManifest(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const v = raw;
    if (!isSafeSkinId(v.id))
        return null;
    if (typeof v.name !== 'string' || v.name.trim() === '')
        return null;
    const animations = {};
    const rawAnimations = v.animations && typeof v.animations === 'object' ? v.animations : {};
    for (const action of SKIN_ACTIONS) {
        const entry = rawAnimations[action];
        if (!entry || typeof entry !== 'object')
            continue;
        const e = entry;
        if (!isSafeSkinFile(e.file))
            continue;
        const spec = { file: e.file };
        const frames = positiveInt(e.frames, 1, 512);
        if (frames !== undefined)
            spec.frames = frames;
        const fps = positiveInt(e.fps, 1, 60);
        if (fps !== undefined)
            spec.fps = fps;
        const frameW = positiveInt(e.frameW, 8, 4096);
        if (frameW !== undefined)
            spec.frameW = frameW;
        const frameH = positiveInt(e.frameH, 8, 4096);
        if (frameH !== undefined)
            spec.frameH = frameH;
        // rows 必须透传给客户端：客户端缺省时会回退内置模板的 rows，
        // 而内置有一个动作是 2 行（660px cell），会把单行条带切错。
        const rows = positiveInt(e.rows, 1, 64);
        if (rows !== undefined)
            spec.rows = rows;
        animations[action] = spec;
    }
    if (Object.keys(animations).length === 0)
        return null;
    const canvasRaw = v.canvas && typeof v.canvas === 'object' ? v.canvas : undefined;
    const width = positiveInt(canvasRaw?.width, 8, 4096);
    const height = positiveInt(canvasRaw?.height, 8, 4096);
    const manifest = {
        id: v.id,
        name: v.name.trim(),
        animations,
    };
    const schemaVersion = positiveInt(v.schemaVersion, 1, 99);
    if (schemaVersion !== undefined)
        manifest.schemaVersion = schemaVersion;
    if (typeof v.version === 'string')
        manifest.version = v.version;
    if (typeof v.author === 'string')
        manifest.author = v.author;
    if (typeof v.license === 'string')
        manifest.license = v.license;
    const nameLocalized = localized(v.nameLocalized);
    if (nameLocalized !== undefined)
        manifest.nameLocalized = nameLocalized;
    const description = localized(v.description);
    if (description !== undefined)
        manifest.description = description;
    if (width !== undefined && height !== undefined)
        manifest.canvas = { width, height };
    const bodyHeight = positiveInt(v.bodyHeight, 8, 4096);
    if (bodyHeight !== undefined)
        manifest.bodyHeight = bodyHeight;
    const feetY = positiveInt(v.feetY, 1, 4096);
    if (feetY !== undefined)
        manifest.feetY = feetY;
    if (isSafeSkinFile(v.preview))
        manifest.preview = v.preview;
    const styleOverrides = localized(v.styleOverrides);
    if (styleOverrides !== undefined)
        manifest.styleOverrides = styleOverrides;
    return manifest;
}
/** Resolve a pack-relative file to an absolute path, or null when it escapes. */
export function resolveSkinPath(home, id, file) {
    if (!isSafeSkinId(id) || !isSafeSkinFile(file))
        return null;
    const root = resolve(skinsDir(home), id);
    const target = resolve(root, normalize(file).split('/').join(sep));
    if (target !== root && !target.startsWith(root + sep))
        return null;
    return target;
}
/** Read one pack file, or null when it is missing / unsafe / too large. */
export async function readSkinFile(home, id, file, maxBytes = 32 * 1024 * 1024) {
    const target = resolveSkinPath(home, id, file);
    if (target === null)
        return null;
    try {
        const info = await stat(target);
        if (!info.isFile() || info.size <= 0 || info.size > maxBytes)
            return null;
        return { data: await readFile(target), contentType: skinContentType(file) };
    }
    catch {
        return null;
    }
}
/**
 * Scan the skins directory. A missing directory is not an error: it just means
 * the user has not added a pack yet, and the built-in character stays in use.
 */
export async function listSkinManifests(home) {
    const root = skinsDir(home);
    let entries = [];
    try {
        entries = await readdir(root);
    }
    catch {
        return [];
    }
    const manifests = [];
    for (const entry of entries.sort()) {
        if (!isSafeSkinId(entry))
            continue;
        try {
            const manifestPath = join(root, entry, 'manifest.json');
            const info = await stat(manifestPath);
            if (!info.isFile() || info.size > 512 * 1024)
                continue;
            const manifest = parseSkinManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
            if (manifest === null || manifest.id !== entry)
                continue;
            manifests.push(manifest);
        }
        catch {
            continue;
        }
    }
    return manifests;
}
/** Summary rows for a picker, without the full per-action detail. */
export async function listSkinPacks(home) {
    const manifests = await listSkinManifests(home);
    return manifests.map((manifest) => {
        const { animations, ...rest } = manifest;
        return {
            ...rest,
            actions: Object.keys(animations),
            manifestUrl: skinFileUrl(manifest.id, 'manifest.json'),
        };
    });
}
/**
 * Serialise a manifest for the client: action files are rewritten to the host
 * route that serves them, so the browser never needs to know the pack layout.
 */
export function manifestForClient(manifest) {
    const animations = {};
    for (const [action, spec] of Object.entries(manifest.animations)) {
        animations[action] = { ...spec, file: skinFileUrl(manifest.id, spec.file) };
    }
    const out = { ...manifest, animations, actions: Object.keys(manifest.animations) };
    if (manifest.preview !== undefined)
        out.preview = skinFileUrl(manifest.id, manifest.preview);
    return out;
}
