/**
 * Account balance projection for the pet panel.
 *
 * Reads the balance through the official `account` Remote namespace
 * (`getBalance(AccountClientMetadata)`) and formats it with Platform Web's
 * two-decimal rules. The Host owns the raw decimal string, so this module never
 * converts a balance to a float: every step is string arithmetic.
 *
 * @module workspace-tokenpet/client/account
 */

/** Client identity the official account Remote methods require. */
export interface AccountClientMetadata {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

/** One Platform wallet entry as the account Remote returns it. */
export interface AccountWallet {
  readonly currency: 'CNY' | 'USD'
  readonly balance: string
}

/** Balance outcome the panel renders; `unavailable` means the host exposes no account Remote. */
export type BalanceState = 'ready' | 'signed-out' | 'failed' | 'unavailable'

/** Balance projection consumed by the panel. */
export interface BalanceView {
  readonly state: BalanceState
  /** Formatted recharge balance; present only when `state === 'ready'`. */
  readonly recharge?: string
  /** Formatted granted-bonus balance; present only when a bonus wallet exists. */
  readonly bonus?: string
}

/** Account Remote surface this module consumes. */
interface AccountRemote {
  getBalance?: (client: AccountClientMetadata) => Promise<{ ok?: boolean; value?: unknown } | null | undefined>
}

const CURRENCY_SYMBOL: Record<string, '¥' | '$'> = { CNY: '¥', USD: '$' }

/** Fallback bundle version so the metadata carries a non-empty version on third-party builds. */
const BUNDLE_VERSION = '1.0.6'

/**
 * Build the request identity for one account call.
 *
 * The client build version is inlined by the host bundle when present; a
 * third-party build without that define falls back to this bundle's version, so
 * the metadata is never empty.
 * @param locale - active UI language.
 * @param version - client build version from the bundle environment.
 * @returns metadata for the account Remote methods.
 */
export function accountClientMetadata(locale: string, version?: string): AccountClientMetadata {
  const build = version !== undefined && version !== '' ? version : BUNDLE_VERSION
  return {
    version: build,
    locale,
    // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/** Split a validated decimal string into sign, integer and fraction parts. @returns null when the text is not a plain decimal. */
function splitDecimal(amount: string): { negative: boolean; integer: string; fraction: string } | null {
  const text = String(amount ?? '').trim()
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [integer = '0', fraction = ''] = body.split('.')
  return { negative, integer, fraction }
}

/** Insert thousands separators into an integer digit string. @param digits - plain digit string. @returns grouped digits. */
function addCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Truncate a fraction to two digits, rounding half up on the third digit. @param fraction - fraction digits without the point. @returns two digits. */
function roundHalfUp2(fraction: string): { digits: string; carry: boolean } {
  const padded = (fraction + '00').slice(0, 3)
  const first2 = padded.slice(0, 2)
  const third = Number(padded[2])
  return { digits: first2, carry: third >= 5 }
}

/** Increment a two-digit string by one, reporting overflow past 99. @param digits - two digits. @returns incremented digits and whether the integer part must advance. */
function bump2(digits: string): { digits: string; carry: boolean } {
  const next = Number(digits) + 1
  return next > 99 ? { digits: '00', carry: true } : { digits: String(next).padStart(2, '0'), carry: false }
}

/**
 * Format a balance using Platform Web's two-decimal and sub-cent display rules.
 * @param amount - validated decimal balance string.
 * @param symbol - currency symbol.
 * @returns signed currency text with grouped digits, or an empty string when the input is not a decimal.
 */
export function formatBalance(amount: string, symbol: '¥' | '$'): string {
  const parsed = splitDecimal(amount)
  if (!parsed) return ''
  const { negative, integer, fraction } = parsed
  const zeroInteger = /^0*$/.test(integer)
  const zeroFraction = /^0*$/.test(fraction)
  if (zeroInteger && zeroFraction) return symbol + '0.00'
  if (negative) {
    const tiny = zeroInteger && /^0*$/.test((fraction + '00').slice(0, 2))
    if (tiny) return '-' + symbol + '0.01'
    const rounded = roundHalfUp2(fraction)
    let int = integer
    let cents = rounded.digits
    if (rounded.carry) {
      const bumped = bump2(cents)
      cents = bumped.digits
      if (bumped.carry) int = String(Number(int) + 1)
    }
    return '-' + symbol + addCommas(String(Number(int))) + '.' + cents
  }
  if (zeroInteger && /^0*$/.test((fraction + '00').slice(0, 2))) return '<' + symbol + '0.01'
  const truncated = (fraction + '00').slice(0, 2)
  return symbol + addCommas(String(Number(integer))) + '.' + truncated
}

/** Sum wallets of one currency into a single formatted string. @param wallets - wallet entries to display. @returns formatted text, or an empty string when nothing is positive. */
function formatWallets(wallets: readonly AccountWallet[]): string {
  const parts: string[] = []
  for (const wallet of wallets) {
    if (!wallet || typeof wallet.balance !== 'string') continue
    const symbol = CURRENCY_SYMBOL[wallet.currency]
    if (!symbol) continue
    const parsed = splitDecimal(wallet.balance)
    if (!parsed) continue
    // A granted-bonus wallet can exist with a zero amount; it must not render a "¥0.00" row.
    if (/^0*$/.test(parsed.integer) && /^0*$/.test(parsed.fraction)) continue
    const text = formatBalance(wallet.balance, symbol)
    if (text !== '') parts.push(text)
  }
  return parts.join(' + ')
}

/**
 * Project one balance query result into panel state.
 * @param value - `AccountDetails['balance']` as the Remote returned it.
 * @returns the panel projection.
 */
export function balanceView(value: unknown): BalanceView {
  const details = value as { status?: string; value?: readonly AccountWallet[]; bonusWallets?: readonly AccountWallet[] } | null
  if (!details || details.status !== 'ready') return { state: 'failed' }
  const recharge = formatWallets(Array.isArray(details.value) ? details.value : [])
  const bonus = formatWallets(Array.isArray(details.bonusWallets) ? details.bonusWallets : [])
  if (recharge === '' && bonus === '') return { state: 'failed' }
  return bonus === '' ? { state: 'ready', recharge } : { state: 'ready', recharge, bonus }
}

/**
 * Read the account balance through the official Remote when the host exposes it.
 *
 * Every failure path degrades to a panel state instead of throwing: this runs
 * from a render-adjacent effect, and the pet must never fail to mount because of
 * an account query.
 * @param remote - `ctx.get('remote.account')` value; undefined when the host has no account capability.
 * @param locale - active UI language.
 * @param version - client build version from the bundle environment.
 * @returns the balance projection.
 */
export async function readBalance(remote: unknown, locale: string, version?: string): Promise<BalanceView> {
  const account = (remote ?? undefined) as AccountRemote | undefined
  if (!account || typeof account.getBalance !== 'function') return { state: 'unavailable' }
  try {
    const result = await account.getBalance(accountClientMetadata(locale, version))
    if (result && result.ok === false) return { state: 'failed' }
    const value = result ? result.value : undefined
    if (value === null || value === undefined) return { state: 'signed-out' }
    return balanceView(value)
  } catch (_error) {
    // The host may reject the call while the account session is absent; the panel reports it as a failed read.
    return { state: 'failed' }
  }
}
