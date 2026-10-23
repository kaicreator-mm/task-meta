import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADS_V4_REVISION,
  type Adoption,
  CANDIDATE_PIN,
  gitBlobSha1,
  loadAdoption,
  QUALIFIED_V416_MAIN_SHA,
  resolveProfile,
  VENDORED_V416_SCHEMA_BLOB,
  vendoredV416SchemaBlob,
} from "../src/report/index.ts";

const MAIN = QUALIFIED_V416_MAIN_SHA;
const empty: Adoption = { adopted: [] };
const adopted = (blob = VENDORED_V416_SCHEMA_BLOB): Adoption => ({
  adopted: [{ ads_version: "4.16.0", main_sha: MAIN, report_schema_blob: blob, profile: "v5" }],
});

test("candidate pin constant is the vendored version/v4.16 commit", () => {
  assert.equal(CANDIDATE_PIN, "3041a1be3f130e5cc5e676c2e56a99882adfd97c");
});

test("vendored schema blob constant matches the real git blob sha1", () => {
  assert.equal(vendoredV416SchemaBlob(), VENDORED_V416_SCHEMA_BLOB);
  assert.equal(
    gitBlobSha1(new TextEncoder().encode("hello\n")),
    "ce013625030ba8dba906f756967f9e9ca394464a",
  );
});

test("shipped v0.3 config adopts only the exact ADS v4.16 qualified main pin", () => {
  const es = loadAdoption().adopted;
  assert.equal(es.length, 1);
  assert.equal(es[0]?.main_sha, QUALIFIED_V416_MAIN_SHA);
  assert.equal(es[0]?.report_schema_blob, VENDORED_V416_SCHEMA_BLOB);
  assert.equal(es[0]?.ads_version, "4.16.0");
});

test("no profile and empty adoption defaults to v4", () => {
  const r = resolveProfile({ publish: false, adoption: empty });
  assert.deepEqual(r, {
    ok: true,
    profile: "v4",
    mode: "V4_DEFAULT",
    adsRevision: ADS_V4_REVISION,
  });
});

test("explicit v4 stays v4 even when v5 is adopted", () => {
  const r = resolveProfile({ profile: "v4", publish: true, adoption: adopted() });
  assert.ok(r.ok && r.profile === "v4" && r.mode === "V4_DEFAULT");
});

test("v5 without pin is ADS_PIN_REQUIRED", () => {
  const r = resolveProfile({ profile: "v5", publish: false, adoption: empty });
  assert.ok(!r.ok && r.code === "ADS_PIN_REQUIRED");
});

test("candidate pin: dry run ok (CANDIDATE), publish refused", () => {
  const dry = resolveProfile({
    profile: "v5",
    adsPin: CANDIDATE_PIN,
    publish: false,
    adoption: empty,
  });
  assert.deepEqual(dry, { ok: true, profile: "v5", mode: "CANDIDATE", adsRevision: CANDIDATE_PIN });
  const pub = resolveProfile({
    profile: "v5",
    adsPin: CANDIDATE_PIN,
    publish: true,
    adoption: adopted(),
  });
  assert.ok(!pub.ok && pub.code === "CANDIDATE_TEST_PURPOSE_REQUIRED");
});

test("adopted main pin is ADOPTED and publishable", () => {
  const r = resolveProfile({ profile: "v5", adsPin: MAIN, publish: true, adoption: adopted() });
  assert.deepEqual(r, { ok: true, profile: "v5", mode: "ADOPTED", adsRevision: MAIN });
});

test("unknown pin is refused", () => {
  const r = resolveProfile({
    profile: "v5",
    adsPin: "b".repeat(40),
    publish: false,
    adoption: adopted(),
  });
  assert.ok(!r.ok && r.code === "UNKNOWN_ADS_PIN");
  const none = resolveProfile({ profile: "v5", adsPin: MAIN, publish: false, adoption: empty });
  assert.ok(!none.ok && none.code === "UNKNOWN_ADS_PIN");
});

test("adopted entry with a different schema blob is SCHEMA_BLOB_MISMATCH", () => {
  const r = resolveProfile({
    profile: "v5",
    adsPin: MAIN,
    publish: false,
    adoption: adopted("c".repeat(40)),
  });
  assert.ok(!r.ok && r.code === "SCHEMA_BLOB_MISMATCH");
});

test("default flips to v5 (adopted pin) once adoption lists a v5 entry", () => {
  const r = resolveProfile({ publish: true, adoption: adopted() });
  assert.deepEqual(r, { ok: true, profile: "v5", mode: "ADOPTED", adsRevision: MAIN });
  // flipped default with a mismatching blob is still refused
  const bad = resolveProfile({ publish: false, adoption: adopted("c".repeat(40)) });
  assert.ok(!bad.ok && bad.code === "SCHEMA_BLOB_MISMATCH");
});

// ---- E2E test-subject allowlist ----

const E2E_REPO = "kaicreator-mm/task-meta-e2e";
const e2e = (over: Record<string, string> = {}): Adoption => ({
  adopted: [],
  e2e_test_subjects: [
    {
      repository: E2E_REPO,
      ads_pin: CANDIDATE_PIN,
      profile: "v5",
      report_schema_blob: VENDORED_V416_SCHEMA_BLOB,
      ...over,
    },
  ],
});

test("shipped config allowlists the E2E repo only", () => {
  const subjects = loadAdoption().e2e_test_subjects ?? [];
  assert.deepEqual(
    subjects.map((s) => [s.repository, s.ads_pin]),
    [[E2E_REPO, CANDIDATE_PIN]],
  );
});

test("candidate + publish: allowlisted repository => E2E_TEST_SUBJECT", () => {
  const r = resolveProfile({
    profile: "v5",
    adsPin: CANDIDATE_PIN,
    publish: true,
    repository: E2E_REPO,
    e2eTestOnly: true,
    adoption: e2e(),
  });
  assert.deepEqual(r, {
    ok: true,
    profile: "v5",
    mode: "E2E_TEST_SUBJECT",
    adsRevision: CANDIDATE_PIN,
  });
});

test("candidate + publish: other repository, missing repository, wrong pin or blob are refused", () => {
  const base = { profile: "v5", adsPin: CANDIDATE_PIN, publish: true, e2eTestOnly: true } as const;
  const other = resolveProfile({ ...base, repository: "other/repo", adoption: e2e() });
  assert.ok(!other.ok && other.code === "CANDIDATE_NOT_PUBLISHABLE");
  const none = resolveProfile({ ...base, adoption: e2e() });
  assert.ok(!none.ok && none.code === "CANDIDATE_NOT_PUBLISHABLE");
  const wrongPin = resolveProfile({
    ...base,
    repository: E2E_REPO,
    adoption: e2e({ ads_pin: "d".repeat(40) }),
  });
  assert.ok(!wrongPin.ok && wrongPin.code === "CANDIDATE_NOT_PUBLISHABLE");
  const blob = resolveProfile({
    ...base,
    repository: E2E_REPO,
    adoption: e2e({ report_schema_blob: "c".repeat(40) }),
  });
  assert.ok(!blob.ok && blob.code === "SCHEMA_BLOB_MISMATCH");
});

test("candidate dry run is unaffected by the allowlist; default stays v4", () => {
  const dry = resolveProfile({
    profile: "v5",
    adsPin: CANDIDATE_PIN,
    publish: false,
    repository: "other/repo",
    adoption: e2e(),
  });
  assert.ok(dry.ok && dry.mode === "CANDIDATE");
  const def = resolveProfile({ publish: true, repository: E2E_REPO, adoption: e2e() });
  assert.ok(def.ok && def.profile === "v4" && def.mode === "V4_DEFAULT");
});

// ---- owner authorization (DEFINITION v0.2 section 1.1) ----

const owner = (over: Record<string, unknown> = {}): Adoption => ({
  adopted: [],
  owner_authorized: [
    {
      ads_version: "4.16",
      ads_pin: CANDIDATE_PIN,
      report_schema_blob: VENDORED_V416_SCHEMA_BLOB,
      profile: "v5",
      scope: "all",
      authorization_ref: "owner-authorization:2026-10-23:kaicreator-mm",
      authorized_on: "2026-10-23",
      ...over,
    },
  ],
});

test("shipped config carries the v4.16 owner authorization", () => {
  const e = (loadAdoption().owner_authorized ?? [])[0];
  assert.equal(e?.ads_pin, CANDIDATE_PIN);
  assert.equal(e?.report_schema_blob, VENDORED_V416_SCHEMA_BLOB);
  assert.equal(e?.scope, "all");
  assert.equal(e?.authorization_ref, "owner-authorization:2026-10-23:kaicreator-mm");
});

test("legacy all-repository candidate default is HELD for ordinary publishing", () => {
  const r = resolveProfile({ publish: true, repository: "any/repo", adoption: owner() });
  assert.ok(!r.ok && r.code === "UNQUALIFIED_CANDIDATE_DEFAULT");
  const shipped = resolveProfile({ publish: true, repository: "x/y", adoption: loadAdoption() });
  assert.ok(shipped.ok && shipped.mode === "ADOPTED" && shipped.adsRevision === MAIN);
  // An owner authorization is historical evidence, not an effective v5 dry-run pin.
  const dry = resolveProfile({ publish: false, repository: "any/repo", adoption: owner() });
  assert.ok(dry.ok && dry.profile === "v4" && dry.mode === "V4_DEFAULT");
});

test("explicit v4 is honoured; without owner_authorized the default is v4 again", () => {
  const v4 = resolveProfile({ profile: "v4", publish: true, adoption: owner() });
  assert.ok(v4.ok && v4.profile === "v4" && v4.mode === "V4_DEFAULT");
  const none = resolveProfile({ publish: true, adoption: { adopted: [] } });
  assert.ok(none.ok && none.profile === "v4" && none.mode === "V4_DEFAULT");
});

test("an adopted main entry wins over the owner authorization", () => {
  const both: Adoption = { ...adopted(), owner_authorized: owner().owner_authorized as never };
  const r = resolveProfile({ publish: true, adoption: both });
  assert.deepEqual(r, { ok: true, profile: "v5", mode: "ADOPTED", adsRevision: MAIN });
});

test("legacy owner authorization never bypasses admission, even with a matching schema", () => {
  const r = resolveProfile({
    publish: true,
    repository: "x/y",
    adoption: owner({ report_schema_blob: "c".repeat(40) }),
  });
  assert.ok(!r.ok && r.code === "UNQUALIFIED_CANDIDATE_DEFAULT");
});

test("legacy scoped owner authorization does not grant a v5 default to any repository", () => {
  const scoped = owner({ scope: ["kaicreator-mm/a"] });
  for (const repo of ["kaicreator-mm/a", "kaicreator-mm/b"]) {
    const r = resolveProfile({ publish: true, repository: repo, adoption: scoped });
    assert.ok(!r.ok && r.code === "UNQUALIFIED_CANDIDATE_DEFAULT");
  }
});

test("explicit candidate pin still needs the E2E allowlist to publish (owner default unaffected)", () => {
  const r = resolveProfile({
    profile: "v5",
    adsPin: CANDIDATE_PIN,
    publish: true,
    repository: "other/repo",
    e2eTestOnly: true,
    adoption: owner(),
  });
  assert.ok(!r.ok && r.code === "CANDIDATE_NOT_PUBLISHABLE");
});

test("explicit ordinary candidate is denied even if owner authorization is all-repositories", () => {
  const r = resolveProfile({
    profile: "v5", adsPin: CANDIDATE_PIN, publish: true,
    repository: "kaicreator-mm/ordinary", e2eTestOnly: true, adoption: owner(),
  });
  assert.ok(!r.ok && r.code === "CANDIDATE_NOT_PUBLISHABLE");
});

test("allowlisted test repository still requires explicit test purpose", () => {
  const r = resolveProfile({
    profile: "v5", adsPin: CANDIDATE_PIN, publish: true,
    repository: E2E_REPO, adoption: e2e(),
  });
  assert.ok(!r.ok && r.code === "CANDIDATE_TEST_PURPOSE_REQUIRED");
});

test("qualified v4.16 main pin is required; merely shaped 40-hex adoption fails", () => {
  const fake: Adoption = {
    adopted: [{ ads_version: "4.16.0", main_sha: "a".repeat(40),
      report_schema_blob: VENDORED_V416_SCHEMA_BLOB, profile: "v5" }],
  };
  const r = resolveProfile({ profile: "v5", adsPin: "a".repeat(40), publish: true,
    repository: "example/repo", adoption: fake });
  assert.ok(!r.ok && r.code === "UNQUALIFIED_MAIN_PIN");
});
