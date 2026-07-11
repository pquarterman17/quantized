// Quantized desktop shell: a Tauri 2 window over the local FastAPI server,
// spawned from the bundled PyInstaller sidecar (installed app) or the repo
// venv (dev), and killed with the window. The window first shows a bundled
// loading splash and only navigates to the live app once /api/health answers,
// so a slow server start (cold numpy/scipy/matplotlib import, first-run AV
// scan) never leaves the user staring at a "can't reach this page" error.

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

use tauri::Manager;

struct ServerProc(Mutex<Option<Child>>);

const ADDR: &str = "127.0.0.1:8000";
const APP_URL: &str = "http://127.0.0.1:8000";

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

fn spawn_server(repo: &PathBuf) -> std::io::Result<Child> {
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
                    cmd.args(["--no-browser"]);
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
    cmd.args(["-m", "quantized", "--no-browser"])
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

/// One HTTP GET /api/health attempt — distinguishes *our* server (200 + a
/// `"status"` JSON body) from a foreign app that merely holds the port.
fn http_health_ok() -> bool {
    let addr = match ADDR.parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
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
    buf.contains(" 200") && buf.contains("\"status\"")
}

/// Poll /api/health until it answers or the timeout elapses.
fn wait_for_health(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if http_health_ok() {
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
            // a dev/leftover server may already own the port — reuse it
            let already = wait_for_health(Duration::from_millis(800));
            let child = if already {
                None
            } else {
                Some(spawn_server(&repo)?)
            };
            app.manage(ServerProc(Mutex::new(child)));

            // DiraCulator (`--calc`): the "main" window is config-defined in
            // tauri.conf.json (title "Quantized", 1440x920) and already exists
            // by the time this closure runs, so the least invasive way to give
            // it a distinct identity is to retitle/resize it in place here
            // rather than stand up a second WebviewWindowBuilder — the sidecar
            // spawn/kill and health-poll plumbing below stay identical for
            // both modes.
            if mode == Mode::Calc {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_title("DiraCulator");
                    let _ = win.set_size(tauri::LogicalSize::new(520.0_f64, 680.0_f64));
                }
            }

            // The window is already showing the bundled splash. Wait for the
            // server off the UI thread, then navigate to the live app (or
            // surface a clear error if it never comes up).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let ok = already || wait_for_health(Duration::from_secs(60));
                if let Some(win) = handle.get_webview_window("main") {
                    if ok {
                        if let Ok(url) = webview_url(APP_URL, mode).parse() {
                            let _ = win.navigate(url);
                        }
                    } else {
                        let _ = win.eval(
                            "window.__qzError && window.__qzError('Quantized \
                             could not reach its local server on port 8000. \
                             Another program may be using the port, or your \
                             antivirus may be scanning the first launch. Close \
                             other copies and try again.')",
                        );
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
    fn webview_url_normal_mode_is_untouched() {
        assert_eq!(webview_url(APP_URL, Mode::Normal), APP_URL);
    }

    #[test]
    fn webview_url_calc_mode_appends_view_query() {
        assert_eq!(
            webview_url(APP_URL, Mode::Calc),
            format!("{APP_URL}/?view=calc")
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
}
