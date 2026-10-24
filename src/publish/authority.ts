// Source-owned private publication clearance policy. NOT an ADS public wire extension.
// An arbitrary clearance_ref string or report.claimed PUBLISHABLE is never proof.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalDigest } from "../canonical.ts";
import type { GitHubClient } from "./client.ts";

export interface PublicationGrant {
  /** Exact canonical native GitHub Issue comment URL that carries the owner grant. */
  clearance_ref: string;
  repository: string;
  issue_number: number;
  publisher_namespace: string;
  ads_revision: string;
  publisher_source_sha: string;
  /** Digest of exactly the public report data excluding self-referential publication. */
  projection_digest: string;
  /** Hash of the exact separate native authorization comment body. */
  authorization_body_sha256: string;
}
export interface PublicationPolicy {
  policy: "task-meta/publication-authority/v1";
  /** Version-controlled, release-reviewed grants; no wildcard repo/Issue/source scopes. */
  grants: PublicationGrant[];
}
export interface ClearanceTarget {
  repository: string;
  issueNumber: number;
  publisherNamespace: string;
  adsRevision: string;
  publisherSourceSha: string;
  publicationRef: string;
  /** Validated JSON data from a strict existing v5 report, not a raw untrusted string. */
  data: Record<string, unknown>;
}
export type ClearanceResult =
  | { ok: true }
  | { ok: false; code: "MISSING_SOURCE_CLEARANCE" | "CLEARANCE_SOURCE_MISMATCH" | "CLEARANCE_NATIVE_UNVERIFIED" };

const POLICY_PATH = new URL("../../config/publication-clearances.json", import.meta.url);
const GH_REF = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)#issuecomment-([1-9][0-9]*)$/;
const SHA40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const hash = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const refuse = (code: Exclude<ClearanceResult, { ok: true }>["code"]): ClearanceResult => ({ ok: false, code });

export function loadPublicationPolicy(): PublicationPolicy {
  const obj: unknown = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
  if (
    !obj || typeof obj !== "object" || Array.isArray(obj) ||
    (obj as PublicationPolicy).policy !== "task-meta/publication-authority/v1" ||
    !Array.isArray((obj as PublicationPolicy).grants)
  ) throw new Error("invalid source-owned publication policy");
  return obj as PublicationPolicy;
}

/** Separate version-governed policy + actual native GitHub readback must BOTH agree. */
export async function checkPublicationGrant(
  client: Pick<GitHubClient, "listIssueComments">,
  target: ClearanceTarget,
  policy: PublicationPolicy,
): Promise<ClearanceResult> {
  const { publication, ...projection } = target.data;
  const declared = publication as Record<string, unknown> | null | undefined;
  if (
    !declared || declared.classification !== "PUBLISHABLE" ||
    declared.clearance_ref !== target.publicationRef ||
    declared.projection_digest !== canonicalDigest(projection)
  ) return refuse("CLEARANCE_SOURCE_MISMATCH");
  const parsed = GH_REF.exec(target.publicationRef);
  if (
    !parsed || `${parsed[1]}/${parsed[2]}` !== target.repository ||
    Number(parsed[3]) !== target.issueNumber || !SHA40.test(target.adsRevision) ||
    !SHA40.test(target.publisherSourceSha)
  ) return refuse("CLEARANCE_SOURCE_MISMATCH");
  const exact = policy.grants.filter((g) =>
    g.clearance_ref === target.publicationRef &&
    g.repository === target.repository && g.issue_number === target.issueNumber &&
    g.publisher_namespace === target.publisherNamespace &&
    g.ads_revision === target.adsRevision &&
    g.publisher_source_sha === target.publisherSourceSha &&
    g.projection_digest === declared.projection_digest &&
    HEX64.test(g.authorization_body_sha256)
  );
  if (exact.length !== 1) return refuse("MISSING_SOURCE_CLEARANCE");
  const grant = exact[0];
  if (!grant) return refuse("MISSING_SOURCE_CLEARANCE");
  // A claimed grant is not source evidence until the exact GitHub-issued native
  // comment ID, canonical URL, validated identity and immutable body digest read back.
  const expectedId = Number(parsed[4]);
  if (!Number.isSafeInteger(expectedId)) return refuse("CLEARANCE_SOURCE_MISMATCH");
  try {
    let complete = false;
    let found = false;
    for (let page = 1; page <= 100; page++) {
      const res = await client.listIssueComments(target.repository, target.issueNumber, page, 100);
      if (!Array.isArray(res.comments) || typeof res.hasNext !== "boolean") {
        return refuse("CLEARANCE_NATIVE_UNVERIFIED");
      }
      for (const c of res.comments) {
        if (c.id !== expectedId) continue;
        if (c.html_url !== target.publicationRef || hash(c.body) !== grant.authorization_body_sha256) {
          return refuse("CLEARANCE_NATIVE_UNVERIFIED");
        }
        // The exact owner-governed policy pins the actual native body; merely
        // copying a clearance URL or asserting a GitHub login cannot create a grant.
        found = true;
      }
      if (!res.hasNext) { complete = true; break; }
      if (res.comments.length === 0) return refuse("CLEARANCE_NATIVE_UNVERIFIED");
    }
    return found && complete ? { ok: true } : refuse("CLEARANCE_NATIVE_UNVERIFIED");
  } catch {
    return refuse("CLEARANCE_NATIVE_UNVERIFIED");
  }
}
