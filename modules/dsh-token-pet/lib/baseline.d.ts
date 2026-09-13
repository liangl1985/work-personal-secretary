/**
 * Persistent baseline store for the pet's cumulative usage "清空/恢复".
 *
 * "清空" does not delete the underlying session data — it records a per
 * (model, day) offset so the displayed cumulative drops to zero, and pushes the
 * previous offsets onto an undo stack. "恢复" pops the stack and restores the
 * prior offsets, bringing the numbers back. This makes the operation fully
 * reversible and safe, and it survives restarts because it's a JSON file under
 * the harness data dir.
 * @module dsh-token-pet/baseline
 */
export interface BaselineOffsets {
    /** Per "provider\0model\0day" key → token offset subtracted from raw totals. */
    offsets: Record<string, number>;
}
export interface BaselineState {
    /** The active offsets applied to displayed cumulative. */
    active: Record<string, number>;
    /** Undo stack: each entry restores the PREVIOUS `active` (for 恢复). */
    history: Record<string, number>[];
}
/** The service surface for reading/writing the persistent baseline file. */
export interface BaselineService {
    read(): Promise<BaselineState>;
    /** 清空: set active offsets to the current raw totals (zero the display). */
    reset(rawOffsets: Record<string, number>): Promise<BaselineState>;
    /** 恢复: pop the last undo entry, reverting the previous offsets. */
    restore(): Promise<BaselineState>;
    /** Current applied offsets. */
    current(): Promise<Record<string, number>>;
    /** Irreversibly discard ordinary reset/restore state. */
    clearHistory(): Promise<BaselineState>;
}
export declare class FileBaselineStore implements BaselineService {
    private file;
    constructor(baseDir: string);
    read(): Promise<BaselineState>;
    current(): Promise<Record<string, number>>;
    reset(rawOffsets: Record<string, number>): Promise<BaselineState>;
    restore(): Promise<BaselineState>;
    clearHistory(): Promise<BaselineState>;
    private write;
}
/** Resolve the same Harness home used by DSH itself. A missing/blank
 * DSH_HOME means the conventional `~/.dsh`, not the OS home directory.
 * Keeping this in the host half avoids silently splitting plugin state across
 * `<home>/data` and the real Harness data root. */
export declare function resolveDshHome(environment?: NodeJS.ProcessEnv): string;
export declare function baselineDir(home: string): string;
