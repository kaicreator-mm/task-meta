import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectZcodeRun, type ZcodeRunInput } from "./adapters/zcode/index.ts";
import {
  parseHeadlessResult,
  parseModelIo,
  parseRunRecord,
  type RunRecord,
} from "./adapters/zcode/parse.ts";
import { computeAggregates, PUBLIC_GAP_LIMIT } from "./aggregates/index.ts";
import { canonicalDigest, sha256Hex } from "./canonical.ts";
import { sortRunSegments } from "./correlate.ts";
import { labelAttempt } from "./labels/index.ts";
import { buildLineage, type GitExec, makeGitExec } from "./lineage/index.ts";
import type { AttemptSummary, ManifestPointer, VerifierRecord } from "./model.ts";
import { assertNoForbiddenContent } from "./privacy.ts";
import { GhCliClient, type GitHubClient, publishReport } from "./publish/index.ts";
import {
  buildReportDocument,
  loadAdoption,
  type ReportProfile,
  renderReportComment,
  reportDataDigest,
  resolveProfile,
  UnrepresentableError,
} from "./report/index.ts";
import { EvidenceStore, NotFoundError } from "./store/index.ts";
import {
  assessVerifiers,
  extractGateRecord,
  parseTaskCheckLog,
  type SubjectBinding,
  toVerifierOutcome,
} from "./verifier/index.ts";

const E2E_LIMIT =
  "ADS v4.16 candidate 3041a1b used as isolated E2E test subject; not production adoption";

export interface CliDeps {
  client?: GitHubClient;
  now?: () => Date;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

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

const USAGE = `usage: collect --repo <owner/name> --issue <n> --headless <file>
               [--model-io <file> | --zcode-rollout-dir <dir>] [--run <file>]
               [--gate-log <file>[@<40hex>]]... [--gate-sha <40hex>] [--git-dir <dir>]
               --store <dir> --out <report.md>
               [--operator-id zcode] [--role builder] [--profile v4|v5] [--publish]
               [--ads-pin <sha>] [--clearance-ref <ref>] [--publisher-source-sha <40hex>]`;

class UsageError extends Error {}
class Failure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const SESSION_FILE_RE = /^[A-Za-z0-9_.-]+$/;

function optionsFrom(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      repo: { type: "string" },
      issue: { type: "string" },
      headless: { type: "string" },
      "model-io": { type: "string" },
      "zcode-rollout-dir": { type: "string" },
      run: { type: "string", multiple: true },
      "gate-log": { type: "string", multiple: true },
      "git-dir": { type: "string" },
      "gate-sha": { type: "string" },
      store: { type: "string" },
      out: { type: "string" },
      "operator-id": { type: "string" },
      role: { type: "string" },
      profile: { type: "string" },
      publish: { type: "boolean" },
      "ads-pin": { type: "string" },
      "clearance-ref": { type: "string" },
      "publisher-source-sha": { type: "string" },
    },
  });
  return { values, positionals };
}

interface GateSpec {
  file: string;
  sha: string | null;
}

function parseGateSpec(raw: string): GateSpec {
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    const tail = raw.slice(at + 1);
    if (SHA_RE.test(tail)) return { file: raw.slice(0, at), sha: tail };
  }
  return { file: raw, sha: null };
}

/** Subject = head_after of the finished segment whose end precedes the log mtime and the next start. */
function inferSubject(segs: RunRecord[], mtimeMs: number): string | null {
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

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function table(summary: AttemptSummary): string {
  const rows = summary.metrics.map(
    (m) =>
      `| ${m.name} | ${m.value === null ? "unknown" : `${m.value} ${m.unit}`} | ${m.epistemic} | ${m.coverage} |`,
  );
  return ["| metric | value | epistemic | coverage |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

function humanSummary(summary: AttemptSummary): string {
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

async function readText(path: string, what: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Failure(EXIT.FAILURE, `cannot read ${what} file`);
  }
}

async function run(argv: string[], deps: CliDeps, out: (s: string) => void): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const [command, ...rest] = argv;
  if (command !== "collect") throw new UsageError(`unknown or missing command: ${command ?? ""}`);

  let parsed: ReturnType<typeof optionsFrom>;
  try {
    parsed = optionsFrom(rest);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const v = parsed.values;
  if (parsed.positionals.length > 0) throw new UsageError("unexpected positional arguments");
  for (const k of ["repo", "issue", "headless", "store", "out"] as const) {
    if (v[k] === undefined) throw new UsageError(`missing --${k}`);
  }
  const repo = v.repo as string;
  if (!REPO_RE.test(repo)) throw new UsageError("--repo must be <owner/name>");
  if (!/^[1-9]\d*$/.test(v.issue as string)) throw new UsageError("--issue must be a number");
  const issue = Number(v.issue);
  const gateSpecs = (v["gate-log"] ?? []).map(parseGateSpec);
  if (v["gate-sha"] !== undefined) {
    if (gateSpecs.length !== 1 || gateSpecs[0]?.sha !== null) {
      throw new UsageError("--gate-sha pairs with exactly one --gate-log without @<sha>");
    }
    (gateSpecs[0] as GateSpec).sha = v["gate-sha"];
  }
  if (v["gate-sha"] !== undefined && !SHA_RE.test(v["gate-sha"])) {
    throw new UsageError("--gate-sha must be 40 lowercase hex characters");
  }
  if (v["model-io"] !== undefined && v["zcode-rollout-dir"] !== undefined) {
    throw new UsageError("--model-io and --zcode-rollout-dir are mutually exclusive");
  }
  if (v.profile !== undefined && v.profile !== "v4" && v.profile !== "v5") {
    throw new UsageError("--profile must be v4 or v5");
  }
  const resolution = resolveProfile({
    ...(v.profile !== undefined ? { profile: v.profile as ReportProfile } : {}),
    ...(v["ads-pin"] !== undefined ? { adsPin: v["ads-pin"] } : {}),
    publish: v.publish === true,
    repository: repo,
    adoption: loadAdoption(),
  });
  if (!resolution.ok) throw new UsageError(`${resolution.code}: ${resolution.message}`);
  const profile = resolution.profile;
  const publisherSha = v["publisher-source-sha"];
  if (profile === "v5" && (publisherSha === undefined || !SHA_RE.test(publisherSha))) {
    throw new UsageError("--profile v5 requires --publisher-source-sha <40 lowercase hex>");
  }

  const headless = await readText(v.headless as string, "headless");
  const input: ZcodeRunInput = {
    repository: repo,
    issue_number: issue,
    actor: {
      role: v.role ?? "builder",
      operator_kind: "agent",
      operator_id: v["operator-id"] ?? "zcode",
      session_ref: "",
      transport_actor: null,
    },
    observed_at: "",
    headless,
  };

  let modelIo: string | undefined;
  const sessionId = parseHeadlessResult(headless)?.sessionId ?? null;
  if (v["model-io"] !== undefined) {
    modelIo = await readText(v["model-io"], "model-io");
  } else if (v["zcode-rollout-dir"] !== undefined) {
    if (sessionId === null || !SESSION_FILE_RE.test(sessionId)) {
      throw new Failure(EXIT.FAILURE, "headless result has no usable sessionId");
    }
    try {
      modelIo = await readFile(join(v["zcode-rollout-dir"], `model-io-${sessionId}.jsonl`), "utf8");
    } catch {
      modelIo = undefined; // recorded as a limit by the adapter ("no model-io rollout")
    }
  }
  if (modelIo !== undefined) input.modelIo = modelIo;
  if (v.run !== undefined) {
    input.runRecords = [];
    for (const f of v.run) input.runRecords.push(await readText(f, "run record"));
  }
  const runTexts = input.runRecords ?? [];
  const attemptRef = sessionId ?? parseModelIo(modelIo ?? "").records[0]?.sessionId ?? null;
  if (attemptRef === null) {
    throw new Failure(EXIT.FAILURE, "no session id found in the supplied inputs");
  }
  input.actor.session_ref = attemptRef;

  const store = new EvidenceStore(resolve(v.store as string));
  // Re-collecting the same inputs must be byte-identical: reuse the first revision's clock.
  let existing: Awaited<ReturnType<EvidenceStore["readManifest"]>> | null = null;
  try {
    existing = await store.readManifest(attemptRef, 1);
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  const clock = existing ? existing.created_at : now().toISOString();
  input.observed_at = clock;

  let collection: ReturnType<typeof collectZcodeRun>;
  try {
    collection = collectZcodeRun(input);
  } catch (e) {
    throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
  }
  const { observations, summary, profile: capability } = collection;

  // ---- R2: verifier assessment, lineage, labels, aggregates ----
  const runs: RunRecord[] = runTexts.map((t) => parseRunRecord(t));
  const sorted = sortRunSegments(runs);
  const records: VerifierRecord[] = [];
  let inferredUsed = false;
  let unboundCount = 0;
  for (const spec of gateSpecs) {
    const text = await readText(spec.file, "gate log");
    const ref = `gate-log:${sha256Hex(text).slice(0, 12)}`;
    let subject: string | null = spec.sha;
    let binding: SubjectBinding = spec.sha !== null ? "OBSERVED" : "UNKNOWN";
    // A gate-recorded GATE_SUBJECT_SHA (written at run time) beats mtime inference.
    if (spec.sha === null && extractGateRecord(text).sha === null) {
      let mtimeMs: number | null = null;
      try {
        mtimeMs = (await stat(spec.file)).mtimeMs;
      } catch {
        mtimeMs = null;
      }
      subject = mtimeMs === null ? null : inferSubject(sorted, mtimeMs);
      if (subject !== null) {
        binding = "INFERRED";
        inferredUsed = true;
      } else unboundCount++;
    }
    records.push(parseTaskCheckLog(text, { ref, subject_sha: subject, subject_binding: binding }));
  }
  const assessment = assessVerifiers({
    records,
    attempt_source_sha: summary.source_sha,
    run_exit_codes: runs.map((r) => r.exit_code),
  });
  summary.verifier = toVerifierOutcome(assessment, summary.source_sha);

  const git: GitExec | undefined =
    v["git-dir"] !== undefined ? makeGitExec(resolve(v["git-dir"])) : undefined;
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
  if (resolution.mode === "E2E_TEST_SUBJECT") summary.limits.push(E2E_LIMIT);
  summary.limits.push(PUBLIC_GAP_LIMIT);
  summary.limits = [...new Set(summary.limits)];

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
  const ROLES = Object.keys(values) as (keyof typeof values)[];
  if (existing) {
    const same =
      existing.objects.length === ROLES.length &&
      ROLES.every(
        (role) =>
          existing.objects.find((o) => o.role === role)?.digest === canonicalDigest(values[role]),
      );
    if (!same) {
      throw new Failure(
        EXIT.REVISION_CONFLICT,
        "attempt already has a different revision 1; revisions/supersedes are not supported by the v0.1 CLI",
      );
    }
  }
  const objects = [];
  for (const role of ROLES) {
    objects.push({ role, digest: (await store.putObject(values[role])).digest });
  }
  const written = await store.writeManifest({
    attempt_ref: attemptRef,
    revision: 1,
    objects,
    predecessor: null,
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

  const clearance = v["clearance-ref"];
  if (profile === "v5" && (clearance === undefined || clearance === "")) {
    // No source-owner clearance: the evidence is stored but nothing is rendered for posting.
    out(
      `${JSON.stringify({
        outcome: "HELD",
        reason: "PUBLICATION_CLEARANCE_REQUIRED",
        attempt_ref: attemptRef,
        manifest: pointer,
        capture_coverage: summary.capture_coverage,
        outcome_class: assessment.outcome_class,
      })}
`,
    );
    return EXIT.HELD;
  }
  let doc: ReturnType<typeof buildReportDocument>;
  try {
    doc = buildReportDocument(summary, pointer, {
      profile,
      revision: 1,
      supersedes: null,
      ...(profile === "v5"
        ? {
            publisherSourceSha: publisherSha as string,
            publication: { clearance_ref: clearance as string },
            adsRevision: resolution.adsRevision,
          }
        : {}),
    });
  } catch (e) {
    if (e instanceof UnrepresentableError) {
      const hint = profile === "v4" ? " (try --profile v5)" : "";
      throw new Failure(EXIT.UNREPRESENTABLE, `report not representable: ${e.code}${hint}`);
    }
    throw new Failure(EXIT.FAILURE, `report build failed: ${(e as Error).message}`);
  }
  const body = renderReportComment(doc, { humanSummary: humanSummary(summary) });
  try {
    assertNoForbiddenContent(body.split("\n"));
  } catch (e) {
    throw new Failure(EXIT.PRIVACY, `privacy guard refused the report: ${(e as Error).message}`);
  }
  const outPath = resolve(v.out as string);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");

  const client = deps.client ?? new GhCliClient();
  const outcome = await publishReport(client, {
    repo,
    issue,
    body,
    publish: v.publish === true,
  });
  const line: Record<string, unknown> = {
    outcome: outcome.state,
    attempt_ref: attemptRef,
    manifest: pointer,
    data_digest: reportDataDigest(doc.data),
    capture_coverage: summary.capture_coverage,
    limits_count: summary.limits.length,
    outcome_class: assessment.outcome_class,
    versions: lineage.versions.length,
    transitions: countBy(lineage.transitions.map((t) => t.kind)),
    labels: countBy(labels.map((l) => l.kind)),
    profile,
    mode: v.publish === true ? "publish" : "dry-run",
  };
  if (outcome.state === "NOT_PUBLISHED") line.reason = outcome.reason;
  if (outcome.state === "CONFLICT") {
    line.existing_data_digest = outcome.existingDigest;
  }
  out(`${JSON.stringify(line)}\n`);
  return outcome.state === "CONFLICT" || outcome.state === "NOT_PUBLISHED"
    ? EXIT.NOT_PUBLISHED
    : EXIT.OK;
}

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  try {
    return await run(argv, deps, out);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`error: ${e.message}\n${USAGE}\n`);
      return EXIT.USAGE;
    }
    if (e instanceof Failure) {
      err(`error: ${e.message}\n`);
      return e.code;
    }
    err(`error: ${(e as Error).message}\n`);
    return EXIT.FAILURE;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
