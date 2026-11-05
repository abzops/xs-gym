import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '../lib/theme';
import { Segmented } from './ui';

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const NAME: Record<ThemePref, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

/** Auto / Light / Dark switch, for sheets and settings. */
export function AppearanceControl() {
  const [theme, setTheme] = useTheme();
  return <Segmented label="Appearance" value={theme} options={OPTIONS} onChange={setTheme} />;
}

/** Sidebar button: one tap cycles Auto → Light → Dark. */
export function AppearanceButton({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <button
      type="button"
      className={className}
      onClick={() => setTheme(NEXT[theme])}
      title={`Appearance: ${NAME[theme]}`}
      aria-label={`Appearance: ${NAME[theme]}. Change`}
    >
      <Icon size={20} strokeWidth={1.9} /> <span className="nav-label">Appearance<span className="nav-value">{NAME[theme]}</span></span>
    </button>
  );
}
