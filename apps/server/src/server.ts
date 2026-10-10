/**
 * `ssh-tunnel-serve` — the tunnel daemon binary. Composition only: parses
 * argv, starts the service, prints the URL. No domain logic lives here.
 */
import { startDaemon } from "@ssh-tunnel/service";

function argValue(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(`ssh-tunnel-serve — SSH tunnel manager daemon
usage: ssh-tunnel-serve [--port=7432] [--host=127.0.0.1] [--store=PATH] [--log-dir=DIR] [--web-dir=DIR] [--ssh-path=ssh]
serves the HTTP API at /api/* and the Web UI at / (when --web-dir is set).`);
    return;
  }
  const portText = argValue("port", "7432") ?? "7432";
  const port = Number.parseInt(portText, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`invalid --port=${portText}`);
    process.exitCode = 1;
    return;
  }
  const options: {
    port: number;
    host: string;
    storePath?: string;
    logDir?: string;
    webDir?: string;
    sshPath?: string;
  } = {
    port,
    host: argValue("host", "127.0.0.1") ?? "127.0.0.1",
  };
  const storePath = argValue("store");
  const logDir = argValue("log-dir");
  const webDir = argValue("web-dir");
  const sshPath = argValue("ssh-path");
  const { port: bound, instanceId } = await startDaemon({
    ...options,
    ...(storePath === undefined ? {} : { storePath }),
    ...(logDir === undefined ? {} : { logDir }),
    ...(webDir === undefined ? {} : { webDir }),
    ...(sshPath === undefined ? {} : { sshPath }),
  });
  console.log(`ssh-tunnel daemon on http://${options.host}:${bound} (${instanceId})`);
}

await main();
