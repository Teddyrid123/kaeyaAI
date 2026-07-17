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

/// Pick the single best element matching `term` (case-insensitive). The browser's
/// own back/forward/reload buttons sit in the top toolbar strip, while the button
/// the user actually means (e.g. Gmail's "Forward" inside the open email) sits
/// lower in the page — so the reliable rule is: take the match LOWEST on screen
/// (largest y). We first narrow to an EXACT name match ("Forward") when one
/// exists, so a partial like "Forward message list" can't win over the real
/// button. (An earlier "prefer any Hyperlink" rule was dropped: it could grab a
/// stray high-up link regardless of position, which made the FIRST point land on
/// the browser's toolbar arrow instead of the email's Forward.)
pub fn pick_target(elements: &[UiaEl], term: &str) -> Option<UiaEl> {
    let term = term.to_lowercase();
    let matches: Vec<&UiaEl> = elements
        .iter()
        .filter(|e| e.name.to_lowercase().contains(&term))
        .collect();
    if matches.is_empty() {
        return None;
    }

    // Prefer elements whose name is EXACTLY the term (ignoring case/whitespace);
    // fall back to all "contains" matches if there's no exact one.
    let exact: Vec<&UiaEl> = matches
        .iter()
        .copied()
        .filter(|e| e.name.trim().to_lowercase() == term)
        .collect();
    let pool = if exact.is_empty() { &matches } else { &exact };

    // Among the pool, the match lowest on screen — avoids the top toolbar nav.
    pool.iter().max_by_key(|e| e.y).map(|e| (*e).clone())
}
