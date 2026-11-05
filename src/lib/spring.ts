// Apple-style springs for gesture-driven motion (WWDC 2018 "Designing Fluid
// Interfaces"). Parameters are Apple's designer-facing pair:
//   response — roughly how quickly the value reaches the target (seconds)
//   damping  — 1 = critically damped (no overshoot); < 1 overshoots
// A spring has no fixed duration and is always interruptible: retargeting
// starts from the current on-screen value and keeps the current velocity.

export type SpringParams = { response: number; damping: number };

/** Defaults: critically damped for UI; slight bounce only after a flick. */
export const SPRING = {
  smooth: { response: 0.4, damping: 1 },
  sheet: { response: 0.32, damping: 1 },
  flick: { response: 0.3, damping: 0.8 },
} satisfies Record<string, SpringParams>;

export type SpringState = { value: number; velocity: number };

/** Advances a damped spring by dt seconds (semi-implicit Euler, small sub-steps). */
export function stepSpring(s: SpringState, target: number, p: SpringParams, dt: number): SpringState {
  const k = Math.pow((2 * Math.PI) / p.response, 2); // stiffness, mass = 1
  const c = (4 * Math.PI * p.damping) / p.response; // damping coefficient
  let { value, velocity } = s;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const force = -k * (value - target) - c * velocity;
    velocity += force * h;
    value += velocity * h;
  }
  return { value, velocity };
}

/** Where a flick would come to rest, using Apple's deceleration model. */
export function project(velocityPxPerS: number, decelerationRate = 0.998) {
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary: the further, the less it follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** A running spring on one number, driven by requestAnimationFrame. */
export class Spring {
  value: number;
  velocity = 0;
  private raf = 0;
  private last = 0;
  private onUpdate: (v: number) => void;
  constructor(initial: number, onUpdate: (v: number) => void) {
    this.value = initial;
    this.onUpdate = onUpdate;
  }

  /** Animate to target from the current value and velocity. */
  to(target: number, params: SpringParams, opts: { velocity?: number; onRest?: () => void } = {}) {
    this.stop();
    if (opts.velocity !== undefined) this.velocity = opts.velocity;
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.064, (now - this.last) / 1000);
      this.last = now;
      const next = stepSpring({ value: this.value, velocity: this.velocity }, target, params, dt);
      this.value = next.value;
      this.velocity = next.velocity;
      if (Math.abs(this.value - target) < 0.3 && Math.abs(this.velocity) < 8) {
        this.value = target;
        this.velocity = 0;
        this.onUpdate(target);
        this.raf = 0;
        opts.onRest?.();
        return;
      }
      this.onUpdate(this.value);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Jump straight to a value (e.g. while a finger is dragging). */
  set(value: number) {
    this.stop();
    this.value = value;
    this.onUpdate(value);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** Tracks recent pointer positions to measure release velocity in px/s. */
export class VelocityTracker {
  private samples: { t: number; y: number }[] = [];
  add(y: number, t = performance.now()) {
    this.samples.push({ t, y });
    const cutoff = t - 100;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }
  velocity() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.y - a.y) / dt : 0;
  }
  reset() { this.samples = []; }
}
