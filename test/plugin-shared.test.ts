import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const SHARED = join(ROOT, "plugins", "shared");
const LIB = join(ROOT, "plugins", "zcode", "task-meta-capture", "scripts", "lib");

test("plugin lib copies are byte-identical to plugins/shared (run `npm run sync-plugins`)", () => {
  const shared = readdirSync(SHARED).filter((f) => f.endsWith(".mjs"));
  assert.ok(shared.includes("binding-extract.mjs"));
  assert.ok(shared.includes("git-meta.mjs"));
  for (const f of shared) {
    assert.ok(
      readFileSync(join(SHARED, f)).equals(readFileSync(join(LIB, f))),
      `${f} drifted from plugins/shared`,
    );
  }
  assert.ok(
    readFileSync(join(ROOT, "config", "repo-aliases.json")).equals(
      readFileSync(join(LIB, "repo-aliases.json")),
    ),
    "repo-aliases.json drifted from config/",
  );
});

test("sync script --check reports no drift", () => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "sync-plugin-shared.mjs"), "--check"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr);
});

test("shared helpers are dependency-free (node: built-ins and relative imports only)", () => {
  for (const f of readdirSync(SHARED).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(SHARED, f), "utf8");
    for (const m of src.matchAll(/^import .* from "([^"]+)";?$/gm)) {
      assert.match(m[1] as string, /^(node:|\.\/)/, `${f} imports ${m[1]}`);
    }
  }
});
