<!--
  TunnelCard: one tunnel row. Status glow dot, forwarding summary in mono,
  one-click start/stop, probe + inspect + edit + delete affordances.
  Built on @ssh-tunnel/web-ui (Card/Button/Badge) with macOS-native radii.
-->
<script lang="ts">
  import {
    CircleStop,
    FlaskConical,
    Pencil,
    Play,
    SquareTerminal,
    Trash,
  } from "@lucide/svelte";
  import { Badge } from "@ssh-tunnel/web-ui";
  import { Button } from "@ssh-tunnel/web-ui";
  import { Card } from "@ssh-tunnel/web-ui";
  import type { TunnelProfile, TunnelState } from "$lib/store";

  interface Props {
    profile: TunnelProfile;
    state?: TunnelState;
    busy: boolean;
    onStart: (id: string) => void;
    onStop: (id: string) => void;
    onProbe: (id: string) => void;
    onInspect: (id: string) => void;
    onEdit: (profile: TunnelProfile) => void;
    onDelete: (id: string, name: string) => void;
  }

  let { profile, state, busy, onStart, onStop, onProbe, onInspect, onEdit, onDelete }: Props = $props();

  const status = $derived(state?.status ?? "stopped");
  const live = $derived(status === "running" || status === "degraded" || status === "starting");

  const dotClass = $derived(
    status === "running"
      ? "bg-signal-running shadow-[0_0_12px_2px_rgb(52_211_153/0.6)]"
      : status === "degraded"
        ? "bg-signal-degraded shadow-[0_0_12px_2px_rgb(251_191_36/0.6)]"
        : status === "failed"
          ? "bg-signal-failed shadow-[0_0_12px_2px_rgb(248_113_113/0.6)]"
          : status === "starting" || status === "stopping"
            ? "bg-signal-starting animate-pulse"
            : "bg-signal-idle",
  );

  const modeBadge = $derived(
    profile.mode === "local"
      ? "-L local"
      : profile.mode === "remote"
        ? "-R remote"
        : profile.mode === "dynamic"
          ? "-D socks"
          : profile.mode === "jump"
            ? "-J jump"
            : "multi",
  );

  const statusVariant = $derived(
    status === "running" ? "success" as const
      : status === "failed" ? "danger" as const
      : status === "degraded" ? "warning" as const
        : "muted" as const,
  );

  function forwardText(f: TunnelProfile["forwards"][number]): string {
    if (f.kind === "dynamic") return `-D ${(f.bindAddress ? `${f.bindAddress}:` : "") + f.bindPort}`;
    const flag = f.kind === "local" ? "-L" : "-R";
    return `${flag} ${(f.bindAddress ? `${f.bindAddress}:` : "") + f.bindPort} → ${f.targetHost}:${f.targetPort}`;
  }
</script>

<Card class="group p-4 transition hover:border-primary/40">
  <div class="flex items-start gap-3">
    <span class={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} title={status}></span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="truncate text-[15px] font-semibold tracking-tight">{profile.name}</h3>
        <Badge variant="default">{modeBadge}</Badge>
        <Badge variant={statusVariant} glow={status === "running" || status === "failed" || status === "degraded"}>{status}</Badge>
      </div>
      <p class="mt-1 truncate font-mono text-xs text-muted-foreground">
        {profile.sshTarget}{#if profile.jumpHops?.length}{" "}<span class="opacity-70">via {profile.jumpHops.join(", ")}</span>{/if}
      </p>
      <div class="mt-2 space-y-0.5 font-mono text-xs opacity-90">
        {#each profile.forwards as f}
          <div class="truncate">{forwardText(f)}</div>
        {/each}
      </div>
      {#if state?.lastError}
        <p class="mt-2 truncate text-xs text-destructive" title={state.lastError}>{state.lastError}</p>
      {/if}
      {#if state?.pid}
        <p class="mt-1 font-mono text-[11px] text-muted-foreground">pid {state.pid}</p>
      {/if}
    </div>
  </div>

  <div class="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
    {#if live}
      <Button variant="destructive" size="sm" disabled={busy} onclick={() => onStop(profile.id)}>
        <CircleStop size={14} /> Stop
      </Button>
    {:else}
      <Button variant="default" size="sm" disabled={busy} onclick={() => onStart(profile.id)} class="bg-signal-running/20 text-signal-running hover:bg-signal-running/30">
        <Play size={14} /> Start
      </Button>
    {/if}
    <Button variant="secondary" size="sm" disabled={busy} onclick={() => onProbe(profile.id)} title="Probe forwarded ports">
      <FlaskConical size={14} /> Probe
    </Button>
    <Button variant="secondary" size="sm" onclick={() => onInspect(profile.id)} title="Show exact ssh command">
      <SquareTerminal size={14} /> Inspect
    </Button>
    <span class="flex-1"></span>
    <Button variant="ghost" size="icon-sm" onclick={() => onEdit(profile)} title="Edit" aria-label="Edit tunnel">
      <Pencil size={14} />
    </Button>
    <Button variant="ghost" size="icon-sm" onclick={() => onDelete(profile.id, profile.name)} title="Delete" aria-label="Delete tunnel" class="hover:bg-destructive/20 hover:text-destructive">
      <Trash size={14} />
    </Button>
  </div>
</Card>
