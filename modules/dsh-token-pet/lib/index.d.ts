/**
 * dsh-token-pet host half.
 *
 * The token pet is primarily a browser-half plugin: it reads the framework's
 * real session projections (`contextPressure`, `contextBreakdown`,
 * `tokenUsage`, `sessionStats`, `contextTimeline`) directly from the session
 * scope. The host's one job here is to serve the cross-session cumulative
 * figure and its per-model / per-day breakdown (the "DSH 累计" number that no
 * single-session projection can provide), plus the persistent 清空/恢复 baseline
 * used to zero/recover the running display.
 *
 * Endpoints:
 *   - `GET  /token-pet/usage`    → full aggregate with baseline applied
 *   - `POST /token-pet/usage/reset`   → 清空: zero the display (records offset)
 *   - `POST /token-pet/usage/restore` → 恢复: revert the last 清空
 *
 * Panel GETs never start heavy work. `/usage/lifetime` serves only the durable
 * ledger snapshot, and `/index/status` answers from the persisted index (plus
 * the last single-flight header inspection) without ever waiting on a full
 * session check. All refreshing is owned by a single-flight background
 * coordinator: one startup reconcile 2-5s after boot, merged + debounced
 * incremental syncs after `session/flush` / `session/disposed`, and a
 * low-frequency (5-10 min) fallback. An explicit `POST /index/sync` still
 * forces an immediate incremental sync and reports progress. Every coordinator
 * timer and event listener is disposed with its owning ctx effect.
 *
 * Mounted on a webServer sub-fiber so a headless host degrades gracefully.
 * Install into a profile with `dsh plugin --profile <name> add link:<this dir>`.
 * @module dsh-token-pet
 */
import type { Context } from '@deepseek-ai/cordis';
export * from './growth.js';
export * from './session-usage-index.js';
export * from './lifetime-ledger.js';
export * from './index-contract.js';
export * from './hourly-trend-index.js';
export declare const name = "dsh-token-pet";
/** The browser half needs the slot registry; the host half needs webServer + session-query. */
export declare const inject: string[];
/**
 * Host plugin body. Registers the usage endpoints.
 * @param ctx - cordis context that owns this plugin fiber.
 */
export declare function apply(ctx: Context): void;
