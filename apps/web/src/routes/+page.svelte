<!--
  Tunnel console main page: header stats, tunnel card grid, editor dialog,
  inspect drawer. Polls the daemon every 3s; all mutations go through the
  shared typed client.
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Activity,
    CircleStop,
    Plus,
    RefreshCw,
    SquareTerminal,
    Wifi,
    WifiOff,
  } from "@lucide/svelte";
  import TunnelCard from "$lib/TunnelCard.svelte";
  import TunnelEditor from "$lib/TunnelEditor.svelte";
  import {
    getClient,
    initialStore,
    refreshAll,
    refreshHosts,
    type TunnelProfile,
    type TunnelProfileInput,
  } from "$lib/store";

  let store = $state({ ...initialStore });
  let editorOpen = $state(false);
  let editing: TunnelProfile | null = $state(null);
  let saving = $state(false);
  let editorError: string | null = $state(null);
  let busyIds = $state(new Set<string>());
  let toast = $state<string | null>(null);
  let inspectCommand: string | null = $state(null);
  let inspectOpen = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  function say(message: string): void {
    toast = message;
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  async function refresh(): Promise<void> {
    store = await refreshAll(store);
  }

  function setBusy(id: string, on: boolean): void {
    const next = new Set(busyIds);
    if (on) next.add(id);
    else next.delete(id);
    busyIds = next;
  }

  async function act(id: string, label: string, fn: () => Promise<unknown>): Promise<void> {
    if (busyIds.has(id)) return;
    setBusy(id, true);
    try {
      await fn();
      say(label);
    } catch (e) {
      store = { ...store, lastError: e instanceof Error ? e.message : "action failed" };
    } finally {
      setBusy(id, false);
      await refresh();
    }
  }

  const running = $derived(store.states.filter((s) => s.status === "running").length);
  const failed = $derived(store.states.filter((s) => s.status === "failed").length);

  function openCreate(): void {
    editing = null;
    editorError = null;
    editorOpen = true;
  }

  function openEdit(profile: TunnelProfile): void {
    editing = profile;
    editorError = null;
    editorOpen = true;
  }

  async function saveProfile(input: TunnelProfileInput): Promise<void> {
    saving = true;
    editorError = null;
    try {
      if (editing !== null) {
        await getClient().updateProfile(editing.id, input);
        say(`saved ${input.name}`);
      } else {
        await getClient().createProfile(input);
        say(`created ${input.name} — press Start to apply`);
      }
      editorOpen = false;
    } catch (e) {
      editorError = e instanceof Error ? e.message : "save failed";
    } finally {
      saving = false;
      await refresh();
    }
  }

  async function deleteProfile(id: string, name: string): Promise<void> {
    if (!confirm(`Delete tunnel "${name}"?`)) return;
    await act(id, `deleted ${name}`, () => getClient().deleteProfile(id));
  }

  async function inspect(id: string): Promise<void> {
    try {
      const result = await getClient().preview(id);
      inspectCommand = `$ ${result.command}`;
      inspectOpen = true;
    } catch (e) {
      store = { ...store, lastError: e instanceof Error ? e.message : "inspect failed" };
    }
  }

  async function stopAll(): Promise<void> {
    try {
      await getClient().stopAll();
      say("stopped all tunnels");
    } catch (e) {
      store = { ...store, lastError: e instanceof Error ? e.message : "stop-all failed" };
    }
    await refresh();
  }

  onMount(() => {
    void refresh().then(() => refreshHosts(store).then((s) => (store = s)));
    timer = setInterval(() => void refresh(), 3000);
    // Test hook: `?editor=open` auto-opens the creation dialog for
    // screenshots and e2e without shipping any test-only UI.
    try {
      if (new URLSearchParams(window.location.search).get("editor") === "open") {
        editorOpen = true;
      }
    } catch {
      // Non-browser (prerender): ignore.
    }
  });
  onDestroy(() => {
    if (timer !== undefined) clearInterval(timer);
    if (toastTimer !== undefined) clearTimeout(toastTimer);
  });
</script>

<div class="mx-auto max-w-6xl px-4 pb-16">
  <!-- Header -->
  <header class="flex flex-wrap items-end gap-3 border-b border-white/10 py-6">
    <div>
      <h1 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Activity class="text-cyan-400" size={24} />
        SSH Tunnel
      </h1>
      <p class="mt-1 text-sm text-slate-400">Remember every tunnel · one click to apply · one click to stop</p>
    </div>
    <span class="flex-1"></span>
    <div class="flex items-center gap-2 font-mono text-xs">
      <span class="rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-300">{running} running</span>
      {#if failed > 0}
        <span class="rounded-full bg-red-500/10 px-2.5 py-1 text-red-300">{failed} failed</span>
      {/if}
      <span class="rounded-full bg-white/5 px-2.5 py-1 text-slate-400">{store.profiles.length} tunnels</span>
    </div>
    <div class="flex items-center gap-1.5 text-xs {store.connected ? 'text-emerald-300' : 'text-slate-500'}">
      {#if store.connected}<Wifi size={14} />{:else}<WifiOff size={14} />{/if}
      {store.connected ? "connected" : store.loading ? "connecting…" : "offline"}
    </div>
  </header>

  <!-- Toolbar -->
  <div class="my-4 flex flex-wrap gap-2">
    <button
      onclick={openCreate}
      class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
    ><Plus size={16} /> New tunnel</button>
    <button
      onclick={stopAll}
      class="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/10"
    ><CircleStop size={16} /> Stop all</button>
    <button
      onclick={refresh}
      class="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
    ><RefreshCw size={16} /> Refresh</button>
    <span class="flex-1"></span>
    {#if store.hosts.length}
      <span class="self-center font-mono text-xs text-slate-500">{store.hosts.length} ssh hosts</span>
    {/if}
  </div>

  {#if store.lastError}
    <p class="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{store.lastError}</p>
  {/if}

  <!-- Grid -->
  {#if store.profiles.length === 0 && !store.loading}
    <div class="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
      <SquareTerminal class="mx-auto text-slate-600" size={36} />
      <p class="mt-3 font-medium">No tunnels yet</p>
      <p class="mt-1 text-sm text-slate-400">Create one — your SSH aliases are suggested in the target field.</p>
      <button onclick={openCreate} class="mt-4 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">
        + New tunnel
      </button>
    </div>
  {:else}
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {#each store.profiles as profile (profile.id)}
        <TunnelCard
          {profile}
          state={store.states.find((s) => s.profileId === profile.id)}
          busy={busyIds.has(profile.id)}
          onStart={(id) => act(id, "started", () => getClient().start(id))}
          onStop={(id) => act(id, "stopped", () => getClient().stop(id))}
          onProbe={(id) => act(id, "probed", () => getClient().probe(id))}
          onInspect={inspect}
          onEdit={openEdit}
          onDelete={deleteProfile}
        />
      {/each}
    </div>
  {/if}

  {#if store.hosts.length}
    <details class="mt-6 text-sm text-slate-500">
      <summary class="cursor-pointer hover:text-slate-300">SSH hosts from ~/.ssh/config</summary>
      <p class="mt-2 font-mono text-xs">{store.hosts.map((h) => h.alias + (h.hostName ? ` (${h.hostName})` : "")).join(" · ")}</p>
    </details>
  {/if}
</div>

<TunnelEditor
  open={editorOpen}
  {editing}
  hosts={store.hosts}
  {saving}
  error={editorError}
  onSave={(input) => void saveProfile(input)}
  onClose={() => (editorOpen = false)}
/>

{#if inspectOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" tabindex="-1" onclick={() => (inspectOpen = false)} onkeydown={(e) => e.key === "Escape" && (inspectOpen = false)}>
    <div role="dialog" aria-modal="true" aria-label="Exact ssh command" tabindex="-1"
      class="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-semibold tracking-tight">Exact ssh command</h2>
      <p class="mt-1 text-xs text-slate-500">This is precisely what the daemon spawns — learn the flags by seeing them.</p>
      <pre class="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 font-mono text-xs leading-relaxed text-emerald-200">{inspectCommand ?? ""}</pre>
      <div class="mt-4 flex justify-end">
        <button onclick={() => (inspectOpen = false)} class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/10">Close</button>
      </div>
    </div>
  </div>
{/if}

{#if toast}
  <div class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-800 px-4 py-2 text-sm shadow-xl ring-1 ring-white/10">
    {toast}
  </div>
{/if}
