// Reusable core of `collect`: evidence assembly, store persistence and report rendering.
// Shared by the `collect` command and `auto-report` so neither duplicates the other.
import { collectZcodeRun, type ZcodeRunInput } from "./adapters/zcode/index.ts";
import { parseRunRecord, type RunRecord } from "./adapters/zcode/parse.ts";
import { computeAggregates, PUBLIC_GAP_LIMIT } from "./aggregates/index.ts";
import { canonicalDigest, sha256Hex } from "./canonical.ts";
import { sortRunSegments } from "./correlate.ts";
import { labelAttempt } from "./labels/index.ts";
import { buildLineage, type GitExec, makeGitExec } from "./lineage/index.ts";
import type { AttemptSummary, ManifestPointer, VerifierRecord } from "./model.ts";
import { assertNoForbiddenContent } from "./privacy.ts";
import type { ProfileMode } from "./report/pin.ts";
import { type EvidenceStore, type ManifestDoc, NotFoundError } from "./store/index.ts";
import {
  assessVerifiers,
  extractGateRecord,
  parseTaskCheckLog,
  type SubjectBinding,
  toVerifierOutcome,
} from "./verifier/index.ts";

export const E2E_LIMIT =
  "ADS v4.16 candidate 3041a1b used as isolated E2E test subject; not production adoption";
export const OWNER_LIMIT =
  "ADS v4.16 adopted from version/v4.16@3041a1b by project-owner authorization; not ADS-main qualified";

export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  PRIVACY: 3,
  REVISION_CONFLICT: 4,
  STORE_VERIFY: 5,
  UNREPRESENTABLE: 6,
  NOT_PUBLISHED: 7,
  HELD: 8,
} as const;

export class Failure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GateInput {
  text: string;
  /** Explicit subject sha (file@sha); null lets a recorded GATE_SUBJECT_SHA or mtime decide. */
  sha: string | null;
  mtimeMs: number | null;
}

export interface EvidenceParams {
  input: ZcodeRunInput;
  runTexts: string[];
  gates: GateInput[];
  requiredScope?: string[] | undefined;
  gitDir?: string | undefined;
  extraLimits: string[];
  mode: ProfileMode;
  /** Appended to the summary's observation refs (after the collector's own, capped at 10). */
  extraObservationRefs?: string[];
  /** Limits added before the public-gap limit. */
  extraSummaryLimits?: string[];
}

export function inferSubject(segs: RunRecord[], mtimeMs: number): string | null {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] as RunRecord;
    if (!seg.finished_at || !seg.head_after) continue;
    const end = Date.parse(seg.finished_at);
    if (Number.isNaN(end) || mtimeMs < end) continue;
    const next = segs[i + 1];
    const nextStart = next?.started_at ? Date.parse(next.started_at) : Number.NaN;
    if (Number.isNaN(nextStart) || mtimeMs < nextStart) return seg.head_after;
  }
  return null;
}

export function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function table(summary: AttemptSummary): string {
  const rows = summary.metrics.map(
    (m) =>
      `| ${m.name} | ${m.value === null ? "unknown" : `${m.value} ${m.unit}`} | ${m.epistemic} | ${m.coverage} |`,
  );
  return ["| metric | value | epistemic | coverage |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

export function humanSummary(summary: AttemptSummary): string {
  const lines = [
    `**task-meta execution summary** for \`${summary.task_ref}\` (attempt \`${summary.attempt_ref}\`)`,
    "",
    `Capture coverage: **${summary.capture_coverage}**. Verifier: **${summary.verifier.status}**. Cost: unknown.`,
    "",
    table(summary),
  ];
  if (summary.limits.length > 0) {
    lines.push("", "Limits:", ...summary.limits.map((l) => `- ${l}`));
  }
  return lines.join("\n");
}

export interface Evidence {
  attemptRef: string;
  values: Record<string, unknown>;
  summary: AttemptSummary;
  assessment: ReturnType<typeof assessVerifiers>;
  lineage: Awaited<ReturnType<typeof buildLineage>>;
  labels: ReturnType<typeof labelAttempt>;
}

/** Collect, assess verifiers, build lineage/labels/aggregates; runs the privacy guard. */
export async function buildEvidence(p: EvidenceParams): Promise<Evidence> {
  const input = p.input;
  const attemptRef = input.actor.session_ref;
  let collection: ReturnType<typeof collectZcodeRun>;
  try {
    collection = collectZcodeRun(input);
  } catch (e) {
    throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
  }
  const { observations, summary, profile: capability } = collection;
  summary.limits.push(...p.extraLimits);

  const runs: RunRecord[] = p.runTexts.map((t) => parseRunRecord(t));
  const sorted = sortRunSegments(runs);
  const records: VerifierRecord[] = [];
  let inferredUsed = false;
  let unboundCount = 0;
  for (const g of p.gates) {
    const ref = `gate-log:${sha256Hex(g.text).slice(0, 12)}`;
    let subject: string | null = g.sha;
    let binding: SubjectBinding = g.sha !== null ? "OBSERVED" : "UNKNOWN";
    // A gate-recorded GATE_SUBJECT_SHA (written at run time) beats mtime inference.
    if (g.sha === null && extractGateRecord(g.text).sha === null) {
      subject = g.mtimeMs === null ? null : inferSubject(sorted, g.mtimeMs);
      if (subject !== null) {
        binding = "INFERRED";
        inferredUsed = true;
      } else unboundCount++;
    }
    records.push(
      parseTaskCheckLog(g.text, { ref, subject_sha: subject, subject_binding: binding }),
    );
  }
  const assessment = assessVerifiers({
    records,
    attempt_source_sha: summary.source_sha,
    run_exit_codes: runs.map((r) => r.exit_code),
    ...(p.requiredScope && p.requiredScope.length > 0 ? { required_scope: p.requiredScope } : {}),
  });
  summary.verifier = toVerifierOutcome(assessment, summary.source_sha);

  const git: GitExec | undefined = p.gitDir !== undefined ? makeGitExec(p.gitDir) : undefined;
  const lineage = await buildLineage({
    attempt_ref: attemptRef,
    runs,
    ...(git ? { git } : {}),
    segmentRefs: runs.map((_, i) => `zcode:run-record:${attemptRef}#${i + 1}`),
  });
  for (const t of lineage.transitions) {
    if (t.to_version === null) continue;
    for (const r of assessment.records) {
      if (r.subject_sha !== null && t.to_version === `git:${r.subject_sha}`) {
        const ref = r.source_refs[0];
        if (ref !== undefined && !t.verifier_refs.includes(ref)) t.verifier_refs.push(ref);
      }
    }
  }
  const labels = labelAttempt({ observations, lineage, assessment });
  const aggregates = computeAggregates({
    summaryAttempts: [attemptRef],
    excludedAttempts: [],
    assessment,
    lineage,
    labels,
  });
  summary.limits.push(
    `verifier outcome class: ${assessment.outcome_class}`,
    `verifier conflicts: ${assessment.conflicts.length}`,
    ...assessment.limits.slice(0, 5),
  );
  if (inferredUsed) {
    summary.limits.push(
      "gate log subject inferred from file mtime: after a finished run segment and before the next one starts",
    );
  }
  if (unboundCount > 0) {
    summary.limits.push(
      `${unboundCount} gate log(s) without subject binding (mtime not inferable)`,
    );
  }
  if (p.mode === "E2E_TEST_SUBJECT") summary.limits.push(E2E_LIMIT);
  if (p.mode === "OWNER_AUTHORIZED") summary.limits.push(OWNER_LIMIT);
  summary.limits.push(...(p.extraSummaryLimits ?? []));
  summary.limits.push(PUBLIC_GAP_LIMIT);
  summary.limits = [...new Set(summary.limits)];
  if (p.extraObservationRefs && p.extraObservationRefs.length > 0) {
    summary.observation_refs = [
      ...new Set([...summary.observation_refs, ...p.extraObservationRefs]),
    ];
  }

  const values = {
    observations,
    summary,
    capability,
    verifier: assessment,
    lineage,
    labels,
    aggregates,
  };
  try {
    assertNoForbiddenContent(values);
  } catch (e) {
    throw new Failure(EXIT.PRIVACY, `privacy guard refused the evidence: ${(e as Error).message}`);
  }
  return { attemptRef, values, summary, assessment, lineage, labels };
}

/** True when every stored object of the manifest equals the freshly built value of its role. */
export function manifestMatches(existing: ManifestDoc, ev: Evidence): boolean {
  const roles = Object.keys(ev.values) as (keyof Evidence["values"])[];
  return (
    existing.objects.length === roles.length &&
    roles.every(
      (role) =>
        existing.objects.find((o) => o.role === role)?.digest === canonicalDigest(ev.values[role]),
    )
  );
}

export async function readManifestOrNull(
  store: EvidenceStore,
  attemptRef: string,
  revision?: number,
): Promise<ManifestDoc | null> {
  try {
    return await store.readManifest(attemptRef, revision);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** Write one manifest revision for the evidence and verify the stored closure. */
export async function persistRevision(
  store: EvidenceStore,
  ev: Evidence,
  revision: number,
  predecessor: string | null,
  clock: string,
): Promise<ManifestPointer> {
  const objects = [];
  for (const role of Object.keys(ev.values) as (keyof Evidence["values"])[]) {
    objects.push({ role, digest: (await store.putObject(ev.values[role])).digest });
  }
  const written = await store.writeManifest({
    attempt_ref: ev.attemptRef,
    revision,
    objects,
    predecessor,
    created_at: clock,
  });
  const pointer: ManifestPointer = {
    ref: written.ref,
    sha256: written.sha256,
    access: written.access,
  };
  const verified = await store.verifyManifest(pointer.sha256);
  if (!verified.ok) {
    throw new Failure(
      EXIT.STORE_VERIFY,
      `store verification failed: missing=${verified.missing.length} tampered=${verified.tampered.length}`,
    );
  }
  return pointer;
}
