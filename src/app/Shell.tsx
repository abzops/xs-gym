import {
  BarChart3, ClipboardList, Home, LogOut, Menu, Receipt, ScanLine, Settings, Users, Wallet,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Logo, Notice, Sheet } from '../components/ui';
import { daysBetween, todayInGym } from '../lib/dates';
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

const mark = `${import.meta.env.BASE_URL}brand/icon-192.png`;

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

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Logo onDark width={148} />
        <div className="gym-block">
          <strong>{gym.name}</strong>
          <span>{ROLE_LABEL[role]}</span>
        </div>
        {items.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to}>
            <n.icon size={19} strokeWidth={1.9} /> {n.label}
          </NavLink>
        ))}
        <div className="grow" />
        <button className="signout" onClick={() => supabase.auth.signOut()}>
          <LogOut size={19} strokeWidth={1.9} /> Sign out
        </button>
      </nav>

      <div>
        <header className="topbar">
          <img className="brand-mark" src={mark} alt="" width={28} height={28} />
          <span className="gym">{gym.name}</span>
          <span className="spacer" />
          {trialDays !== null && <span className="chip">Trial: {trialDays} day{trialDays === 1 ? '' : 's'} left</span>}
        </header>
        <main className="main">
          {!canWrite && (
            <div style={{ marginBottom: 20 }}>
              <Notice tone="warn">
                This gym's subscription has ended. Everything stays available to view and export; changes are paused until it is renewed.
              </Notice>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="bottomnav" aria-label="Main">
        {primary.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to}>
            <span className="ico"><n.icon size={20} strokeWidth={1.9} /></span> {n.label}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={onOverflowRoute ? 'active' : ''} aria-haspopup="dialog">
          <span className="ico"><Menu size={20} strokeWidth={1.9} /></span> More
        </button>
      </nav>

      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <ul className="list card flush">
            {overflow.map((n) => (
              <li key={n.label}>
                <NavLink className="item" to={link(n)} onClick={() => setMore(false)}>
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
