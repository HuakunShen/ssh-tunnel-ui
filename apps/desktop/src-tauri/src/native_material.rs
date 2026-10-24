//! Native window material, and the page's own drag region.
//!
//! CSS blur cannot make a desktop window translucent on its own: the operating
//! system has to install a real material behind the webview first. This module
//! does that, and — only after it genuinely succeeded — tells the document, so
//! the page can switch its tokens to their translucent variants. A browser tab
//! never runs this, so it keeps the opaque palette.

/// Injected at document start so the very first paint already knows whether the
/// host installed a material.
const BOOTSTRAP: &str = include_str!("native_material.js");

use std::sync::OnceLock;
use tauri::webview::PageLoadEvent;
use tauri::WebviewWindowBuilder;

/// The material this shell actually installed, published to every new page.
///
/// A webview reload starts a fresh document that never runs the startup
/// script, so without this the page would fall back to its opaque palette on
/// the first reload (and `tauri dev` reloads constantly) while a material is
/// still sitting behind it.
static INSTALLED: OnceLock<&'static str> = OnceLock::new();

fn installed() -> &'static str {
    INSTALLED.get().copied().unwrap_or("none")
}

pub fn create_main_window(app: &mut tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("main window configuration");
    // `titleBarStyle: Overlay` + `hiddenTitle` means macOS draws only the
    // traffic lights over the page; the toolbar's `data-tauri-drag-region`
    // supplies dragging. The window is built here rather than by Tauri so the
    // material and the drag-region script are in place before the first paint.
    let window = WebviewWindowBuilder::from_config(app, config)?
        .initialization_script(BOOTSTRAP)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                publish(&window, installed());
            }
        })
        .build()?;
    #[cfg(target_os = "macos")]
    macos::install(&window);
    // Windows and Linux keep the opaque palette: Mica/acrylic only show through
    // a transparent webview, and an untested half-transparent page is worse
    // than a solid one.
    #[cfg(not(target_os = "macos"))]
    publish(&window, "none");
    let _ = &window;
    Ok(())
}

/// Report the installed material to the document, or `none` when there is none.
fn publish(window: &tauri::WebviewWindow, backdrop: &str) {
    let script = format!("{BOOTSTRAP}\nwindow.__nativeHost?.apply({backdrop:?});");
    let _ = window.eval(&script);
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
    use objc2::sel;
    use objc2::ClassType;
    use objc2_app_kit::{NSColor, NSView, NSVisualEffectView, NSWindow};
    use window_vibrancy::{
        apply_liquid_glass, apply_vibrancy, LiquidGlassOptions, NSGlassEffectViewStyle,
        NSVisualEffectMaterial,
    };

    /// Liquid Glass exists only on macOS 26+. Looking the class up is the test:
    /// on an older system it simply is not registered.
    fn glass_class() -> Option<&'static AnyClass> {
        AnyClass::get(c"NSGlassEffectView")
    }

    /// Install the material behind the webview.
    ///
    /// WebKit paints an opaque background by default, which would hide the
    /// material completely, so the window and its webview are both made
    /// transparent. Every private selector is guarded: if WebKit drops one, the
    /// window stays opaque and readable rather than turning into a blank pane.
    pub fn install(window: &tauri::WebviewWindow) {
        let host = window.clone();
        // A second handle, because `with_webview` may run its closure later than
        // this call returns.
        let owner = window.clone();
        let _ = window.with_webview(move |platform| unsafe {
            let webview = &*platform.inner().cast::<AnyObject>();
            let ns_window: Option<objc2::rc::Retained<NSWindow>> = msg_send![webview, window];
            let Some(ns_window) = ns_window else {
                return;
            };
            let transparent: bool =
                msg_send![webview, respondsToSelector: sel!(_setDrawsBackground:)];
            if !transparent {
                eprintln!("native-material: webview cannot go transparent; staying opaque");
                return;
            }
            let view = &*platform.inner().cast::<NSView>();
            let installed = apply_liquid_glass(
                &host,
                LiquidGlassOptions::new(NSGlassEffectViewStyle::Regular)
                    .radius(0.0)
                    .content_view(view),
            )
            .or_else(|_| {
                apply_vibrancy(
                    &host,
                    NSVisualEffectMaterial::UnderWindowBackground,
                    None,
                    None,
                )
            });
            if installed.is_err() {
                eprintln!("native-material: no material available; staying opaque");
                return;
            }
            let _: () = msg_send![webview, _setDrawsBackground: false];
            let supports_under_page: bool =
                msg_send![webview, respondsToSelector: sel!(setUnderPageBackgroundColor:)];
            if supports_under_page {
                let _: () = msg_send![webview, setUnderPageBackgroundColor: &*NSColor::clearColor()];
            }
            ns_window.setOpaque(false);
            ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
            // The page draws its own title bar, so the native one must not
            // paint a background either.
            ns_window.setTitlebarAppearsTransparent(true);

            let backdrop = installed_backdrop(&ns_window);
            let _ = super::INSTALLED.set(backdrop);
            // `eval` has to reach a webview that is already running; calling it
            // here, during setup, deadlocks. Hand the answer to the next tick.
            let pending = owner.clone();
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                super::publish(&pending, backdrop);
            });
        });
    }

    /// Which material actually ended up under the content view.
    ///
    /// `window-vibrancy` inserts it beneath Tauri's own content view; Tao
    /// caches that view for resize and input handling, so the material view is
    /// never reparented. Ask the view hierarchy what is really there instead of
    /// assuming the install succeeded.
    unsafe fn installed_backdrop(ns_window: &NSWindow) -> &'static str {
        let Some(content) = ns_window.contentView() else {
            return "none";
        };
        let glass = glass_class();
        for view in content.subviews().iter() {
            if glass.is_some_and(|class| view.isKindOfClass(class)) {
                return "glass";
            }
            if view.isKindOfClass(NSVisualEffectView::class()) {
                return "vibrancy";
            }
        }
        "none"
    }
}
