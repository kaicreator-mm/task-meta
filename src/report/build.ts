import { canonicalDigest } from "../canonical.ts";
import type { AttemptSummary, ManifestPointer } from "../model.ts";
import {
  ADS_V4_REVISION,
  ADS_V5_REVISION,
  type ReportDocument,
  type ReportProfile,
  type SupersedesRef,
  UnrepresentableError,
} from "./types.ts";
import { validateReportDocument } from "./validate.ts";

export interface BuildOptions {
  profile: ReportProfile;
  revision: number;
  supersedes: null | SupersedesRef;
  /** Required for v5: the publisher's own source commit. */
  publisherSourceSha?: string;
  /** v5: clearance asserted by the source owner; projection_digest is computed here. */
  publication?: { clearance_ref: string };
  /** v5 subject.ads_revision (default ADS_V5_REVISION). */
  adsRevision?: string;
}

export const V5_PARTIAL_LIMIT =
  "verifier partial progress not representable in ads/github/v5; detail in private manifest";

const UNWITNESSED = "collector did not witness current HEAD of the owning branch";

function currentness() {
  return { state: "UNKNOWN", source_refs: [] as string[], limits: [UNWITNESSED] };
}

function metrics(s: AttemptSummary, v5: boolean) {
  return s.metrics.map((m) => {
    const base = {
      name: m.name,
      value: m.value,
      unit: m.unit,
      epistemic: m.epistemic,
      coverage: m.coverage,
      source_refs: [...m.source_refs],
      currentness: currentness(),
    };
    if (!v5) return base;
    const id = m.identity;
    if (!id) {
      throw new UnrepresentableError(
        "METRIC_IDENTITY_REQUIRED_IN_V5",
        `metric ${m.name} carries no source identity`,
      );
    }
    return { ...base, ...id };
  });
}

function head(s: AttemptSummary, o: BuildOptions) {
  return {
    report_id: `task-meta:${s.attempt_ref}`,
    revision: o.revision,
    publisher_namespace: `task-meta:${s.repository}`,
    report_kind: "EXECUTION_SUMMARY",
  };
}

function aggregation(s: AttemptSummary) {
  return {
    mode: "LEAF_ATTEMPTS_ONLY",
    attempt_refs: [...s.attempt_refs],
    excluded_attempt_refs: [...s.excluded_attempt_refs],
    limits: [] as string[],
  };
}

function verifierCore(s: AttemptSummary, subjectSha: string | null) {
  const v = s.verifier;
  return {
    subject_sha: subjectSha,
    source_refs: [...v.source_refs],
    checked: [...v.checked],
    failed: [...v.failed],
    skipped: [...v.skipped],
    unchecked: [...v.unchecked],
    coverage: v.coverage,
    epistemic: v.epistemic,
    currentness: currentness(),
  };
}

function tail(s: AttemptSummary, m: ManifestPointer) {
  return {
    manifest_ref: m.ref,
    manifest_sha256: m.sha256,
    manifest_access: m.access,
    learning: { state: s.learning.state, source_refs: [...s.learning.source_refs] },
  };
}

function issueRef(s: AttemptSummary): string {
  return `https://github.com/${s.repository}/issues/${s.issue_number}`;
}

function buildV4(s: AttemptSummary, m: ManifestPointer, o: BuildOptions): ReportDocument {
  if (s.source_sha === null) {
    throw new UnrepresentableError(
      "SOURCE_SHA_REQUIRED_IN_V4",
      "ads/github/v4 requires a 40-hex subject.source_sha; the attempt has none witnessed",
    );
  }
  if (s.cost.basis === "PROVIDER_REPORTED") {
    throw new UnrepresentableError(
      "PROVIDER_REPORTED_UNSUPPORTED_IN_V4",
      "ads/github/v4 has no PROVIDER_REPORTED cost basis; it is never relabelled",
    );
  }
  const subjectSha = s.verifier.subject_sha ?? s.source_sha;
  return {
    schema: "ads/github/v4",
    kind: "report",
    data: {
      ...head(s, o),
      subject: {
        repository: s.repository,
        issue_ref: issueRef(s),
        task_ref: s.task_ref,
        attempt_ref: s.attempt_ref,
        attempt_binding: s.attempt_binding,
        source_sha: s.source_sha,
        ads_revision: ADS_V4_REVISION,
        ads_profile: "ads/github/v4:report",
        currentness: currentness(),
      },
      actor: { ...s.actor },
      observed_at: s.observed_at,
      source_refs: [...s.observation_refs],
      limits: [...s.limits],
      supersedes: o.supersedes,
      capture_coverage: s.capture_coverage,
      metrics: metrics(s, false),
      cost: {
        value: s.cost.value,
        currency: s.cost.currency,
        basis: s.cost.basis,
        pricing_basis: s.cost.pricing_basis,
        epistemic: s.cost.epistemic,
        source_refs: [...s.cost.source_refs],
        currentness: currentness(),
      },
      aggregation: aggregation(s),
      verifier: verifierCore(s, subjectSha),
      ...tail(s, m),
    },
  };
}

function buildV5(s: AttemptSummary, m: ManifestPointer, o: BuildOptions): ReportDocument {
  if (!o.publisherSourceSha) {
    throw new UnrepresentableError(
      "PUBLISHER_SOURCE_SHA_REQUIRED_IN_V5",
      "ads/github/v5 requires subject.publisher_source_sha",
    );
  }
  if (!o.publication?.clearance_ref) {
    throw new UnrepresentableError(
      "PUBLICATION_CLEARANCE_REQUIRED",
      "ads/github/v5 needs a source-owner clearance_ref; without it the report is HELD",
    );
  }
  const v5metrics = metrics(s, true);
  const acc = s.cost.accounting;
  const accounting = {
    accounting_ref: acc?.accounting_ref ?? null,
    economic_scope_ref: acc?.economic_scope_ref ?? null,
    billing_window_ref: acc?.billing_window_ref ?? null,
    cost_category: acc?.cost_category ?? null,
  };
  if (s.cost.basis === "BILLED" && Object.values(accounting).some((x) => x === null)) {
    throw new UnrepresentableError(
      "BILLED_ACCOUNTING_REQUIRED_IN_V5",
      "v5 BILLED cost requires accounting_ref/economic_scope_ref/billing_window_ref/cost_category",
    );
  }
  // v5 verifier.status has no PARTIAL: progress is downgraded to UNKNOWN, never PASS.
  const partial = s.verifier.status === "PARTIAL";
  const pinned = s.source_sha !== null;
  const ran = s.verifier.status === "PASS" || s.verifier.status === "FAIL";
  const subjectSha = ran ? (s.verifier.subject_sha ?? s.source_sha) : s.verifier.subject_sha;
  const verifierV5 = partial
    ? {
        ...verifierCore(s, null),
        status: "UNKNOWN",
        checked: [] as string[],
        failed: [] as string[],
        epistemic: "UNKNOWN",
        currentness: currentness(),
      }
    : { ...verifierCore(s, subjectSha), status: s.verifier.status };
  const limits = partial ? [...s.limits, V5_PARTIAL_LIMIT] : [...s.limits];
  const data = {
    ...head(s, o),
    subject: {
      repository: s.repository,
      issue_ref: issueRef(s),
      task_ref: s.task_ref,
      attempt_ref: s.attempt_ref,
      attempt_binding: s.attempt_binding,
      source_sha: s.source_sha,
      ads_revision: o.adsRevision ?? ADS_V5_REVISION,
      ads_profile: "ads/github/v5:report",
      currentness: currentness(),
      publisher_source_sha: o.publisherSourceSha,
      source_status: pinned ? "PINNED" : "UNPINNED",
      source_currentness: "UNKNOWN",
      source_reason: pinned ? null : "collector witnessed no immutable execution bytes",
      collector_observation_refs: [...s.observation_refs],
    },
    actor: { ...s.actor },
    observed_at: s.observed_at,
    source_refs: [...s.observation_refs],
    limits,
    supersedes: o.supersedes,
    capture_coverage: s.capture_coverage,
    metrics: v5metrics,
    cost: {
      value: s.cost.value,
      currency: s.cost.currency,
      basis: s.cost.basis,
      pricing_basis: s.cost.pricing_basis,
      epistemic: s.cost.epistemic,
      source_refs: [...s.cost.source_refs],
      currentness: currentness(),
      ...accounting,
    },
    aggregation: aggregation(s),
    verifier: verifierV5,
    ...tail(s, m),
  };
  return {
    schema: "ads/github/v5",
    kind: "report",
    data: {
      ...data,
      publication: {
        classification: "PUBLISHABLE",
        clearance_ref: o.publication.clearance_ref,
        projection_digest: canonicalDigest(data),
      },
    },
  };
}

/** Build an ADS report envelope (EXECUTION_SUMMARY). Never fabricates values: throws instead. */
export function buildReportDocument(
  summary: AttemptSummary,
  manifest: ManifestPointer,
  opts: BuildOptions,
): ReportDocument {
  const doc =
    opts.profile === "v4" ? buildV4(summary, manifest, opts) : buildV5(summary, manifest, opts);
  const res = validateReportDocument(doc, opts.profile);
  if (!res.valid) {
    throw new UnrepresentableError(
      "SCHEMA_REJECTED",
      `summary cannot be expressed in ${opts.profile}: ${res.errors.slice(0, 5).join("; ")}`,
    );
  }
  return doc;
}
