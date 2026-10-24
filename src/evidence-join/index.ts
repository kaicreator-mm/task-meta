// v0.3 T01: private, read-only, source-qualified GitHub report references.
// Not an ADS wire format and NOT a Tally consumer/material-use ledger.

import type { GitHubClient, IssueComment } from "../publish/client.ts";
import { parseReportComment, REPORT_MARKER } from "../report/index.ts";

export type JoinState = "VERIFIED_REFERENCE" | "UNKNOWN" | "CONFLICT";
export type FeedbackPhase =
  | "PRESENTED"
  | "ACCEPTED"
  | "APPLIED"
  | "SKIPPED"
  | "INDEPENDENTLY_CHECKED"
  | "OBSERVED_EFFECT";

export interface QualifiedReportRef {
  kind: "ADS_REPORT";
  repository: string;
  issueNumber: number;
  commentId: number;
  commentUrl: string;
  profile: "v4" | "v5";
  reportId: string;
  revision: number;
  publisherNamespace: string;
  reportKind: string;
  taskRef: string;
  attemptRef: string;
  dataDigest: string;
  sourceRefs: string[];
  /** Actual source-phase assertion, not proof it occurred in Tally. */
  feedbackPhase: FeedbackPhase | null;
}
export type GitHubEvidenceResult =
  | { state: "COMPLETE"; reports: QualifiedReportRef[]; ignored: number }
  | { state: "UNKNOWN" | "CONFLICT"; reports: []; limits: string[] };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PHASES = new Set<FeedbackPhase>([
  "PRESENTED",
  "ACCEPTED",
  "APPLIED",
  "SKIPPED",
  "INDEPENDENTLY_CHECKED",
  "OBSERVED_EFFECT",
]);
const MAX_PAGES = 100;
const PER_PAGE = 100;
const MAX_REPORTS = 50_000;

function reportIdentity(r: QualifiedReportRef): string {
  return JSON.stringify([
    r.repository,
    r.issueNumber,
    r.publisherNamespace,
    r.reportId,
    r.revision,
    r.reportKind,
  ]);
}
function publicIssueUrl(repo: string, issue: number): string {
  return `https://github.com/${repo}/issues/${issue}`;
}
function refFromComment(
  comment: IssueComment,
  repo: string,
  issue: number,
): QualifiedReportRef | null {
  if (!Number.isSafeInteger(comment.id) || comment.id <= 0) return null;
  const native = `${publicIssueUrl(repo, issue)}#issuecomment-${comment.id}`;
  if (comment.html_url !== native) return null;
  const parsed = parseReportComment(comment.body);
  if (!parsed.ok) return null;
  const data = parsed.doc.data;
  const subject = data.subject as Record<string, unknown> | undefined;
  if (
    subject?.repository !== repo ||
    subject.issue_ref !== publicIssueUrl(repo, issue) ||
    typeof subject.task_ref !== "string" ||
    typeof subject.attempt_ref !== "string" ||
    typeof data.report_id !== "string" ||
    typeof data.publisher_namespace !== "string" ||
    typeof data.report_kind !== "string" ||
    typeof data.revision !== "number" ||
    !Number.isSafeInteger(data.revision)
  )
    return null;
  const phase =
    data.report_kind === "EXPERIENCE_USE_FEEDBACK" && parsed.profile === "v5" ? data.phase : null;
  if (phase !== null && !PHASES.has(phase as FeedbackPhase)) return null;
  const refs = data.source_refs;
  if (!Array.isArray(refs) || !refs.every((v) => typeof v === "string")) return null;
  return {
    kind: "ADS_REPORT",
    repository: repo,
    issueNumber: issue,
    commentId: comment.id,
    commentUrl: native,
    profile: parsed.profile,
    reportId: data.report_id,
    revision: Number(data.revision),
    publisherNamespace: data.publisher_namespace,
    reportKind: data.report_kind,
    taskRef: subject.task_ref,
    attemptRef: subject.attempt_ref,
    dataDigest: parsed.dataDigest,
    sourceRefs: refs as string[],
    feedbackPhase: phase as FeedbackPhase | null,
  };
}

/**
 * Read all pages of actual native GitHub comments. Never infer a report is absent
 * after a failed/partial page. Bodies and report-supplied URLs are untrusted;
 * no arbitrary URL is followed.
 */
export async function readQualifiedReports(
  client: Pick<GitHubClient, "listIssueComments">,
  repo: string,
  issue: number,
): Promise<GitHubEvidenceResult> {
  if (!REPO.test(repo) || !Number.isSafeInteger(issue) || issue <= 0) {
    return { state: "UNKNOWN", reports: [], limits: ["invalid canonical owning Issue"] };
  }
  const reports: QualifiedReportRef[] = [];
  let ignored = 0;
  const actualIds = new Map<number, string>();
  const identities = new Map<string, string>();
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let r: Awaited<ReturnType<GitHubClient["listIssueComments"]>>;
    try {
      r = await client.listIssueComments(repo, issue, page, PER_PAGE);
    } catch {
      return { state: "UNKNOWN", reports: [], limits: ["GitHub native pagination unavailable"] };
    }
    if (!Array.isArray(r.comments) || typeof r.hasNext !== "boolean") {
      return {
        state: "UNKNOWN",
        reports: [],
        limits: ["invalid GitHub native pagination response"],
      };
    }
    for (const comment of r.comments) {
      if (actualIds.size + ignored >= MAX_REPORTS) {
        return { state: "UNKNOWN", reports: [], limits: ["bounded public-read limit exceeded"] };
      }
      const old = actualIds.get(comment.id);
      if (old !== undefined && old !== comment.body) {
        return {
          state: "CONFLICT",
          reports: [],
          limits: ["native comment identity changed content"],
        };
      }
      if (old !== undefined) continue;
      actualIds.set(comment.id, comment.body);
      if (!comment.body.startsWith(REPORT_MARKER)) {
        ignored++;
        continue;
      }
      const ref = refFromComment(comment, repo, issue);
      if (ref === null) {
        return {
          state: "UNKNOWN",
          reports: [],
          limits: ["damaged or foreign ADS report identity"],
        };
      }
      const id = reportIdentity(ref);
      const prior = identities.get(id);
      if (prior !== undefined && prior !== ref.dataDigest) {
        return {
          state: "CONFLICT",
          reports: [],
          limits: ["Report identity and data digest conflict"],
        };
      }
      identities.set(id, ref.dataDigest);
      reports.push(ref);
    }
    if (!r.hasNext) {
      complete = true;
      break;
    }
    if (r.comments.length === 0) {
      return { state: "UNKNOWN", reports: [], limits: ["nonterminal empty GitHub page"] };
    }
  }
  if (!complete)
    return { state: "UNKNOWN", reports: [], limits: ["terminal GitHub page not witnessed"] };
  return { state: "COMPLETE", reports, ignored };
}

export interface FactualFeedbackJoin {
  state: JoinState;
  report: QualifiedReportRef | null;
  feedback: QualifiedReportRef | null;
  phase: FeedbackPhase | null;
  /** Public source-reference existence NEVER proves downstream use or quality. */
  materialUse: "UNKNOWN";
  effectiveness: "UNKNOWN";
  limits: string[];
}

/**
 * Join only by actual native Issue/comment source refs, with matching Task+Attempt.
 * Tally's local material-use and decision state are not readable from this join.
 */
export function joinFeedbackToSummary(
  view: GitHubEvidenceResult,
  summaryUrl: string,
  feedbackUrl: string,
): FactualFeedbackJoin {
  const unknown = (reason: string): FactualFeedbackJoin => ({
    state: "UNKNOWN",
    report: null,
    feedback: null,
    phase: null,
    materialUse: "UNKNOWN",
    effectiveness: "UNKNOWN",
    limits: [reason],
  });
  if (view.state !== "COMPLETE")
    return unknown("GitHub native source readback incomplete or conflicted");
  const summary = view.reports.find(
    (r) => r.commentUrl === summaryUrl && r.reportKind === "EXECUTION_SUMMARY",
  );
  const feedback = view.reports.find(
    (r) =>
      r.commentUrl === feedbackUrl &&
      r.reportKind === "EXPERIENCE_USE_FEEDBACK" &&
      r.feedbackPhase !== null,
  );
  if (!summary || !feedback) return unknown("missing actual summary or feedback native comment");
  if (
    summary.repository !== feedback.repository ||
    summary.issueNumber !== feedback.issueNumber ||
    summary.taskRef !== feedback.taskRef ||
    summary.attemptRef !== feedback.attemptRef
  )
    return unknown("cross-source Task/Attempt owner mismatch");
  if (!feedback.sourceRefs.includes(summary.commentUrl)) {
    return unknown("feedback does not explicitly reference the actual summary native comment");
  }
  return {
    state: "VERIFIED_REFERENCE",
    report: summary,
    feedback,
    phase: feedback.feedbackPhase,
    materialUse: "UNKNOWN",
    effectiveness: "UNKNOWN",
    limits: ["public source association does not prove Tally consumed a material premise"],
  };
}
