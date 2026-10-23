import type {
  Epistemic,
  OutcomeClass,
  VerifierAssessment,
  VerifierOutcome,
  VerifierQualifier,
  VerifierRecord,
} from "../model.ts";

/**
 * #11 verifier semantics. Pure functions over text and records: no I/O, no paths.
 * Everything here is derived only from what the gate log itself shows.
 */

const STEPS = ["lint", "typecheck", "test"] as const;
type Step = (typeof STEPS)[number];

const DEFAULT_SCOPE = STEPS.map((s) => `task-check:${s}`);
const ACCEPTANCE = "task-acceptance";

export type SubjectBinding = "OBSERVED" | "INFERRED" | "UNKNOWN";

export interface ParseTaskCheckOptions {
  ref: string;
  subject_sha: string | null;
  subject_binding: SubjectBinding;
}

const HEX40 = /^[0-9a-f]{40}$/;

/** `GATE_SUBJECT_SHA=<40hex>` / `GATE_TREE_CLEAN=yes|no` lines recorded by the gate at run time. */
export function extractGateRecord(text: string): { sha: string | null; clean: boolean | null } {
  let sha: string | null = null;
  let clean: boolean | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^GATE_SUBJECT_SHA=(\S+)\s*$/.exec(line);
    if (m && sha === null && HEX40.test(m[1] as string)) sha = m[1] as string;
    const c = /^GATE_TREE_CLEAN=(yes|no)\s*$/.exec(line);
    if (c && clean === null) clean = c[1] === "yes";
  }
  return { sha, clean };
}

function isStep(s: string): s is Step {
  return (STEPS as readonly string[]).includes(s);
}

export function parseTaskCheckLog(text: string, opts: ParseTaskCheckOptions): VerifierRecord {
  const lines = text.split(/\r?\n/);
  const started: Step[] = [];
  const skipped: Step[] = [];
  let failedStep: Step | null = null;
  let depsFailed = false;
  let verdict: "GREEN" | "FAILED" | "DOCS_ONLY" | null = null;
  let exitCode: number | null = null;
  let nodeMajor: string | null = null;
  const sums: Record<"tests" | "pass" | "fail" | "skipped", number | null> = {
    tests: null,
    pass: null,
    fail: null,
    skipped: null,
  };

  for (const line of lines) {
    const stepM = /^== (\w+) ==\s*$/.exec(line);
    const skipM = /^-- (\w+) \(仓库未定义, 跳过\)\s*$/.exec(line);
    const failM = /^!! (\w+) 未通过/.exec(line);
    const exitM = /^EXIT=(\d+)\s*$/.exec(line);
    const nodeM = /^v(\d+)\.\d+\.\d+\s*$/.exec(line);
    const caseM = /^\s*(?:ℹ|#)\s+(tests|pass|fail|skipped)\s+(\d+)\s*$/.exec(line);
    if (stepM && isStep(stepM[1] as string)) started.push(stepM[1] as Step);
    else if (skipM && isStep(skipM[1] as string)) skipped.push(skipM[1] as Step);
    else if (failM && isStep(failM[1] as string)) failedStep = failM[1] as Step;
    else if (/^!! 依赖安装失败/.test(line)) depsFailed = true;
    else if (/^task-check: 全绿\s*$/.test(line)) verdict = "GREEN";
    else if (/^task-check: 未通过\s*$/.test(line)) verdict = "FAILED";
    else if (/^task-check: DOCS_ONLY/.test(line)) verdict = "DOCS_ONLY";
    else if (exitM) exitCode = Number(exitM[1]);
    else if (nodeM && nodeMajor === null) nodeMajor = nodeM[1] as string;
    else if (caseM) {
      const key = caseM[1] as keyof typeof sums;
      sums[key] = (sums[key] ?? 0) + Number(caseM[2]);
    }
  }

  const hasEnd = verdict !== null || exitCode !== null || depsFailed;
  const exitFailed = exitCode !== null && exitCode !== 0;
  const failing = verdict === "FAILED" || failedStep !== null || depsFailed || exitFailed;

  const failed: string[] = [];
  let checked: Step[] = [];
  if (verdict === "DOCS_ONLY") {
    checked = [];
  } else if (failing) {
    // The step running when the gate stopped; with no `!!` line, the last started one.
    const running = failedStep ?? started[started.length - 1] ?? null;
    if (depsFailed) failed.push("task-check:deps");
    else if (running) failed.push(`task-check:${running}`);
    else failed.push("task-check");
    checked = started.filter((s) => `task-check:${s}` !== failed[0]);
  } else if (verdict === "GREEN" || (exitCode === 0 && verdict === null)) {
    checked = [...started];
  } else {
    // Truncated: only steps followed by a later step header are known to have completed.
    checked = started.slice(0, -1);
  }
  checked = [...new Set(checked)];

  const qualifiers: VerifierQualifier[] = [];
  const recorded = extractGateRecord(text);
  let subjectSha = opts.subject_sha;
  let binding: SubjectBinding = opts.subject_binding;
  let subjectConflict = false;
  if (recorded.sha !== null) {
    if (opts.subject_sha === null) {
      subjectSha = recorded.sha;
      binding = "OBSERVED";
    } else if (opts.subject_sha === recorded.sha) {
      binding = "OBSERVED";
    } else {
      subjectConflict = true;
      subjectSha = null;
      binding = "UNKNOWN";
    }
  }
  qualifiers.push({
    kind: "subject_binding",
    value: binding,
    epistemic: binding,
    source_ref: opts.ref,
    limits: binding === "OBSERVED" ? [] : [`verifier subject binding ${binding}`],
  });
  if (subjectConflict) {
    qualifiers.push({
      kind: "subject_conflict",
      value: "gate_recorded_sha_differs_from_supplied",
      epistemic: "OBSERVED",
      source_ref: opts.ref,
      limits: ["supplied subject sha differs from the sha recorded by the gate; not verified"],
    });
  }
  if (recorded.sha !== null && recorded.clean === false) {
    qualifiers.push({
      kind: "working_tree_dirty",
      value: "yes",
      epistemic: "OBSERVED",
      source_ref: opts.ref,
      limits: ["gate ran on a dirty working tree; uncommitted bytes were tested"],
    });
  }
  if (verdict !== null && exitCode === null) {
    qualifiers.push({
      kind: "exit_code_capture",
      value: "verdict_line_only",
      epistemic: "OBSERVED",
      source_ref: opts.ref,
      limits: ["exit code not captured; verdict from task-check final line"],
    });
  }
  if (verdict === "DOCS_ONLY") {
    qualifiers.push({
      kind: "docs_only_fast_lane",
      value: "true",
      epistemic: "OBSERVED",
      source_ref: opts.ref,
      limits: ["docs-only diff; all gate checks skipped, nothing was verified"],
    });
  }

  const skippedIds =
    verdict === "DOCS_ONLY"
      ? STEPS.map((s) => `task-check:${s}`)
      : skipped.map((s) => `task-check:${s}`);
  const checkedIds = checked.map((s) => `task-check:${s}`);
  const requiredScope = [...DEFAULT_SCOPE];
  const unchecked = [ACCEPTANCE, ...requiredScope.filter((s) => !checkedIds.includes(s))];

  const sawCases = sums.tests !== null;
  const cases: VerifierRecord["cases"] = sawCases
    ? {
        total: sums.tests,
        passed: sums.pass,
        failed: sums.fail,
        skipped: sums.skipped,
        epistemic: "OBSERVED",
      }
    : { total: null, passed: null, failed: null, skipped: null, epistemic: "UNKNOWN" };

  const epistemic: Epistemic = hasEnd && !subjectConflict ? "OBSERVED" : "UNKNOWN";
  const environment: Record<string, string> = {};
  if (nodeMajor !== null) environment.node_major = nodeMajor;

  return {
    verifier_id: "task-check",
    verifier_version: null,
    contract_ref: null,
    subject_sha: subjectSha,
    environment,
    required_scope: requiredScope,
    checked: checkedIds,
    failed,
    skipped: skippedIds,
    unchecked: [...new Set(unchecked)],
    cases,
    exit_code: exitCode,
    currentness: "UNKNOWN",
    qualifiers,
    source_refs: [opts.ref],
    epistemic,
  };
}

// ---- assessment ----

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NONE" | "UNKNOWN";

function bindingOf(r: VerifierRecord): string | null {
  return r.qualifiers.find((q) => q.kind === "subject_binding")?.value ?? null;
}

function isDocsOnly(r: VerifierRecord): boolean {
  return r.qualifiers.some((q) => q.kind === "docs_only_fast_lane");
}

/**
 * Verdict of one record against its own required scope.
 * FAIL: failed steps, non-zero exit, or observed failing cases.
 * PASS: every required item checked and nothing failed. PARTIAL: some checked, not all.
 * NONE: nothing checked (docs-only / empty). UNKNOWN: record is not an observation.
 * cases.failed null with the test step checked and no failed steps counts as pass:
 * the gate itself stops on a failing test run, so absent counts are missing metadata,
 * not corruption.
 */
function verdictOf(r: VerifierRecord): Verdict {
  if (r.epistemic !== "OBSERVED") return "UNKNOWN";
  if (r.failed.length > 0) return "FAIL";
  if (r.exit_code !== null && r.exit_code !== 0) return "FAIL";
  if (r.cases.failed !== null && r.cases.failed > 0) return "FAIL";
  if (isDocsOnly(r) || r.checked.length === 0) return "NONE";
  const complete = r.required_scope.every((s) => r.checked.includes(s));
  return complete ? "PASS" : "PARTIAL";
}

function isDirty(r: VerifierRecord): boolean {
  return r.qualifiers.some((q) => q.kind === "working_tree_dirty");
}

function isStrictEligible(r: VerifierRecord): boolean {
  return (
    !isDirty(r) &&
    r.currentness === "CURRENT" &&
    r.subject_sha !== null &&
    bindingOf(r) === "OBSERVED" &&
    verdictOf(r) === "PASS"
  );
}

export interface AssessInput {
  records: VerifierRecord[];
  attempt_source_sha: string | null;
  required_scope?: string[];
  run_exit_codes?: (number | null)[];
}

function withCurrentness(r: VerifierRecord, sha: string | null, scope?: string[]): VerifierRecord {
  let currentness: VerifierRecord["currentness"] = "UNKNOWN";
  if (sha !== null && r.subject_sha !== null) {
    currentness = r.subject_sha === sha ? "CURRENT" : "STALE";
  }
  const required_scope = scope ? [...scope] : r.required_scope;
  const unchecked = [
    ...new Set([ACCEPTANCE, ...required_scope.filter((s) => !r.checked.includes(s))]),
  ];
  return { ...r, currentness, required_scope, unchecked };
}

export function assessVerifiers(input: AssessInput): VerifierAssessment {
  const records = input.records.map((r) =>
    withCurrentness(r, input.attempt_source_sha, input.required_scope),
  );
  const conflicts: string[] = [];
  const limits: string[] = [];

  if (records.length === 0) {
    return {
      outcome_class: "UNVERIFIED",
      records,
      conflicts,
      limits: ["no verifier record; outcome not verified"],
    };
  }

  // Contradictory CURRENT verdicts on the same SHA: retained, never latest-wins.
  let sameShaConflict = false;
  const current = records.filter((r) => r.currentness === "CURRENT");
  const bySha = new Map<string, VerifierRecord[]>();
  for (const r of current) {
    const key = r.subject_sha as string;
    bySha.set(key, [...(bySha.get(key) ?? []), r]);
  }
  for (const group of bySha.values()) {
    const pass = group.filter((r) => verdictOf(r) === "PASS");
    const fail = group.filter((r) => verdictOf(r) === "FAIL");
    if (pass.length > 0 && fail.length > 0) {
      sameShaConflict = true;
      conflicts.push(
        `contradictory verifier verdicts on the same subject: PASS ${pass
          .map((r) => r.source_refs.join("+"))
          .join(",")} vs FAIL ${fail.map((r) => r.source_refs.join("+")).join(",")}`,
      );
    }
  }

  // Agent-process exit vs verifier verdict: noted only; the verifier verdict stands.
  for (const code of input.run_exit_codes ?? []) {
    if (code === null) continue;
    for (const r of records) {
      const v = verdictOf(r);
      if (code !== 0 && v === "PASS") {
        conflicts.push(
          `run exit code ${code} while verifier ${r.source_refs.join("+")} passed; verifier verdict kept`,
        );
      } else if (code === 0 && v === "FAIL") {
        conflicts.push(
          `run exit code 0 while verifier ${r.source_refs.join("+")} failed; verifier verdict kept`,
        );
      }
    }
  }

  let outcome: OutcomeClass;
  if (sameShaConflict) {
    outcome = "UNVERIFIED";
    limits.push("contradictory verifier verdicts on the same subject; outcome not verified");
  } else if (current.some((r) => verdictOf(r) === "FAIL")) {
    outcome = "TERMINAL_FAILURE";
  } else if (records.some(isStrictEligible)) {
    outcome = "STRICT_TERMINAL_SUCCESS";
    limits.push("task acceptance is not checked by the gate; required scope passed only");
  } else {
    const usable = records.filter((r) => {
      const v = verdictOf(r);
      return v === "PASS" || v === "PARTIAL" || v === "NONE";
    });
    outcome = usable.length > 0 ? "PARTIAL_PROGRESS" : "UNVERIFIED";
    for (const r of records) {
      const ref = r.source_refs.join("+");
      const v = verdictOf(r);
      if (v === "UNKNOWN") limits.push(`verifier ${ref} incomplete or not observed; ignored`);
      else if (isDocsOnly(r)) limits.push(`verifier ${ref} docs-only fast lane; nothing verified`);
      else if (v === "FAIL" && r.currentness !== "CURRENT")
        limits.push(`verifier ${ref} failure is not on the current source; not a current failure`);
      else if (v === "PARTIAL" || v === "NONE")
        limits.push(`verifier ${ref} did not check the full required scope`);
      else if (v === "PASS") {
        if (isDirty(r))
          limits.push(`verifier ${ref} ran on a dirty working tree; strict success not claimed`);
        else if (r.currentness === "STALE")
          limits.push(`verifier ${ref} subject is stale against the attempt source`);
        else if (r.currentness === "UNKNOWN")
          limits.push(`verifier ${ref} currentness unknown; subject not matched to attempt source`);
        else if (bindingOf(r) !== "OBSERVED")
          limits.push(
            `verifier subject binding ${bindingOf(r) ?? "UNKNOWN"}; strict success not claimed`,
          );
      }
    }
  }
  return { outcome_class: outcome, records, conflicts, limits };
}

// ---- public-summary projection ----

function union(lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

export function toVerifierOutcome(
  assessment: VerifierAssessment,
  _attempt_source_sha: string | null,
): VerifierOutcome {
  const { records, outcome_class } = assessment;
  if (records.length === 0) {
    return {
      status: "NOT_RUN",
      subject_sha: null,
      checked: [],
      failed: [],
      skipped: [],
      unchecked: [],
      coverage: "UNKNOWN",
      epistemic: "UNKNOWN",
      source_refs: [],
    };
  }
  const refs = union(records.map((r) => r.source_refs));
  const pick = (rs: VerifierRecord[]) => ({
    subject_sha: rs[0]?.subject_sha ?? null,
    checked: union(rs.map((r) => r.checked)),
    failed: union(rs.map((r) => r.failed)),
    skipped: union(rs.map((r) => r.skipped)),
    unchecked: union(rs.map((r) => r.unchecked)),
    source_refs: union(rs.map((r) => r.source_refs)),
  });
  if (outcome_class === "STRICT_TERMINAL_SUCCESS") {
    const r = records.filter(isStrictEligible);
    return { status: "PASS", ...pick(r.slice(0, 1)), coverage: "PARTIAL", epistemic: "OBSERVED" };
  }
  if (outcome_class === "TERMINAL_FAILURE") {
    const r = records.filter((x) => x.currentness === "CURRENT" && verdictOf(x) === "FAIL");
    return { status: "FAIL", ...pick(r), coverage: "PARTIAL", epistemic: "OBSERVED" };
  }
  if (outcome_class === "PARTIAL_PROGRESS") {
    const r = records.filter((x) => ["PASS", "PARTIAL", "NONE"].includes(verdictOf(x)));
    // Prefer a CURRENT record, then the first observed one.
    const best = r.find((x) => x.currentness === "CURRENT") ?? r[0];
    return {
      status: "PARTIAL",
      ...pick(best ? [best] : []),
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
    };
  }
  return {
    status: "UNKNOWN",
    subject_sha: null,
    checked: [],
    failed: [],
    skipped: [],
    unchecked: [],
    coverage: "PARTIAL",
    epistemic: "UNKNOWN",
    source_refs: refs,
  };
}
