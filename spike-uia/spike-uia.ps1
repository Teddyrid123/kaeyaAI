<#
  Kaeya Assistant - UIAutomation Spike (Step-1 technical gate T2 / decision D4)
  ----------------------------------------------------------------------------
  THE ONE QUESTION THIS ANSWERS:
     Can Windows tell us the EXACT location and name of a button on screen
     (like Gmail's "Forward" button), so Kaeya can point an arrow at the REAL
     spot instead of the AI guessing where it is?

  WHY IT MATTERS:
     If YES, arrows become near-perfect and work on the live screen - that
     kills the "wrong arrow" risk that this whole feature lives or dies on.
     If NO (especially inside web pages like Gmail), we fall back to the
     AI-vision plan. This tiny test decides which feature we build for real.

  HOW TO RUN IT (plain steps):
     1. Open the app you want to test FIRST. For the real test, open Gmail in
        Chrome and open an email so the "Forward" button is visible. (Then also
        try WhatsApp Web, and a normal Windows app like Notepad or Settings.)
     2. Right-click this file  ->  "Run with PowerShell".
        (Or in a PowerShell window:  .\spike-uia.ps1  Forward )
     3. You get a 5-second countdown. During it, CLICK the app you want to test
        so it is the front window. Then just wait.
     4. Read the result. It plainly says whether Windows found the button and
        where it is, or whether the app hides its buttons from Windows.

  You can test a different word:   .\spike-uia.ps1  "Send"
  Uses ONLY built-in Windows. No Rust, no Node, no installs.
#>

param(
    [string]$Term = "Forward",   # the button text to look for
    [int]$Countdown = 5          # seconds to focus your target app
)

$ErrorActionPreference = 'Stop'

# --- Save everything to a text file AND keep the window open at the end ------
# (so you can read the result even if the window would normally close.)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$OutFile = Join-Path $ScriptDir 'spike-result.txt'
try { Start-Transcript -Path $OutFile -Force | Out-Null } catch {}

# Always pause before the window closes - even if something errors out.
function Stop-Spike {
    param([int]$code = 0)
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ""
    Write-Host "A copy of everything above was saved to:" -ForegroundColor Cyan
    Write-Host "  $OutFile" -ForegroundColor Cyan
    Write-Host ""
    try { Read-Host "Press Enter to close this window" | Out-Null } catch {}
    exit $code
}

# --- Load the Windows UIAutomation libraries (built in to Windows) ----------
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# --- Tiny helper to find the window the user is looking at ------------------
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

function Write-Head($t) { Write-Host ""; Write-Host "==== $t ====" -ForegroundColor Cyan }

Write-Head "Kaeya UIAutomation spike - looking for: '$Term'"
Write-Host "Click the app you want to test NOW. Reading the front window in..." -ForegroundColor Yellow
for ($i = $Countdown; $i -ge 1; $i--) { Write-Host "  $i..." ; Start-Sleep -Seconds 1 }

# --- Grab the foreground window as a UIAutomation element -------------------
$hwnd = [FgWin]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No foreground window found. Try again." -ForegroundColor Red; Stop-Spike 1 }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) { Write-Host "Could not read that window with UIAutomation." -ForegroundColor Red; Stop-Spike 1 }

$winName = ""
try { $winName = $root.Current.Name } catch {}
Write-Host ""
Write-Host "Reading window: '$winName'" -ForegroundColor Green

# --- Walk the window's element tree (bounded so it can't run forever) -------
$walker   = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue    = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue($root)

$maxNodes = 8000
$deadline = (Get-Date).AddSeconds(25)
$seen        = 0
$namedCount  = 0
$matches     = New-Object System.Collections.Generic.List[object]
$sampleNamed = New-Object System.Collections.Generic.List[object]

function Rect-IsReal($r) {
    if ($null -eq $r) { return $false }
    if ([double]::IsInfinity($r.Width) -or [double]::IsInfinity($r.X)) { return $false }
    return ($r.Width -gt 0 -and $r.Height -gt 0)
}

$termLower = $Term.ToLower()

while ($queue.Count -gt 0 -and $seen -lt $maxNodes -and (Get-Date) -lt $deadline) {
    $el = $queue.Dequeue(); $seen++

    try {
        $name = $el.Current.Name
        $ct   = ($el.Current.ControlType.ProgrammaticName) -replace 'ControlType\.', ''
        $rect = $el.Current.BoundingRectangle

        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $namedCount++
            $rowReal = Rect-IsReal $rect
            $row = [pscustomobject]@{
                Name = $name; Type = $ct
                X = if ($rowReal) { [int]$rect.X } else { $null }
                Y = if ($rowReal) { [int]$rect.Y } else { $null }
                W = if ($rowReal) { [int]$rect.Width } else { $null }
                H = if ($rowReal) { [int]$rect.Height } else { $null }
            }
            # keep a small sample so we can show the tree IS exposed even if the term isn't found
            if ($sampleNamed.Count -lt 25 -and $rowReal -and
                @('Button','Hyperlink','MenuItem','ListItem','Text','Edit','CheckBox','TabItem') -contains $ct) {
                $sampleNamed.Add($row)
            }
            if ($name.ToLower().Contains($termLower)) { $matches.Add($row) }
        }
    } catch {}

    try {
        $child = $walker.GetFirstChild($el)
        while ($null -ne $child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
    } catch {}
}

# --- Report -----------------------------------------------------------------
Write-Host ""
Write-Host "Scanned $seen elements. $namedCount had a name Windows could read." -ForegroundColor Green

Write-Head "MATCHES for '$Term'"
if ($matches.Count -gt 0) {
    $matches | ForEach-Object {
        if ($null -ne $_.X) {
            Write-Host ("  FOUND: '{0}'  [{1}]  at X={2} Y={3}  size {4}x{5}" -f $_.Name,$_.Type,$_.X,$_.Y,$_.W,$_.H) -ForegroundColor Green
        } else {
            Write-Host ("  FOUND (no location): '{0}'  [{1}]" -f $_.Name,$_.Type) -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  No element named like '$Term' was found in this window." -ForegroundColor Yellow
}

Write-Head "A few things Windows COULD see here (proves the tree is exposed)"
if ($sampleNamed.Count -gt 0) {
    $sampleNamed | Select-Object -First 15 | ForEach-Object {
        Write-Host ("  - '{0}'  [{1}]  at X={2} Y={3} size {4}x{5}" -f $_.Name,$_.Type,$_.X,$_.Y,$_.W,$_.H)
    }
} else {
    Write-Host "  (Almost nothing with a location was exposed.)" -ForegroundColor Yellow
}

# --- Plain-language verdict -------------------------------------------------
Write-Head "VERDICT"
$hasLocatedMatch = ($matches | Where-Object { $null -ne $_.X } | Measure-Object).Count -gt 0
if ($hasLocatedMatch) {
    Write-Host "  YES - Windows gave us the exact spot of '$Term'. The hybrid (Windows-rect) path works here." -ForegroundColor Green
} elseif ($namedCount -ge 15 -and $sampleNamed.Count -gt 0) {
    Write-Host "  PARTLY - This window exposes its buttons to Windows, but '$Term' wasn't among them." -ForegroundColor Yellow
    Write-Host "           Try the button's exact label, e.g.  .\spike-uia.ps1 `"Reply`"  - or scroll it into view first." -ForegroundColor Yellow
} else {
    Write-Host "  NO - This window hides its contents from Windows (common for some web pages)." -ForegroundColor Red
    Write-Host "       For Chrome/Gmail: fully quit Chrome, relaunch it once with accessibility on:" -ForegroundColor Red
    Write-Host '         Start Chrome via:  chrome.exe --force-renderer-accessibility' -ForegroundColor Red
    Write-Host "       then re-run this spike. If it's still NO, this app needs the AI-vision fallback." -ForegroundColor Red
}
Write-Host ""
Write-Host "Run again on another app (open it first):  .\spike-uia.ps1 $Term" -ForegroundColor DarkGray

Stop-Spike 0
