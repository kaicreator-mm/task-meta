import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADS_V4_REVISION,
  type Adoption,
  CANDIDATE_PIN,
  gitBlobSha1,
  loadAdoption,
  resolveProfile,
  VENDORED_V416_SCHEMA_BLOB,
  vendoredV416SchemaBlob,
} from "../src/report/index.ts";

const MAIN = "a".repeat(40);
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

test("shipped config lists no adopted main SHA", () => {
  assert.deepEqual(loadAdoption().adopted, []);
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
  assert.ok(!pub.ok && pub.code === "CANDIDATE_NOT_PUBLISHABLE");
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
  const base = { profile: "v5", adsPin: CANDIDATE_PIN, publish: true } as const;
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
