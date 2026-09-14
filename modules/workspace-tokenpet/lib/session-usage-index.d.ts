import type { ModelDayTotals } from './usage.js';
export interface SessionUsageFingerprint {
    /** Source log identity when available (mtime/size or host revision). */
    revision?: string | number;
    /** Header updated time; changing it invalidates a closed-session fold. */
    updatedAt?: string | number;
    /** Number of events, if the host supplies it. */
    eventCount?: number;
}
export interface SessionUsageIndexEntry {
    fingerprint: SessionUsageFingerprint;
    cells: ModelDayTotals[];
}
export interface SessionUsageIndexState {
    version: 1;
    sessions: Record<string, SessionUsageIndexEntry>;
}
export declare class FileSessionUsageIndex {
    private readonly file;
    private state;
    private persisted;
    private readInFlight;
    constructor(baseDir: string, fileName?: string);
    read(): Promise<SessionUsageIndexState>;
    lookup(sessionId: string, current: SessionUsageFingerprint): Promise<ModelDayTotals[] | undefined>;
    put(sessionId: string, source: SessionUsageFingerprint, folded: ModelDayTotals[]): Promise<void>;
    /** Store a rebuild batch with one atomic disk replacement. */
    putMany(entries: Array<{
        sessionId: string;
        fingerprint: SessionUsageFingerprint;
        cells: ModelDayTotals[];
    }>): Promise<void>;
    invalidate(sessionId?: string): Promise<void>;
    invalidateMany(sessionIds: readonly string[]): Promise<void>;
    entries(): Promise<Record<string, SessionUsageIndexEntry>>;
    /** Whether a valid index document has been loaded or persisted. */
    isPersisted(): Promise<boolean>;
    /** Materialize an empty index too, so a zero-session host does not rebuild forever. */
    ensurePersisted(): Promise<void>;
    private loadFresh;
    private mutate;
}
export declare function sessionUsageIndexPath(baseDir: string): string;
