// Quantized desktop shell: a Tauri 2 window over the local FastAPI server,
// spawned from the bundled PyInstaller sidecar (installed app) or the repo
// venv (dev), and killed with the window. The window first shows a bundled
// loading splash and only navigates to the live app once /api/health answers,
// so a slow server start (cold numpy/scipy/matplotlib import, first-run AV
// scan) never leaves the user staring at a "can't reach this page" error.
//
// Port policy (mirrors the qz CLI): reuse an already-healthy QUANTIZED server
// on the default port; if a foreign app holds it (the sibling fermiviewer
// shares the 8000 default), spawn our sidecar on a free ephemeral port and
// point the window there instead of timing out against the wrong app.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

struct ServerProc(Mutex<Option<Child>>);

const DEFAULT_PORT: u16 = 8000;

fn app_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// True iff nothing currently holds 127.0.0.1:`port` (bind-probe; the
/// listener is dropped immediately). Windows binds without SO_REUSEADDR,
/// so a port a foreign server owns reads busy here rather than stolen.
fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// A free OS-assigned ephemeral port — the fallback home for our sidecar
/// when a foreign app (typically the sibling fermiviewer, which shares the
/// same default) holds 8000. Mirrors `_resolve_port` in server_launch.py.
fn pick_free_port() -> Option<u16> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

/// Which window the shell opens: the normal full app, or DiraCulator — the
/// calculator-only view launched via the Start Menu shortcut added in
/// MAIN #23 (`Quantized.exe --calc`, see nsis-hooks.nsh). The frontend's
/// `?view=calc` mode already exists (`frontend/src/lib/viewMode.ts`); this
/// enum just decides how the shell presents it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Normal,
    Calc,
}

/// `--calc` anywhere in argv selects DiraCulator mode; everything else opens
/// the normal app. Pure and unit-testable without touching a real window.
fn shell_mode<S: AsRef<str>>(args: &[S]) -> Mode {
    if args.iter().any(|a| a.as_ref() == "--calc") {
        Mode::Calc
    } else {
        Mode::Normal
    }
}

/// The URL the webview should navigate to for a given mode. `Mode::Normal`
/// passes `base` through unchanged (byte-identical to today's behavior).
/// `Mode::Calc` appends the calc-only view query, joining correctly whether
/// `base` already carries a query string or a trailing slash (it has neither
/// today, but this keeps the join logic honest rather than a bare concat).
fn webview_url(base: &str, mode: Mode) -> String {
    if mode == Mode::Normal {
        return base.to_string();
    }
    if base.contains('?') {
        format!("{base}&view=calc")
    } else if base.ends_with('/') {
        format!("{base}?view=calc")
    } else {
        format!("{base}/?view=calc")
    }
}

fn repo_root() -> PathBuf {
    // src-tauri/ lives one level under the repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

#[cfg(target_os = "windows")]
const SIDECAR_EXE: &str = "qz-server.exe";
#[cfg(not(target_os = "windows"))]
const SIDECAR_EXE: &str = "qz-server";

fn spawn_server(repo: &PathBuf, port: u16) -> std::io::Result<Child> {
    // Passing --port explicitly pins the server to the port this shell will
    // navigate to. Without it, a busy default port makes the qz CLI fall
    // back to an ephemeral port of ITS OWN choosing — one this shell can't
    // discover, so the health poll times out against the wrong port.
    let port_arg = port.to_string();
    // 1) installed app: the PyInstaller sidecar ships as a resource next to
    //    the shell exe (<install>/qz-server/qz-server[.exe])
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in [
                dir.join("qz-server").join(SIDECAR_EXE),
                dir.join("resources").join("qz-server").join(SIDECAR_EXE),
            ] {
                if cand.is_file() {
                    let mut cmd = Command::new(&cand);
                    cmd.args(["--no-browser", "--port", &port_arg]);
                    hide_console(&mut cmd);
                    return cmd.spawn();
                }
            }
        }
    }
    // 2) dev fallback: repo venv python directly (not the qz launcher) so
    //    kill() reaches uvicorn itself rather than orphaning a grandchild.
    #[cfg(target_os = "windows")]
    let python = repo.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python = repo.join(".venv").join("bin").join("python");
    let mut cmd = Command::new(python);
    cmd.args(["-m", "quantized", "--no-browser", "--port", &port_arg])
        .current_dir(repo);
    hide_console(&mut cmd);
    cmd.spawn()
}

#[cfg(target_os = "windows")]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_cmd: &mut Command) {}

/// Response classification for the health probe, split out pure so it is
/// unit-testable without a socket. A 200 with `"status"` alone is NOT
/// identity: the sibling fermiviewer app answers the same default port with
/// the same `{"status": "ok", ...}` shape, and adopting it navigates this
/// window into the wrong app's UI — so the body must also name this app.
fn health_body_ok(buf: &str) -> bool {
    buf.contains(" 200") && buf.contains("\"status\"") && buf.contains("\"app\"") && buf.contains("\"quantized\"")
}

/// One HTTP GET /api/health attempt — distinguishes *our* server (200 + a
/// JSON body identifying itself as quantized) from a foreign app that
/// merely holds the port.
fn http_health_ok(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let req = b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    health_body_ok(&buf)
}

/// Poll /api/health until it answers or the timeout elapses.
fn wait_for_health(timeout: Duration, port: u16) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if http_health_ok(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn kill_server(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ServerProc>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Background auto-update (Rust-driven): check GitHub Releases for a newer
/// SIGNED build; if one exists, ask the user, then download + install +
/// restart. Any failure (offline, no update, bad/absent manifest) is silent —
/// it must never block or disrupt a normal launch.
///
/// WINDOWS ONLY: macOS/Linux builds are unsigned (a self-replaced bundle would
/// trip Gatekeeper) and .deb isn't an updater target, so those platforms use
/// the manual path (re-download the installer) instead.
#[cfg(target_os = "windows")]
async fn check_for_update(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    let Ok(updater) = app.updater() else {
        return;
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        _ => return, // up to date, offline, or manifest unreachable → quiet
    };

    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let msg = format!(
        "Quantized {} is available (you have {}).\n\n\
         Download and restart to update now?",
        update.version, update.current_version
    );
    let proceed = app
        .dialog()
        .message(msg)
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Update & Restart".to_string(),
            "Later".to_string(),
        ))
        .blocking_show();
    if !proceed {
        return;
    }

    // download_and_install runs the NSIS updater bundle and verifies it against
    // the pubkey baked into tauri.conf.json; restart on success.
    if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
        app.restart();
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let mode = shell_mode(&argv);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let repo = repo_root();
            // a dev/leftover QUANTIZED server may already own the default
            // port — reuse it. If a foreign app holds it instead (typically
            // the sibling fermiviewer, which shares the 8000 default), fall
            // back to a free ephemeral port rather than timing out — the
            // same policy as the qz CLI's _resolve_port.
            let already = wait_for_health(Duration::from_millis(800), DEFAULT_PORT);
            let (port, child) = if already {
                (DEFAULT_PORT, None)
            } else if port_is_free(DEFAULT_PORT) {
                (DEFAULT_PORT, Some(spawn_server(&repo, DEFAULT_PORT)?))
            } else {
                let fallback = pick_free_port().unwrap_or(DEFAULT_PORT);
                (fallback, Some(spawn_server(&repo, fallback)?))
            };
            app.manage(ServerProc(Mutex::new(child)));

            // Keep the live window/taskbar thumbnail on the same Quantized
            // artwork embedded in the packaged executable and shortcuts.
            if let (Some(win), Some(icon)) = (
                app.get_webview_window("main"),
                app.default_window_icon().cloned(),
            ) {
                let _ = win.set_icon(icon);
            }

            // Use the same packaged artwork in the system tray. A normal
            // left-click restores/focuses Quantized; right-click exposes the
            // small menu that Linux tray implementations require as well.
            if let Some(icon) = app.default_window_icon().cloned() {
                let show =
                    MenuItem::with_id(app, "tray-show", "Show Quantized", true, None::<&str>)?;
                let quit =
                    MenuItem::with_id(app, "tray-quit", "Quit Quantized", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                TrayIconBuilder::with_id("quantized-tray")
                    .icon(icon)
                    .tooltip("Quantized")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if matches!(
                            event,
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            }
                        ) {
                            show_main_window(tray.app_handle());
                        }
                    })
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "tray-show" => show_main_window(app),
                        "tray-quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            // DiraCulator (`--calc`): the "main" window is config-defined in
            // tauri.conf.json (title "Quantized", 1440x920) and already exists
            // by the time this closure runs, so the least invasive way to give
            // it a distinct identity is to retitle/resize it in place here
            // rather than stand up a second WebviewWindowBuilder — the sidecar
            // spawn/kill and health-poll plumbing below stay identical for
            // both modes.
            //
            // 520x680 (owner report, 2026-08-02) was too small: the calc-only
            // shell centers its content in a 480px column
            // (`.qzk-calc-body{max-width:480px}`, shell.css), so 520 left
            // almost no margin, and 680 was too short for a typical card-heavy
            // tab (e.g. Electrical's 5 cards) to be visible without a manual
            // drag-resize first — matches the pywebview `--calc --desktop`
            // path in server_launch.py/cli.py, which hits the identical CSS
            // and needed the same fix. Very card-dense tabs (Semiconductor/
            // Superconductor, 11+ cards) still rely on the calc body's own
            // `overflow-y: auto` scroll — expected, not a regression.
            if mode == Mode::Calc {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_title("DiraCulator");
                    let _ = win.set_size(tauri::LogicalSize::new(600.0_f64, 860.0_f64));
                }
            }

            // The window is already showing the bundled splash. Wait for the
            // server off the UI thread, then navigate to the live app (or
            // surface a clear error if it never comes up).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let ok = already || wait_for_health(Duration::from_secs(60), port);
                if let Some(win) = handle.get_webview_window("main") {
                    if ok {
                        if let Ok(url) = webview_url(&app_url(port), mode).parse() {
                            let _ = win.navigate(url);
                        }
                    } else {
                        let _ = win.eval(&format!(
                            "window.__qzError && window.__qzError('Quantized \
                             could not reach its local server on port {port}. \
                             Your antivirus may be scanning the first launch, \
                             or another copy may be mid-start. Close other \
                             copies and try again.')"
                        ));
                    }
                }
            });

            // background auto-update check — Windows only (macOS/Linux use the
            // manual path; see check_for_update)
            #[cfg(target_os = "windows")]
            {
                let update_handle = app.handle().clone();
                tauri::async_runtime::spawn(check_for_update(update_handle));
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                kill_server(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error building the tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                kill_server(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_mode_defaults_to_normal() {
        assert_eq!(shell_mode(&["Quantized.exe".to_string()]), Mode::Normal);
        assert_eq!(shell_mode::<String>(&[]), Mode::Normal);
    }

    #[test]
    fn shell_mode_picks_up_calc_flag_anywhere_in_argv() {
        assert_eq!(
            shell_mode(&["Quantized.exe".to_string(), "--calc".to_string()]),
            Mode::Calc
        );
        assert_eq!(
            shell_mode(&["--calc".to_string(), "Quantized.exe".to_string()]),
            Mode::Calc
        );
    }

    #[test]
    fn shell_mode_ignores_unrelated_flags() {
        assert_eq!(
            shell_mode(&["Quantized.exe".to_string(), "--no-browser".to_string()]),
            Mode::Normal
        );
    }

    #[test]
    fn app_url_formats_default_and_fallback_ports() {
        assert_eq!(app_url(DEFAULT_PORT), "http://127.0.0.1:8000");
        assert_eq!(app_url(49321), "http://127.0.0.1:49321");
    }

    #[test]
    fn port_is_free_false_while_a_listener_holds_it() {
        let held = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral");
        let port = held.local_addr().expect("local addr").port();
        assert!(!port_is_free(port));
        drop(held);
    }

    #[test]
    fn pick_free_port_returns_a_bindable_port() {
        let port = pick_free_port().expect("an ephemeral port");
        // It must be a real free port, not just a number that differs.
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
    }

    #[test]
    fn webview_url_normal_mode_is_untouched() {
        assert_eq!(webview_url(&app_url(DEFAULT_PORT), Mode::Normal), "http://127.0.0.1:8000");
    }

    #[test]
    fn webview_url_calc_mode_appends_view_query() {
        assert_eq!(
            webview_url(&app_url(DEFAULT_PORT), Mode::Calc),
            "http://127.0.0.1:8000/?view=calc"
        );
    }

    #[test]
    fn webview_url_calc_mode_respects_trailing_slash() {
        assert_eq!(
            webview_url("http://127.0.0.1:8000/", Mode::Calc),
            "http://127.0.0.1:8000/?view=calc"
        );
    }

    #[test]
    fn webview_url_calc_mode_extends_an_existing_query() {
        assert_eq!(
            webview_url("http://127.0.0.1:8000/?foo=bar", Mode::Calc),
            "http://127.0.0.1:8000/?foo=bar&view=calc"
        );
    }

    #[test]
    fn health_body_accepts_our_own_identified_server() {
        assert!(health_body_ok(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n\
             {\"status\":\"ok\",\"app\":\"quantized\",\"version\":\"0.16.0\"}"
        ));
    }

    #[test]
    fn health_body_rejects_a_sibling_app_answering_status_ok() {
        // fermiviewer's /api/health on the same default port — the exact
        // payload that used to be adopted as "ours" and navigated the
        // Quantized window into the EM app (owner report 2026-08-05).
        assert!(!health_body_ok(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n\
             {\"status\":\"ok\",\"version\":\"1.2.0\"}"
        ));
    }

    #[test]
    fn health_body_rejects_non_200() {
        assert!(!health_body_ok(
            "HTTP/1.1 404 Not Found\r\n\r\n{\"status\":\"ok\",\"app\":\"quantized\"}"
        ));
    }
}
