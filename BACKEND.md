# KonX backend — setup guide (Supabase)

This folder (`supabase/`) is KonX's backend. It does three jobs:

1. **Keeps the AI keys safe** — the app calls our server, the server calls Gemini/OpenAI. The keys never live on anyone's PC.
2. **Controls the limits** — we decide how many rewrites free vs paid users get.
3. **Holds accounts & (later) subscriptions and synced history.**

You only set this up **once**. After that it just runs.

---

## What's already built (in this folder)
- `supabase/migrations/…_init.sql` — the database tables + security rules.
- `supabase/functions/ai/` — the **AI proxy** (the important one).
- `supabase/config.toml` — project settings.

## What YOU need to do (about 15 minutes, one time)

### Step 1 — Make a free Supabase account + project
1. Go to **https://supabase.com** → **Start your project** → sign in with Google or email.
2. Click **New project**. Give it a name like **KonX**. Pick a **database password** (save it somewhere safe) and the region closest to you.
3. Wait ~2 minutes for it to finish setting up.

> ⚠️ **Never paste your secret keys into this chat.** You'll enter them directly on Supabase's website in the steps below. It's safe there.

### Step 2 — Tell Claude two *non-secret* things
From your project's **Settings → API** page, copy and send Claude:
- the **Project URL** (looks like `https://abcxyz.supabase.co`)
- the **anon public** key (the one literally labelled "anon / public")

These two are safe to share — they're meant to be in the app. **Do NOT** send the `service_role` key.

### Step 3 — Add the database tables
Easiest way (no tools): in Supabase, open **SQL Editor → New query**, paste the entire contents of
`supabase/migrations/20260715120000_init.sql`, and click **Run**. You should see "Success".

*(Or, if Claude is helping with the command-line tool, run `supabase db push`.)*

### Step 4 — Put the AI keys on the server (as secrets)
In Supabase: **Edge Functions → Secrets** (or **Project Settings → Edge Functions**). Add:
- `GEMINI_API_KEY` = your Gemini key
- `OPENAI_API_KEY` = your OpenAI key (optional, add when you have credit)

You type these **on the Supabase website**, not in chat. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` are provided automatically — you don't add those.

### Step 5 — Deploy the AI proxy
This needs the **Supabase CLI**. In this session you can run a login yourself by typing:

```
! npx supabase login
```

(the `!` runs it right here so the browser step works). Then Claude can run, from the `vero/` folder:

```
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase functions deploy ai
```

`<your-project-ref>` is the code in your project URL (the `abcxyz` part).

---

## How the app will use it (next step, after setup)
Right now the desktop app calls Gemini/OpenAI directly with a local key. Once the backend is live,
we'll add a small **Sign in** screen to KonX and point its "brain" at the proxy instead:

- App sends the user's **login token** + the text → the `ai` function.
- The function checks the plan/limit, calls the real model with the **server** key, counts the use,
  and returns the rewrite.

That change is Step ② in the build order and is done in `konx-app` (`konx-ai.js` + a login screen).

## Still to come
- **Payments** — a `paystack-webhook` function that flips a user to "pro" when they pay (Paystack/Flutterwave, not Stripe).
- **Sync** — save History/Saved/Personalize to the `history` / `saved` / `profiles` tables so they follow the user across PCs.

## Daily limits (edit anytime)
In `supabase/functions/ai/index.ts`, `DAILY_LIMIT` sets how many rewrites each plan gets per day
(`free: 40`, `pro/team: 5000`). Change and re-deploy the function to adjust.
