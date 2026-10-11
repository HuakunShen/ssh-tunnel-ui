<!--
  TunnelEditor: create/edit dialog. Covers local/remote/dynamic/jump/multi:
  target + jump hops + identity + extra forwards list with per-row kinds.
-->
<script lang="ts">
  import { Plus, X } from "@lucide/svelte";
  import type { SshHostInfo, TunnelProfile, TunnelProfileInput } from "$lib/store";
  import { TUNNEL_MODES, type ForwardRule, type TunnelMode } from "@ssh-tunnel/contract";

  interface Props {
    open: boolean;
    editing: TunnelProfile | null;
    hosts: SshHostInfo[];
    saving: boolean;
    error: string | null;
    onSave: (input: TunnelProfileInput) => void;
    onClose: () => void;
  }

  let { open, editing, hosts, saving, error, onSave, onClose }: Props = $props();

  let name = $state("");
  let mode: TunnelMode = $state("local");
  let sshTarget = $state("");
  let jumpHops = $state("");
  let sshUser = $state("");
  let sshPort = $state("");
  let identityFile = $state("");
  let notes = $state("");
  let forwards: { kind: "local" | "remote" | "dynamic"; bind: string; port: string; host: string; targetPort: string }[] = $state([]);

  $effect(() => {
    if (!open) return;
    name = editing?.name ?? "";
    mode = editing?.mode ?? "local";
    sshTarget = editing?.sshTarget ?? "";
    jumpHops = editing?.jumpHops?.join(", ") ?? "";
    sshUser = editing?.sshUser ?? "";
    sshPort = editing?.sshPort !== undefined ? String(editing.sshPort) : "";
    identityFile = editing?.identityFile ?? "";
    notes = editing?.notes ?? "";
    forwards =
      editing?.forwards.map((f) =>
        f.kind === "dynamic"
          ? { kind: f.kind, bind: f.bindAddress ?? "", port: String(f.bindPort), host: "", targetPort: "" }
          : { kind: f.kind, bind: f.bindAddress ?? "", port: String(f.bindPort), host: f.targetHost, targetPort: String(f.targetPort) },
      ) ?? [{ kind: "local", bind: "", port: "8080", host: "127.0.0.1", targetPort: "80" }];
  });

  function addForward(): void {
    forwards = [...forwards, { kind: "local", bind: "", port: "", host: "127.0.0.1", targetPort: "" }];
  }

  function removeForward(index: number): void {
    forwards = forwards.filter((_, i) => i !== index);
  }

  function save(): void {
    try {
      const rules: ForwardRule[] = forwards.map((f, i) => {
      const bindPort = Number.parseInt(f.port, 10);
      if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
        throw new Error(`forward ${i + 1}: port must be 1–65535`);
      }
      if (f.kind === "dynamic") {
        return { kind: "dynamic", bindPort, ...(f.bind ? { bindAddress: f.bind } : {}) };
      }
      const targetPort = Number.parseInt(f.targetPort, 10);
      if (!f.host || !Number.isInteger(targetPort)) throw new Error(`forward ${i + 1}: target host + port required`);
      return { kind: f.kind, bindPort, targetHost: f.host, targetPort, ...(f.bind ? { bindAddress: f.bind } : {}) };
    });
    const portNum = sshPort.trim() === "" ? undefined : Number.parseInt(sshPort, 10);
    const input: TunnelProfileInput = {
      name: name.trim(),
      mode,
      sshTarget: sshTarget.trim(),
      forwards: rules,
      ...(jumpHops.trim() ? { jumpHops: jumpHops.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
      ...(sshUser.trim() ? { sshUser: sshUser.trim() } : {}),
      ...(portNum !== undefined ? { sshPort: portNum } : {}),
      ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    onSave(input);
    } catch (e) {
      formError = e instanceof Error ? e.message : "invalid input";
    }
  }

  let formError: string | null = $state(null);

  const modeHelp: Record<TunnelMode, string> = {
    local: "Expose a remote service locally: -L [bind:]port:host:hostport",
    remote: "Expose a local service remotely: -R [bind:]port:host:hostport",
    dynamic: "Local SOCKS5 proxy: -D [bind:]port",
    jump: "Reach the target via bastion hops: -J hop1,hop2",
    multi: "Several forwards in one ssh process",
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" tabindex="-1" onclick={onClose} onkeydown={(e) => e.key === "Escape" && onClose()}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit tunnel" : "New tunnel"}
      class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && onClose()}
      tabindex="-1"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold tracking-tight">{editing ? `Edit — ${editing.name}` : "New tunnel"}</h2>
        <button onclick={onClose} class="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={18} /></button>
      </div>

      <div class="grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-3 text-sm">
        <label for="f-name" class="text-slate-400">Name</label>
        <input id="f-name" bind:value={name} placeholder="ufo · jupyter" maxlength="120"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />

        <label for="f-mode" class="text-slate-400">Mode</label>
        <select id="f-mode" bind:value={mode}
          class="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 outline-none focus:border-cyan-400/50">
          {#each TUNNEL_MODES as m}
            <option value={m}>{m} — {modeHelp[m]}</option>
          {/each}
        </select>

        <label for="f-target" class="text-slate-400">Target</label>
        <input id="f-target" bind:value={sshTarget} list="host-list" placeholder="ufo / mac-mini / user@host" maxlength="512"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />
        <datalist id="host-list">
          {#each hosts as h}
            <option value={h.alias}>{h.hostName ?? ""}</option>
          {/each}
        </datalist>

        <label for="f-jump" class="text-slate-400">Jump hops</label>
        <input id="f-jump" bind:value={jumpHops} placeholder="bastion, inner:2222 (optional)"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />

        <label for="f-user" class="text-slate-400">User</label>
        <input id="f-user" bind:value={sshUser} placeholder="optional override"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />

        <label for="f-port" class="text-slate-400">SSH port</label>
        <input id="f-port" bind:value={sshPort} inputmode="numeric" placeholder="22"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />

        <label for="f-key" class="text-slate-400">Identity</label>
        <input id="f-key" bind:value={identityFile} placeholder="~/.ssh/id_ed25519 (optional)"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />

        <span class="self-start pt-2 text-slate-400">Forwards</span>
        <div>
          {#each forwards as f, i}
            <div class="mb-2 grid grid-cols-[92px_1fr_64px_1fr_64px_28px] gap-1.5">
              <select bind:value={f.kind} aria-label="forward kind"
                class="rounded-md border border-white/10 bg-slate-800 px-1 py-1.5 font-mono text-xs outline-none">
                <option value="local">-L</option>
                <option value="remote">-R</option>
                <option value="dynamic">-D</option>
              </select>
              <input bind:value={f.bind} placeholder="bind" aria-label="bind address"
                class="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-slate-600" />
              <input bind:value={f.port} placeholder="port" inputmode="numeric" aria-label="bind port"
                class="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-slate-600" />
              <input bind:value={f.host} placeholder="target" disabled={f.kind === "dynamic"} aria-label="target host"
                class="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-slate-600 disabled:opacity-30" />
              <input bind:value={f.targetPort} placeholder="tport" inputmode="numeric" disabled={f.kind === "dynamic"} aria-label="target port"
                class="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs outline-none placeholder:text-slate-600 disabled:opacity-30" />
              <button onclick={() => removeForward(i)} aria-label="remove forward"
                class="rounded-md p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-300"><X size={14} /></button>
            </div>
          {/each}
          <button onclick={addForward}
            class="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">
            <Plus size={14} /> forward
          </button>
        </div>

        <label for="f-notes" class="text-slate-400">Notes</label>
        <input id="f-notes" bind:value={notes} maxlength="2000" placeholder="optional"
          class="rounded-lg border border-white/10 bg-white/5 px-3 py-2 outline-none placeholder:text-slate-600 focus:border-cyan-400/50" />
      </div>

      {#if formError ?? error}
        <p class="mt-3 text-sm text-red-400">{formError ?? error}</p>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <button onclick={onClose} class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/10">Cancel</button>
        <button disabled={saving} onclick={save}
          class="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:opacity-40">
          {saving ? "Saving…" : editing ? "Save" : "Create"}
        </button>
      </div>
    </div>
  </div>
{/if}
