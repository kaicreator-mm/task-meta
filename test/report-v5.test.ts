import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";
import { canonicalDigest } from "../src/canonical.ts";
import type { AttemptSummary, CostObservation, ManifestPointer } from "../src/model.ts";
import {
  ADS_V5_REVISION,
  buildReportDocument,
  parseReportComment,
  renderReportComment,
  UnrepresentableError,
  validateReportDocument,
} from "../src/report/index.ts";

const dir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => readFileSync(join(dir, n), "utf8");
const manifest: ManifestPointer = {
  ref: "object:private/manifests/abc",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};

function input(over: Partial<ZcodeRunInput> = {}): ZcodeRunInput {
  return {
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
    ...over,
  };
}

const v5opts = {
  profile: "v5",
  revision: 1,
  supersedes: null,
  publisherSourceSha: "b".repeat(40),
  publication: { clearance_ref: "clearance:synthetic" },
} as const;

const realistic = (): AttemptSummary => collectZcodeRun(input()).summary;
const withCost = (cost: Partial<AttemptSummary["cost"]>): AttemptSummary => {
  const s = realistic();
  return { ...s, cost: { ...s.cost, ...cost } };
};
const code = (e: unknown) => (e instanceof UnrepresentableError ? e.code : String(e));

describe("v5 builder: metrics", () => {
  it("a realistic summary with identity validates and carries every identity field", () => {
    const s = realistic();
    assert.ok(s.metrics.length >= 9);
    const doc = buildReportDocument(s, manifest, v5opts);
    assert.deepEqual(validateReportDocument(doc, "v5"), { valid: true });
    const ms = doc.data.metrics as Array<Record<string, unknown>>;
    assert.equal(ms.length, s.metrics.length);
    for (const m of ms) {
      assert.match(String(m.metric_id), /^task-meta:sess-synth-0001:/);
      assert.equal(m.adapter_id, "zcode");
      assert.equal(m.provider_run_ref, null);
    }
    assert.equal((doc.data.subject as { ads_revision: string }).ads_revision, ADS_V5_REVISION);
    const parsed = parseReportComment(renderReportComment(doc));
    assert.ok(parsed.ok && parsed.profile === "v5");
  });

  it("adsRevision option sets subject.ads_revision", () => {
    const doc = buildReportDocument(realistic(), manifest, {
      ...v5opts,
      adsRevision: "9".repeat(40),
    });
    assert.equal((doc.data.subject as { ads_revision: string }).ads_revision, "9".repeat(40));
  });

  it("a metric without identity is refused", () => {
    const s = realistic();
    const [first, ...rest] = s.metrics;
    assert.ok(first);
    const { identity: _drop, ...bare } = first;
    assert.throws(
      () => buildReportDocument({ ...s, metrics: [bare, ...rest] }, manifest, v5opts),
      (e) => code(e) === "METRIC_IDENTITY_REQUIRED_IN_V5",
    );
  });

  it("v4 build of identity-bearing metrics drops identity and stays valid", () => {
    const doc = buildReportDocument(realistic(), manifest, {
      profile: "v4",
      revision: 1,
      supersedes: null,
    });
    assert.deepEqual(validateReportDocument(doc, "v4"), { valid: true });
    for (const m of doc.data.metrics as Array<Record<string, unknown>>) {
      assert.equal("metric_id" in m, false);
    }
  });
});

describe("v5 builder: cost", () => {
  const provider: CostObservation = {
    value: 0.5,
    currency: "USD",
    basis: "PROVIDER_REPORTED",
    pricing_basis: "provider usage report",
    epistemic: "OBSERVED",
    source_refs: ["zcode:session:sess-synth-0001"],
  };

  it("PROVIDER_REPORTED is valid in v5 with null accounting fields", () => {
    const doc = buildReportDocument(withCost(provider), manifest, v5opts);
    assert.deepEqual(validateReportDocument(doc, "v5"), { valid: true });
    const cost = doc.data.cost as Record<string, unknown>;
    assert.equal(cost.basis, "PROVIDER_REPORTED");
    assert.equal(cost.accounting_ref, null);
  });

  it("PROVIDER_REPORTED is refused in v4, never relabelled", () => {
    assert.throws(
      () =>
        buildReportDocument(withCost(provider), manifest, {
          profile: "v4",
          revision: 1,
          supersedes: null,
        }),
      (e) => code(e) === "PROVIDER_REPORTED_UNSUPPORTED_IN_V4",
    );
  });

  const billed: CostObservation = { ...provider, basis: "BILLED" };

  it("BILLED without accounting refs is refused in v5", () => {
    assert.throws(
      () => buildReportDocument(withCost(billed), manifest, v5opts),
      (e) => code(e) === "BILLED_ACCOUNTING_REQUIRED_IN_V5",
    );
    assert.throws(
      () =>
        buildReportDocument(
          withCost({
            ...billed,
            accounting: {
              accounting_ref: "acct:1",
              economic_scope_ref: null,
              billing_window_ref: "bw:1",
              cost_category: "model",
            },
          }),
          manifest,
          v5opts,
        ),
      (e) => code(e) === "BILLED_ACCOUNTING_REQUIRED_IN_V5",
    );
  });

  it("BILLED with full accounting refs maps them", () => {
    const doc = buildReportDocument(
      withCost({
        ...billed,
        accounting: {
          accounting_ref: "acct:1",
          economic_scope_ref: "scope:1",
          billing_window_ref: "bw:1",
          cost_category: "model",
        },
      }),
      manifest,
      v5opts,
    );
    assert.deepEqual(validateReportDocument(doc, "v5"), { valid: true });
    assert.equal((doc.data.cost as { accounting_ref: string }).accounting_ref, "acct:1");
  });
});

describe("v5 builder: publication", () => {
  it("projection_digest is the digest of data without publication", () => {
    const doc = buildReportDocument(realistic(), manifest, v5opts);
    const { publication, ...rest } = doc.data as Record<string, unknown>;
    const pub = publication as { clearance_ref: string; projection_digest: string };
    assert.equal(pub.clearance_ref, "clearance:synthetic");
    assert.equal(pub.projection_digest, canonicalDigest(rest));
  });

  it("projection_digest changes when data changes", () => {
    const a = buildReportDocument(realistic(), manifest, v5opts);
    const b = buildReportDocument({ ...realistic(), limits: ["extra limit"] }, manifest, v5opts);
    const dig = (d: typeof a) =>
      (d.data.publication as { projection_digest: string }).projection_digest;
    assert.notEqual(dig(a), dig(b));
  });

  it("missing or empty clearance is PUBLICATION_CLEARANCE_REQUIRED", () => {
    const { publication: _p, ...noPub } = v5opts;
    for (const o of [noPub, { ...v5opts, publication: { clearance_ref: "" } }]) {
      assert.throws(
        () => buildReportDocument(realistic(), manifest, o),
        (e) => code(e) === "PUBLICATION_CLEARANCE_REQUIRED",
      );
    }
  });
});
