import { type CumulativeUsage, type ModelDayTotals, type SessionQueryService } from './usage.js';
import type { FileSessionUsageIndex, SessionUsageFingerprint } from './session-usage-index.js';
export interface LifetimeSessionSnapshot {
    fingerprint: SessionUsageFingerprint;
    live: boolean;
    observed: ModelDayTotals[];
    credited: ModelDayTotals[];
    updatedAt: number;
}
interface LifetimeLedgerPayload {
    version: 1;
    generation: number;
    sessions: Record<string, LifetimeSessionSnapshot>;
    floors: Record<string, ModelDayTotals[]>;
}
export interface LifetimeRefreshResult {
    usage: CumulativeUsage;
    listed: number;
    updated: number;
    retained: number;
    failed: number;
}
export declare class FileLifetimeLedger {
    readonly file: string;
    private readonly lockFile;
    private readonly recoveryFile;
    constructor(baseDir: string, fileName?: string);
    /** Atomic rename + checksum make snapshot reads safe without the writer lock. */
    usage(): Promise<CumulativeUsage>;
    refresh(sessionQuery: SessionQueryService, signal?: AbortSignal, usageIndex?: FileSessionUsageIndex): Promise<LifetimeRefreshResult>;
    /** Sole destructive API. Existing sessions become anchors so only future usage is recorded. */
    clearHistory(): Promise<CumulativeUsage>;
    inspect(): Promise<LifetimeLedgerPayload>;
    private collect;
    private load;
    private persist;
    private withLock;
}
export declare function lifetimeLedgerPath(baseDir: string): string;
export {};
