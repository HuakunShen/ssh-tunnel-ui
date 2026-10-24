<!--
  LogSheet: the tunnel's own log, in the window that reports the failure.
  "ssh exited with code 255; see /path" is only useful if the path is a click
  away, so this reads the tail from the daemon and shows it here.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { Check, Copy, RefreshCw, X } from "@lucide/svelte";
  import { getClient, type LogTail, type TunnelProfile } from "$lib/store";

  interface Props {
    open: boolean;
    profile: TunnelProfile | null;
    onClose: () => void;
  }

  let { open, profile, onClose }: Props = $props();

  let log = $state<LogTail | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let copied = $state(false);
  let scroller: HTMLPreElement | undefined = $state();

  async function load(): Promise<void> {
    if (profile === null) return;
    loading = true;
    error = null;
    try {
      log = await getClient().getLog(profile.id, 500);
      await tick();
      if (scroller !== undefined) scroller.scrollTop = scroller.scrollHeight;
    } catch (e) {
      error = e instanceof Error ? e.message : "cannot read the log";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open && profile !== null) void load();
  });

  async function copy(): Promise<void> {
    if (log === null || log.lines.length === 0) return;
    await navigator.clipboard.writeText(log.lines.join("\n"));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if open && profile !== null}
  <div
    class="sheet-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
    role="presentation"
    tabindex="-1"
    onclick={onClose}
    onkeydown={(e) => e.key === "Escape" && onClose()}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Log for ${profile.name}`}
      class="tunnel-dialog flex max-h-[80vh] w-full max-w-[820px] flex-col p-5"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && onClose()}
      tabindex="-1"
    >
      <div class="mb-2 flex items-center justify-between gap-3">
        <h2 class="dialog-title truncate">Log — {profile.name}</h2>
        <button class="toolbar-icon" onclick={onClose} title="Close" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <p class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span class="truncate" title={log?.path ?? ""}>{log?.path ?? "…"}</span>
        {#if log !== null}
          <span>{log.bytes} bytes</span>
          {#if log.truncated}<span>tail</span>{/if}
        {/if}
      </p>

      {#if error !== null}
        <p class="mb-3 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </p>
      {/if}

      <pre
        bind:this={scroller}
        class="min-h-[180px] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-border bg-muted/40 p-3 font-mono text-[11px] leading-[1.55]">{loading
          ? "reading…"
          : log?.lines.length
            ? log.lines.join("\n")
            : "Nothing in this log yet — start the tunnel and its ssh output lands here."}</pre>

      <div class="mt-3 flex items-center justify-end gap-2">
        <button class="toolbar-button" onclick={() => void load()} disabled={loading} title="Re-read the log">
          <RefreshCw size={13} /> {loading ? "Reading…" : "Refresh"}
        </button>
        <button class="toolbar-button" onclick={() => void copy()} disabled={(log?.lines.length ?? 0) === 0} title="Copy the log">
          {#if copied}<Check size={13} /> Copied{:else}<Copy size={13} /> Copy{/if}
        </button>
      </div>
    </div>
  </div>
{/if}
