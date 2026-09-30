import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountClientMetadata, balanceView, formatBalance, readBalance } from '../src/client/account.ts'

test('formatBalance follows Platform Web display rules', () => {
  assert.equal(formatBalance('0', '¥'), '¥0.00')
  assert.equal(formatBalance('0.00', '¥'), '¥0.00')
  assert.equal(formatBalance('0.001', '¥'), '<¥0.01')
  assert.equal(formatBalance('12.349', '¥'), '¥12.34')
  assert.equal(formatBalance('9.999', '$'), '$9.99')
  assert.equal(formatBalance('1234.5', '¥'), '¥1,234.50')
  assert.equal(formatBalance('-0.001', '¥'), '-¥0.01')
  assert.equal(formatBalance('-12.34', '¥'), '-¥12.34')
  assert.equal(formatBalance('not-a-number', '¥'), '')
  assert.equal(formatBalance('', '¥'), '')
})

test('balanceView maps the Remote balance union', () => {
  assert.equal(balanceView(null).state, 'failed')
  assert.equal(balanceView({ status: 'failed' }).state, 'failed')
  const ready = balanceView({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '88.8' }],
    bonusWallets: [{ currency: 'CNY', balance: '1.5' }],
  })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.recharge, '¥88.80')
  assert.equal(ready.bonus, '¥1.50')
  const noBonus = balanceView({ status: 'ready', value: [{ currency: 'USD', balance: '3' }] })
  assert.equal(noBonus.recharge, '$3.00')
  assert.equal(noBonus.bonus, undefined)
  // A zero-amount bonus wallet must not render a "¥0.00" row.
  const zeroBonus = balanceView({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '26.15' }],
    bonusWallets: [{ currency: 'CNY', balance: '0' }, { currency: 'CNY', balance: '0.00' }],
  })
  assert.equal(zeroBonus.recharge, '¥26.15')
  assert.equal(zeroBonus.bonus, undefined)
})

test('readBalance degrades to panel states instead of throwing', async () => {
  assert.equal((await readBalance(undefined, 'zh-CN', '1.0.6')).state, 'unavailable')
  assert.equal((await readBalance({}, 'zh-CN', '1.0.6')).state, 'unavailable')
  assert.equal((await readBalance({ getBalance: async () => ({ ok: true, value: null }) }, 'zh-CN', '1.0.6')).state, 'signed-out')
  assert.equal((await readBalance({ getBalance: async () => ({ ok: false }) }, 'zh-CN', '1.0.6')).state, 'failed')
  assert.equal((await readBalance({ getBalance: async () => { throw new Error('host rejected') } }, 'zh-CN', '1.0.6')).state, 'failed')
  const ready = await readBalance({
    getBalance: async () => ({ ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: '5' }] } }),
  }, 'zh-CN', '1.0.6')
  assert.equal(ready.state, 'ready')
  assert.equal(ready.recharge, '¥5.00')
})

test('accountClientMetadata always carries a version and the east-positive offset', () => {
  assert.equal(accountClientMetadata('zh-CN', undefined).version, '1.0.6')
  assert.equal(accountClientMetadata('zh-CN', '').version, '1.0.6')
  assert.equal(accountClientMetadata('en', 'v9').version, 'v9')
  assert.equal(typeof accountClientMetadata('en', 'v9').timezoneOffsetSeconds, 'number')
  assert.equal(accountClientMetadata('en', 'v9').locale, 'en')
})
