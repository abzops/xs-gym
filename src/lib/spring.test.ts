import { describe, expect, it } from 'vitest';
import { project, rubberband, SPRING, stepSpring, VelocityTracker, type SpringParams } from './spring';

function run(target: number, p: SpringParams, from = 0, velocity = 0, seconds = 2) {
  let s = { value: from, velocity };
  let max = -Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    s = stepSpring(s, target, p, 1 / 60);
    max = Math.max(max, s.value);
  }
  return { end: s.value, max };
}

describe('spring', () => {
  it('critically damped settles on target without overshoot', () => {
    const r = run(100, SPRING.smooth);
    expect(r.end).toBeCloseTo(100, 1);
    expect(r.max).toBeLessThanOrEqual(100.5);
  });

  it('under-damped spring overshoots a little, then settles', () => {
    const r = run(100, SPRING.flick);
    expect(r.max).toBeGreaterThan(100.5); // ~1.5% theoretical peak for damping 0.8
    expect(r.end).toBeCloseTo(100, 0);
  });

  it('keeps moving in the direction of an initial flick before returning', () => {
    let s = { value: 0, velocity: 2000 };
    s = stepSpring(s, 0, SPRING.flick, 1 / 60);
    expect(s.value).toBeGreaterThan(0);
  });

  it('smaller response reaches the target sooner', () => {
    const fast = run(100, { response: 0.2, damping: 1 }, 0, 0, 0.2).end;
    const slow = run(100, { response: 0.6, damping: 1 }, 0, 0, 0.2).end;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('gesture helpers', () => {
  it('rubberband resists progressively and never exceeds the input', () => {
    const a = rubberband(50, 600), b = rubberband(200, 600), c = rubberband(800, 600);
    expect(a).toBeLessThan(50);
    expect(b - a).toBeLessThan(150);
    expect(c).toBeLessThan(600 * 0.55 + 1);
  });

  it('projects a flick forward and a still finger nowhere', () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(0)).toBe(0);
  });

  it('measures release velocity from recent samples', () => {
    const v = new VelocityTracker();
    v.add(0, 0); v.add(10, 16); v.add(20, 32);
    expect(v.velocity()).toBeCloseTo(625, 0);
  });
});
