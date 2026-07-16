// KonX engine: capture the user's selected text from whatever app they were in,
// then (on request) replace it in place. This is the Phase 0 mechanism, now native.

use std::sync::{Arc, Mutex};
use std::{thread, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_deep_link::DeepLinkExt;

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

const SYSTEM_PROMPT: &str = "You are Kaeya, a writing assistant. Apply the user's instruction to their text and reply with ONLY the resulting text — nothing else. Do NOT greet the user or address them by name. Do NOT add any preamble, introduction, explanation, notes, labels, or sign-off, and do NOT wrap the result in quotation marks. If the text is already correct for the instruction, return it unchanged.";

/// A failed model call: the HTTP status (0 = network error) + the message.
struct CallErr {
    status: u16,
    message: String,
}

/// The smaller, more-available model for a provider — used as the retry target
/// when the requested (usually large) model is momentarily overloaded.
fn small_model(provider: &str) -> &'static str {
    if provider == "openai" {
        "gpt-4o-mini"
    } else {
        "gemini-flash-lite-latest"
    }
}

/// A model can be briefly overloaded (e.g. Gemini 503 "high demand") even when
/// the key is valid. Detect that so we can retry on the smaller model.
fn is_transient(e: &CallErr) -> bool {
    let m = e.message.to_lowercase();
    e.status == 503
        || m.contains("high demand")
        || m.contains("overloaded")
        || m.contains("unavailable")
        || m.contains("try again")
}

async fn call_openai(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    user: &str,
    temp: f64,
) -> Result<String, CallErr> {
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
        .map_err(|e| CallErr { status: 0, message: e.to_string() })?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| CallErr { status, message: e.to_string() })?;
    if !ok {
        return Err(CallErr {
            status,
            message: v["error"]["message"].as_str().unwrap_or("OpenAI request failed").to_string(),
        });
    }
    let out = v["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string();
    if out.is_empty() {
        return Err(CallErr { status, message: "OpenAI returned nothing".into() });
    }
    Ok(out)
}

async fn call_gemini(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    user: &str,
    temp: f64,
) -> Result<String, CallErr> {
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
        .query(&[("key", key)])
        .json(&body)
        .send()
        .await
        .map_err(|e| CallErr { status: 0, message: e.to_string() })?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| CallErr { status, message: e.to_string() })?;
    if !ok {
        return Err(CallErr {
            status,
            message: v["error"]["message"].as_str().unwrap_or("Gemini request failed").to_string(),
        });
    }
    let out = v["candidates"][0]["content"]["parts"][0]["text"].as_str().unwrap_or("").trim().to_string();
    if out.is_empty() {
        return Err(CallErr { status, message: "Gemini returned nothing".into() });
    }
    Ok(out)
}

/// Runs a real model. `provider` is "openai" or "gemini"; `model` is the exact
/// model id chosen by the router. If that model is momentarily overloaded, we
/// retry once on the provider's smaller model so the rewrite still succeeds.
/// Returns an error (so the UI falls back to the built-in demo brain) only when
/// the key is missing or both attempts fail.
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

    let key = match provider.as_str() {
        "openai" => keys.openai.trim().to_string(),
        "gemini" => keys.gemini.trim().to_string(),
        other => return Err(format!("Unknown provider: {}", other)),
    };
    if key.is_empty() {
        return Err("NO_KEY".into());
    }

    let is_openai = provider == "openai";
    let first = if is_openai {
        call_openai(&client, &key, &model, &user, temp).await
    } else {
        call_gemini(&client, &key, &model, &user, temp).await
    };

    let out = match first {
        Ok(out) => out,
        Err(e) => {
            let small = small_model(&provider);
            if model != small && is_transient(&e) {
                let alt = if is_openai {
                    call_openai(&client, &key, small, &user, temp).await
                } else {
                    call_gemini(&client, &key, small, &user, temp).await
                };
                // If the fallback also fails, surface the original error.
                alt.map_err(|_| e.message)?
            } else {
                return Err(e.message);
            }
        }
    };

    Ok(AiResult { text: out, engine: provider })
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

/// Minimize the main window to the taskbar (the title-bar minimize button).
#[tauri::command]
fn minimize_main(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
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

// ---------- floating orb: corner docking ----------
// The orb always lives in one of the four screen corners (never mid-edge). The
// user drags it with the mouse; on release we snap it to the nearest corner.

/// The top-left (x, y) for the orb at a named corner of its current monitor,
/// in physical pixels, with a small margin from the edges.
fn orb_corner_xy(orb: &tauri::WebviewWindow, corner: &str) -> Option<(i32, i32)> {
    let m = orb.current_monitor().ok().flatten()?;
    let mp = m.position();
    let ms = m.size();
    let os = orb.outer_size().unwrap_or(PhysicalSize::new(120, 120));
    let margin = 10i32;
    let left = mp.x + margin;
    let right = mp.x + ms.width as i32 - os.width as i32 - margin;
    let top = mp.y + margin;
    let bottom = mp.y + ms.height as i32 - os.height as i32 - margin;
    Some(match corner {
        "top-left" => (left, top),
        "top-right" => (right, top),
        "bottom-left" => (left, bottom),
        _ => (right, bottom), // bottom-right is the default/fallback
    })
}

fn set_orb_corner(orb: &tauri::WebviewWindow, corner: &str) {
    if let Some((x, y)) = orb_corner_xy(orb, corner) {
        let _ = orb.set_position(PhysicalPosition::new(x, y));
    }
}

/// Which corner is the orb's current position closest to, on its monitor.
fn nearest_orb_corner(orb: &tauri::WebviewWindow) -> String {
    if let (Ok(pos), Some(m)) = (orb.outer_position(), orb.current_monitor().ok().flatten()) {
        let os = orb.outer_size().unwrap_or(PhysicalSize::new(120, 120));
        let mp = m.position();
        let ms = m.size();
        let cx = pos.x + os.width as i32 / 2;
        let cy = pos.y + os.height as i32 / 2;
        let mid_x = mp.x + ms.width as i32 / 2;
        let mid_y = mp.y + ms.height as i32 / 2;
        let v = if cy < mid_y { "top" } else { "bottom" };
        let h = if cx < mid_x { "left" } else { "right" };
        return format!("{}-{}", v, h);
    }
    "bottom-right".into()
}

/// Place the orb at a specific corner (used to restore the user's saved choice).
#[tauri::command]
fn place_orb_corner(app: tauri::AppHandle, corner: String) {
    if let Some(orb) = app.get_webview_window("orb") {
        set_orb_corner(&orb, &corner);
    }
}

/// After a drag, snap the orb to the nearest corner and return which one, so the
/// frontend can remember it for next launch.
#[tauri::command]
fn snap_orb(app: tauri::AppHandle) -> String {
    if let Some(orb) = app.get_webview_window("orb") {
        let corner = nearest_orb_corner(&orb);
        set_orb_corner(&orb, &corner);
        return corner;
    }
    "bottom-right".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: Arc<Mutex<isize>> = Arc::new(Mutex::new(0));
    let shared_for_thread = shared.clone();

    tauri::Builder::default()
        // single-instance MUST be registered first. Its `deep-link` feature
        // forwards a `kaeya://` link opened while the app is already running to
        // the deep-link plugin (so we don't spawn a second app / duplicate orb).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Target(shared))
        .invoke_handler(tauri::generate_handler![
            open_konx,
            quick_capture,
            apply_text,
            hide_main,
            minimize_main,
            set_orb_visible,
            place_orb_corner,
            snap_orb,
            ai_generate
        ])
        .setup(move |app| {
            // ---- Social login (Google/Facebook) plumbing ----
            // Register the custom `kaeya://` URL scheme at runtime so Windows
            // knows this exe can receive `kaeya://auth-callback#...` links. Needed
            // because Joseph runs the debug exe directly (not an installed build);
            // the installer handles this for distribution via tauri.conf.json.
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register("kaeya");
            }
            // When the browser hands back `kaeya://auth-callback#access_token=...`,
            // bring the main window forward and pass the whole URL to the frontend,
            // which parses the tokens and completes sign-in.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().first() {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = handle.emit("kaeya-oauth", url.to_string());
                }
            });

            // Dock the orb to a screen corner (default bottom-right). The frontend
            // restores the user's last-chosen corner on load if they moved it.
            if let Some(orb) = app.get_webview_window("orb") {
                set_orb_corner(&orb, "bottom-right");
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
