/**
 * lina-memory — 本地时间工具（2026-09-11 定：所有日期/时间以**本地时区**为准）
 *
 * 此前全用 `Date.prototype.toISOString()`（UTC）：本地 08:00 之前写的记忆会被算进
 * "昨天"，归档排期也按 UTC 走。现在统一从这里取，日界 = 本地 00:00（中国时间）。
 *
 * @module lina-memory/clock
 */

const pad = (n, w = 2) => String(n).padStart(w, '0')

/** 本地日期 YYYY-MM-DD（日界 = 本地 00:00） */
export function todayStamp(date = new Date()) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** 本地时间 HH:MM */
export function nowHHMM(date = new Date()) {
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 本地完整时间戳（带时区偏移，如 2026-09-11T10:20:30+08:00）——用于记录 at/归档时间 */
export function localIso(date = new Date()) {
  const off = -date.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return todayStamp(date) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
    + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
}

/** 在本地日期上加减天数，返回 YYYY-MM-DD */
export function addDays(stamp, days) {
  const d = new Date(String(stamp) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return todayStamp(d)
}

/** 两个本地日期相差天数（a - b） */
export function diffDays(a, b) {
  const da = new Date(String(a) + 'T00:00:00')
  const db = new Date(String(b) + 'T00:00:00')
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  return Math.round((da - db) / 86400000)
}

/** 本地周标识：YYYY-Www（ISO 周号，用于 DAILY 按周归档） */
export function weekKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7 // 周一=0
  d.setDate(d.getDate() - day + 3) // 移到本周周四
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000))
  return d.getFullYear() + '-W' + pad(week)
}

/** 解析任意时间戳（本地 ISO / 纯日期 / UTC ISO）为本地日期 YYYY-MM-DD */
export function dateOf(value) {
  const s = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(s)
  if (m) {
    // 带偏移的本地 ISO：取其日期部分；无偏移则按 UTC 解析后转本地
    if (/[+-]\d{2}:\d{2}$/.test(s)) return m[1]
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? m[1] : todayStamp(d)
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : todayStamp(d)
}
