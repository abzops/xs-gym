import { describe, expect, it } from 'vitest';
import { clampFloat, decodeFloat, defaultFloat, dockFloat, encodeFloat, floatBounds } from './floatingGeometry';

const phone = { width: 390, height: 844, compact: true };
const desktop = { width: 1440, height: 900, compact: false };

describe('XS AI draggable launcher screen bounds', () => {
  it('starts above the iPhone bottom navigation, not on top of it', () => {
    const p = defaultFloat(phone);
    expect(p.x).toBe(318);
    expect(p.y).toBe(658);
    expect(p.y + 60).toBeLessThan(740);
  });
  it('snap-docks to the nearest edge without changing vertical position', () => {
    expect(dockFloat({ x: 55, y: 260 }, phone)).toEqual({ x: 12, y: 260 });
    expect(dockFloat({ x: 320, y: 260 }, phone)).toEqual({ x: 318, y: 260 });
  });
  it('keeps dragged elements within viewport bounds on tiny phones', () => {
    const tiny = { width: 300, height: 450, compact: true };
    const bound = floatBounds(tiny);
    expect(clampFloat({ x: -500, y: 800 }, tiny)).toEqual({ x: bound.minX, y: bound.maxY });
    expect(bound.maxY + 60).toBeLessThanOrEqual(450);
  });
  it('retains a useful normalized location after rotation or desktop resize', () => {
    const saved = encodeFloat({ x: 12, y: 260 }, phone);
    const rotated = { width: 844, height: 390, compact: false };
    const position = decodeFloat(saved, rotated);
    expect(position.x).toBe(12);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.y + 60).toBeLessThanOrEqual(390);
    expect(decodeFloat(encodeFloat(defaultFloat(desktop), desktop), phone).x).toBe(318);
  });
  it('ignores corrupt, non-finite, or out-of-range persistence', () => {
    expect(decodeFloat('broken', phone)).toEqual(defaultFloat(phone));
    expect(decodeFloat('{"x":"0.5","y":1}', phone)).toEqual(defaultFloat(phone));
    expect(decodeFloat('{"x":-4,"y":50}', phone)).toEqual(clampFloat({ x: 12, y: 658 }, phone));
  });
});
