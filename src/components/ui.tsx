import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MembershipStatus } from '../lib/types';

/* ---------- Sheet: bottom sheet on phones, centred dialog on wider screens ---------- */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close" data-close>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
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
    <picture>
      <source srcSet={`${BRAND}xelorsoft-on-dark.svg`} media="(prefers-color-scheme: dark)" />
      <img className={className} src={`${BRAND}xelorsoft-on-light.svg`} alt="Xelorsoft" width={width} height={height} />
    </picture>
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
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
