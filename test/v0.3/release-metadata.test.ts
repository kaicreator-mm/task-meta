// T07 deterministic release metadata guard: source-only, no network or Agent side effects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VERSION = "0.3.0";
function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;
}
const vendorMetadata = [
  [
    "zcode",
    "plugins/zcode/marketplace.json",
    "plugins/zcode/task-meta-capture/.zcode-plugin/plugin.json",
    "plugins/zcode/task-meta-capture/scripts/capture.mjs",
  ],
  [
    "claude",
    "plugins/claude/.claude-plugin/marketplace.json",
    "plugins/claude/task-meta-capture/.claude-plugin/plugin.json",
    "plugins/claude/task-meta-capture/scripts/capture.mjs",
  ],
  [
    "codex",
    "plugins/codex/.agents/plugins/marketplace.json",
    "plugins/codex/task-meta-capture/.codex-plugin/plugin.json",
    "plugins/codex/task-meta-capture/scripts/capture.cjs",
  ],
] as const;

test("v0.3 closure package manifest and lockfile agree on exactly 0.3.0", () => {
  const pkg = json("package.json");
  const lock = json("package-lock.json");
  const packages = lock.packages as Record<string, Record<string, unknown>>;
  assert.equal(pkg.version, VERSION);
  assert.equal(lock.version, VERSION);
  assert.equal(packages[""]?.version, VERSION);
  assert.equal(pkg.name, lock.name);
  assert.equal(pkg.name, packages[""]?.name);
  assert.equal(
    pkg.private,
    true,
    "must not accidentally publish raw private evidence package to npm",
  );
  assert.equal((pkg.engines as Record<string, unknown>).node, ">=24");
});

for (const [name, marketplacePath, pluginPath, runtimePath] of vendorMetadata) {
  test(`v0.3 ${name} plugin and marketplace ship matching 0.3.0 without rename`, () => {
    const market = json(marketplacePath);
    const plug = json(pluginPath);
    const entries = market.plugins as Record<string, unknown>[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, "task-meta-capture");
    assert.equal(entries[0]?.version, VERSION);
    assert.equal(plug.name, "task-meta-capture");
    assert.equal(plug.version, VERSION);
    const runtime = readFileSync(new URL(`../../${runtimePath}`, import.meta.url), "utf8");
    const declared = /(?:export )?const PLUGIN_VERSION = "([^"]+)"/.exec(runtime)?.[1] ?? null;
    assert.equal(declared, VERSION, "live runtime spool must report installed plugin version");
  });
}

test("release metadata tests cannot substitute for actual package/install verification", () => {
  // Release qualification remains an independent GitHub Issue/Reviewer decision.
  // Source-only tests are deliberately not allowed to assert RQ READY or live Host PASS.
  assert.equal(vendorMetadata.length, 3);
});
