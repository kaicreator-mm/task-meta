// Copies plugins/shared/*.mjs (+ config/repo-aliases.json) into each plugin's scripts/lib/.
// CommonJS plugins (those with scripts/capture.cjs) get a mechanically generated `.cjs` build of each
// shared module instead (imports -> require, `export` -> module.exports), so no dynamic import()
// or require(esm) is needed at hook time.
// `--check` only reports drift (exit 1) without writing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "plugins", "shared");
const sources = readdirSync(shared)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => ({ from: join(shared, f), name: f }));
const aliases = { from: join(root, "config", "repo-aliases.json"), name: "repo-aliases.json" };

/** ESM -> CJS for the shared helpers' restricted syntax (named imports of node: built-ins only). */
export function toCjs(src, file) {
  const names = [];
  let out = src.replace(/^import \{([^}]*)\} from "([^"]+)";?$/gm, (_m, list, mod) => {
    if (!mod.startsWith("node:")) throw new Error(`${file}: only node: imports can be converted`);
    return `const {${list}} = require("${mod}");`;
  });
  out = out.replace(/^export (async )?function (\w+)/gm, (_m, a, n) => {
    names.push(n);
    return `${a ?? ""}function ${n}`;
  });
  out = out.replace(/^export const (\w+)/gm, (_m, n) => {
    names.push(n);
    return `const ${n}`;
  });
  if (/^(import|export) /m.test(out) || out.includes("import.meta")) {
    throw new Error(`${file}: unsupported ESM syntax for CJS conversion`);
  }
  return `// GENERATED from plugins/shared/${file} by scripts/sync-plugin-shared.mjs; do not edit.\n"use strict";\n${out}\nmodule.exports = { ${names.join(", ")} };\n`;
}

const check = process.argv.includes("--check");
const pluginsDir = join(root, "plugins");
let drift = 0;

function put(to, bytes) {
  const same = existsSync(to) && readFileSync(to).equals(bytes);
  if (same) return;
  drift += 1;
  if (check) console.error(`drift: ${to}`);
  else {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    console.log(`synced: ${to}`);
  }
}

for (const host of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!host.isDirectory() || host.name === "shared") continue;
  for (const p of readdirSync(join(pluginsDir, host.name), { withFileTypes: true })) {
    const scripts = join(pluginsDir, host.name, p.name, "scripts");
    if (!p.isDirectory() || !existsSync(scripts)) continue;
    const lib = join(scripts, "lib");
    const cjs = existsSync(join(scripts, "capture.cjs"));
    for (const s of sources) {
      const bytes = readFileSync(s.from);
      if (cjs) put(join(lib, s.name.replace(/\.mjs$/, ".cjs")), Buffer.from(toCjs(bytes.toString("utf8"), s.name)));
      else put(join(lib, s.name), bytes);
    }
    put(join(lib, aliases.name), readFileSync(aliases.from));
  }
}
if (check && drift > 0) process.exit(1);
