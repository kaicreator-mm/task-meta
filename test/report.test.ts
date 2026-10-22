import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse, stringify } from "yaml";
import type { AttemptSummary, ManifestPointer } from "../src/model.ts";
import {
  buildReportDocument,
  parseReportComment,
  renderReportComment,
  reportDataDigest,
  UnrepresentableError,
  validateReportDocument,
} from "../src/report/index.ts";

const read = (p: string): any => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

const SHA = "1234567890abcdef1234567890abcdef12345678";
const manifest: ManifestPointer = {
  ref: "object:private/manifests/abc",
  sha256: "c".repeat(64),
  access: "PROJECT_PRIVATE",
};

function summary(over: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    repository: "example-org/example-repo",
    issue_number: 42,
    task_ref: "example-org/example-repo#42",
    attempt_ref: "sess-0001",
    attempt_binding: "COLLECTOR_ONLY",
    source_sha: SHA,
    actor: {
      role: "builder",
      operator_kind: "zcode",
      operator_id: "zcode:synthetic",
      session_ref: "sess-0001",
      transport_actor: null,
    },
    observed_at: "2026-10-22T10:00:00Z",
    observation_refs: ["zcode:evt-1", "zcode:evt-2"],
    capture_coverage: "PARTIAL",
    limits: ["synthetic fixture"],
    metrics: [
      {
        name: "input_tokens",
        value: 1200,
        unit: "token",
        epistemic: "OBSERVED",
        coverage: "COMPLETE",
        source_refs: ["zcode:evt-1"],
      },
      {
        name: "run_wall_ms",
        value: null,
        unit: "ms",
        epistemic: "UNKNOWN",
        coverage: "UNKNOWN",
        source_refs: [],
      },
    ],
    cost: {
      value: null,
      currency: null,
      basis: "UNKNOWN",
      pricing_basis: null,
      epistemic: "UNKNOWN",
      source_refs: [],
    },
    attempt_refs: ["sess-0001"],
    excluded_attempt_refs: [],
    verifier: {
      status: "PARTIAL",
      subject_sha: null,
      checked: ["gate"],
      failed: [],
      skipped: [],
      unchecked: ["task acceptance"],
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
      source_refs: ["zcode:gate-1"],
    },
    learning: { state: "NONE_MATERIAL", source_refs: [] },
    ...over,
  };
}

const V5_PUB = { clearance_ref: "clearance:synthetic" };
const v4opts = { profile: "v4", revision: 1, supersedes: null } as const;
const v5opts = {
  profile: "v5",
  revision: 1,
  supersedes: null,
  publisherSourceSha: "b".repeat(40),
  publication: V5_PUB,
} as const;

function v4doc(): any {
  return buildReportDocument(summary(), manifest, v4opts);
}

describe("oracle sanity", () => {
  it("official v4 summary fixture: valid under v4, invalid under v5", () => {
    const fx = read("../vendor/ads/v4.15/summary.fixture.json");
    assert.deepEqual(validateReportDocument(fx, "v4"), { valid: true });
    assert.equal(validateReportDocument(fx, "v5").valid, false);
  });
});

describe("build / render / parse", () => {
  it("v4 build is valid; round trip keeps data and digest; digest absent from body", () => {
    const doc = v4doc();
    assert.deepEqual(validateReportDocument(doc, "v4"), { valid: true });
    assert.equal(doc.data.report_id, "task-meta:sess-0001");
    assert.equal(doc.data.publisher_namespace, "task-meta:example-org/example-repo");
    assert.equal(doc.data.verifier.subject_sha, SHA);
    assert.equal("status" in doc.data.verifier, false);
    for (const m of doc.data.metrics) assert.equal(m.currentness.state, "UNKNOWN");
    assert.equal(doc.data.subject.currentness.state, "UNKNOWN");
    const body = renderReportComment(doc, { humanSummary: "Human readable note." });
    assert.ok(body.startsWith("<!-- ads:github -->\n```yaml\n"));
    const parsed = parseReportComment(body);
    assert.ok(parsed.ok);
    assert.equal(parsed.profile, "v4");
    assert.deepEqual(parsed.doc.data, doc.data);
    const digest = reportDataDigest(doc.data);
    assert.equal(parsed.dataDigest, digest);
    assert.ok(!body.includes(digest));
    assert.ok(!/\*\w|&\w/.test(body.split("```")[1] ?? ""), "no aliases/anchors emitted");
  });

  it("digest is stable when YAML key order is changed by hand", () => {
    const doc = v4doc();
    const body = renderReportComment(doc);
    const yamlText = body.split("```yaml\n")[1]?.split("```")[0] ?? "";
    const obj = parse(yamlText);
    const reorder = (v: any): any =>
      Array.isArray(v)
        ? v.map(reorder)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .reverse()
                .map((k) => [k, reorder(v[k])]),
            )
          : v;
    const reversed = reorder(obj);
    const body2 = `<!-- ads:github -->\n\`\`\`yaml\n${stringify(reversed)}\`\`\`\n`;
    assert.notEqual(body2, body);
    const parsed = parseReportComment(body2);
    assert.ok(parsed.ok);
    assert.equal(parsed.dataDigest, reportDataDigest(doc.data));
  });

  it("renders with supersedes for revision 2", () => {
    const sup = {
      revision: 1,
      data_digest: "e".repeat(64),
      comment_ref: "https://github.com/example-org/example-repo/issues/42#issuecomment-99",
    };
    const doc = buildReportDocument(summary(), manifest, {
      ...v4opts,
      revision: 2,
      supersedes: sup,
    });
    assert.ok(parseReportComment(renderReportComment(doc)).ok);
  });

  it("v4 with source_sha null throws UnrepresentableError", () => {
    assert.throws(
      () => buildReportDocument(summary({ source_sha: null }), manifest, v4opts),
      (e: unknown) => e instanceof UnrepresentableError && e.code === "SOURCE_SHA_REQUIRED_IN_V4",
    );
  });

  it("v5 collector-only (null source_sha) is valid; missing publisherSourceSha throws", () => {
    const s = summary({
      source_sha: null,
      metrics: [],
      verifier: { ...summary().verifier, status: "NOT_RUN", epistemic: "UNKNOWN", checked: [] },
    });
    const doc = buildReportDocument(s, manifest, v5opts);
    assert.deepEqual(validateReportDocument(doc, "v5"), { valid: true });
    assert.equal(validateReportDocument(doc, "v4").valid, false);
    assert.equal((doc.data.subject as any).source_status, "UNPINNED");
    assert.equal((doc.data.subject as any).source_currentness, "UNKNOWN");
    const parsed = parseReportComment(renderReportComment(doc));
    assert.ok(parsed.ok && parsed.profile === "v5");
    assert.throws(
      () => buildReportDocument(s, manifest, { ...v5opts, publisherSourceSha: undefined as any }),
      UnrepresentableError,
    );
  });

  it("v5 refuses values it cannot express", () => {
    // metrics without identity
    assert.throws(
      () => buildReportDocument(summary(), manifest, v5opts),
      (e: unknown) =>
        e instanceof UnrepresentableError && e.code === "METRIC_IDENTITY_REQUIRED_IN_V5",
    );
    const noMetrics = summary({ metrics: [], verifier: { ...summary().verifier, status: "PASS" } });
    assert.throws(
      () => buildReportDocument(noMetrics, manifest, { ...v5opts, publication: undefined as any }),
      (e: unknown) =>
        e instanceof UnrepresentableError && e.code === "PUBLICATION_CLEARANCE_REQUIRED",
    );
  });

  it("a v4 document is invalid as v5 and vice versa", () => {
    assert.equal(validateReportDocument(v4doc(), "v5").valid, false);
  });

  it("render refuses an invalid document", () => {
    const doc = v4doc();
    doc.data.extra = 1;
    assert.throws(() => renderReportComment(doc));
  });
});

describe("schema negatives (v4)", () => {
  const bad = (mut: (d: any) => void): boolean => {
    const doc = v4doc();
    mut(doc.data);
    return validateReportDocument({ ...doc, data: doc.data }, "v4").valid;
  };
  it("extra key in data", () =>
    assert.equal(
      bad((d) => (d.extra = 1)),
      false,
    ));
  it("extra key in subject", () =>
    assert.equal(
      bad((d) => (d.subject.extra = 1)),
      false,
    ));
  it("extra key in metric", () =>
    assert.equal(
      bad((d) => (d.metrics[0].extra = 1)),
      false,
    ));
  it("schema v3", () => {
    const doc = v4doc();
    doc.schema = "ads/github/v3";
    assert.equal(validateReportDocument(doc, "v4").valid, false);
  });
  it("unknown report_kind", () =>
    assert.equal(
      bad((d) => (d.report_kind = "CLAIM")),
      false,
    ));
  it("UNKNOWN epistemic with non-null value", () =>
    assert.equal(
      bad((d) => {
        d.metrics[1].value = 5;
      }),
      false,
    ));
  it("BILLED cost with empty source_refs", () =>
    assert.equal(
      bad((d) => {
        d.cost = {
          ...d.cost,
          value: 1,
          currency: "USD",
          basis: "BILLED",
          pricing_basis: "invoice",
          epistemic: "OBSERVED",
          source_refs: [],
        };
      }),
      false,
    ));
  it("revision 2 with supersedes null", () =>
    assert.equal(
      bad((d) => (d.revision = 2)),
      false,
    ));
  it("revision 1 with non-null supersedes", () =>
    assert.equal(
      bad((d) => {
        d.supersedes = {
          revision: 1,
          data_digest: "e".repeat(64),
          comment_ref: "https://github.com/a/b/issues/1#issuecomment-2",
        };
      }),
      false,
    ));
});

describe("parser negatives", () => {
  const good = renderReportComment(v4doc());
  const yamlOf = (b: string) => b.split("```yaml\n")[1]?.split("```")[0] ?? "";
  const wrap = (y: string) => `<!-- ads:github -->\n\`\`\`yaml\n${y}\`\`\`\n`;
  const rejects = (b: string, re?: RegExp) => {
    const r = parseReportComment(b);
    assert.equal(r.ok, false);
    if (!r.ok && re) assert.match(r.error, re);
  };

  it("good body parses", () => assert.ok(parseReportComment(good).ok));
  it("missing marker", () => rejects(good.replace("<!-- ads:github -->\n", ""), /marker/));
  it("marker not on first line", () => rejects(`intro\n${good}`, /first line/));
  it("two markers", () => rejects(`${good}\n<!-- ads:github -->\n`, /one marker/));
  it("non-yaml fence", () => rejects(good.replace("```yaml", "```json"), /yaml/));
  it("yaml fence not immediately after marker", () =>
    rejects(good.replace("<!-- ads:github -->\n", "<!-- ads:github -->\n\n"), /immediately/));
  it("anchor / alias", () => {
    const y = yamlOf(good).replace("schema: ads/github/v4", "schema: &s ads/github/v4");
    rejects(wrap(`${y}extra: *s\n`), /anchor|alias/);
    rejects(wrap(y), /anchor/);
  });
  it("duplicate key", () => rejects(wrap(`${yamlOf(good)}kind: report\n`), /yaml error/));
  it("python object tag", () =>
    rejects(wrap("schema: ads/github/v4\nkind: report\ndata: !!python/object {}\n"), /tag|yaml/));
  it("explicit core tag", () =>
    rejects(wrap(yamlOf(good).replace("kind: report", "kind: !!str report")), /tag/));
  it("four top-level keys", () => rejects(wrap(`${yamlOf(good)}extra: 1\n`), /top-level keys/));
  it("multiple documents", () => rejects(wrap(`${yamlOf(good)}---\na: 1\n`), /one YAML document/));
  it("schema-invalid data", () => {
    const y = yamlOf(good).replace("report_kind: EXECUTION_SUMMARY", "report_kind: NOPE");
    rejects(wrap(y), /validation/);
  });
});
