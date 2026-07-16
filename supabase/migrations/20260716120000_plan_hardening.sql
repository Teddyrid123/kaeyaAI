-- ============================================================================
-- Security hardening — from the /cso key-handling audit (2026-07-16)
--
-- Fixes two findings:
--   #1 (HIGH)  A signed-in user could raise their own `plan` and bypass the
--              daily AI limit, because `plan` lived on the user-editable
--              `profiles` row and the AI proxy trusted it.
--   #2 (MED)   The usage check and increment could race, letting parallel
--              calls slip past the daily cap.
--
-- After this migration the plan comes ONLY from `subscriptions` (which users
-- cannot write — no update/insert policy; only the service-role payment
-- webhook writes it), the `plan` column on `profiles` is locked, and quota is
-- consumed atomically with a refund path.
-- ============================================================================

-- 1) Users keep editing their personalize fields (preferred_name, role, style,
--    goals, notes) but can no longer change their own plan.
revoke update (plan) on public.profiles from authenticated, anon;

-- 2) Atomic quota consumption. One statement increments today's counter and
--    returns the new value, so concurrent calls each get a distinct count and
--    the caller uses the RETURNED value as the gate (no check-then-increment
--    race). SECURITY DEFINER so the service-role proxy can call it.
create or replace function public.consume_quota(p_user uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.usage_daily (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
  do update set count = public.usage_daily.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

-- 3) Refund one unit when a reserved call exceeds the cap or the model fails,
--    so only successful rewrites are counted.
create or replace function public.refund_usage(p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.usage_daily
    set count = greatest(count - 1, 0)
    where user_id = p_user and day = current_date;
end;
$$;

grant execute on function public.consume_quota(uuid) to service_role;
grant execute on function public.refund_usage(uuid)  to service_role;

-- NOTE: the old public.increment_usage(uuid) is intentionally left in place.
-- The new AI proxy no longer calls it, but leaving it avoids any gap where the
-- previously-deployed function (which still references it) would error during
-- the migrate-then-redeploy transition. Safe to drop in a later cleanup
-- migration once the new function has been live for a while.
