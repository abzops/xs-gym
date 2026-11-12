import { Sparkles } from 'lucide-react';
import {
  useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampFloat, decodeFloat, dockFloat, encodeFloat, type FloatPoint, type FloatViewport,
} from './floatingGeometry';

const positionKey = (gymId: string) => 'xs-ai-floating:' + gymId;
const viewport = (): FloatViewport => ({
  width: window.innerWidth,
  height: window.innerHeight,
  compact: window.matchMedia('(max-width: 719px)').matches,
});
const load = (gymId: string) => {
  try { return decodeFloat(window.localStorage.getItem(positionKey(gymId)), viewport()); }
  catch { return decodeFloat(null, viewport()); }
};
const save = (gymId: string, point: FloatPoint) => {
  try { window.localStorage.setItem(positionKey(gymId), encodeFloat(point, viewport())); }
  catch { /* private-mode storage can be unavailable */ }
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: FloatPoint;
  moved: boolean;
};

/** One shared launcher across all gym routes. Tap opens XS AI; drag relocates.
 * Never captures audio. The dedicated microphone lives inside the AI chat. */
export function FloatingXsAi({ gymId, onOpen }: { gymId: string; onOpen: () => void }) {
  const [point, setPoint] = useState<FloatPoint>(() => load(gymId));
  const [dragging, setDragging] = useState(false);
  const pointRef = useRef(point);
  pointRef.current = point;
  const gesture = useRef<Gesture | null>(null);

  function place(next: FloatPoint) {
    pointRef.current = next;
    setPoint(next);
  }
  useEffect(() => {
    const sync = () => {
      if (gesture.current) return;
      place(load(gymId));
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, [gymId]);

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (gesture.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); // iOS text selection, callout and ghost tap prevention
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      origin: pointRef.current, moved: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* native capture */ }
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 9) return; // distinguish a tap from a drag
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
    }
    event.preventDefault();
    place(clampFloat({ x: g.origin.x + dx, y: g.origin.y + dy }, viewport()));
  }
  function finish(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    event.preventDefault();
    if (cancelled) {
      place(g.origin);
    } else if (g.moved) {
      const docked = dockFloat(pointRef.current, viewport());
      place(docked);
      save(gymId, docked);
    } else {
      onOpen();
    }
  }
  function lost(event: ReactPointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId === event.pointerId) finish(event, true);
  }
  function keyboardMove(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const offset: Record<string, [number, number]> = {
      ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24],
    };
    const delta = offset[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = clampFloat({ x: pointRef.current.x + delta[0], y: pointRef.current.y + delta[1] }, viewport());
    place(next);
    save(gymId, next);
  }
  return (
    <button
      type="button"
      className={'xsai-floating-launcher' + (dragging ? ' is-dragging' : '')}
      style={{ left: point.x, top: point.y }}
      aria-label="Open XS AI"
      title="Open XS AI — drag to move"
      onPointerDown={down} onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={lost}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        // Physical taps are handled at pointerup. Keyboard/AT clicks have detail=0.
        if (event.detail === 0) onOpen();
        else event.preventDefault();
      }}
      onKeyDown={keyboardMove}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}>
      <span className="xsai-floating-glow" aria-hidden="true" />
      <Sparkles size={25} strokeWidth={1.8} aria-hidden="true" />
      <span className="xsai-floating-ai" aria-hidden="true">AI</span>
    </button>
  );
}
