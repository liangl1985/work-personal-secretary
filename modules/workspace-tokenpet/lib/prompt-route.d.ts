export interface PromptRouteSelection {
    provider?: string;
    model?: string;
}
/** Resolve an enhancement call from the active session route, then DSH defaults. */
export declare function resolvePromptRoute(request: PromptRouteSelection, defaults: PromptRouteSelection, providers: ReadonlyArray<{
    id: string;
}>): PromptRouteSelection;
