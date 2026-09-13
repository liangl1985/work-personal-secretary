import type { TodayUsageTrend, UsageBuckets, UsageEvent } from './usage.js';
export interface SequencedUsageEvent extends UsageEvent {
    seq?: number;
}
export interface TrendPersistenceSnapshot {
    header: {
        id: string;
    };
    revision: unknown;
}
export interface TrendPersistenceService {
    listSnapshots(signal?: AbortSignal): Promise<TrendPersistenceSnapshot[]>;
    readFrom(id: string, fromSeq: number, signal?: AbortSignal): Promise<{
        meta: unknown;
        events: SequencedUsageEvent[];
    }>;
}
interface Observation {
    cell: string;
    totals: UsageBuckets;
    terminal: boolean;
}
interface SessionFold {
    nextSeq: number;
    revision?: string;
    model?: {
        provider: string;
        model: string;
    };
    observations: Record<string, Observation>;
}
interface HourCell {
    at: number;
    provider: string;
    model: string;
    totals: UsageBuckets;
    count: number;
}
interface Payload {
    sessions: Record<string, SessionFold>;
    cells: Record<string, HourCell>;
    updatedAt: number;
}
export type TrendIndexHealth = 'ready' | 'missing' | 'corrupt';
export interface TrendApplyResult {
    applied: boolean;
    repairFrom?: number;
}
export interface TrendIndexInspection {
    health: TrendIndexHealth;
    updatedAt: number;
    sessions: number;
    cells: number;
}
export declare function trendRevisionKey(revision: unknown): string;
export declare class FileHourlyTrendIndex {
    private readonly file;
    private readonly clock;
    private payload?;
    private health;
    private loadFlight?;
    constructor(file: string, clock?: () => number);
    static at(baseDir: string): FileHourlyTrendIndex;
    get path(): string;
    status(): Promise<TrendIndexHealth>;
    /** Snapshot metadata only: never lists sessions or opens a transcript. */
    inspect(): Promise<TrendIndexInspection>;
    checkpoint(sessionId: string): Promise<{
        nextSeq: number;
        revision?: string;
    } | undefined>;
    setRevision(sessionId: string, revision: unknown): Promise<void>;
    retainSessions(sessionIds: ReadonlySet<string>): Promise<void>;
    read(): Promise<Payload>;
    trend(timeZone: string, now?: number): Promise<TodayUsageTrend>;
    applyEvent(sessionId: string, event: SequencedUsageEvent): Promise<TrendApplyResult>;
    applyEvents(sessionId: string, events: readonly SequencedUsageEvent[], replace?: boolean, revision?: unknown): Promise<TrendApplyResult>;
    replaceAll(sources: Array<{
        sessionId: string;
        revision?: unknown;
        events: SequencedUsageEvent[];
    }>, signal?: AbortSignal): Promise<void>;
    private removeSession;
    private mutate;
}
export declare function hourlyTrendIndexPath(baseDir: string): string;
export {};
