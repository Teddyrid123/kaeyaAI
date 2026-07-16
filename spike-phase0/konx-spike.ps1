<#
  KonX Assistant - Phase 0 Spike
  --------------------------------
  GOAL: Prove the make-or-break feature works on YOUR real machine:
        capture the text you have selected in ANY app  ->  transform it
        ->  replace it in place (no manual copy/paste by the user).

  This uses ONLY built-in Windows PowerShell. No Rust, no Node, no installs.

  HOW IT WORKS (the exact mechanism the real product will use):
     1. You select text in Word / Chrome / Notepad.
     2. Script sends Ctrl+C  -> reads it from the clipboard.
     3. Script transforms the text (stubbed "improve" - no AI yet).
     4. Script puts the new text on the clipboard and sends Ctrl+V,
        overwriting your selection in place.

  WHAT TO WATCH: does your selected text get replaced correctly, in the
  app you were using, without you touching the keyboard?
#>

Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'

# ---- The "improve" transform (STUB). Swap this for a real AI call later. ----
function Improve-Text {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return $text }

    # A believable "clean up grammar" stub so the change is visible but sane:
    #  - collapse runs of whitespace
    #  - trim ends
    #  - capitalize the first letter
    #  - ensure it ends with a period
    $t = ($text -replace '\s+', ' ').Trim()
    if ($t.Length -gt 0) {
        $t = $t.Substring(0,1).ToUpper() + $t.Substring(1)
    }
    if ($t -notmatch '[.!?]$') { $t = "$t." }
    return $t
}

Clear-Host
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  KonX Assistant - Phase 0 Spike" -ForegroundColor Cyan
Write-Host "  (text capture -> improve -> replace in place)" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "STEP 1: Open Notepad / Word / a browser text box." -ForegroundColor Yellow
Write-Host "STEP 2: Type a messy sentence and SELECT it with your mouse." -ForegroundColor Yellow
Write-Host "STEP 3: Leave that selection highlighted and switch focus to it" -ForegroundColor Yellow
Write-Host "        during the countdown below (click into that window)." -ForegroundColor Yellow
Write-Host ""
Write-Host "Try this exact test text in Notepad:" -ForegroundColor Gray
Write-Host '   the   quick brown fox   jumped over the lazy dog' -ForegroundColor Gray
Write-Host ""

# Give the user time to click into their target app and keep text selected.
for ($i = 5; $i -ge 1; $i--) {
    Write-Host ("  Capturing in $i ... (click into your text now, keep it selected)") -ForegroundColor Magenta
    Start-Sleep -Milliseconds 1000
}

# Preserve whatever was on the clipboard so we can restore it afterward.
$savedClip = ""
try { $savedClip = Get-Clipboard -Raw } catch { $savedClip = "" }

# --- 1. Capture the current selection via Ctrl+C ---
[System.Windows.Forms.SendKeys]::SendWait("^c")
Start-Sleep -Milliseconds 250   # give the OS time to populate the clipboard

$original = ""
try { $original = Get-Clipboard -Raw } catch { $original = "" }

if ([string]::IsNullOrWhiteSpace($original)) {
    Write-Host ""
    Write-Host "No text captured. Nothing was selected, or the app blocked Ctrl+C." -ForegroundColor Red
    Write-Host "Re-run and make sure text stays HIGHLIGHTED in the focused window." -ForegroundColor Red
    return
}

# --- 2. Transform ---
$improved = Improve-Text $original

Write-Host ""
Write-Host "----- CAPTURED (before) -----" -ForegroundColor DarkGray
Write-Host $original
Write-Host "----- IMPROVED (after) ------" -ForegroundColor Green
Write-Host $improved
Write-Host "-----------------------------" -ForegroundColor DarkGray
Write-Host ""

# --- 3. Put improved text on clipboard and paste over the selection ---
Set-Clipboard -Value $improved
Start-Sleep -Milliseconds 120
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 250

Write-Host "Done. Look at your app - the selected text should now be replaced." -ForegroundColor Cyan
Write-Host ""

# --- 4. Restore the user's original clipboard (good hygiene) ---
Start-Sleep -Milliseconds 300
if ($savedClip -ne "") {
    try { Set-Clipboard -Value $savedClip } catch {}
}
