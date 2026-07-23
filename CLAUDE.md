# Kaeya Assistant — project guide for Claude

Kaeya (**formerly "KonX"** — renamed 2026-07-15) is a **standalone desktop AI assistant for
Windows**, aimed at Liberia and African emerging markets. Two things it does: (1) a small
**floating orb** sits on the screen edge; the user highlights text in *any* app, taps the orb,
tells Kaeya what to do, and Kaeya **rewrites the text in place**; and (2) the **on-screen helper**
— the user asks a question, Kaeya takes ONE photo of the screen and walks them through it in
plain, simple steps. See "Product direction" below — the on-screen helper is the core wedge.

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

## Product direction (decided 2026-07-16 via /office-hours — READ THIS)
Kaeya's differentiator is NOT "more AI" (can't out-model OpenAI/Google) and NOT primarily text
rewriting. It is being **the patient on-screen helper for non-technical African users**: you ask,
Kaeya looks at your screen ONCE and guides you through it in simple steps. Real evidence: Joseph
watched a lady who couldn't find Gmail's Forward button and had to ask a human — the alternative
to Kaeya in this market is "call someone every time." Competitor isn't Claude/Copilot; it's
ignorance that AI does more than ChatGPT copy-paste.
**Agreed build sequence (don't reorder without a reason):**
1. **v1.0 — reactive screen helper — DONE & VERIFIED LIVE (2026-07-16).** Ask → screenshot →
   vision model → plain numbered steps. Captured ONLY when asked (privacy + cheaper). See below.
2. **v1.1 — proactive nudges:** same engine, Kaeya offers help first based on the front app.
   Turn on only AFTER v1.0 is trusted (bad proactive guesses feel broken).
3. **v1.2 — local documents:** Liberian quotation / invoice / sponsorship letter / MOU formats.
   The money + the local moat big players won't build.
4. **v2 — the "operator":** file-moving / running apps for the user. HIGH RISK (one wrong
   unsupervised action kills trust). Earned later, supervised first. Deliberately parked LAST.
Guiding test for any feature: "Can this help a non-technical office worker finish their task in
fewer clicks than opening ChatGPT?" Yes → build. No → it's just another AI feature.

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
  - **Google OAuth — DONE & VERIFIED LIVE (2026-07-16).** Joseph signed in with Google
    end-to-end (`josephtsmith31@gmail.com`): browser consent → `kaeya://auth-callback` deep
    link → app signed in, gate dropped. Google Cloud OAuth client + Supabase Google provider +
    `kaeya://` redirect allow-list all configured by Joseph. Known cosmetic quirk: the browser
    tab that launched the `kaeya://` link keeps spinning (custom scheme isn't a web page) —
    harmless, user just closes it. (A hosted "you can close this tab" bounce page would fix the
    cosmetics later if wanted.)
    Desktop redirect solved via a custom **`kaeya://`** deep link: `tauri-plugin-deep-link`
    (+ `tauri-plugin-single-instance` w/ `deep-link` feature) registers the scheme at runtime
    and, on the browser redirect, emits a `kaeya-oauth` event with the callback URL; the
    frontend (`KaeyaAuth.signInWithOAuth` / `sessionFromRedirect`) parses the tokens out of the
    URL `#fragment`, loads the user, and saves the session. **Continue with Google** button is
    wired; Facebook still parked. Built clean. Joseph must still: create a Google OAuth Web
    client (redirect `…supabase.co/auth/v1/callback`), enable Google in Supabase + paste
    ID/secret, and add `kaeya://auth-callback` to the redirect allow-list — see
    **`SOCIAL-LOGIN-SETUP.md`** (plain-language click-by-click).
  - Remaining: (a) Joseph to test signup→signin→server rewrite (feedback due ~2026-07-16);
    (b) finish Google live test (above), then wire real Facebook OAuth (business/app review); (c) OpenAI credit /
    Gemini billing for GPT-4o + Pro models; (d) payments (Paystack/Flutterwave); (e) sync
    History/Saved/Personalize to the DB; (f) code-signing cert before distribution.
- **Features section redesign — DONE (2026-07-16).** The welcome view now lists the four features
  as **tabs** (`.ftabs` in `index.html`): Text Assistance (default open), Contextual Guidance,
  Desktop Organization (Soon), Voice Command (Soon). Clicking a tab swaps its panel. The
  **"Selected text" box moved to the top** and shows only on the Text Assistance tab OR when text
  is captured/pasted (JS `selectCat` / `updateCaptureVis`).
- **v1.0 on-screen helper — DONE & VERIFIED LIVE (2026-07-16).** "Explain my screen" in the
  Contextual Guidance tab is real: it takes one photo of the screen and returns simple, numbered,
  plain-language guidance. Joseph tested it live on Gmail end-to-end. This is the core-wedge
  feature (see Product direction). Details in "The on-screen helper" below.
  Next steps for it: (a) server-side vision path — **DONE & VERIFIED LIVE 2026-07-18** (keyless test
  passed: signed-in users hit the Supabase `ai` proxy instead of falling to the demo brain; see
  "Server-first vision" below); (b) v1.1 proactive nudges; (c) capture the monitor the
  target app is on (v1.0 grabs the primary monitor).
- **On-screen pointing — CORE MECHANIC DONE & VERIFIED LIVE (2026-07-17).** Kaeya draws a green box +
  red arrow ("Kaeya: click here") on the REAL on-screen button, using Windows UIAutomation for the exact
  spot instead of the AI guessing pixels. Pieces: `src-tauri/src/uia.rs` (`list_elements_for(hwnd)` reads
  named elements + exact rects; `pick_target(els, term)` picks the match — now TIERED: exact name →
  whole-word token match → substring only for terms ≥3 chars, so a vague search like "B" can't grab the
  wrong control; `clean_target_name` strips a trailing " [Type]" the model sometimes copies); Rust
  commands `list_elements` / `point_at(name, seconds?)` / `take_pending_point` / `clear_point`; and a
  third transparent, click-through, always-on-top **`overlay`** window drawn by `src/overlay.html` (HTML
  canvas). Gotchas fixed earlier: the `overlay` window MUST be listed in `capabilities/default.json`
  `windows` (else zero permissions → can't receive the `kaeya-point` event → blank tinted screen, no
  arrow), and `overlay` must be in the foreground-tracker exclude list so the arrow layer isn't mistaken
  for the target app.
- **"Make pointing real" — DONE & VERIFIED LIVE 2026-07-18 (full multi-step, general across apps).**
  Pointing is wired to real AI guidance, one step at a time; the old dev-test buttons are gone. The engine
  is **reactive**: the `guide_step` command (`lib.rs`) takes the user's `goal` + the `history` of steps
  already done, takes a FRESH screenshot + on-screen element-name list each call (`onscreen_element_lines`
  filters UIAutomation to Button/Hyperlink/MenuItem/Edit/TabItem/CheckBox/ComboBox/ListItem, dedupes, caps
  120), and returns the SINGLE next step `{say, point, done}` via **`STEP_PROMPT`** + `parse_next`. The
  frontend (`KonxAI.runGuideStep` → `fetchGuideStep`/`showGuideStep` loop, Next/Stop, `GUIDE_MAX_STEPS=12`)
  draws the arrow via `point_at(name, 60)` (the 60s hold lets a slow user read) and re-fetches against the
  LIVE screen on each Next — so buttons that only appear after an earlier click (Gmail's Send after
  Forward) are seen when their turn comes. The Contextual Guidance tab has ONE **"Guide me step by step"**
  button (`data-guide`) → a small choice: **👉 On-screen** (the step walker) vs **📄 Text list** (the
  existing `screen_help` / `runScreenHelp`). Messaging is honest: "the green arrow is on X" only when
  `point_at` actually found it, amber "look for X and click it" otherwise. `call_gemini_vision` /
  `call_openai_vision` take a `system` param so `VISION_PROMPT` (screen helper) and `STEP_PROMPT` (guide)
  share them. Verified live: "how do I forward this email to someone and send it?" pointed correctly on
  EVERY step (Forward → To box → Send), ending only after Send; ~90% across a variety of tasks/apps. The
  one weak spot found — single-letter Word toolbar buttons (Bold shows "B", Underline "U") — is fixed by
  the tiered `pick_target` + a `STEP_PROMPT` rule to use the control's real Name from the list, never the
  letter drawn on it. **Server-first vision — DONE & VERIFIED LIVE 2026-07-18:** the screen helper + guide
  now route through the Supabase `ai` proxy when signed in, so a signed-in user with no local key gets real
  help instead of the demo brain (keyless test passed) — see "Server-first vision" and "Backend (LIVE)".
  **Still TODO:** field-test on a real low-literacy user; capture the monitor the target app is on (v1.0
  grabs the primary); v1.1 proactive nudges.
- **Radial quick-actions around the orb — DONE & VERIFIED LIVE (2026-07-18).** Hover the floating ball and
  a ring of 6 satellite buttons fans out — **Answer / Improve / Summary / Translate / Explain / Fix** — so
  the user gets AI help written straight into whatever app they're in (e.g. MS Word) with almost no clicks.
  Pieces: `orb.html` — the radial ring (buttons at `--a` angle / `--r=104px`), opens on a ~250ms deliberate
  hover (so a quick press still taps/drags — tap/double-tap/drag all preserved; pressing while open just
  dismisses); the orb window grows to `OPEN=300` logical px and re-centres/clamps on-screen while open,
  shrinks back on mouse-leave (needs the new `set-size`/`outer-size`/`current-monitor` perms in
  `capabilities/default.json`). Satellite click → `emit('konx-radial', task)`. `index.html`:
  `radialAction(task)` → `quick_capture` → `KonxAI.run` (server-first; reuses the orb glow + history) →
  `splitSentences` → `stream_paste`. New Rust **`stream_paste(sentences, append)`** + `send_key` focuses
  the target app once and pastes each sentence chunk via clipboard+Ctrl+V with a ~430ms pause — the
  ChatGPT-like "alive" feel, done reliably (NOT per-char keystrokes, which fight Word's autocorrect).
  `append=true` (**Answer/Explain**) keeps the user's selection + writes the answer on a new line after it;
  `append=false` (the rewrites) replaces the selection. **Depth fix (same day, after 1st test):** Answer/
  Explain first came back as ONE terse sentence — now they carry `deep:true` so `radialAction` routes them
  to the LARGE model (`{deepThink:true}`) AND their instruction asks for a thorough, multi-paragraph,
  ChatGPT-style answer (reasons + an example, plain language); `splitSentences` is paragraph-aware (keeps
  blank-line breaks). The rewrites (Improve/Summary/Translate/Fix) deliberately STAY concise/in-place.
  Verified live in Word: full 3-paragraph answer on "how elections are held in Liberia" streamed in
  cleanly. Note: Answer/Explain always use the bigger model (slightly more cost/use; fine on free Gemini).
- **Answer freedom — the user's request drives shape + length — DONE & VERIFIED LIVE (2026-07-19).** The
  2026-07-18 depth fix over-corrected: `RADIAL_ACTIONS.answer.ins` hard-coded "two or three short
  paragraphs", so **Answer** ignored "give me a list" / a request for a full document. Root cause was that
  fixed format instruction, NOT a length cap (there is NONE in code). Fixes: (1) **new server "generate"
  mode** (`functions/ai/index.ts`): `POST {mode:"generate", text=the request}` → dedicated
  `GENERATE_SYSTEM_PROMPT` (answer/create, not rewrite; user's words drive format+length; plain
  Word-friendly text, NO markdown; no repetition/don't skip sections; ALWAYS full sentences even for a
  one-fact question) + `GENERATE_MAX_TOKENS=8192`; `callGeminiText`/`callOpenAIText` gained an optional
  `maxTokens`. Metering unchanged (per-request, free=40/day — long answers don't cost more). (2)
  **frontend routes Answer/Explain through generate**: `konx-ai.js` `run(text, ins, {generate:true})` →
  `callServer` sends `mode:"generate"` (skips the `Instruction:/Text:` wrapper; forces large tier; skips
  the same-text re-improve retry). `index.html` `RADIAL_ACTIONS` answer/explain are `gen:true` with a
  `req(t)` builder (answer = the question as-is; explain = "Explain the following…: <selection>"); the
  "2–3 paragraphs" wording is gone (`ins` is now only the offline/local-key fallback). (3) **`stripMarkdown`**
  (`index.html`) removes leftover `#`/`*`/`**`/`---`/backticks and turns bullets into "• " (Word can't
  render markdown) — applied to generate results only. (4) **long-doc paste feel**: `splitSentences` pastes
  a whole PARAGRAPH BLOCK at a time for long answers (short answers still drip sentence-by-sentence), blocks
  separated by a SINGLE `\n` (Word's own paragraph spacing gives the gap); Rust `stream_paste` adds a ~45ms
  clipboard-settle before each Ctrl+V and scales the inter-chunk pause from 430ms down to a **200ms floor**
  (faster raced Word → dropped/duplicated lines). Verified live: list → a list; two-page overview complete
  (no repeats/skips) and smooth; short question → a full sentence. **Bold headings — ATTEMPTED then ROLLED
  BACK per Joseph (2026-07-19):** keyboard bold-toggle (Ctrl+B) is unreliable — the "off" fires while Word
  is busy right after a paste and gets dropped → whole doc bold; a "flip bold BEFORE each paste while idle"
  version was built too, but Joseph chose to keep the clean plain-text output. All bold code reverted (no
  `bolds` param on `stream_paste`, no `isHeading`); generate mode + `stripMarkdown` + block-paste KEPT. If
  revisited, use a rich-text (RTF/HTML) clipboard, NOT keyboard toggles.
- **Voice — staged design APPROVED 2026-07-20 via /office-hours.** Full plan (Stage 0 accent spike →
  Stage 1 Voice OUT → Stage 2 Voice IN, one button → Stage 3 conversation) lives at
  `~/.gstack/projects/Teddyrid123-kaeyaAI/LLC-3-main-design-20260720-124309.md`. Founder chose full voice
  after pushback on other approaches (worksheet packs, pilot pricing) — his call, staged so the
  accent-accuracy assumption gets tested before real weeks are spent.
  - **Stage 0 (accent spike) — DONE, PASSED 2026-07-20.** 10 real WhatsApp voice clips from real users,
    scored against Gemini's free Flash tier: **9/10 correct.** The 1 miss ("make this text shorter" heard
    as "make this text shut up") was a recoverable mishearing, not garbage — exactly what Stage 2's
    "show the transcription before acting" rule exists to catch. OpenAI Whisper untested (still blocked
    on the pre-existing `429 insufficient_quota` — no OpenAI billing set up; a cost gap, not an accent
    signal). 90% on the free tier alone clears the design doc's own gate ("if accuracy is high, Voice IN
    proceeds") — **Stage 2 is unblocked.** Throwaway test tool (not shipped): `spike-voice-accent/`
    (`transcribe.mjs` reads the same local `keys.json` the app uses, calls Gemini + Whisper, same
    503-overload → small-model fallback the app already uses in production). Decision logged via
    `gstack-decision-log`.
  - **Stage 1 (Voice OUT) — DONE & VERIFIED LIVE 2026-07-20.** Kaeya reads guidance aloud using Windows'
    built-in speech (Rust `tts` crate, WinRT backend, `default-features = false` to skip the Linux-only
    speech-dispatcher default). New Rust commands `speak_text`/`stop_speaking`, app state `VoiceState`
    (`Mutex<Option<tts::Tts>>` — `tts::Tts` is `unsafe impl Send + Sync` by the crate author, trusting
    WinRT's agile-object marshaling, so one shared instance across Tauri's command threads is safe).
    `speak_text` always passes `interrupt:true` so a new step never talks over the last one. Frontend: a
    **"🔊 Read the steps out loud"** toggle lives inline in the Contextual Guidance tab (not buried in
    Settings — the whole point is reaching someone who struggles to read), off by default, persisted to
    `localStorage['konx-voice-out']` via the existing `wireSwitch` helper. Wired into both the on-screen
    step guide (`showGuideStep`, `endGuide`) and the text-list screen helper (`runScreenHelp`, through a
    `cleanForSpeech` markdown strip). Joseph confirmed it works live. No app-side accent risk here — it's
    reading Kaeya's own generated text, not transcribing a user's voice.
  - **Stage 2 (Voice IN, one push-to-talk button) — DONE & VERIFIED LIVE 2026-07-21.** A new "Voice
    Command" tab holds one push-to-talk button (`voicePttBtn`); recording is captured **entirely in the
    webview** via `getUserMedia` + Web Audio API (`ScriptProcessorNode`), hand-encoded to WAV client-side
    (`encodeWav`) — no Rust/native capture, no Tauri capability needed (mic access is a plain webview API,
    not an `invoke()`-able command, confirmed no capability entry required). Uses **Pointer Events with
    pointer capture** (not mouse/touch listeners) so `pointerup` still fires even if the cursor/finger
    drifts off the round button while held, plus `pointercancel` for an OS-interrupted touch; Space/Enter
    keyboard hold is also supported. `KonxAI.runVoice` (`konx-ai.js`) posts `{mode:"voice", audio}` to the
    Supabase `ai` proxy — **voice has no offline/local-key/demo-brain fallback**, since there's no
    on-device speech-to-text and a mock can't fake a transcript; `canUseVoice()` disables the button
    up front for signed-out users instead of failing after a recording. Server (`functions/ai/index.ts`):
    parses the **real WAV duration from the header itself** (never trusts the client), routes to Gemini
    (`callGeminiMedia`, generalized from the vision call) or OpenAI Whisper (`callOpenAIAudio`, multipart
    upload — Whisper has no small/large split so no overload-retry target), and meters on **two
    independent dimensions**: the existing per-request `consume_quota`/`refund_usage`, plus a new
    per-day **audio-seconds** budget (`consume_audio_seconds`/`refund_audio_seconds`, migration
    `20260720190000_voice_audio_quota.sql`, reserve-then-refund same as the request quota, new
    `usage_daily.audio_seconds` column) — a rejected voice call refunds both. An empty transcript is
    treated as a successful call (silence/background noise, not an error) for voice specifically. The
    **"show the transcription before acting" rule is real, not just described**: `endVoicePtt` → Kaeya
    shows `Kaeya heard: "…"` with **Yes, do this** / **Try again** buttons; only a tap on "Yes" feeds the
    transcript into the existing capture→instruct→rewrite pipeline (`confirmVoice` → `run(t)`) — no path
    auto-acts on a transcript. Joseph tested both Stage 1 and Stage 2 live end-to-end (2026-07-21) — both
    work. **Still open (tracked in `TODOS.md`):** Whisper has zero real accent-accuracy data (blocked on
    OpenAI billing, not an accent signal — Gemini already cleared Stage 0's bar at 9/10); the
    `spike-voice-accent/` accuracy evidence is still a throwaway/gitignored spike, not a real regression
    fixture, pending a privacy decision on the raw clips.
  - **Stage 3 (conversation) — still gated on Stage 2 being watched working in a real classroom** (the
    live desk test above is a good sign but not that field test).
- **Ring redesign — Guide + Voice on the orb ring — BUILT 2026-07-22, AWAITING JOSEPH'S LIVE TEST.**
  Trigger: a friend who already uses Kaeya told his whole office to install it (unprompted), and Joseph
  watched him hit the real friction — reaching On-screen Guide or Voice still meant opening the main
  window and hunting a tab, while the 6 rewrite actions were already one hover-and-click away. Now the
  ring has **8 satellites**: the existing Answer/Improve/Summary/Translate/Explain/Fix plus **🧭 Guide**
  and **🎤 Voice**. Nothing new server-side; both reuse engines that were already live.
  - **Ring geometry:** 8 items at 45° spacing, radius bumped **104px → 120px**, open window 300 → **340**
    logical px, aurora glow 290 → 330px, stagger `:nth-child` rules extended to 8. The radius bump is
    load-bearing, not cosmetic: at the old 104px, 8 buttons plus the existing `scale(1.14)` hover left
    only ~9px between neighbours (they'd visually collide); 120px restores ~21px.
  - **Guide (click-per-step):** highlight a question anywhere → click Guide → Kaeya screenshots, picks the
    next step, and draws the arrow via the existing `point_at`. Click Guide **again** to advance. Uses
    `KonxAI.runGuideStep` + `GUIDE_MAX_STEPS`, entirely in the hidden main window — the main window never
    shows. A small red **✕ stop badge** appears on the orb corner while a walkthrough is active
    (`konx-guide-active` event → `konx-guide-stop-tap`).
    **Two bugs caught in review before they were written:** (1) the first design compared `quick_capture`
    against the stored goal to decide "new question vs. advance" — but users copy other things mid-task
    (an address, a password), which would silently restart the walkthrough with garbage as the goal. Fixed
    to a plain boolean (`ringGuideActive`): a click always means *advance* when a guide is running; a new
    goal requires Stop first. (2) clicking any OTHER satellite mid-guide used to leave stale guide state
    behind — now every non-guide action calls `ringGuideEnd()` first.
  - **Voice (press-and-hold):** the Voice satellite is deliberately NOT wired to `click` like the other 7 —
    it uses pointerdown/up + pointer capture (same pattern as the Voice Command tab's `voicePttBtn`) and
    shows a red recording pulse while held. Release → the existing `startVoiceRecording`/`stopVoiceRecording`/
    `encodeWav`/`KonxAI.runVoice` pipeline runs → a **confirmation bubble on the orb** shows
    `Kaeya heard: "…"` with Yes / Try again. The "never auto-act on a transcript" Stage 2 safety rule is
    preserved. On **Yes**, the raw transcript is pasted via `apply_text` as fresh CONTENT (standard paste
    semantics: replaces a selection if one exists, inserts at the cursor otherwise) — the user then
    highlights it and taps any other ring action. **Note:** "Voice" now means two different things by entry
    point — the tab treats the transcript as an *instruction* applied to a selection (`confirmVoice` →
    `run(t)`, unchanged); the ring pastes it as *content*. Intentional, but worth watching for confusion.
    Voice has no offline fallback, so a signed-out tap just flashes the orb amber (`canUseVoice()` gate).
  - **Bubble/canvas trick:** the confirmation bubble reuses the ring's already-expanded 340px window
    instead of needing its own resize logic — `keepOpenForBubble` makes `closeMenu()` hide the ring
    *without* shrinking the window, and `restoreWindowGeom()` shrinks it once the bubble is dismissed.
  - **Follow-ups shipped same day (2026-07-22), all from Joseph's feedback:**
    - **Voice hands off to the ring.** Confirming a transcript used to just paste the words and stop.
      Now **Yes → the bubble swaps for the ring** and whatever the user picks runs against what they
      said (speak a question → Answer → it lands in Word; speak a task → Guide → arrows start). The
      transcript is held in memory and **never pasted on its own** — speaking "show me how to change my
      desktop background" was dumping that sentence into the user's document. Because dictated text has
      nothing selected to replace, spoken input always writes at the cursor (`append:true`) even for the
      rewrite actions. Held text is discarded via `konx-voice-discard` if that ring closes without a
      pick, so it can't leak into an unrelated action later.
    - **The user picks their own ring.** Settings → The floating ball → **"Buttons around the ball"**,
      any 3-8 of the catalog. Saved to `localStorage['konx-ring']`, pushed live to the orb via a
      **`konx-ring`** event (redraws immediately, no restart). The picker disables chips at the limits
      rather than failing on click. Satellites are no longer hardcoded markup: **`renderRing()`** draws
      them and **computes geometry from the count** — radius solves `2*r*sin(180/n) >= 95px` so
      neighbours keep a real gap once the existing `scale(1.14)` hover growth is counted (3-6 → 104px,
      7 → 110px, 8 → 125px), with window size + aurora glow sized to match. Stagger delays moved from
      hardcoded `:nth-child` rules to an inline `--d` per button (hover/active reset it to `0s`, or
      feedback would lag by the fan-out delay).
    - **Guide asks which mode first**, matching the in-app button: a bubble on the ball offering
      **👉 Point on screen** vs **📄 Show a step list**. Mid-walkthrough, a Guide click still just
      means "next step". The two modes are mutually exclusive — starting one clears the other.
    - **Text Guide card — BUILT (was deferred).** New **`guidecard`** window (`src/guidecard.html`):
      low opacity so the real app shows through, lifting to full on hover; always-on-top; a grab strip
      along the top is the only drag handle. Content is the one-shot `KonxAI.runVision` numbered list
      (same as the tab's Text list mode). New Rust `show_guide_card`/`hide_guide_card`; it parks
      top-right on FIRST show only, then stays where the user dragged it.
      **Drag is JS-driven** (`pointerdown` → `setPosition`, throttled to one call per
      `requestAnimationFrame`) — NOT Tauri's `data-tauri-drag-region`, because the native drag path
      needs an activatable window and this one is `focus:false` so it never steals focus. Firing
      `setPosition` on every raw `pointermove` floods IPC and makes the drag lag.
      **Both window gotchas handled:** `guidecard` is in `capabilities/default.json` `windows` (else
      zero permissions → never receives its events, exactly what bit `overlay`), AND in the
      **foreground-tracker exclude list** in `lib.rs` — critical here because unlike the click-through
      arrow overlay, this card is interactive and WILL take foreground when dragged; without the
      exclusion the tracker would record Kaeya's own card as "the app the user was working in" and the
      next copy/paste would target the card instead of Word.
    - `orb.html` window-geometry bookkeeping collapsed into one `expandWindow()`, with shrink-back
      tracked by a `restoring` promise that expands must await — otherwise a bubble opening mid-shrink
      measures the expanded window and saves THAT as the collapsed size, leaving the orb permanently
      oversized.
  - **Still NOT built:** per-user ring ordering (ring follows catalog order), and the step-by-step
    variant of the card (it shows the full list, not one step at a time synced to the arrow).
  - **Regression watch on next live test:** all 6 original ring actions still work (the dispatch in
    `radialAction()` was restructured to branch early for guide/voice), and the 6-item fan-out stagger
    still looks right after the `:nth-child` extension.
  - Design doc: `~/.gstack/projects/Teddyrid123-kaeyaAI/LLC-3-main-design-20260722-151238.md` (3 rounds of
    adversarial review in /office-hours, then /plan-eng-review + outside voice — 9 more fixes).
- **UI polish pass — DONE 2026-07-23, rebuilt, awaiting Joseph's install check.** Three touches from
  Joseph's own screenshots/markup, ahead of the first outside-tester round:
  - **Which AI model answers is no longer shown anywhere.** Removed the OpenAI/Gemini switch from the
    top bar and from Settings → Default AI brain (`index.html`: `#provSwitch`, `#defBrain`, and their
    `.provswitch`/`paintProv`/`paintDefBrain` JS all deleted). Every "Handled by Gemini" / "Handled by
    GPT-4o" result badge now just says **"Kaeya"**. The Pro-plan feature list on the Subscription tab
    also had brand names in it ("Fast Gemini Flash brain", "Top brains: GPT-4o & Gemini Pro") — reworded
    to "Fast, everyday AI brain" / "Kaeya's strongest AI brain". The router still has a provider setting
    under the hood (`KonxAI.config.activeProvider`, `localStorage['konx-provider']`) and a previously
    saved choice is still honoured on load — it's just not user-facing any more. Rationale: a
    non-technical user has no basis to choose between models, and naming them just invites "is the other
    one better?"
  - **Welcome-screen tagline replaced.** The instructional paragraph under "Welcome to Kaeya" ("Highlight
    text anywhere and tap the floating ball — or paste text into Kaeya — then pick what you'd like it to
    do.") is now one line: **"Ask anything. Kaeya shows you exactly where to click."** `.sub` bumped
    14.5px→16px / weight 500 to read as a tagline, not fine print — the how-to already lives on the tabs
    below.
  - **Ring icons are now line-style SVG, not emoji.** Emoji render as the OS's own colour glyphs (varies
    by Windows build, ignores hover-color tint). Added an `ICON` map of 8 hand-drawn inline SVG paths in
    `orb.html` (answer/improve/summarize/translate/explain/fix/guide/voice), rendered via `iconSvg(id)`
    inside `renderRing()`; `.sat .emo` restyled to size/host an `<svg>` with `stroke:currentColor` so the
    existing hover-tint CSS keeps working with zero extra rules. **Inline SVG, not a Font Awesome
    import** — the no-CDN rule (see Conventions) rules out pulling in an icon font. `index.html`'s
    Settings → "Buttons around the ball" picker keeps its own copy of the same paths (`RING_ICON`/
    `ringIconSvg`, `.rp-emo`) since that window can't reach into `orb.html`'s JS — paths must stay
    byte-identical between the two so the picker preview matches what actually appears on the ball.
  - Rebuilt (`Kaeya_0.1.0_x64-setup.exe` / `.msi`, same paths as before) — **not yet installed/confirmed
    by Joseph.** Verify before the next outside-tester share: top bar + Settings show no model names, all
    8 ring icons render and stay legible at 22px, tagline reads as one line.

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
  `set_orb_visible`, `ai_generate`, `screen_help`.
- **Events**: orb→main `konx-captured` (payload = captured text); main→orb `konx-style`
  (payload = look id, keeps the orb's appearance in sync). Look/float settings persist
  in `localStorage`.

## The on-screen helper (v1.0 — the core wedge, `screen_help` in `lib.rs`)
- Flow: user types a question → clicks **"Explain my screen"** (Contextual Guidance tab,
  `data-screen="1"`) → JS `runScreenHelp` calls `KonxAI.runVision` → Rust `screen_help`.
- `screen_help` (Rust): **hides the `main` window first** (so the photo shows the app BEHIND
  Kaeya, not Kaeya itself), waits ~200ms for repaint, captures the primary monitor via **`xcap`**,
  shrinks wide screens + encodes **JPEG** (small uploads for slow connections; via the `image`
  crate with the `jpeg` feature + `base64`), then sends photo + question to the vision model with
  a friendly `VISION_PROMPT` (short, numbered, plain, NO markdown), restores the window, returns
  `{ text, engine }`. Same transient-overload retry as `ai_generate` — now broadened so **429 (rate
  limit) AND 503 (high demand) both fall back to the small model** (`gemini-flash-lite-latest`,
  which is multimodal and stays available on the free tier when `gemini-flash-latest` is busy).
- Frontend: `formatGuidance` (in `index.html`) renders the answer as a clean numbered list
  (HTML-escaped; `**bold**`→`<strong>`, strips `* # \``, one step per line, styled step circles).
  Guidance results get `.result.guidance` (hides Replace/Save — it's advice, not a rewrite).
- **Server-first vision — DONE & VERIFIED LIVE (2026-07-18, keyless test passed):** `screen_help` and `guide_step`
  now route through the Supabase `ai` proxy when signed in — Rust captures the screen + builds the
  prompt, then `call_server_vision` POSTs `{image, system, prompt, provider, tier, model, temperature}`
  to `/functions/v1/ai` with the JWT + `apikey` anon; the server runs the vision model with its key and
  meters it (same quota as text). They take optional `auth_token`/`server_url`/`server_anon` (passed by
  `konx-ai.js` via `serverAuth()`); a 429/401 is surfaced as `SERVER_LIMIT`/`SERVER_AUTH` (NOT bypassed
  by the local key), other server errors fall through to the **local key** (`%APPDATA%\KonX\keys.json`),
  then the demo brain. So a signed-in user with no local key now gets real vision. Rust deps: `xcap`,
  `image` (jpeg), `base64`. See "Backend (LIVE)" for the Edge Function's vision branch.

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
  - **Transient-overload fallback (2026-07-16):** `gemini-flash-latest` (the large tier) can
    return **503 UNAVAILABLE "high demand"** even with a valid key — it hit Joseph on his first
    signed-in "improve writing" test and dropped him to the demo brain. Both the server
    (`functions/ai/index.ts`) and the local Rust path (`lib.rs ai_generate`) now **auto-retry
    once on the provider's small model** (`gemini-flash-lite-latest`, which stays available)
    when the requested model is transiently overloaded (503 / "high demand" / "overloaded" /
    "unavailable" / "try again"). Keeps rewrites real instead of falling back to the mock.
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
- **Security hardening (2026-07-16, from `/cso` audit — migration `20260716120000_plan_hardening.sql`,
  DEPLOYED):** the plan is now read from the **`subscriptions`** table (users cannot write it;
  only the future service-role payment webhook sets it), NOT from the user-editable `profiles.plan`
  — and `update (plan)` on `profiles` is revoked from `authenticated`/`anon`. This closed a hole
  where a signed-in free user could `PATCH` their own `profiles.plan` to `pro` and spend the
  server keys. Usage is now consumed atomically via `consume_quota` + `refund_usage` (reserve →
  call → refund on failure), closing a check-then-increment race. **Payments must set
  `subscriptions.plan`/`status='active'` via the service-role key server-side.** Report:
  `.gstack/security-reports/2026-07-16-cso-keys.json` (local).

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

## Skill routing (gstack — Kaeya's AI team)
Kaeya runs on the **gstack** workflow (Garry Tan's "thin harness, fat skills"). Treat these
skills as the team. Match the ceremony to the size of the work: big / user-facing / risky →
route it through the team; a trivial one-line fix → just do it. When a request matches a
skill, invoke it via the Skill tool. When in doubt, invoke the skill.

- Product idea / new feature direction (payments, launch) → invoke **/office-hours**, then **/autoplan**
- Strategy / scope decisions → invoke **/plan-ceo-review**
- Architecture of a feature → invoke **/plan-eng-review**
- Full review pipeline (CEO + eng + design + devex) → invoke **/autoplan**
- Design system / plan review → invoke **/design-consultation** or **/plan-design-review**
- Bugs / errors / "why is this broken" → invoke **/investigate**
- Code review of a change/diff → invoke **/review**
- Visual polish of the UI → invoke **/design-review**
- Ship / deploy / open a PR → invoke **/ship** or **/land-and-deploy**
- Security pass before distributing the .exe → invoke **/cso** (high value: key handling + extractable-key risk)
- Save / resume working context → invoke **/context-save** / **/context-restore**

**Kaeya-specific caveats:**
- **Web browsing:** always use **/browse** (never `mcp__claude-in-chrome__*`).
- Kaeya is a **Tauri desktop app**. `/browse`, `/qa`, and `/design-review` CAN open the plain
  HTML frontend (`konx-app/src/index.html`, `orb.html`) via `file://` to test/critique the
  sign-in gate, popup layout, and dark mode. But the **native capture→rewrite flow drives the
  real keyboard/clipboard**, so that end-to-end test must be run by Joseph on his machine.
- Repo is now on GitHub: `https://github.com/Teddyrid123/kaeyaAI.git` (branch `main`). This
  unlocks `/review`, `/ship`, and the parallel-PR loop.
