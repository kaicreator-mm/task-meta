// Copies plugins/shared/*.mjs (+ config/repo-aliases.json) into each plugin's scripts/lib/.
// `--check` only reports drift (exit 1) without writing.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "plugins", "shared");
const sources = readdirSync(shared)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => ({ from: join(shared, f), name: f }));
sources.push({ from: join(root, "config", "repo-aliases.json"), name: "repo-aliases.json" });

const check = process.argv.includes("--check");
const pluginsDir = join(root, "plugins");
let drift = 0;
for (const host of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!host.isDirectory() || host.name === "shared") continue;
  for (const p of readdirSync(join(pluginsDir, host.name), { withFileTypes: true })) {
    const scripts = join(pluginsDir, host.name, p.name, "scripts");
    if (!p.isDirectory() || !existsSync(scripts)) continue;
    const lib = join(scripts, "lib");
    for (const s of sources) {
      const to = join(lib, s.name);
      const same = existsSync(to) && readFileSync(to).equals(readFileSync(s.from));
      if (same) continue;
      drift += 1;
      if (check) console.error(`drift: ${to}`);
      else {
        mkdirSync(lib, { recursive: true });
        copyFileSync(s.from, to);
        console.log(`synced: ${to}`);
      }
    }
  }
}
if (check && drift > 0) process.exit(1);
