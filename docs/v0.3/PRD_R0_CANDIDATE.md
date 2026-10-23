# task-meta v0.3 — PRD R0 Candidate

**Status:** PRODUCT_PRD_R0_CANDIDATE / INDEPENDENT_PRODUCT_REVIEW_NOT_RUN / PRODUCT_FREEZE=NO / L2_NOT_FROZEN / TASK_DAG_NOT_ADMITTED / NO_V03_IMPLEMENTATION_CLAIM.
**Parent:** [#27](https://github.com/kaicreator-mm/task-meta/issues/27). **Requirement lanes:** #28/#29/#30/#31/#33. **L1 evidence:** [L1_PRODUCT_EVIDENCE_R0.md](./L1_PRODUCT_EVIDENCE_R0.md).

## 1. Product decision and value

v0.3 makes task-meta a **source-qualified ADS v4.17 evidence/feedback producer and observational analysis companion**, building directly on existing v0.2 capture/publisher. The version provides reconstructible evidence→report→public feedback joins; lawful immutable correction/currentness; profile-safe public comparability; optional C08 owner-governed strategy trajectories; joint ADS GitHub-only Golden producer conformance. No alternate transport or task authority.

**Primary user journey:** a real ZCode/Claude Code/Codex Task is bound to Issue/Attempt and witnessed Agent/Host events; task-meta retains only safe private immutable observations, publishes a qualified ADS v5 `EXECUTION_SUMMARY` with actual native GitHub readback; a future Tally reader accesses only native GitHub records, and may publish existing ADS `EXPERIENCE_USE_FEEDBACK`; task-meta separately observes its source-qualified native public reference as facts, without inferring Tally selection or effectiveness. Late verifier evidence or a lawful correction produces profile-valid revision/notice, never historical mutation. Independent Cross-system Golden and real E2E are distinct.

## 2. Authority and non-goals

- ADS v4.17 protocol baseline is `version/v4.17@1355bc0694b3b0225effa82b670725f83a2b873b`; GAIP normative blob `49ecd802c5bf14237e23d5e321c56c220eb8974e`; existing v5 schema blob `7478313cc006162432649d734e59c5cd77db5106`. C08/C10 are source-merged; ADS full v4.17 Release NOT asserted. Production adoption requires effective qualified/project-authorized profile pin and limits.
- ADS solely owns semantics and public wire. task-meta owns collecting and safely projecting facts, NEVER Task acceptance, CI/Review/Host truth, Tally advisory decision, requalification of Tally candidates, package authoring, Agent scheduler/optimizer, policy engine, or training.
- No Tally→task-meta callback, DB, API, SDK, raw-Trace or private-manifest reads; Tally GitHub-only access is a non-negotiable interface. No new `ads/github/v6`, v5 fields, report kinds or global Gate.
- Historical v3/v4/v5 payloads unchanged. No universal required provider hook; provider capability and privacy limit are explicit. No raw prompts, reasoning text, private file paths, complete tool args/results, secrets, hidden grader, private source diffs in public objects.

## 3. Functional requirements

### FR01 — Source-qualified causal/feedback reference join (#28, C09; P0)
- Stable namespaced `source_event_id`, adapter revision, Session, Task/Issue, run/attempt, logical vs physical call, exact source SHA if actually witnessed; immutable public Report identity = canonical owning GitHub Issue + namespace + report ID + revision + kind + actual comment ID/URI + source/profile/data digest.
- Optional public Feedback join stores **only** GitHub native source reference, actual profile/revision/namespace, factual observed phase and source verification. `PRESENTED`, `ACCEPTED`, `APPLIED`, `SKIPPED`, `INDEPENDENTLY_CHECKED`, `OBSERVED_EFFECT` remain separate. A source-present feedback does not imply Tally actually consumed a premise, nor proof of applied benefit.
- Missing/colliding/foreign/stale/partial refs → UNRESOLVED/CONFLICT/UNKNOWN; full bounded GitHub native readback; timestamp/GitHub shared-login/model-string joins prohibited; no double-counting by feedback reappearance. **Distinct real Attempt identities remain distinct even if they share an identical Git transition signature, code SHA, timestamps, or source tree.** Only verified same original source-event identity+digest dedupes duplicate delivery; incompatible same-key payload is CONFLICT. Current `src/lineage/dag.ts` signature-based attempt coalescing needs source-identity delta review.

### FR02 — Immutable source-currentness/correction reconciliation (#29, C10; P0)
- Retain exact historic source and report publications/receipts/chain; immutable revision/supersedes according to selected v4/v5 profile. New correction is an owner-qualified `EXECUTION_CORRECTION` notice against an actual read-back prior target, not an in-place overwrite. Replacement fact = new profile-valid revision.
- Resilience to lost acknowledgement, 429/403/timeouts, GitHub edit, cross-namespace conflict, interrupted pagination. Exhaust all pages within configured limits; lack of complete result is UNKNOWN/HELD, never negative evidence or blind retry. Duplicate identity+digest is idempotent; same identity/different digest CONFLICT.
- Source-null/dirty/unpinned observations remain private unless selected exact effective report profile actually permits a collector-only public projection; do not fabricate source SHA or verifier PASS.
- `notice=REVOKE|REDACT` can invalidate *only* a source-owner-qualified exact target; `DISPUTE`, even same-owner and schema-valid, never alone revokes or withholds. Independent material contradiction may yield UNKNOWN for a new actually reliant inference, not verified revocation. Tally owns dependent decisions/eligibility; historic BUILD/Effects unchanged.

### FR03 — Safe metric projection and comparability (#30, C12; P1)
- Reuse existing v5 typed metric identity, cost/accounting and v0.2 adapter signals. Per-provider capability matrix distinguishes actually witnessed vs declared/unsupported token/tool/model/route/cache/clock/invoice fields.
- Every derived/public metric has units, physical/logical attempt and distinct window/revision, numerator/denominator/observation coverage, source and privacy clearance, accounting basis `BILLED` vs `PROVIDER_REPORTED` vs `ESTIMATED` vs `UNKNOWN`. Do not double count parent/child, retries, historical corrected reports or estimate+billed revisions.
- Publish only what exact adopted public schema/clearance permits; route IDs may be private while aggregate remains publishable. Unsupported older reader returns UNSUPPORTED/NOT_COMPARABLE/UNKNOWN, not zero and not a fabricated model leaderboard.

### FR04 — Shared producer Golden and real E2E qualification (#31, C11; P0)
- Consume ADS language-neutral shared positive/negative normative Golden (or pinned candidate when not yet released), implement isolated producer fixtures with source/schema pin + expected disposition + actual test result + public digest/readback evidence.
- Positive: valid Task summary → native GitHub publication/readback; factual later feedback, lawful revision; C08 private diagnostic if available. Negative: duplicate/lost ACK, edited native comment, foreign/cross-namespace correction, same-owner DISPUTE, wrong subject SHA, partial/missing pagination, denied clearance, older v4-only reader encountering v5, model route restricted, retries/cost windows, source-null/not-publishable.
- Distinguish SOURCE_ONLY fixtures, REAL_GITHUB provider, REAL_AGENT capture, REAL_HOST/CI and REAL_TALLY_APP stages. No simulated PASS promoted to real stage; each stage may be NOT_RUN.

### FR05 — C08 strategy trajectory interpretation (#33, #15–#17, C08; P0 semantic integrity)
- Reuse technical VersionState/Transition and the v0.2 rule labeler; existing code `REVISIT_CANDIDATE` is a **Git/code-version** signal only, *not* proof of authorized owner strategy `OBSERVED Revisit`. Do not silently reinterpret historical records.
- Support distinct private `OBSERVED` (actual qualified strategy owner decision+causal chain+equivalence), `INFERRED` (source-linked classifier with version, cohort, coverage), `SELF_REPORTED`, `UNKNOWN`, without mixing lanes or creating new ADS wire/state fields.
- `D_obs_pivot` = witnessed comparable causal selection with two governed strategy identities; `D_obs_revisit` additionally requires prior witnessed visit+departure and decidable owner equivalence/nonmatch at evaluated selection. `D_inf_pivot`/`D_inf_revisit` use wholly source/feature-qualified classifier opportunities in same revision/cohort.
- Explicit noncomparable denominators when D=0, unknown excluded from both N and D but recorded for capture coverage; concurrent unordered histories remain unsequenced. Positive A→B→A′ = observed Pivot 2/2, observed Revisit 1/1 if owner-governed; initial A→B excluded from Revisit D; valid non-return 0/1.

## 4. Nonfunctional requirements and failure semantics

- **Safety/privacy default:** metadata-only, field allowlist, no private manifest/body in GitHub public report; explicit `PUBLISHABLE` clearance, source ref allowlist/canonical GitHub only; redact before persistence where necessary and again before public projection.
- **Recoverability:** source-owned event revisions append-only/CAS, bounded idempotent publication, crash/lost-ACK reconciliation; conflict and page incompleteness fail closed without claiming exactly-once atomic GitHub service.
- **Determinism:** equal source inputs/profile/pins → equal normalized metrics/digest and safe disposition, independent of adapter arrival order. Distinguish true physical attempts from duplicate event delivery.
- **Performance:** retain asynchronous/low-overhead capture and optional diagnostics; no blocking Agent session for Tally state or GitHub unavailable; persisted outbox/retry with bounded budgets.
- **Version isolation:** v0.3 work starts only after effective v0.2 baseline/version status and corresponding ADS pin disposition; use `version/v0.3` after Product/L2/DAG admission, complete version branch before main merge. PR local PASS ≠ v0.3 Release PASS.

## 5. User-visible acceptance scenarios

| Case | Witness | Required disposition |
|---|---|---|
| A01 | Real supported Agent run → exact Issue/Attempt → ADS v5 report → actual comment readback | One qualified publication with digest and source limits |
| A02 | Two logical Agent sessions share one GitHub login, or two real retries sharing an identical source-version transition | Distinct actors/Attempts; only true source-event duplicate delivery collapses |
| A03 | Report revised, duplicate delivery/lost ACK | Same tuple+digest dedup; cross-digest CONFLICT |
| A04 | Actual feedback PRESENTED only, or APPLIED without exact independent verifier | No checked/effectiveness promotion |
| A05 | Wrong comment/SHA/owner, altered post-publication body, 403/429/missing terminal page | UNKNOWN/HELD/CONFLICT; never PASS/no-data=0 |
| A06 | Same-owner DISPUTE, owner REVOKE/REDACT, foreign DISPUTE | DISPUTE nonrevoking; only lawful effective notice changes target usability |
| A07 | Dirty/no SHA, delayed verifier | Private retained; truthful collector-only if schema allows; no fake commit |
| A08 | Token/cost retry, late invoice, different measurement windows | No duplicate aggregation; basis/coverage and NOT_COMPARABLE clear |
| A09 | Restricted model-route with publishable aggregate | Route withheld; no invented per-model comparison |
| A10 | Code rollback looks like strategy Revisit but lacks owner strategy decision | Technical candidate, strategy OBSERVED = UNKNOWN |
| A11 | Owner-qualified A→B→A′ with witnessed selections+departures | OBS Pivot 2/2; OBS Revisit 1/1; first A→B excluded |
| A12 | Two unordered branches or labeler version drift | No forged causal order or cross-revision strategy ratio |
| A13 | v4-only reader sees v5 summary | UNSUPPORTED, not empty Task/result |
| A14 | SOURCE_ONLY Golden passes while real Tally/Host not run | SOURCE_ONLY_PASS + REAL_E2E_NOT_RUN; separate qualification |

## 6. Delivery scope and dependency policy

**Feature set:** FR01 #28; FR02 #29; FR03 #30; FR04 #31; FR05 #33. Reuse v0.1/v0.2 installed modules, no fork/new DB. Candidate architecture modules `src/feedback`, `src/currentness`, `src/trajectory`, `src/metrics`, `test/v0.3` are suggestions only, NOT approved L2 API names.

**Ordered gates:** L1 R0 authored → independent Product Review P0/P1=0 → explicit Product Freeze → L2 source/ABI/permission design → independent L2 Review and Freeze → small Native Task DAG + authorized Task Claims → implementation & focused PR Reviews → shared ADS Golden and real producer-specific E2E → release qualification → version-branch/main integration. A source-only independent Review is permitted before physical verification, but NOT substituted for runtime proof.

**Parallel work after gate:** C08 trajectory semantics, #28 feedback join and #29 correction ledger are mutually separable if immutable identity/source contracts are frozen; #30 comparability and #31 fixtures can follow in parallel. Only #31 full integration depends on implementations. Full Tally app replatforming is external independent qualification and must not be falsely required for ADS source release or falsely marked PASS for task-meta.

## 7. Open questions for independent Product Reviewer

1. Confirm no duplicated v0.2 publisher/adapter/Golden and v0.2 actual closure state.
2. Confirm new source-owned records do not mint ADS wire or Tally Decision state.
3. Confirm FR05 distinguishes observed code VersionState vs owner-governed strategy, with admissible denominators and source coverage.
4. Confirm correction DISPUTE/nonrevocation, verified REVOKE/REDACT, native-vs-report identities and materially dependent prospective Tally eligibility are correctly separated.
5. Confirm real E2E matrix includes at least one actual provider/Host+GitHub readback and honest not-run other consumers.
6. Record precise P0/P1/P2, `PRODUCT_FREEZE_READY=YES|NO`, pin and changed files. Author must not self-approve.

**This PRD is a candidate for independent review, not a frozen authority or authorization to start a v0.3 Builder.**