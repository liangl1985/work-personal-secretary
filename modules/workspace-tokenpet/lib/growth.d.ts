/** Pure context-pressure state machines. Visual identity never changes by band. */
export declare const GROWTH_THRESHOLDS: readonly [0, 20, 40, 60, 80, 95, 100];
export type PressureBand = 'newborn' | 'growth' | 'active' | 'heavy' | 'overload' | 'critical';
/** @deprecated Compatibility name; values now represent pressure bands, not visual growth forms. */
export type GrowthStage = PressureBand;
export declare const PRESSURE_BANDS: readonly PressureBand[];
/** @deprecated Use PRESSURE_BANDS for new code. */
export declare const GROWTH_STAGES: readonly GrowthStage[];
export interface GrowthSnapshot {
    stage: GrowthStage;
    progress: number;
    occupancyPercent: number;
    cumulativeTokens: number;
    /** Monotonic transition number, useful for animation/event deduplication. */
    transitionId: number;
    /** Stable key for the current state; unchanged updates must not retrigger effects. */
    transitionKey: string;
    changed: boolean;
}
export declare function growthStageAt(percent: number): {
    stage: GrowthStage;
    progress: number;
    label: string;
};
export declare function createGrowthSnapshot(occupancyPercent: number | null, cumulativeTokens?: number): GrowthSnapshot;
export declare function updateGrowthSnapshot(previous: GrowthSnapshot, occupancyPercent: number | null, cumulativeTokens?: number): GrowthSnapshot;
export type ContextState = 'NORMAL' | 'ARMED' | 'EATING' | 'DIGESTING';
export type ContextSignal = {
    type: 'pressure';
    occupancyPercent: number;
    source?: 'simulated' | 'real';
} | {
    type: 'compact-start';
    source: 'real' | 'simulated';
} | {
    type: 'compact-end';
    source: 'real' | 'simulated';
} | {
    type: 'digest-end';
    source?: 'real' | 'simulated';
};
export interface ContextSnapshot {
    state: ContextState;
    occupancyPercent: number;
    /** true only when a real compact signal drove EATING/DIGESTING. */
    compactSource: 'real' | 'simulated' | null;
    transitionId: number;
    transitionKey: string;
    changed: boolean;
}
export declare function createContextSnapshot(occupancyPercent?: number): ContextSnapshot;
/** Reduce one signal. Simulated pressure may arm the pet, but never fakes a compact. */
export declare function reduceContextSnapshot(previous: ContextSnapshot, signal: ContextSignal): ContextSnapshot;
export declare function contextStateFor(occupancyPercent: number, compact?: {
    phase: 'start' | 'end';
    source: 'real' | 'simulated';
}): ContextState;
