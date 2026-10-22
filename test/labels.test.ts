import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { collectZcodeRun } from "../src/adapters/zcode/index.ts";
import { classifyCommand, parseModelIo } from "../src/adapters/zcode/parse.ts";
import { categorizeTool, LABELER, labelAttempt, RULE_TABLE } from "../src/labels/index.ts";
import type {
  ObservationRecord,
  Transition,
  VerifierAssessment,
  VerifierRecord,
  VersionLineage,
} from "../src/model.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const SENTINEL = "SENTINEL_CMD_91x";

test("classifyCommand table", () => {
  const rows: [string, string][] = [
    ["npm test", "TEST"],
    ["npm run test", "TEST"],
    ["cd x && npm test", "TEST"],
    ["node --test test/a.test.ts", "TEST"],
    ["npx vitest run", "TEST"],
    ["npx jest", "TEST"],
    ["pytest", "TEST"],
    ["go test ./...", "TEST"],
    ["cargo test", "TEST"],
    ["bash tools/task-check.sh x", "TEST"],
    ["rtk npm test", "TEST"],
    ["npm test > x.log 2>&1; echo EXIT=$?", "TEST"],
    ["tsc --noEmit", "TYPECHECK_LINT"],
    ["npm run typecheck", "TYPECHECK_LINT"],
    ["npm run lint", "TYPECHECK_LINT"],
    ["npx biome check --write .", "TYPECHECK_LINT"],
    ["eslint .", "TYPECHECK_LINT"],
    ["npm run build", "BUILD"],
    ["cargo build", "BUILD"],
    ["go build ./...", "BUILD"],
    ["make", "BUILD"],
    ["npm ci", "DEPENDENCY"],
    ["npm install", "DEPENDENCY"],
    ["pnpm install", "DEPENDENCY"],
    ["pip install x", "DEPENDENCY"],
    ["fnm use 24", "DEPENDENCY"],
    ["git status", "VCS"],
    ["FOO=1 git status", "VCS"],
    ["gh pr list", "VCS"],
    ["cat a", "READ_SEARCH"],
    ["head -5 a | wc -l", "READ_SEARCH"],
    ["ls", "READ_SEARCH"],
    ["find . -name x", "READ_SEARCH"],
    ["rg foo", "READ_SEARCH"],
    ["sed -n 1p a", "READ_SEARCH"],
    ["awk '{print $1}' a", "READ_SEARCH"],
    ["mkdir d", "FILE_WRITE"],
    ["cp a b", "FILE_WRITE"],
    ["mv a b", "FILE_WRITE"],
    ["rm a", "FILE_WRITE"],
    ["echo x | tee f", "OTHER"],
    ["tee f", "FILE_WRITE"],
    ["sed -i s/a/b/ f", "FILE_WRITE"],
    ["echo x > f", "FILE_WRITE"],
    ["cat a > b", "FILE_WRITE"],
    ['bash -c "npm test"', "OTHER"],
    ["cd x && bash -c 'git status'", "OTHER"],
    ["echo hello", "OTHER"],
    ["", "OTHER"],
  ];
  for (const [cmd, want] of rows) assert.equal(classifyCommand(cmd), want, cmd);
});

function ioLine(over: Record<string, unknown>): string {
  return JSON.stringify({
    type: "model_io",
    sessionId: "s1",
    requestId: "r1",
    attempt: 1,
    startedAt: "2026-10-22T13:10:00.000Z",
    response: { toolCalls: [] },
    ...over,
  });
}

test("input_class is the only trace of a Bash command", () => {
  const line = ioLine({
    response: {
      toolCalls: [
        { id: "t1", name: "Bash", input: { command: `echo ${SENTINEL}` } },
        { id: "t2", name: "bash", input: { command: "cd x && npm test" } },
        { id: "t3", name: "Read", input: { command: "npm test" } },
        { id: "t4", name: "Bash", input: { description: "no command" } },
      ],
    },
  });
  const parsed = parseModelIo(line);
  assert.deepEqual(parsed.records[0]?.toolCalls, [
    { id: "t1", name: "Bash", inputClass: "OTHER" },
    { id: "t2", name: "bash", inputClass: "TEST" },
    { id: "t3", name: "Read" },
    { id: "t4", name: "Bash" },
  ]);
  const r = collectZcodeRun({
    repository: "o/r",
    issue_number: 1,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "s1",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    modelIo: line,
  });
  const tools = r.observations.filter((o) => o.kind === "TOOL_CALL");
  assert.equal(tools.length, 4);
  assert.equal(tools[0]?.tool?.input_class, "OTHER");
  assert.equal(tools[1]?.tool?.input_class, "TEST");
  assert.equal(tools[2]?.tool?.input_class, undefined);
  const whole = JSON.stringify(r);
  assert.ok(!whole.includes(SENTINEL));
  assert.ok(!whole.includes("SENTINEL"));
  assert.deepEqual(findForbiddenContent(r, [SENTINEL]), []);
  assert.equal(r.profile.signals.tool_input_class?.supported, true);
  assert.equal(r.profile.signals.tool_input_class?.epistemic, "INFERRED");
  assert.equal(r.profile.signals.experience_exposure?.supported, false);
  assert.equal(r.profile.signals.experience_exposure?.epistemic, "UNKNOWN");
});

// ---- labeler ----

let seq = 0;
function req(id: string, startedAt: string | null): ObservationRecord {
  return {
    observation_id: `zcode:${id}#1`,
    source_event_id: `${id}#1`,
    source_revision: 1,
    adapter_id: "zcode",
    kind: "MODEL_REQUEST",
    task_ref: "o/r#1",
    run_ref: "s1",
    attempt_ref: "s1",
    step_ref: null,
    parent_ref: null,
    logical_call_ref: id,
    physical_attempt_ref: `${id}#1`,
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    model: null,
    tool: null,
    usage: null,
    status: null,
    fields_epistemic: {},
    privacy_class: "PROJECT_PRIVATE",
  };
}
function call(parent: string, name: string, inputClass?: string): ObservationRecord {
  seq += 1;
  const o = req(`unused${seq}`, null);
  o.observation_id = `zcode:tool:c${seq}`;
  o.source_event_id = `tool:c${seq}`;
  o.kind = "TOOL_CALL";
  o.parent_ref = `zcode:${parent}#1`;
  o.tool = { call_id: `c${seq}`, name, ...(inputClass ? { input_class: inputClass } : {}) };
  return o;
}
const emptyLineage: VersionLineage = { versions: [], transitions: [], revisits: [], limits: [] };
function assess(over: Partial<VerifierAssessment> = {}): VerifierAssessment {
  return {
    outcome_class: "STRICT_TERMINAL_SUCCESS",
    records: [],
    conflicts: [],
    limits: [],
    ...over,
  };
}
function rec(over: Partial<VerifierRecord> = {}): VerifierRecord {
  return {
    verifier_id: "task-check",
    verifier_version: null,
    contract_ref: null,
    subject_sha: "a".repeat(40),
    environment: {},
    required_scope: ["task-check:lint", "task-check:typecheck", "task-check:test"],
    checked: [],
    failed: [],
    skipped: [],
    unchecked: [],
    cases: { total: null, passed: null, failed: null, skipped: null, epistemic: "UNKNOWN" },
    exit_code: null,
    currentness: "CURRENT",
    qualifiers: [],
    source_refs: ["task-check:aaaaaaa"],
    epistemic: "OBSERVED",
    ...over,
  };
}
function tr(
  id: string,
  kind: Transition["kind"],
  ins: number | null,
  del: number | null,
): Transition {
  return {
    transition_id: id,
    from_version: "git:a",
    to_version: "git:b",
    run_segment_ref: id,
    started_at: null,
    finished_at: null,
    change: { files_changed: null, insertions: ins, deletions: del, diff_digest: null },
    verifier_refs: [],
    kind,
    epistemic: "OBSERVED",
    limits: [],
  };
}
const kinds = (ls: ReturnType<typeof labelAttempt>, k: string) => ls.filter((l) => l.kind === k);

test("ACTION_CATEGORY per tool call, with provenance", () => {
  const obs = [
    req("r1", "2026-10-22T13:10:00.000Z"),
    call("r1", "Edit"),
    call("r1", "Read"),
    call("r1", "TodoWrite"),
    call("r1", "TaskOutput"),
    call("r1", "Bash", "TEST"),
    call("r1", "Bash", "OTHER"),
    call("r1", "Bash"),
    call("r1", "Mystery"),
  ];
  const ls = kinds(
    labelAttempt({ observations: obs, lineage: emptyLineage, assessment: assess() }),
    "ACTION_CATEGORY",
  );
  assert.deepEqual(
    ls.map((l) => l.value),
    ["IMPLEMENTATION", "DIAGNOSIS", "PLANNING", "OTHER", "TEST", "UNKNOWN", "UNKNOWN", "UNKNOWN"],
  );
  assert.equal(ls[0]?.epistemic, "INFERRED");
  assert.equal(ls[5]?.epistemic, "UNKNOWN");
  assert.equal(ls[0]?.confidence, null);
  assert.equal(ls[0]?.supersedes, null);
  assert.deepEqual(ls[0]?.labeler, LABELER);
  assert.equal(ls[0]?.evidence_refs[0], ls[0]?.target_ref);
  assert.deepEqual(
    kinds(
      labelAttempt({ observations: [], lineage: emptyLineage, assessment: assess() }),
      "ACTION_CATEGORY",
    ),
    [],
  );
});

test("determinism: same input yields identical labels, ids and digest", () => {
  const obs = [
    req("r1", "2026-10-22T13:10:00.000Z"),
    call("r1", "Edit"),
    call("r1", "Bash", "TEST"),
  ];
  const input = {
    observations: obs,
    lineage: { ...emptyLineage, transitions: [tr("t1", "ADVANCE", 3, 4)] },
    assessment: assess(),
  };
  const a = labelAttempt(input);
  const b = labelAttempt(structuredClone(input));
  assert.deepEqual(a, b);
  assert.ok(a.every((l) => /^[0-9a-f]{32}$/.test(l.label_id)));
  assert.equal(new Set(a.map((l) => l.label_id)).size, a.length);
  assert.equal(LABELER.name, "task-meta-rules");
  assert.equal(LABELER.version, "1.0.0");
  assert.match(LABELER.rules_digest, /^[0-9a-f]{64}$/);
  assert.equal(LABELER.rules_digest, LABELER.rules_digest);
  assert.ok(RULE_TABLE.loop_cluster.min_consecutive_test_calls === 3);
});

test("EDIT_MAGNITUDE buckets and unknowns", () => {
  const lineage: VersionLineage = {
    ...emptyLineage,
    transitions: [
      tr("t0", "NO_CHANGE", 0, 0),
      tr("t1", "ADVANCE", 10, 39),
      tr("t2", "ADVANCE", 25, 25),
      tr("t3", "ADVANCE", 499, 0),
      tr("t4", "REVISIT", 500, 0),
      tr("t5", "ADVANCE", null, 3),
      tr("t6", "INCOMPLETE", null, null),
    ],
  };
  const ls = kinds(
    labelAttempt({ observations: [], lineage, assessment: assess() }),
    "EDIT_MAGNITUDE",
  );
  assert.deepEqual(
    ls.map((l) => [l.target_ref, l.value]),
    [
      ["t0", "NONE"],
      ["t1", "SMALL"],
      ["t2", "MEDIUM"],
      ["t3", "MEDIUM"],
      ["t4", "LARGE"],
      ["t5", "UNKNOWN"],
    ],
  );
  assert.equal(ls[1]?.epistemic, "OBSERVED");
  assert.equal(ls[5]?.epistemic, "UNKNOWN");
});

test("LOOP_CLUSTER boundary: 2 none, 3 one, edit resets, order by request start", () => {
  const mk = (cats: string[]) => {
    const obs: ObservationRecord[] = [req("r1", "2026-10-22T13:10:00.000Z")];
    for (const c of cats)
      obs.push(call("r1", c === "E" ? "Edit" : "Bash", c === "T" ? "TEST" : undefined));
    return kinds(
      labelAttempt({ observations: obs, lineage: emptyLineage, assessment: assess() }),
      "LOOP_CLUSTER",
    );
  };
  assert.equal(mk(["T", "T"]).length, 0);
  const three = mk(["T", "T", "T"]);
  assert.equal(three.length, 1);
  assert.equal(three[0]?.value, "test-rerun-without-edit:3");
  assert.equal(three[0]?.epistemic, "INFERRED");
  assert.equal(three[0]?.evidence_refs.length, 3);
  assert.equal(mk(["T", "T", "E", "T", "T"]).length, 0);
  assert.equal(mk(["T", "T", "E", "T", "T", "T"]).length, 1);
  assert.equal(
    mk(["T", "T", "T", "E", "T", "T", "T", "T"])
      .map((l) => l.value)
      .join(),
    "test-rerun-without-edit:3,test-rerun-without-edit:4",
  );

  // Tool calls are ordered by parent request start time, not by array order.
  const late = req("late", "2026-10-22T13:20:00.000Z");
  const early = req("early", "2026-10-22T13:10:00.000Z");
  const obs = [
    late,
    early,
    call("late", "Edit"),
    call("early", "Bash", "TEST"),
    call("early", "Bash", "TEST"),
    call("early", "Bash", "TEST"),
  ];
  const ls = kinds(
    labelAttempt({ observations: obs, lineage: emptyLineage, assessment: assess() }),
    "LOOP_CLUSTER",
  );
  assert.equal(ls.length, 1);
});

test("REVISIT_CANDIDATE only for lineage revisits", () => {
  const none = labelAttempt({ observations: [], lineage: emptyLineage, assessment: assess() });
  assert.equal(kinds(none, "REVISIT_CANDIDATE").length, 0);
  const ls = kinds(
    labelAttempt({
      observations: [],
      lineage: {
        ...emptyLineage,
        revisits: [{ version_id: "git:a", transition_ids: ["t1", "t2"] }],
      },
      assessment: assess(),
    }),
    "REVISIT_CANDIDATE",
  );
  assert.equal(ls.length, 1);
  assert.equal(ls[0]?.target_ref, "git:a");
  assert.equal(ls[0]?.value, "revisit");
  assert.equal(ls[0]?.epistemic, "OBSERVED");
  assert.deepEqual(ls[0]?.evidence_refs, ["t1", "t2"]);
});

test("FAILURE_CLASS_CANDIDATE mapping", () => {
  const run = (a: VerifierAssessment) =>
    kinds(
      labelAttempt({ observations: [], lineage: emptyLineage, assessment: a }),
      "FAILURE_CLASS_CANDIDATE",
    );
  const val = (a: VerifierAssessment) => run(a).map((l) => l.value);
  assert.deepEqual(
    val(
      assess({
        outcome_class: "TERMINAL_FAILURE",
        records: [rec({ failed: ["task-check:deps"] })],
      }),
    ),
    ["ENVIRONMENT_CI"],
  );
  for (const s of ["lint", "typecheck", "test"]) {
    assert.deepEqual(
      val(
        assess({
          outcome_class: "TERMINAL_FAILURE",
          records: [rec({ failed: [`task-check:${s}`] })],
        }),
      ),
      ["IMPLEMENTATION"],
    );
  }
  assert.deepEqual(
    val(assess({ outcome_class: "TERMINAL_FAILURE", records: [rec({ failed: ["task-check"] })] })),
    ["UNRESOLVED"],
  );
  // stale failure is not a current failure
  assert.deepEqual(
    val(
      assess({
        outcome_class: "TERMINAL_FAILURE",
        records: [rec({ failed: ["task-check:test"], currentness: "STALE" })],
      }),
    ),
    [],
  );
  const unv = run(
    assess({ outcome_class: "UNVERIFIED", conflicts: ["x"], records: [rec(), rec()] }),
  );
  assert.equal(unv.length, 1);
  assert.equal(unv[0]?.value, "UNRESOLVED");
  assert.equal(unv[0]?.epistemic, "INFERRED");
  // absence of records is not a failure; success and partial never produce one
  assert.deepEqual(val(assess({ outcome_class: "UNVERIFIED" })), []);
  assert.deepEqual(val(assess({ outcome_class: "STRICT_TERMINAL_SUCCESS", records: [rec()] })), []);
  assert.deepEqual(
    val(assess({ outcome_class: "PARTIAL_PROGRESS", records: [rec()], conflicts: ["x"] })),
    [],
  );
});

test("golden set: confusion matrix, exact agreement, unknown counted not guessed", () => {
  const rows = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "labels", "golden.json"), "utf8"),
  ) as { name: string; command?: string; expected: string }[];
  assert.ok(rows.length >= 30);
  const matrix = new Map<string, number>();
  let unknownRows = 0;
  let mismatches = 0;
  for (const row of rows) {
    const cls =
      row.name.toLowerCase() === "bash" && row.command !== undefined
        ? classifyCommand(row.command)
        : undefined;
    const got = categorizeTool(row.name, cls);
    const k = `${row.expected} -> ${got}`;
    matrix.set(k, (matrix.get(k) ?? 0) + 1);
    if (got === "UNKNOWN") unknownRows += 1;
    if (got !== row.expected) mismatches += 1;
  }
  console.log("confusion matrix (expected -> got : count)");
  for (const [k, n] of [...matrix].sort()) console.log(`  ${k} : ${n}`);
  console.log(`rows=${rows.length} unknown=${unknownRows} mismatches=${mismatches}`);
  assert.equal(mismatches, 0);
  assert.equal(unknownRows, rows.filter((r) => r.expected === "UNKNOWN").length);
  assert.ok(unknownRows > 0);
});
