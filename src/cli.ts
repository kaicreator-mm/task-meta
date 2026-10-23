import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ZcodeRunInput } from "./adapters/zcode/index.ts";
import { parseHeadlessResult, parseModelIo } from "./adapters/zcode/parse.ts";
import { type AutoReportDeps, runAutoReportCommand } from "./autoreport/index.ts";
import {
  buildEvidence,
  countBy,
  EXIT,
  Failure,
  type GateInput,
  humanSummary,
  manifestMatches,
  persistRevision,
  readManifestOrNull,
} from "./collect-core.ts";
import type { ManifestPointer } from "./model.ts";
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
import { EvidenceStore } from "./store/index.ts";

export { EXIT } from "./collect-core.ts";

export interface CliDeps {
  /** auto-report overrides (tests): sleep, env, inventory, adoption, settle wait. */
  autoReport?: Partial<AutoReportDeps>;
  client?: GitHubClient;
  now?: () => Date;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

const USAGE = `usage: collect --repo <owner/name> --issue <n> --headless <file>
               [--model-io <file> | --zcode-rollout-dir <dir>] [--zcode-hook-spool <dir>] [--run <file>]
               [--gate-log <file>[@<40hex>]]... [--gate-sha <40hex>] [--git-dir <dir>]
               --store <dir> --out <report.md>
               [--operator-id zcode] [--role builder] [--profile v4|v5] [--publish]
               [--ads-pin <sha>] [--clearance-ref <ref>] [--publisher-source-sha <40hex>]
       auto-report --agent zcode --session <id> [--spool-dir <dir>] [--rollout-dir <dir>]
               [--store <dir>] [--outbox <dir>] [--config <file>] [--dry-run]
       auto-report --retry [--config <file>] [--outbox <dir>] [--dry-run]`;

class UsageError extends Error {}
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
      "zcode-hook-spool": { type: "string" },
      "verifier-scope": { type: "string" },
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
  if (command === "auto-report") return runAutoReportCommand(rest, deps, out);
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

  const extraLimits: string[] = [];
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
  if (v["zcode-hook-spool"] !== undefined) {
    if (sessionId === null || !SESSION_FILE_RE.test(sessionId)) {
      throw new Failure(EXIT.FAILURE, "headless result has no usable sessionId");
    }
    try {
      // The capture plugin sanitizes session ids to [A-Za-z0-9_-] for the file name.
      const file = `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`;
      input.hookSpool = await readFile(join(v["zcode-hook-spool"], file), "utf8");
    } catch {
      extraLimits.push("no hook spool for this session (capture plugin not enabled or no events)");
    }
  }
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
  const existing = await readManifestOrNull(store, attemptRef, 1);
  const clock = existing ? existing.created_at : now().toISOString();
  input.observed_at = clock;

  const gates: GateInput[] = [];
  for (const spec of gateSpecs) {
    const text = await readText(spec.file, "gate log");
    let mtimeMs: number | null = null;
    if (spec.sha === null) {
      try {
        mtimeMs = (await stat(spec.file)).mtimeMs;
      } catch {
        mtimeMs = null;
      }
    }
    gates.push({ text, sha: spec.sha, mtimeMs });
  }
  // Required verifier scope is declared by the operator (e.g. a repo whose gate only runs tests);
  // default is the full task-check scope.
  const requiredScope = v["verifier-scope"]
    ?.split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => (s.startsWith("task-check:") ? s : `task-check:${s}`));
  const evidence = await buildEvidence({
    input,
    runTexts,
    gates,
    requiredScope,
    gitDir: v["git-dir"] !== undefined ? resolve(v["git-dir"]) : undefined,
    extraLimits,
    mode: resolution.mode,
  });
  const { summary, assessment, lineage, labels } = evidence;
  if (existing && !manifestMatches(existing, evidence)) {
    throw new Failure(
      EXIT.REVISION_CONFLICT,
      "attempt already has a different revision 1; revisions/supersedes are not supported by the v0.1 CLI",
    );
  }
  const pointer: ManifestPointer = await persistRevision(store, evidence, 1, null, clock);

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
