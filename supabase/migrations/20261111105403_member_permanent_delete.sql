-- Only gym owners may permanently delete a never-transacted member.
-- Protected financial and attendance history is deliberately immutable.
-- Audit logs remain immutable, including the historical creation event.
create function public.permanently_delete_member(
  p_gym uuid,
  p_member uuid,
  p_member_no text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.members;
begin
  perform private.require(p_gym, 'members.archive');

  -- "members.archive" is also held by managers: permanent deletion is owner-only.
  if not exists (
    select 1 from public.gym_staff s
    where s.gym_id = p_gym
      and s.user_id = auth.uid()
      and s.status = 'active'
      and s.role = 'owner'
  ) then
    raise exception 'XS403: only the gym owner can permanently delete a member'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'XS422: enter a reason for permanent deletion (at least 3 characters)'
      using errcode = '22023';
  end if;

  -- Lock the member row so new child records cannot race the deletion.
  select * into v_m
    from public.members
    where gym_id = p_gym and id = p_member
    for update;
  if v_m.id is null then
    raise exception 'XS404: member not found in this gym'
      using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_member_no, '')) <> v_m.member_no then
    raise exception 'XS422: member number confirmation does not match'
      using errcode = '22023';
  end if;

  -- These records must never be erased by a member swipe:
  -- receipts, charges, enrollment history and check-in audit events.
  if exists (select 1 from public.payments
              where gym_id=p_gym and member_id=p_member)
     or exists (select 1 from public.charges
                where gym_id=p_gym and member_id=p_member)
     or exists (select 1 from public.member_memberships
                where gym_id=p_gym and member_id=p_member)
     or exists (select 1 from public.attendance_events
                where gym_id=p_gym and member_id=p_member)
  then
    raise exception 'XS409: this member has financial, membership or check-in history. Archive the member instead to preserve the records'
      using errcode = '23503';
  end if;

  -- A linked lead cannot remain in the joined state without its member.
  -- These are not accounting records, so clear them with the empty profile.
  delete from public.enquiries
    where gym_id=p_gym and member_id=p_member;

  delete from public.members
    where gym_id=p_gym and id=p_member;

  perform private.audit(p_gym, 'member.permanently_deleted', 'members', p_member,
    jsonb_build_object('member_no', v_m.member_no), btrim(p_reason));
  return true;
end;
$$;

revoke all on function public.permanently_delete_member(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.permanently_delete_member(uuid,uuid,text,text)
  to authenticated;
comment on function public.permanently_delete_member(uuid,uuid,text,text)
  is 'Owner-only, confirmed hard delete for never-transacted member profiles. Financial and attendance histories cannot be removed; archive those members instead.';
