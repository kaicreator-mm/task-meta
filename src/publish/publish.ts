import { assessPostEffect, type PostEffect, type PrivatePublicationStatus } from "../model.ts";
import {
  loadAdoption,
  parseReportComment,
  REPORT_MARKER,
  resolveProfile,
} from "../report/index.ts";
import {
  type ClearanceTarget,
  checkPublicationGrant,
  loadPublicationPolicy,
  type PublicationPolicyProvider,
} from "./authority.ts";
import type { GitHubClient, IssueComment } from "./client.ts";

export type PublishOutcome =
  | { state: "PUBLISHED"; comment: IssueComment }
  | { state: "ALREADY_PUBLISHED"; comment: IssueComment }
  | { state: "CONFLICT"; comment: IssueComment; existingDigest: string; newDigest: string }
  | { state: "DRY_RUN"; body: string; dataDigest: string }
  | { state: "NOT_PUBLISHED"; reason: string };

/**
 * v0.4 B1 additive private transport-effect metadata. The public union above is
 * unchanged; consumers opt in via this optional field. Projections use the T0
 * pure classifier (assessPostEffect); nothing here authorizes transport.
 */
export interface PublishEffectMeta {
  effect: PostEffect;
  /** T0 conservative projection of the effect (UNKNOWN => reconciliation-only). */
  status: PrivatePublicationStatus;
  /** Typed private denial code for zero-POST refusals (public reason stays compatible). */
  denialCode: string | null;
  attempts: number;
  lastHttpStatus: number | null;
}

export type PublishOutcomeWithEffect = PublishOutcome & { effectMeta?: PublishEffectMeta };

/** Identity of the report a physical POST would carry (B1→B2 reservation target). */
export interface PrePostTarget {
  repo: string;
  issue: number;
  reportId: string;
  dataDigest: string;
}

export interface EffectRecordDetail {
  attempts: number;
  lastHttpStatus: number | null;
  outcomeState: string;
}

/**
 * Frozen B1→B2 seam. B2 exclusively supplies implementations; B1 runtime-validates
 * them and fails closed when they are missing, untrusted or incomplete.
 */
export interface PublisherEffectHooks {
  /** Trusted durable reservation before EACH physical createIssueComment. */
  reservePrePost(target: PrePostTarget): Promise<{ token: string }>;
  /** Shared budget charge before EACH network GET page. */
  chargeGetPage(page: number): Promise<{ granted: boolean }>;
  /** Effect-certainty recording after the transport attempt set completes. */
  recordEffect(effect: PostEffect, detail: EffectRecordDetail): Promise<void>;
}

/**
 * R3 typed public-compatible mode selector. Omitted => direct (pre-existing ABI).
 * governed_outbox requires runtime-validated trusted hooks and NEVER falls back
 * to the direct path when hooks are absent/incomplete/invalid.
 */
export type PublicationContext =
  | { kind: "direct" }
  | { kind: "governed_outbox"; hooks: PublisherEffectHooks };

function isPublisherEffectHooks(h: unknown): h is PublisherEffectHooks {
  return (
    typeof h === "object" &&
    h !== null &&
    typeof (h as PublisherEffectHooks).reservePrePost === "function" &&
    typeof (h as PublisherEffectHooks).chargeGetPage === "function" &&
    typeof (h as PublisherEffectHooks).recordEffect === "function"
  );
}

/** Internal fail-closed signals for governed-mode hook interactions. */
class HookRefusalError extends Error {
  readonly code:
    | "GOVERNED_HOOKS_INVALID"
    | "PRE_POST_RESERVATION_REFUSED"
    | "GET_PAGE_BUDGET_EXHAUSTED";
  constructor(code: HookRefusalError["code"]) {
    super(code);
    this.code = code;
  }
}

export interface ReportEntry {
  /** (issue, publisher_namespace, report_id, revision, report_kind) */
  identity: string;
  dataDigest: string;
  comment: IssueComment;
}

export interface FindResult {
  entries: ReportEntry[];
  /** Comments that are not valid reports (counted, never acted on). */
  ignored: number;
  /**
   * Comments that carry the ADS marker and a `report_id` line but no longer parse as a valid
   * report (e.g. edited in place into an invalid shape). Their identity cannot be verified, so a
   * report with the same report_id must not be posted again next to them.
   */
  damaged: { reportId: string; comment: IssueComment }[];
  totalComments: number;
}

const PER_PAGE = 100;
const MAX_PAGES = 1000;

function identityOf(issue: number, data: Record<string, unknown>): string {
  return JSON.stringify([
    issue,
    data.publisher_namespace,
    data.report_id,
    data.revision,
    data.report_kind,
  ]);
}

/** Exhaustively paginate and parse every comment of the issue. */
export async function findReports(
  client: GitHubClient,
  repo: string,
  issue: number,
  perPage: number = PER_PAGE,
  pageGate?: (page: number) => Promise<void>,
): Promise<FindResult> {
  const entries: ReportEntry[] = [];
  const damaged: FindResult["damaged"] = [];
  let ignored = 0;
  let total = 0;
  const nativeIds = new Map<number, { body: string; url: string }>();
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error("pagination did not terminate");
    // Governed mode: shared budget charge BEFORE each network GET page.
    if (pageGate) await pageGate(page);
    const res = await client.listIssueComments(repo, issue, page, perPage);
    if (
      !Array.isArray(res.comments) ||
      typeof res.hasNext !== "boolean" ||
      (res.hasNext && res.comments.length === 0)
    ) {
      throw new Error("partial or invalid native GitHub pagination");
    }
    for (const c of res.comments) {
      if (!Number.isSafeInteger(c.id) || c.id <= 0)
        throw new Error("invalid native comment identity");
      const previous = nativeIds.get(c.id);
      if (previous !== undefined) {
        if (previous.body !== c.body || previous.url !== c.html_url) {
          throw new Error("same native comment ID changed during readback");
        }
        continue;
      }
      nativeIds.set(c.id, { body: c.body, url: c.html_url });
      total++;
      const parsed = parseReportComment(c.body);
      if (!parsed.ok) {
        ignored++;
        const rid = damagedReportId(c.body);
        if (rid !== null) damaged.push({ reportId: rid, comment: c });
        continue;
      }
      entries.push({
        identity: identityOf(issue, parsed.doc.data),
        dataDigest: parsed.dataDigest,
        comment: c,
      });
    }
    if (!res.hasNext) break;
  }
  return { entries, ignored, damaged, totalComments: total };
}

/** report_id of a marker comment that failed to parse, read from its raw YAML line. */
function damagedReportId(body: string): string | null {
  if (!body.replace(/\r\n/g, "\n").startsWith(`${REPORT_MARKER}\n`)) return null;
  const m = /^\s*report_id:\s*["']?([^"'\s]+)["']?\s*$/m.exec(body);
  return m?.[1] ?? null;
}

export interface PublishOptions {
  repo: string;
  issue: number;
  body: string;
  publish: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Historical ceiling on in-call POST attempts; B1 semantics stop all same-call POST on ambiguous transport. */
  maxRetries?: number;
  now?: () => number;
  perPage?: number;
  /** Explicit isolated candidate test purpose; does not override repository allowlisting. */
  e2eTestOnly?: boolean;
  /** DI seam for source-qualified grant fixtures; default loads the shipped fail-closed policy. */
  publicationPolicy?: PublicationPolicyProvider;
  /** R3 mode selector; omitted => direct. Governed mode never falls back to direct. */
  publicationContext?: PublicationContext;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 300_000;

type Classified =
  | { kind: "fatal"; reason: string }
  | { kind: "retry"; waitMs: number | null; reason: string };

function classify(err: unknown): Classified {
  const e = err as { status?: unknown; retryAfterSeconds?: unknown; message?: unknown };
  const msg = String(e?.message ?? err);
  if (typeof e?.status !== "number") {
    return { kind: "retry", waitMs: null, reason: `network: ${msg}` };
  }
  const ra = typeof e.retryAfterSeconds === "number" ? e.retryAfterSeconds * 1000 : null;
  const reason = `HTTP ${e.status}: ${msg}`;
  if (e.status === 429 || e.status >= 500) return { kind: "retry", waitMs: ra, reason };
  if (e.status === 403 && ra !== null) return { kind: "retry", waitMs: ra, reason };
  return { kind: "fatal", reason };
}

type Decision = { found: false } | { found: true; outcome: PublishOutcome; same: IssueComment };

function decide(entries: ReportEntry[], identity: string, digest: string): Decision {
  const matches = entries.filter((e) => e.identity === identity);
  if (matches.length === 0) return { found: false };
  const differing = matches.find((e) => e.dataDigest !== digest);
  if (differing) {
    return {
      found: true,
      same: differing.comment,
      outcome: {
        state: "CONFLICT",
        comment: differing.comment,
        existingDigest: differing.dataDigest,
        newDigest: digest,
      },
    };
  }
  const first = (matches[0] as ReportEntry).comment;
  return { found: true, same: first, outcome: { state: "ALREADY_PUBLISHED", comment: first } };
}

/** A report found during retry reconciliation counts as our publication. */
function reconciled(d: Extract<Decision, { found: true }>): PublishOutcome {
  return d.outcome.state === "ALREADY_PUBLISHED"
    ? { state: "PUBLISHED", comment: d.same }
    : d.outcome;
}

async function findById(
  client: GitHubClient,
  repo: string,
  issue: number,
  id: number,
  perPage: number,
  pageGate?: (page: number) => Promise<void>,
): Promise<IssueComment | null> {
  let found: IssueComment | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (pageGate) await pageGate(page);
    const res = await client.listIssueComments(repo, issue, page, perPage);
    if (
      !Array.isArray(res.comments) ||
      typeof res.hasNext !== "boolean" ||
      (res.hasNext && res.comments.length === 0)
    ) {
      throw new Error("partial or invalid native GitHub pagination");
    }
    for (const c of res.comments) {
      if (c.id !== id) continue;
      if (found !== null && (found.body !== c.body || found.html_url !== c.html_url)) {
        throw new Error("target native comment changed during readback");
      }
      found = c;
    }
    // Even after finding the ID, read all remaining pages to verify complete native
    // source currentness; never equate an early hit with a completed readback.
    if (!res.hasNext) return found;
  }
  throw new Error("pagination did not terminate");
}

export async function publishReport(
  client: GitHubClient,
  opts: PublishOptions,
): Promise<PublishOutcomeWithEffect> {
  const { repo, issue, body } = opts;
  const sleep = opts.sleep ?? realSleep;
  const maxRetries = opts.maxRetries ?? 3;
  const perPage = opts.perPage ?? PER_PAGE;
  const ctx: PublicationContext = opts.publicationContext ?? { kind: "direct" };
  const governed = ctx.kind === "governed_outbox";

  let attempts = 0;
  let lastHttpStatus: number | null = null;
  const metaFor = (effect: PostEffect, denialCode: string | null): PublishEffectMeta => ({
    effect,
    status: assessPostEffect(effect).status,
    denialCode,
    attempts,
    lastHttpStatus,
  });
  const recordEffectSafe = async (effect: PostEffect, outcomeState: string) => {
    // Best-effort certainty recording: a broken recorder must never change the
    // transport truth already established (and can never "prove" non-send).
    if (governed) {
      try {
        await ctx.hooks.recordEffect(effect, { attempts, lastHttpStatus, outcomeState });
      } catch {
        /* conservative effect semantics are preserved in the returned effectMeta */
      }
    }
  };
  /** Remote summary says the report already exists: equal digest => REMOTE_SAME,
   *  differing digest (CONFLICT) => REMOTE_DIFFERENT_OR_DAMAGED, never REMOTE_SAME. */
  const effectForExisting = (outcome: PublishOutcome): PostEffect =>
    outcome.state === "CONFLICT" ? "REMOTE_DIFFERENT_OR_DAMAGED" : "REMOTE_SAME";
  /** A durable reservation receipt must be a present non-blank token, else the
   *  governed mode refuses to POST at all (fail closed). */
  const validReservation = (r: unknown): r is { token: string } =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as { token?: unknown }).token === "string" &&
    ((r as { token: string }).token.trim().length ?? 0) > 0;

  // R3 fail-closed mode selection: invalid/missing governed hooks => zero network
  // POST and never a silent downgrade to the direct path.
  if (governed && !isPublisherEffectHooks(ctx.hooks)) {
    return {
      state: "NOT_PUBLISHED",
      reason:
        "GOVERNED_HOOKS_INVALID: governed_outbox requires trusted PublisherEffectHooks; refusing direct fallback",
      effectMeta: metaFor("PROVEN_NOT_SENT", "GOVERNED_HOOKS_INVALID"),
    };
  }
  const hooks = governed ? ctx.hooks : null;
  const pageGate = async (page: number) => {
    if (!hooks) return;
    const charge = await hooks.chargeGetPage(page);
    if (!charge.granted) throw new HookRefusalError("GET_PAGE_BUDGET_EXHAUSTED");
  };

  const parsed = parseReportComment(body);
  if (!parsed.ok) {
    return {
      state: "NOT_PUBLISHED",
      reason: `invalid report body: ${parsed.error}`,
      effectMeta: metaFor("PROVEN_NOT_SENT", "INVALID_BODY"),
    };
  }
  const data = parsed.doc.data;
  const subject = (data.subject ?? {}) as {
    repository?: unknown;
    issue_ref?: unknown;
    ads_revision?: unknown;
    publisher_source_sha?: unknown;
  };
  // This is the LAST in-process GitHub write boundary. A caller cannot bypass
  // v5 adoption admission merely by rendering a valid document and invoking
  // publishReport directly. Admission denial is evaluated BEFORE any governed
  // reservation/charge (L2-06a/07 machine order).
  if (opts.publish && parsed.doc.schema === "ads/github/v5") {
    if (typeof subject.ads_revision !== "string") {
      return {
        state: "NOT_PUBLISHED",
        reason: "ADS_PIN_REQUIRED: missing v5 subject.ads_revision",
        effectMeta: metaFor("PROVEN_NOT_SENT", "ADS_PIN_REQUIRED"),
      };
    }
    const gate = resolveProfile({
      profile: "v5",
      adsPin: subject.ads_revision,
      repository: repo,
      publish: true,
      e2eTestOnly: opts.e2eTestOnly === true,
      adoption: loadAdoption(),
    });
    if (!gate.ok) {
      return {
        state: "NOT_PUBLISHED",
        reason: `${gate.code}: ${gate.message}`,
        effectMeta: metaFor("PROVEN_NOT_SENT", gate.code),
      };
    }
    const publication = (data.publication ?? {}) as {
      classification?: unknown;
      clearance_ref?: unknown;
    };
    if (
      publication.classification !== "PUBLISHABLE" ||
      typeof publication.clearance_ref !== "string" ||
      publication.clearance_ref.length === 0 ||
      typeof subject.publisher_source_sha !== "string" ||
      !/^[0-9a-f]{40}$/.test(subject.publisher_source_sha)
    ) {
      return {
        state: "NOT_PUBLISHED",
        reason: "PUBLICATION_CLEARANCE_REQUIRED: no qualified v5 source/clearance",
        effectMeta: metaFor("PROVEN_NOT_SENT", "PUBLICATION_CLEARANCE_REQUIRED"),
      };
    }
    // The source profile gate above is necessary but NOT a clearance grant.
    // Only an independently version-governed exact projection permit with
    // corresponding real GitHub native Issue comment qualifies ordinary v5.
    // E2E_TEST_SUBJECT is separately isolated by exact repo + test-purpose flag.
    if (gate.mode === "ADOPTED") {
      try {
        const target: ClearanceTarget = {
          repository: repo,
          issueNumber: issue,
          publisherNamespace: String(data.publisher_namespace),
          adsRevision: subject.ads_revision,
          publisherSourceSha: subject.publisher_source_sha,
          publicationRef: publication.clearance_ref,
          data,
        };
        const clearance = await checkPublicationGrant(
          client,
          target,
          opts.publicationPolicy ? opts.publicationPolicy(target) : loadPublicationPolicy(),
        );
        if (!clearance.ok) {
          return {
            state: "NOT_PUBLISHED",
            reason: clearance.code,
            effectMeta: metaFor("PROVEN_NOT_SENT", clearance.code),
          };
        }
        // Re-read owning native Issue and effective authenticated repo write
        // permission. The report's asserted PUBLISHABLE is not authority.
        if (
          !client.verifyIssuePublicationPermission ||
          !(await client.verifyIssuePublicationPermission(repo, issue))
        ) {
          return {
            state: "NOT_PUBLISHED",
            reason: "NATIVE_PUBLICATION_PERMISSION_UNVERIFIED",
            effectMeta: metaFor("PROVEN_NOT_SENT", "NATIVE_PUBLICATION_PERMISSION_UNVERIFIED"),
          };
        }
      } catch {
        return {
          state: "NOT_PUBLISHED",
          reason: "CLEARANCE_SOURCE_UNAVAILABLE",
          effectMeta: metaFor("PROVEN_NOT_SENT", "CLEARANCE_SOURCE_UNAVAILABLE"),
        };
      }
    }
  }
  if (subject.repository !== repo) {
    return {
      state: "NOT_PUBLISHED",
      reason: "report subject.repository does not match target repo",
      effectMeta: metaFor("PROVEN_NOT_SENT", "REPO_IDENTITY_MISMATCH"),
    };
  }
  if (
    typeof subject.issue_ref !== "string" ||
    !subject.issue_ref.endsWith(`/${repo}/issues/${issue}`)
  ) {
    return {
      state: "NOT_PUBLISHED",
      reason: "report subject.issue_ref does not match target issue",
      effectMeta: metaFor("PROVEN_NOT_SENT", "ISSUE_IDENTITY_MISMATCH"),
    };
  }
  const identity = identityOf(issue, data);
  const digest = parsed.dataDigest;

  let lastFind: FindResult | null = null;
  const readback = async (): Promise<Decision> => {
    lastFind = await findReports(client, repo, issue, perPage, pageGate);
    return decide(lastFind.entries, identity, digest);
  };

  try {
    const pre = await readback();
    if (pre.found) {
      const existingEffect = effectForExisting(pre.outcome);
      await recordEffectSafe(existingEffect, pre.outcome.state);
      return { ...pre.outcome, effectMeta: metaFor(existingEffect, null) };
    }
    const reportId = String(data.report_id);
    const broken = (lastFind as FindResult | null)?.damaged.find((d) => d.reportId === reportId);
    if (broken) {
      return {
        state: "NOT_PUBLISHED",
        reason: `UNVERIFIED_EXISTING: comment ${broken.comment.id} carries report_id ${reportId} but is not a valid report (edited or damaged); not posting a second copy`,
        effectMeta: metaFor("REMOTE_DIFFERENT_OR_DAMAGED", "UNVERIFIED_EXISTING"),
      };
    }
    if (!opts.publish) return { state: "DRY_RUN", body, dataDigest: digest };

    let created: IssueComment | null = null;
    for (let attempt = 0; created === null; attempt++) {
      if (attempt > maxRetries) break;
      attempts = attempt + 1;
      // Governed durable reservation before EVERY physical POST; a refusal is a
      // fail-closed zero-POST outcome, never a direct fallback.
      if (hooks) {
        try {
          const reserved: unknown = await hooks.reservePrePost({
            repo,
            issue,
            reportId,
            dataDigest: digest,
          });
          if (!validReservation(reserved)) {
            return {
              state: "NOT_PUBLISHED",
              reason:
                "PRE_POST_RESERVATION_REFUSED: reservation receipt missing/blank/invalid; governed mode failed closed before POST",
              effectMeta: metaFor("PROVEN_NOT_SENT", "PRE_POST_RESERVATION_REFUSED"),
            };
          }
        } catch {
          return {
            state: "NOT_PUBLISHED",
            reason: "PRE_POST_RESERVATION_REFUSED: governed mode failed closed before POST",
            effectMeta: metaFor("PROVEN_NOT_SENT", "PRE_POST_RESERVATION_REFUSED"),
          };
        }
      }
      try {
        created = await client.createIssueComment(repo, issue, body);
      } catch (err) {
        const e = err as { status?: unknown };
        lastHttpStatus = typeof e?.status === "number" ? e.status : null;
        const c = classify(err);
        if (c.kind === "fatal") {
          // Definitive rejection: the server did not process the create.
          await recordEffectSafe("PROVEN_NOT_SENT", "NOT_PUBLISHED");
          return {
            state: "NOT_PUBLISHED",
            reason: c.reason,
            effectMeta: metaFor("PROVEN_NOT_SENT", "HTTP_FATAL_REJECTION"),
          };
        }
        // Ambiguous transport (SENT_OR_MAY_HAVE_SENT / lost ACK / unknown 429/503/403).
        // Reconcile by readback ONLY; a complete zero-match list does NOT prove
        // non-send, so no further same-call POST ever happens.
        const post = await readback();
        if (post.found) {
          const outcome = reconciled(post);
          const foundEffect = effectForExisting(outcome);
          await recordEffectSafe(foundEffect, outcome.state);
          return { ...outcome, effectMeta: metaFor(foundEffect, null) };
        }
        const backoff = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        await sleep(c.waitMs === null ? backoff : Math.min(c.waitMs, MAX_RETRY_AFTER_MS));
        const again = await readback();
        if (again.found) {
          const outcome = reconciled(again);
          const foundEffect = effectForExisting(outcome);
          await recordEffectSafe(foundEffect, outcome.state);
          return { ...outcome, effectMeta: metaFor(foundEffect, null) };
        }
        await recordEffectSafe("SENT_OR_MAY_HAVE_SENT", "NOT_PUBLISHED");
        return {
          state: "NOT_PUBLISHED",
          reason: `AMBIGUOUS_TRANSPORT: ${c.reason}; same-call POST stopped (delayed commit still possible; zero-match readback is not non-send proof)`,
          effectMeta: metaFor("SENT_OR_MAY_HAVE_SENT", "AMBIGUOUS_TRANSPORT"),
        };
      }
    }

    // Confirm the comment we just created by full-pagination readback.
    const stored = await findById(
      client,
      repo,
      issue,
      (created as IssueComment).id,
      perPage,
      pageGate,
    );
    if (stored === null) {
      await recordEffectSafe("SENT_OR_MAY_HAVE_SENT", "NOT_PUBLISHED");
      return {
        state: "NOT_PUBLISHED",
        reason: "readback mismatch: created comment not found",
        effectMeta: metaFor("SENT_OR_MAY_HAVE_SENT", "POST_COMMIT_READBACK_MISS"),
      };
    }
    const back = parseReportComment(stored.body);
    if (!back.ok || identityOf(issue, back.doc.data) !== identity || back.dataDigest !== digest) {
      await recordEffectSafe("REMOTE_DIFFERENT_OR_DAMAGED", "NOT_PUBLISHED");
      return {
        state: "NOT_PUBLISHED",
        reason: "readback mismatch",
        effectMeta: metaFor("REMOTE_DIFFERENT_OR_DAMAGED", "POST_COMMIT_READBACK_MISMATCH"),
      };
    }
    await recordEffectSafe("REMOTE_SAME", "PUBLISHED");
    return { state: "PUBLISHED", comment: stored, effectMeta: metaFor("REMOTE_SAME", null) };
  } catch (err) {
    if (err instanceof HookRefusalError) {
      // A POST already attempted means non-send is NOT proven when the budget
      // dies during reconciliation; stay conservative.
      const effect: PostEffect = attempts > 0 ? "SENT_OR_MAY_HAVE_SENT" : "PROVEN_NOT_SENT";
      await recordEffectSafe(effect, "NOT_PUBLISHED");
      return {
        state: "NOT_PUBLISHED",
        reason:
          attempts > 0
            ? `${err.code}: budget exhausted during ambiguous-transport reconciliation`
            : err.code,
        effectMeta: metaFor(effect, err.code),
      };
    }
    return { state: "NOT_PUBLISHED", reason: `error: ${String((err as Error)?.message ?? err)}` };
  }
}
