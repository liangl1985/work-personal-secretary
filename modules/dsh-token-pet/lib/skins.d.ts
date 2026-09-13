/** Only these action names may appear in a pack (the plugin's fixed 12). */
export declare const SKIN_ACTIONS: readonly ["idle", "working", "eating", "digesting", "warning", "evolve", "click", "archive", "tool-success", "tool-failure", "prompt-enhancing", "prompt-ready"];
/** One action entry inside a pack manifest. */
export interface SkinActionSpec {
    /** File name relative to the pack root, e.g. "idle.webp" or "frames/idle.webp". */
    file: string;
    /** Frame count (the plugin's sheets are 32; kept flexible for future packs). */
    frames?: number;
    /** Frames per second (the plugin plays 10 fps). */
    fps?: number;
    /** Cell width in pixels; defaults to the pack canvas width. */
    frameW?: number;
    /** Cell height in pixels; defaults to the pack canvas height. */
    frameH?: number;
    /**
     * Sheet rows when a wide action is wrapped (defaults to 1 in the client).
     * MUST be forwarded to the client: the client falls back to the *built-in*
     * template's rows when this is missing, and one built-in action is a 2-row
     * sheet (660px cells), which would mis-slice a single-row pack strip.
     */
    rows?: number;
}
/** A validated pack manifest. */
export interface SkinManifest {
    schemaVersion?: number;
    id: string;
    name: string;
    nameLocalized?: Record<string, string>;
    description?: Record<string, string>;
    version?: string;
    author?: string;
    license?: string;
    /** Cell size; defaults to 360x540. */
    canvas?: {
        width: number;
        height: number;
    };
    /** Character body height inside the cell; defaults to 480. */
    bodyHeight?: number;
    /** Feet baseline inside the cell; defaults to 520. */
    feetY?: number;
    /** Optional preview image file name. */
    preview?: string;
    /** Optional colour overrides for the SVG fallback ("<stage>.ring"). */
    styleOverrides?: Record<string, string>;
    animations: Record<string, SkinActionSpec>;
}
/** What the client needs to render a picker without reading every manifest twice. */
export interface SkinPackSummary extends Omit<SkinManifest, 'animations'> {
    actions: string[];
    manifestUrl: string;
}
/** The directory packs live in. */
export declare function skinsDir(home: string): string;
/** A pack id is safe when it cannot escape its own directory. */
export declare function isSafeSkinId(id: unknown): id is string;
/**
 * A pack-relative file reference is safe when every segment is a plain name and
 * the extension is one we serve. Nested paths are allowed so a pack may keep
 * its frames in a subdirectory, but no segment may traverse.
 */
export declare function isSafeSkinFile(file: unknown): file is string;
/**
 * The public URL that serves one pack file.
 *
 * Served by an EXACT route carrying the pack id and file as query parameters.
 * Measured on DSH Desktop 0.1.5-rc.1: the desktop carrier resolves exact routes
 * only — the plugin's own prefix strip route answers 404 there — while an exact
 * route with a query string resolves normally (`/token-pet/usage/trend?...`).
 * A prefix form is registered too, for open-web carriers that serve real HTTP.
 */
export declare function skinFileUrl(id: string, file: string): string;
/** Content type for a pack file name. */
export declare function skinContentType(file: string): string;
/**
 * Parse an untrusted manifest into a pack, or null when it is unusable.
 *
 * Unusable means: no safe id, no display name, or no usable action at all.
 * Individual bad action entries are dropped rather than failing the pack, so a
 * half-finished pack still shows up with its good actions.
 */
export declare function parseSkinManifest(raw: unknown): SkinManifest | null;
/** Resolve a pack-relative file to an absolute path, or null when it escapes. */
export declare function resolveSkinPath(home: string, id: string, file: string): string | null;
/** Read one pack file, or null when it is missing / unsafe / too large. */
export declare function readSkinFile(home: string, id: string, file: string, maxBytes?: number): Promise<{
    data: Buffer;
    contentType: string;
} | null>;
/**
 * Scan the skins directory. A missing directory is not an error: it just means
 * the user has not added a pack yet, and the built-in character stays in use.
 */
export declare function listSkinManifests(home: string): Promise<SkinManifest[]>;
/** Summary rows for a picker, without the full per-action detail. */
export declare function listSkinPacks(home: string): Promise<SkinPackSummary[]>;
/**
 * Serialise a manifest for the client: action files are rewritten to the host
 * route that serves them, so the browser never needs to know the pack layout.
 */
export declare function manifestForClient(manifest: SkinManifest): SkinManifest & {
    actions: string[];
};
