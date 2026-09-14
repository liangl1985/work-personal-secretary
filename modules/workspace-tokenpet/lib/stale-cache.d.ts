/** Small stale-while-revalidate cache with a single shared refresh flight. */
export declare class StaleWhileRevalidate<T> {
    private readonly loader;
    private readonly ttlMs;
    private readonly clock;
    private value;
    private refreshedAt;
    private inFlight;
    constructor(loader: () => Promise<T>, ttlMs?: number, clock?: () => number);
    peek(): T | undefined;
    /** Start one refresh when missing/stale while exposing the last usable value. */
    inspect(): {
        value: T | undefined;
        refreshing: boolean;
        refresh?: Promise<T>;
    };
    /** Force a refresh; concurrent callers still share the same loader flight. */
    refresh(): Promise<T>;
    /** Keep the prior snapshot usable, but require the next inspection to refresh it. */
    invalidate(): void;
}
