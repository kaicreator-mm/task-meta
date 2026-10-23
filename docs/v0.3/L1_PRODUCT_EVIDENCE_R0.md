# task-meta v0.3 — L1 Product Evidence and source-delta ledger (R0)

**Status:** PRODUCT_EVIDENCE_R0_CANDIDATE / NOT_INDEPENDENTLY_REVIEWED / PRD_FREEZE=NO / L2_FREEZE=NO / TASK_DAG=NOT_ADMITTED. This is authored design evidence, not independent Review, an implementation Claim, or Release qualification.

## 1. Immutable observed baselines

| Source | Exact immutable identity | Fact and bounds |
|---|---|---|
| task-meta implementation | `main@36ea9147239fe669d021c7eb273a864322f27356` | PR #32 merge and current source baseline; no `v0.2` Release PASS implied |
| task-meta v0.2 source specification | `docs/v0.2/DEFINITION.md` blob `267d27f8c491bd34287cff9e6319ed2db4165469` | v0.2 auto-report, adapter and Golden baseline; status is feature implementation, not v0.3 contract |
| ADS v4.17 protocol phase | `version/v4.17@1355bc0694b3b0225effa82b670725f83a2b873b` | C08/C10 integrated only into version branch; full ADS v4.17 Release NOT CLAIMED |
| ADS normative owner | `standards/GITHUB_AGENT_INTERACTION_PROTOCOL.md` blob `49ecd802c5bf14237e23d5e321c56c220eb8974e` | §10 C08, §16.6–16.7 C10; no new v3/v4/v5 wire |
| ADS compatible predecessor | `main@718fb02e33b31f568736447b2b905883cc6fcc3a` | v4.16 predecessor qualified; v5 schema blob `7478313cc006162432649d734e59c5cd77db5106` |
| task-meta v0.3 Product requirements | #27–#31, #33 | Future requirements, not implemented tasks |
| downstream requirement intake | Tally #70–#72 | Not a current Tally runtime qualification |

**Currentness boundary:** These pins are exact review subjects, not mutable `latest` imports. On a branch/source change rerun the applicable source-delta comparison. Any project-specific production adoption must use an effective qualified/owner-authorized ADS profile with clearly recorded limitations. V4.17 version-branch protocol text is usable for source-conformance development but is not automatically an authorized production v4.17 release.

## 2. Existing code and real delta (do not duplicate)

| Feature | Baseline inspected at main@36ea914 | v0.3 delta | Requirement |
|---|---|---|---|
| Adapters ZCode/Claude Code/Codex | `src/adapters/*`, `plugins/*`, `src/autoreport/*` delivered through PR #21, #23–#25, #32 | Reuse; no universal new hook | #2, #8 |
| Per-event identity and metrics | `src/model.ts` ObservationRecord / MetricIdentity | Cross-system qualified report+feedback join, preserve logical vs physical retry | #28 |
| Version DAG | `src/lineage/dag.ts` composes technical Git ancestry and attempt transitions | Do not treat Git ancestry/timestamp as owner strategy causal proof | #33 |
| Rule labels | `src/labels/index.ts` `REVISIT_CANDIDATE` with `OBSERVED` for code-version revisit | Distinguish code revisit from verified owner-governed strategic Revisit and inferred hypothesis | #33 |
| Derived aggregates | `src/aggregates/index.ts` `revisit_candidates` over all transitions and no legal public field | C08 eligibility denominators, coverage and NOT_COMPARABLE; lawful metric projection only | #30, #33 |
| Private immutable evidence | `src/store/*` and `src/collect-core.ts` | Source currentness, corrections, feedback journal; reuse CAS and manifests | #29 |
| ADS report publisher | `src/report/*` + `src/publish/*` | Source-qualified extended readback/identity, typed existing report revisions; do not create v6 | #29–#31 |
| Golden | PR #26 224 captured events, rule-labeler in-sample adjudication | Contract Golden plus independently observed real GitHub/Host/Tally chain | #31 |

### Observed risks

**R1 / high:** The current labeler emits an `OBSERVED` technical `REVISIT_CANDIDATE`; advertising it as ADS C08 *strategy* OBSERVED would fabricate owner/causal proof. Keep existing historical technical labels interpretable, introduce explicit new interpretation and versioned labeler/aggregate outputs; never retroactively rewrite historical evidence.

**R2 / high:** Existing aggregate `revisit_candidates` uses all transitions as denominator; v4.17 C08 requires a witnessed earlier visit+departure, owner-equivalence or classifier-specific eligible history. First A→B is excluded, NOT zero/negative.

**R3 / high:** GitHub is nontransactional; lost ACK and edited comments need complete bounded native pagination, same namespace/identity/digest reconciliation, conflicted results explicit. Do not blindly POST or trust most recent timestamp.

**R4 / high:** A `DISPUTE` (same owner or foreign namespace) is NOT an invalidating `REVOKE/REDACT`; substantive independently witnessed contradiction can only make a dependent conclusion UNKNOWN pending disposition.

**R5 / medium:** `package.json` currently reports `0.1.0` despite merged v0.2 feature work. Formal prior version closure must be measured and reported; no claim v0.2 Release PASS from PR merge or test counts.

**R6 / medium:** Consumer has no private task-meta API/Manifest access. Public metric attribution and experience feedback must be complete enough *when legally publishable*; otherwise unsupported/unknown, not invented API.

## 3. Single-owner RACI/transport boundary

- **ADS** owns canonical semantics, exact v3/v4/v5 report profile, correction ownership, C08 read-only interpretation, Golden expected outcomes and any future normative/public-wire change.
- **task-meta** owns metadata-only Agent/Host adapter ingestion, private immutable observations, source-qualified factual linkage, provider capability matrix, optional private diagnostics, safe profile-conformant GitHub Report projection, corrections and actual publication/readback receipts.
- **GitHub native Issue/PR/CI/Review/Claim** and **Host verifier** remain authoritative for admitted Task/verified actual execution. Publisher reports and model self-report never mint native PASS.
- **Tally future TypeScript/DomainHarness consumer** owns GitHub-only derived EvidenceIndex, material-use edges, advisory selection, candidate requalification, feedback production and authorized K/Host/Task effects; not task-meta private APIs/DB/manifest/raw Trace.
- **Source separation:** a GitHub comment's existence does not prove material use; `StrategyCandidateRef` does not grant a Strategy authority. One GitHub login does not collapse logical actors.

## 4. Product concern mapping

| Lane | task-meta | ADS v4.17 semantic owner | Tally consumer |
|---|---|---|---|
| Source-qualified attempt→report→feedback join | #28 | C09 #1295, existing v5 feedback | #70 |
| Correction/currentness/prospective eligibility inputs | #29 | C10 #1296 (merged GAIP §16.6–16.7) | #71 |
| Public comparable, privacy-safe metrics | #30 | C12 #1298, inherited v5 schema | #72 |
| Shared contract Golden and runtime-independent witness | #31 | C11 #1297 | #72, #62 |
| Optional strategy Pivot/Revisit interpretation | #33 / existing #15–#17 | C08 #1287 (merged GAIP §10) | No required direct input; optional future analysis |

## 5. Evidence required to advance

- Product review must resolve all R1–R6 risks with source-specific acceptance and distinct reviewer PASS/P0=0,P1=0 before Product Freeze.
- After Product Freeze, L2 defines module contracts, private record types, public-schema-compatible projection, version/compatibility, source/identity/causal rules, correction readback state machine, explicit failure and test matrix; independent L2 Review/Freeze required.
- Native Task DAG must map accepted Product/L2 requirements to small nonoverlapping tasks, with read/write sets, dependencies, exact acceptance and local-only work isolated, before an implementation Claim.
- Golden source-only conformance ≠ actual real ZCode/Claude Code/Codex+GitHub readback+Tally/Host E2E. Unrun or unavailable stages remain NOT_RUN/UNKNOWN; a CI waiver is recorded, not recast as PASS.
- No new runtime/LLM optimizer/scheduler/skill authoring/private Tally egress; no new v4/v5 properties and no mutable rewrite of prior reports.

## 6. Unresolved Product decisions for distinct reviewer

1. Does a source-qualified GitHub-only feedback ingestion in task-meta deliver user value without taking Tally's material-use owner role? (Proposed: yes, read-only factual reference.)
2. Should private C08 diagnostic outputs be required for release without provider owner-strategy witnesses? (Proposed: support true UNKNOWN/private inferred paths, no fake OBSERVED requirements.)
3. Is strict v5 existing Report sufficient for public meaningful metrics? (Proposed: emit only representable authorized metrics, publish gap otherwise; no v6 in v0.3.)
4. What is v0.2's real Release status beyond merged PRs? (Cannot assert complete until separately checked.)
5. Should Tally app E2E block this version? (Proposed: source/producer verification required; cross-product Tally live runtime explicitly separate, NOT_RUN when unavailable.)

Source-only L1 evidence, not a test or implementation claim.

### Additional source-delta finding R7 / high — same-transition attempts may be incorrectly collapsed

At `main@36ea9147239fe669d021c7eb273a864322f27356`, `src/lineage/dag.ts` stores `sigs: Map<transition-signature, first-attempt>` and marks subsequent attempts with identical transition signatures as `DUPLICATE_ATTEMPT`, then skips them from `kept`. **Identical from/to/kind is not proof of the same observed logical attempt or physical delivery**; two independent attempts (including a lawful retry without code change) may legitimately have identical version transitions. The version-DAG may share VersionState nodes but must preserve genuinely distinct attempts/causal selection occurrences in any attempt/metric/feedback evidence. Review must require stable source-event/logical/physical attempt identity before deduping a reported attempt; same source event+same digest may dedupe delivery, different source attempt must remain separate. Tests: (a) same event duplicate delivery collapses, (b) distinct attempt IDs with same version transitions remain distinct, (c) conflicting same event identity/digest is CONFLICT, (d) concurrent unordered branches do not become a temporal causal chain.