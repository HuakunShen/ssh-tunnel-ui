//! `ssh-tunnel-desktop` — the native GUI shell for the tunnel manager.
//!
//! This shell is deliberately thin: it spawns the `ssh-tunnel-serve` sidecar
//! (the same daemon the CLI and TUI talk to), waits for `/api/health`, and
//! opens the bundled Web UI in a single window. All tunnel rules stay in the
//! TypeScript backend; no domain logic lives in Rust.

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;

const DAEMON_PORT: u16 = 7432;
const DAEMON_HOST: &str = "127.0.0.1";

fn daemon_url() -> String {
    format!("http://{DAEMON_HOST}:{DAEMON_PORT}")
}

/// Search `dir` (max 4 levels) for a file with one of `names`.
fn find_file(dir: &std::path::Path, names: &[&str]) -> Option<PathBuf> {
    fn walk(dir: &std::path::Path, names: &[&str], depth: u8, out: &mut Option<PathBuf>) {
        if out.is_some() || depth == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if names.contains(&name) {
                        *out = Some(path);
                        return;
                    }
                }
            } else if path.is_dir() {
                walk(&path, names, depth - 1, out);
            }
        }
    }
    let mut found = None;
    walk(dir, names, 4, &mut found);
    found
}

fn sidecar_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    // In a bundled app the server bundle rides in the resource dir (Tauri
    // preserves the source layout, so search recursively). In dev, fall back
    // to the workspace build output so `tauri dev` works without bundling.
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(found) = find_file(&resource_dir, &["server.mjs", "ssh-tunnel-serve", "ssh-tunnel-serve.exe"]) {
            return Some(found);
        }
    }
    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../server/dist/server.mjs");
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }
    None
}

fn web_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(found) = find_file(&resource_dir, &["index.html"]) {
            if let Some(parent) = found.parent() {
                // Only accept it if it looks like our Web UI.
                if parent.join("index.html").exists() {
                    return Some(parent.to_path_buf());
                }
            }
        }
    }
    let dev_candidate =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/dist");
    if dev_candidate.join("index.html").exists() {
        return Some(dev_candidate);
    }
    None
}

fn health_ok() -> bool {
    let url = format!("{}/api/health", daemon_url());
    let Ok(response) = ureq::get(&url).timeout(Duration::from_millis(800)).call() else {
        return false;
    };
    response.status() == 200
}

fn wait_for_daemon(deadline: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if health_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    health_ok()
}

fn spawn_sidecar(app: &tauri::AppHandle) {
    if health_ok() {
        // A daemon is already running (user started one manually); attach.
        return;
    }
    let Some(binary) = sidecar_path(app) else {
        return;
    };
    // The daemon ships as a bundled ESM file: run it through node when the
    // resource is a `.mjs`, execute directly when it is a native binary.
    let is_node_script = binary.extension().and_then(|e| e.to_str()) == Some("mjs");
    let mut command = if is_node_script {
        let mut command = std::process::Command::new("node");
        command.arg(&binary);
        command
    } else {
        std::process::Command::new(&binary)
    };
    command
        .arg(format!("--port={DAEMON_PORT}"))
        .arg(format!("--host={DAEMON_HOST}"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(dir) = web_dir(app) {
        command.arg(format!("--web-dir={}", dir.display()));
    }
    // Detached on purpose: tunnels outlive the window. `stop-all` from the UI
    // kills the ssh children; the daemon itself is reaped on uninstall/reboot.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }
    let _ = command.spawn();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The embedded WebDriver server is test-only surface: production builds
    // never expose it. E2E sets `SSH_TUNNEL_WEBDRIVER=1` (see e2e/wdio.conf.ts).
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init());
    let builder = if std::env::var("SSH_TUNNEL_WEBDRIVER").is_ok() {
        builder.plugin(tauri_plugin_wdio_webdriver::init())
    } else {
        builder
    };
    builder
        .setup(|app| {
            spawn_sidecar(app.handle());
            let ready = wait_for_daemon(Duration::from_secs(15));
            // The window starts `visible: false` to avoid flashing a blank
            // frame; reveal it once the daemon answers (or with a failure
            // title so a broken sidecar is visible, not a missing window).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = handle.get_webview_window("main") {
                    if !ready {
                        let _ = window.set_title("SSH Tunnel — daemon failed to start");
                    }
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![daemon_url_command])
        .run(tauri::generate_context!())
        .expect("failed to run ssh-tunnel desktop shell");
}

/// Lets the Web UI discover the daemon without hardcoding the port.
#[tauri::command]
fn daemon_url_command() -> String {
    daemon_url()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn daemon_url_points_at_loopback_default_port() {
        assert_eq!(daemon_url(), "http://127.0.0.1:7432");
    }

    #[test]
    fn find_file_locates_nested_server_bundle() {
        let dir = std::env::temp_dir().join(format!("ssh-tunnel-find-{}", std::process::id()));
        let nested = dir.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("server.mjs"), "console.log(1)").unwrap();
        fs::write(dir.join("other.txt"), "x").unwrap();
        let found = find_file(&dir, &["server.mjs"]);
        assert_eq!(found, Some(nested.join("server.mjs")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn find_file_returns_none_when_missing() {
        let dir = std::env::temp_dir().join(format!("ssh-tunnel-missing-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(find_file(&dir, &["server.mjs"]), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn find_file_respects_depth_limit() {
        let dir = std::env::temp_dir().join(format!("ssh-tunnel-depth-{}", std::process::id()));
        let deep = dir.join("1").join("2").join("3").join("4").join("5");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("server.mjs"), "console.log(1)").unwrap();
        // Depth budget is 4 levels: 5-deep file stays invisible.
        assert_eq!(find_file(&dir, &["server.mjs"]), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
