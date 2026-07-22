# TODOS

Deferred work captured during reviews. Each item has enough context to pick up cold.

## Test Whisper against the accent-spike clips once OpenAI billing is added
**Why:** Stage 2 (Voice IN) ships with both Gemini and OpenAI Whisper selectable as the
speech-to-text provider, but Whisper has zero accent-accuracy data behind it — every
attempt during the Stage 0 spike hit `429 insufficient_quota` (no OpenAI billing set up).
Gemini already cleared the bar with a real 9/10 score; Whisper should get the same bar
before anyone trusts it as much as Gemini.
**Context:** `spike-voice-accent/transcribe.mjs` already calls both providers — the
Whisper path is written and tested for error handling, it just needs real credit on the
OpenAI account to produce actual transcripts. Once that's added, re-run it against the
same 10 clips in `spike-voice-accent/clips/` and fill in a scorecard the same way the
Gemini run was scored.
**Depends on:** OpenAI billing/credit being added.
**Source:** /plan-eng-review, Voice Stage 2, 2026-07-20.

## Promote spike-voice-accent/ from a throwaway script into a real eval fixture
**Why:** the 9/10 Gemini score is the only accuracy evidence the entire Voice IN feature
rests on. Right now it lives in a gitignored, easy-to-delete spike folder. If a future
change swaps STT providers, tweaks the transcription prompt, or upgrades a model, nothing
would catch a silent accuracy regression on Liberian English specifically.
**Context:** 10 real clips + scored transcripts already exist in
`spike-voice-accent/results/`. Needs a privacy decision first: store only the
scored transcript pairs (safe) vs. keep the raw audio too (needs explicit consent from
the people who recorded them, since these are real identifiable voices).
**Depends on:** the privacy decision above.
**Source:** /plan-eng-review, Voice Stage 2, 2026-07-20.

## Build Approach B: in-app feedback capture, once tester volume justifies it
**Why:** the 2026-07-21 "get Kaeya into more hands" design doc chose the cheap, fast option
(zip + WhatsApp feedback) over building durable in-app feedback capture, correctly judging
the durable version premature at 3-5 testers. That reasoning won't necessarily be
re-derivable later — this marks the trigger so a future session can recognize it instead of
re-debating scope from scratch.
**Context:** add a small "Send feedback" box inside Kaeya (Settings tab) posting to a new
`feedback` table in the already-live Supabase project, reusing the existing auth session
(`kaeya-auth.js`) and the RLS/migration conventions already established for
`history`/`saved` (see Approach B in that design doc for the full shape).
**Depends on:** tester volume actually becoming unmanageable via WhatsApp/email threads —
not a fixed date or count, a felt signal (Joseph or whoever is triaging feedback loses track
of who reported what).
**Source:** /plan-eng-review, "get Kaeya into more hands," 2026-07-21.

## Step-sync the floating guide card with the on-screen arrow
**Why:** the card (`konx-app/src/guidecard.html`) currently shows the WHOLE step list from a
single `KonxAI.runVision` call — the same one-shot behaviour as the in-app "Text list" mode.
The on-screen arrow mode is different: it re-reads the live screen every step
(`KonxAI.runGuideStep`), which is why it can point at buttons that only appear after an
earlier click. A step-synced card would show one step at a time next to the arrow, combining
both. Joseph was told plainly that the card is one-shot, so this is a known gap, not a
surprise.
**Context:** the reactive engine already exists (`ringGuideStart`/`ringGuideStep` in
`index.html`, `guide_step` in `lib.rs`). The work is rendering the current step's `say` text
into the card instead of the full list, adding a Next button inside the card, and deciding
what the card shows when the arrow can't find its element (today the orb flashes amber).
**Depends on:** Joseph actually wanting it — he may find the full list more useful, since it
lets a slow reader see the whole task before starting. Ask before building.
**Source:** ring redesign follow-ups, 2026-07-22.

## Let the user reorder the ring, not just choose it
**Why:** the Settings picker ("Buttons around the ball") controls WHICH buttons appear but
not WHERE — the ring always follows the fixed catalog order in `RING_CATALOG`. A user who
uses Guide constantly can't move it to the top of the ring where it's easiest to hit.
**Context:** both `orb.html` (`renderRing`) and `index.html` (`paintRingPick`) already work
off an ordered array of ids; the saved `localStorage['konx-ring']` list IS the order. The
picker deliberately re-sorts into catalog order on every change — removing that sort plus
adding drag-to-reorder (or simple up/down arrows) in the picker is most of the work.
**Depends on:** nothing technical. Low priority — deliberately skipped as scope nobody asked
for, and worth confirming a real user wants it before building.
**Source:** ring redesign follow-ups, 2026-07-22.

