// Money is always an integer number of paise. Never use floating point for
// arithmetic; parsing and formatting work on digit strings.

const MAX_PAISE = 100_000_000; // ₹10,00,000 — matches the database limit

/** Groups digits the Indian way: 12,34,567. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** 123450 → "₹1,234.50"; 100000 → "₹1,000". */
export function formatINR(paise: number | null | undefined, { showZeroPaise = false } = {}): string {
  const value = Number(paise ?? 0);
  if (!Number.isSafeInteger(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const p = abs % 100;
  const fraction = p !== 0 || showZeroPaise ? '.' + String(p).padStart(2, '0') : '';
  return `${sign}₹${rupees}${fraction}`;
}

/**
 * Parses what a person types ("1,500", "₹ 1500.5", "1500.50") into paise.
 * Returns null for anything that is not a positive amount within limits.
 */
export function parseINR(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_PAISE) return null;
  return paise;
}

/** Paise → plain editable string without symbol or grouping: 150050 → "1500.50". */
export function paiseToInput(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, '0')}`;
}
