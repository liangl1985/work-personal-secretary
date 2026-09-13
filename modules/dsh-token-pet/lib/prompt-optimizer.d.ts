/**
 * Local, bounded adaptation of the prompt-optimizer Skill.
 *
 * This is deliberately a prompt rule builder, not an executor: user text and
 * custom templates are data supplied to the existing DSH model route.
 */
export type PromptComplexity = 'simple' | 'moderate' | 'complex';
export declare function detectPromptLanguage(prompt: string): 'zh' | 'en';
export declare function classifyPromptComplexity(prompt: string): PromptComplexity;
/** Build the user message sent through the existing DSH model call. */
export declare function buildPromptOptimizerInput(prompt: string, customTemplate?: string): string;
