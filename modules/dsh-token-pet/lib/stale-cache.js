/** Small stale-while-revalidate cache with a single shared refresh flight. */
export class StaleWhileRevalidate {
    loader;
    ttlMs;
    clock;
    value;
    refreshedAt = 0;
    inFlight;
    constructor(loader, ttlMs = 60_000, clock = Date.now) {
        this.loader = loader;
        this.ttlMs = ttlMs;
        this.clock = clock;
    }
    peek() { return this.value; }
    /** Start one refresh when missing/stale while exposing the last usable value. */
    inspect() {
        const stale = this.value === undefined || this.clock() - this.refreshedAt > this.ttlMs;
        if (!stale)
            return { value: this.value, refreshing: false };
        return { value: this.value, refreshing: true, refresh: this.refresh() };
    }
    /** Force a refresh; concurrent callers still share the same loader flight. */
    refresh() {
        if (this.inFlight)
            return this.inFlight;
        const flight = this.loader().then((value) => {
            this.value = value;
            this.refreshedAt = this.clock();
            return value;
        }).finally(() => {
            if (this.inFlight === flight)
                this.inFlight = undefined;
        });
        this.inFlight = flight;
        return flight;
    }
    /** Keep the prior snapshot usable, but require the next inspection to refresh it. */
    invalidate() { this.refreshedAt = 0; }
}
