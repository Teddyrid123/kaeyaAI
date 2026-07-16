# Kaeya Assistant — project guide for Claude

Kaeya (**formerly "KonX"** — renamed 2026-07-15) is a **standalone desktop AI writing
assistant for Windows**, aimed at Liberia and African emerging markets. Core idea: a small
**floating orb** sits on the screen edge; the user highlights text in *any* app, taps the orb,
tells Kaeya what to do, and Kaeya **rewrites the text in place** (over the original selection).

> **Naming note:** the product is now **Kaeya** everywhere the user sees it. Many *internal*
> names deliberately still say "konx"/"KonX" and MUST NOT be renamed casually (they'd break
> saved data or the build): the folder `konx-app/`, Cargo crate `konx-app`/`konx_app_lib`,
> `window.KonxAI`, `konx-ai.js`, all `konx-*` localStorage keys + Tauri event names, the Tauri
> `identifier` `com.konx.assistant`, and the keys folder **`%APPDATA%\KonX\keys.json`**. The
> logo is `konx-app/src/kaeya-logo.png` (also `vero/brand/kaeya-logo.png`).

## Who the founder is (READ THIS FIRST)
- **Joseph T. Smith** — founder / product owner. **Non-technical.**
- Give **plain-language, step-by-step, jargon-free** instructions. Explain *what* and
  *why* before *how*. When a step runs on his machine, spell out exactly where to click
  and what to type. Confirm results in plain terms ("yes or no, did X happen?").
- He is on **Windows 10**. The shell here is PowerShell (a Bash tool is also available).
- Never ask him to paste secrets (API keys) into the chat.

## Current status (keep this updated)
- **Phase 0 — DONE.** PowerShell spike proved capture→transform→replace in place works
  across Windows apps. Lives in `spike-phase0/`.
- **Phase 1 — DONE (verified live).** Real Tauri app: floating orb + welcome window +
  character looks + capture/replace, all working natively on Joseph's machine.
- **Phase 2 — DONE (local AI proven).** Model-router built + verified (small vs big model
  switching). **Real Gemini calls work live and FREE** (Flash tier). **OpenAI wired but blocked
  on billing** (429 insufficient_quota). In-app **OpenAI ⇄ Gemini switch** in the top bar.
  **Joseph confirmed the live Gemini rewrite works (2026-07-15)** end-to-end via the local key.
- **Rebrand — DONE (2026-07-15).** Renamed KonX → **Kaeya** everywhere the user sees it; added
  Joseph's logo to the top-left rail + as the default floating-orb look "Kaeya" (old character
  looks kept). Window/taskbar title + `productName` = "Kaeya". See the naming note above.
- **Phase 3 — Backend + accounts — MOSTLY DONE (2026-07-15), awaiting Joseph's live test.**
  - Supabase project **"Kaeya AI"** (ref `jhtiaqlpfkzjxayqhrwi`, West EU/Ireland, free tier)
    is **LIVE**: migrations applied, `ai` Edge Function deployed (ACTIVE), server-side secrets
    `GEMINI_API_KEY` + `OPENAI_API_KEY` set. See "Backend (LIVE)" below + `BACKEND.md`.
  - **Sign-in / Sign-up screen built** (email/password WORKING; Google/Facebook buttons present
    but show "being finalized" — need provider setup). **Brain now calls the server proxy first**
    when signed in, local Rust key as fallback. See "Auth" + "The AI model-router" below.
  - Remaining: (a) Joseph to test signup→signin→server rewrite (feedback due ~2026-07-16);
    (b) wire real Google/Facebook OAuth (provider apps + desktop redirect); (c) OpenAI credit /
    Gemini billing for GPT-4o + Pro models; (d) payments (Paystack/Flutterwave); (e) sync
    History/Saved/Personalize to the DB; (f) code-signing cert before distribution.

## Repo layout
```
vero/
  spike-phase0/        Phase 0 PowerShell proof (konx-spike.ps1) + README
  ui-preview/          Approved standalone HTML design mockup (source of truth for UI)
  brand/               kaeya-logo.png (Joseph's logo; also copied to konx-app/src/)
  konx-app/            THE REAL APP (Tauri) — folder name stays "konx-app" on purpose
    src/               Frontend (plain HTML/CSS/JS, NO bundler, NO framework)
      index.html       Main popup window — self-contained; also holds the sign-in gate
      orb.html         Floating orb window — self-contained
      kaeya-auth.js    Auth layer -> window.KaeyaAuth (Supabase login over REST)
      konx-ai.js       The model-router ("brain" layer) -> window.KonxAI
      kaeya-logo.png   Logo (top-bar/rail + "Kaeya" orb look; served from src/)
    src-tauri/         Rust backend
      src/lib.rs       Engine: capture/replace + window mgmt + ai_generate command
      src/main.rs      Entry point (calls lib::run)
      tauri.conf.json  Two windows: "main" (hidden until orb tapped) + "orb"
      Cargo.toml       Rust deps
      capabilities/default.json   Tauri permissions
  supabase/            THE BACKEND (Supabase — DEPLOYED LIVE to project jhtiaqlpfkzjxayqhrwi)
    config.toml        Project config (ai function requires a signed-in user)
    migrations/        Postgres schema: profiles, usage_daily, subscriptions,
                       history, saved + RLS + new-user trigger + increment_usage
    functions/ai/      THE AI PROXY Edge Function (holds keys server-side, meters
                       per-plan daily usage, calls Gemini/OpenAI)
    functions/_shared/ cors.ts helper
  BACKEND.md           Plain-language backend setup guide for Joseph
  CLAUDE.md            This file
```

## Architecture
- **Tauri v2** desktop app. Frontend is plain HTML/CSS/JS served from `src/` (embedded
  into the exe at compile time — so **any frontend change requires a Rust rebuild** to
  appear in the built exe).
- **Two windows** (see `tauri.conf.json`):
  - `orb` — always-on-top, transparent, docked to the right screen edge (positioned in
    `lib.rs` setup). Clicking it calls `open_konx` and emits the captured text.
  - `main` — the welcome popup, hidden until the orb is tapped. Also hosts the **sign-in
    gate** (`#authGate`), a full-panel overlay shown until the user is signed in.
- **Capture/replace engine** (`lib.rs`): a background thread tracks the last *external*
  foreground window (the app the user was typing in). `open_konx` refocuses it, sends
  Ctrl+C (via `enigo`), reads the clipboard (`arboard`), shows `main`, returns the text.
  `apply_text` writes new text to the clipboard, hides `main`, refocuses the target app,
  sends Ctrl+V.
- **Rust commands** (invoked from JS): `open_konx`, `apply_text`, `hide_main`,
  `set_orb_visible`, `ai_generate`.
- **Events**: orb→main `konx-captured` (payload = captured text); main→orb `konx-style`
  (payload = look id, keeps the orb's appearance in sync). Look/float settings persist
  in `localStorage`.

## The AI model-router (`src/konx-ai.js` → `window.KonxAI`)
- Classifies each request as **small** or **large** task: short text + simple instruction
  (fix grammar / shorten) → small; long text, complex instruction (tone / rewrite /
  translate / improve), or the **"Deep think"** toggle → large.
- Providers + model tiers (verified against Joseph's keys on 2026-07-14):
  - OpenAI: small `gpt-4o-mini`, large `gpt-4o` — **key valid but 429 insufficient_quota**
    (no billing/credit yet). Works once he adds credit.
  - Gemini: small `gemini-flash-lite-latest`, large `gemini-flash-latest` — **WORK FREE**
    (Flash family, no billing). Gemini **Pro** models return 429 (need billing), so large
    tier uses full Flash for now; bump to a Pro model once billing exists.
  - `config.activeProvider` default `"gemini"` (its free tier works today; OpenAI needs
    credit). An in-app **OpenAI ⇄ Gemini switch** exists in the top bar (`#provSwitch`),
    persisted to `localStorage` key `konx-provider`.
  - Gotcha: a Gemini model can be *listed* by ListModels yet still 404 "not available to
    new users" on generateContent (e.g. `gemini-2.5-flash`). Always test with a real
    generateContent call before trusting a model id. The `*-latest` aliases are safest.
- `callProvider` now routes **server-first**: `callServer` POSTs to the Supabase `ai` proxy
  (`<SUPABASE_URL>/functions/v1/ai`) with the signed-in user's JWT when `window.KaeyaAuth`
  reports a session; it respects the server's `429` (daily limit) and `401` (login expired)
  instead of bypassing them. If not signed in / server unreachable, it falls back to
  `callLocal` (Rust `ai_generate` with the local key), and finally the built-in mock/demo
  brain — so the app never breaks. Persona is folded into the instruction before sending.
- The result badge shows the model + `quick task`/`big task` + `live` (real AI) or
  `demo brain` (mock); the `limit`/`auth` fallback reasons surface a short warning.

## Auth (`src/kaeya-auth.js` → `window.KaeyaAuth`)
- Talks to **Supabase Auth (GoTrue) over plain REST** — no library (keeps the no-bundler rule).
- Holds only the **public anon key** (safe to embed; RLS enforces access). The session
  (`access_token`/`refresh_token`/`expires_at`/`user`) persists in `localStorage['kaeya-session']`.
- API: `signUp`, `signIn`, `signOut`, `refresh`, `getAccessToken` (auto-refreshes when <60s left),
  `isSignedIn`, `user`, `onChange`, `oauthUrl` (built for later social login).
- UI (in `index.html`): split-hero sign-in/sign-up gate, email/password **working**; Settings →
  **Account** row shows the email + **Sign out**. Google/Facebook buttons exist but show a
  "being finalized" note — real social login still needs provider apps + a desktop OAuth redirect
  (deep-link `kaeya://…` or loopback) to hand the session back to the Tauri webview.
- **Email confirmation** is ON by default on the project, so `signUp` may return no session and
  the UI says "check your email". Turn it off in Supabase (Authentication → Email → "Confirm
  email") for instant testing.

## API keys (SECRETS — never commit, never print, never put in chat)
- **Two homes now.** The **server** copy (the real one going forward) lives as Supabase
  secrets `GEMINI_API_KEY` + `OPENAI_API_KEY` on project `jhtiaqlpfkzjxayqhrwi`, used by the
  `ai` Edge Function — set 2026-07-15 from Joseph's `keys.json` via `secrets set --env-file`
  (values never printed). This is what signed-in users hit.
- The **local** copy is the offline/fallback path: Rust `load_keys()` reads
  **`%APPDATA%\KonX\keys.json`** `{ "openai": "...", "gemini": "..." }`. Outside the repo,
  NEVER embedded in the app. Missing/blank key → that provider errors → mock fallback.
- Google **Gemini API keys** (from aistudio.google.com): Joseph's works on the `?key=`
  endpoint. Free "Flash" tier works; "Pro" needs billing.
- **To diagnose keys, NEVER echo them.** Run a small Node script that reads
  `keys.json` and prints ONLY status codes / error messages (e.g. `429
  insufficient_quota`, `404 not available`) — not the key value. That is how the
  billing + retired-model issues were found on 2026-07-14.

## Backend (LIVE — Supabase project "Kaeya AI")
- **Project ref `jhtiaqlpfkzjxayqhrwi`**, URL `https://jhtiaqlpfkzjxayqhrwi.supabase.co`,
  West EU (Ireland), free tier. **Under a different Supabase account** than this machine's other
  projects ("Nexus Trust" ×2) — the CLI is now logged into the Kaeya account.
- CLI is `supabase` v2.67.1 (global, on PATH). **Gotcha:** `supabase login` inside the Claude
  `!`-session fails (non-TTY needs a token) — Joseph ran `supabase login` in a real PowerShell
  window once; the stored credential lives in the Windows credential store (not a readable file),
  and the Claude Bash tool reuses it.
- Deploy commands (from `vero/`): `supabase functions deploy ai --project-ref jhtiaqlpfkzjxayqhrwi`
  (no DB password needed); DB migrations were applied by Joseph via `supabase db push` in his own
  PowerShell (that one needs the DB password, typed locally). `supabase secrets set --env-file …`
  for the server keys. `link` works with `printf '\n' | supabase link --project-ref …`.
- The `ai` function requires a signed-in user (`verify_jwt`), meters per-plan daily usage
  (`DAILY_LIMIT` free:40 / pro,team:5000 in `functions/ai/index.ts`), and returns
  `{ text, engine, plan, used, limit }`. See `BACKEND.md` for the plain-language guide.

## Build & run
- Prereqs already installed on this machine: Rust 1.97, Node 20, MSVC Build Tools 2022,
  WebView2, Tauri CLI 2.11.x (`npm install` done in `konx-app/`).
- **Build:** `cargo build --manifest-path src-tauri/Cargo.toml` (run from `konx-app/`).
  Built exe: `konx-app/src-tauri/target/debug/konx-app.exe`.
- **Run:** double-click that exe (simplest for Joseph), or `npm run tauri dev` from
  `konx-app/` for hot-reload development.
- **GOTCHA — "Access is denied" on link:** if the app is running (or Joseph reopens it),
  the rebuild can't overwrite the exe. `taskkill //F //IM konx-app.exe` alone races the
  link (the file lock lingers a moment after the process dies). Use a wait-loop, and ask
  Joseph not to reopen mid-build:
  ```bash
  taskkill //F //IM konx-app.exe
  until ! tasklist //FI "IMAGENAME eq konx-app.exe" | grep -qi konx-app.exe; do sleep 1; done
  until rm -f src-tauri/target/debug/konx-app.exe 2>/dev/null && [ ! -f src-tauri/target/debug/konx-app.exe ]; do sleep 1; done
  cargo build --manifest-path src-tauri/Cargo.toml
  ```
- **Build times:** first-ever build ~21 min (all crates). Frontend-only change =
  incremental ~1–2 min. Adding `reqwest` took ~8 min once. Builds are long — batch changes
  and run them in the background.
- The launch/test drives the real keyboard & clipboard and opens real windows, so the
  **live test must be run by Joseph on his machine** (Claude can build/compile, not drive).

## Product constraints & decisions
- **Payments** (later): must use **Paystack / Flutterwave**, NOT Stripe (Liberia).
- **Code-signing cert** required before distributing (unsigned = Windows SmartScreen
  warning; "More info → Run anyway" for now).
- **No single-LLM lock-in** — the router must keep supporting multiple providers.
- **Key security for distribution:** do NOT ship a shared key inside the app (extractable).
  Before launch, move to per-user keys or a backend proxy.

## Conventions
- Frontend windows are **self-contained** HTML (inline CSS/JS, no build step, no CDN), except
  for two shared script files loaded by `index.html`: `kaeya-auth.js` then `konx-ai.js` (order
  matters — the brain reads `window.KaeyaAuth` at call time). Assets in `src/` (e.g.
  `kaeya-logo.png`) are served directly by Tauri; embed sparingly, keep it local (no CDN).
- UI defaults to a **light glass aesthetic** (modeled on Nexa.Ai), regardless of Windows
  dark mode. Segoe UI type. `ui-preview/konx-preview.html` is the approved design reference.
  A **Dark mode** toggle lives in the **Settings** tab (adds `html.dark`, which overrides the
  CSS color variables; persisted to `localStorage['konx-theme']`).
- The "improve" mock in `konx-ai.js` is a deliberate placeholder; real intelligence comes
  from the **server proxy** (signed in) or the Rust `ai_generate` (local fallback). Keep the
  mock working as the final offline/no-key fallback so the app never breaks.
