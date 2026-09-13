/** Shared host/client contract for the persistent Token Pet usage index. */
export function deriveTokenPetIndexState(input) {
    if (input.operation)
        return input.operation;
    if (input.terminal)
        return input.terminal;
    if (!input.persisted)
        return 'missing';
    return input.pending > 0 ? 'partial' : 'ready';
}
