import {
  BarChart3, ClipboardList, Home, LogOut, Menu, Receipt, ScanLine, Settings, Users, Wallet,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Logo, Notice, Sheet } from '../components/ui';
import { daysBetween, todayInGym } from '../lib/dates';
import { setTransition } from '../lib/motion';
import { supabase } from '../lib/supabase';
import { ROLE_LABEL } from '../lib/types';
import { useGym } from './gym';

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
const mark = `${import.meta.env.BASE_URL}brand/favicon.svg`;
const markOnDark = `${import.meta.env.BASE_URL}brand/badge-white.svg`;

export function Shell() {
  const { gym, role, can, canWrite, subscription } = useGym();
  const [more, setMore] = useState(false);
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
          <NavLink key={n.label} to={link(n)} end={!n.to} viewTransition onClick={tab} title={n.label}>
            <n.icon size={20} strokeWidth={1.9} /> <span className="nav-label">{n.label}</span>
          </NavLink>
        ))}
        <div className="grow" />
        <button className="signout" onClick={() => supabase.auth.signOut()} title="Sign out">
          <LogOut size={20} strokeWidth={1.9} /> <span className="nav-label">Sign out</span>
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <img className="brand-mark" src={mark} alt="" width={26} height={26} />
          <span className="gym">{gym.name}</span>
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
          <NavLink key={n.label} to={link(n)} end={!n.to} viewTransition onClick={tab}>
            <n.icon size={23} strokeWidth={1.8} /> <span>{n.label}</span>
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={onOverflowRoute || more ? 'active' : ''} aria-haspopup="dialog">
          <Menu size={23} strokeWidth={1.8} /> <span>More</span>
        </button>
      </nav>

      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <ul className="list grouped">
            {overflow.map((n) => (
              <li key={n.label}>
                <NavLink className="item" to={link(n)} viewTransition onClick={() => { tab(); setMore(false); }}>
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
