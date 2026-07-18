// Windows UIAutomation: read the real UI elements (buttons, links, fields) of a
// given window, with their exact on-screen rectangles. This is the native port
// of the PowerShell spike that proved Windows can hand us the exact spot of a
// button like Gmail's "Forward" - so Kaeya can point at the REAL element instead
// of the AI guessing pixel coordinates. Windows-only.

use std::ffi::c_void;

use serde::Serialize;
use windows::core::BSTR;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};

/// One on-screen element Windows can see, with its exact rectangle (physical px).
#[derive(Serialize, Clone, Debug)]
pub struct UiaEl {
    pub name: String,
    pub ctype: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

fn ctype_name(id: i32) -> String {
    // A few common UIAutomation control-type ids -> friendly names.
    match id {
        50000 => "Button",
        50004 => "Edit",
        50005 => "Hyperlink",
        50011 => "MenuItem",
        50007 => "ComboBox",
        50002 => "CheckBox",
        50020 => "Text",
        50019 => "TabItem",
        50008 => "ListItem",
        _ => "Other",
    }
    .to_string()
}

/// Read every named, on-screen element of the window with the given HWND value.
/// Runs COM on the calling thread (call it from a blocking task, not the UI thread).
pub fn list_elements_for(hwnd_val: isize) -> Result<Vec<UiaEl>, String> {
    if hwnd_val == 0 {
        return Err("No target window to read.".into());
    }
    unsafe {
        // MTA is fine for a worker thread; ignore "already initialized" results.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let work = || -> Result<Vec<UiaEl>, String> {
            let hwnd = HWND(hwnd_val as *mut c_void);

            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("UIAutomation unavailable: {}", e.message()))?;

            let root = automation
                .ElementFromHandle(hwnd)
                .map_err(|e| format!("Could not read that window: {}", e.message()))?;

            let cond = automation
                .CreateTrueCondition()
                .map_err(|e| e.message().to_string())?;

            let arr = root
                .FindAll(TreeScope_Descendants, &cond)
                .map_err(|e| e.message().to_string())?;

            let len = arr.Length().map_err(|e| e.message().to_string())?;
            let cap = len.min(8000);

            let mut out: Vec<UiaEl> = Vec::new();
            for i in 0..cap {
                let el = match arr.GetElement(i) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let name: BSTR = el.CurrentName().unwrap_or_default();
                let name = name.to_string();
                if name.trim().is_empty() {
                    continue;
                }

                let r: RECT = el.CurrentBoundingRectangle().unwrap_or_default();
                let w = r.right - r.left;
                let h = r.bottom - r.top;
                if w <= 0 || h <= 0 {
                    continue; // off-screen or zero-size
                }

                let ct = el.CurrentControlType().map(|c| c.0).unwrap_or(0);

                out.push(UiaEl {
                    name,
                    ctype: ctype_name(ct),
                    x: r.left,
                    y: r.top,
                    w,
                    h,
                });
            }
            Ok(out)
        };

        let result = work();
        CoUninitialize();
        result
    }
}

/// True if `term` appears as a whole word in `name` (both already lowercased) —
/// i.e. it's one of the alphanumeric tokens of the name. So "bold" matches
/// "Bold (Ctrl+B)" but "b" does NOT match "Table". This is what stops a
/// single-letter search from grabbing an unrelated button.
fn name_has_word(name_lower: &str, term_lower: &str) -> bool {
    name_lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|tok| tok == term_lower)
}

/// Pick the single best element matching `term` (case-insensitive), in tiers so a
/// vague search can't grab the wrong control:
///   1. EXACT name match ("Forward"). Among ties, lowest on screen — the browser's
///      own back/forward/reload live in the top toolbar while the button the user
///      means (Gmail's page "Forward") sits lower, so lowest wins.
///   2. WHOLE-WORD match — the term is one of the words in the name (so "bold"
///      finds "Bold (Ctrl+B)" but "b" can't find "Table"). Shortest name (closest
///      to the term) wins, then lowest on screen.
///   3. SUBSTRING match, but only for terms long enough (>= 3 chars) to be
///      specific — a 1-2 char substring would match far too much, so we return
///      None instead and let the UI say "look for X" rather than point wrongly.
/// (An earlier "prefer any Hyperlink" rule was dropped: it grabbed stray high-up
/// links, landing the first point on the browser toolbar instead of the target.)
pub fn pick_target(elements: &[UiaEl], term: &str) -> Option<UiaEl> {
    let term = term.trim().to_lowercase();
    if term.is_empty() {
        return None;
    }

    // 1) exact name match, lowest on screen among ties
    let exact: Vec<&UiaEl> = elements
        .iter()
        .filter(|e| e.name.trim().to_lowercase() == term)
        .collect();
    if !exact.is_empty() {
        return exact.iter().max_by_key(|e| e.y).map(|e| (*e).clone());
    }

    // 2) whole-word match: shortest name first, then lowest on screen
    let word: Vec<&UiaEl> = elements
        .iter()
        .filter(|e| name_has_word(&e.name.to_lowercase(), &term))
        .collect();
    if !word.is_empty() {
        return word
            .iter()
            .min_by(|a, b| {
                let la = a.name.chars().count();
                let lb = b.name.chars().count();
                la.cmp(&lb).then(b.y.cmp(&a.y))
            })
            .map(|e| (*e).clone());
    }

    // 3) substring only for reasonably specific terms
    if term.chars().count() >= 3 {
        let sub: Vec<&UiaEl> = elements
            .iter()
            .filter(|e| e.name.to_lowercase().contains(&term))
            .collect();
        if !sub.is_empty() {
            return sub.iter().max_by_key(|e| e.y).map(|e| (*e).clone());
        }
    }

    None
}
