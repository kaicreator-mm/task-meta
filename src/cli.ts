import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { findClaudeTranscripts } from "./adapters/claude/find.ts";
import { collectClaudeRun } from "./adapters/claude/index.ts";
import { parseClaudeTranscript } from "./adapters/claude/parse.ts";
import { findCodexRollouts } from "./adapters/codex/find.ts";
import { collectCodexRun } from "./adapters/codex/index.ts";
import { parseCodexRollout } from "./adapters/codex/parse.ts";
import { collectZcodeRun, type ZcodeRunInput } from "./adapters/zcode/index.ts";
import {
  parseHeadlessResult,
  parseModelIo,
  parseRunRecord,
  type RunRecord,
} from "./adapters/zcode/parse.ts";
import { type AutoReportDeps, runAutoReportCommand } from "./autoreport/index.ts";
import {
  type AgentCollection,
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
import { DIAGNOSTIC_CATALOG, type DoctorInput, runDoctor } from "./doctor/index.ts";
import type { ManifestPointer } from "./model.ts";
import { assertNoForbiddenContent } from "./privacy.ts";
import type { PublicationPolicyProvider } from "./publish/authority.ts";
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
  /** DI seam for source-qualified grant fixtures; default is the shipped fail-closed policy. */
  publicationPolicy?: PublicationPolicyProvider;
}

const USAGE = `usage: collect --repo <owner/name> --issue <n> --headless <file>
               [--model-io <file> | --zcode-rollout-dir <dir>] [--zcode-hook-spool <dir>] [--run <file>]
               [--gate-log <file>[@<40hex>]]... [--gate-sha <40hex>] [--git-dir <dir>]
               --store <dir> --out <report.md>
               [--operator-id zcode] [--role builder] [--profile v4|v5] [--publish]
               [--ads-pin <sha>] [--e2e-test-only] [--clearance-ref <ref>] [--publisher-source-sha <40hex>]
       collect-codex --repo <owner/name> --issue <n>
               (--codex-session <rollout.jsonl>... | --codex-sessions-dir <dir> --session-id <id>)
               [--codex-hook-spool <dir>] [--gate-log <file>[@<40hex>]]... [--gate-sha <40hex>]
               [--git-dir <dir>] --store <dir> --out <report.md> [--operator-id codex]
               [--role builder] [--profile v4|v5] [--publish] [--ads-pin <sha>]
               [--clearance-ref <ref>] [--publisher-source-sha <40hex>]
       collect-claude --repo <owner/name> --issue <n>
               (--claude-transcript <session.jsonl>... | --claude-projects-dir <dir> --session-id <id>)
               [--claude-hook-spool <dir>] [--gate-log <file>[@<40hex>]]... [--gate-sha <40hex>]
               [--git-dir <dir>] --store <dir> --out <report.md> [--operator-id claude]
               [--role builder] [--profile v4|v5] [--publish] [--ads-pin <sha>]
               [--clearance-ref <ref>] [--publisher-source-sha <40hex>]
       auto-report --agent zcode|claude|codex --session <id> [--trigger stop|session-end]
               [--spool-dir <dir>] [--rollout-dir <dir>] [--projects-dir <dir>]
               [--store <dir>] [--outbox <dir>] [--config <file>] [--dry-run]
       auto-report --retry [--config <file>] [--outbox <dir>] [--dry-run]
       doctor --catalog | --input <preclassified-evidence.json> (read-only; no live scan)`;

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
      "codex-session": { type: "string", multiple: true },
      "codex-sessions-dir": { type: "string" },
      "codex-hook-spool": { type: "string" },
      "claude-transcript": { type: "string", multiple: true },
      "claude-projects-dir": { type: "string" },
      "claude-hook-spool": { type: "string" },
      "session-id": { type: "string" },
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
      "e2e-test-only": { type: "boolean" },
      "clearance-ref": { type: "string" },
      "publisher-source-sha": { type: "string" },
    },
  });
  return { values, positionals };
}

/**
 * v0.4 I: a read-only CLI adapter to A1's single canonical Doctor catalog.
 * Input is explicitly preclassified evidence, NEVER a claim that a live repo,
 * Agent CLI, Hook or credential store was scanned. All user-supplied identifiers
 * are replaced with bounded opaque references before calling runDoctor.
 */
async function runDoctorCli(rest: string[], out: (s: string) => void): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: {
        catalog: { type: "boolean" },
        input: { type: "string" },
      },
    });
  } catch {
    throw new UsageError("doctor accepts exactly --catalog or --input <file>");
  }
  const catalog = args.values.catalog === true;
  const path = args.values.input;
  if (catalog === (path !== undefined)) {
    throw new UsageError("doctor requires exactly one of --catalog or --input <file>");
  }
  if (catalog) {
    out(
      `${JSON.stringify({
        mode: "CATALOG_ONLY",
        evidence: "NOT_RUN",
        catalog: DIAGNOSTIC_CATALOG,
        network_used: false,
        writes_performed: [],
        repairs_performed: [],
      })}\n`,
    );
    return EXIT.OK;
  }

  let parsed: unknown;
  try {
    const file = resolve(path as string);
    if ((await stat(file)).size > 256 * 1024) throw new Error("oversized");
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // Do not echo paths, source text or JSON parser snippets.
    throw new UsageError("doctor input unreadable, oversized or invalid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("doctor input must be a preclassified evidence object");
  }
  const record = parsed as Record<string, unknown>;
  const fields = [
    "spool",
    "hook_errors",
    "paths",
    "credentials",
    "clients",
    "publication_statuses",
    "post_effects",
  ] as const;
  if (Object.keys(record).some((key) => !fields.includes(key as (typeof fields)[number]))) {
    throw new UsageError("doctor input contains unsupported fields");
  }
  const list = (field: (typeof fields)[number]): unknown[] => {
    const v = record[field];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 200) {
      throw new UsageError("doctor input requires bounded evidence arrays");
    }
    return v as unknown[];
  };
  const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      throw new UsageError("doctor evidence item has invalid shape");
    }
    const item = v as Record<string, unknown>;
    if (Object.keys(item).some((key) => !keys.includes(key))) {
      throw new UsageError("doctor evidence item contains unsupported fields");
    }
    if (keys.some((key) => !Object.hasOwn(item, key))) {
      throw new UsageError("doctor evidence item is missing required fields");
    }
    return item;
  };
  const boolean = (v: unknown): boolean => {
    if (typeof v !== "boolean") throw new UsageError("doctor requires typed evidence");
    return v;
  };
  const string = (v: unknown): string => {
    if (typeof v !== "string") throw new UsageError("doctor requires typed evidence");
    return v;
  };
  const statuses = new Set([
    "PENDING",
    "IN_FLIGHT",
    "PUBLISHED",
    "ALREADY_PUBLISHED",
    "DENIED",
    "CONFLICT",
    "HELD",
    "UNKNOWN",
    "JOURNAL_INCOMPLETE",
    "FAILED_PROVEN_PRE_SEND",
  ]);
  const effects = new Set([
    "PROVEN_NOT_SENT",
    "REMOTE_SAME",
    "REMOTE_DIFFERENT_OR_DAMAGED",
    "SENT_OR_MAY_HAVE_SENT",
  ]);
  const input: DoctorInput = {
    repo_root: "repo:redacted",
    spool: list("spool").map((v, i) => {
      const e = object(v, ["path", "parse_ok"]);
      string(e.path);
      return { path: `spool:${i + 1}`, parse_ok: boolean(e.parse_ok) };
    }),
    hook_errors: list("hook_errors").map((v) => {
      const e = object(v, ["source", "error_class"]);
      if (e.error_class !== null && typeof e.error_class !== "string") {
        throw new UsageError("doctor requires typed evidence");
      }
      if (e.source !== "TRUSTED_WITNESS" && e.source !== "RAW_LOG") {
        throw new UsageError("doctor hook source must be typed");
      }
      // A JSON assertion of TRUSTED_WITNESS is not source-backed authority.
      // No externally supplied class token may be reflected into a diagnostic.
      return { source: "RAW_LOG" as const, error_class: null };
    }),
    paths: list("paths").map((v, i) => {
      const e = object(v, ["path", "is_symlink", "target_inside_repo"]);
      string(e.path);
      const inside = e.target_inside_repo;
      if (inside !== null && inside !== true && inside !== false) {
        throw new UsageError("doctor path evidence must be typed");
      }
      return {
        path: `path:${i + 1}`,
        is_symlink: boolean(e.is_symlink),
        target_inside_repo: inside,
      };
    }),
    credentials: list("credentials").map((v, i) => {
      const e = object(v, ["name", "looks_like_secret"]);
      string(e.name);
      return { name: `credential:${i + 1}`, looks_like_secret: boolean(e.looks_like_secret) };
    }),
    clients: list("clients").map((v) => {
      const e = object(v, ["client", "help_output_available"]);
      const client = string(e.client);
      return {
        client: ["codex", "claude", "zcode"].includes(client) ? client : "unsupported",
        help_output_available: boolean(e.help_output_available),
      };
    }),
    publication_statuses: list("publication_statuses").map((v, i) => {
      const e = object(v, ["status", "target_ref"]);
      string(e.target_ref);
      if (!statuses.has(e.status as string)) throw new UsageError("doctor status unknown");
      return {
        status: e.status as DoctorInput["publication_statuses"][number]["status"],
        target_ref: `publication:${i + 1}`,
      };
    }),
    post_effects: list("post_effects").map((v, i) => {
      const e = object(v, ["effect", "target_ref"]);
      string(e.target_ref);
      if (!effects.has(e.effect as string)) throw new UsageError("doctor effect unknown");
      return {
        effect: e.effect as DoctorInput["post_effects"][number]["effect"],
        target_ref: `effect:${i + 1}`,
      };
    }),
  };
  const report = runDoctor(input);
  out(
    `${JSON.stringify({
      mode: "PRECLASSIFIED_EVIDENCE_ONLY",
      evidence: "SOURCE_ONLY",
      missing_fields: fields.filter((field) => record[field] === undefined),
      limits: ["No live repo/Host/Agent scan performed", "Missing evidence is not a PASS"],
      ...report,
    })}\n`,
  );
  return EXIT.OK;
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
  if (command === "doctor") return runDoctorCli(rest, out);
  if (command === "auto-report") return runAutoReportCommand(rest, deps, out);
  if (command !== "collect" && command !== "collect-codex" && command !== "collect-claude") {
    throw new UsageError(`unknown or missing command: ${command ?? ""}`);
  }
  const isCodex = command === "collect-codex";
  const isClaude = command === "collect-claude";

  let parsed: ReturnType<typeof optionsFrom>;
  try {
    parsed = optionsFrom(rest);
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const v = parsed.values;
  if (parsed.positionals.length > 0) throw new UsageError("unexpected positional arguments");
  for (const k of [
    "repo",
    "issue",
    "store",
    "out",
    ...(isCodex || isClaude ? [] : ["headless" as const]),
  ] as const) {
    if (v[k] === undefined) throw new UsageError(`missing --${k}`);
  }
  const ZCODE_ONLY = [
    "headless",
    "model-io",
    "zcode-rollout-dir",
    "zcode-hook-spool",
    "run",
  ] as const;
  const CODEX_ONLY = ["codex-session", "codex-sessions-dir", "codex-hook-spool"] as const;
  const CLAUDE_ONLY = ["claude-transcript", "claude-projects-dir", "claude-hook-spool"] as const;
  if (isCodex || isClaude) {
    for (const k of ZCODE_ONLY) {
      if (v[k] !== undefined) throw new UsageError(`--${k} is not valid with ${command}`);
    }
    for (const k of isCodex ? CLAUDE_ONLY : CODEX_ONLY) {
      if (v[k] !== undefined) throw new UsageError(`--${k} is not valid with ${command}`);
    }
  } else {
    for (const k of [...CODEX_ONLY, ...CLAUDE_ONLY, "session-id" as const]) {
      if (v[k] !== undefined)
        throw new UsageError(`--${k} is only valid with collect-codex/collect-claude`);
    }
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
  if (v["e2e-test-only"] === true && (v.profile !== "v5" || v["ads-pin"] === undefined)) {
    throw new UsageError(
      "--e2e-test-only requires explicit --profile v5 and --ads-pin; test repositories only",
    );
  }
  const resolution = resolveProfile({
    ...(v.profile !== undefined ? { profile: v.profile as ReportProfile } : {}),
    ...(v["ads-pin"] !== undefined ? { adsPin: v["ads-pin"] } : {}),
    publish: v.publish === true,
    e2eTestOnly: v["e2e-test-only"] === true,
    repository: repo,
    adoption: loadAdoption(),
  });
  if (!resolution.ok) throw new UsageError(`${resolution.code}: ${resolution.message}`);
  const profile = resolution.profile;
  const publisherSha = v["publisher-source-sha"];
  if (profile === "v5" && (publisherSha === undefined || !SHA_RE.test(publisherSha))) {
    throw new UsageError("--profile v5 requires --publisher-source-sha <40 lowercase hex>");
  }

  const extraLimits: string[] = [];
  let runTexts: string[] = [];
  let attemptRef: string;
  let codexRun: RunRecord | null = null;
  let collect: (clock: string) => AgentCollection;
  if (isClaude) {
    let texts: string[];
    const files = v["claude-transcript"];
    if (files !== undefined && files.length > 0) {
      if (v["claude-projects-dir"] !== undefined || v["session-id"] !== undefined) {
        throw new UsageError("--claude-transcript excludes --claude-projects-dir/--session-id");
      }
      texts = [];
      for (const f of files) texts.push(await readText(f, "claude transcript"));
    } else if (v["claude-projects-dir"] !== undefined && v["session-id"] !== undefined) {
      if (!SESSION_FILE_RE.test(v["session-id"]))
        throw new UsageError("--session-id is not a valid id");
      const found = await findClaudeTranscripts(resolve(v["claude-projects-dir"]), v["session-id"]);
      if (found.main.length === 0)
        throw new Failure(EXIT.FAILURE, "no transcript file found for the session id");
      texts = [];
      for (const f of [...found.main, ...found.subagents])
        texts.push(await readText(f, "claude transcript"));
    } else {
      throw new UsageError(
        "collect-claude needs --claude-transcript <file> or --claude-projects-dir <dir> --session-id <id>",
      );
    }
    const sid =
      texts.map((t) => parseClaudeTranscript(t).sessionId).find((x) => x !== null) ?? null;
    if (sid === null) throw new Failure(EXIT.FAILURE, "no session id found in the supplied inputs");
    attemptRef = sid;
    const actor = {
      role: v.role ?? "builder",
      operator_kind: "agent",
      operator_id: v["operator-id"] ?? "claude",
      session_ref: sid,
      transport_actor: null,
    };
    let hookSpool: string | undefined;
    if (v["claude-hook-spool"] !== undefined) {
      try {
        const file = `${sid.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`;
        hookSpool = await readFile(join(v["claude-hook-spool"], file), "utf8");
      } catch {
        extraLimits.push(
          "no hook spool for this session (capture plugin not enabled or no events)",
        );
      }
    }
    collect = (clock) => {
      try {
        const c = collectClaudeRun({
          repository: repo,
          issue_number: issue,
          actor,
          observed_at: clock,
          transcript: texts,
          ...(hookSpool !== undefined ? { hookSpool } : {}),
        });
        codexRun = c.run;
        return c;
      } catch (e) {
        throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
      }
    };
  } else if (isCodex) {
    let texts: string[];
    const files = v["codex-session"];
    if (files !== undefined && files.length > 0) {
      if (v["codex-sessions-dir"] !== undefined || v["session-id"] !== undefined) {
        throw new UsageError("--codex-session excludes --codex-sessions-dir/--session-id");
      }
      texts = [];
      for (const f of files) texts.push(await readText(f, "codex session"));
    } else if (v["codex-sessions-dir"] !== undefined && v["session-id"] !== undefined) {
      if (!SESSION_FILE_RE.test(v["session-id"]))
        throw new UsageError("--session-id is not a valid id");
      const found = await findCodexRollouts(resolve(v["codex-sessions-dir"]), v["session-id"]);
      if (found.length === 0)
        throw new Failure(EXIT.FAILURE, "no rollout file found for the session id");
      texts = [];
      for (const f of found) texts.push(await readText(f, "codex session"));
    } else {
      throw new UsageError(
        "collect-codex needs --codex-session <file> or --codex-sessions-dir <dir> --session-id <id>",
      );
    }
    const sid =
      texts.map((t) => parseCodexRollout(t).session?.id ?? null).find((x) => x !== null) ?? null;
    if (sid === null) throw new Failure(EXIT.FAILURE, "no session id found in the supplied inputs");
    attemptRef = sid;
    const actor = {
      role: v.role ?? "builder",
      operator_kind: "agent",
      operator_id: v["operator-id"] ?? "codex",
      session_ref: sid,
      transport_actor: null,
    };
    let hookSpool: string | undefined;
    if (v["codex-hook-spool"] !== undefined) {
      try {
        const file = `${sid.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`;
        hookSpool = await readFile(join(v["codex-hook-spool"], file), "utf8");
      } catch {
        extraLimits.push(
          "no hook spool for this session (capture plugin not enabled or no events)",
        );
      }
    }
    collect = (clock) => {
      try {
        const c = collectCodexRun({
          repository: repo,
          issue_number: issue,
          actor,
          observed_at: clock,
          rollout: texts,
          ...(hookSpool !== undefined ? { hookSpool } : {}),
        });
        codexRun = c.run;
        return c;
      } catch (e) {
        throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
      }
    };
  } else {
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
        modelIo = await readFile(
          join(v["zcode-rollout-dir"], `model-io-${sessionId}.jsonl`),
          "utf8",
        );
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
        extraLimits.push(
          "no hook spool for this session (capture plugin not enabled or no events)",
        );
      }
    }
    if (v.run !== undefined) {
      input.runRecords = [];
      for (const f of v.run) input.runRecords.push(await readText(f, "run record"));
    }
    runTexts = input.runRecords ?? [];
    const ref = sessionId ?? parseModelIo(modelIo ?? "").records[0]?.sessionId ?? null;
    if (ref === null) {
      throw new Failure(EXIT.FAILURE, "no session id found in the supplied inputs");
    }
    attemptRef = ref;
    input.actor.session_ref = ref;
    collect = (clock) => {
      input.observed_at = clock;
      try {
        return collectZcodeRun(input);
      } catch (e) {
        throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
      }
    };
  }

  const store = new EvidenceStore(resolve(v.store as string));
  // Re-collecting the same inputs must be byte-identical: reuse the first revision's clock.
  const existing = await readManifestOrNull(store, attemptRef, 1);
  const clock = existing ? existing.created_at : now().toISOString();

  const collection = collect(clock);
  const runs: RunRecord[] =
    isCodex || isClaude ? (codexRun ? [codexRun] : []) : runTexts.map((t) => parseRunRecord(t));
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
    collection,
    attemptRef,
    runs,
    segmentPrefix: isClaude ? "claude:transcript" : isCodex ? "codex:rollout" : "zcode:run-record",
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
    e2eTestOnly: v["e2e-test-only"] === true,
    ...(deps.publicationPolicy ? { publicationPolicy: deps.publicationPolicy } : {}),
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
