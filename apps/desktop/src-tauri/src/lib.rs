//! `ssh-tunnel-desktop` — the native GUI shell for the tunnel manager.
//!
//! This shell is deliberately thin: it spawns the `ssh-tunnel-serve` sidecar
//! (the same daemon the CLI and TUI talk to), waits for `/api/health`, and
//! opens the bundled Web UI in a single window. All tunnel rules stay in the
//! TypeScript backend; no domain logic lives in Rust.

mod native_material;

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;

const DAEMON_PORT: u16 = 7432;
const DAEMON_HOST: &str = "127.0.0.1";

fn daemon_url() -> String {
    format!("http://{DAEMON_HOST}:{DAEMON_PORT}")
}

/// Deepest nesting Tauri can produce for a bundled resource.
///
/// `bundle.resources` entries outside the crate are rewritten with one `_up_`
/// segment per `..`, so `../../web/dist` lands at `_up_/_up_/web/dist` and the
/// file itself sits five levels below `Resources`. A smaller budget silently
/// fell through to the workspace build and made the shipped app depend on the
/// repository being present.
const RESOURCE_SEARCH_DEPTH: u8 = 8;

/// Search `dir` (max `RESOURCE_SEARCH_DEPTH` levels) for a file with one of `names`.
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
    walk(dir, names, RESOURCE_SEARCH_DEPTH, &mut found);
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

/// A `node` found by walking `PATH`, without starting a shell.
fn node_on_path() -> Option<PathBuf> {
    node_in_path(&std::env::var_os("PATH")?)
}

/// Same lookup against an explicit `PATH` value, so it is testable without
/// mutating the process environment the other tests share.
fn node_in_path(path: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join("node"))
        .find(|candidate| candidate.is_file())
}

/// Ask the user's login shell where `node` is and what `PATH` it exports.
///
/// A GUI app started by Finder inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
/// which contains no `node` when Node comes from nvm, volta, fnm, mise or a
/// keg-only Homebrew prefix. The login shell is the only source that agrees
/// with the terminal the user actually runs — and its `PATH` is also what makes
/// the daemon find the same `ssh` they do.
fn login_shell_probe() -> Option<(PathBuf, String)> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let output = std::process::Command::new(shell)
        .args(["-l", "-c", "command -v node; printenv PATH"])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    parse_shell_probe(&String::from_utf8_lossy(&output.stdout))
}

/// Read `command -v node` + `printenv PATH` output into an interpreter and PATH.
fn parse_shell_probe(stdout: &str) -> Option<(PathBuf, String)> {
    let mut lines = stdout.lines().map(str::trim).filter(|line| !line.is_empty());
    let node = lines.next()?;
    if !node.starts_with('/') {
        return None;
    }
    let path = lines.next()?;
    Some((PathBuf::from(node), path.to_string()))
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    if health_ok() {
        // A daemon is already running (user started one manually); attach.
        return Ok(());
    }
    let binary = sidecar_path(app).ok_or_else(|| "the bundled server is missing".to_string())?;
    // The daemon ships as a bundled ESM file: run it through node when the
    // resource is a `.mjs`, execute directly when it is a native binary.
    let is_node_script = binary.extension().and_then(|e| e.to_str()) == Some("mjs");
    let mut probe: Option<(PathBuf, String)> = None;
    let program = if is_node_script {
        match node_on_path() {
            Some(node) => node,
            None => {
                // Not on the inherited PATH: ask the login shell, exactly like
                // the terminal the user would have started the daemon from.
                probe = login_shell_probe();
                probe
                    .as_ref()
                    .map(|(node, _)| node.clone())
                    .unwrap_or_else(|| PathBuf::from("node"))
            }
        }
    } else {
        binary.clone()
    };
    let mut command = std::process::Command::new(&program);
    if is_node_script {
        command.arg(&binary);
    }
    if let Some((_, path)) = &probe {
        command.env("PATH", path);
    }
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
    command.spawn().map(|_| ()).map_err(|error| {
        // The window will say so; a silent failure here looks like a hang.
        format!("cannot run {}: {error}", program.display())
    })
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
            // Build the window by hand: the hidden title bar needs its drag
            // region script installed before the document loads, and the
            // native material has to go in before anything is shown.
            // A material failure must not cost the user their window: fall
            // back to Tauri's own creation, which still works, just opaque.
            if let Err(error) = native_material::create_main_window(app) {
                eprintln!("native material unavailable ({error}); using a plain window");
                let window = tauri::WebviewWindowBuilder::from_config(
                    app,
                    app.config().app.windows.first().expect("main window configuration"),
                )?;
                let _ = window;
            }
            let sidecar_failure = spawn_sidecar(app.handle()).err();
            // The window starts `visible: false` to avoid flashing a blank
            // frame; reveal it once the daemon answers (or with a failure
            // title so a broken sidecar is visible, not a missing window).
            //
            // The poll cannot block setup: on macOS the main thread is the UI
            // thread, so waiting there stops the event loop from ever running
            // and the window never appears at all.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let ready = wait_for_daemon(Duration::from_secs(15));
                if let Some(window) = handle.get_webview_window("main") {
                    if !ready {
                        // Name the reason: "failed to start" alone gives the
                        // user nothing to fix, and the daemon's own stderr is
                        // detached from the app.
                        let title = match sidecar_failure {
                            Some(reason) => {
                                format!("SSH Tunnel — daemon failed to start ({reason})")
                            }
                            None => "SSH Tunnel — daemon failed to start".to_string(),
                        };
                        let _ = window.set_title(&title);
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
    fn parse_shell_probe_reads_the_interpreter_and_path() {
        let stdout = " /opt/homebrew/bin/node \n/opt/homebrew/bin:/usr/bin\n";
        assert_eq!(
            parse_shell_probe(stdout),
            Some((
                PathBuf::from("/opt/homebrew/bin/node"),
                "/opt/homebrew/bin:/usr/bin".to_string()
            ))
        );
    }

    #[test]
    fn parse_shell_probe_refuses_output_without_an_absolute_interpreter() {
        // `command -v node` prints nothing when node is absent, and a bare
        // name would be resolved against the GUI PATH that failed in the first
        // place.
        assert_eq!(parse_shell_probe(""), None);
        assert_eq!(parse_shell_probe("node\n/usr/bin:/bin\n"), None);
        assert_eq!(parse_shell_probe("/usr/local/bin/node\n"), None);
    }

    #[test]
    fn node_in_path_finds_the_executable_and_ignores_a_directory() {
        let dir = std::env::temp_dir().join(format!("ssh-tunnel-path-{}", std::process::id()));
        let fake = dir.join("node");
        fs::create_dir_all(&fake).unwrap();
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        // A directory named `node` is not an interpreter.
        assert_eq!(node_in_path(empty.as_os_str()), None);
        fs::remove_dir(&fake).unwrap();
        fs::write(dir.join("node"), "#!/bin/sh\n").unwrap();
        assert_eq!(node_in_path(dir.as_os_str()), Some(dir.join("node")));
        fs::remove_dir_all(&dir).unwrap();
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
    fn find_file_reaches_tauri_resource_nesting() {
        let dir = std::env::temp_dir().join(format!("ssh-tunnel-depth-{}", std::process::id()));
        // The layout a bundle really has: ../../web/dist -> _up_/_up_/web/dist.
        let bundled = dir
            .join("_up_")
            .join("_up_")
            .join("web")
            .join("dist");
        fs::create_dir_all(&bundled).unwrap();
        fs::write(bundled.join("index.html"), "<!doctype html>").unwrap();
        assert_eq!(
            find_file(&dir, &["index.html"]),
            Some(bundled.join("index.html"))
        );

        // Nine levels is past the budget, so a pathological tree stays bounded.
        let too_deep = dir
            .join("1")
            .join("2")
            .join("3")
            .join("4")
            .join("5")
            .join("6")
            .join("7")
            .join("8");
        fs::create_dir_all(&too_deep).unwrap();
        fs::write(too_deep.join("only-here.mjs"), "x").unwrap();
        assert_eq!(find_file(&dir, &["only-here.mjs"]), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
