<!--
  TunnelRow: one tunnel in the console list. Reads as a macOS list row (flat,
  hairline separated) rather than a card, with the actions a network operator
  actually wants: start/stop, probe, copy the exact ssh command, and "Open in"
  a real terminal window when the host reports one.
-->
<script lang="ts">
  import {
    CircleStop,
    Copy,
    Check,
    ExternalLink,
    FlaskConical,
    Pencil,
    Play,
    Terminal as TerminalIcon,
    Trash,
  } from "@lucide/svelte";
  import type { TerminalTarget, TunnelProfile, TunnelState } from "$lib/store";

  interface Props {
    profile: TunnelProfile;
    tunnelState?: TunnelState;
    busy: boolean;
    terminals: readonly TerminalTarget[];
    onStart: (id: string) => void;
    onStop: (id: string) => void;
    onProbe: (id: string) => void;
    onCopy: (id: string) => void;
    onLaunch: (id: string, terminalId: string) => void;
    onEdit: (profile: TunnelProfile) => void;
    onDelete: (id: string, name: string) => void;
  }

  let {
    profile,
    tunnelState,
    busy,
    terminals,
    onStart,
    onStop,
    onProbe,
    onCopy,
    onLaunch,
    onEdit,
    onDelete,
  }: Props = $props();

  let menuOpen = $state(false);
  let copied = $state(false);

  const status = $derived(tunnelState?.status ?? "stopped");
  const live = $derived(status === "running" || status === "degraded" || status === "starting");

  const dotClass = $derived(
    status === "running"
      ? "bg-signal-running"
      : status === "degraded"
        ? "bg-signal-degraded"
        : status === "failed"
          ? "bg-signal-failed"
          : status === "starting" || status === "stopping"
            ? "bg-signal-starting animate-pulse"
            : "bg-signal-idle",
  );

  // Human wording, not `-L/-R/-D`: the mode name explains itself.
  const modeLabel = $derived(
    profile.mode === "local"
      ? "Local"
      : profile.mode === "remote"
        ? "Remote"
        : profile.mode === "dynamic"
          ? "Dynamic"
          : profile.mode === "jump"
            ? "Jump"
            : "Multi",
  );

  function forwardText(f: TunnelProfile["forwards"][number]): string {
    if (f.kind === "dynamic") {
      return `SOCKS5 on ${(f.bindAddress ? `${f.bindAddress}:` : "") + f.bindPort}`;
    }
    const bind = (f.bindAddress ? `${f.bindAddress}:` : "") + String(f.bindPort);
    const arrow = f.kind === "local" ? "→" : "←";
    return `localhost:${bind} ${arrow} ${f.targetHost}:${f.targetPort}`;
  }

  function pick(terminalId: string): void {
    menuOpen = false;
    onLaunch(profile.id, terminalId);
  }

  async function copy(): Promise<void> {
    onCopy(profile.id);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<div class="tunnel-row">
  <span class={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} title={status}></span>

  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-8">
      <span class="row-name">{profile.name}</span>
      <span class="row-detail">{modeLabel}</span>
      <span class="row-detail capitalize">{status}</span>
    </div>
    <div class="row-detail mt-[3px] flex flex-wrap items-center gap-x-3 font-mono">
      <span class="truncate">
        {profile.sshTarget}{#if profile.jumpHops?.length}&nbsp;via&nbsp;{profile.jumpHops.join(", ")}{/if}
      </span>
      {#each profile.forwards as f}
        <span class="truncate">{forwardText(f)}</span>
      {/each}
    </div>
    {#if tunnelState?.lastError}
      <p class="mt-1 truncate text-[10px] text-destructive" title={tunnelState.lastError}>{tunnelState.lastError}</p>
    {/if}
  </div>

  <div class="row-actions shrink-0">
    {#if live}
      <button class="toolbar-button" disabled={busy} onclick={() => onStop(profile.id)} title="Stop tunnel">
        <CircleStop size={13} /> Stop
      </button>
    {:else}
      <button class="toolbar-button" disabled={busy} onclick={() => onStart(profile.id)} title="Start tunnel">
        <Play size={13} /> Start
      </button>
    {/if}

    <button class="toolbar-icon" onclick={() => void copy()} title="Copy the ssh command" aria-label="Copy the ssh command">
      {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
    </button>

    <button class="toolbar-icon" disabled={busy} onclick={() => onProbe(profile.id)} title="Probe forwarded ports" aria-label="Probe forwarded ports">
      <FlaskConical size={14} />
    </button>

    {#if terminals.length > 0}
      <div class="relative">
        <button
          class="toolbar-icon"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}
          title="Open in a terminal"
          aria-label="Open in a terminal"
        >
          <TerminalIcon size={14} />
        </button>
        {#if menuOpen}
          <div
            class="absolute right-0 z-20 mt-1 min-w-[184px] overflow-hidden rounded-[var(--radius)] border border-border bg-popover py-1 shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
            role="menu"
            tabindex="-1"
            onkeydown={(e) => { if (e.key === "Escape") menuOpen = false; }}
          >
            <p class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Open in</p>
            {#each terminals as terminal (terminal.id)}
              <button
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-accent"
                role="menuitem"
                onclick={() => pick(terminal.id)}
              >
                <ExternalLink size={12} class="text-muted-foreground" />
                <span class="flex-1 truncate">{terminal.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <button class="toolbar-icon" onclick={() => onEdit(profile)} title="Edit" aria-label="Edit tunnel">
      <Pencil size={14} />
    </button>
    <button
      class="toolbar-icon hover:!text-destructive"
      onclick={() => onDelete(profile.id, profile.name)}
      title="Delete"
      aria-label="Delete tunnel"
    >
      <Trash size={14} />
    </button>
  </div>
</div>