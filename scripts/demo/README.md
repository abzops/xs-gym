# Demo account scripts

For pitching and live demos. Run in the Supabase SQL editor for project `xs-gym`.

| Script | What it does |
|---|---|
| `seed_rich_demo.sql` | **Used for the live demo.** "XS Fitness Studio": 76 members with ~10 months of history (renewals, lapsed members, new joiners), payments by UPI/cash/card on their real dates, dues, discounts, reversals, six weeks of check-ins, six months of expenses, and this morning's walk-ins. Every allocation reconciles. Run on an empty project after the owner account exists. |
| `seed_demo_gym.sql` | Creates "XS Demo Gym" owned by the account in `v_email`: 5 plans, 12 members in different payment states, today's check-ins and expenses. Uses the real command functions, so dues, receipts and reports are consistent. Skips if that account already owns a gym. |
| `reset_demo_login.sql` | Sets a new password for an account and marks its email confirmed. Existing passwords cannot be read back; this only resets. |

## Steps

1. Sign up once at <https://abzops.github.io/xs-gym/login?mode=signup> with the demo email
   (for example `demo@xsgym.in`), or create the user in Supabase → Authentication → Users → Add user.
2. Put that email in `v_email` in `seed_demo_gym.sql` and run it.
3. Sign in with that email and password.

Never commit a real password into these files.
