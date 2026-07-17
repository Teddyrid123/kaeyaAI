<#
  Kaeya Assistant - UIAutomation LIVE ARROW spike (proves build-piece #2)
  ----------------------------------------------------------------------
  THE QUESTION THIS ANSWERS:
     Can Kaeya draw an arrow on the REAL button, on your LIVE screen -
     right on top of Gmail's Forward button, while you look at Gmail?

  This builds on the first spike (which proved Windows can FIND the button).
  Now it also DRAWS a bright box + arrow + "click here" label on the real spot.

  HOW TO RUN IT:
     1. Open Gmail in Chrome, open an email so "Forward" is visible.
     2. Right-click this file -> "Run with PowerShell".
     3. During the 5-second countdown, CLICK your Gmail window.
     4. Watch: a green box + red arrow should appear on the real Forward link
        for a few seconds. Then it clears itself.

  Try another button:  .\spike-uia-arrow.ps1 "Send"
  Uses ONLY built-in Windows. No installs, no Rust build.
#>

param(
    [string]$Term = "Forward",
    [int]$Countdown = 5,
    [int]$ShowSeconds = 8
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }
$OutFile = Join-Path $ScriptDir 'spike-arrow-result.txt'
try { Start-Transcript -Path $OutFile -Force | Out-Null } catch {}

function Stop-Spike {
    param([int]$code = 0)
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ""
    Write-Host "Saved a copy to: $OutFile" -ForegroundColor Cyan
    try { Read-Host "Press Enter to close this window" | Out-Null } catch {}
    exit $code
}

# --- Make this process DPI-aware so drawn pixels line up with real pixels ----
# (critical on scaled displays, e.g. 125%/150% - otherwise the arrow is offset.)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class DpiAware { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
try { [DpiAware]::SetProcessDPIAware() | Out-Null } catch {}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System; using System.Runtime.InteropServices;
public class FgWin2 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@

Write-Host "==== Kaeya LIVE ARROW spike - looking for: '$Term' ====" -ForegroundColor Cyan
Write-Host "Click the app you want to test NOW..." -ForegroundColor Yellow
for ($i = $Countdown; $i -ge 1; $i--) { Write-Host "  $i..."; Start-Sleep -Seconds 1 }

$hwnd = [FgWin2]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No foreground window." -ForegroundColor Red; Stop-Spike 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $root) { Write-Host "Could not read that window." -ForegroundColor Red; Stop-Spike 1 }

$winName = ""; try { $winName = $root.Current.Name } catch {}
Write-Host "Reading window: '$winName'" -ForegroundColor Green

# --- Find all elements whose name contains the term (bounded walk) ----------
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue  = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue($root)
$deadline = (Get-Date).AddSeconds(25); $seen = 0; $maxNodes = 8000
$cands = New-Object System.Collections.Generic.List[object]
$termLower = $Term.ToLower()

function Rect-OnScreen($r, $vs) {
    if ($null -eq $r) { return $false }
    if ([double]::IsInfinity($r.Width) -or [double]::IsInfinity($r.X)) { return $false }
    if ($r.Width -le 0 -or $r.Height -le 0) { return $false }
    # must be inside the visible desktop area
    return ($r.X -ge $vs.Left -and $r.Y -ge $vs.Top -and ($r.X + $r.Width) -le ($vs.Left + $vs.Width) -and ($r.Y + $r.Height) -le ($vs.Top + $vs.Height))
}

while ($queue.Count -gt 0 -and $seen -lt $maxNodes -and (Get-Date) -lt $deadline) {
    $el = $queue.Dequeue(); $seen++
    try {
        $name = $el.Current.Name
        if (-not [string]::IsNullOrWhiteSpace($name) -and $name.ToLower().Contains($termLower)) {
            $ct = ($el.Current.ControlType.ProgrammaticName) -replace 'ControlType\.', ''
            $r  = $el.Current.BoundingRectangle
            if (Rect-OnScreen $r $vs) {
                $cands.Add([pscustomobject]@{ Name=$name; Type=$ct; X=[int]$r.X; Y=[int]$r.Y; W=[int]$r.Width; H=[int]$r.Height })
            }
        }
    } catch {}
    try { $c = $walker.GetFirstChild($el); while ($null -ne $c) { $queue.Enqueue($c); $c = $walker.GetNextSibling($c) } } catch {}
}

if ($cands.Count -eq 0) {
    Write-Host "No ON-SCREEN element named like '$Term' was found. Try its exact label or scroll it into view." -ForegroundColor Yellow
    Stop-Spike 0
}

# --- Disambiguate: prefer the PAGE element (below the browser toolbar) -------
# The browser's own nav Forward sits at the very top (Y < 100). Prefer a real
# page element (Hyperlink/Button lower down), matching decision D4.
$below = $cands | Where-Object { $_.Y -gt 100 }
$pick = $null
if ($below) {
    $pick = ($below | Where-Object { $_.Type -eq 'Hyperlink' } | Select-Object -First 1)
    if (-not $pick) { $pick = ($below | Where-Object { $_.Type -eq 'Button' } | Select-Object -First 1) }
    if (-not $pick) { $pick = ($below | Select-Object -First 1) }
} else {
    $pick = $cands | Select-Object -First 1
}

Write-Host ""
Write-Host ("POINTING AT: '{0}'  [{1}]  at X={2} Y={3} size {4}x{5}" -f $pick.Name,$pick.Type,$pick.X,$pick.Y,$pick.W,$pick.H) -ForegroundColor Green
if ($cands.Count -gt 1) { Write-Host ("(chose 1 of {0} matches - skipped the browser's own toolbar arrow)" -f $cands.Count) -ForegroundColor DarkGray }

# --- Draw the arrow on a transparent, click-through, full-screen overlay -----
$script:pick = $pick
$script:vs   = $vs

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition   = 'Manual'
$form.Bounds          = New-Object System.Drawing.Rectangle $vs.Left, $vs.Top, $vs.Width, $vs.Height
$form.TopMost         = $true
$form.ShowInTaskbar   = $false
$form.BackColor       = [System.Drawing.Color]::Magenta
$form.TransparencyKey = [System.Drawing.Color]::Magenta   # magenta = fully see-through + click-through

$form.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $p = $script:pick; $v = $script:vs
    # rect in form-local coordinates
    $rx = $p.X - $v.Left; $ry = $p.Y - $v.Top
    $pad = 6

    # green highlight box around the target
    $green = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,30,190,90)), 5
    $g.DrawRectangle($green, ($rx - $pad), ($ry - $pad), ($p.W + 2*$pad), ($p.H + 2*$pad))

    # red arrow pointing to the box from lower-left
    $red = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,220,30,30)), 7
    $cap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap 6, 7
    $red.CustomEndCap = $cap
    $sx = $rx - 120; $sy = $ry + $p.H + 110
    if ($sx -lt ($v.Left - $v.Left + 10)) { $sx = 10 }
    if ($sy -gt ($v.Height - 10)) { $sy = $v.Height - 10 }
    $ex = $rx - 4; $ey = $ry + [int]($p.H/2)
    $g.DrawLine($red, $sx, $sy, $ex, $ey)

    # "Kaeya: click here" label on a dark pill
    $font = New-Object System.Drawing.Font 'Segoe UI', 15, ([System.Drawing.FontStyle]::Bold)
    $txt = 'Kaeya: click here'
    $sz = $g.MeasureString($txt, $font)
    $lx = $sx - 20; $ly = $sy + 6
    if ($lx -lt 6) { $lx = 6 }
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(230,20,20,20))
    $g.FillRectangle($bg, $lx, $ly, ($sz.Width + 20), ($sz.Height + 10))
    $g.DrawString($txt, $font, [System.Drawing.Brushes]::White, ($lx + 10), ($ly + 5))
})

# auto-close after a few seconds so it never gets stuck on screen
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1000, $ShowSeconds * 1000)
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()

Write-Host ""
Write-Host "Drawing the arrow now (clears in $ShowSeconds seconds). Look at your app!" -ForegroundColor Yellow
[System.Windows.Forms.Application]::Run($form)

Write-Host ""
Write-Host "==== VERDICT ====" -ForegroundColor Cyan
Write-Host "  If you saw a green box + red arrow on the real button: build-piece #2 WORKS." -ForegroundColor Green
Write-Host "  Kaeya can now FIND the button (spike 1) AND POINT at it live (this spike)." -ForegroundColor Green
Stop-Spike 0
