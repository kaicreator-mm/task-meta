// Source-qualified publication grant fixtures for ordinary v5 publish tests.
// Mirrors the governed owner registration in docs/v0.3/PUBLICATION_CLEARANCE_POLICY.md:
// the fixture acts as the version-reviewed grant registrar binding the EXACT
// owning Issue, publisher namespace, ADS revision, publisher source SHA and
// canonical public projection digest, plus the native owner approval comment.
// publishReport still fully verifies the grant (URL form, digest match, exact
// native comment id/url/body-hash readback, permission witness); production
// paths keep loading the shipped empty fail-closed config/publication-clearances.json.
import { createHash } from "node:crypto";
import type {
  ClearanceTarget,
  PublicationPolicy,
  PublicationPolicyProvider,
} from "../../src/publish/authority.ts";
import type { IssueComment } from "../../src/publish/index.ts";

export const OWNER_GRANT_ID = 900;
export const OWNER_GRANT_BODY =
  "<!-- task-meta test fixture: owner-approved PUBLISHABLE projection, registered as a governed grant -->";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function ownerClearanceRef(repo: string, issue: number, id = OWNER_GRANT_ID): string {
  return `https://github.com/${repo}/issues/${issue}#issuecomment-${id}`;
}

export function ownerGrantComment(repo: string, issue: number, id = OWNER_GRANT_ID): IssueComment {
  return {
    id,
    html_url: ownerClearanceRef(repo, issue, id),
    body: OWNER_GRANT_BODY,
    user_login: "owner",
    created_at: "2026-10-23T00:00:00Z",
  };
}

/** Registers the governed grant for exactly the projection being published. */
export const fixtureGrantPolicy = (ownerBody = OWNER_GRANT_BODY): PublicationPolicyProvider => {
  const provider = (target: ClearanceTarget): PublicationPolicy => ({
    policy: "task-meta/publication-authority/v1",
    grants: [
      {
        clearance_ref: target.publicationRef,
        repository: target.repository,
        issue_number: target.issueNumber,
        publisher_namespace: target.publisherNamespace,
        ads_revision: target.adsRevision,
        publisher_source_sha: target.publisherSourceSha,
        projection_digest: (target.data.publication as { projection_digest: string })
          .projection_digest,
        authorization_body_sha256: sha256(ownerBody),
      },
    ],
  });
  return provider;
};
