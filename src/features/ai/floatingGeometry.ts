/** Screen-safe placement for the persistent XS AI floating launcher.
 * All values are CSS pixels. Stored coordinates are normalized so device
 * rotation and tablet/phone switches never strand the button off-screen. */
export const FLOAT_DIAMETER = 60;
export type FloatPoint = { x: number; y: number };
export type FloatViewport = { width: number; height: number; compact: boolean };
export type FloatBounds = { minX: number; maxX: number; minY: number; maxY: number };

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;
const between = (value: number, lower: number, upper: number) =>
  Math.min(upper, Math.max(lower, finite(value, lower)));

export function floatBounds(view: FloatViewport): FloatBounds {
  const width = Math.max(0, finite(view.width, 390));
  const height = Math.max(0, finite(view.height, 844));
  const minX = Math.min(12, Math.max(0, width - FLOAT_DIAMETER));
  const maxX = Math.max(minX, width - FLOAT_DIAMETER - 12);
  const minY = Math.min(70, Math.max(0, height - FLOAT_DIAMETER - 12));
  // On phones, float above the navigation capsule and the iOS home indicator.
  const maxY = Math.max(minY, height - FLOAT_DIAMETER - (view.compact ? 126 : 24));
  return { minX, maxX, minY, maxY };
}
export function clampFloat(point: FloatPoint, view: FloatViewport): FloatPoint {
  const bounds = floatBounds(view);
  return {
    x: between(point.x, bounds.minX, bounds.maxX),
    y: between(point.y, bounds.minY, bounds.maxY),
  };
}
export function dockFloat(point: FloatPoint, view: FloatViewport): FloatPoint {
  const bounds = floatBounds(view);
  const clamped = clampFloat(point, view);
  return { x: clamped.x < (bounds.minX + bounds.maxX) / 2 ? bounds.minX : bounds.maxX, y: clamped.y };
}
export function defaultFloat(view: FloatViewport): FloatPoint {
  const bounds = floatBounds(view);
  return { x: bounds.maxX, y: bounds.maxY };
}
export function encodeFloat(point: FloatPoint, view: FloatViewport): string {
  const b = floatBounds(view);
  const clamped = clampFloat(point, view);
  const x = b.maxX === b.minX ? 1 : (clamped.x - b.minX) / (b.maxX - b.minX);
  const y = b.maxY === b.minY ? 1 : (clamped.y - b.minY) / (b.maxY - b.minY);
  return JSON.stringify({ x, y });
}
export function decodeFloat(raw: string | null, view: FloatViewport): FloatPoint {
  if (!raw) return defaultFloat(view);
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !('x' in p) || !('y' in p)) return defaultFloat(view);
    const v = p as { x: unknown; y: unknown };
    if (typeof v.x !== 'number' || typeof v.y !== 'number' ||
      !Number.isFinite(v.x) || !Number.isFinite(v.y)) return defaultFloat(view);
    const b = floatBounds(view);
    return clampFloat({
      x: b.minX + between(v.x, 0, 1) * (b.maxX - b.minX),
      y: b.minY + between(v.y, 0, 1) * (b.maxY - b.minY),
    }, view);
  } catch { return defaultFloat(view); }
}
