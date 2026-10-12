<!--
  TunnelEditor: create/edit dialog. Covers local/remote/dynamic/jump/multi:
  target + jump hops + identity + extra forwards list with per-row kinds.
-->
<script lang="ts">
  import { ArrowLeftToLine, ArrowRightToLine, Globe, Plus, X } from "@lucide/svelte";
  import { Button } from "@ssh-tunnel/web-ui";
  import { Input } from "@ssh-tunnel/web-ui";
  import type { SshHostInfo, TunnelProfile, TunnelProfileInput } from "$lib/store";
  import { TUNNEL_MODES, type ForwardRule, type TunnelMode } from "@ssh-tunnel/contract";

  type ForwardKind = "local" | "remote" | "dynamic";

  /** Termius-style forward type cards: human label + one-line direction sketch. */
  const FORWARD_KINDS: { kind: ForwardKind; label: string; hint: string; icon: "local" | "remote" | "dynamic" }[] = [
    { kind: "local", label: "Local", hint: "remote service → your machine", icon: "local" },
    { kind: "remote", label: "Remote", hint: "your service → remote side", icon: "remote" },
    { kind: "dynamic", label: "Dynamic", hint: "SOCKS5 proxy on your machine", icon: "dynamic" },
  ];

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
  let forwards: { kind: ForwardKind; bind: string; port: string; host: string; targetPort: string }[] = $state([]);

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
    local: "Bring a remote service to your machine",
    remote: "Expose your machine to the remote side",
    dynamic: "Browse through a SOCKS5 proxy",
    jump: "Hop through bastion host(s) first",
    multi: "Mix several forwards in one tunnel",
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation" tabindex="-1" onclick={onClose} onkeydown={(e) => e.key === "Escape" && onClose()}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit tunnel" : "New tunnel"}
      class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[10px] border border-border bg-popover p-6 shadow-[0_8px_30px_rgb(0_0_0/0.18)]"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === "Escape" && onClose()}
      tabindex="-1"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold tracking-tight">{editing ? `Edit — ${editing.name}` : "New tunnel"}</h2>
        <Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="Close"><X size={18} /></Button>
      </div>

      <div class="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-sm">
        <label for="f-name" class="text-muted-foreground">Name</label>
        <Input id="f-name" bind:value={name} placeholder="ufo · jupyter" maxlength={120} />

        <label for="f-mode" class="text-muted-foreground">Mode</label>
        <div>
          <select id="f-mode" bind:value={mode}
            class="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring">
            {#each TUNNEL_MODES as m}
              <option value={m}>{m} — {modeHelp[m]}</option>
            {/each}
          </select>
          <p class="mt-1 font-mono text-[11px] text-muted-foreground">
            {#if mode === "local"}
              ◉ localhost:port <span class="text-primary">⟵</span> remote-host:port <span class="opacity-70">· e.g. read remote DB as localhost:5432</span>
            {:else if mode === "remote"}
              remote-host:port <span class="text-primary">⟶</span> ◉ localhost:port <span class="opacity-70">· e.g. demo your laptop app from the server</span>
            {:else if mode === "dynamic"}
              ◉ localhost:port <span class="text-primary">⟷</span> anywhere <span class="opacity-70">· e.g. browse as if on the remote network</span>
            {:else if mode === "jump"}
              you <span class="text-primary">⟶</span> bastion <span class="text-primary">⟶</span> target <span class="opacity-70">· fill Jump hops below</span>
            {:else}
              one SSH connection, several forwards <span class="opacity-70">· add rows below</span>
            {/if}
          </p>
        </div>

        <label for="f-target" class="text-muted-foreground">Target</label>
        <Input id="f-target" bind:value={sshTarget} list="host-list" placeholder="ufo / mac-mini / user@host" maxlength={512} />
        <datalist id="host-list">
          {#each hosts as h}
            <option value={h.alias}>{h.hostName ?? ""}</option>
          {/each}
        </datalist>

        <label for="f-jump" class="text-muted-foreground">Jump hops</label>
        <Input id="f-jump" bind:value={jumpHops} placeholder="bastion, inner:2222 (optional)" />

        <label for="f-user" class="text-muted-foreground">User</label>
        <Input id="f-user" bind:value={sshUser} placeholder="optional override" />

        <label for="f-port" class="text-muted-foreground">SSH port</label>
        <Input id="f-port" bind:value={sshPort} inputmode="numeric" placeholder="22" />

        <label for="f-key" class="text-muted-foreground">Identity</label>
        <Input id="f-key" bind:value={identityFile} placeholder="~/.ssh/id_ed25519 (optional)" />

        <span class="self-start pt-2 text-muted-foreground">Forwards</span>
        <div class="min-w-0">
          {#each forwards as f, i}
            <div class="mb-3 rounded-lg border border-border bg-muted/40 p-2.5">
              <!-- Type picker: three Termius-style cards instead of a -L/-R/-D flag -->
              <div class="mb-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`forward ${i + 1} type`}>
                {#each FORWARD_KINDS as k}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={f.kind === k.kind}
                    onclick={() => (f.kind = k.kind)}
                    class="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition {f.kind === k.kind
                      ? 'border-ring bg-primary/10'
                      : 'border-border bg-transparent hover:border-muted-foreground/40'}"
                  >
                    {#if k.icon === "local"}
                      <ArrowLeftToLine size={15} class={f.kind === k.kind ? "text-primary" : "text-muted-foreground"} />
                    {:else if k.icon === "remote"}
                      <ArrowRightToLine size={15} class={f.kind === k.kind ? "text-primary" : "text-muted-foreground"} />
                    {:else}
                      <Globe size={15} class={f.kind === k.kind ? "text-primary" : "text-muted-foreground"} />
                    {/if}
                    <span>
                      <span class="block text-xs font-medium {f.kind === k.kind ? 'text-primary' : 'text-foreground'}">{k.label}</span>
                      <span class="block text-[10px] leading-tight text-muted-foreground">{k.hint}</span>
                    </span>
                  </button>
                {/each}
              </div>
              <!-- Direction sketch: which side listens, which side serves -->
              <p class="mb-2 font-mono text-[11px] text-muted-foreground">
                {#if f.kind === "local"}
                  ◉ this machine:{f.port || "port"} <span class="text-primary">⟵</span> {f.host || "remote host"}:{f.targetPort || "port"} via SSH
                {:else if f.kind === "remote"}
                  SSH <span class="text-primary">⟶</span> server:{f.port || "port"} ◉ serves {f.host || "local host"}:{f.targetPort || "port"}
                {:else}
                  ◉ SOCKS5 on this machine:{f.port || "port"} <span class="text-primary">⟷</span> anywhere via SSH
                {/if}
              </p>
              <div class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_72px_28px] gap-1.5">
                <Input bind:value={f.bind} placeholder="bind (empty = localhost)" aria-label="bind address" class="px-2 py-1.5 text-xs" />
                <Input bind:value={f.port} placeholder="port" inputmode="numeric" aria-label="bind port" class="px-2 py-1.5 text-xs" />
                <Input bind:value={f.host} placeholder={f.kind === "dynamic" ? "n/a" : "target host"} disabled={f.kind === "dynamic"} aria-label="target host" class="px-2 py-1.5 text-xs" />
                <Input bind:value={f.targetPort} placeholder={f.kind === "dynamic" ? "n/a" : "t-port"} inputmode="numeric" disabled={f.kind === "dynamic"} aria-label="target port" class="px-2 py-1.5 text-xs" />
                <Button variant="ghost" size="icon-xs" onclick={() => removeForward(i)} aria-label="remove forward" class="text-muted-foreground hover:bg-destructive/20 hover:text-destructive"><X size={14} /></Button>
              </div>
            </div>
          {/each}
          <Button variant="secondary" size="xs" onclick={addForward}>
            <Plus size={14} /> forward
          </Button>
        </div>

        <label for="f-notes" class="text-muted-foreground">Notes</label>
        <Input id="f-notes" bind:value={notes} maxlength={2000} placeholder="optional" />
      </div>

      {#if formError ?? error}
        <p class="mt-3 text-sm text-destructive">{formError ?? error}</p>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onclick={onClose}>Cancel</Button>
        <Button disabled={saving} onclick={save}>
          {saving ? "Saving…" : editing ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  </div>
{/if}
