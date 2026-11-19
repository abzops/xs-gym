// Printable invoice or receipt for one XS Gym subscription payment.
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router';
import { useGym } from '../../app/gym';
import { BackLink, Empty, Loading, Notice } from '../../components/ui';
import { loadInvoice } from '../../lib/billingApi';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import './billing.css';

const day = (iso: string | null | undefined) => (iso ? formatDate(iso.slice(0, 10)) : '');

export function InvoicePage() {
  const { gym } = useGym();
  const { invoiceId } = useParams();
  const inv = useQuery({ queryKey: ['saas-invoice', invoiceId], queryFn: () => loadInvoice(invoiceId!), enabled: !!invoiceId });
  if (inv.isPending) return <Loading rows={6} />;
  if (inv.error) return <Notice tone="bad">{errorMessage(inv.error)}</Notice>;
  const i = inv.data;
  if (!i) return <Empty title="Invoice not found" />;
  const tax = i.doc_type === 'tax_invoice';
  const rate = i.gst_rate_bp / 100;
  return (
    <div className="stack lg">
      <div className="page-head no-print">
        <BackLink to={`/g/${gym.slug}/billing`}>Subscription</BackLink>
        <button className="btn" onClick={() => window.print()}><Printer size={16} /> Print or save PDF</button>
      </div>
      <article className="invoice" aria-label={tax ? 'Tax invoice' : 'Payment receipt'}>
        <div className="inv-head">
          <div>
            <h1>{tax ? 'Tax invoice' : 'Payment receipt'}</h1>
            <div>No. <b>{i.number}</b></div>
            <div>Date {day(i.issued_at)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {i.mode === 'test' && <div className="test-stamp">TEST — NOT A REAL PAYMENT</div>}
            <div style={{ marginTop: 6 }}><b>{i.status === 'paid' ? 'PAID' : i.status === 'refunded' ? 'REFUNDED' : 'PARTLY REFUNDED'}</b></div>
          </div>
        </div>
        <div className="parties">
          <div>
            <b>From</b>
            {i.supplier.name}<br />
            {i.supplier.address && <>{i.supplier.address}<br /></>}
            {i.supplier.gstin && <>GSTIN {i.supplier.gstin}<br /></>}
            {i.supplier.email}
          </div>
          <div>
            <b>Billed to</b>
            {i.customer.name}<br />
            {i.customer.address && <>{i.customer.address}<br /></>}
            {i.customer.gstin && <>GSTIN {i.customer.gstin}<br /></>}
            {i.customer.phone}{i.customer.email ? ` · ${i.customer.email}` : ''}
          </div>
        </div>
        <table>
          <thead><tr><th>Description</th><th>Period</th><th className="n">Amount</th></tr></thead>
          <tbody>
            {i.lines.map((l, n) => (
              <tr key={n}><td>{l.description}{tax && i.supplier.sac ? ` (SAC ${i.supplier.sac})` : ''}</td><td>{day(i.period_start)} – {day(i.period_end)}</td><td className="n">{formatINR(l.amount_paise, { showZeroPaise: true })}</td></tr>
            ))}
            {i.credit_paise > 0 && <tr><td colSpan={2}>Credit for unused days of the previous plan</td><td className="n">−{formatINR(i.credit_paise, { showZeroPaise: true })}</td></tr>}
            {tax && <tr><td colSpan={2}>Taxable value</td><td className="n">{formatINR(i.taxable_paise, { showZeroPaise: true })}</td></tr>}
            {tax && i.cgst_paise > 0 && <tr><td colSpan={2}>CGST {rate / 2}%</td><td className="n">{formatINR(i.cgst_paise, { showZeroPaise: true })}</td></tr>}
            {tax && i.sgst_paise > 0 && <tr><td colSpan={2}>SGST {rate / 2}%</td><td className="n">{formatINR(i.sgst_paise, { showZeroPaise: true })}</td></tr>}
            {tax && i.igst_paise > 0 && <tr><td colSpan={2}>IGST {rate}%</td><td className="n">{formatINR(i.igst_paise, { showZeroPaise: true })}</td></tr>}
            <tr className="total"><td colSpan={2}>Total paid</td><td className="n">{formatINR(i.total_paise, { showZeroPaise: true })}</td></tr>
            {i.refunded_paise > 0 && <tr><td colSpan={2}>Refunded</td><td className="n">−{formatINR(i.refunded_paise, { showZeroPaise: true })}</td></tr>}
          </tbody>
        </table>
        <p className="fine">
          {tax ? `Place of supply: state code ${i.place_of_supply}.` : 'No GST has been charged on this payment.'} Paid online through Razorpay.
          This is a computer-generated document for an XS Gym subscription (software service by Xelorsoft) and is not related to the gym’s own member fees.
        </p>
      </article>
    </div>
  );
}
