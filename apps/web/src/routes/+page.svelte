<!--
  Tunnel console shell: toolbar / sidebar / content / status bar, the same
  frame space-lens uses so this app reads as a native desktop window rather
  than a centered web page. Polls the daemon every 3s; all mutations go
  through the shared typed client.
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    CircleStop,
    Plus,
    RefreshCw,
    SquareTerminal,
    Wifi,
    WifiOff,
  } from "@lucide/svelte";
  import TunnelRow from "$lib/TunnelRow.svelte";
  import TunnelEditor from "$lib/TunnelEditor.svelte";
  import {
    getClient,
    initialStore,
    refreshAll,
    refreshHosts,
    refreshTerminals,
    type TerminalTarget,
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
  let timer: ReturnType<typeof setInterval> | undefined = undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  // Sidebar filter: all, running, or stopped. Pure view state — the daemon
  // still owns every profile.
  let filter = $state<"all" | "live" | "idle">("all");

  const running = $derived(store.states.filter((s) => s.status === "running").length);
  const failed = $derived(store.states.filter((s) => s.status === "failed").length);

  const visible = $derived(
    store.profiles.filter((profile) => {
      if (filter === "all") return true;
      const status = store.states.find((s) => s.profileId === profile.id)?.status ?? "stopped";
      const isLive = status === "running" || status === "starting" || status === "degraded";
      return filter === "live" ? isLive : !isLive;
    }),
  );

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

  async function copyCommand(id: string): Promise<void> {
    try {
      const { command } = await getClient().preview(id);
      await navigator.clipboard.writeText(command);
      say("command copied — paste it anywhere");
    } catch (e) {
      store = { ...store, lastError: e instanceof Error ? e.message : "copy failed" };
    }
  }

  async function launch(id: string, terminalId: string): Promise<void> {
    setBusy(id, true);
    try {
      const session = await getClient().launchInTerminal(id, terminalId);
      say(`opened in ${terminalId} (pid ${session.pid})`);
    } catch (e) {
      store = { ...store, lastError: e instanceof Error ? e.message : "launch failed" };
    } finally {
      setBusy(id, false);
      await refresh();
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

  function terminalLabel(terminalId: string, terminals: readonly TerminalTarget[]): string {
    return terminals.find((t) => t.id === terminalId)?.label ?? terminalId;
  }

  onMount(() => {
    void (async () => {
      store = await refreshAll(store);
      store = await refreshHosts(store);
      store = await refreshTerminals(store);
    })();
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

<div class="tunnel-shell">
  <!-- Title bar -->
  <header class="tunnel-toolbar">
    <div class="toolbar-title">
      <strong>SSH Tunnel</strong>
      <span>one click to apply, one click to stop</span>
    </div>
    <span class="toolbar-spacer"></span>
    <div class="toolbar-actions glass-controls">
      <button class="toolbar-button primary" onclick={openCreate} title="New tunnel">
        <Plus size={14} /> New tunnel
      </button>
      <button class="toolbar-icon" onclick={() => void stopAll()} title="Stop all tunnels" aria-label="Stop all tunnels">
        <CircleStop size={14} />
      </button>
      <button class="toolbar-icon" onclick={() => void refresh()} title="Refresh" aria-label="Refresh">
        <RefreshCw size={14} />
      </button>
    </div>
  </header>

  <div class="tunnel-body">
    <!-- Sidebar -->
    <aside class="tunnel-sidebar">
      <div class="sidebar-scroll">
        <p class="sidebar-heading">Tunnels</p>
        <button class="sidebar-item" class:selected={filter === "all"} onclick={() => (filter = "all")}>
          <SquareTerminal size={15} /> <span>All</span>
          <span class="sidebar-count">{store.profiles.length}</span>
        </button>
        <button class="sidebar-item" class:selected={filter === "live"} onclick={() => (filter = "live")}>
          <Wifi size={15} /> <span>Running</span>
          <span class="sidebar-count">{running}</span>
        </button>
        <button class="sidebar-item" class:selected={filter === "idle"} onclick={() => (filter = "idle")}>
          <WifiOff size={15} /> <span>Stopped</span>
          <span class="sidebar-count">{store.profiles.length - running}</span>
        </button>

        {#if store.hosts.length}
          <p class="sidebar-heading">SSH hosts</p>
          {#each store.hosts.slice(0, 12) as host (host.alias)}
            <div class="sidebar-item" title={host.alias}>
              <SquareTerminal size={15} /> <span>{host.alias}</span>
            </div>
          {/each}
        {/if}

        {#if store.terminals.length}
          <p class="sidebar-heading">Terminals</p>
          {#each store.terminals as terminal (terminal.id)}
            <div class="sidebar-item" title={terminal.hint}>
              <SquareTerminal size={15} /> <span>{terminal.label}</span>
            </div>
          {/each}
        {/if}
      </div>
    </aside>

    <!-- Content -->
    <main class="tunnel-content">
      <div class="content-heading">
        <h2>Tunnels</h2>
        <p>{visible.length} of {store.profiles.length} shown</p>
      </div>

      {#if store.lastError}
        <p class="mb-3 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {store.lastError}
        </p>
      {/if}

      {#if store.profiles.length === 0 && !store.loading}
        <div class="content-empty">
          <SquareTerminal size={30} />
          <p class="text-[13px] text-foreground">No tunnels yet</p>
          <p class="text-[12px]">Create one — your SSH aliases are suggested in the target field.</p>
          <button class="toolbar-button primary mt-2" onclick={openCreate}><Plus size={14} /> New tunnel</button>
        </div>
      {:else if visible.length === 0}
        <div class="content-empty">
          <p class="text-[12px]">Nothing matches this filter.</p>
        </div>
      {:else}
        <div class="tunnel-table">
          {#each visible as profile (profile.id)}
            <TunnelRow
              {profile}
              tunnelState={store.states.find((s) => s.profileId === profile.id)}
              busy={busyIds.has(profile.id)}
              terminals={store.terminals}
              onStart={(id) => act(id, "started", () => getClient().start(id))}
              onStop={(id) => act(id, "stopped", () => getClient().stop(id))}
              onProbe={(id) => act(id, "probed", () => getClient().probe(id))}
              onCopy={(id) => void copyCommand(id)}
              onLaunch={launch}
              onEdit={openEdit}
              onDelete={deleteProfile}
            />
          {/each}
        </div>
      {/if}
    </main>
  </div>

  <!-- Status bar -->
  <footer class="tunnel-status">
    <span>
      <strong>{running}</strong> running
      <span class="separator">·</span>
      <strong>{store.profiles.length}</strong> tunnels
      {#if failed > 0}
        <span class="separator">·</span>
        <strong class="text-destructive">{failed}</strong> failed
      {/if}
      <span class="separator">·</span>
      <strong>{store.hosts.length}</strong> ssh hosts
    </span>
    <span>
      <i class:offline={!store.connected}></i>
      {store.connected ? "daemon connected" : store.loading ? "connecting…" : "daemon offline"}
    </span>
  </footer>
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

{#if toast}
  <div class="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius)] border border-border bg-popover px-3 py-1.5 text-[12px] text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/0.2)]">
    {toast}
  </div>
{/if}