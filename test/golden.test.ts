import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { agreement, buildReport, confusion } from "../scripts/golden-agreement.ts";
import { AGENTS, buildSample, type GoldenAgent, type GoldenRow } from "../scripts/golden-sample.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const ALLOWED = ["id", "agent", "tool_name", "input_class", "outcome", "prev_tool", "next_tool"];

function makeSpools(): Record<GoldenAgent, string> {
  const root = mkdtempSync(join(tmpdir(), "golden-"));
  const dirs = {} as Record<GoldenAgent, string>;
  for (const agent of AGENTS) {
    const dir = join(root, `${agent}-spool`);
    mkdirSync(dir);
    dirs[agent] = dir;
    const lines: string[] = [];
    const session = `${agent}-session-SECRET-1`;
    const tools: [string, string | null][] = [
      ["Bash", "TEST"],
      ["Bash", "VCS"],
      ["Bash", "OTHER"],
      ["Edit", null],
      ["Read", null],
    ];
    let n = 0;
    for (let rep = 0; rep < 12; rep++) {
      for (const [tool, ic] of tools) {
        const id = `call-${n++}`;
        const base = { session_id: session, tool_call_id: id, tool_name: tool, input_class: ic };
        lines.push(JSON.stringify({ d: "x", e: { ...base, event: "PreToolUse", outcome: null } }));
        lines.push(
          JSON.stringify({ d: "x", e: { ...base, event: "PostToolUse", outcome: "success" } }),
        );
      }
    }
    lines.push(JSON.stringify({ d: "x", e: { event: "SessionStart", session_id: session } }));
    writeFileSync(join(dir, "s.jsonl"), `${lines.join("\n")}\n`);
  }
  return dirs;
}

test("sampler is deterministic and respects the stratum cap", () => {
  const dirs = makeSpools();
  const a = buildSample(dirs, { cap: 4 });
  const b = buildSample(dirs, { cap: 4 });
  assert.deepEqual(a, b);
  assert.equal(a.length, AGENTS.length * 5 * 4);
  assert.notDeepEqual(a, buildSample(dirs, { cap: 4, seed: "other-seed" }));
});

test("sampler output carries only allowed fields, no session ids, paths or timestamps", () => {
  const rows = buildSample(makeSpools(), { cap: 3 });
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), [...ALLOWED].sort());
    assert.match(r.id, /^[0-9a-f]{12}$/);
  }
  assert.deepEqual(findForbiddenContent(rows), []);
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /SECRET|session|\d{4}-\d{2}-\d{2}T/);
});

test("stratification covers every agent present and rare classes appear", () => {
  const rows = buildSample(makeSpools(), { cap: 2 });
  for (const agent of AGENTS) {
    const mine = rows.filter((r) => r.agent === agent);
    assert.ok(mine.length > 0, agent);
    const keys = new Set(mine.map((r) => `${r.tool_name}:${r.input_class}`));
    assert.equal(keys.size, 5);
  }
});

test("committed golden sample is clean and covers all three agents", () => {
  const dir = join(import.meta.dirname, "..", "docs", "v0.2", "golden");
  const rows = JSON.parse(readFileSync(join(dir, "sample.json"), "utf8")) as GoldenRow[];
  assert.ok(rows.length >= 150);
  assert.deepEqual(findForbiddenContent(rows), []);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const agent of AGENTS)
    assert.ok(
      rows.some((r) => r.agent === agent),
      agent,
    );
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), [...ALLOWED].sort());
  const b = JSON.parse(readFileSync(join(dir, "labeler-b.json"), "utf8")) as {
    labels: { id: string }[];
  };
  assert.deepEqual(b.labels.map((l) => l.id).sort(), rows.map((r) => r.id).sort());
});

test("Cohen's kappa matches a hand-checked value", () => {
  // A = x x y y, B = x y y y: po = 0.75, pe = 0.5*0.25 + 0.5*0.75 = 0.5, kappa = 0.5
  const a = ["x", "x", "y", "y"];
  const b = ["x", "y", "y", "y"];
  const g = agreement(a, b);
  assert.equal(g.observed, 0.75);
  assert.ok(Math.abs((g.kappa ?? Number.NaN) - 0.5) < 1e-12);
  assert.equal(agreement(a, a).kappa, 1);
  assert.equal(agreement(["x", "x"], ["x", "x"]).kappa, null);
});

test("confusion matrix and disagreement list on a tiny fixture", () => {
  const rows: GoldenRow[] = [
    {
      id: "000000000001",
      agent: "zcode",
      tool_name: "Edit",
      input_class: null,
      outcome: "success",
      prev_tool: null,
      next_tool: null,
    },
    {
      id: "000000000002",
      agent: "zcode",
      tool_name: "UnmappedTool",
      input_class: null,
      outcome: "success",
      prev_tool: null,
      next_tool: null,
    },
    {
      id: "000000000003",
      agent: "claude",
      tool_name: "Bash",
      input_class: "TEST",
      outcome: "success",
      prev_tool: null,
      next_tool: null,
    },
  ];
  const b = new Map([
    ["000000000001", "IMPLEMENTATION"],
    ["000000000002", "OTHER"],
    ["000000000003", "DIAGNOSIS"],
  ]);
  const rep = buildReport(rows, b);
  assert.equal(rep.summary.disagreements, 2);
  assert.ok(Math.abs(rep.summary.observed - 1 / 3) < 1e-12);
  const m = confusion(
    ["IMPLEMENTATION", "UNKNOWN", "TEST"],
    ["IMPLEMENTATION", "OTHER", "DIAGNOSIS"],
  );
  assert.equal(m[0]?.[0], 1);
  assert.equal(m[7]?.[6], 1);
  assert.equal(m[1]?.[2], 1);
  assert.match(rep.disagreementsMd, /000000000002 \| zcode \| UnmappedTool/);
  assert.match(rep.disagreementsMd, /\| owner: \|/);
});
