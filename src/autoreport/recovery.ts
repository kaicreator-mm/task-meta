// v0.4 B2 (#69) — crash-safe Outbox journal and bounded recovery coordinator.
// B2 is the SOLE Outbox/journal writer. A recovery-enabled path calls the frozen
// B1 seam (PublisherEffectHooks) ONLY through an explicit
// `publicationContext:{kind:"governed_outbox", hooks}` — the legacy untagged
// direct mode stays reserved for pre-B2 callers. Journal AND lock names use the
// FULL sha256 identity of (report id, revision) — no truncated-safeName
// collision class. Reservations are interprocess single-winner admissions
// (O_EXCL lock + strict record CAS); read failures, corrupt budgets and torn
// IN_FLIGHT journals all fail CLOSED: reconciliation GETs may run, a physical
// POST never does, and nothing is silently repaired.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalDigest } from "../canonical.ts";
import type { PostEffect } from "../model.ts";
import type {
  EffectRecordDetail,
  PrePostTarget,
  PublicationContext,
  PublisherEffectHooks,
} from "../publish/index.ts";

/** Full cryptographic identity for budget/lock names; never truncated. */
export const reportIdHash = (reportId: string): string =>
  createHash("sha256").update(reportId, "utf8").digest("hex");

/** Per-revision record identity: the same report id may legitimately advance revisions. */
export const recordKey = (reportId: string, revision: number): string =>
  createHash("sha256").update(`${reportId}#rev${revision}`, "utf8").digest("hex");

export type RecoveryState = "PENDING" | "IN_FLIGHT" | "TERMINAL" | "UNKNOWN" | "HELD";

export interface RecoveryCounters {
  post: number;
  getPage: number;
  wallMs: number;
  cycles: number;
  /** Wall-budget anchor: first admission time (ms epoch); null until set. */
  started_at_ms?: number | null;
}

export interface RecoveryBudgets {
  post: number;
  getPage: number;
  wallMs: number;
  cycles: number;
}

export const DEFAULT_BUDGETS: Readonly<RecoveryBudgets> = Object.freeze({
  post: 3,
  getPage: 200,
  wallMs: 10 * 60_000,
  cycles: 3,
});

/** Hard acceptance bounds; anything wider is a config error, never a silent clamp. */
export const BUDGET_LIMITS = Object.freeze({
  post: 3,
  getPage: 1000,
  wallMs: 30 * 60_000,
  cycles: 3,
} as const);

export interface RecoveryOptions {
  enabled?: unknown;
  post_budget?: unknown;
  get_page_budget?: unknown;
  wall_budget_ms?: unknown;
  max_cycles?: unknown;
}

export interface ValidatedRecoveryConfig {
  enabled: boolean;
  budgets: RecoveryBudgets;
}

export class RecoveryConfigError extends Error {
  constructor(message: string) {
    super(`RECOVERY_CONFIG_INVALID: ${message}`);
  }
}

/** Opt-in parsing with strict bounds; absent/partial config stays disabled. */
export function parseRecoveryConfig(raw: unknown): ValidatedRecoveryConfig {
  if (raw === undefined || raw === null) return { enabled: false, budgets: { ...DEFAULT_BUDGETS } };
  if (typeof raw !== "object") throw new RecoveryConfigError("recovery must be an object");
  const r = raw as RecoveryOptions;
  if (r.enabled !== undefined && typeof r.enabled !== "boolean") {
    throw new RecoveryConfigError("enabled must be boolean");
  }
  const num = (v: unknown, def: number, max: number, name: string): number => {
    if (v === undefined) return def;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > max) {
      throw new RecoveryConfigError(`${name} must be an integer in [1, ${max}]`);
    }
    return v;
  };
  const budgets: RecoveryBudgets = {
    post: num(r.post_budget, DEFAULT_BUDGETS.post, BUDGET_LIMITS.post, "post_budget"),
    getPage: num(
      r.get_page_budget,
      DEFAULT_BUDGETS.getPage,
      BUDGET_LIMITS.getPage,
      "get_page_budget",
    ),
    wallMs: num(r.wall_budget_ms, DEFAULT_BUDGETS.wallMs, BUDGET_LIMITS.wallMs, "wall_budget_ms"),
    cycles: num(r.max_cycles, DEFAULT_BUDGETS.cycles, BUDGET_LIMITS.cycles, "max_cycles"),
  };
  return { enabled: r.enabled === true, budgets };
}

export interface JournalRecord {
  schema: "task-meta/recovery-journal/v1";
  report_id_hash: string;
  record_key: string;
  report_id: string;
  revision: number;
  state: RecoveryState;
  /** Terminal T0 PostEffect once resolved; null otherwise. */
  effect: PostEffect | null;
  /** The exact data digest this reservation chain is bound to. */
  data_digest: string | null;
  /** Chain segment inventory derived from the consumed spool replay. */
  epoch: number;
  seq: number;
  predecessor: string | null;
  /** Digest inventory of the consumed replay segments (bounded tail). */
  chain: string[];
  /** Total proven segment count; the stored chain is its bounded tail. */
  chain_len: number;
  /** Live reservation owner nonce; null once terminal (and for fresh records). */
  owner_nonce: string | null;
  counters: RecoveryCounters;
  /** Last bounded cause token (A21 class or transport cause); never raw text. */
  last_cause: string | null;
  /** Replay skips consumed from the spool, by bounded reason token. */
  replay_skipped: string[];
  created_at_ms: number;
  updated_at_ms: number;
}

export type RecoveryRefusalCode =
  | "JOURNAL_TORN_IN_FLIGHT"
  | "JOURNAL_CORRUPT"
  | "JOURNAL_UNREADABLE"
  | "JOURNAL_TERMINAL_NO_REPOST"
  | "JOURNAL_DIGEST_CONFLICT"
  | "JOURNAL_LOCK_HELD"
  | "POST_BUDGET_EXHAUSTED"
  | "GET_PAGE_BUDGET_EXHAUSTED"
  | "GET_BUDGET_UNREADABLE"
  | "WALL_BUDGET_EXHAUSTED"
  | "WALL_BUDGET_UNPROVED"
  | "CYCLE_BUDGET_EXHAUSTED"
  | "CHAIN_PREDECESSOR_UNRESOLVED"
  | "CHAIN_INTEGRITY_BROKEN";

export class RecoveryRefusedError extends Error {
  readonly code: RecoveryRefusalCode;
  constructor(code: RecoveryRefusalCode) {
    super(code);
    this.code = code;
  }
}

/** A21 bounded resource-error classes; classification only, never a repair. */
export type A21Class =
  | "A21_DISK_FULL"
  | "A21_BACKLOG_OVERFLOW"
  | "A21_STALE_LOCK"
  | "UNKNOWN_CAUSE";

export function classifyRecoveryError(err: unknown): A21Class {
  const e = err as { code?: unknown };
  switch (typeof e?.code === "string" ? e.code : "") {
    case "ENOSPC":
    case "EDQUOT":
      return "A21_DISK_FULL";
    case "EBUSY":
    case "ELOCKED":
      return "A21_STALE_LOCK";
    default:
      return "UNKNOWN_CAUSE";
  }
}

const SCHEMA = "task-meta/recovery-journal/v1";
const STATES: ReadonlySet<string> = new Set([
  "PENDING",
  "IN_FLIGHT",
  "TERMINAL",
  "UNKNOWN",
  "HELD",
]);
const EFFECTS: ReadonlySet<string> = new Set([
  "PROVEN_NOT_SENT",
  "REMOTE_SAME",
  "REMOTE_DIFFERENT_OR_DAMAGED",
  "SENT_OR_MAY_HAVE_SENT",
]);
const STALE_LOCK_MS = 15 * 60_000;

function isCountersShape(v: unknown): v is RecoveryCounters & { started_at_ms?: number | null } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  const base = ["post", "getPage", "wallMs", "cycles"].every(
    (k) => typeof c[k] === "number" && Number.isSafeInteger(c[k]) && (c[k] as number) >= 0,
  );
  const anchor = c.started_at_ms;
  return (
    base &&
    (anchor === undefined ||
      anchor === null ||
      (typeof anchor === "number" && Number.isSafeInteger(anchor)))
  );
}

function validRecord(rec: unknown, key: string): rec is JournalRecord {
  if (typeof rec !== "object" || rec === null) return false;
  const r = rec as Record<string, unknown>;
  return (
    r.schema === SCHEMA &&
    r.record_key === key &&
    typeof r.report_id === "string" &&
    typeof r.revision === "number" &&
    Number.isSafeInteger(r.revision) &&
    r.revision >= 1 &&
    typeof r.state === "string" &&
    STATES.has(r.state) &&
    (r.effect === null || (typeof r.effect === "string" && EFFECTS.has(r.effect))) &&
    (r.data_digest === null || typeof r.data_digest === "string") &&
    Number.isSafeInteger(r.epoch) &&
    Number.isSafeInteger(r.seq) &&
    (r.predecessor === null || typeof r.predecessor === "string") &&
    Array.isArray(r.chain) &&
    r.chain.every((d) => typeof d === "string") &&
    typeof r.chain_len === "number" &&
    Number.isSafeInteger(r.chain_len) &&
    r.chain_len >= 0 &&
    (r.owner_nonce === null || typeof r.owner_nonce === "string") &&
    isCountersShape(r.counters) &&
    (r.last_cause === null || typeof r.last_cause === "string") &&
    Array.isArray(r.replay_skipped) &&
    r.replay_skipped.every((s) => typeof s === "string") &&
    Number.isSafeInteger(r.created_at_ms) &&
    Number.isSafeInteger(r.updated_at_ms)
  );
}

/** Replay evidence derived from the raw spool text (mirrors Spool.replay semantics). */
export interface ReplayEvidence {
  skipped: { line: number; reason: string }[];
  /** Per-segment canonical digests, in file order. */
  chain: string[];
  epoch: number;
  seq: number;
  predecessor: string | null;
}

export function computeChainEvidence(text: string): ReplayEvidence {
  // Mirrors src/store/spool.ts Spool.replay() byte-for-byte in semantics: a
  // proven segment is exactly {"d":<digest>,"e":<entry>} with the digest equal
  // to canonicalDigest(e) AND a terminating newline. Anything else — malformed
  // shape, digest mismatch, uncanonicalizable entry, or a parseable last line
  // missing its newline (crash mid-append) — is skipped, never trusted.
  const skipped: { line: number; reason: string }[] = [];
  const chain: string[] = [];
  const lines = text.split("\n");
  const last = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw === "") continue;
    const n = i + 1;
    if (i === last) {
      // No terminating newline: crash mid-append. Never trust it, even if it parses.
      skipped.push({ line: n, reason: "truncated trailing line" });
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      skipped.push({ line: n, reason: "invalid JSON" });
      continue;
    }
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof (obj as { d?: unknown }).d !== "string" ||
      !("e" in obj)
    ) {
      skipped.push({ line: n, reason: "malformed line" });
      continue;
    }
    const { d, e } = obj as { d: string; e: unknown };
    let actual: string;
    try {
      actual = canonicalDigest(e);
    } catch {
      skipped.push({ line: n, reason: "entry not canonicalizable" });
      continue;
    }
    if (actual !== d) {
      skipped.push({ line: n, reason: "digest mismatch" });
      continue;
    }
    chain.push(createHash("sha256").update(raw, "utf8").digest("hex"));
  }
  return {
    skipped,
    chain,
    epoch: 1,
    seq: chain.length,
    predecessor: chain.length > 1 ? (chain[chain.length - 2] as string) : null,
  };
}

/**
 * Durable per-(report id, revision) journal record plus a report-level budget
 * ledger. Cross-process admission is a single-winner O_EXCL lock on the FULL
 * hash lock name; every read failure fails closed (never "fresh PENDING").
 */
export class RecoveryJournal {
  readonly dir: string;
  readonly budgets: RecoveryBudgets;
  private readonly now: () => number;
  /** Nonce of the reservation THIS instance made (live owner); null otherwise. */
  private liveNonce: string | null = null;

  constructor(
    dir: string,
    budgets: RecoveryBudgets = { ...DEFAULT_BUDGETS },
    now: () => number = Date.now,
  ) {
    this.dir = dir;
    this.budgets = budgets;
    this.now = now;
  }

  private recordPath(reportId: string, revision: number): string {
    return join(this.dir, `${recordKey(reportId, revision)}.json`);
  }

  private lockPath(key: string): string {
    return join(this.dir, `${key}.lock`);
  }

  private budgetPath(reportId: string): string {
    return join(this.dir, `${reportIdHash(reportId)}.budget.json`);
  }

  private pagesPath(reportId: string): string {
    return join(this.dir, `${reportIdHash(reportId)}.pages.json`);
  }

  /**
   * Interprocess single-winner admission on the full-hash lock file: exclusive
   * create ("wx"). A holder older than STALE_LOCK_MS is classified stale,
   * broken once and retried — no background repair daemon. Losers fail closed.
   */
  private async acquireLock(key: string, nonce: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.lockPath(key);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(path, "wx");
        try {
          await handle.writeFile(`${JSON.stringify({ nonce, at: this.now() })}\n`, "utf8");
        } finally {
          await handle.close();
        }
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw err;
        let stale = false;
        try {
          const info = await stat(path);
          stale = this.now() - info.mtimeMs >= STALE_LOCK_MS;
          if (stale) await unlink(path);
        } catch {
          stale = false;
        }
        if (!stale || attempt === 1) throw new RecoveryRefusedError("JOURNAL_LOCK_HELD");
      }
    }
    throw new RecoveryRefusedError("JOURNAL_LOCK_HELD");
  }

  private async releaseLock(key: string): Promise<void> {
    await unlink(this.lockPath(key)).catch(() => undefined);
  }

  /** Strict raw read: ENOENT -> null; any other failure is UNREADABLE; bad shape CORRUPT. */
  private async readRaw(reportId: string, revision: number): Promise<JournalRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.recordPath(reportId, revision), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new RecoveryRefusedError("JOURNAL_UNREADABLE");
    }
    let rec: unknown;
    try {
      rec = JSON.parse(raw);
    } catch {
      throw new RecoveryRefusedError("JOURNAL_CORRUPT");
    }
    if (!validRecord(rec, recordKey(reportId, revision))) {
      throw new RecoveryRefusedError("JOURNAL_CORRUPT");
    }
    return rec;
  }

  /** Public strict load: also projects a persisted IN_FLIGHT (crashed owner) as torn. */
  async load(reportId: string, revision = 1): Promise<JournalRecord> {
    const rec = await this.readRawOrTorn(reportId, revision);
    return rec ?? this.freshRecord(reportId, revision);
  }

  private async readRawOrTorn(reportId: string, revision: number): Promise<JournalRecord | null> {
    const rec = await this.readRaw(reportId, revision);
    if (rec !== null && rec.state === "IN_FLIGHT") {
      throw new RecoveryRefusedError("JOURNAL_TORN_IN_FLIGHT");
    }
    return rec;
  }

  private freshRecord(reportId: string, revision: number): JournalRecord {
    const now = this.now();
    return {
      schema: SCHEMA,
      report_id_hash: reportIdHash(reportId),
      record_key: recordKey(reportId, revision),
      report_id: reportId,
      revision,
      state: "PENDING",
      effect: null,
      data_digest: null,
      epoch: 1,
      seq: 0,
      predecessor: null,
      chain: [],
      chain_len: 0,
      owner_nonce: null,
      counters: { post: 0, getPage: 0, wallMs: 0, cycles: 1 },
      last_cause: null,
      replay_skipped: [],
      created_at_ms: now,
      updated_at_ms: now,
    };
  }

  private async persist(rec: JournalRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.recordPath(rec.report_id, rec.revision);
    const tmp = join(
      this.dir,
      `.${rec.record_key}.tmp-${rec.owner_nonce ?? randomBytes(8).toString("hex")}`,
    );
    await writeFile(tmp, `${JSON.stringify(rec)}\n`, "utf8");
    await rename(tmp, target);
  }

  /**
   * Read-only recovery projection for a possibly torn record: UNKNOWN/HELD for
   * corrupt, unreadable or IN_FLIGHT files; the durable state otherwise.
   * Never writes, never repairs.
   */
  async projectRecovery(reportId: string, revision = 1): Promise<JournalRecord> {
    try {
      return await this.load(reportId, revision);
    } catch (err) {
      if (err instanceof RecoveryRefusedError) {
        const now = this.now();
        const state = err.code === "JOURNAL_TORN_IN_FLIGHT" ? "UNKNOWN" : "HELD";
        return {
          ...this.freshRecord(reportId, revision),
          state,
          last_cause: err.code,
          created_at_ms: now,
          updated_at_ms: now,
        };
      }
      throw err;
    }
  }

  /** Report-level aggregated budget ledger (strict; failures refuse admission). */
  private async loadLedger(reportId: string): Promise<RecoveryCounters> {
    let raw: string;
    try {
      raw = await readFile(this.budgetPath(reportId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { post: 0, getPage: 0, wallMs: 0, cycles: 0, started_at_ms: null };
      }
      throw new RecoveryRefusedError("JOURNAL_UNREADABLE");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RecoveryRefusedError("JOURNAL_CORRUPT");
    }
    if (!isCountersShape(parsed)) throw new RecoveryRefusedError("JOURNAL_CORRUPT");
    return parsed as RecoveryCounters;
  }

  private async persistLedger(reportId: string, counters: RecoveryCounters): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const nonce = randomBytes(8).toString("hex");
    const tmp = join(this.dir, `.${reportIdHash(reportId)}.budget.tmp-${nonce}`);
    await writeFile(tmp, `${JSON.stringify(counters)}\n`, "utf8");
    await rename(tmp, this.budgetPath(reportId));
  }

  /**
   * Durable pre-POST reservation: single-winner interprocess admission on the
   * full-hash lock, predecessor-revision chain validation, digest binding and
   * the aggregated budget ledger. Legitimate later revisions of the SAME report
   * id get their own record; an uncertain prior effect or a digest conflict
   * never re-posts.
   */
  async reserve(
    target: PrePostTarget & { revision?: number; supersedes?: number | null },
  ): Promise<{ token: string }> {
    const revision = target.revision ?? 1;
    const key = recordKey(target.reportId, revision);
    const nonce = randomBytes(16).toString("hex");
    await this.acquireLock(key, nonce);
    try {
      // Predecessor chain: a later revision may only post when the prior
      // revision is durably TERMINAL with a non-ambiguous effect.
      let predecessorTerminal = false;
      if (revision > 1) {
        const pred = await this.readRaw(target.reportId, revision - 1);
        if (
          pred === null ||
          pred.state !== "TERMINAL" ||
          pred.effect === null ||
          pred.effect === "SENT_OR_MAY_HAVE_SENT"
        ) {
          throw new RecoveryRefusedError("CHAIN_PREDECESSOR_UNRESOLVED");
        }
        predecessorTerminal = true;
      }
      const existing = await this.readRawOrTorn(target.reportId, revision);
      if (existing !== null) {
        if (existing.state === "HELD") {
          throw new RecoveryRefusedError("CHAIN_INTEGRITY_BROKEN");
        }
        if (existing.state === "TERMINAL") {
          throw new RecoveryRefusedError(
            existing.data_digest === target.dataDigest
              ? "JOURNAL_TERMINAL_NO_REPOST"
              : "JOURNAL_DIGEST_CONFLICT",
          );
        }
        if (existing.state === "UNKNOWN") {
          throw new RecoveryRefusedError("JOURNAL_TORN_IN_FLIGHT");
        }
      }
      const now = this.now();
      const ledger = await this.loadLedger(target.reportId);
      // R3 P1: the wall anchor is established exactly ONCE, on the first
      // admission. When any durable evidence of prior admissions exists but the
      // ledger's anchor is missing (lost/reset/legacy ledger without
      // started_at_ms), the elapsed budget is UNPROVED — refuse instead of
      // restarting the 10-minute clock.
      const priorAdmissions =
        ledger.post > 0 ||
        ledger.cycles > 0 ||
        ledger.wallMs > 0 ||
        predecessorTerminal ||
        (existing !== null && (existing.state === "TERMINAL" || existing.counters.post > 0));
      if (priorAdmissions && (ledger.started_at_ms === undefined || ledger.started_at_ms === null)) {
        throw new RecoveryRefusedError("WALL_BUDGET_UNPROVED");
      }
      // P1-02: persistent 10-minute wall budget across ALL recovery cycles and
      // revisions: an absolute first-admission deadline plus accumulated
      // measured elapsed time, both stored on the report-level ledger.
      if (
        (ledger.started_at_ms !== undefined &&
          ledger.started_at_ms !== null &&
          now - ledger.started_at_ms > this.budgets.wallMs) ||
        ledger.wallMs >= this.budgets.wallMs
      ) {
        throw new RecoveryRefusedError("WALL_BUDGET_EXHAUSTED");
      }
      if (ledger.post >= this.budgets.post) {
        throw new RecoveryRefusedError("POST_BUDGET_EXHAUSTED");
      }
      // A new admission after prior POSTs is a new recovery cycle (P2-01).
      const cycles = ledger.post > 0 ? ledger.cycles + 1 : 1;
      if (cycles > this.budgets.cycles) {
        throw new RecoveryRefusedError("CYCLE_BUDGET_EXHAUSTED");
      }
      const base = existing ?? this.freshRecord(target.reportId, revision);
      const next: JournalRecord = {
        ...base,
        state: "IN_FLIGHT",
        owner_nonce: nonce,
        data_digest: target.dataDigest,
        counters: { ...base.counters, post: base.counters.post + 1 },
        updated_at_ms: now,
      };
      await this.persistLedger(target.reportId, {
        ...ledger,
        post: ledger.post + 1,
        cycles,
        started_at_ms: ledger.started_at_ms ?? now,
      });
      await this.persist(next);
      this.liveNonce = nonce;
      return { token: `${next.record_key}:${next.epoch}:${next.seq}:${nonce}` };
    } catch (err) {
      this.liveNonce = null;
      await this.releaseLock(key);
      throw err;
    }
  }

  /**
   * Persistent per-report GET page charge in a sidecar file under an exclusive
   * lock, decoupled from the main record: a torn/corrupt journal still allows
   * GET-only reconciliation, while an unreadable/corrupt sidecar refuses any
   * further page (never resets the spent budget).
   */
  async chargeForPage(reportId: string, page: number): Promise<{ granted: boolean }> {
    if (page < 1) return { granted: false };
    const key = `${reportIdHash(reportId)}.pages`;
    const nonce = randomBytes(8).toString("hex");
    try {
      await this.acquireLock(key, nonce);
    } catch {
      return { granted: false };
    }
    try {
      let raw: string | null = null;
      try {
        raw = await readFile(this.pagesPath(reportId), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { granted: false };
      }
      let used = 0;
      if (raw !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { granted: false }; // corrupt sidecar: refuse, never reset
        }
        const charged = (parsed as { getPage?: unknown }).getPage;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          typeof charged !== "number" ||
          !Number.isSafeInteger(charged) ||
          charged < 0
        ) {
          return { granted: false };
        }
        used = charged;
      }
      if (used >= this.budgets.getPage) return { granted: false };
      await mkdir(this.dir, { recursive: true });
      const tmp = join(this.dir, `.${key}.tmp-${nonce}`);
      await writeFile(tmp, `${JSON.stringify({ getPage: used + 1 })}\n`, "utf8");
      await rename(tmp, this.pagesPath(reportId));
      return { granted: true };
    } finally {
      await this.releaseLock(key);
    }
  }

  /**
   * Record terminal T0 effect for the reservation THIS instance owns (nonce
   * match). Any other IN_FLIGHT (crashed owner) or a missing record stays
   * torn: refuse rather than fabricate a terminal state — B1 then applies its
   * RECORD_EFFECT_FAILED fail-closed projection.
   */
  async recordEffect(
    reportId: string,
    effect: PostEffect,
    detail: EffectRecordDetail,
    revision = 1,
  ): Promise<void> {
    const rec = await this.readRaw(reportId, revision);
    if (
      rec === null ||
      rec.state !== "IN_FLIGHT" ||
      this.liveNonce === null ||
      rec.owner_nonce !== this.liveNonce
    ) {
      throw new RecoveryRefusedError("JOURNAL_TORN_IN_FLIGHT");
    }
    const now = this.now();
    const next: JournalRecord = {
      ...rec,
      state: "TERMINAL",
      effect,
      owner_nonce: null,
      counters: { ...rec.counters, wallMs: rec.counters.wallMs + (now - rec.updated_at_ms) },
      last_cause: detail.outcomeState,
      updated_at_ms: now,
    };
    await this.persist(next);
    this.liveNonce = null;
    // Charge the measured admission duration into the persistent wall budget.
    try {
      const ledger = await this.loadLedger(reportId);
      await this.persistLedger(reportId, {
        ...ledger,
        wallMs: ledger.wallMs + (now - rec.updated_at_ms),
      });
    } catch {
      // A ledger charge failure never fabricates a terminal state; the wall
      // deadline anchor on the ledger still bounds future admissions.
    }
    await this.releaseLock(next.record_key);
  }

  /**
   * Consume the spool replay evidence for a (report id, revision): skipped
   * lines become bounded cause tokens, and the segment digest chain must be an
   * EXTENSION of the previously consumed inventory. A reordered/edited/removed
   * prefix marks the record HELD (chain broken) — future POSTs refuse, GET-only
   * reconciliation stays available.
   */
  async attachReplayEvidence(
    reportId: string,
    evidence: ReplayEvidence,
    revision = 1,
  ): Promise<void> {
    const key = recordKey(reportId, revision);
    const nonce = randomBytes(8).toString("hex");
    await this.acquireLock(key, nonce);
    try {
      const rec = await this.readRawOrTorn(reportId, revision);
      const base = rec ?? this.freshRecord(reportId, revision);
      if (rec !== null && rec.state !== "PENDING" && rec.state !== "TERMINAL") {
        return; // torn/held journals stay untouched (no repair path)
      }
      const now = this.now();
      // Unproved/incomplete source (any skipped line): no POST from this
      // evidence; retain every skip class as bounded tokens and hold.
      if (evidence.skipped.length > 0) {
        await this.persist({
          ...base,
          state: "HELD",
          last_cause: "SOURCE_UNPROVED",
          chain: [],
          chain_len: 0,
          replay_skipped: [
            ...base.replay_skipped,
            ...evidence.skipped.map((s) => `line${s.line}:${s.reason}`),
          ].slice(-20),
          updated_at_ms: now,
        });
        return;
      }
      // P2-01: the stored chain is the bounded TAIL of chain_len total proven
      // segments; a valid extension must agree where the retained tail aligns.
      const storedTail = base.chain;
      const totalPrev = base.chain_len;
      const newLen = evidence.chain.length;
      const tailStart = totalPrev - storedTail.length;
      const extended =
        totalPrev === 0 ||
        (evidence.chain.length >= totalPrev &&
          tailStart >= 0 &&
          storedTail.every((d, i) => d === (evidence.chain[tailStart + i] as string)));
      if (!extended) {
        await this.persist({
          ...base,
          state: "HELD",
          last_cause: "CHAIN_INTEGRITY_BROKEN",
          updated_at_ms: now,
        });
        return;
      }
      await this.persist({
        ...base,
        epoch: evidence.epoch,
        seq: evidence.seq,
        predecessor: evidence.predecessor,
        chain: evidence.chain.slice(-64),
        chain_len: newLen,
        replay_skipped: [...base.replay_skipped].slice(-20),
        updated_at_ms: now,
      });
    } finally {
      await this.releaseLock(key);
    }
  }
}

/**
 * The B2→B1 governed seam. Every thrown refusal maps to B1's fail-closed
 * PRE_POST_RESERVATION_REFUSED / GET_PAGE_BUDGET_EXHAUSTED zero-POST outcomes;
 * the mode tag is always `governed_outbox`, never a direct downgrade. The
 * revision binding keeps legitimate report updates admissible while uncertain
 * same-revision retries and digest conflicts stay refused.
 */
export function recoveryHooks(
  journal: RecoveryJournal,
  reportId: string,
  revision = 1,
  supersedes: number | null = null,
): PublisherEffectHooks {
  return {
    reservePrePost: (target: PrePostTarget) => journal.reserve({ ...target, revision, supersedes }),
    chargeGetPage: (page: number) => journal.chargeForPage(reportId, page),
    recordEffect: (effect: PostEffect, detail: EffectRecordDetail) =>
      journal.recordEffect(reportId, effect, detail, revision),
  };
}

/**
 * Build the governed publication context for one (report id, revision): the
 * consumed spool replay evidence is attached BEFORE the publish call so chain
 * integrity and skips are already durable when the B1 seam reserves.
 */
export async function buildGovernedRecoveryContext(
  budgets: RecoveryBudgets,
  dir: string,
  reportId: string,
  revision: number,
  spoolText: string,
): Promise<PublicationContext> {
  const journal = new RecoveryJournal(dir, budgets);
  await journal.attachReplayEvidence(reportId, computeChainEvidence(spoolText), revision);
  return {
    kind: "governed_outbox",
    hooks: recoveryHooks(journal, reportId, revision, revision > 1 ? revision - 1 : null),
  };
}
