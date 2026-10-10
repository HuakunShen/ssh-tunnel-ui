/**
 * `pnpm check:boundaries` — enforce the portable-core claim.
 *
 * Fails when a portable package (contract/core/client) imports a host module
 * (`node:*`), touches a host global, or reaches outside its own `src` via a
 * relative import. Exits non-zero with `file:line:column` so editors can jump
 * to the violation. No dependencies: runs on Node 20+ with --strip-types.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const PORTABLE = ["packages/ssh-contract", "packages/ssh-core", "packages/ssh-client"];

const VIOLATION_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /from\s+["']node:/, message: "portable package imports node:*" },
  { pattern: /require\(\s*["']node:/, message: "portable package requires node:*" },
  { pattern: /\bprocess\.(env|exit|kill|pid)\b/, message: "portable package touches process" },
  { pattern: /\bdocument\b\s*\./, message: "portable package touches DOM at runtime" },
  { pattern: /\bwindow\b\s*\./, message: "portable package touches DOM at runtime" },
  { pattern: /\blocalStorage\b/, message: "portable package touches DOM at runtime" },
  { pattern: /@ssh-tunnel\/host-node/, message: "portable package imports host layer" },
  { pattern: /@ssh-tunnel\/service/, message: "portable package imports service layer" },
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
}

let failures = 0;
for (const pkg of PORTABLE) {
  const src = join(ROOT, pkg, "src");
  let files: string[] = [];
  try {
    walk(src, files);
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      for (const { pattern, message } of VIOLATION_PATTERNS) {
        if (pattern.test(line)) {
          failures += 1;
          console.error(
            `${relative(ROOT, file)}:${index + 1}:${line.indexOf(pattern.exec(line)?.[0] ?? "") + 1}: ${message}`,
          );
        }
      }
      const relImport = /from\s+["'](\.\.[^"']*)["']/.exec(line);
      if (relImport !== null) {
        failures += 1;
        console.error(
          `${relative(ROOT, file)}:${index + 1}:1: portable package escapes src via relative import ${relImport[1] ?? ""}`,
        );
      }
    });
  }
}

if (failures > 0) {
  console.error(`\ncheck:boundaries failed with ${failures} violation(s)`);
  process.exit(1);
}
console.log("check:boundaries ok");
