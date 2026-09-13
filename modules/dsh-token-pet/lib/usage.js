/** Host-side token usage aggregation and today's local-time trend. */
const ZERO = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const sumOf = (b) => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens;
function add(a, b) {
    return { uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens };
}
function bucket(usage) {
    return { uncachedInputTokens: pos(usage.inputTokens), outputTokens: pos(usage.outputTokens), cacheReadTokens: pos(usage.cacheReadTokens), cacheWriteTokens: pos(usage.cacheWriteTokens) };
}
function usageOf(event) {
    const d = event.data;
    if (event.type === 'assistant/chunk') {
        const chunk = d?.chunk;
        const usage = chunk?.type === 'usage' ? chunk.usage : undefined;
        return typeof usage === 'object' && usage !== null ? usage : undefined;
    }
    if (event.type === 'assistant/message' || event.type === 'step/end' || event.type === 'turn/end') {
        const usage = d?.usage ?? d?.step?.usage ?? d?.turn?.usage;
        return typeof usage === 'object' && usage !== null ? usage : undefined;
    }
    return undefined;
}
function epochMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return undefined;
    // DSH event times are epoch milliseconds; tolerate imported epoch seconds/us.
    if (value < 1e11)
        return value * 1000;
    if (value > 1e14)
        return value / 1000;
    return value;
}
function identityPart(value) {
    if (typeof value === 'string' && value !== '')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'object' && value !== null) {
        const id = value.id;
        if (typeof id === 'string' && id !== '')
            return id;
        if (typeof id === 'number' && Number.isFinite(id))
            return id;
    }
    return undefined;
}
function identity(event) {
    const d = event.data;
    // Canonical DSH events carry numeric/string turn/step directly on data.
    // Imported or adapter events may instead expose turnId/stepId or nested ids.
    const turn = identityPart(d?.turnId) ?? identityPart(d?.turn);
    const step = identityPart(d?.stepId) ?? identityPart(d?.step);
    return turn !== undefined && step !== undefined ? `${String(turn)}\0${String(step)}` : undefined;
}
function terminal(type) { return type === 'turn/end' || type === 'step/end' || type === 'assistant/message'; }
function usageEvents(events) {
    const selected = new Map();
    const retained = new Set();
    for (const [index, event] of events.entries()) {
        const usage = usageOf(event);
        if (!usage) {
            retained.add(index);
            continue;
        }
        const key = identity(event);
        if (!key) {
            retained.add(index);
            continue;
        }
        const old = selected.get(key);
        const isTerminal = terminal(event.type);
        if (!old || isTerminal || !old.terminal) {
            if (old)
                retained.delete(old.index);
            selected.set(key, { index, terminal: isTerminal });
            retained.add(index);
        }
    }
    // Keep each winner at its original position relative to request headers.
    // Appending keyed usage after all headers attributes it to the last model.
    return events.filter((_event, index) => retained.has(index));
}
function modelOf(event) {
    if (event.type !== 'request/header')
        return undefined;
    const h = event.data?.header;
    const p = typeof h?.config?.provider === 'string' && h.config.provider ? h.config.provider : typeof h?.provider === 'string' && h.provider ? h.provider : undefined;
    const m = typeof h?.config?.model === 'string' && h.config.model ? h.config.model : typeof h?.model === 'string' && h.model ? h.model : undefined;
    return p && m ? { provider: p, model: m } : undefined;
}
const partsFormatters = new Map();
function parts(ms, timeZone) {
    let formatter = partsFormatters.get(timeZone);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
        partsFormatters.set(timeZone, formatter);
    }
    const out = {};
    for (const x of formatter.formatToParts(ms))
        if (x.type !== 'literal')
            out[x.type] = x.value;
    return { date: `${out.year}-${out.month}-${out.day}`, hour: Number(out.hour) };
}
function today(ms, timeZone) { return parts(ms, timeZone).date; }
/** Pure fold of usage events into today's 24 local clock-hour buckets. */
export function aggregateUsageEvents(events, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now()) {
    const date = today(now, timeZone);
    const points = Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2, '0'), hourOfDay: hour, totals: { ...ZERO }, total: 0, count: 0 }));
    let currentModel;
    for (const event of usageEvents(events)) {
        const model = modelOf(event);
        if (model)
            currentModel = model;
        const u = usageOf(event);
        const timestamp = epochMs(event.time);
        if (!u || timestamp === undefined)
            continue;
        // Usage that arrives with a future timestamp must never appear in a
        // "today" chart (clock skew/imported data can otherwise create future
        // points). The caller's snapshot time is the upper bound.
        if (timestamp > now)
            continue;
        const local = parts(timestamp, timeZone);
        if (local.date !== date)
            continue;
        const p = points[local.hour];
        if (!p)
            continue;
        p.totals = add(p.totals, bucket(u));
        p.total = sumOf(p.totals);
        p.count += 1;
    }
    const totals = points.reduce((a, p) => add(a, p.totals), { ...ZERO });
    return { date, timeZone, sessions: 1, totals, total: sumOf(totals), byHour: points };
}
export function sessionFingerprint(record) {
    const h = record.header;
    const out = {};
    if (typeof h.revision === 'string' || (typeof h.revision === 'number' && Number.isFinite(h.revision)))
        out.revision = h.revision;
    if (typeof h.updatedAt === 'string' || (typeof h.updatedAt === 'number' && Number.isFinite(h.updatedAt)))
        out.updatedAt = h.updatedAt;
    if (typeof h.eventCount === 'number' && Number.isFinite(h.eventCount) && h.eventCount >= 0)
        out.eventCount = h.eventCount;
    // The released SessionHeader has no mtime/revision/eventCount. Closed logs
    // are immutable, so its canonical identity is a safe and stable fallback;
    // without this every real closed session produced an empty fingerprint and
    // was discarded by FileSessionUsageIndex.put(). Keep this deliberately
    // limited to header identity fields (not object key order or extra metadata).
    if (Object.keys(out).length === 0) {
        out.revision = `header:${JSON.stringify([h.version, h.id, h.createdAt, h.cwd, h.parentSession, h.seedLength, h.delegationDepth ?? 0])}`;
    }
    return out;
}
function dayOf(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function foldSession(events, fallbackDay, out) {
    let current;
    for (const event of usageEvents(events)) {
        const m = modelOf(event);
        if (m)
            current = m;
        const u = usageOf(event);
        if (!u)
            continue;
        const key = current ?? { provider: '(unknown)', model: '(unknown)' };
        const timestamp = epochMs(event.time);
        const day = timestamp !== undefined ? dayOf(timestamp) : fallbackDay;
        const id = `${key.provider}\0${key.model}\0${day}`;
        let cell = out.get(id);
        if (!cell) {
            cell = { ...key, day, totals: { ...ZERO }, total: 0 };
            out.set(id, cell);
        }
        cell.totals = add(cell.totals, bucket(u));
    }
}
/** Fold one closed or live session into a canonical ledger snapshot. */
export function foldSessionUsage(events, createdAt = 0) {
    const out = new Map();
    foldSession(events, dayOf(createdAt), out);
    return [...out.values()].map(cell => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }));
}
/** Build the public cumulative shape from durable ledger cells. */
export function summarizeUsageCells(source, sessions = source.length > 0 ? 1 : 0) {
    const map = new Map();
    for (const cell of source) {
        const id = `${cell.provider}\0${cell.model}\0${cell.day}`;
        const old = map.get(id);
        if (old)
            old.totals = add(old.totals, cell.totals);
        else
            map.set(id, { ...cell, totals: { ...cell.totals } });
    }
    const cells = [...map.values()];
    let totals = { ...ZERO };
    const models = new Map();
    const days = new Set();
    for (const cell of cells) {
        cell.total = sumOf(cell.totals);
        totals = add(totals, cell.totals);
        days.add(cell.day);
        const id = `${cell.provider}\0${cell.model}`;
        const model = models.get(id) ?? { provider: cell.provider, model: cell.model, total: 0 };
        model.total += cell.total;
        models.set(id, model);
    }
    return { sessions, totals, total: sumOf(totals), byModelDay: cells, models: [...models.values()].sort((a, b) => b.total - a.total), days: [...days].sort().reverse() };
}
/**
 * Explicit safe index construction. Reads one closed session at a time and
 * persists each item before moving on; completed entries survive cancellation.
 */
export async function buildSessionUsageIndex(sessionQuery, usageIndex, options = {}) {
    const { signal, onProgress, onError } = options;
    const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 1));
    let records;
    try {
        records = await sessionQuery.listSessions(signal);
    }
    catch (error) {
        if (signal?.aborted)
            return { completed: 0, total: 0, indexed: 0, skipped: 0, failed: 0, cancelled: true };
        throw error;
    }
    // Live sessions are intentionally outside the persistent closed-session
    // index. They must not inflate the first-build denominator or pending count.
    const closed = records.filter(record => !record.live);
    let completed = 0;
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    // Persist an explicit empty document so status can distinguish "built, no
    // closed sessions" from "never built" and does not trigger a rebuild loop.
    if (closed.length === 0)
        await usageIndex.ensurePersisted();
    for (const record of closed) {
        if (signal?.aborted)
            return { completed, total: closed.length, indexed, skipped, failed, cancelled: true };
        const id = record.header.id;
        const fp = sessionFingerprint(record);
        let status;
        if (await usageIndex.lookup(id, fp)) {
            skipped++;
            status = 'skipped';
        }
        else {
            try {
                const source = await sessionQuery.readSession(id);
                const created = typeof source.session?.createdAt === 'number' ? source.session : { createdAt: 0 };
                const local = new Map();
                foldSession(source.events, dayOf(created.createdAt), local);
                // Index entries require a canonical total matching all four buckets;
                // finalize before persistence instead of leaving the fold's initial 0.
                const cells = [...local.values()].map((cell) => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }));
                await usageIndex.put(id, fp, cells);
                indexed++;
                status = 'indexed';
            }
            catch (error) {
                failed++;
                status = 'failed';
                await onError?.(id, error);
            }
        }
        completed++;
        await onProgress?.({ completed, total: closed.length, indexed, skipped, failed, sessionId: id, status });
        if (completed % yieldEvery === 0)
            await new Promise(resolve => setImmediate(resolve));
    }
    return { completed, total: closed.length, indexed, skipped, failed, cancelled: false };
}
/** Cheap index/header comparison. It never opens a session log. */
export async function inspectSessionUsageIndex(sessionQuery, usageIndex, signal) {
    const records = await sessionQuery.listSessions(signal);
    const existing = await usageIndex.entries();
    const active = new Set(records.map(record => record.header.id));
    const closedRecords = records.filter(record => !record.live);
    const matches = await Promise.all(closedRecords.map(async (record) => (await usageIndex.lookup(record.header.id, sessionFingerprint(record))) !== undefined));
    const pendingRecords = closedRecords.filter((_record, index) => !matches[index]);
    return {
        records,
        closed: closedRecords.length,
        live: records.length - closedRecords.length,
        indexed: matches.filter(Boolean).length,
        pending: pendingRecords.length,
        pendingRecords,
        removedIds: Object.keys(existing).filter(id => !active.has(id)),
    };
}
/**
 * Refresh only new/changed closed sessions after an index has been built.
 * Stable headers are eliminated before progress starts, so `total` and
 * `completed` describe only new/changed work and never include live sessions.
 */
export async function incrementSessionUsageIndex(sessionQuery, usageIndex, options = {}) {
    const { signal, onProgress, onError } = options;
    const inspection = options.inspection ?? await inspectSessionUsageIndex(sessionQuery, usageIndex, signal);
    const pending = inspection.pendingRecords;
    const removedIds = inspection.removedIds;
    const writes = [];
    let cursor = 0;
    let indexed = 0;
    const skipped = inspection.indexed;
    let failed = 0;
    let completed = 0;
    const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
    const process = async () => {
        while (true) {
            if (signal?.aborted)
                return;
            const record = pending[cursor++];
            if (!record)
                return;
            const id = record.header.id;
            const fp = sessionFingerprint(record);
            try {
                const source = await sessionQuery.readSession(id);
                const created = typeof source.session?.createdAt === 'number' ? source.session : { createdAt: 0 };
                const local = new Map();
                foldSession(source.events, dayOf(created.createdAt), local);
                const cells = [...local.values()].map(cell => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }));
                // A missing fingerprint cannot safely be invalidated/cached.
                if (Object.keys(fp).length > 0)
                    writes.push({ sessionId: id, fingerprint: fp, cells });
                indexed++;
                completed++;
                await onProgress?.({ completed, total: pending.length, indexed, skipped, failed, sessionId: id, status: 'indexed' });
            }
            catch (error) {
                failed++;
                completed++;
                await onError?.(id, error);
                await onProgress?.({ completed, total: pending.length, indexed, skipped, failed, sessionId: id, status: 'failed' });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => process()));
    if (writes.length > 0)
        await usageIndex.putMany(writes);
    if (removedIds.length > 0)
        await usageIndex.invalidateMany(removedIds);
    return { completed, total: pending.length, indexed, skipped, failed, cancelled: Boolean(signal?.aborted), removed: removedIds.length };
}
export async function aggregateCumulativeUsage(sessionQuery, signal, usageIndex) {
    signal?.throwIfAborted();
    const records = await sessionQuery.listSessions(signal);
    const map = new Map();
    let scanned = 0;
    for (let i = 0; i < records.length; i += 4) {
        const results = await Promise.all(records.slice(i, i + 4).map(async (r) => {
            const fp = sessionFingerprint(r);
            if (!r.live && usageIndex) {
                const cached = await usageIndex.lookup(r.header.id, fp);
                if (cached)
                    return cached;
            }
            try {
                const source = await sessionQuery.readSession(r.header.id);
                const created = typeof source.session?.createdAt === 'number' ? source.session : { createdAt: 0 };
                const local = new Map();
                foldSession(source.events, dayOf(created.createdAt), local);
                return [...local.values()];
            }
            catch {
                return null;
            }
        }));
        for (const cells of results) {
            if (!cells)
                continue;
            scanned++;
            for (const c of cells) {
                const id = `${c.provider}\0${c.model}\0${c.day}`;
                const old = map.get(id);
                if (old)
                    old.totals = add(old.totals, c.totals);
                else
                    map.set(id, { ...c, totals: { ...c.totals } });
            }
        }
    }
    const cells = [...map.values()];
    let totals = { ...ZERO };
    const models = new Map();
    const days = new Set();
    for (const c of cells) {
        c.total = sumOf(c.totals);
        totals = add(totals, c.totals);
        days.add(c.day);
        const id = `${c.provider}\0${c.model}`;
        const m = models.get(id) ?? { provider: c.provider, model: c.model, total: 0 };
        m.total += c.total;
        models.set(id, m);
    }
    return { sessions: scanned, totals, total: sumOf(totals), byModelDay: cells, models: [...models.values()].sort((a, b) => b.total - a.total), days: [...days].sort().reverse() };
}
