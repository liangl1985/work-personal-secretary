/** Host-side token usage aggregation and today's local-time trend. */
import type { FileSessionUsageIndex, SessionUsageFingerprint } from './session-usage-index.js';
export interface UsageBuckets {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface ModelKey {
    provider: string;
    model: string;
}
export interface ModelDayTotals {
    provider: string;
    model: string;
    day: string;
    totals: UsageBuckets;
    total: number;
}
export interface CumulativeUsage {
    sessions: number;
    totals: UsageBuckets;
    total: number;
    byModelDay: ModelDayTotals[];
    models: Array<ModelKey & {
        total: number;
    }>;
    days: string[];
}
export interface UsageEvent {
    type?: string;
    data?: unknown;
    time?: number;
}
export interface SessionQueryService {
    listSessions(signal?: AbortSignal): Promise<Array<{
        header: {
            id: string;
            version?: unknown;
            createdAt?: unknown;
            cwd?: unknown;
            parentSession?: unknown;
            seedLength?: unknown;
            delegationDepth?: unknown;
            updatedAt?: unknown;
            revision?: string | number;
            eventCount?: number;
        };
        live?: boolean;
    }>>;
    readSession(sessionId: string): Promise<{
        session: unknown;
        events: UsageEvent[];
    }>;
}
/** Options for an explicit, host-controlled index build. */
export interface UsageIndexBuildOptions {
    signal?: AbortSignal;
    /** Called after each item, including skipped and failed items. */
    onProgress?: (progress: UsageIndexBuildProgress) => void | Promise<void>;
    /** Report an isolated read failure without aborting the build. */
    onError?: (sessionId: string, error: unknown) => void | Promise<void>;
    /** Number of sessions after which the builder yields to the host event loop. */
    yieldEvery?: number;
}
export interface UsageIndexBuildProgress {
    completed: number;
    /** Work items for this operation: closed sessions for build, new/changed closed sessions for sync. */
    total: number;
    indexed: number;
    skipped: number;
    failed: number;
    sessionId?: string;
    status?: 'indexed' | 'skipped' | 'failed' | 'building' | 'syncing' | 'ready' | 'cancelled' | 'error';
}
export interface UsageIndexBuildResult extends Omit<UsageIndexBuildProgress, 'sessionId' | 'status'> {
    cancelled: boolean;
}
export interface UsageTrendPoint {
    hour: string;
    hourOfDay: number;
    totals: UsageBuckets;
    total: number;
    count: number;
}
export interface TodayUsageTrend {
    date: string;
    timeZone: string;
    sessions: number;
    totals: UsageBuckets;
    total: number;
    byHour: UsageTrendPoint[];
}
/** Pure fold of usage events into today's 24 local clock-hour buckets. */
export declare function aggregateUsageEvents(events: UsageEvent[], timeZone?: string, now?: number): TodayUsageTrend;
export declare function sessionFingerprint(record: {
    header: {
        id: string;
        version?: unknown;
        createdAt?: unknown;
        cwd?: unknown;
        parentSession?: unknown;
        seedLength?: unknown;
        delegationDepth?: unknown;
        revision?: string | number;
        updatedAt?: unknown;
        eventCount?: number;
    };
}): SessionUsageFingerprint;
/** Fold one closed or live session into a canonical ledger snapshot. */
export declare function foldSessionUsage(events: UsageEvent[], createdAt?: number): ModelDayTotals[];
/** Build the public cumulative shape from durable ledger cells. */
export declare function summarizeUsageCells(source: readonly ModelDayTotals[], sessions?: number): CumulativeUsage;
/**
 * Explicit safe index construction. Reads one closed session at a time and
 * persists each item before moving on; completed entries survive cancellation.
 */
export declare function buildSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, options?: UsageIndexBuildOptions): Promise<UsageIndexBuildResult>;
export interface UsageIndexIncrementOptions extends UsageIndexBuildOptions {
    /** Maximum number of changed session logs read concurrently. */
    concurrency?: number;
    /** Reuse a just-completed header inspection instead of listing every session twice. */
    inspection?: UsageIndexInspection;
}
export interface UsageIndexIncrementResult extends Omit<UsageIndexBuildResult, 'cancelled'> {
    cancelled: boolean;
    removed: number;
}
export interface UsageIndexInspection {
    records: Awaited<ReturnType<SessionQueryService['listSessions']>>;
    closed: number;
    live: number;
    indexed: number;
    pending: number;
    pendingRecords: Awaited<ReturnType<SessionQueryService['listSessions']>>;
    removedIds: string[];
}
/** Cheap index/header comparison. It never opens a session log. */
export declare function inspectSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, signal?: AbortSignal): Promise<UsageIndexInspection>;
/**
 * Refresh only new/changed closed sessions after an index has been built.
 * Stable headers are eliminated before progress starts, so `total` and
 * `completed` describe only new/changed work and never include live sessions.
 */
export declare function incrementSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, options?: UsageIndexIncrementOptions): Promise<UsageIndexIncrementResult>;
export declare function aggregateCumulativeUsage(sessionQuery: SessionQueryService, signal?: AbortSignal, usageIndex?: FileSessionUsageIndex): Promise<CumulativeUsage>;
