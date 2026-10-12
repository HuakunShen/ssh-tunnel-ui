//! Native window material, and the page's own drag region.
//!
//! CSS blur cannot make a desktop window translucent on its own: the operating
//! system has to install a real material behind the webview first. This module
//! does that, and — only after it genuinely succeeded — tells the document so
//! the page can switch its tokens to their translucent variants. A browser tab
//! never sets the attribute, so it keeps the opaque palette.

/// Injected at document start so the very first paint already knows whether the
/// host installed a material.
const BOOTSTRAP: &str = include_str!("native_material.js");

use tauri::WebviewWindowBuilder;

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
    // supplies dragging. Windows keeps its own caption, so it is left alone.
    let window = WebviewWindowBuilder::from_config(app, config)?
        .initialization_script(BOOTSTRAP)
        .build()?;
    // Tauri's manager already holds the window; keeping this handle alive until
    // after install means the material is in place before anything can paint.
    eprintln!(
        "native-material: built window {:?}",
        window.label()
    );
    if std::env::var("SSH_TUNNEL_NO_MATERIAL").is_err() {
        install(&window);
    }
    let _ = &window;
    Ok(())
}

fn install(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    macos::install(window);
    #[cfg(target_os = "windows")]
    windows::install(window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    publish(window, "none");
}

/// Report the installed material to the document, or `none` when there is none.
fn publish(window: &tauri::WebviewWindow, backdrop: &str) {
    let script = format!("{BOOTSTRAP}\nwindow.__nativeHost?.apply({backdrop:?});");
    let _ = window.eval(&script);
}

#[cfg(target_os = "windows")]
mod windows {
    use window_vibrancy::{apply_acrylic, apply_mica};

    pub fn install(window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            super::publish(window, "none");
            return;
        };
        // Mica backdrops a whole window; acrylic tints it. Prefer mica and fall
        // back, so a build without it still gets *some* material.
        let installed = apply_mica(hwnd, None).is_ok() || apply_acrylic(hwnd, None).is_ok();
        super::publish(window, if installed { "vibrancy" } else { "none" });
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::msg_send;
    // `ClassType` for `::class()`, `NSObjectProtocol` for `isKindOfClass`.
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
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

    pub fn install(window: &tauri::WebviewWindow) {
        let host = window.clone();
        let done = window.clone();
        let _ = window.with_webview(move |platform| {
            // with_webview runs on the main thread and keeps Tauri's platform
            // handles alive for the callback, so no raw pointer escapes it.
            unsafe {
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
                })
                .is_ok();
                if installed {
                    // The webview must not paint its own opaque background, or
                    // the material behind it stays invisible.
                    let webview = &*platform.inner().cast::<AnyObject>();
                    let _: () = msg_send![webview, _setDrawsBackground: false];
                    let _: () =
                        msg_send![webview, setUnderPageBackgroundColor: &*NSColor::clearColor()];
                }
            }
            super::publish(&done, backdrop(&platform));
        });
    }

    /// Which material actually ended up under the content view.
    ///
    /// `window-vibrancy` inserts it beneath Tauri's own content view; Tao
    /// caches that view for resize and input handling, so the material view is
    /// never reparented. Ask the view hierarchy what is really there instead of
    /// assuming the install succeeded.
    fn backdrop(platform: &tauri::webview::PlatformWebview) -> &'static str {
        unsafe {
            let webview = &*platform.inner().cast::<AnyObject>();
            let ns_window: Option<objc2::rc::Retained<NSWindow>> = msg_send![webview, window];
            let Some(ns_window) = ns_window else {
                return "none";
            };
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
}
