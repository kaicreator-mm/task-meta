import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalDigest } from "../src/canonical.ts";
import { checkPublicationGrant, type PublicationPolicy } from "../src/publish/authority.ts";
import type { GitHubClient } from "../src/publish/client.ts";

const REPO = "kaicreator-mm/example";
const ISSUE = 12;
const ADOPTED = "718fb02e33b31f568736447b2b905883cc6fcc3a";
const PUBLISHER = "b".repeat(40);
const URL = `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-101`;
const body =
  "<!-- owner: PUBLISHABLE source-cleared projection, signed by governed repo version -->";
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const projection = {
  report_id: "r1",
  revision: 1,
  publisher_namespace: "task-meta:source-owner",
  report_kind: "EXECUTION_SUMMARY",
};
const projectionDigest = canonicalDigest(projection);
const target = () => ({
  repository: REPO,
  issueNumber: ISSUE,
  publisherNamespace: "task-meta:source-owner",
  adsRevision: ADOPTED,
  publisherSourceSha: PUBLISHER,
  publicationRef: URL,
  data: {
    ...projection,
    publication: {
      classification: "PUBLISHABLE",
      clearance_ref: URL,
      projection_digest: projectionDigest,
    },
  },
});
const policy: PublicationPolicy = {
  policy: "task-meta/publication-authority/v1",
  grants: [
    {
      clearance_ref: URL,
      repository: REPO,
      issue_number: ISSUE,
      publisher_namespace: "task-meta:source-owner",
      ads_revision: ADOPTED,
      publisher_source_sha: PUBLISHER,
      projection_digest: projectionDigest,
      authorization_body_sha256: digest(body),
    },
  ],
};
const client = (nativeBody = body, available = true): Pick<GitHubClient, "listIssueComments"> => ({
  async listIssueComments() {
    if (!available) throw Error("403");
    return {
      comments: [
        {
          id: 101,
          html_url: URL,
          body: nativeBody,
          user_login: "transport-not-owner",
        },
      ],
      hasNext: false,
    };
  },
});

test("T00 source-qualified projection permit requires BOTH versioned policy and actual GitHub comment", async () => {
  assert.deepEqual(await checkPublicationGrant(client(), target(), policy), { ok: true });
  const p = { ...policy, grants: [] };
  const missing = await checkPublicationGrant(client(), target(), p);
  assert.equal(missing.ok, false);
});

test("T00 forged/edited/missing clearance, missing pagination and source mismatch hold closed", async () => {
  assert.equal((await checkPublicationGrant(client("tampered"), target(), policy)).ok, false);
  assert.equal((await checkPublicationGrant(client(body, false), target(), policy)).ok, false);
  const forged = target();
  forged.data.publication.clearance_ref = "fake-owner-ref";
  assert.equal((await checkPublicationGrant(client(), forged, policy)).ok, false);
  const drift = target();
  drift.data.report_id = "changed-after-clearance";
  assert.equal((await checkPublicationGrant(client(), drift, policy)).ok, false);
  const foreign = target();
  foreign.repository = "another/repo";
  assert.equal((await checkPublicationGrant(client(), foreign, policy)).ok, false);
});
