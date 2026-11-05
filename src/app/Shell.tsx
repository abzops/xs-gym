import {
  BarChart3, ClipboardList, Home, LogOut, Menu, Receipt, ScanLine, Settings, Sparkles, Users, Wallet,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { AppearanceButton, AppearanceControl } from '../components/Appearance';
import { Logo, Notice, Sheet } from '../components/ui';
import { daysBetween, todayInGym } from '../lib/dates';
import { setTransition } from '../lib/motion';
import { pageModules, prefetchSection } from '../lib/sections';
import { supabase } from '../lib/supabase';
import { ROLE_LABEL } from '../lib/types';
import '../features/ai/entry.css';
import { useGym } from './gym';

const XsAiPanel = lazy(() => import('../features/ai/XsAi').then((m) => ({ default: m.XsAiPanel })));

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; perm: string };

const NAV: NavItem[] = [
  { to: '', label: 'Home', icon: Home, perm: 'reports.operational' },
  { to: 'check-in', label: 'Check in', icon: ScanLine, perm: 'attendance.checkin' },
  { to: 'members', label: 'Members', icon: Users, perm: 'members.read' },
  { to: 'payments', label: 'Payments', icon: Wallet, perm: 'payments.read' },
  { to: 'plans', label: 'Plans', icon: ClipboardList, perm: 'plans.read' },
  { to: 'expenses', label: 'Expenses', icon: Receipt, perm: 'expenses.read' },
  { to: 'reports', label: 'Reports', icon: BarChart3, perm: 'reports.financial' },
  { to: 'settings', label: 'Settings', icon: Settings, perm: 'staff.read' },
];

// Transparent badge: black on light backgrounds, white on dark (brand rule).
const mark = `${import.meta.env.BASE_URL}brand/badge-black.svg`;
const markOnDark = `${import.meta.env.BASE_URL}brand/badge-white.svg`;

export function Shell() {
  const { gym, role, can, canWrite, subscription } = useGym();
  const [more, setMore] = useState(false);
  const [ai, setAi] = useState(false);
  const location = useLocation();
  const items = NAV.filter((n) => can(n.perm));
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const base = `/g/${gym.slug}`;
  const link = (n: NavItem) => (n.to ? `${base}/${n.to}` : base);
  const onOverflowRoute = overflow.some((n) => location.pathname.startsWith(link(n)));
  const trialDays = subscription?.status === 'trial' && subscription.trial_ends_at
    ? Math.max(0, daysBetween(todayInGym(gym.timezone), subscription.trial_ends_at.slice(0, 10)))
    : null;
  const tab = () => setTransition('tab');

  // Make every section open instantly: once the app is idle, fetch the code and
  // first data of each section this role can open; repeat on touch/hover.
  const qc = useQueryClient();
  const warm = (n: NavItem) => { void prefetchSection(qc, gym, n.to); };
  useEffect(() => {
    let cancelled = false;
    const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 900));
    idle(async () => {
      for (const load of Object.values(pageModules)) { if (cancelled) return; await load().catch(() => {}); }
      for (const n of items) { if (cancelled) return; await prefetchSection(qc, gym, n.to)?.catch(() => {}); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gym.id]);
  const warmProps = (n: NavItem) => ({ onPointerEnter: () => warm(n), onPointerDown: () => warm(n), onFocus: () => warm(n) });

  // Liquid Glass tab bar: an indicator glides to the active tab.
  const tabbar = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const active = tabbar.current?.querySelector<HTMLElement>('a.active, button.active');
      const ind = indicator.current;
      if (!ind) return;
      if (!active) { ind.style.opacity = '0'; return; }
      ind.style.opacity = '1';
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.transform = `translateX(${active.offsetLeft}px)`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [location.pathname, more]);

  return (
    <div className="shell">
      {/* Laptop and tablet landscape: full sidebar. Tablet portrait: icon rail. */}
      <nav className="sidebar" aria-label="Main">
        <Logo onDark width={148} className="logo full" />
        <img className="rail-mark" src={markOnDark} alt="Xelorsoft" width={36} height={36} />
        <div className="gym-block">
          <strong>{gym.name}</strong>
          <span>{ROLE_LABEL[role]}</span>
          {trialDays !== null && <span>Trial ends in {trialDays} day{trialDays === 1 ? '' : 's'}</span>}
        </div>
        {items.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to} onClick={tab} title={n.label} {...warmProps(n)}>
            <n.icon size={20} strokeWidth={1.9} /> <span className="nav-label">{n.label}</span>
          </NavLink>
        ))}
        <div className="grow" />
        <button className="signout xsai-side" onClick={() => setAi(true)} title="XS AI" onPointerEnter={() => void import('../features/ai/XsAi')}>
          <span className="xsai-mark" aria-hidden><Sparkles size={13} strokeWidth={2.4} /></span> <span className="nav-label">XS AI</span>
        </button>
        <AppearanceButton className="signout" />
        <button className="signout" onClick={() => supabase.auth.signOut()} title="Sign out">
          <LogOut size={20} strokeWidth={1.9} /> <span className="nav-label">Sign out</span>
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <img className="brand-mark only-light" src={mark} alt="" width={26} height={26} />
          <img className="brand-mark only-dark" src={markOnDark} alt="" width={26} height={26} />
          <span className="gym">{gym.name}</span>
          <button className="xsai-entry" onClick={() => setAi(true)} aria-label="XS AI" onPointerDown={() => void import('../features/ai/XsAi')}>
            <Sparkles size={17} strokeWidth={2.2} />
          </button>
        </header>
        <main className="main">
          {!canWrite && (
            <div style={{ marginBottom: 20 }}>
              <Notice tone="warn">Subscription ended. You can view and export, but changes are paused.</Notice>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Phone: iOS-style tab bar */}
      <nav className="tabbar" aria-label="Main" ref={tabbar}>
        <span className="tab-indicator" ref={indicator} aria-hidden />
        {primary.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to} onClick={tab} {...warmProps(n)}>
            <n.icon size={23} strokeWidth={1.8} /> <span>{n.label}</span>
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} onPointerDown={() => overflow.forEach(warm)} className={onOverflowRoute || more ? 'active' : ''} aria-haspopup="dialog">
          <Menu size={23} strokeWidth={1.8} /> <span>More</span>
        </button>
      </nav>

      {ai && <Suspense fallback={null}><XsAiPanel onClose={() => setAi(false)} /></Suspense>}

      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div className="appearance-row">
            <span>Appearance</span>
            <AppearanceControl />
          </div>
          <ul className="list grouped">
            {overflow.map((n) => (
              <li key={n.label}>
                <NavLink className="item" to={link(n)} onClick={() => { tab(); setMore(false); }} {...warmProps(n)}>
                  <n.icon size={20} /> <span className="main-col"><span className="title">{n.label}</span></span>
                </NavLink>
              </li>
            ))}
            <li>
              <button className="item" onClick={() => supabase.auth.signOut()}>
                <LogOut size={20} /> <span className="main-col"><span className="title">Sign out</span></span>
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}
