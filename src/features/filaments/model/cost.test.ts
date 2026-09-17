import assert from 'node:assert/strict'
import { test } from 'vitest'
import { costOf, formatMoney, lineOfKey } from './cost.ts'

const price = (line: string, pricePerKg: number, currency = 'EUR') => ({ line, pricePerKg, currency })

test('a key names its line', () => {
  assert.equal(lineOfKey('bambu-lab/pla/basic/jade-white-10100'), 'bambu-lab/pla/basic')
})

test('priced grams become money and unpriced grams are kept apart', () => {
  const total = costOf(
    [
      { key: 'bambu-lab/pla/basic/jade-white-10100', grams: 500 },
      { key: 'bambu-lab/petg/basic/black-20100', grams: 250 },
    ],
    [price('bambu-lab/pla/basic', 20)])
  assert.equal(total.amount, 10)
  assert.equal(total.currency, 'EUR')
  assert.equal(total.pricedGrams, 500)
  assert.equal(total.unpricedGrams, 250)
})

test('nothing priced is no total rather than zero', () => {
  const total = costOf([{ key: 'bambu-lab/pla/basic/jade-white-10100', grams: 500 }], [])
  assert.equal(total.amount, null)
  assert.equal(total.unpricedGrams, 500)
})

test('two currencies are reported as mixed rather than summed into a fiction', () => {
  const total = costOf(
    [
      { key: 'bambu-lab/pla/basic/jade-white-10100', grams: 1000 },
      { key: 'bambu-lab/petg/basic/black-20100', grams: 1000 },
    ],
    [price('bambu-lab/pla/basic', 20, 'EUR'), price('bambu-lab/petg/basic', 25, 'USD')])
  assert.equal(total.mixedCurrencies, true)
  assert.equal(total.amount, null)
})

test('money is written in the currency it was priced in', () => {
  assert.match(formatMoney(12.5, 'EUR'), /12[.,]50/)
})
