import {
  loadAdoption,
  parseReportComment,
  REPORT_MARKER,
  resolveProfile,
} from "../report/index.ts";
import { checkPublicationGrant, loadPublicationPolicy } from "./authority.ts";
import type { GitHubClient, IssueComment } from "./client.ts";

export type PublishOutcome =
  | { state: "PUBLISHED"; comment: IssueComment }
  | { state: "ALREADY_PUBLISHED"; comment: IssueComment }
  | { state: "CONFLICT"; comment: IssueComment; existingDigest: string; newDigest: string }
  | { state: "DRY_RUN"; body: string; dataDigest: string }
  | { state: "NOT_PUBLISHED"; reason: string };

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
): Promise<FindResult> {
  const entries: ReportEntry[] = [];
  const damaged: FindResult["damaged"] = [];
  let ignored = 0;
  let total = 0;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error("pagination did not terminate");
    const res = await client.listIssueComments(repo, issue, page, perPage);
    for (const c of res.comments) {
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
  maxRetries?: number;
  now?: () => number;
  perPage?: number;
  /** Explicit isolated candidate test purpose; does not override repository allowlisting. */
  e2eTestOnly?: boolean;
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
): Promise<IssueComment | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.listIssueComments(repo, issue, page, perPage);
    const hit = res.comments.find((c) => c.id === id);
    if (hit) return hit;
    if (!res.hasNext) return null;
  }
  throw new Error("pagination did not terminate");
}

export async function publishReport(
  client: GitHubClient,
  opts: PublishOptions,
): Promise<PublishOutcome> {
  const { repo, issue, body } = opts;
  const sleep = opts.sleep ?? realSleep;
  const maxRetries = opts.maxRetries ?? 3;
  const perPage = opts.perPage ?? PER_PAGE;

  const parsed = parseReportComment(body);
  if (!parsed.ok) return { state: "NOT_PUBLISHED", reason: `invalid report body: ${parsed.error}` };
  const data = parsed.doc.data;
  const subject = (data.subject ?? {}) as {
    repository?: unknown;
    issue_ref?: unknown;
    ads_revision?: unknown;
    publisher_source_sha?: unknown;
  };
  // This is the LAST in-process GitHub write boundary. A caller cannot bypass
  // v5 adoption admission merely by rendering a valid document and invoking
  // publishReport directly.
  if (opts.publish && parsed.doc.schema === "ads/github/v5") {
    if (typeof subject.ads_revision !== "string") {
      return {
        state: "NOT_PUBLISHED",
        reason: "ADS_PIN_REQUIRED: missing v5 subject.ads_revision",
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
    if (!gate.ok) return { state: "NOT_PUBLISHED", reason: `${gate.code}: ${gate.message}` };
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
      };
    }
    // The source profile gate above is necessary but NOT a clearance grant.
    // Only an independently version-governed exact projection permit with
    // corresponding real GitHub native Issue comment qualifies ordinary v5.
    // E2E_TEST_SUBJECT is separately isolated by exact repo + test-purpose flag.
    if (gate.mode === "ADOPTED") {
      try {
        const clearance = await checkPublicationGrant(client, {
          repository: repo,
          issueNumber: issue,
          publisherNamespace: String(data.publisher_namespace),
          adsRevision: subject.ads_revision,
          publisherSourceSha: subject.publisher_source_sha,
          publicationRef: publication.clearance_ref,
          data,
        }, loadPublicationPolicy());
        if (!clearance.ok) {
          return { state: "NOT_PUBLISHED", reason: clearance.code };
        }
      } catch {
        return { state: "NOT_PUBLISHED", reason: "CLEARANCE_SOURCE_UNAVAILABLE" };
      }
    }
  }
  if (subject.repository !== repo) {
    return {
      state: "NOT_PUBLISHED",
      reason: "report subject.repository does not match target repo",
    };
  }
  if (
    typeof subject.issue_ref !== "string" ||
    !subject.issue_ref.endsWith(`/${repo}/issues/${issue}`)
  ) {
    return {
      state: "NOT_PUBLISHED",
      reason: "report subject.issue_ref does not match target issue",
    };
  }
  const identity = identityOf(issue, data);
  const digest = parsed.dataDigest;

  let lastFind: FindResult | null = null;
  const readback = async (): Promise<Decision> => {
    lastFind = await findReports(client, repo, issue, perPage);
    return decide(lastFind.entries, identity, digest);
  };

  try {
    const pre = await readback();
    if (pre.found) return pre.outcome;
    const reportId = String(data.report_id);
    const broken = (lastFind as FindResult | null)?.damaged.find((d) => d.reportId === reportId);
    if (broken) {
      return {
        state: "NOT_PUBLISHED",
        reason: `UNVERIFIED_EXISTING: comment ${broken.comment.id} carries report_id ${reportId} but is not a valid report (edited or damaged); not posting a second copy`,
      };
    }
    if (!opts.publish) return { state: "DRY_RUN", body, dataDigest: digest };

    let created: IssueComment | null = null;
    for (let attempt = 0; created === null; attempt++) {
      try {
        created = await client.createIssueComment(repo, issue, body);
      } catch (err) {
        const c = classify(err);
        if (c.kind === "fatal") return { state: "NOT_PUBLISHED", reason: c.reason };
        // The failed POST may have committed: reconcile before any further write.
        const post = await readback();
        if (post.found) return reconciled(post);
        if (attempt >= maxRetries) {
          return {
            state: "NOT_PUBLISHED",
            reason: `gave up after ${attempt + 1} attempts: ${c.reason}`,
          };
        }
        const backoff = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        await sleep(c.waitMs === null ? backoff : Math.min(c.waitMs, MAX_RETRY_AFTER_MS));
        const again = await readback();
        if (again.found) return reconciled(again);
      }
    }

    // Confirm the comment we just created by full-pagination readback.
    const stored = await findById(client, repo, issue, created.id, perPage);
    if (stored === null) {
      return { state: "NOT_PUBLISHED", reason: "readback mismatch: created comment not found" };
    }
    const back = parseReportComment(stored.body);
    if (!back.ok || identityOf(issue, back.doc.data) !== identity || back.dataDigest !== digest) {
      return { state: "NOT_PUBLISHED", reason: "readback mismatch" };
    }
    return { state: "PUBLISHED", comment: stored };
  } catch (err) {
    return { state: "NOT_PUBLISHED", reason: `error: ${String((err as Error)?.message ?? err)}` };
  }
}
