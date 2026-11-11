-- Audit-safe payment correction: the original payment remains immutable.
-- Reverse original + create corrected replacement atomically.  A retry with
-- the same key returns the replacement, never recording money twice.
create function public.correct_payment(
  p_gym uuid,
  p_payment uuid,
  p_amount_paise bigint,
  p_method text,
  p_reason text,
  p_idempotency_key uuid,
  p_reference text default null,
  p_notes text default null
)
returns public.payments
language plpgsql security definer set search_path = '' as $$
declare
  v_original public.payments;
  v_replacement public.payments;
  v_note text;
begin
  perform private.require(p_gym, 'payments.reverse');
  perform private.require(p_gym, 'payments.record');
  if p_idempotency_key is null then
    raise exception 'XS422: correction idempotency key is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'XS422: explain the correction (at least 3 characters)' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_amount_paise > 100000000 then
    raise exception 'XS422: enter an amount between ₹0.01 and ₹10,00,000' using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cash', 'upi', 'card', 'bank', 'other') then
    raise exception 'XS422: invalid payment method' using errcode = '22023';
  end if;

  select * into v_original from public.payments
    where gym_id = p_gym and id = p_payment for update;
  if v_original.id is null then
    raise exception 'XS404: original payment not found in this gym' using errcode = 'P0002';
  end if;

  select * into v_replacement from public.payments
    where gym_id = p_gym and idempotency_key = p_idempotency_key;
  if v_replacement.id is not null then
    if v_replacement.member_id = v_original.member_id
       and v_replacement.amount_paise = p_amount_paise
       and v_replacement.method = p_method
       and v_replacement.notes like ('Correction of ' || v_original.id::text || '.%')
    then
      return v_replacement;
    end if;
    raise exception 'XS409: correction key has already been used for another payment'
      using errcode = '23505';
  end if;
  if exists (select 1 from public.payment_reversals where payment_id = p_payment) then
    raise exception 'XS409: payment is already reversed and cannot be edited'
      using errcode = '23505';
  end if;

  -- Both calls run in this function's single PostgREST transaction. If
  -- creating the replacement fails, the original reversal rolls back.
  perform public.reverse_payment(p_gym, p_payment, 'Corrected: ' || btrim(p_reason));
  v_note := 'Correction of ' || v_original.id::text || '. Reason: ' ||
    left(btrim(p_reason), 200);
  if nullif(btrim(coalesce(p_notes, '')), '') is not null then
    v_note := v_note || '. Note: ' || left(btrim(p_notes), 300);
  end if;
  v_replacement := public.record_payment(p_gym, v_original.member_id,
    p_amount_paise, p_method, p_idempotency_key, p_reference, v_note);

  perform private.audit(p_gym, 'payment.corrected', 'payments', v_replacement.id,
    jsonb_build_object('original_payment_id', v_original.id,
      'original_amount_paise', v_original.amount_paise,
      'new_amount_paise', v_replacement.amount_paise,
      'original_method', v_original.method, 'new_method', v_replacement.method),
    btrim(p_reason));
  return v_replacement;
end;
$$;

revoke all on function public.correct_payment(uuid,uuid,bigint,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.correct_payment(uuid,uuid,bigint,text,text,uuid,text,text)
  to authenticated;
comment on function public.correct_payment(uuid,uuid,bigint,text,text,uuid,text,text)
  is 'Reverses an existing payment and records a corrected replacement in one audited transaction; requires payments.reverse and payments.record';
