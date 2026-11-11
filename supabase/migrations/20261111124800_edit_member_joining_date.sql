-- Allow Joining Date to be edited without breaking older XS Gym clients.
-- A new RPC overload requires p_join_date, while existing update_member calls
-- that omit it still resolve to the original nine-argument function.
--
-- Joining Date is a member-profile attribute. This command deliberately does
-- not modify membership periods, charges, payment dates, or receipt history.
create function public.update_member(
  p_gym uuid,
  p_member uuid,
  p_full_name text,
  p_phone text,
  p_join_date date,
  p_email text default null,
  p_gender text default null,
  p_date_of_birth date default null,
  p_address text default null,
  p_emergency_contact text default null
)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_join date;
  v_member public.members;
begin
  perform private.require(p_gym, 'members.write');

  if p_join_date is null then
    raise exception 'XS422: joining date is required' using errcode = '22023';
  end if;

  -- Reuse existing validated, tenant-scoped profile update logic. Both writes
  -- happen in one transaction, so a failure cannot partially save a member.
  v_member := public.update_member(
    p_gym, p_member, p_full_name, p_phone, p_email,
    p_gender, p_date_of_birth, p_address, p_emergency_contact
  );

  v_old_join := v_member.join_date;
  if v_old_join is distinct from p_join_date then
    update public.members set join_date = p_join_date
    where gym_id = p_gym and id = p_member
    returning * into v_member;

    perform private.audit(p_gym, 'member.join_date_updated', 'members',
      p_member, jsonb_build_object('before', v_old_join, 'after', p_join_date));
  end if;
  return v_member;
end;
$$;

-- This is a privileged, tenant-scoped RPC. Only signed-in gym staff who pass
-- private.require('members.write') can execute it.
revoke all on function public.update_member(uuid,uuid,text,text,date,text,text,date,text,text)
from public, anon, authenticated;
grant execute on function public.update_member(uuid,uuid,text,text,date,text,text,date,text,text)
to authenticated;
comment on function public.update_member(uuid,uuid,text,text,date,text,text,date,text,text)
is 'Atomically edit member profile and joining date, audited and gym-scoped; keep old RPC overload for compatibility.';
