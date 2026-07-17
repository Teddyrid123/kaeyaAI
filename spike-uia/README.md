# Kaeya UIAutomation Spike

**What this proves:** whether Windows can tell Kaeya the *exact* location and name of a
button on screen (like Gmail's **Forward** button) — so Kaeya can point an arrow at the
real spot instead of the AI guessing.

**Why it matters:** if YES, arrows become near-perfect and work on the live screen (kills
the "wrong arrow" risk). If NO — especially inside web pages — we build the AI-vision
fallback instead. This one test decides which version of the on-screen pointing we build.

This is technical gate **T2 / decision D4** from the design doc
(`~/.gstack/projects/Teddyrid123-kaeyaAI/LLC-3-main-design-20260717-115846.md`).

## How to run it

1. **Open the app you want to test first.** For the main test: open Gmail in Chrome and
   open an email so the **Forward** button is visible.
2. **Right-click `spike-uia.ps1` → "Run with PowerShell".**
   (Or in a PowerShell window: `.\spike-uia.ps1 Forward`)
3. During the **5-second countdown**, click the app you want to test so it's the front window.
4. Read the plain-language **VERDICT** at the bottom.

Test a different word: `.\spike-uia.ps1 "Send"`

## Run it on three things and note the verdict for each

| App | How to open | Verdict (YES / PARTLY / NO) |
|-----|-------------|------------------------------|
| Gmail (Chrome) | open an email, Forward visible | |
| WhatsApp Web (Chrome) | open a chat | |
| A native app (Notepad / Settings) | e.g. `Term = "File"` for Notepad | |

- **YES on Gmail + WhatsApp Web** → build the Windows-rect hybrid (near-perfect, live).
- **NO on the web apps but YES on native** → web apps use the AI-vision fallback; native
  apps can use the hybrid.
- If Chrome says NO: fully quit Chrome, relaunch once with `chrome.exe --force-renderer-accessibility`,
  then re-run.

Uses only built-in Windows PowerShell. No installs.
