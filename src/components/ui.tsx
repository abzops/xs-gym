import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { setTransition } from '../lib/motion';
import { project, rubberband, Spring, SPRING, VelocityTracker } from '../lib/spring';
import type { MembershipStatus } from '../lib/types';

/* ---------- Sheet ----------
   Phones: an iOS-style bottom sheet driven by springs. It tracks the finger
   1:1 from wherever it is grabbed (even mid-animation), rubber-bands when
   pulled up, and on release hands the finger's velocity to the spring,
   projecting the flick to decide between settling and dismissing.
   Wider screens and reduced motion: a centred dialog with a short fade. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [physical] = useState(() =>
    window.matchMedia('(max-width: 719px)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const spring = useRef<Spring | null>(null);
  const tracker = useRef(new VelocityTracker());
  const drag = useRef<{ start: number; base: number; moved: boolean } | null>(null);
  const done = useRef(false);
  const height = () => ref.current?.offsetHeight || 600;

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onClose();
  }, [onClose]);

  const close = useCallback((velocity = 0) => {
    if (physical && spring.current) {
      spring.current.to(height(), SPRING.sheet, { velocity, onRest: finish });
    } else {
      setClosing(true);
      setTimeout(finish, 180);
    }
  }, [physical, finish]);

  // Spring in from below before the first paint.
  useLayoutEffect(() => {
    if (!physical || !ref.current) return;
    const el = ref.current;
    const h = height();
    spring.current = new Spring(h, (y) => {
      el.style.transform = `translate3d(0, ${y}px, 0)`;
      if (backdrop.current) backdrop.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / h)));
    });
    spring.current.set(h);
    spring.current.to(0, SPRING.smooth);
    return () => spring.current?.stop();
  }, [physical]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    if (window.matchMedia('(pointer: fine)').matches) first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [close]);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!physical || !spring.current || e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
    spring.current.stop(); // grab it mid-flight
    drag.current = { start: e.clientY, base: spring.current.value, moved: false };
    tracker.current.reset();
    tracker.current.add(e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !spring.current) return;
    const dy = e.clientY - d.start;
    if (!d.moved && Math.abs(dy) < 6) return; // small hysteresis before committing
    d.moved = true;
    tracker.current.add(e.clientY);
    const y = d.base + dy;
    spring.current.set(y < 0 ? -rubberband(-y, height()) : y);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !spring.current) return;
    const v = d.moved ? tracker.current.velocity() : 0;
    const resting = spring.current.value + project(v);
    if (resting > height() * 0.45) close(v);
    else spring.current.to(0, Math.abs(v) > 300 ? SPRING.flick : SPRING.smooth, { velocity: v });
  };

  return (
    <div className={`overlay ${physical ? 'physical' : ''} ${closing ? 'closing' : ''}`}>
      <div className="backdrop" ref={backdrop} onClick={() => close()} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="handle" aria-hidden />
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="btn ghost icon-btn" onClick={() => close()} aria-label="Close" data-close>
              <X size={20} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Smoothly expands or collapses its content (used for optional form fields). */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`collapse ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'bad' ? 'bad' : ''}`}>
            {t.tone === 'bad' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------- Brand ---------- */
const BRAND = `${import.meta.env.BASE_URL}brand/`;

/**
 * Official Xelorsoft lockup. `onDark` always uses the Night artwork (for
 * Carbon panels); otherwise it follows the system theme.
 */
export function Logo({ width = 180, className = 'logo', onDark = false }: { width?: number; className?: string; onDark?: boolean }) {
  const height = Math.round((width * 496) / 1439);
  if (onDark) return <img className={className} src={`${BRAND}xelorsoft-on-dark.svg`} alt="Xelorsoft" width={width} height={height} />;
  return (
    <>
      <img className={`${className} only-light`} src={`${BRAND}xelorsoft-on-light.svg`} alt="Xelorsoft" width={width} height={height} />
      <img className={`${className} only-dark`} src={`${BRAND}xelorsoft-on-dark.svg`} alt="Xelorsoft" width={width} height={height} />
    </>
  );
}

/* ---------- Small pieces ---------- */
const STATUS: Record<MembershipStatus, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'ok' },
  grace: { label: 'Grace period', tone: 'warn' },
  expired: { label: 'Expired', tone: 'bad' },
  upcoming: { label: 'Starts soon', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  none: { label: 'No plan', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: MembershipStatus }) {
  const s = STATUS[status] ?? STATUS.none;
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 56 }} />
      ))}
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div className="segmented" role="group" aria-label={label} ref={wrap}>
      {thumb && <span className="thumb" aria-hidden style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Link that opens a detail screen with a push transition. */
export function PushLink(props: LinkProps) {
  return <Link viewTransition {...props} onClick={(e) => { setTransition('push'); props.onClick?.(e); }} />;
}

/** Link back to a parent screen with a pop transition. */
export function BackLink(props: LinkProps) {
  return <Link viewTransition {...props} onClick={(e) => { setTransition('pop'); props.onClick?.(e); }} />;
}
