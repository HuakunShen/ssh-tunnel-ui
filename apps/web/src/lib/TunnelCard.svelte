<!--
  TunnelCard: one tunnel row. Status glow dot, forwarding summary in mono,
  one-click start/stop, probe + inspect + edit + delete affordances.
-->
<script lang="ts">
  import {
    CircleStop,
    FlaskConical,
    Pencil,
    Play,
    SquareTerminal,
    Trash2,
  } from "@lucide/svelte";
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

  function forwardText(f: TunnelProfile["forwards"][number]): string {
    if (f.kind === "dynamic") return `-D ${(f.bindAddress ? `${f.bindAddress}:` : "") + f.bindPort}`;
    const flag = f.kind === "local" ? "-L" : "-R";
    return `${flag} ${(f.bindAddress ? `${f.bindAddress}:` : "") + f.bindPort} → ${f.targetHost}:${f.targetPort}`;
  }
</script>

<article
  class="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur transition hover:border-cyan-400/30 hover:bg-white/[0.05]"
>
  <div class="flex items-start gap-3">
    <span class={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} title={status}></span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="truncate text-[15px] font-semibold tracking-tight">{profile.name}</h3>
        <span class="rounded-full bg-cyan-400/10 px-2 py-0.5 font-mono text-[11px] text-cyan-300">{modeBadge}</span>
        <span class="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">{status}</span>
      </div>
      <p class="mt-1 truncate font-mono text-xs text-slate-400">
        {profile.sshTarget}{#if profile.jumpHops?.length}{" "}<span class="text-slate-500">via {profile.jumpHops.join(", ")}</span>{/if}
      </p>
      <div class="mt-2 space-y-0.5 font-mono text-xs text-slate-300">
        {#each profile.forwards as f}
          <div class="truncate">{forwardText(f)}</div>
        {/each}
      </div>
      {#if state?.lastError}
        <p class="mt-2 truncate text-xs text-red-400" title={state.lastError}>{state.lastError}</p>
      {/if}
      {#if state?.pid}
        <p class="mt-1 font-mono text-[11px] text-slate-500">pid {state.pid}</p>
      {/if}
    </div>
  </div>

  <div class="mt-3 flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
    {#if live}
      <button
        disabled={busy}
        onclick={() => onStop(profile.id)}
        class="inline-flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/25 disabled:opacity-40"
      ><CircleStop size={14} /> Stop</button>
    {:else}
      <button
        disabled={busy}
        onclick={() => onStart(profile.id)}
        class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/30 disabled:opacity-40"
      ><Play size={14} /> Start</button>
    {/if}
    <button
      disabled={busy}
      onclick={() => onProbe(profile.id)}
      title="Probe forwarded ports"
      class="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
    ><FlaskConical size={14} /> Probe</button>
    <button
      onclick={() => onInspect(profile.id)}
      title="Show exact ssh command"
      class="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
    ><SquareTerminal size={14} /> Inspect</button>
    <span class="flex-1"></span>
    <button
      onclick={() => onEdit(profile)}
      title="Edit"
      class="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
    ><Pencil size={14} /></button>
    <button
      onclick={() => onDelete(profile.id, profile.name)}
      title="Delete"
      class="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/20 hover:text-red-300"
    ><Trash2 size={14} /></button>
  </div>
</article>
