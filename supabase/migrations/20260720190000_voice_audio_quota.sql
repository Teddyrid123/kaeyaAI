-- ============================================================================
-- Voice IN (Stage 2) — real per-minute audio metering
--
-- Text/vision usage is metered per REQUEST (consume_quota/refund_usage, +1 per
-- call). Speech-to-text is billed per MINUTE of audio, so a single voice
-- request can cost far more than a single text request. This adds a second,
-- parallel quota dimension — audio SECONDS per day — using the exact same
-- atomic reserve-then-refund pattern already proven by consume_quota, so
-- parallel voice requests can't race past the daily audio cap.
--
-- The server (not the client) measures the real duration before calling
-- these — see supabase/functions/ai/index.ts's WAV-header parsing. The
-- p_seconds argument here is trusted because by the time it's called, it was
-- computed server-side from the actual uploaded bytes, not read from the
-- client's request body.
-- ============================================================================

-- 1) Add the audio-seconds counter to the existing per-user-per-day usage row.
--    Reuses usage_daily (same table already RLS'd + already keyed by
--    user_id+day) instead of a new table — one row per user per day covers
--    both request-count and audio-seconds usage.
alter table public.usage_daily
  add column if not exists audio_seconds integer not null default 0;

-- 2) Atomic reserve: adds p_seconds to today's audio total and returns the
--    NEW total, so the caller's gate check uses a race-free number (same
--    reserve-then-check pattern as consume_quota).
create or replace function public.consume_audio_seconds(p_user uuid, p_seconds integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  new_total integer;
begin
  insert into public.usage_daily (user_id, day, count, audio_seconds)
  values (p_user, current_date, 0, p_seconds)
  on conflict (user_id, day)
  do update set audio_seconds = public.usage_daily.audio_seconds + p_seconds
  returning audio_seconds into new_total;
  return new_total;
end;
$$;

-- 3) Refund on failure / over-limit, so only successful transcriptions count
--    toward the daily audio budget.
create or replace function public.refund_audio_seconds(p_user uuid, p_seconds integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.usage_daily
    set audio_seconds = greatest(audio_seconds - p_seconds, 0)
    where user_id = p_user and day = current_date;
end;
$$;

grant execute on function public.consume_audio_seconds(uuid, integer) to service_role;
grant execute on function public.refund_audio_seconds(uuid, integer)  to service_role;

-- ============================================================================
-- Cleanup: the pre-consume_quota increment_usage function has been dead code
-- since the 2026-07-16 security-hardening migration. Its own comment said it
-- was "safe to drop... once the new function has been live for a while" —
-- dropping it now, before adding a THIRD quota mechanism, so the quota code
-- doesn't accumulate a second generation of cruft alongside the new one.
-- ============================================================================
drop function if exists public.increment_usage(uuid);
