import { describe, expect, it } from 'vitest';
import { csvAmount, toCSV } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCSV(['a', 'b'], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""');
  });
  it('neutralises formula injection', () => {
    expect(toCSV(['n'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@sum']])).toBe('n\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@sum');
  });
  it('formats paise for spreadsheets', () => {
    expect(csvAmount(123450)).toBe('1234.50');
    expect(csvAmount(5)).toBe('0.05');
  });
});
