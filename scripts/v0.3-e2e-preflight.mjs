// task-meta v0.3 T06 — Host preflight only. All GitHub operations here are GET.
// No publication, Agent run, secrets or Release PASS can be produced by this script.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REPO = "kaicreator-mm/task-meta-e2e";
const ISSUE = 9;
const ADS_CANDIDATE = "3041a1be3f130e5cc5e676c2e56a99882adfd97c";
const ADS_V5_BLOB = "7478313cc006162432649d734e59c5cd77db5106";
const TARGET_URL = `https://github.com/${REPO}/issues/${ISSUE}`;

function cmd(binary, args) {
  return execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }).trim();
}
function api(path) {
  // No shell, no interpolation from arguments/env, GET only, no arbitrary URLs.
  return JSON.parse(cmd("gh", ["api", "-H", "Accept: application/vnd.github+json", path]));
}
function blobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
const result = {
  profile: "task-meta/v0.3/T06/host-preflight-readonly",
  repo: REPO,
  issue: ISSUE,
  purpose: "isolated test only",
  node24: "NOT_RUN",
  exact_head: "UNKNOWN",
  clean_tree: "UNKNOWN",
  candidate_adoption_allowlist: "UNKNOWN",
  actual_v5_schema_blob: "UNKNOWN",
  real_host_repo_permission: "UNKNOWN",
  real_native_issue: "UNKNOWN",
  real_zcode: "NOT_RUN",
  real_claude_code: "NOT_RUN",
  real_codex: "NOT_RUN",
  actual_taskmeta_post: "NOT_RUN",
  actual_taskmeta_readback: "NOT_RUN",
  release: "NOT_RUN",
};
let failed = false;
function fail(field, reason) {
  result[field] = `FAIL:${reason}`;
  failed = true;
}
const major = Number(process.versions.node.split(".")[0]);
result.node24 = major === 24 ? "PASS" : `FAIL:requires_Node_24_got_${major}`;
if (major !== 24) failed = true;
try {
  const sha = cmd("git", ["rev-parse", "HEAD"]);
  result.exact_head = sha;
  if (!/^[0-9a-f]{40}$/.test(sha)) fail("exact_head", "invalid_git_sha");
  const expected = process.env.TASKMETA_V03_EXPECTED_SHA;
  if (!expected || !/^[0-9a-f]{40}$/.test(expected) || expected !== sha) {
    fail("exact_head", "expected_SHA_must_match_current_worktree");
  }
  const tree = cmd("git", ["status", "--porcelain"]);
  result.clean_tree = tree === "" ? "PASS" : "FAIL:tracked_or_untracked_changes";
  if (tree !== "") failed = true;
} catch {
  fail("exact_head", "git_source_unavailable");
}
try {
  const config = JSON.parse(readFileSync(new URL("../config/ads-adoption.json", import.meta.url)));
  const allowed = Array.isArray(config.e2e_test_subjects) && config.e2e_test_subjects.some((x) =>
    x.repository === REPO && x.ads_pin === ADS_CANDIDATE &&
    x.report_schema_blob === ADS_V5_BLOB && x.profile === "v5"
  );
  result.candidate_adoption_allowlist = allowed ? "PASS" : "FAIL:test_repo_or_pin_not_allowlisted";
  if (!allowed) failed = true;
  const bytes = readFileSync(new URL("../vendor/ads/v4.16/report.schema.json", import.meta.url));
  const blob = blobSha(bytes);
  result.actual_v5_schema_blob = blob === ADS_V5_BLOB ? "PASS" : "FAIL:vendored_schema_sha_drift";
  if (blob !== ADS_V5_BLOB) failed = true;
} catch {
  fail("candidate_adoption_allowlist", "local_config_or_schema_unavailable");
}
if (process.argv.includes("--github-readonly")) {
  try {
    const repo = api(`repos/${REPO}`);
    const rights = repo.permissions?.push === true || repo.permissions?.admin === true;
    result.real_host_repo_permission = repo.full_name === REPO && rights
      ? "PASS" : "FAIL:host_auth_has_no_write_permission";
    if (result.real_host_repo_permission !== "PASS") failed = true;
    const issue = api(`repos/${REPO}/issues/${ISSUE}`);
    result.real_native_issue =
      issue.number === ISSUE && issue.html_url === TARGET_URL && issue.locked !== true
        ? "PASS" : "FAIL:issue_wrong_or_locked";
    if (result.real_native_issue !== "PASS") failed = true;
  } catch {
    fail("real_host_repo_permission", "GitHub_readback_unavailable");
    result.real_native_issue = "UNKNOWN";
  }
}
// Deliberately no shell POST, no token/identity print, no report creation.
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failed) process.exitCode = 2;
