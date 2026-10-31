// v0.4 B2 (#69) — crash-safe Outbox journal and bounded recovery coordinator.
// B2 is the SOLE Outbox/journal writer. A recovery-enabled path calls the frozen
// B1 seam (PublisherEffectHooks) ONLY through an explicit
// `publicationContext:{kind:"governed_outbox", hooks}` — the legacy untagged
// direct mode stays reserved for pre-B2 callers. Journal and lock names use the
// FULL sha256 of the report id (no truncated-safeName collision). A torn or
// corrupt IN_FLIGHT journal projects UNKNOWN/HELD: reconciliation GETs may run,
// a physical POST never does, and nothing is silently repaired.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostEffect } from "../model.ts";
import type { EffectRecordDetail, PrePostTarget, PublisherEffectHooks } from "../publish/index.ts";

/** Full cryptographic identity for journal/lock names; never truncated. */
export const reportIdHash = (reportId: string): string =>
  createHash("sha256").update(reportId, "utf8").digest("hex");

export type RecoveryState = "PENDING" | "IN_FLIGHT" | "TERMINAL" | "UNKNOWN" | "HELD";

export interface RecoveryCounters {
  post: number;
  getPage: number;
  wallMs: number;
  cycles: number;
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
  report_id: string;
  state: RecoveryState;
  /** Terminal T0 PostEffect once resolved; null otherwise. */
  effect: PostEffect | null;
  /** Chain segment inventory: epoch/sequence/predecessor of the driving event. */
  epoch: number;
  seq: number;
  predecessor: string | null;
  counters: RecoveryCounters;
  /** Last bounded cause token (A21 class or transport cause); never raw text. */
  last_cause: string | null;
  /** Replay skips consumed from the spool, by bounded reason token. */
  replay_skipped: string[];
  /** Live reservation owner nonce; null once terminal (and for fresh records). */
  owner_nonce: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/** Fail-closed refusals surfaced to the B1 seam as thrown hook errors. */
export type RecoveryRefusalCode =
  | "JOURNAL_TORN_IN_FLIGHT"
  | "JOURNAL_CORRUPT"
  | "JOURNAL_TERMINAL_NO_REPOST"
  | "POST_BUDGET_EXHAUSTED"
  | "GET_PAGE_BUDGET_EXHAUSTED"
  | "WALL_BUDGET_EXHAUSTED"
  | "CYCLE_BUDGET_EXHAUSTED";

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
  const e = err as { code?: unknown; message?: unknown };
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

/**
 * Durable single-record journal per report id at `<dir>/<sha256(reportId)>.json`.
 * Writes are temp-file + rename (same-directory atomic); a file that fails to
 * parse, or an IN_FLIGHT left by a previous process, is TORN: reads project
 * UNKNOWN (never repair, never POST).
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

  private path(reportId: string): string {
    return join(this.dir, `${reportIdHash(reportId)}.json`);
  }

  async load(reportId: string): Promise<JournalRecord> {
    const now = this.now();
    let raw: string;
    try {
      raw = await readFile(this.path(reportId), "utf8");
    } catch {
      return {
        schema: SCHEMA,
        report_id_hash: reportIdHash(reportId),
        report_id: reportId,
        state: "PENDING",
        effect: null,
        epoch: 1,
        seq: 1,
        predecessor: null,
        counters: { post: 0, getPage: 0, wallMs: 0, cycles: 1 },
        last_cause: null,
        replay_skipped: [],
        owner_nonce: null,
        created_at_ms: now,
        updated_at_ms: now,
      };
    }
    let rec: JournalRecord;
    try {
      rec = JSON.parse(raw) as JournalRecord;
      if (
        rec?.schema !== SCHEMA ||
        rec.report_id_hash !== reportIdHash(reportId) ||
        typeof rec.state !== "string"
      ) {
        throw new Error("shape");
      }
    } catch {
      throw new RecoveryRefusedError("JOURNAL_CORRUPT");
    }
    if (rec.state === "IN_FLIGHT") {
      // A live owner would have completed the CAS before releasing; leftover
      // IN_FLIGHT means a crash/torn write. Project UNKNOWN, zero POST.
      throw new RecoveryRefusedError("JOURNAL_TORN_IN_FLIGHT");
    }
    return rec;
  }

  /** Raw read without the torn guard - live-owner paths only. */
  private async readRaw(reportId: string): Promise<JournalRecord | null> {
    let raw: string;
    try {
      raw = await readFile(this.path(reportId), "utf8");
    } catch {
      return null;
    }
    try {
      const rec = JSON.parse(raw) as JournalRecord;
      if (rec?.schema !== SCHEMA || rec.report_id_hash !== reportIdHash(reportId)) return null;
      return rec;
    } catch {
      return null;
    }
  }

  private async persist(rec: JournalRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(rec.report_id);
    const tmp = join(this.dir, `.${rec.report_id_hash}.tmp-${this.now()}`);
    try {
      await writeFile(tmp, `${JSON.stringify(rec)}\n`, "utf8");
      await rename(tmp, target);
    } catch (err) {
      // Surface the A21 class as the journal cause; the caller decides fail-closed.
      throw err;
    }
  }

  /**
   * Read-only recovery projection for a possibly torn record: UNKNOWN/HELD for
   * corrupt or IN_FLIGHT files, the durable state otherwise. Never writes.
   */
  async projectRecovery(reportId: string): Promise<JournalRecord> {
    try {
      return await this.load(reportId);
    } catch (err) {
      if (err instanceof RecoveryRefusedError) {
        const now = this.now();
        return {
          schema: SCHEMA,
          report_id_hash: reportIdHash(reportId),
          report_id: reportId,
          state: err.code === "JOURNAL_TORN_IN_FLIGHT" ? "UNKNOWN" : "HELD",
          effect: null,
          epoch: 0,
          seq: 0,
          predecessor: null,
          counters: { post: 0, getPage: 0, wallMs: 0, cycles: 0 },
          last_cause: err.code,
          replay_skipped: [],
          owner_nonce: null,
          created_at_ms: now,
          updated_at_ms: now,
        };
      }
      throw err;
    }
  }

  /** Durable pre-POST reservation (CAS PENDING→IN_FLIGHT) inside the budgets. */
  async reserve(target: PrePostTarget): Promise<{ token: string }> {
    const rec = await this.load(target.reportId);
    if (rec.state === "TERMINAL") {
      throw new RecoveryRefusedError("JOURNAL_TERMINAL_NO_REPOST");
    }
    if (rec.state !== "PENDING" && rec.state !== "HELD") {
      // UNKNOWN/torn: fail closed; a fresh admission with positive proof is required.
      throw new RecoveryRefusedError("JOURNAL_TORN_IN_FLIGHT");
    }
    const now = this.now();
    if (rec.counters.post >= this.budgets.post) {
      throw new RecoveryRefusedError("POST_BUDGET_EXHAUSTED");
    }
    if (now - rec.created_at_ms > this.budgets.wallMs) {
      throw new RecoveryRefusedError("WALL_BUDGET_EXHAUSTED");
    }
    if (rec.counters.cycles >= this.budgets.cycles && rec.counters.post > 0) {
      throw new RecoveryRefusedError("CYCLE_BUDGET_EXHAUSTED");
    }
    const nonce = randomBytes(16).toString("hex");
    const next: JournalRecord = {
      ...rec,
      state: "IN_FLIGHT",
      owner_nonce: nonce,
      counters: { ...rec.counters, post: rec.counters.post + 1 },
      updated_at_ms: now,
    };
    await this.persist(next);
    this.liveNonce = nonce;
    return { token: `${next.report_id_hash}:${next.epoch}:${next.seq}:${nonce}` };
  }

  /**
   * Persistent per-report GET page charge in a sidecar file, deliberately
   * decoupled from the main record: a torn/corrupt journal still allows
   * GET-only reconciliation up to the budget while every POST stays refused.
   */
  async chargeForPage(reportId: string, page: number): Promise<{ granted: boolean }> {
    if (page < 1) return { granted: false };
    const sidecar = join(this.dir, `${reportIdHash(reportId)}.pages.json`);
    let used = 0;
    try {
      const parsed = JSON.parse(await readFile(sidecar, "utf8")) as { getPage?: unknown };
      used =
        typeof parsed.getPage === "number" && Number.isSafeInteger(parsed.getPage)
          ? parsed.getPage
          : 0;
    } catch {
      used = 0;
    }
    if (used >= this.budgets.getPage) return { granted: false };
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${reportIdHash(reportId)}.pages.tmp-${this.now()}`);
    const payload = JSON.stringify({ getPage: used + 1 }) + "\n";
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, sidecar);
    return { granted: true };
  }

  /**
   * Record terminal T0 effect for the reservation THIS instance owns (nonce
   * match). Any other IN_FLIGHT (crashed owner) or a missing record stays
   * torn: refuse rather than fabricate a terminal state - B1 then applies its
   * RECORD_EFFECT_FAILED fail-closed projection.
   */
  async recordEffect(
    reportId: string,
    effect: PostEffect,
    detail: EffectRecordDetail,
  ): Promise<void> {
    const rec = await this.readRaw(reportId);
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
  }

  /** Fold ALL consumed spool replay skips into the record's bounded cause list. */
  async consumeReplaySkips(
    reportId: string,
    skipped: { line: number; reason: string }[],
  ): Promise<void> {
    if (skipped.length === 0) return;
    const rec = await this.readRaw(reportId);
    if (rec === null || rec.state === "IN_FLIGHT") {
      return; // torn/absent journals stay untouched (no repair path here)
    }
    const now = this.now();
    await this.persist({
      ...rec,
      replay_skipped: [
        ...rec.replay_skipped,
        ...skipped.map((s) => `line${s.line}:${s.reason}`),
      ].slice(-20),
      updated_at_ms: now,
    });
  }
}

/**
 * The B2→B1 governed seam. Every thrown refusal maps to B1's fail-closed
 * PRE_POST_RESERVATION_REFUSED / GET_PAGE_BUDGET_EXHAUSTED zero-POST outcomes;
 * the mode tag is always `governed_outbox`, never a direct downgrade.
 */
export function recoveryHooks(journal: RecoveryJournal, reportId: string): PublisherEffectHooks {
  return {
    reservePrePost: (target: PrePostTarget) => journal.reserve(target),
    chargeGetPage: (page: number) => journal.chargeForPage(reportId, page),
    recordEffect: (effect: PostEffect, detail: EffectRecordDetail) =>
      journal.recordEffect(reportId, effect, detail),
  };
}
