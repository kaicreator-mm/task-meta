// auto-report: bind a finished agent session to repository + Issue, collect, publish one ADS
// report, read it back. Never throws; every outcome lands in the outbox (docs/v0.2 section 4).
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findCodexRollouts } from "../adapters/codex/find.ts";
import { parseCodexHookSpool } from "../adapters/codex/hooks.ts";
import { collectCodexRun } from "../adapters/codex/index.ts";
import {
  type BindingSpoolEntry,
  bindingInputFromSpool,
  parseHookSpool,
} from "../adapters/zcode/hooks.ts";
import { collectZcodeRun, type ZcodeRunInput } from "../adapters/zcode/index.ts";
import type { RunRecord } from "../adapters/zcode/parse.ts";
import { loadRepoInventory, resolveBinding } from "../binding/index.ts";
import type { RepoInventory } from "../binding/types.ts";
import { canonicalDigest } from "../canonical.ts";
import {
  type AgentCollection,
  buildEvidence,
  type Evidence,
  EXIT,
  Failure,
  humanSummary,
  manifestMatches,
  persistRevision,
  readManifestOrNull,
} from "../collect-core.ts";
import type { ManifestPointer, TaskBinding } from "../model.ts";
import { assertNoForbiddenContent } from "../privacy.ts";
import { findReports, publishReport } from "../publish/index.ts";
import {
  type Adoption,
  buildReportDocument,
  loadAdoption,
  parseReportComment,
  renderReportComment,
  reportDataDigest,
  resolveProfile,
  type SupersedesRef,
  UnrepresentableError,
} from "../report/index.ts";
import { EvidenceStore } from "../store/index.ts";
import { type AutoReportConfig, loadAutoReportConfig, resolvePublisherSha } from "./config.ts";
import { findConventionGateLogs } from "./gates.ts";
import { type AutoReportGitHub, GhAutoReportClient } from "./github.ts";
import { Outbox, type OutboxEntry, type OutboxState, safeName } from "./outbox.ts";
import { findWritebackComments } from "./writeback.ts";

export interface AutoReportOptions {
  agent: string;
  session: string;
  spoolDir?: string | undefined;
  rolloutDir?: string | undefined;
  store?: string | undefined;
  outbox?: string | undefined;
  configPath?: string | undefined;
  dryRun?: boolean | undefined;
}

export interface AutoReportDeps {
  client?: AutoReportGitHub;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  inventory?: RepoInventory;
  adoption?: Adoption;
  /** Settle wait for the Stop entry (default 5000 ms in 200 ms steps). */
  settleMs?: number;
}

const SESSION_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,199}$/;
const SESSION_FILE_RE = /^[A-Za-z0-9_.-]+$/;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Replace absolute paths and bound the length: outbox reasons never carry local paths. */
function scrub(msg: string): string {
  return msg
    .replace(/[A-Za-z]:[\\/][^\s"')]*/g, "<path>")
    .replace(/(^|[\s"'(])\/[^\s"')]*/g, "$1<path>")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/** Bounded, path-free failure description. */
function safeReason(e: unknown): string {
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  const code = typeof err?.code === "string" ? err.code : "";
  const name = typeof err?.name === "string" ? err.name : "Error";
  const msg = typeof err?.message === "string" ? err.message : "";
  return `${name}${code ? ` ${code}` : ""}: ${scrub(msg)}`.trim();
}

class Held extends Error {
  readonly reasons: string[];
  readonly binding: TaskBinding | null;
  constructor(reasons: string[], binding: TaskBinding | null = null) {
    super(reasons.join("; "));
    this.reasons = reasons;
    this.binding = binding;
  }
}

interface SpoolView {
  session_id: string;
  event: string;
  /** Hook timestamp (zcode `hook_ts`, codex `received_at`). */
  ts: string | null;
}

type SpoolEntries = (BindingSpoolEntry & { session_id: string })[];

async function readSettled(
  file: string,
  session: string,
  parse: (text: string) => { entries: SpoolView[] },
  sleep: (ms: number) => Promise<void>,
  settleMs: number,
): Promise<{ text: string; stopSeen: boolean }> {
  const steps = Math.max(0, Math.floor(settleMs / 200));
  let text = "";
  for (let i = 0; ; i++) {
    try {
      text = await readFile(file, "utf8");
    } catch {
      text = "";
    }
    const stop = parse(text).entries.some((e) => e.session_id === session && e.event === "Stop");
    if (stop) return { text, stopSeen: true };
    if (i >= steps) return { text, stopSeen: false };
    await sleep(200);
  }
}

function windowOf(mine: SpoolView[]): { start: string; stop: string } | null {
  const ts = (e: SpoolView): number => (e.ts ? Date.parse(e.ts) : Number.NaN);
  const starts = mine.filter((e) => e.event === "SessionStart").map(ts);
  const stops = mine.filter((e) => e.event === "Stop").map(ts);
  const all = mine.map(ts).filter((t) => !Number.isNaN(t));
  const s = starts.filter((t) => !Number.isNaN(t));
  const e = stops.filter((t) => !Number.isNaN(t));
  const start = s.length > 0 ? Math.min(...s) : all.length > 0 ? Math.min(...all) : Number.NaN;
  const stop = e.length > 0 ? Math.max(...e) : all.length > 0 ? Math.max(...all) : Number.NaN;
  if (Number.isNaN(start) || Number.isNaN(stop)) return null;
  return { start: new Date(start).toISOString(), stop: new Date(stop).toISOString() };
}

interface OwnReport {
  revision: number;
  dataDigest: string;
  commentId: number;
  htmlUrl: string;
  supersedes: unknown;
}

async function ownReports(
  client: AutoReportGitHub,
  repo: string,
  issue: number,
  reportId: string,
  namespace: string,
): Promise<OwnReport[]> {
  const found = await findReports(client, repo, issue);
  const out: OwnReport[] = [];
  for (const e of found.entries) {
    const p = parseReportComment(e.comment.body);
    if (!p.ok) continue;
    const d = p.doc.data as Record<string, unknown>;
    if (d.report_id !== reportId || d.publisher_namespace !== namespace) continue;
    if (d.report_kind !== "EXECUTION_SUMMARY" || typeof d.revision !== "number") continue;
    out.push({
      revision: d.revision,
      dataDigest: e.dataDigest,
      commentId: e.comment.id,
      htmlUrl: e.comment.html_url,
      supersedes: d.supersedes,
    });
  }
  return out.sort((a, b) => a.revision - b.revision);
}

const commentRef = (repo: string, issue: number, id: number): string =>
  `https://github.com/${repo}/issues/${issue}#issuecomment-${id}`;

function asSupersedes(v: unknown): SupersedesRef | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.revision === "number" &&
    typeof o.data_digest === "string" &&
    typeof o.comment_ref === "string"
  ) {
    return { revision: o.revision, data_digest: o.data_digest, comment_ref: o.comment_ref };
  }
  return null;
}

async function drive(
  opts: AutoReportOptions,
  cfg: AutoReportConfig,
  deps: AutoReportDeps,
  now: () => Date,
): Promise<Omit<OutboxEntry, "session" | "agent" | "at">> {
  const sleep = deps.sleep ?? realSleep;
  const dry = opts.dryRun === true;
  const session = opts.session;
  const isCodex = opts.agent === "codex";
  const spoolDir = resolve(opts.spoolDir ?? (isCodex ? cfg.codex.spool_dir : cfg.zcode.spool_dir));
  const rolloutDir = resolve(
    opts.rolloutDir ?? (isCodex ? cfg.codex.sessions_dir : cfg.zcode.rollout_dir),
  );
  const parseSpool = (text: string): { entries: SpoolView[]; all: SpoolEntries } => {
    if (isCodex) {
      const e = parseCodexHookSpool(text).entries;
      return {
        entries: e.map((x) => ({ session_id: x.session_id, event: x.event, ts: x.received_at })),
        all: e,
      };
    }
    const e = parseHookSpool(text).entries;
    return {
      entries: e.map((x) => ({ session_id: x.session_id, event: x.event, ts: x.hook_ts ?? null })),
      all: e,
    };
  };

  // ---- spool (wait for the Stop line that was appended just before the spawn) ----
  const { text: spoolText, stopSeen } = await readSettled(
    join(spoolDir, `${safeName(session)}.jsonl`),
    session,
    parseSpool,
    sleep,
    deps.settleMs ?? 5000,
  );
  const parsed = parseSpool(spoolText);
  const mine = parsed.all.filter((e) => e.session_id === session);
  const mineView = parsed.entries.filter((e) => e.session_id === session);
  if (mine.length === 0) throw new Held(["no hook spool entries for this session"]);
  const limits: string[] = [];
  if (!stopSeen) limits.push("hook spool had no Stop entry after waiting; collected what existed");

  // ---- binding ----
  const inv = deps.inventory ?? loadRepoInventory();
  let binding = resolveBinding({
    ...bindingInputFromSpool(mine),
    knownRepos: inv.repos,
    aliases: inv.aliases,
    owner: inv.owner,
  });
  const client = deps.client ?? new GhAutoReportClient();
  if (
    binding.state === "UNRESOLVED" &&
    binding.repository !== null &&
    binding.pr_number !== null &&
    binding.issue_number === null
  ) {
    const linked = await client.linkedIssuesOfPr(binding.repository, binding.pr_number);
    if (linked.length === 1) {
      const n = linked[0] as number;
      binding = {
        ...binding,
        issue_number: n,
        state: "RESOLVED",
        evidence: [
          ...binding.evidence,
          { kind: "PROMPT_REF", value: `${binding.repository}#${n}`, epistemic: "OBSERVED" },
        ],
        reasons: [...binding.reasons.filter((r) => !r.startsWith("pr-only")), "pr-linked-issue"],
      };
    } else {
      throw new Held(
        [
          ...binding.reasons,
          linked.length === 0
            ? "pr-linked-issue: PR has no linked Issue"
            : `pr-linked-issue: PR links several Issues (${linked.length})`,
        ],
        binding,
      );
    }
  }
  if (
    binding.state !== "RESOLVED" ||
    binding.repository === null ||
    binding.issue_number === null
  ) {
    throw new Held(
      binding.reasons.length > 0 ? binding.reasons : [`binding ${binding.state}`],
      binding,
    );
  }
  const repo = binding.repository;
  const issue = binding.issue_number;

  // ---- profile ----
  const resolution = resolveProfile({
    publish: !dry,
    repository: repo,
    adoption: deps.adoption ?? loadAdoption(),
  });
  if (!resolution.ok) throw new Held([`${resolution.code}`], binding);
  const profile = resolution.profile;
  let publisherSha: string | undefined;
  if (profile === "v5") {
    if (cfg.clearance_ref === "") throw new Held(["PUBLICATION_CLEARANCE_REQUIRED"], binding);
    const sha = await resolvePublisherSha(cfg);
    if (sha === null) throw new Held(["publisher_source_sha unavailable or malformed"], binding);
    publisherSha = sha;
  }

  // ---- artifacts: model-io rollout, convention gate logs, write-back citation ----
  let modelIo: string | undefined;
  const codexRollouts: string[] = [];
  if (isCodex) {
    if (!SESSION_FILE_RE.test(session)) throw new Held(["invalid session id"], binding);
    for (const f of await findCodexRollouts(rolloutDir, session)) {
      try {
        codexRollouts.push(await readFile(f, "utf8"));
      } catch {
        // unreadable rollout file: treated like a missing one below
      }
    }
    if (codexRollouts.length === 0)
      throw new Held(["no rollout file found for the session"], binding);
  } else if (SESSION_FILE_RE.test(session)) {
    try {
      modelIo = await readFile(join(rolloutDir, `model-io-${session}.jsonl`), "utf8");
    } catch {
      modelIo = undefined;
    }
  }
  const sources = bindingInputFromSpool(mine);
  const gates = await findConventionGateLogs(cfg.gate_log_root, sources.worktreeRefs, inv);

  const wb: number[] = [];
  const extraSummaryLimits: string[] = [];
  const win = windowOf(mineView);
  if (win === null) {
    extraSummaryLimits.push("no hook timestamps; agent write-back comments not cited");
  } else {
    try {
      wb.push(...(await findWritebackComments(client, repo, issue, win.start, win.stop)));
    } catch {
      extraSummaryLimits.push("agent write-back comments unavailable (readback failed)");
    }
  }
  if (wb.length > 0) extraSummaryLimits.push(`agent write-back comments cited: ${wb.length}`);

  const actor = {
    role: "builder",
    operator_kind: "agent",
    operator_id: isCodex ? "codex" : "zcode",
    session_ref: session,
    transport_actor: null,
  };
  const baseInput = (observed: string): ZcodeRunInput => ({
    repository: repo,
    issue_number: issue,
    actor,
    observed_at: observed,
    hookSpool: spoolText,
    sessionId: session,
    ...(modelIo !== undefined ? { modelIo } : {}),
  });
  const collectAgent = (observed: string): { collection: AgentCollection; runs: RunRecord[] } => {
    try {
      if (!isCodex) return { collection: collectZcodeRun(baseInput(observed)), runs: [] };
      const c = collectCodexRun({
        repository: repo,
        issue_number: issue,
        actor,
        observed_at: observed,
        rollout: codexRollouts,
        hookSpool: spoolText,
      });
      if (c.sessionId !== session) throw new Error("rollout session id differs from the spool's");
      return { collection: c, runs: [c.run] };
    } catch (e) {
      throw new Failure(EXIT.FAILURE, `collection failed: ${(e as Error).message}`);
    }
  };
  const build = (observed: string): Promise<Evidence> => {
    const { collection, runs } = collectAgent(observed);
    return buildEvidence({
      collection,
      attemptRef: session,
      runs,
      segmentPrefix: isCodex ? "codex:rollout" : "zcode:run-record",
      gates,
      extraLimits: limits,
      mode: resolution.mode,
      extraObservationRefs: wb.map((id) => `github:comment:${id}`),
      extraSummaryLimits,
    });
  };

  // ---- revision: reuse the stored one when the data is unchanged, else the next ----
  const store = new EvidenceStore(resolve(opts.store ?? cfg.store));
  const latest = await readManifestOrNull(store, session);
  let ev: Evidence;
  let revision: number;
  let clock: string;
  let predecessor: string | null;
  if (latest) {
    ev = await build(latest.created_at);
    if (manifestMatches(latest, ev)) {
      revision = latest.revision;
      clock = latest.created_at;
      predecessor = latest.predecessor;
    } else {
      clock = now().toISOString();
      ev = await build(clock);
      revision = latest.revision + 1;
      predecessor = canonicalDigest(latest);
    }
  } else {
    clock = now().toISOString();
    ev = await build(clock);
    revision = 1;
    predecessor = null;
  }

  const reportId = `task-meta:${ev.summary.attempt_ref}`;
  const namespace = `task-meta:${ev.summary.repository}`;
  let supersedes: SupersedesRef | null = null;
  if (revision > 1) {
    const own = await ownReports(client, repo, issue, reportId, namespace);
    const same = own.find((r) => r.revision === revision);
    const prev = own.find((r) => r.revision === revision - 1);
    if (same) {
      // Already posted: rebuild with the exact supersedes it carries so the digest can match.
      supersedes = asSupersedes(same.supersedes);
      if (supersedes === null)
        throw new Held([`revision ${revision} has no usable supersedes`], binding);
    } else if (prev) {
      supersedes = {
        revision: prev.revision,
        data_digest: prev.dataDigest,
        comment_ref: commentRef(repo, issue, prev.commentId),
      };
    } else {
      throw new Held([`predecessor revision ${revision - 1} not found by readback`], binding);
    }
  }

  const pointer: ManifestPointer = await persistRevision(store, ev, revision, predecessor, clock);
  let doc: ReturnType<typeof buildReportDocument>;
  try {
    doc = buildReportDocument(ev.summary, pointer, {
      profile,
      revision,
      supersedes,
      ...(profile === "v5"
        ? {
            publisherSourceSha: publisherSha as string,
            publication: { clearance_ref: cfg.clearance_ref },
            adsRevision: resolution.adsRevision,
          }
        : {}),
    });
  } catch (e) {
    if (e instanceof UnrepresentableError) throw new Held([e.code], binding);
    throw e;
  }
  const body = renderReportComment(doc, { humanSummary: humanSummary(ev.summary) });
  try {
    assertNoForbiddenContent(body.split("\n"));
  } catch {
    throw new Held(["privacy guard refused the report body"], binding);
  }
  const digest = reportDataDigest(doc.data);
  const outcome = await publishReport(client, { repo, issue, body, publish: !dry });
  const common = { binding, data_digest: digest, revision };
  switch (outcome.state) {
    case "PUBLISHED":
    case "ALREADY_PUBLISHED":
      return {
        ...common,
        state: outcome.state,
        comment_url: outcome.comment.html_url || commentRef(repo, issue, outcome.comment.id),
        reasons: [],
      };
    case "DRY_RUN":
      return { ...common, state: "DRY_RUN", comment_url: null, reasons: [] };
    case "CONFLICT":
      return {
        ...common,
        state: "HELD",
        comment_url: null,
        reasons: [`revision ${revision} already published with different data`],
      };
    case "NOT_PUBLISHED":
      return {
        ...common,
        state: "FAILED",
        comment_url: null,
        reasons: [scrub(outcome.reason)],
      };
  }
}

/** Run auto-report for one session. Never throws; appends one outbox entry (not on `dryRun`). */
export async function autoReportSession(
  opts: AutoReportOptions,
  deps: AutoReportDeps = {},
): Promise<OutboxEntry> {
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const dry = opts.dryRun === true;
  const entry = (
    state: OutboxState,
    reasons: string[],
    extra: Partial<OutboxEntry> = {},
  ): OutboxEntry => ({
    session: opts.session,
    agent: opts.agent,
    state,
    binding: null,
    comment_url: null,
    data_digest: null,
    reasons,
    at: now().toISOString(),
    ...extra,
  });
  let cfg: AutoReportConfig | null = null;
  let outbox: Outbox | null = null;
  const finish = async (e: OutboxEntry): Promise<OutboxEntry> => {
    if (!dry && outbox !== null) {
      try {
        await outbox.append(e);
      } catch {
        // the outbox is the only log; nothing else to do
      }
    }
    return e;
  };
  try {
    cfg = loadAutoReportConfig(opts.configPath);
    outbox = new Outbox(resolve(opts.outbox ?? cfg.outbox));
  } catch (e) {
    try {
      const fallback = loadAutoReportConfig();
      outbox = new Outbox(resolve(opts.outbox ?? fallback.outbox));
    } catch {
      outbox = null;
    }
    return finish(entry("FAILED", [safeReason(e)]));
  }
  if (!cfg.enabled || env.TASK_META_AUTO_REPORT === "0") {
    return finish(entry("DISABLED", ["auto-report disabled (config or TASK_META_AUTO_REPORT=0)"]));
  }
  if (opts.agent !== "zcode" && opts.agent !== "codex")
    return finish(entry("FAILED", [`unsupported agent: ${opts.agent.slice(0, 40)}`]));
  if (!SESSION_RE.test(opts.session)) return finish(entry("FAILED", ["invalid session id"]));

  let release: (() => Promise<void>) | null = null;
  if (!dry) {
    try {
      release = await outbox.lock(opts.session);
    } catch (e) {
      return finish(entry("FAILED", [safeReason(e)]));
    }
    if (release === null) {
      return finish(entry("ALREADY_RUNNING", ["another auto-report holds the session lock"]));
    }
  }
  try {
    const r = await drive(opts, cfg, deps, now);
    return await finish(entry(r.state, r.reasons, r));
  } catch (e) {
    if (e instanceof Held) {
      return await finish(entry("HELD", e.reasons, { binding: e.binding }));
    }
    return await finish(entry("FAILED", [safeReason(e)]));
  } finally {
    if (release !== null) await release();
  }
}
