import { describe, expect, it } from 'vitest';
import { formatINR, paiseToInput, parseINR } from './money';

describe('formatINR', () => {
  it.each([
    [0, '₹0'],
    [100, '₹1'],
    [150, '₹1.50'],
    [100000, '₹1,000'],
    [12345678, '₹1,23,456.78'],
    [100000000, '₹10,00,000'],
    [-25000, '−₹250'],
  ])('%i paise → %s', (paise, text) => {
    expect(formatINR(paise)).toBe(text);
  });

  it('can show zero paise', () => {
    expect(formatINR(100000, { showZeroPaise: true })).toBe('₹1,000.00');
  });
});

describe('parseINR', () => {
  it.each([
    ['1000', 100000],
    ['1,000', 100000],
    ['₹ 1,500.5', 150050],
    ['0.01', 1],
    ['999.99', 99999],
    ['Rs. 250', 25000],
  ])('%s → %i paise', (text, paise) => {
    expect(parseINR(text)).toBe(paise);
  });

  it.each(['', '0', '-5', 'abc', '1.234', '1e3', '10000001', '12.3.4'])('rejects %s', (text) => {
    expect(parseINR(text)).toBeNull();
  });

  it('round-trips every amount without drift', () => {
    for (let paise = 1; paise <= 20000; paise += 7) {
      expect(parseINR(paiseToInput(paise))).toBe(paise);
    }
  });
});
