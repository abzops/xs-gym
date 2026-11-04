import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Field, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR, paiseToInput, parseINR } from '../../lib/money';
import { rpc } from '../../lib/supabase';
import type { Plan } from '../../lib/types';
import { planDuration, usePlans } from '../members/api';

const PRESETS = [
  { name: 'Monthly', unit: 'month', count: 1 },
  { name: 'Quarterly', unit: 'month', count: 3 },
  { name: 'Half-yearly', unit: 'month', count: 6 },
  { name: 'Yearly', unit: 'month', count: 12 },
] as const;

export function PlansPage() {
  const { gym, can } = useGym();
  const [params] = useSearchParams();
  const plans = usePlans(gym.id, true);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const manage = can('plans.manage');

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Plans</h1>
        {manage && <button className="btn primary" onClick={() => setEditing('new')}><Plus size={18} /> Add plan</button>}
      </div>
      {params.get('welcome') && (
        <Notice tone="ok">
          Your gym is ready. Add the plans you sell — then <Link to={`/g/${gym.slug}/members/new`}>add your first member</Link>.
        </Notice>
      )}
      {plans.isPending ? <Loading /> : plans.error ? <Notice tone="bad">{errorMessage(plans.error)}</Notice> :
        plans.data.length === 0 ? (
          <div className="card"><Empty title="No plans yet">
            {manage && <button className="btn primary" onClick={() => setEditing('new')}><Plus size={18} /> Add your first plan</button>}
          </Empty></div>
        ) : (
          <ul className="list card flush">
            {plans.data.map((p) => (
              <li key={p.id}>
                <button className="item" onClick={() => manage && setEditing(p)} disabled={!manage}>
                  <span className="main-col">
                    <span className="title">{p.name}</span>
                    <span className="meta">{planDuration(p)}{p.description ? ` · ${p.description}` : ''}</span>
                  </span>
                  <span className="end-col">
                    <span className="num" style={{ fontWeight: 600 }}>{formatINR(p.price_paise)}</span>
                    {p.status === 'archived' && <span className="badge neutral">Not sold</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {editing && <PlanSheet plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanSheet({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(plan?.name ?? '');
  const [unit, setUnit] = useState<'day' | 'month'>(plan?.duration_unit ?? 'month');
  const [count, setCount] = useState(String(plan?.duration_count ?? 1));
  const [price, setPrice] = useState(plan ? paiseToInput(plan.price_paise) : '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [active, setActive] = useState(plan ? plan.status === 'active' : true);
  const pricePaise = price === '0' ? 0 : parseINR(price);
  const n = Number(count);
  const countOk = Number.isInteger(n) && n > 0 && n <= (unit === 'month' ? 36 : 366);
  const valid = name.trim() && countOk && pricePaise !== null;

  const save = useMutation({
    mutationFn: () => rpc<Plan>('save_plan', {
      p_gym: gym.id, p_plan: plan?.id ?? null, p_name: name, p_duration_unit: unit, p_duration_count: n,
      p_price_paise: pricePaise, p_description: description || null, p_status: active ? 'active' : 'archived',
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['plans', gym.id] });
      toast(plan ? 'Plan updated' : 'Plan added');
      onClose();
    },
  });

  return (
    <Sheet title={plan ? 'Edit plan' : 'Add plan'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        {!plan && (
          <div className="row">
            {PRESETS.map((p) => (
              <button type="button" key={p.name} className="btn small" onClick={() => { setName(p.name); setUnit(p.unit); setCount(String(p.count)); }}>{p.name}</button>
            ))}
          </div>
        )}
        <Field label="Plan name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Length" error={count && !countOk ? `1–${unit === 'month' ? 36 : 366}` : null}>
            <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Unit">
            <Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: 'month', label: 'Months' }, { value: 'day', label: 'Days' }]} />
          </Field>
        </div>
        <Field label="Price" hint="Use 0 for a free plan" error={price && pricePaise === null ? 'Enter a price like 1000' : null}>
          <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="₹" />
        </Field>
        <Field label="Description (optional)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {plan && (
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Still sold
          </label>
        )}
        {plan && <p className="muted">Changing the price affects new sales only. Existing memberships keep the price they were sold at.</p>}
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block" disabled={!valid || save.isPending}>{plan ? 'Save plan' : 'Add plan'}</button>
      </form>
    </Sheet>
  );
}
