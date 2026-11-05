// Reminders over WhatsApp: a ready message in English or Malayalam that the
// staff member can edit, then opens WhatsApp (app or web) with it filled in.
// Nothing is sent automatically and no WhatsApp account is needed on our side.
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useGym } from '../app/gym';
import { formatDate } from '../lib/dates';
import { formatINR } from '../lib/money';
import { Segmented, Sheet } from './ui';

export type ReminderKind = 'renew' | 'expired' | 'dues' | 'enquiry' | 'welcome';
type Lang = 'en' | 'ml';
export type ReminderFacts = { name: string; plan?: string | null; date?: string | null; amountPaise?: number };

const LANG_KEY = 'xs-wa-lang';
const readLang = (): Lang => { try { return localStorage.getItem(LANG_KEY) === 'ml' ? 'ml' : 'en'; } catch { return 'en'; } };

export function reminderText(kind: ReminderKind, lang: Lang, f: ReminderFacts, gym: string) {
  const first = f.name.split(' ')[0];
  const plan = f.plan ?? (lang === 'ml' ? 'മെമ്പർഷിപ്പ്' : 'membership');
  const date = f.date ? formatDate(f.date) : '';
  const amount = formatINR(f.amountPaise ?? 0);
  if (lang === 'ml') {
    switch (kind) {
      case 'renew': return `ഹായ് ${first}, ${gym}-ലെ നിങ്ങളുടെ ${plan} ${date}-ന് അവസാനിക്കും. ഇടവേളയില്ലാതെ ട്രെയിനിങ് തുടരാൻ ദയവായി പുതുക്കുക. നന്ദി!`;
      case 'expired': return `ഹായ് ${first}, ${gym}-ലെ നിങ്ങളുടെ ${plan} ${date}-ന് അവസാനിച്ചു. ഇന്ന് തന്നെ പുതുക്കി ട്രെയിനിങ് വീണ്ടും തുടങ്ങാം. ഞങ്ങൾ കാത്തിരിക്കുന്നു!`;
      case 'dues': return `ഹായ് ${first}, ${gym}-ൽ ${amount} ബാക്കി അടയ്ക്കാനുണ്ട്. ഡെസ്കിലോ UPI വഴിയോ അടയ്ക്കാവുന്നതാണ്. നന്ദി!`;
      case 'enquiry': return `ഹായ് ${first}, ${gym}-നെക്കുറിച്ച് അന്വേഷിച്ചതിന് നന്ദി. ഈ ആഴ്ച ഒരു ഫ്രീ ട്രയൽ സെഷന് വരാമോ?`;
      case 'welcome': return `ഹായ് ${first}, ${gym}-ലേക്ക് സ്വാഗതം! നിങ്ങളുടെ ഫിറ്റ്നസ് യാത്രയിൽ ഞങ്ങൾ കൂടെയുണ്ട്. എന്തെങ്കിലും സംശയമുണ്ടെങ്കിൽ ഈ നമ്പറിൽ മെസേജ് ചെയ്യൂ.`;
    }
  }
  switch (kind) {
    case 'renew': return `Hi ${first}, your ${plan} at ${gym} ends on ${date}. Renew to keep training without a break. See you at the gym!`;
    case 'expired': return `Hi ${first}, your ${plan} at ${gym} ended on ${date}. We miss you! Renew today and get back on track.`;
    case 'dues': return `Hi ${first}, a balance of ${amount} is pending at ${gym}. You can pay at the desk or by UPI. Thank you!`;
    case 'enquiry': return `Hi ${first}, thanks for asking about ${gym}. Would you like to come in for a free trial session this week?`;
    case 'welcome': return `Hi ${first}, welcome to ${gym}! We're glad to have you. Message us here any time you need help.`;
  }
}

/** wa.me wants the number with country code and digits only. */
export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

export function WhatsAppButton({ phone, kind, facts, label = 'WhatsApp', small = true }: {
  phone: string; kind: ReminderKind; facts: ReminderFacts; label?: string; small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`btn${small ? ' small' : ''} wa`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        aria-label={`${label}: message ${facts.name}`}>
        <MessageCircle size={16} aria-hidden /> <span className="btn-text">{label}</span>
      </button>
      {open && <WhatsAppSheet phone={phone} kind={kind} facts={facts} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhatsAppSheet({ phone, kind, facts, onClose }: { phone: string; kind: ReminderKind; facts: ReminderFacts; onClose: () => void }) {
  const { gym } = useGym();
  const [lang, setLangState] = useState<Lang>(readLang);
  const [text, setText] = useState(() => reminderText(kind, lang, facts, gym.name));
  const setLang = (l: Lang) => {
    setLangState(l);
    setText(reminderText(kind, l, facts, gym.name));
    try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  };
  return (
    <Sheet title={`Message ${facts.name}`} onClose={onClose}>
      <div className="stack lg">
        <Segmented label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
        <label className="field"><span>Message</span>
          <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted" style={{ margin: 0 }}>Opens WhatsApp with this message to {phone}. You press send there.</p>
        <a className="btn primary block xl wa" href={waLink(phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(onClose, 300)}>
          <MessageCircle size={18} aria-hidden /> Open WhatsApp
        </a>
      </div>
    </Sheet>
  );
}

/** The most useful reminder for a member right now. */
export function reminderFor(m: { full_name: string; plan_name: string | null; valid_until: string | null; membership_status: string; due_paise: number },
  canMoney: boolean): { kind: ReminderKind; facts: ReminderFacts } {
  const facts = { name: m.full_name, plan: m.plan_name, date: m.valid_until, amountPaise: m.due_paise };
  if (canMoney && m.due_paise > 0) return { kind: 'dues', facts };
  if (m.membership_status === 'expired' || m.membership_status === 'grace') return { kind: 'expired', facts };
  if (m.valid_until) return { kind: 'renew', facts };
  return { kind: 'welcome', facts };
}
