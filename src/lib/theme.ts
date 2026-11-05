import { useSyncExternalStore } from 'react';

/**
 * Appearance: follow the device, or force light / dark.
 * The choice is stored per browser; `public/theme.js` applies it before
 * first paint so there is no flash, and this module keeps it in sync.
 */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'xs-theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref: ThemePref = read();

export function resolve(p: ThemePref): 'light' | 'dark' {
  return p === 'system' ? (media?.matches ? 'dark' : 'light') : p;
}

function apply() {
  const t = resolve(pref);
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.content = t === 'dark' ? '#000000' : '#F6F6F4';
  });
}

export function setTheme(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch { /* private mode: still applies for this visit */ }
  // Switch in one frame, like iOS: no per-element colour fades.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  apply();
  void root.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  listeners.forEach((l) => l());
}

media?.addEventListener('change', () => {
  if (pref !== 'system') return;
  apply();
  listeners.forEach((l) => l());
});

if (typeof document !== 'undefined') apply();

export function useTheme() {
  const value = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => pref,
  );
  return [value, setTheme] as const;
}
