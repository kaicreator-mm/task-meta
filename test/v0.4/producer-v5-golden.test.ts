import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { collectZcodeRun, type ZcodeRunInput } from "../../src/adapters/zcode/index.ts";
import type { AttemptSummary, ManifestPointer } from "../../src/model.ts";
import {
  ADS_V5_REVISION,
  buildReportDocument,
  loadAdoption,
  QUALIFIED_V416_MAIN_SHA,
  renderReportComment,
  parseReportComment,
  resolveProfile,
  validateReportDocument,
  VENDORED_V416_SCHEMA_BLOB,
  vendoredV416SchemaBlob,
  UnrepresentableError,
} from "../../src/report/index.ts";

const fx = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "fixtures", "zcode", file), "utf8");

function source(): AttemptSummary {
  const input: ZcodeRunInput = {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess-synth-0001",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecord: fx("run.txt"),
    gateLog: fx("gate-pass.log"),
  };
  return collectZcodeRun(input).summary;
}
const manifest: ManifestPointer = {
  ref: "object:private/manifests/abc",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};
function golden() {
  return buildReportDocument(source(), manifest, {
    profile: "v5",
    revision: 1,
    supersedes: null,
    adsRevision: QUALIFIED_V416_MAIN_SHA,
    publisherSourceSha: "b".repeat(40),
    publication: { clearance_ref: "clearance:synthetic" },
  });
}
test("v0.4 E: source-only Golden is exact qualified adopted v5, schema-valid, parseable", () => {
  const adopted = loadAdoption().adopted;
  assert.deepEqual(adopted.map((x) => x.main_sha), [QUALIFIED_V416_MAIN_SHA]);
  assert.equal(adopted[0]?.report_schema_blob, VENDORED_V416_SCHEMA_BLOB);
  assert.equal(vendoredV416SchemaBlob(), VENDORED_V416_SCHEMA_BLOB);
  const doc = golden();
  assert.equal(doc.schema, "ads/github/v5");
  assert.deepEqual(validateReportDocument(doc, "v5"), { valid: true });
  const parsed = parseReportComment(renderReportComment(doc));
  assert.ok(parsed.ok && parsed.profile === "v5");
  assert.equal((doc.data.subject as { ads_revision: string }).ads_revision, QUALIFIED_V416_MAIN_SHA);
  assert.notEqual(ADS_V5_REVISION, QUALIFIED_V416_MAIN_SHA);
});
test("v0.4 E: strict public schema rejects extra private keys and missing required metrics", () => {
  const doc = golden();
  const extra = structuredClone(doc);
  extra.data["private_diagnostics_v1"] = { secret: "not for public report" };
  assert.equal(validateReportDocument(extra, "v5").valid, false);
  const missing = structuredClone(doc);
  delete missing.data.metrics;
  assert.equal(validateReportDocument(missing, "v5").valid, false);
});
test("v0.4 E: producer never fabricates source-owned v5 publication clearance", () => {
  const summary = source();
  assert.throws(
    () => buildReportDocument(summary, manifest, {
      profile: "v5", revision: 1, supersedes: null,
      adsRevision: QUALIFIED_V416_MAIN_SHA, publisherSourceSha: "b".repeat(40),
    }),
    (err) => err instanceof UnrepresentableError && err.code === "PUBLICATION_CLEARANCE_REQUIRED",
  );
});
test("v0.4 E: old candidate never grants ordinary publication; test purpose is restricted", () => {
  const adoption = loadAdoption();
  const forbidden = resolveProfile({
    profile: "v5", adsPin: ADS_V5_REVISION, publish: true,
    repository: "kaicreator-mm/task-meta", adoption,
  });
  assert.equal(forbidden.ok, false);
  const forbiddenTest = resolveProfile({
    profile: "v5", adsPin: ADS_V5_REVISION, publish: true,
    repository: "kaicreator-mm/task-meta", e2eTestOnly: true, adoption,
  });
  assert.equal(forbiddenTest.ok, false);
  const allowed = resolveProfile({
    profile: "v5", adsPin: QUALIFIED_V416_MAIN_SHA, publish: true,
    repository: "kaicreator-mm/task-meta", adoption,
  });
  assert.ok(allowed.ok && allowed.profile === "v5" && allowed.mode === "ADOPTED");
});
