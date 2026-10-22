import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectZcodeRun, type ZcodeRunInput } from "./adapters/zcode/index.ts";
import { parseHeadlessResult, parseModelIo } from "./adapters/zcode/parse.ts";
import { canonicalDigest } from "./canonical.ts";
import type { AttemptSummary, ManifestPointer } from "./model.ts";
import { assertNoForbiddenContent } from "./privacy.ts";
import { GhCliClient, type GitHubClient, publishReport } from "./publish/index.ts";
import {
  buildReportDocument,
  type ReportProfile,
  renderReportComment,
  reportDataDigest,
  UnrepresentableError,
} from "./report/index.ts";
import { EvidenceStore, NotFoundError } from "./store/index.ts";

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
} as const;

const USAGE = `usage: collect --repo <owner/name> --issue <n> --headless <file>
               [--model-io <file> | --zcode-rollout-dir <dir>] [--run <file>]
               [--gate-log <file> --gate-sha <40hex>] --store <dir> --out <report.md>
               [--operator-id zcode] [--role builder] [--profile v4|v5] [--publish]`;

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
      run: { type: "string" },
      "gate-log": { type: "string" },
      "gate-sha": { type: "string" },
      store: { type: "string" },
      out: { type: "string" },
      "operator-id": { type: "string" },
      role: { type: "string" },
      profile: { type: "string" },
      publish: { type: "boolean" },
    },
  });
  return { values, positionals };
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
  if ((v["gate-log"] === undefined) !== (v["gate-sha"] === undefined)) {
    throw new UsageError("--gate-log and --gate-sha must be given together");
  }
  if (v["gate-sha"] !== undefined && !SHA_RE.test(v["gate-sha"])) {
    throw new UsageError("--gate-sha must be 40 lowercase hex characters");
  }
  if (v["model-io"] !== undefined && v["zcode-rollout-dir"] !== undefined) {
    throw new UsageError("--model-io and --zcode-rollout-dir are mutually exclusive");
  }
  const profile = v.profile ?? "v4";
  if (profile !== "v4" && profile !== "v5") throw new UsageError("--profile must be v4 or v5");

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
  if (v.run !== undefined) input.runRecord = await readText(v.run, "run record");
  if (v["gate-log"] !== undefined) {
    input.gateLog = await readText(v["gate-log"], "gate log");
    input.gateSha = v["gate-sha"] as string;
  }

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

  try {
    assertNoForbiddenContent({ observations, summary, capability });
  } catch (e) {
    throw new Failure(EXIT.PRIVACY, `privacy guard refused the evidence: ${(e as Error).message}`);
  }

  const values = { observations, summary, capability };
  if (existing) {
    const same = (["observations", "summary", "capability"] as const).every(
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
  for (const role of ["observations", "summary", "capability"] as const) {
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

  let doc: ReturnType<typeof buildReportDocument>;
  try {
    doc = buildReportDocument(summary, pointer, {
      profile: profile as ReportProfile,
      revision: 1,
      supersedes: null,
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
