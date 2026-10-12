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
    const apply = (): void => {
      document.documentElement.classList.toggle("dark", dark.matches);
      const platform =
        navigator.userAgent.includes("Mac") ? "macos"
        : navigator.userAgent.includes("Windows") ? "windows"
        : "linux";
      document.documentElement.dataset["interface"] = platform;
    };
    apply();
    dark.addEventListener("change", apply);
    return () => dark.removeEventListener("change", apply);
  });
</script>

{@render children()}
