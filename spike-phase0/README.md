# KonX Assistant — Phase 0 Spike

**Purpose:** prove the single make-or-break feature before we build the full app —
capturing your selected text and replacing it *in place*, in any Windows app.

No installs. Uses only built-in Windows PowerShell.

## How to run

> ⚠️ You must run this **yourself, interactively**, in a normal PowerShell window —
> it drives your real keyboard/clipboard against whatever app you have focused.
> It cannot be run for you from an automated tool.

1. Open **Notepad**. Type a messy line, e.g.:
   ```
   the   quick brown fox   jumped over the lazy dog
   ```
2. **Select** that line with your mouse (keep it highlighted).
3. Open **PowerShell** and run:
   ```powershell
   cd "$HOME\desktop\web project\vero\spike-phase0"
   powershell -ExecutionPolicy Bypass -File .\konx-spike.ps1
   ```
4. During the 5-second countdown, **click back into Notepad** so your highlighted
   text is in the focused window. Don't click anywhere else.
5. Watch: the selected text should be **replaced** by the cleaned-up version, and
   the console prints the before/after.

## Test it in several apps

Repeat the test in each, and note what happens:

- [ ] **Notepad** (baseline — should just work)
- [ ] **WordPad / Microsoft Word**
- [ ] **A browser text box** (Chrome/Edge — e.g. a Gmail compose or a search box)
- [ ] **Google Docs** (this is the tricky one)

## What to report back to me

For each app: **did the selected text get replaced correctly?** And if not —
did it do nothing, paste in the wrong place, or duplicate text? That tells us
exactly how robust the "in-place replace" mechanism is and where we'll need
app-specific handling in the real product.

## Notes / expectations

- The "improve" step here is a **stub** (whitespace cleanup + capitalization +
  ending period). No AI yet — that's intentional. We're testing the plumbing,
  not the intelligence.
- Some secure fields (password boxes, some banking apps) block simulated Ctrl+C
  by design — that's expected and fine.
- The script restores your previous clipboard contents when it finishes.
