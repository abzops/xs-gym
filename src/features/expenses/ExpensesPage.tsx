import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Field, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { formatDate, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR, parseINR } from '../../lib/money';
import { newKey, rpc, supabase } from '../../lib/supabase';
import { METHOD_LABEL, type Expense, type Method } from '../../lib/types';
import { ReasonSheet } from '../members/actions';

const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Salaries', 'Equipment', 'Maintenance', 'Cleaning', 'Water', 'Marketing'];

export function ExpensesPage() {
  const { gym, can } = useGym();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(params.get('new') === '1' && can('expenses.record'));
  const [reversing, setReversing] = useState<string | null>(null);
  const month = todayInGym(gym.timezone).slice(0, 7);
  const [period, setPeriod] = useState(month);

  const expenses = useQuery({
    queryKey: ['expenses', gym.id, period],
    queryFn: async () => {
      const [y, m] = period.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const { data, error } = await supabase.from('expenses')
        .select('*, expense_categories(name), expense_reversals(id, reason)')
        .eq('gym_id', gym.id).gte('expense_date', `${period}-01`).lt('expense_date', next)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
  });
  const live = expenses.data?.filter((x) => !x.expense_reversals?.length) ?? [];
  const total = live.reduce((s, x) => s + x.amount_paise, 0);
  const byCategory = Object.entries(live.reduce<Record<string, number>>((acc, x) => {
    const k = x.expense_categories?.name ?? 'Other';
    acc[k] = (acc[k] ?? 0) + x.amount_paise;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  const close = () => { setAdding(false); if (params.has('new')) setParams({}, { replace: true }); };

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Expenses</h1>
        {can('expenses.record') && <button className="btn primary" onClick={() => setAdding(true)} aria-label="Add expense"><Plus size={18} /> <span className="btn-text">Add expense</span></button>}
      </div>

      <input className="input" type="month" value={period} max={month} onChange={(e) => e.target.value && setPeriod(e.target.value)}
        aria-label="Month" style={{ maxWidth: 220 }} />
      <div className="tiles">
        <div className="tile"><span className="label">Total</span><span className="value">{formatINR(total)}</span><span className="sub">{live.length} entries</span></div>
        {byCategory.slice(0, 3).map(([name, amount]) => (
          <div className="tile" key={name}><span className="label">{name}</span><span className="value">{formatINR(amount)}</span></div>
        ))}
      </div>

      {expenses.isPending ? <Loading /> : expenses.error ? <Notice tone="bad">{errorMessage(expenses.error)}</Notice> :
        expenses.data.length === 0 ? <div className="card"><Empty title="No expenses this month" /></div> : (
          <ul className="list card flush">
            {expenses.data.map((x) => {
              const reversed = !!x.expense_reversals?.length;
              return (
                <li key={x.id} className="item" style={{ cursor: 'default' }}>
                  <span className="main-col">
                    <span className="title">{x.expense_categories?.name}{x.description ? ` · ${x.description}` : ''}</span>
                    <span className="meta">{formatDate(x.expense_date)} · {METHOD_LABEL[x.method]}{reversed ? ` · Reversed: ${x.expense_reversals![0].reason}` : ''}</span>
                  </span>
                  <span className="end-col">
                    <span className="num" style={{ fontWeight: 600, textDecoration: reversed ? 'line-through' : undefined }}>{formatINR(x.amount_paise)}</span>
                    {!reversed && can('expenses.reverse') && <button className="btn small ghost" onClick={() => setReversing(x.id)}>Reverse</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

      {adding && <ExpenseSheet onClose={close} />}
      {reversing && (
        <ReasonSheet title="Reverse expense" confirmLabel="Reverse expense" onClose={() => setReversing(null)}
          warning="The expense stays in history marked as reversed and no longer counts in totals."
          onConfirm={(reason) => rpc('reverse_expense', { p_gym: gym.id, p_expense: reversing, p_reason: reason })
            .then(() => Promise.all([qc.invalidateQueries({ queryKey: ['expenses', gym.id] }), qc.invalidateQueries({ queryKey: ['dashboard', gym.id] })]))
            .then(() => toast('Expense reversed'))} />
      )}
    </div>
  );
}

function ExpenseSheet({ onClose }: { onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [key] = useState(newKey);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => todayInGym(gym.timezone));
  const [method, setMethod] = useState<Method>('cash');
  const [description, setDescription] = useState('');
  const paise = parseINR(amount);
  const categories = useQuery({
    queryKey: ['expense-categories', gym.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_categories').select('name').eq('gym_id', gym.id).order('name');
      if (error) throw error;
      return Array.from(new Set([...data.map((c) => c.name as string), ...DEFAULT_CATEGORIES]));
    },
  });

  const save = useMutation({
    mutationFn: () => rpc('record_expense', {
      p_gym: gym.id, p_category: category, p_amount_paise: paise, p_expense_date: date, p_method: method,
      p_idempotency_key: key, p_description: description || null,
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['expenses', gym.id] }),
        qc.invalidateQueries({ queryKey: ['expense-categories', gym.id] }),
        qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
      ]);
      toast(`${formatINR(paise)} ${category} expense saved`);
      onClose();
    },
  });

  return (
    <Sheet title="Add expense" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (paise && category.trim()) save.mutate(); }}>
        <Field label="Category">
          <input className="input" list="expense-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electricity" />
          <datalist id="expense-cats">{categories.data?.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="row">
          {(categories.data ?? DEFAULT_CATEGORIES).slice(0, 6).map((c) => (
            <button type="button" key={c} className={`btn small ${category === c ? 'primary' : ''}`} onClick={() => setCategory(c)}>{c}</button>
          ))}
        </div>
        <div className="grid-2">
          <Field label="Amount" error={amount && paise === null ? 'Enter an amount like 500' : null}>
            <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹" />
          </Field>
          <Field label="Date"><input className="input" type="date" value={date} max={todayInGym(gym.timezone)} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Segmented label="Paid by" value={method} onChange={setMethod}
          options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }]} />
        <Field label="Note (optional)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block" disabled={!paise || !category.trim() || save.isPending}>
          {paise ? `Save ${formatINR(paise)} expense` : 'Save expense'}
        </button>
      </form>
    </Sheet>
  );
}
