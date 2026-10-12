<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";

  let { children } = $props();

  // Theme + platform markers for the shadcn token layer: `.dark` selects the
  // dark variable set, `data-interface` drives macos:/windows:/linux:
  // component variants (space-lens shape). Defaults follow the OS; the daemon
  // never stores a preference (no backend for it).
  onMount(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get("theme");
    // The desktop shell draws macOS traffic lights over the page (Overlay
    // title bar), so only that shell needs the toolbar inset.
    const nativeChrome = window.location.protocol === "tauri:";
    const apply = (): void => {
      // `?theme=dark|light` overrides the OS for screenshots and e2e.
      const isDark = themeParam === "dark" ? true : themeParam === "light" ? false : dark.matches;
      document.documentElement.classList.toggle("dark", isDark);
      const platform =
        navigator.userAgent.includes("Mac") ? "macos"
        : navigator.userAgent.includes("Windows") ? "windows"
        : "linux";
      document.documentElement.dataset["interface"] = platform;
      if (nativeChrome) {
        document.documentElement.dataset["nativeChrome"] = "true";
      }
    };
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  });
</script>

{@render children()}
