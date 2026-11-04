import { ScanLine } from 'lucide-react';
import { Link } from 'react-router';
import { Logo } from '../../components/ui';

const checkins = [
  { name: 'Rahul Krishnan', no: 'XS-0142', time: '6:42 am' },
  { name: 'Anjali Menon', no: 'XS-0087', time: '6:38 am' },
  { name: 'Mohammed Shafi', no: 'XS-0203', time: '6:31 am' },
];

/** Public page for signed-out visitors. Signed-in staff go straight to their gym. */
export function LandingPage() {
  return (
    <div className="landing">
      <section className="hero">
        <nav className="hero-nav" aria-label="Site">
          <Logo onDark width={150} />
          <div className="row">
            <Link className="btn ghost on-dark" to="/login">Sign in</Link>
            <Link className="btn primary on-dark hide-phone" to="/login?mode=signup">Start free trial</Link>
          </div>
        </nav>

        <div className="hero-body">
          <div className="hero-copy">
            <h1>Run your gym simply. Know your numbers accurately.</h1>
            <p>Members, renewals, check-ins and payments in one app for the front desk and the owner.</p>
            <div className="row">
              <Link className="btn primary on-dark" to="/login?mode=signup">Start 30-day free trial</Link>
              <Link className="btn on-dark" to="/login">Sign in</Link>
            </div>
          </div>

          <div className="device" aria-label="XS Gym on a phone">
            <div className="device-screen">
              <div className="mini-today">
                <strong>Thursday, 5 November</strong>
                <span className="mini-lead">₹18,500</span>
                <span className="mini-cap">Collected today</span>
                <div className="mini-figures">
                  <span><b>47</b>Check-ins</span>
                  <span><b>128</b>Active</span>
                  <span><b>2</b>Expire today</span>
                </div>
                <span className="mini-btn"><ScanLine size={14} /> Check in</span>
              </div>
              <div className="mini-list">
                {checkins.map((c) => (
                  <div key={c.no} className="mini-row">
                    <span className="mini-avatar">{c.name.split(' ').map((p) => p[0]).join('')}</span>
                    <span className="mini-name">{c.name}<small>{c.no}</small></span>
                    <span className="mini-time">{c.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="points">
        <div>
          <h2>Check in at the desk in seconds</h2>
          <p>Find a member by name, phone or number and tap once.</p>
        </div>
        <div>
          <h2>Payments that always add up</h2>
          <p>Dues, receipts and reversals reconcile to the paisa.</p>
        </div>
        <div>
          <h2>Every staff member signs in</h2>
          <p>Roles decide who can discount, reverse or export.</p>
        </div>
      </section>

      <section className="closing">
        <h2>Phone, tablet or laptop.</h2>
        <Link className="btn primary" to="/login?mode=signup">Start free trial</Link>
      </section>

      <footer className="site-foot">
        <Logo width={120} />
        <span>© 2026 Xelorsoft</span>
      </footer>
    </div>
  );
}
