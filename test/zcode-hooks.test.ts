import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ZCODE_CAPABILITY } from "../src/adapters/zcode/capability.ts";
import { type HookEntry, parseHookSpool } from "../src/adapters/zcode/hooks.ts";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import { main } from "../src/cli.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const fxDir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => readFileSync(join(fxDir, n), "utf8");
const SID = "sess-synth-0001";

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
const T = (s: string) => `2026-10-22T13:${s}Z`; // "10:05.000" -> 13:10:05.000

function ent(over: Partial<HookEntry> & Pick<HookEntry, "event">): HookEntry {
  return {
    schema: "task-meta/zcode-hook/v1",
    plugin_version: "0.1.1",
    session_id: SID,
    turn_id: "turn-1",
    trace_id: "trace-1",
    agent_name: "main",
    tool_call_id: null,
    tool_name: null,
    hook_ts: null,
    received_at: "2026-10-22T13:00:00.000Z",
    mode: "default",
    input_class: null,
    outcome: null,
    error_type: null,
    result_bytes: null,
    tool_call_count: null,
    session_source: null,
    model: null,
    prompt_bytes: null,
    cwd_digest: null,
    ...over,
  };
}
const pre = (id: string, ts: string, name = "Bash", cls: string | null = null) =>
  ent({
    event: "PreToolUse",
    tool_call_id: id,
    tool_name: name,
    hook_ts: T(ts),
    input_class: cls,
  });
const post = (id: string, ts: string, name = "Bash") =>
  ent({
    event: "PostToolUse",
    tool_call_id: id,
    tool_name: name,
    hook_ts: T(ts),
    outcome: "success",
    result_bytes: 10,
  });
const fail = (id: string, ts: string, interrupt = false, name = "Edit") =>
  ent({
    event: "PostToolUseFailure",
    tool_call_id: id,
    tool_name: name,
    hook_ts: T(ts),
    outcome: interrupt ? "interrupt" : "failure",
    error_type: "ToolExecutionError",
  });
const spoolOf = (...es: HookEntry[]) => es.map(line).join("");

function base(over: Partial<ZcodeRunInput> = {}): ZcodeRunInput {
  return {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecord: fx("run.txt"),
    gateLog: fx("gate-pass.log"),
    ...over,
  };
}
/** Headless-only input (no rollout) so hook-only behaviour is isolated. */
function hookOnly(hookSpool: string): ZcodeRunInput {
  const { modelIo: _m, runRecord: _r, gateLog: _g, ...rest } = base();
  return { ...rest, hookSpool };
}
const metric = (r: ReturnType<typeof collectZcodeRun>, n: string) => {
  const m = r.summary.metrics.find((x) => x.name === n);
  assert.ok(m, `metric ${n}`);
  return m;
};
const tools = (r: ReturnType<typeof collectZcodeRun>) =>
  r.observations.filter((o) => o.kind === "TOOL_CALL");
const tool = (r: ReturnType<typeof collectZcodeRun>, id: string) => {
  const o = tools(r).find((x) => x.observation_id === `zcode:tool:${id}`);
  assert.ok(o, `tool ${id}`);
  return o;
};

test("parseHookSpool verifies digests, skips bad/truncated lines, drops duplicates", () => {
  const good = line(pre("t1", "10:00.000"));
  const tampered = good.replace("t1", "t2");
  const text = `${good}${good}${tampered}garbage\n${line({ schema: "other", event: "Stop" })}${line(post("t1", "10:01.000")).slice(0, 40)}`;
  const r = parseHookSpool(text);
  assert.equal(r.entries.length, 1);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(
    r.skipped.map((s) => s.reason),
    ["digest mismatch", "invalid JSON", "unsupported entry", "truncated trailing line"],
  );
});

test("Pre+Post gives started/completed/duration/status, hook metrics and capability", () => {
  const r = collectZcodeRun(
    hookOnly(spoolOf(pre("t1", "10:00.000", "Bash", "TEST"), post("t1", "10:02.500"))),
  );
  const o = tool(r, "t1");
  assert.equal(o.started_at, "2026-10-22T13:10:00.000Z");
  assert.equal(o.completed_at, "2026-10-22T13:10:02.500Z");
  assert.equal(o.duration_ms, 2500);
  assert.equal(o.status, "success");
  assert.equal(o.tool?.input_class, "TEST");
  assert.equal(o.fields_epistemic.status, "OBSERVED");
  assert.equal(metric(r, "tool_wall_ms").value, 2500);
  assert.equal(metric(r, "tool_wall_ms").coverage, "COMPLETE");
  assert.equal(metric(r, "tool_failures").value, 0);
  assert.equal(metric(r, "hook_events").value, 2);
  const id = metric(r, "tool_wall_ms").identity;
  assert.equal(id?.observation_id, `zcode:hook-spool:${SID}`);
  assert.equal(id?.adapter_id, "zcode");
  assert.equal(r.profile.signals.tool_timing?.supported, true);
  assert.equal(r.profile.signals.tool_timing?.epistemic, "OBSERVED");
  assert.equal(r.profile.signals.tool_outcome?.supported, true);
  assert.equal(r.profile.signals.capture_plugin?.notes, "task-meta-capture@0.1.1");
  assert.deepEqual(findForbiddenContent(r.observations), []);
});

test("failure and interrupt statuses; tool_failures counts failures only", () => {
  const r = collectZcodeRun(
    hookOnly(
      spoolOf(
        pre("a", "10:00.000"),
        fail("a", "10:01.000"),
        pre("b", "10:02.000"),
        fail("b", "10:03.000", true),
        pre("c", "10:04.000"),
        post("c", "10:05.000"),
      ),
    ),
  );
  assert.equal(tool(r, "a").status, "failure");
  assert.equal(tool(r, "b").status, "interrupt");
  assert.equal(tool(r, "c").status, "success");
  assert.equal(metric(r, "tool_failures").value, 1);
});

test("Post without Pre: status known, no start or duration, coverage PARTIAL", () => {
  const r = collectZcodeRun(
    hookOnly(spoolOf(post("x", "10:05.000"), pre("y", "10:00.000"), post("y", "10:01.000"))),
  );
  const o = tool(r, "x");
  assert.equal(o.status, "success");
  assert.equal(o.started_at, null);
  assert.equal(o.duration_ms, null);
  assert.equal(o.completed_at, "2026-10-22T13:10:05.000Z");
  assert.equal(metric(r, "tool_wall_ms").value, 1000);
  assert.equal(metric(r, "tool_wall_ms").coverage, "PARTIAL");
  assert.ok(
    r.limits.some((l) => /1 tool call\(s\) without a complete hook start\/end pair/.test(l)),
  );
});

test("Pre without Post: status UNKNOWN without provenance", () => {
  const r = collectZcodeRun(hookOnly(spoolOf(pre("z", "10:00.000"))));
  const o = tool(r, "z");
  assert.equal(o.status, "UNKNOWN");
  assert.equal(o.completed_at, null);
  assert.equal("status" in o.fields_epistemic, false);
  assert.equal(metric(r, "tool_wall_ms").value, null);
  assert.equal(metric(r, "tool_failures").value, 0);
});

test("duplicate line delivery is deduped and reported", () => {
  const p = line(pre("t1", "10:00.000"));
  const q = line(post("t1", "10:01.000"));
  const r = collectZcodeRun(hookOnly(p + p + q + q));
  assert.equal(tools(r).length, 1);
  assert.equal(metric(r, "hook_events").value, 2);
  assert.ok(r.limits.some((l) => /2 duplicate hook spool line\(s\) dropped/.test(l)));
});

test("hooks merge into the rollout TOOL_CALL (single record, rollout identity kept)", () => {
  const spool = spoolOf(
    pre("tool-1", "10:11.000", "Read"),
    post("tool-1", "10:12.000", "Read"),
    pre("tool-2", "10:12.000", "Bash", "VCS"),
    post("tool-2", "10:20.000"),
    pre("tool-3", "10:31.000", "Edit"),
    fail("tool-3", "10:32.000"),
  );
  const withHooks = collectZcodeRun(base({ hookSpool: spool }));
  const without = collectZcodeRun(base());
  const merged = tool(withHooks, "tool-2");
  const plain = tool(without, "tool-2");
  assert.equal(tools(withHooks).length, 3);
  assert.equal(merged.observation_id, plain.observation_id);
  assert.equal(merged.parent_ref, plain.parent_ref);
  assert.equal(merged.step_ref, plain.step_ref);
  assert.equal(merged.tool?.name, "Bash");
  // The fixture rollout has no input_class for tool-2, so the hook class fills in.
  assert.equal(plain.tool?.input_class, undefined);
  assert.equal(merged.tool?.input_class, "VCS");
  assert.equal(merged.duration_ms, 8000);
  assert.equal(merged.status, "success");
  assert.equal(tool(withHooks, "tool-3").status, "failure");
  assert.equal(metric(withHooks, "tool_failures").value, 1);
  assert.equal(metric(withHooks, "tool_wall_ms").value, 1000 + 8000 + 1000);
  assert.equal(metric(withHooks, "tool_wall_ms").coverage, "COMPLETE");
  assert.equal(metric(withHooks, "tool_calls").value, 3);
  assert.ok(!withHooks.limits.some((l) => /hook tool calls=/.test(l)));
  // Unchanged without a spool.
  assert.equal(plain.started_at, null);
  assert.equal(without.profile, ZCODE_CAPABILITY);
  assert.ok(!without.summary.metrics.some((m) => m.name === "tool_wall_ms"));
});

test("hook-provided class fills in when the rollout has none", () => {
  const r = collectZcodeRun(
    base({
      hookSpool: spoolOf(
        pre("tool-1", "10:11.000", "Read", "READ_SEARCH"),
        post("tool-1", "10:12.000", "Read"),
      ),
    }),
  );
  assert.equal(tool(r, "tool-1").tool?.input_class, "READ_SEARCH");
});

test("hook vs rollout tool count mismatch is a limit with both numbers and PARTIAL coverage", () => {
  const spool = spoolOf(
    pre("tool-1", "10:11.000", "Read"),
    post("tool-1", "10:12.000", "Read"),
    pre("tool-9", "10:13.000"),
    post("tool-9", "10:14.000"),
  );
  const r = collectZcodeRun(base({ hookSpool: spool }));
  assert.ok(
    r.limits.some((l) => l.includes("hook tool calls=2") && l.includes("rollout tool calls=3")),
  );
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.equal(metric(r, "tool_wall_ms").coverage, "PARTIAL");
  assert.equal(metric(r, "tool_calls").coverage, "PARTIAL");
  assert.equal(tools(r).length, 4);
});

test("tool_wall_ms is the union of overlapping tool intervals", () => {
  const r = collectZcodeRun(
    hookOnly(
      spoolOf(
        pre("a", "10:00.000"),
        pre("b", "10:01.000"),
        post("a", "10:03.000"),
        post("b", "10:05.000"),
        pre("c", "10:10.000"),
        post("c", "10:11.000"),
      ),
    ),
  );
  assert.equal(metric(r, "tool_wall_ms").value, 5000 + 1000);
});

test("SessionStart/Stop become RUN_BOUNDARY segments; resume starts a new segment", () => {
  const r = collectZcodeRun(
    hookOnly(
      spoolOf(
        ent({ event: "SessionStart", hook_ts: T("09:58.000"), session_source: "startup" }),
        ent({ event: "Stop", hook_ts: T("11:00.000"), tool_call_count: 1 }),
        ent({ event: "SessionStart", hook_ts: T("20:00.000"), session_source: "resume" }),
        ent({ event: "Stop", hook_ts: T("21:00.000"), tool_call_count: 0 }),
        ent({ event: "Stop", hook_ts: T("22:00.000"), tool_call_count: 0 }),
      ),
    ),
  );
  const b = r.observations.filter((o) => o.kind === "RUN_BOUNDARY");
  assert.deepEqual(
    b.map((o) => [o.observation_id, o.status, o.started_at, o.completed_at, o.duration_ms]),
    [
      [
        `zcode:hook-segment:${SID}:1`,
        "SESSION_STARTUP",
        "2026-10-22T13:09:58.000Z",
        "2026-10-22T13:11:00.000Z",
        62000,
      ],
      [
        `zcode:hook-segment:${SID}:2`,
        "SESSION_RESUME",
        "2026-10-22T13:20:00.000Z",
        "2026-10-22T13:22:00.000Z",
        120000,
      ],
    ],
  );
});

test("other sessions' hook entries are ignored; empty spool is a limit, not an error", () => {
  const foreign = { ...pre("q", "10:00.000"), session_id: "other" };
  const r = collectZcodeRun(hookOnly(spoolOf(foreign)));
  assert.ok(r.limits.some((l) => /from other sessions ignored/.test(l)));
  assert.ok(r.limits.some((l) => /no usable entries/.test(l)));
  assert.equal(r.profile, ZCODE_CAPABILITY);
  assert.ok(!r.summary.metrics.some((m) => m.name === "hook_events"));
});

// ---- CLI ----
const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});

async function cli(extra: string[], dir: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(
    [
      "collect",
      "--repo",
      "kaicreator-mm/task-meta",
      "--issue",
      "7",
      "--headless",
      join(fxDir, "headless.json.txt"),
      "--model-io",
      join(fxDir, "model-io.jsonl"),
      "--run",
      join(fxDir, "run.txt"),
      "--store",
      join(dir, "store"),
      "--out",
      join(dir, "out", "report.md"),
      ...extra,
    ],
    {
      now: () => new Date("2026-10-23T00:00:00.000Z"),
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    },
  );
  return { code, stdout, stderr };
}

test("CLI --zcode-hook-spool reads <dir>/<sessionId>.jsonl; missing file is a limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tm-hooks-cli-"));
  temps.push(dir);
  const spoolDir = join(dir, "spool");
  await mkdir(spoolDir, { recursive: true });
  await writeFile(
    join(spoolDir, `${SID}.jsonl`),
    spoolOf(pre("tool-2", "10:12.000"), post("tool-2", "10:20.000")),
  );
  const ok = await cli(["--zcode-hook-spool", spoolDir], join(dir, "a"));
  assert.equal(ok.code, 0, ok.stderr);
  const body = await readFile(join(dir, "a", "out", "report.md"), "utf8");
  assert.match(body, /\| tool_wall_ms \|/);
  assert.match(body, /\| hook_events \|/);

  const emptyDir = join(dir, "empty");
  await mkdir(emptyDir, { recursive: true });
  const missing = await cli(["--zcode-hook-spool", emptyDir], join(dir, "b"));
  assert.equal(missing.code, 0, missing.stderr);
  const body2 = await readFile(join(dir, "b", "out", "report.md"), "utf8");
  assert.doesNotMatch(body2, /\| tool_wall_ms \|/);
  assert.match(body2, /no hook spool for this session/);
});
