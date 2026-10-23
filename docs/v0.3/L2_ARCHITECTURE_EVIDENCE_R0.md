# task-meta v0.3 — L2 Architecture Evidence R0 (ADS v4.17 aligned)

**Status:** L2_R0_CANDIDATE / INDEPENDENT_ARCH_REVIEW=NOT_RUN / L2_FREEZE=NO / NATIVE_TASK_DAG=NOT_ADMITTED / BUILDER_CLAIM=NO. Source/architecture document only; not implementation or an independent PASS.

**Product authority:** Product Owner exact-source Freeze [#27@6373958182](https://github.com/kaicreator-mm/task-meta/issues/27#issuecomment-6373958182) on draft Product PR #34 HEAD 2b39d4913c09c7543fb3234d81c2914b83e0a262, L1 blob e9016537c907a813e1e7b22eddcd75e9dbc4e73a, PRD blob 7a54488384af5386d5cc7b4e1b50461aa9fe9c71; prior independent Product R1 #35/PR #34 review PASS P0/P1/P2=0. Product frozen bytes remain unchanged on this L2 branch.

**Implementation base:** task-meta main@36ea9147239fe669d021c7eb273a864322f27356. ADS v4.17 protocol phase version/v4.17@1355bc0694b3b0225effa82b670725f83a2b873b; GAIP normative blob 49ecd802c5bf14237e23d5e321c56c220eb8974e; strict unchanged v5 schema blob 7478313cc006162432649d734e59c5cd77db5106. ADS v4.17 whole-version RQ is not claimed.

## 1. Architecture decisions

**L2-D01 — Reuse upstream implementations, isolate deltas.** Extend existing src/model.ts, src/report/pin.ts, src/publish/publish.ts, src/publish/client.ts, src/store, src/lineage/dag.ts, src/labels/index.ts, src/aggregates/index.ts, src/collect-core.ts. New bounded private helpers can live in src/evidence-join, src/correction, src/trajectory, src/metrics (provisional names), but cannot create a second publisher, report schema, data store, Tally adapter or scheduler. Existing ZCode/Claude Code/Codex plugins are unchanged unless real source-backed defect requires a scoped PR.

**L2-D02 — Single data path and authority.**
~~~text
Real Agent/Host -> metadata-only sanitized ObservationRecord -> private CAS manifest
             -> actual Task/Run/Attempt/Step/logical+physical IDs
             -> existing ADS profile resolver (FR00 authorization gate)
             -> existing schema-valid report builder -> existing bounded GitHub publisher
             -> actual native Issue/comment ID, digest and readback receipt
             -> factual GitHub feedback reader/join (if any, private; optional)
             -> private source-qualified correction / C08 analysis / metric diagnostics
Tally (separate application) -> GitHub native Issue/PR/CI/Review + ADS comments ONLY
                             -> its own local material-use edge and decision/effect owner
                             -> authorized v5 EXPERIENCE_USE_FEEDBACK on GitHub
~~~
GitHub remains the sole public exchange. No incoming webhook from Tally; no private task-meta API/DB/manifest/Trace exposure to Tally; no Task/Claim/Review/CI/Release authority granted by a task-meta receipt, metric, label, outbox record, or Feedback phase.

**L2-D03 — Typed local epistemics, no new public wire.** OBSERVED means an actually witnessed fact at the correct source owner/lane; INFERRED is a versioned diagnostic classifier; SELF_REPORTED is the actor's unverified statement; UNKNOWN is withheld/missing/conflicted, never 0. Diagnostic C08 analysis and new internal joins live in private data-only records; the existing ADS v4/v5 strict report schema continues to control every allowed public key. If not representable and cleared, WITHHELD/UNSUPPORTED, not a new property/report kind.

**L2-D04 — Fail closed at both adoption and GitHub write boundaries.** Existing src/report/pin.ts is known bad: legacy owner_authorized all-repos candidate can be default with publish=true. A v0.3 resolver MUST reject candidate for ordinary normal public v5, even if implicit profile, and MUST NOT silently downcast to v4. An exact qualified v4.16 main adoption entry (eligible main source 718fb02e33b31f568736447b2b905883cc6fcc3a), verified unchanged v5 Schema blob, explicit clearance and native permission are jointly necessary. An isolated explicitly allowlisted test repository can receive a candidate under E2E_TEST_SUBJECT only, with nonproduction limits and no release qualification. A legacy config permission never overrides source-qualified release/profile/permission checks. A valid qualified fallback v4 mode requires its own effective pin/profile authorization.

**L2-D05 — Identity and replay correctness.** Do not infer event uniqueness from Git commit tree, identical transition signature, issue comment timestamps, a transport GitHub login, or model label. One logical call can have multiple real physical Attempts; one physical Attempt can be delivered repeatedly. Same verified source event ID, source revision and validated data digest can be duplicate delivery. Same key with different digest is CONFLICT. Two distinct attempt_ref IDs with identical source transitions must both survive; VersionState dedup by same qualified SHA is separate from actual Attempt/operation dedup. Causality requires source-witnessed edge, not timestamp sort.

**L2-D06 — Correction is a source-qualified event, not history mutation.** Native GitHub objects use their real type/ID/URL/subject snapshot/owner/currentness; Report comments additionally have their exact schema-specific namespace/report_id/revision/kind/Task/Attempt/digest. v4 correction target requires exactly its allowed 8 fields; v5 target exactly 14, per unchanged strict schema. Only actual owner-qualified REVOKE/REDACT or separately owner-qualified invalidating supersession/stale source can withhold future materially dependent use; every DISPUTE alone is nonrevoking, even same owner. Independently proven material contradiction => UNKNOWN only for affected new dependent conclusion, not verified revoked. Consumer-local Tally material-use edges are never fabricated from presence/citation; historical BUILD/Host pins and native effects never retroactively rewritten.

**L2-D07 — Versioned capability and comparison.** Provider token/cache/cost/clock/route data can be aggregated only within eligible physical/logical attempt identities, nonoverlapping windows and suitable source/price revision. BILLED requires actually witnessed billing, PROVIDER_REPORTED never relabelled BILLED, ESTIMATED always exposes price basis. Cache read/write included within normalized input_tokens must not be added again. Unknown/unsupported/withheld is never zero or clean absence; cross-profile comparison without common revision/capture denominators => NOT_COMPARABLE. No performance leaderboard or optimization policy.

**L2-D08 — Version Closure is independent.** v0.2 implementation exists at main but no verified v0.2 qualified release and package.json says 0.1.0. Exact main code is carried as an **unqualified source baseline only**. v0.3 must independently qualify full release version, package/plugin metadata compatibility, required regression, real producer capture/Host/GitHub readback and Release gates; Tally live application end-to-end is an explicitly separate integration track, recorded NOT_RUN if unavailable. No interim merge to main.

## 2. Interfaces and source shapes (private analysis, not ADS schema)

~~~ts
type SourceKind = "NATIVE_ISSUE" | "NATIVE_PR" | "NATIVE_REVIEW" | "NATIVE_CI" |
 "NATIVE_CLAIM" | "NATIVE_COMMENT" | "ADS_REPORT";
type WitnessStatus = "VERIFIED_CURRENT" | "VERIFIED_REVOKED_OR_STALE" |
 "UNVERIFIABLE_OR_PARTIAL" | "DISPUTED" | "CONFLICT" | "UNKNOWN";
interface NativeSourceRef {
  kind: Exclude<SourceKind, "ADS_REPORT">;
  repository: string; objectId: string; url: string;
  subjectRevisionOrSnapshot: string | null;
  sourceSha: string | null; observedAt: string; witnessRefs: string[];
}
interface AdsReportSourceRef {
  kind: "ADS_REPORT"; repository: string; issueNumber: number;
  commentId: number; commentUrl: string;
  profile: "ads/github/v4" | "ads/github/v5";
  reportKind: string; reportId: string; revision: number;
  publisherNamespace: string; taskRef: string | null; attemptRef: string | null;
  dataDigest: string; nativeIntegrity: WitnessStatus; sourceRefs: string[];
}
interface FactualFeedbackJoin {
  report: AdsReportSourceRef; feedback: AdsReportSourceRef;
  factualPhase: "PRESENTED" | "ACCEPTED" | "APPLIED" | "SKIPPED" |
                "INDEPENDENTLY_CHECKED" | "OBSERVED_EFFECT";
  sourceQualified: boolean; causalEffectiveness: "UNKNOWN";
  limits: string[];
}
interface PrivateTrajectorySample {
  opportunityId: string; cohort: string; scopeRef: string;
  beforeStrategyOwnerRef: string | null; afterStrategyOwnerRef: string | null;
  causalSelectionWitness: string | null;
  priorVisitAndDepartureWitness: string | null;
  ownerEquivalenceWitness: string | null; labelerRevision: string | null;
  lane: "OBSERVED" | "INFERRED" | "SELF_REPORTED" | "UNKNOWN";
  scope: "PIVOT" | "REVISIT"; eligible: boolean | null;
  positive: boolean | null; excludedReason: string | null;
}
interface PrivateComparison {
  lane: "OBSERVED" | "INFERRED"; scope: "PIVOT" | "REVISIT";
  numerator: number | null; denominator: number; excluded: number;
  cohort: string; labelerRevision: string | null;
  comparability: "COMPARABLE" | "NOT_COMPARABLE"; limits: string[];
}
~~~

These are **design-level internal contract candidates**, not frozen TS public exports or new public ADS profile fields. L2 review must validate that actual profile-specific enums/fields are never incorrectly imposed across native versus Report sources. No private join record is an unforgeable proof of downstream Tally consumption.

## 3. Module delta / writer ownership

| Concern | Existing surface and bounded delta | Sole write scope / owner |
|---|---|---|
| FR00 #36 | src/report/pin.ts; config/ads-adoption.json; test/report-pin.test.ts; call-site preflight check | one source-authority writer, before real normal v5 publication |
| FR01 #28 | src/lineage/dag.ts attempt-preservation; source event identity in existing model; new factual GitHub report/feedback join helper | identity/feedback join, no other task edits GAIP / v5 schema |
| FR02 #29 | src/publish/publish.ts / client.ts bounded readback; private correction/currentness helper + tests | publisher/correction writer; preserve current v0.2 public API where possible |
| FR03 #30 | src/aggregates/index.ts metrics/private coverage and helper; per-profile projection tests | metrics capability writer; no new v5 wire |
| FR05 #33 | src/labels/index.ts diagnostic code-vs-strategy separation; src/lineage/dag.ts technical candidate vs strategy lane; new private trajectory evaluator | trajectory writer, coordinate src/lineage/dag.ts with FR01 |
| FR04 #31 | test/v0.3 and Golden fixture inputs, test-only GitHub fake/readback; real Node24 evidence ledger | integration/validation writer, not an adapter rewrite |

**Shared-path collision mitigation:** FR01 and FR05 both touch src/lineage/dag.ts, so **FR01 attempt identity preservation first**, then FR05 trajectory changes (or disjoint adapter extraction with owner-reviewed contract and zero overlapping writes). FR00 and FR02 touch publisher path only if FR00 changes caller checks; FR00 owns adoption resolver, FR02 owns existing GitHub publish/readback, do not edit same function in parallel. FR03 + FR02 may run in parallel if reports remain built only by existing writer. CI tests never become source of authority for external Host.

## 4. Ordered bounded decision procedures

### 4.1 Admission before any ordinary GitHub POST
1. Resolve effective profile from explicit user profile, actual adopted main revision, repository policy, candidate-test allowlist. Reject unqualified candidate when ordinary publish=true even if historical owner_authorized scope=all. Do not override with default profile.
2. Verify vendored v5 schema git blob + effective ADS main pin and actual source/Issue/repository target, actor authority, public privacy clearance. Failed check => HELD/NOT_PUBLISHED + safe reason, **zero createIssueComment**.
3. Build and validate exact profile report; confidential fields remain private. Resolve actual prior same-profile lineage.
4. Read current Issue comments with complete bounded pages and source currentness. If comment pages insufficient/403/429/timeout, record UNKNOWN and never assume absence.
5. Same report identity+digest => ALREADY_PUBLISHED; same identity+different digest or edited native ID => CONFLICT; no blind write.
6. After POST lost ACK/network exception, full bounded find/readback before retry; absent only if complete bounded read, and retries bounded. Real native returned ID is attached to receipt *after* publication. Do not pre-fill self URL.

### 4.2 Private source-qualified feedback and correction
1. Treat fetched native GitHub body as untrusted; parse supported effective ADS comment/Report kind/schema only, fully paginated and with immutable actual URL/ID.
2. Match owning Issue/source-profile/Task/Attempt/namespace and digest; for cross-kind native refs only demand fields the source kind actually has. Foreign namespace ≠ owner even if GitHub transport actor same.
3. Only an actually observed factual Feedback phase yields a factual join, not a consumed-material edge or inferred permission/effectiveness; any ambiguous join remains UNKNOWN.
4. Correction target requires exact original comment+profile tuple and owner/correction source. DISPUTE with or without owner is nonrevoking; independently observed conflict makes new materially reliant output UNKNOWN, not REVOKED.
5. Keep previous publications and private manifest lineages immutable, version later observations; future Tally choice invalidation is out of task-meta scope.

### 4.3 C08 Pivot/Revisit private trajectory
1. Build VersionState and source-witnessed causal Transition; do not serialize parallel independent branches by timestamp, don't collapse distinct Attempts sharing same transition signature.
2. Owner OBSERVED strategy requires preexisting authority from Product/Task/Skill/Procedure. A Git diff/technical code rollback or labeler output cannot create owner strategy identity.
3. For eligible observed Pivot count changed strategy in N_obs_pivot, qualified comparable selection in D_obs_pivot; independently qualified unchanged = eligible 0/1.
4. For observed Revisit D_obs_revisit additionally need prior witnessed visit **and departure**, causal history and owner-decided match/nonmatch before evaluated selection. A→B first transition excluded; A→B→A-prime with witness yields 2/2 Pivot and 1/1 Revisit; eligible non-return 0/1.
5. For classifier INFERRED use source-feature complete cohort and stable versioned classifier/labeler; exclude unavailable features and don't pool with OBSERVED. Expose unknown/excluded counts. D=0 => NOT_COMPARABLE; never 0% success.

## 5. Security, correctness and failure handling

- **Data classification:** field-level metadata allowlist at ingress and readback; prohibit private manifest body/prompt/hidden reasoning/tool args/results/secrets, no arbitrary URL fetch from report refs. Only canonical allowed GitHub objects with bounded identity. Source quotes are not new operations.
- **Completeness:** actual terminal pagination, page counts, 403/429/retry budget, native edit observations and concurrent drift; no last-writer-wins. Mismatched URL/data digest or partial caller data => fail closed.
- **Clock/time:** observation_ts/source wall-clock != causal ordering; unknown clock domain and parallel branches exclude affected comparison opportunities.
- **Concurrency:** one source writer per Task/repository fragment, CAS on source/version branch, preserving exact reviewed SHA. GitHub provides no atomic snapshot/exactly once, use idempotent keys+bounded recovery.
- **Supply-chain:** existing vendored public v5 Schema immutable; explicit ADS source pin and blob verification; no dynamic schema download from report data, no v6.
- **Cost:** BILLED vs provider estimate distinct; model route/price revision unavailable => unknown, no double count of parent/child and retry records.
- **Test truth:** no proof of live GitHub/native permission from schema-valid fixture; independent Review, Host E2E, Release all separately checked.

## 6. Conformance and acceptance matrix

| ID | Test oracle | Target owner |
|---|---|---|
| L2-T00 | all-scope owner-authorized candidate, adopted=[], ordinary default v5+publish => blocked/no POST; qualified-main exact blob+clearance passes; isolated E2E explicit purpose distinct | #36 |
| L2-T01 | two distinct attempt_ref with identical Git transition signature both survive; true same source-event+digest delivery dedups; collision conflicting digest held | #28 |
| L2-T02 | report/feedback same Issue+profile+namespace/Attempt join; native-only PR without Report fields remains valid native source; missing actual use edge not inferred | #28 |
| L2-T03 | full paginated lost POST ACK, duplicate and edit conflict, 403/429/missing terminal page => no blind retry/zero | #29 |
| L2-T04 | v4 eight-field correction vs v5 fourteen-field exact target; qualified REVOKE/REDACT vs nonrevoking same-owner/foreign DISPUTE | #29 |
| L2-T05 | provider source metric windows and logical/physical attempts avoid double-billing; cache tokens counted once; privacy redacts model route | #30 |
| L2-T06 | owner-witnessed A→B→A-prime yields D_obs_pivot 2/2 and D_obs_revisit 1/1; initial A→B excluded; code rollback alone UNKNOWN | #33 |
| L2-T07 | distinct inference cohort, labeler version change, concurrent branches, D=0 => separate private not-comparable ratio and excluded coverage | #33 |
| L2-T08 | ADS shared Golden positive/negative source-only and real GitHub native readback; real agent test/Host/CI/Tally states separately evidenced or NOT_RUN | #31 |
| L2-T09 | changed older v4 report not silently converted v5, v4-only consumer => UNSUPPORTED; private-only diagnostic withheld from public schema | #30/#31 |
| L2-T10 | Node24 lint/typecheck/unit/packaging, 3 adapters real or scoped waiver, producer live E2E; independent version RQ, correct 0.3.x package/manifest | #31 and RQ |

**Layered gates:** Source-only deterministic tests on exact source; actual Node 24 environment (Ubuntu/Windows where relevant) separate; isolated GitHub real publisher readback; independent Reviewer of exact code SHA; security/privacy negative oracles; Version Closure. If CI is unavailable, record waiver with what did and did not run; no PASS substitution. Tally full rewrite is external and not a hidden prerequisite, though shared interface conformance is required.

## 7. Proposed post-Freeze native DAG (NOT YET ADMITTED)

R0 architectural decomposition (Issue assignment after independent L2 PASS and Architecture Owner Freeze):
- D0: inherited source/Product Freeze, architecture accepted, effective adoption policy.
- T00: #36 normal ADS main-qualified publisher adoption guard (P0).
- T01: #28 actual attempt/source identity and GitHub feedback association (P0).
- T02: #29 source-currentness & correction reconciliation (P0).
- T03: #30 comparable privacy-safe metrics (P1).
- T04: #33 C08 strategy trajectory/denominator separation (P0), **requires T01 identity/lineage contract** because same src/lineage/dag.ts.
- T05: #31 source-only ADS shared Golden/negative conformance (P0); inputs T00–T04; fixture creation can be prepared earlier without claiming integration PASS.
- T06: #31 actual Node24 agent/Host+native GitHub E2E, exact source regression, independent Release Qualification and version closure; inputs T00–T05.

To avoid needless serial execution, **T00/T01/T02/T03 may start concurrently after DAG admission and owned disjoint write sets**; T04 follows T01 contract; T05 fixture authoring is separable but gate results require implementation; T06 is final integration. One issue/one implementation concern/one PR, review exact H. Do not admit executable tasks from this draft alone.

## 8. Independent Architecture Review request / unresolved checks

1. Does L2-D04 bind qualified **main**, existing Schema and effective clearance robustly without confusing the old owner-authorized candidate, including src/autoreport default caller?
2. Does current src/publish/publish.ts have any existing readback semantics reused safely rather than inventing redundant publisher? Is another v5 public field truly unnecessary?
3. Are NativeSourceRef vs AdsReportSourceRef properly source-kind distinguished? Does actual feedback phase remain fact only, no fictitious consumer use?
4. Are same-sha VersionState de-dup and different-attempt causal occurrence both preserved? Is FR01/FR05 write collision serialized legally?
5. Does a same-owner DISPUTE stay nonrevoking even with correct target? Are correction and version supersedes immutable/profile exact?
6. Do C08 denominators/absence/coverage and observed vs inferred lanes obey §10 including concurrency and distinct physical retry?
7. Is the 7-node proposed DAG bounded enough; does Release RQ stay after actual Host qualification with appropriate waiver discipline?
8. Verify exact-source currentness of frozen Product, ADS GAIP/schema, current main baseline; record exact H and L2 blob; findings P0/P1/P2 and ARCH_FREEZE_READY. **Reviewer must not self-freeze or execute a Builder Claim.**

**Stage truth:** PRODUCT_FREEZE=YES; L2_R0_WRITTEN_ONLY; L2_INDEPENDENT_REVIEW=NOT_RUN; L2_FREEZE=NO; DAG=NOT_ADMITTED; TASKS=NOT_STARTED; HOST/GOLDEN/RQ=NOT_RUN; MAIN_MERGE=NO.
