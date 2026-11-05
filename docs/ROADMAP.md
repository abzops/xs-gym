# XS Gym — feature research and roadmap

Researched 5 Nov 2026 against Indian gym software (Easy Gym Software, myGymDesk,
GymManager, myBillBook) and gym KPI guides (Glofox, GymMaster, PushPress, ABC
Fitness). Goal: what a Kerala / Indian independent gym owner expects, and what
makes XS Gym feature-rich without getting heavy.

## Shipped in this round

| Feature | Why | Where |
|---|---|---|
| **Analytics** (replaces Reports) | Owners judge the business by revenue, profit, active members, churn, renewals and dues — not by a daily table | `src/features/analytics/`, `public.gym_analytics()` |
| KPIs: revenue (vs last month), profit, active members, revenue per member, collection rate, renewal rate (90 days), monthly churn, outstanding dues | Standard gym KPIs in every guide | Analytics → Overview |
| Charts: revenue vs expenses, profit, active members, joined vs lost, sales by plan, payment methods, expense categories, dues by age, enquiries, members by gender | Graphical view asked for by the owner | each has hover/tap tooltip + table view |
| **Signup onboarding** | New owners need plans, a first member and staff before the app is useful | `/g/:slug/welcome`, `public.complete_onboarding()` |
| Getting-started checklist on the dashboard | Ticks itself off from real data for the first 45 days | `GettingStarted.tsx` |
| **Enquiries (leads CRM)** | Indian gym software sells "enquiry management" as a core module: walk-ins and Instagram leads get forgotten | `/enquiries`, `public.enquiries`, `public.save_enquiry()` |
| **WhatsApp reminders** (renewal, expired, dues, enquiry, welcome; English + Malayalam) | WhatsApp is how Indian gyms talk to members; reminders drive renewals | `src/components/WhatsApp.tsx` (wa.me, nothing sent automatically) |
| XS AI: `get_analytics`, `add_enquiry`, open Analytics/Enquiries | Ask "how was last month?" or "save an enquiry for Rahul" by voice | `supabase/functions/xs-ai/agent.ts` |
| Check-in removed from the app | Not used by the owner | attendance table kept, read-only history |

## Next (recommended order)

1. **Membership freeze / pause** — member travels or is injured; extend the end date by the frozen days. Very common ask in India.
2. **GST invoices** — optional GSTIN on the gym, tax-inclusive split (CGST/SGST) on receipts, invoice numbering per financial year.
3. **Automatic WhatsApp reminders** — WhatsApp Business Cloud API (needs the owner's Meta business number and approved templates) to send renewal and dues reminders daily without a tap.
4. **UPI collection** — UPI QR / payment link on receipts and reminders (Razorpay or a static UPI ID first).
5. **Personal training packages** — sessions-based plans (e.g. 12 sessions), trainer assignment, trainer commission report.
6. **Member app / portal** — member sees plan, dues, receipts; renews online.
7. **Inventory / POS** — supplements, water, merchandise sold at the desk, stock levels.
8. **Multi-branch** — one owner, several gyms, combined analytics.
9. **Body measurements & progress** — weight, BMI, photos; trainers love it, owners use it for retention.
10. **Biometric / QR attendance** — only if the owner wants attendance back; needs hardware.

## Sources

- https://easygymsoftware.com/india
- https://easygymsoftware.com/gym-management-software
- https://www.g2.com/sellers/mygymdesk
- https://mdmsolutions.biz/products/gymmanager
- https://mybillbook.in/s/billing-software-for-retail-shop/gym-fitness-studio/
- https://www.glofox.com/blog/gym-management-software-reporting-for-owners/
- https://www.gymmaster.com/blog/metrics-every-gym-ower-should-track/
- https://www.pushpress.com/blog/gym-metrics-to-track
- https://ignite.abcfitness.com/guide/the-essential-gym-kpis-to-watch/
