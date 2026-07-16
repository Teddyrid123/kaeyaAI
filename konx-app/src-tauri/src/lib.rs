// KonX engine: capture the user's selected text from whatever app they were in,
// then (on request) replace it in place. This is the Phase 0 mechanism, now native.

use std::sync::{Arc, Mutex};
use std::{thread, time::Duration};
use tauri::{Manager, PhysicalPosition};

/// Remembers the last "real" foreground window (the app the user was typing in),
/// so we know where to copy from and paste back to.
struct Target(Arc<Mutex<isize>>);

// ---------- Windows-only OS integration ----------
#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    /// Bring a window to the foreground *reliably*, even after Windows has
    /// engaged its foreground lock (which otherwise makes only the first
    /// programmatic focus-change work). We temporarily attach our input queue
    /// to the target (and current foreground) thread so Windows allows it —
    /// this is what lets quick-mode double-taps work over and over.
    pub fn set_foreground(handle: isize) {
        if handle == 0 {
            return;
        }
        unsafe {
            let hwnd = HWND(handle as *mut c_void);
            let current = GetCurrentThreadId();
            let target_thread = GetWindowThreadProcessId(hwnd, None);
            let fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);

            let attach_target = target_thread != 0 && target_thread != current;
            let attach_fg =
                fg_thread != 0 && fg_thread != current && fg_thread != target_thread;

            if attach_target {
                let _ = AttachThreadInput(current, target_thread, BOOL::from(true));
            }
            if attach_fg {
                let _ = AttachThreadInput(current, fg_thread, BOOL::from(true));
            }

            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);

            if attach_target {
                let _ = AttachThreadInput(current, target_thread, BOOL::from(false));
            }
            if attach_fg {
                let _ = AttachThreadInput(current, fg_thread, BOOL::from(false));
            }
        }
    }
}

// ---------- keyboard + clipboard helpers ----------
fn send_ctrl(unicode: char) -> Result<(), String> {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Press).map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode(unicode), Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Control, Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_clipboard() -> Option<String> {
    let mut cb = arboard::Clipboard::new().ok()?;
    cb.get_text().ok()
}

fn write_clipboard(text: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text.to_string()).map_err(|e| e.to_string())
}

// ---------- AI: real OpenAI / Gemini calls (Phase 2 go-live) ----------
// Keys are read from a private local file so they are NEVER embedded in the app:
//   %APPDATA%\KonX\keys.json  ->  { "openai": "sk-...", "gemini": "AIza..." }

#[derive(serde::Deserialize, Default)]
struct Keys {
    #[serde(default)]
    openai: String,
    #[serde(default)]
    gemini: String,
}

fn load_keys() -> Keys {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = std::path::PathBuf::from(appdata).join("KonX").join("keys.json");
        if let Ok(contents) = std::fs::read_to_string(&path) {
            if let Ok(keys) = serde_json::from_str::<Keys>(&contents) {
                return keys;
            }
        }
    }
    Keys::default()
}

#[derive(serde::Serialize)]
struct AiResult {
    text: String,
    engine: String,
}

const SYSTEM_PROMPT: &str = "You are KonX, a friendly writing assistant. Rewrite the user's text exactly as their instruction asks. Reply with ONLY the rewritten text — no preamble, no explanation, no surrounding quotation marks.";

/// Runs a real model. `provider` is "openai" or "gemini"; `model` is the exact
/// model id chosen by the router. Returns an error (so the UI falls back to the
/// built-in demo brain) when the key is missing or the request fails.
#[tauri::command]
async fn ai_generate(
    provider: String,
    model: String,
    text: String,
    instruction: String,
    temperature: Option<f64>,
) -> Result<AiResult, String> {
    let keys = load_keys();
    let temp = temperature.unwrap_or(0.4);
    let user = format!("Instruction: {}\n\nText:\n{}", instruction.trim(), text);
    let client = reqwest::Client::new();

    if provider == "openai" {
        let key = keys.openai.trim().to_string();
        if key.is_empty() {
            return Err("NO_KEY".into());
        }
        let body = serde_json::json!({
            "model": model,
            "temperature": temp,
            "messages": [
                { "role": "system", "content": SYSTEM_PROMPT },
                { "role": "user", "content": user }
            ]
        });
        let resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(key)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let ok = resp.status().is_success();
        let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if !ok {
            return Err(v["error"]["message"].as_str().unwrap_or("OpenAI request failed").to_string());
        }
        let out = v["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string();
        if out.is_empty() {
            return Err("OpenAI returned nothing".into());
        }
        return Ok(AiResult { text: out, engine: "openai".into() });
    }

    if provider == "gemini" {
        let key = keys.gemini.trim().to_string();
        if key.is_empty() {
            return Err("NO_KEY".into());
        }
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            model
        );
        let body = serde_json::json!({
            "systemInstruction": { "parts": [ { "text": SYSTEM_PROMPT } ] },
            "contents": [ { "parts": [ { "text": user } ] } ],
            "generationConfig": { "temperature": temp }
        });
        let resp = client
            .post(&url)
            .query(&[("key", key.as_str())])
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let ok = resp.status().is_success();
        let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if !ok {
            return Err(v["error"]["message"].as_str().unwrap_or("Gemini request failed").to_string());
        }
        let out = v["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("").trim().to_string();
        if out.is_empty() {
            return Err("Gemini returned nothing".into());
        }
        return Ok(AiResult { text: out, engine: "gemini".into() });
    }

    Err(format!("Unknown provider: {}", provider))
}

// ---------- commands called from the UI ----------

/// Called when the user taps the floating orb. Grabs the selected text from the
/// app they were in, opens the KonX window, and returns the captured text.
#[tauri::command]
fn open_konx(app: tauri::AppHandle, state: tauri::State<Target>) -> Result<String, String> {
    let target = *state.0.lock().unwrap();

    #[cfg(windows)]
    {
        if target != 0 {
            win::set_foreground(target);
            thread::sleep(Duration::from_millis(80));
        }
        let _ = send_ctrl('c');
        thread::sleep(Duration::from_millis(130));
    }

    let text = read_clipboard().unwrap_or_default();

    if let Some(w) = app.get_webview_window("main") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }

    Ok(text)
}

/// Quick mode (double-tap the orb): grab the selected text WITHOUT opening the
/// KonX window. The frontend then rewrites it silently and calls `apply_text`.
#[tauri::command]
fn quick_capture(state: tauri::State<Target>) -> Result<String, String> {
    let target = *state.0.lock().unwrap();

    #[cfg(windows)]
    {
        if target != 0 {
            win::set_foreground(target);
            thread::sleep(Duration::from_millis(80));
        }
        let _ = send_ctrl('c');
        thread::sleep(Duration::from_millis(130));
    }

    Ok(read_clipboard().unwrap_or_default())
}

/// Called when the user accepts a rewrite. Puts the new text on the clipboard,
/// returns focus to the original app, and pastes over the selection.
#[tauri::command]
fn apply_text(app: tauri::AppHandle, state: tauri::State<Target>, text: String) -> Result<(), String> {
    write_clipboard(&text)?;

    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }

    #[cfg(windows)]
    {
        let target = *state.0.lock().unwrap();
        thread::sleep(Duration::from_millis(60));
        win::set_foreground(target);
        thread::sleep(Duration::from_millis(90));
        let _ = send_ctrl('v');
    }

    Ok(())
}

#[tauri::command]
fn hide_main(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn set_orb_visible(app: tauri::AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("orb") {
        if visible {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: Arc<Mutex<isize>> = Arc::new(Mutex::new(0));
    let shared_for_thread = shared.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Target(shared))
        .invoke_handler(tauri::generate_handler![
            open_konx,
            quick_capture,
            apply_text,
            hide_main,
            set_orb_visible,
            ai_generate
        ])
        .setup(move |app| {
            // Dock the orb to the right edge, vertically centered.
            if let Some(orb) = app.get_webview_window("orb") {
                if let Ok(Some(monitor)) = orb.current_monitor() {
                    let size = monitor.size();
                    let ow = 120i32;
                    let oh = 120i32;
                    let x = size.width as i32 - ow - 6;
                    let y = (size.height as i32 - oh) / 2;
                    let _ = orb.set_position(PhysicalPosition::new(x, y));
                }
            }

            // Track the last external foreground window so we know where to
            // copy from / paste to when the orb is tapped.
            #[cfg(windows)]
            {
                let mut ours: Vec<isize> = Vec::new();
                for label in ["main", "orb"] {
                    if let Some(w) = app.get_webview_window(label) {
                        if let Ok(h) = w.hwnd() {
                            ours.push(h.0 as isize);
                        }
                    }
                }
                let target = shared_for_thread.clone();
                thread::spawn(move || loop {
                    let fg = win::foreground();
                    if fg != 0 && !ours.contains(&fg) {
                        *target.lock().unwrap() = fg;
                    }
                    thread::sleep(Duration::from_millis(250));
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
