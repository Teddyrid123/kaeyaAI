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

