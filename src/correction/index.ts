// v0.3 T02: immutable correction target qualification; private read-only helper.
// This layer NEVER edits native GitHub Report history or private CAS manifests.
import { parseReportComment } from "../report/index.ts";
import type { GitHubClient, IssueComment } from "../publish/client.ts";

export type CorrectionNotice = "REVOKE" | "REDACT" | "DISPUTE";
export type TargetLookup =
  | { state: "VERIFIED_CURRENT"; comment: IssueComment; digest: string; profile: "v4" | "v5"; correctionDigest: string }
  | { state: "UNKNOWN" | "CONFLICT"; reason: string };

export interface CorrectionDisposition {
  state: "VERIFIED_REVOKED_OR_REDACTED" | "DISPUTED_NONREVOKING" | "UNKNOWN";
  materialUseSafe: false;
  reason: string;
}
export interface VerifiedAuthority {
  /** Authenticated source-owner decision is proved elsewhere, not from GitHub login. */
  qualification: "VERIFIED" | "UNKNOWN";
  publisherNamespace: string;
  taskRef: string;
  attemptRef: string | null;
  evidenceRefs: string[];
}

type Raw = Record<string, unknown>;
const MAX_PAGES = 1000;
const PER_PAGE = 100;
const isObject = (x: unknown): x is Raw => x !== null && typeof x === "object" && !Array.isArray(x);
const issueUrl = (repo: string, issue: number) => `https://github.com/${repo}/issues/${issue}`;

/** Read a specific native target to exhaustion (including after a hit).
 * A valid report alone is NOT evidence the notice authority is verified. */
export async function readCorrectionTarget(
  client: Pick<GitHubClient, "listIssueComments">,
  repo: string,
  issue: number,
  correctionBody: string,
): Promise<TargetLookup> {
  const parsed = parseReportComment(correctionBody);
  if (!parsed.ok || parsed.doc.data.report_kind !== "EXECUTION_CORRECTION") {
    return { state: "UNKNOWN", reason: "no schema-qualified correction" };
  }
  const data = parsed.doc.data;
  const target = data.target;
  if (!isObject(target) || !Number.isSafeInteger(target.comment_id) ||
    typeof target.comment_ref !== "string" || typeof target.report_id !== "string" ||
    typeof target.data_digest !== "string" || typeof target.publisher_namespace !== "string" ||
    typeof target.task_ref !== "string" || typeof target.report_kind !== "string" ||
    typeof target.revision !== "number" || !Number.isSafeInteger(target.revision)
  ) return { state: "UNKNOWN", reason: "invalid exact target identity" };
  if (
    target.issue_ref !== issueUrl(repo, issue) ||
    target.comment_ref !== `${issueUrl(repo, issue)}#issuecomment-${target.comment_id}` ||
    (parsed.profile === "v5" && (
      target.repository !== repo || target.ads_profile !== "ads/github/v5:report" ||
      typeof target.attempt_ref !== "string"
    ))
  ) return { state: "UNKNOWN", reason: "target repo/profile/native URL mismatch" };

  const targetId = target.comment_id;
  let found: IssueComment | null = null;
  let terminal = false;
  const seen = new Map<number, string>();
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await client.listIssueComments(repo, issue, page, PER_PAGE);
      if (!Array.isArray(res.comments) || typeof res.hasNext !== "boolean" ||
        (res.hasNext && res.comments.length === 0)) {
        return { state: "UNKNOWN", reason: "malformed/partial native pagination" };
      }
      for (const comment of res.comments) {
        if (!Number.isSafeInteger(comment.id) || comment.id < 1) {
          return { state: "UNKNOWN", reason: "malformed GitHub native comment identity" };
        }
        const previous = seen.get(comment.id);
        if (previous !== undefined && previous !== comment.body) {
          return { state: "CONFLICT", reason: "same native comment changed during readback" };
        }
        seen.set(comment.id, comment.body);
        if (comment.id === targetId) {
          if (comment.html_url !== target.comment_ref) {
            return { state: "CONFLICT", reason: "actual native URL does not match requested target" };
          }
          found = comment;
        }
      }
      if (!res.hasNext) { terminal = true; break; }
    }
  } catch {
    return { state: "UNKNOWN", reason: "GitHub readback failed before terminal page" };
  }
  if (!terminal) return { state: "UNKNOWN", reason: "pagination bound exhausted" };
  if (!found) return { state: "UNKNOWN", reason: "target native comment not observed" };

  const source = parseReportComment(found.body);
  if (!source.ok || source.profile !== parsed.profile) {
    return { state: "UNKNOWN", reason: "target edited, damaged or from other ADS profile" };
  }
  const original = source.doc.data;
  const subject = original.subject;
  if (
    !isObject(subject) ||
    subject.repository !== repo || subject.issue_ref !== issueUrl(repo, issue) ||
    original.report_id !== target.report_id ||
    original.revision !== target.revision ||
    original.report_kind !== target.report_kind ||
    original.publisher_namespace !== target.publisher_namespace ||
    subject.task_ref !== target.task_ref ||
    source.dataDigest !== target.data_digest ||
    (parsed.profile === "v5" &&
      (subject.attempt_ref !== target.attempt_ref ||
       subject.source_status !== target.target_source_status ||
       subject.source_sha !== target.target_source_sha))
  ) return { state: "CONFLICT", reason: "original report source identity/current digest differs" };
  return { state: "VERIFIED_CURRENT", comment: found, digest: source.dataDigest, profile: source.profile, correctionDigest: parsed.dataDigest };
}

/** Authority must be source-qualified by a separate owner mechanism.
 * DISPUTE by any actor (including the owner) never acts as a REVOKE. */
export function dispositionOfCorrection(
  correctionBody: string, target: TargetLookup, authority: VerifiedAuthority,
): CorrectionDisposition {
  if (target.state !== "VERIFIED_CURRENT") {
    return { state: "UNKNOWN", materialUseSafe: false, reason: "target not independently current" };
  }
  const parsed = parseReportComment(correctionBody);
  if (!parsed.ok || parsed.doc.data.report_kind !== "EXECUTION_CORRECTION") {
    return { state: "UNKNOWN", materialUseSafe: false, reason: "correction schema invalid" };
  }
  if (target.correctionDigest !== parsed.dataDigest || target.profile !== parsed.profile) {
    return { state: "UNKNOWN", materialUseSafe: false,
      reason: "correction source identity differs from the target evidence witness" };
  }
  const d = parsed.doc.data;
  const subject = d.subject;
  if (!isObject(subject) || !isObject(d.target)) {
    return { state: "UNKNOWN", materialUseSafe: false, reason: "source owner/target missing" };
  }
  if (d.notice === "DISPUTE") {
    return { state: "DISPUTED_NONREVOKING", materialUseSafe: false,
      reason: "DISPUTE alone never revokes, even from an owner; affected downstream claims need independent qualification" };
  }
  if (d.notice !== "REVOKE" && d.notice !== "REDACT") {
    return { state: "UNKNOWN", materialUseSafe: false, reason: "unknown correction notice" };
  }
  if (authority.qualification !== "VERIFIED" || authority.evidenceRefs.length === 0 ||
    authority.publisherNamespace !== d.target.publisher_namespace ||
    authority.taskRef !== d.target.task_ref ||
    authority.attemptRef !== (parsed.profile === "v5" ? d.target.attempt_ref : null) ||
    d.publisher_namespace !== authority.publisherNamespace ||
    subject.task_ref !== authority.taskRef ||
    (parsed.profile === "v5" && subject.attempt_ref !== authority.attemptRef)
  ) return { state: "UNKNOWN", materialUseSafe: false,
    reason: "source-owned revocation authority is not independently verified" };
  return { state: "VERIFIED_REVOKED_OR_REDACTED", materialUseSafe: false,
    reason: "owner-qualified notice applies to exact native target only, no historical mutation" };
}
