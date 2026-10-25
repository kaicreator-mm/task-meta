# task-meta v0.4.0 — Capability-first Task DAG R0

**State:** `DAG_R0_CANDIDATE / INDEPENDENT_DAG_REVIEW=NOT_RUN / DAG_FREEZE=NO / 10_PLANNED_TASK_ISSUES / NATIVE_BLOCKED_BY_0_OF_12 / BUILDER_CLAIM=NONE`. Native GitHub Issue Dependencies are the **only** effective materialized live execution DAG after admission; no prose below makes a Task writable.

## 0. Source authority and identity

| Item | Source and exact identity |
| --- | --- |
| Task DAG Owner | [#64](https://github.com/kaicreator-mm/task-meta/issues/64), branch `planning/v0.4-task-dag-r0` → version integration branch `version/v0.4` |
| Product | v0.4 Product Owner Freeze [#60@6399790312](https://github.com/kaicreator-mm/task-meta/issues/60#issuecomment-6399790312); PRD blob `0af2b9cafd63ca1faa8b2fa612f7fdc5e02db067` |
| L2 | L2 Owner Freeze [#62@6402140575](https://github.com/kaicreator-mm/task-meta/issues/62#issuecomment-6402140575), `version/v0.4@ecf38c7cb1a1b5b8238a0eaf97dac15f70584e54`; L2 blob `5fc32ca154e77cb6bd34f32f4a6a91717b4b4633` |
| Standards | ADS v4.18.0 current qualified **main source** `2c395c55569fe2edf3f4135f12d3d069e526d0b7`, Git tree `cdf032f629668008a940993713a2bfaa219f5653`; Product blob `98772b4594caa44b2611853ae482132f7aefa36b`, L2 blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`; see [ADS R #1327](https://github.com/kaicreator-mm/ai-development-standard/issues/1327#issuecomment-6402104246) |
| task-meta effective runtime ADS report pin | **Unchanged** normal v5 adopted main source `718fb02e33b31f568736447b2b905883cc6fcc3a`, strict schema blob `7478313cc006162432649d734e59c5cd77db5106`; this planning DAG and ADS v4.18 source merge do **not** alter publication grant, claim, schema or historical reports |
| Version strategy | All concern PRs target **`version/v0.4`**; only qualified version R/independent RQ authorizes final `main` integration; previously released v0.3.0 baseline stays unchanged |
| Scaffold | `SF_Binding=NOT_APPLICABLE`: task-meta has **no accepted source-first Scaffold**, so no invented SF anchor, SF↔DF/MI binding or parallel writing permission. Existing frozen L2 module contracts supply genuine write boundary. |

## 1. Capability → independently coherent concerns

| Capability / Product FR | Actual frozen design responsibility | Task ID / Native Issue | Scope and evidence |
| --- | --- | --- | --- |
| Versioned private measurement/lifecycle semantics, FR02–04 | One shared contract and only one cross-module Writer | **T0 [#65](https://github.com/kaicreator-mm/task-meta/issues/65)** | `src/model.ts`; source-only type/identity fixtures; public ADS schema immutable |
| Repository health visibility, FR01 | Catalog/Doctor exists independently of lifecycle observer | **A1 [#66](https://github.com/kaicreator-mm/task-meta/issues/66)** | `src/doctor/**`; read allowlist, privacy, no global CLI/auto-repair |
| Agent event lifecycle, FR02 | Source event witness/capability independent of Doctor UI | **A2 [#67](https://github.com/kaicreator-mm/task-meta/issues/67)** | `src/lifecycle/**` plus narrowly relevant adapter modules; unknown SessionEnd truth |
| In-call governed effect finality, FR04 | One publisher owns all unsafe in-call retry/permission semantics | **B1 [#68](https://github.com/kaicreator-mm/task-meta/issues/68)** | `src/publish/**`; MAY_HAVE_SENT→UNKNOWN, fresh permission each POST, exactly 1 POST in delayed-commit negative |
| Durable recovery, FR04 | Persisted Outbox state/budget/sequence requires integrated B1 outcome | **B2 [#69](https://github.com/kaicreator-mm/task-meta/issues/69)** | `src/autoreport/**` and owned fault harness; journal gaps/skipped fail closed, shared POST/GET/wall budget |
| Measurable capture quality, FR03/06-minimal | Six source-qualified private numerator/denominator calculations | **C1 [#70](https://github.com/kaicreator-mm/task-meta/issues/70)** | `src/aggregates/**` and `src/metrics/**`; Binding 2/3, pair 1/2, resolution 3/4 and success 1/4 |
| Real overhead baseline, FR05a MUST | One isolated physical Host measurement protocol | **C2 [#71](https://github.com/kaicreator-mm/task-meta/issues/71)** | Windows Node24 real ≥5 paired same-workload Hook measurements; no model/provider payment needed |
| GitHub-only producer boundary, FR08 | Producer-only strict ADS Golden and Tally seam | **E [#72](https://github.com/kaicreator-mm/task-meta/issues/72)** | Public report schema/clearance and negative fixture; real Tally App external NOT_RUN |
| Shared wiring + source integration, `7 MUST | Single mutable CLI/manifest/Skill writer and whole-version tests | **I [#73](https://github.com/kaicreator-mm/task-meta/issues/73)** | `src/cli.ts` / package / Skill/Agent rules and integration tests, qualified upstream code only |
| Version qualification, FR05a/`9 | One RQ/qualification/controller, no unrelated source implementation | **R [#74](https://github.com/kaicreator-mm/task-meta/issues/74)** | Exact integrated SHA/Tree, Node24 real Host, independent RQ, guarded main merge only after READY |

**Scope held outside core mandatory DAG:** FR05b performance optimization (measurement-triggered), FR06 C3 expanded provider/cost comparisons, FR07 D private planning-Lane observations, FR09 general experience/evolution are **SHOULD/DEFER**; if separately admitted, use a new source-qualified ADD DAG mutation/Task Pack, do not silently broaden C1 or I. Historic product-intake [#7](https://github.com/kaicreator-mm/task-meta/issues/7), [#8](https://github.com/kaicreator-mm/task-meta/issues/8), [#9](https://github.com/kaicreator-mm/task-meta/issues/9), [#14](https://github.com/kaicreator-mm/task-meta/issues/14), [#17](https://github.com/kaicreator-mm/task-meta/issues/17) stay open by prior Product decision until their full real owner-qualified evidence is complete.

## 2. Planned native Issue DAG — twelve edges, no markdown-only readiness

~~~mermaid
flowchart LR
    T0["T0 #65 Private contract"] --> A1["A1 #66 Doctor"]
    T0 --> A2["A2 #67 Lifecycle"]
    T0 --> B1["B1 #68 Publisher"]
    T0 --> C1["C1 #70 Quality"]
    B1 --> B2["B2 #69 Recovery"]
    C2["C2 #71 Windows Host"] --> I["I #73 Integration"]
    E["E #72 Producer Golden"] --> I
    A1 --> I
    A2 --> I
    B2 --> I
    C1 --> I
    I --> R["R #74 Release"]
~~~

Native `blocked_by` is a relation on the **blocked issue** referencing the **blocking issue's database ID**, not the displayed issue number. These expected authoritative edges were **NOT WRITTEN** at R0:

| Blocked Task Issue | MUST be blocked by Task Issue | Source reason | Native currentness |
| --- | --- | --- | --- |
| #66 A1 | #65 T0 | Shared private catalog diagnostic contract | NOT_PROVEN |
| #67 A2 | #65 T0 | Source/lifecycle typed MissingReason | NOT_PROVEN |
| #68 B1 | #65 T0 | Typed private publisher outcome contract | NOT_PROVEN |
| #70 C1 | #65 T0 | Shared CaptureQuality source schema | NOT_PROVEN |
| #69 B2 | #68 B1 | Durable recovery consumes safe in-call publisher finality API/accepted integrated baseline | NOT_PROVEN |
| #73 I | #66 A1 | Real new Doctor module before CLI registration | NOT_PROVEN |
| #73 I | #67 A2 | Lifecycle semantics before integration | NOT_PROVEN |
| #73 I | #69 B2 | Publisher+Outbox accepted recovery before runtime wiring | NOT_PROVEN |
| #73 I | #70 C1 | Quality module ready for integration | NOT_PROVEN |
| #73 I | #71 C2 | Mandatory real physical overhead baseline before integrated qualification | NOT_PROVEN |
| #73 I | #72 E | Existing strict Producer Golden compatibility before integration | NOT_PROVEN |
| #74 R | #73 I | Integrated exact source and Whole Version RQ cannot start before successful I | NOT_PROVEN |

- **Root Tasks:** T0 #65, C2 #71, E #72 are independent. After T0: A1 #66, A2 #67, B1 #68 and C1 #70 can execute independently with disjoint allowed write sets. B2 #69 waits for **accepted B1** integrated baseline (genuine contract dependency); no unmerged stacked PR is treated as accepted source. I waits A1/A2/B2/C1/C2/E and consumes B1 transitively. R waits I.
- This is an **acyclic 10-node / 12-edge candidate**. Native Issue graph must be POSTed and GET/readback-verified **after independent DAG approval**. Without both write and full reverse readback, `NATIVE_DAG_NOT_PROVEN` for the entire runtime DAG; no Builder Ready, Claim or implementation starts merely because issue text names dependencies.
- The connected Chat GitHub action supports Issue creation and GET native dependency **but not native write**. Use a minimal **local `gh api` mutation handoff** only after this DAG's exact frozen version/Issue Pack snapshot, followed by connected GitHub GET/readback of **all 10 Issues**. Never alter live edges only in Markdown.

### 2.1 Expected canonical native issue identities (immutable at creation)

| Planned ID | GitHub Issue | GitHub database ID (for native mutation) | Pre-execution state |
| --- | ---: | ---: | --- |
| T0 | #65 | `6028433009` | PLANNED / no Claim |
| A1 | #66 | `6028433996` | PLANNED / no Claim |
| A2 | #67 | `6028434988` | PLANNED / no Claim |
| B1 | #68 | `6028435986` | PLANNED / no Claim |
| B2 | #69 | `6028437009` | PLANNED / no Claim |
| C1 | #70 | `6028438007` | PLANNED / no Claim |
| C2 | #71 | `6028438978` | PLANNED / no Claim |
| E | #72 | `6028439945` | PLANNED / no Claim |
| I | #73 | `6028441142` | PLANNED / no Claim |
| R | #74 | `6028442135` | PLANNED / no Claim |

The Task Packs' durable minimal Tests/Contract/Implementation/Failure content resides in each **current native Issue body**. No `Task Pack Freeze` or accepted execution Claim exists yet; independent Reviewer must verify body write-sets and target SHA/currentness before DAG Freeze. Issue body version/frozen references are **not** Native DAG proof.

## 3. Writer exclusivity and true parallel plan

| Candidate execution workfront | Source writer | Disjoint sibling writer? | Read-only/physical handoff |
| --- | --- | --- | --- |
| T0 (root) | `src/model.ts`, own private-contract tests | YES with C2/E | WEB contract owner; independent security/contract Review |
| C2 (root) | `scripts/bench-task-meta-*.ts`, own evidence docs | YES with T0/E | LOCAL Windows Node24 **real paired Host measurements** REQUIRED, not necessarily implementation of other concerns |
| E (root) | `docs/v0.4/integration/**`, own producer-only tests | YES with T0/C2 | WEB/CI; no Tally App dependency |
| A1 | `src/doctor/**` only | YES with A2/B1/C1 **after T0** | WEB and source CI, no auto-install |
| A2 | `src/lifecycle/**` + bounded adapter files | YES with A1/B1/C1 **after T0** | WEB source; LOCAL real Client for version RQ, not new global UI prerequisite |
| B1 | `src/publish/**` only | YES with A1/A2/C1 **after T0** | WEB security, real GitHub scoped permission proof later only if applicable |
| C1 | `src/aggregates/**` and `src/metrics/**` | YES with A1/A2/B1 | WEB/CI, conditional denominators |
| B2 | `src/autoreport/**` + owned fault harness | YES with A1/A2/C1 **after B1** | WEB/CI, optional LOCAL isolated native Issue test; no second publisher |
| I | `src/cli.ts`, `package.json`, `AGENTS.md`, canonical Skill, integration tests | **NO** with upstream source owners; sole central integration writer | WEB controller + CI and lawful LOCAL Agent CLI real E2E |
| R | `docs/v0.4/release/**`, release-only metadata and exact candidate | **NO** with I until eligible | RQ reviewer distinct from author, CI/Host valid receipts |

Any new overlap discovered during source JIT shall trigger native DAG amendment/Issue write-set conflict resolution, **not** simultaneous source writing. In particular B1/B2 are sequential on publisher contract; I is a separate owner of all shared entrypoints so A1/A2/C1 cannot edit `src/cli.ts` by convenience. No write to `vendor/ads/**` or unqualified v4.18 runtime adoption.

## 4. Decomposition alternatives and non-fabricated efficiency analysis

| Candidate topology | Concern ownership / dependency | Decision |
| --- | --- | --- |
| `T0→A1→A2→B1→B2→C1→C2→E→I→R` global serial chain | No actual A1→A2, A2→B1, C1→C2, C2→E code/source needs. Treats independent capabilities as procedural steps | **REJECT** artificial serial work |
| `(T0∥C2∥E)→(A1∥A2∥B1∥C1), B1→B2→I→R` | Shared contract frozen once, independent capabilities have disjoint owners; B2 genuinely consumes B1 finality; central I owns merge/wiring | **SELECT** after valid native graph and Task Claim |
| `all 10 parallel` | B1/B2 effect-safety contract, T0 typed private schema and I/R prerequisites not yet accepted | **REJECT** fake parallelism / permission bypass |
| One giant Issue/PR | Combines permission/Doctor/numerical/Host/public and Release authority; independent proofs impossible | **REJECT** broad failure/review surface |
| B1/B2 simultaneous stacked PR | B2 must consume *accepted* typed B1 publisher result, cannot safely implement core replay against old ambiguous in-call publisher | **REJECT** unless a separately approved stable contract/Task DAG mutation qualifies true safe decoupling |

The longest **structural** dependency path is T0→B1→B2→I→R (5 Tasks), but no wall-clock/Token-cost/CI time savings can be claimed from graph shape alone. Actual resource scheduling, CI admission and Agent utilization remain unknown. `SF_PLANNING_FEEDBACK=NOT_APPLICABLE`; no qualified source Scaffold binding or MI hash is created.

## 5. Agent/Role/Review/Validation selection (capability, not brand)

| Task group | Minimum Agent capability / autonomy | Acting role / environment | Review policy and actual proof |
| --- | --- | --- | --- |
| T0 / B1 / B2 | High-risk data contract, durable state, auth/retry/security; `F1_BOUNDED_IMPLEMENTATION` | WEB capable implementation; CI source/test; LOCAL if a real isolated publisher/Host effect is proven necessary | Independent source/security Review **required** per exact HEAD; faults use controlled proxy & explicit native grants; never publish to regular project without permission |
| A1 / A2 | Repository CLI/metadata privacy, provider Hook lifecycle; `F1_BOUNDED_IMPLEMENTATION` | WEB source; actual installed Agent CLI on Windows Host required for version E2E, not substitutable by synthetic Hook fixture | A1 security Review required, A2 recommended; physically observed Host/plugin version and correct Hook autoactivation only |
| C1 / E | Reliable numeric/cohort/private and strict public producer; `F1_BOUNDED_IMPLEMENTATION` | WEB/CI source/Golden, no compulsory Local for these standalone concerns | C1 recommended, E public schema/security Review required; Tally external App remains NOT_RUN |
| C2 | Controlled paired process measurement & factual receipts | WEB measurement prep + **LOCAL Windows Node24** physical measurement agent/operator | Real n≥5 ON/OFF pairs, commands/exits/OS/runtime/Spool bytes; no inferred Host PASS |
| I | Shared composition/CLI, whole-version source integration | WEB integration controller with CI & Windows LOCAL real Agent CLI handoff | Independent integration Review required and scoped whole source regression; no v0.3 prior evidence promoted to v0.4 PASS |
| R | Exact-SHA/Tree version release and source qualification | Release controller + distinct independent RQ Reviewer, CI and valid Host evidence | Version-level RQ / Release gates; final main merge only after owner-qualified READY; human intervention only for protected/restricted action |

An Agent's model label, same GitHub transport login or local Device name is not proof of role/Review independence. ADS v4.18 introduces **planning advice**, not another live task controller; every active executor must declare actual role/operator and obtain a legal JIT/Claim from effective ADS Task authority.

## 6. Minimal Local/CI handoffs and evidence levels

- **Not needed for Task DAG authoring/review**: no local Node24 source builds, no real Agent launches, no GitHub mutation beyond Issue/DAG docs. All v0.4 evidence levels remain `SOURCE_ONLY_DAG_NOT_IMPLEMENTATION`.
- **Native edge creation**: separate **minimum local GitHub CLI `gh api`** authenticated action after independent DAG Freeze; must write exactly approved 12 edges and GET/readback all 10 blocked_by lists + reciprocal blocking topology, then publish native proof to #64 with exit codes and exact IDs. If not available, `NATIVE_DAG_NOT_PROVEN`; no Builder Claim even for root nodes.
- **C2**: once legally admitted, run ≥5 paired Windows Node24 synthetic Hook ON/OFF, get real wall/CPU/Spool effects, no model API required. Record `NOT_RUN` until actual Host receipt.
- **I/R**: one actual installed Claude CLI→Hook→Spool→Outbox E2E preferred, ZCode headless actual supported CLI backup (checked via `--help`); Codex Desktop-only prior evidence not equivalent. One safe fault/rejection negative; genuine exact-SHA evidence only.
- **E**: producer Golden public strict report and native scoped readback if truly authorized. Tally v2 live reader and feedback owned elsewhere; `REAL_TALLY_APP=NOT_RUN` is allowed for this version core Release but full ecosystem E2E is not PASS.
- **CI**: run only scoped Task tests before version whole regression, reuse same exact source/unchanged proven evidence when justified; CI unavailable = explicit bounded waiver and unresolved required gate, never PASS.

## 7. Task Pack contract admission and mutation guards

Each `#65–#74` Issue starts `PLANNED / BUILDER_READY=NO / CLAIM=NONE`. Issue body contains: unique Task ID, single concern, frozen Product/L2 and selected ADS main references, allowed/forbidden writes, concrete acceptance/negative oracles, Tests→Contract→Implementation→Failure reference, risk/review/Agent freedom and role/Host handoff, version-only integration target, intended dependencies. These durable fields are **planning** authority until exact DAG/Issue identities frozen, current native blocked_by graph read back, JIT/Task Pack currentness and serialized Claim accepted.

No root Task is "Ready" just because its expected native blocked_by is empty. Controller must positively establish graph exactness for all peers before native materialization PASS, then individually evaluate current native Issue states/claimed writer/branch baseline. At any drift (new Issue scope, overlapping Writer, dependencies changed, freeze blob changed), re-run impact Review and applicable DAG ADD/CHANGE/SUPERSEDE native mutation with *before/after* edge proof. No automatic GitHub login identity grants independent Reviewer eligibility.

### Scoped native GitHub CLI handoff (ONLY AFTER DAG REVIEW + OWNER FREEZE)

Use PowerShell or Linux shell with authenticated `gh` in a repo with permission to update issue dependencies. For each approved edge, invoke official:

~~~bash
gh api --method POST repos/kaicreator-mm/task-meta/issues/<blocked_issue>/dependencies/blocked_by -f issue_id=<blocking_database_id>
~~~

Example (not yet authorized for execution): `gh api --method POST repos/kaicreator-mm/task-meta/issues/66/dependencies/blocked_by -F issue_id=6028433009`.

**Never run these mutations from this candidate document before DAG Freeze.** After actual mutation, query all native lists:

~~~bash
gh api repos/kaicreator-mm/task-meta/issues/73/dependencies/blocked_by --paginate
~~~

Controller should verify **precisely 12 expected edge pairs across all 10 Issues** using real issue database IDs, fail on missing/extraneous edges and incomplete pages; this file is not a substitute for proof. Issue states remain PLANNED until qualified transition.

## 8. Independent DAG Review / Freeze request

Independent Claude Reviewer, **read entire DAG document at exact PR HEAD and immutable Git blob**; verify the real 10 Issue bodies and IDs/permissions, L2 frozen contract+source and now-qualified ADS v4.18 main Product/L2 normative standards.

1. Validate Capability-first minimal coherent concerns and correct split A1/A2, B1/B2; each Task's allowed writer/forbidden scope does not overlap except intentionally ordered B1→B2 and independent shared I.
2. Verify all 10 actual native Issue IDs, intended 12 edges and no cycles; no hidden artificial serial dependencies (C2/E root, A/B/C fanout), no acceptance of Markdown instead of native graph. Cross-check Issue bodies vs table, frozen PRD/L2 MUST/SHOULD and role/validation policies.
3. Check negative oracles: B1 delayed original commit/0 duplicate, B2 corrupt IN_FLIGHT+0 POST, T0 private contract, C1 conditional denominators, C2 real n≥5, Doctor privacy, no new ADS v4.18 public Lane key, I shared CLI owner, R no premature main.
4. Confirm **no accepted Scaffold**, conditional SF↔DF/MI N/A, genuine native Option A blocked_by/Claim/JIT and no "merge-only" unauthorized implementation. If the connected tool cannot write native edges, classify `NATIVE_DAG_NOT_PROVEN`, not full materialization PASS.
5. Return `P0/P1/P2, DAG_REVIEW=PASS|BLOCK, DAG_FREEZE_READY=YES|NO` at **exact source SHA/blob**, with minimal repairs, to DAG PR and Issue #64. **Read-only independent Review, no merge/freezing or source build, no native dependency mutation or unauthorized Claim.**

**R0 truth:** `10_ISSUES_CREATED_PLANNED; INTENDED_EDGES=12; NATIVE_EDGES_WRITTEN=0; NATIVE_DAG_ADMITTED=NO; ISSUE_TASKPACK_REVIEW=NOT_RUN; DAG_REVIEW=NOT_RUN; DAG_FREEZE=NO; BUILDER_CLAIMS=0; V04_RUNTIME/LOCAL/CI/RQ=NOT_RUN; MAIN_MERGE=NO`.
