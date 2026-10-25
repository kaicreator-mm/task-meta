# task-meta v0.4.0 — Capability-first Task DAG R1

**State:** `DAG_R1_CANDIDATE / R0_REVIEW=BLOCK(P0_0_P1_3_P2_7) / INDEPENDENT_R1_REVIEW=NOT_RUN / DAG_FREEZE=NO / 10_PLANNED_TASK_ISSUES / NATIVE_BLOCKED_BY_0_OF_12 / BUILDER_CLAIM=NONE`. Native GitHub Issue Dependencies are the **only** effective materialized live execution DAG after admission; no prose below makes a Task writable.

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
| Versioned private measurement/lifecycle semantics, FR02–04 | **T0 owns a single shared `PostEffect` plus terminal/status vocabulary**, `MissingReason`, `EvidenceLevel`, `CaptureQuality`; B2 only persists projection | **T0 [#65](https://github.com/kaicreator-mm/task-meta/issues/65)** | `src/model.ts` + `test/{binding,canonical}.test.ts`; A1/B1/C1 consume T0 shapes/fixtures, not unmerged sibling modules |
| Repository health visibility, FR01 | Catalog/Doctor exists independently of lifecycle observer | **A1 [#66](https://github.com/kaicreator-mm/task-meta/issues/66)** | `src/doctor/**`; read allowlist, privacy, no global CLI/auto-repair |
| Agent event lifecycle, FR02 | Source-qualified Hook/SessionEnd observation, no false client support | **A2 [#67](https://github.com/kaicreator-mm/task-meta/issues/67)** | `src/lifecycle/**`, exact `src/adapters/{claude,codex,zcode}/{capability,hooks,index}.ts`, existing adapter/hook test files; no shared CLI |
| In-call governed effect finality, FR04 | One backward-compatible publisher owns safe in-call retry and frozen **typed B1→B2 hook seam** | **B1 [#68](https://github.com/kaicreator-mm/task-meta/issues/68)** | `src/publish/**` + existing `test/publish*.test.ts`/`test/publication-*.test.ts`; pre-POST durable reserve + per-GET-page charge hook + typed PostEffect; runner unchanged must typecheck |
| Durable recovery, FR04 | B2 consumes accepted B1 hooks, solely owns durable Outbox status projection and retry budget/journal | **B2 [#69](https://github.com/kaicreator-mm/task-meta/issues/69)** | `src/autoreport/**`, `config/auto-report.json`, existing auto-report/spool/store tests, fault harness; IN_FLIGHT gap fail closed, full-ID lock hash, recovery-cost counters, A21 |
| Measurable capture quality, FR03/06-minimal | Six private metrics consume only frozen T0 types/fixtures, **not unmerged A2**; optional cost extensions excluded | **C1 [#70](https://github.com/kaicreator-mm/task-meta/issues/70)** | `src/aggregates/**`, `src/metrics/**`, `test/{aggregates,metric-comparison}.test.ts`; Binding 2/3, pair 1/2, publication 3/4 terminal vs 1/4 success; A12 span union |
| Real overhead baseline, FR05a MUST | One independent **pre-change** real Host measurement; R separately remeasures exact release candidate | **C2 [#71](https://github.com/kaicreator-mm/task-meta/issues/71)** | Windows Node24 real ≥5 paired Hook runs, raw measured receipt, baseline input to I only (frozen L2 C2→I) |
| GitHub-only producer boundary, FR08 | Strict schema/clearance **offline source Golden**, not B1 publisher HTTP/NOT_PUBLISHED behavior | **E [#72](https://github.com/kaicreator-mm/task-meta/issues/72)** | Isolated `docs/v0.4/integration/**` + `test/v0.4/producer-*.test.ts`; real Tally App external NOT_RUN |
| Shared wiring + source integration, Product MUST | One `src/cli.ts`/manifest/Skill owner; I real CLI E2E is integration evidence only | **I [#73](https://github.com/kaicreator-mm/task-meta/issues/73)** | Shared CLI/package/Skill, `test/cli.test.ts` + actual CLI regression; C2 baseline is not candidate performance PASS |
| Version qualification, Product RQ | Actual exact-candidate Host measurement + independently **required** RQ review | **R [#74](https://github.com/kaicreator-mm/task-meta/issues/74)** | Candidate exact SHA/Tree, qualified Node24 real E2E, independent RQ, main only after READY |

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
| T0 (root) | `src/model.ts`, `test/binding.test.ts`, `test/canonical.test.ts` + own private contract tests | YES with C2/E | WEB one source writer; shared PostEffect/status enum and versioned source-only fixtures |
| C2 (root) | `scripts/bench-task-meta-*.ts`, dedicated benchmark tests/evidence | YES with T0/E | LOCAL Windows Node24 pre-change baseline (≥5 real pairs), R new candidate remeasurement distinct |
| E (root) | `docs/v0.4/integration/**` + source-only producer Golden tests | YES with T0/C2/B1 | WEB/CI only strict report fixture, no B1 transport/outcome test |
| A1 | `src/doctor/**` + dedicated doctor tests | YES with A2/B1/C1 after T0 | Source-only T0 status fixtures; no B2 code dependency; CLI registration reserved to I |
| A2 | `src/lifecycle/**` + explicit `src/adapters/{claude,codex,zcode}/{capability,hooks,index}.ts`, existing adapter/hook tests | YES with A1/B1/C1 after T0 | WEB source; agent Host real E2E belongs I/R |
| B1 | `src/publish/**` + existing publish/publication test suite | YES with A1/A2/C1 after T0 | WEB security; safe typed effect+pre-POST durable reserve+per-GET-page charge, no runner source edits |
| C1 | `src/aggregates/**`, `src/metrics/**`, existing aggregates/metric-comparison tests | YES with A1/A2/B1 after T0 | T0-only diagnostic fixtures, no A2 code dependency, span union and conditional denominator |
| B2 | `src/autoreport/**`, `config/auto-report.json`, existing `test/auto-report*.test.ts`, `test/{store,spool}.test.ts`, owned fault harness | YES with A1/A2/C1 after accepted B1 | Sole Outbox persisted status/lock/budget writer, no second publisher |
| I | `src/cli.ts`, `package.json`, `AGENTS.md`, canonical Skill, existing `test/cli.test.ts`/CLI dispatch tests and dedicated integration | NO concurrent shared writer | I uses C2 pre-change baseline as evidence only; R qualifies actual candidate |
| R | `docs/v0.4/release/**`, approved release-only metadata | NO with I until qualified | Independent RQ Reviewer REQUIRED; fresh candidate Windows Node24 benchmark and real installed Agent CLI |

Any new overlap discovered during source JIT shall trigger native DAG amendment/Issue write-set conflict resolution, **not** simultaneous source writing. In particular B1/B2 are sequential on publisher contract; I is a separate owner of all shared entrypoints so A1/A2/C1 cannot edit `src/cli.ts` by convenience. No write to `vendor/ads/**` or unqualified v4.18 runtime adoption.

### 3.1 Existing-test exclusive owner map — R0 P1-02 repair

Every legacy test affected by the frozen v0.4 behavioral change now belongs to an exact **single** Task Pack Issue body; test execution does not grant universal edit rights:

| Task | Existing regression tests allowed to modify ONLY when source-affected |
| --- | --- |
| T0 #65 | `test/binding.test.ts`; `test/canonical.test.ts` |
| A1 #66 | none; new doctor fixtures, shared `test/cli.test.ts` **I only** |
| A2 #67 | `test/claude-adapter.test.ts`, `test/codex-adapter.test.ts`, `test/zcode-adapter.test.ts`, `test/zcode-hooks.test.ts`, `test/zcode-hooks-v2.test.ts` |
| B1 #68 | `test/publish.test.ts`, `test/publish-faults.test.ts`, `test/publication-authority.test.ts`, `test/publication-native-permission.test.ts` |
| B2 #69 | `test/auto-report.test.ts`, `test/auto-report-claude.test.ts`, `test/auto-report-codex.test.ts`, `test/auto-report-flood.test.ts`, `test/auto-report-watch.test.ts`, `test/store.test.ts`, `test/spool.test.ts` |
| C1 #70 | `test/aggregates.test.ts`, `test/metric-comparison.test.ts` |
| C2 #71 | none; dedicated benchmark tests/evidence |
| E #72 | none; dedicated strict producer Golden only |
| I #73 | `test/cli.test.ts`, `test/claude-cli.test.ts`, `test/codex-cli.test.ts` |
| R #74 | none; qualification reads/tests source, no unauthorized runtime changes |

These sets are pairwise disjoint. Other existing tests remain **read/execute-only**; new discovered file modifications need a narrow current Task Pack amendment with one owner and appropriate independent review before changing content. Plugin runtime scripts remain out of v0.4 write sets.

### 3.2 T0 private outcome vocabulary and frozen B1→B2 seam — R0 P1-01/P1-03 repair

**T0 #65** owns the ONLY versioned private `PostEffect` (`PROVEN_NOT_SENT | REMOTE_SAME | REMOTE_DIFFERENT_OR_DAMAGED | SENT_OR_MAY_HAVE_SENT`), diagnostic MissingReason/EvidenceLevel and terminal/status vocabulary (`PENDING, IN_FLIGHT, PUBLISHED, ALREADY_PUBLISHED, DENIED, CONFLICT, HELD, UNKNOWN, JOURNAL_INCOMPLETE, FAILED_PROVEN_PRE_SEND`) in `src/model.ts`. A1/C1/B1 read this contract and synthetic T0 fixtures only; they cannot import mutable/unmerged B2 state. **B2 alone** maps this vocabulary to persisted Outbox records and owns `src/autoreport/outbox.ts`.

**B1 #68** must preserve existing `PublishOutcome` discriminant union and unchanged `runner.ts` compile; it adds private *additive* effect certainty metadata/wrapper rather than a new naked union arm which forces B2-owned source edits. Its safe publisher seam shall expose typed `PublisherEffectHooks` (or demonstrably equivalent): `beforePhysicalPost` must durably append `IN_FLIGHT`, reserve + debit shared report identity/digest attempt budget **before each physical createIssueComment**; `beforeNativeGetPage` charges **each page** of pre-admission, clearance, report identity reconciliation and post-write native GET **before network access**. B1 takes this explicit hook/context and returns source-qualified typed `PostEffect`; B2 supplies the durable Outbox implementation after B1 acceptance. **No production no-op hook:** direct publisher without a trustworthy journal/budget backend must fail closed (HELD/UNKNOWN, zero outbound POST), not circumvent the reservation requirement. The B1 tests must prove the existing runner compiles unchanged and a missing trusted reservation backend prevents any POST.

No change to ADS public report schema/privilege; in-call `SENT_OR_MAY_HAVE_SENT` stops POST retry immediately even after empty fully paginated readback. B1→B2 is a real dependency and one of the existing 12 native planned edges; adding B2→A1/C1 would be unnecessary fake serialization. B2's expected independent test oracles include corrupt `IN_FLIGHT`, segment inventory/gaps, full-ID lock hashes, `config/auto-report.json` bounded opt-in, GET/POST/time/cycle counters and A21 backlog/disk-full/stale-lock classification. If a fix would actually require `src/store/spool.ts` implementation edits, **HOLD + authorize a narrowly reviewed DAG/Task Pack amendment**; do not silently cross the B2 allowed write set.

### 3.3 C2 Host evidence and Review policy (R0 P2-02/03/06)

The **C2→I** edge is preserved as frozen L2 §7's evidence-convergence prerequisite. C2 is **a root task** and should run in parallel with T0/E once admitted, avoiding delayed measurement. I only consumes C2's witnessed **pre-change ON/OFF baseline** as a source fact, never signs post-change performance qualification. **R separately reruns >=5 paired measurements on the frozen exact candidate**, and independently validates actual installed Agent CLI Hook E2E (I's earlier CLI run, if any, is integration evidence and not automatic R release PASS). Moving C2→R requires an actual L2 amendment; cannot silently drop the frozen mandatory edge to improve apparent concurrency. R #74 review policy is now **required**, not the accidental previous "recommended" default.

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
gh api --method POST repos/kaicreator-mm/task-meta/issues/<blocked_issue>/dependencies/blocked_by -F issue_id=<blocking_database_id>
~~~

Example (not yet authorized for execution): `gh api --method POST repos/kaicreator-mm/task-meta/issues/66/dependencies/blocked_by -F issue_id=6028433009`.

**Never run these mutations from this candidate document before DAG Freeze.** After actual mutation, query all native lists:

~~~bash
gh api repos/kaicreator-mm/task-meta/issues/73/dependencies/blocked_by --paginate
~~~

Controller should verify **precisely 12 expected edge pairs across all 10 Issues**, including both `blocked_by` and reciprocal `blocking` lists, using real issue database IDs, fail on missing/extraneous edges and incomplete pages; this file is not a substitute for proof. Issue states remain PLANNED until qualified transition.

## 8. A01–A28 Product acceptance to Task / Release crosswalk (R0 P2-04)

| Product oracle IDs | Source owner / verification | Release gate disposition |
| --- | --- | --- |
| A01,A07,A18,A23 | A1 Doctor privacy/diagnosis, A2 Hook errors, B2 resource refusal, I final CLI glue | Core MUST; no credential leak, duplicate rule source, fake Host |
| A02,A03,A04,A19 | A2 installed-Agent profile event truth, I integrated CLI, R current candidate CLI | Core MUST for supported claimed Windows Agent CLI; old Codex desktop evidence not equivalent |
| A05,A06,A22 | T0 single event/terminal source and C1 six denominator-safe measurements | Core MUST Binding 2/3, Tool pair 1/2, terminal 3/4 vs publish 1/4 |
| A08,A09,A10,A21 | B1 direct publisher permission/finality, B2 Outbox corruption/budget/overflow, E strict offline source projection | Core MUST, POST after MAY_HAVE_SENT=zero |
| A11 | C2 real n≥5 baseline, R fresh candidate n≥5 + I read-only baseline provenance | Core physical Windows Node24 MUST; no invented real Host |
| A12,A13,A20 | C1 nested spans union, cache/model/cost provenance and comparability | Core numerical/source truth; no model ranking |
| A15,A16,A17 | E producer-only strict schema/Tally handoff + R downstream NOT_RUN boundary | Core **producer** Golden; REAL_TALLY_APP may stay NOT_RUN |
| A28 | E/B1 qualified effective adopted pin/native source, I/R release currentness | Core no new v4.18 public fields or unauthorized report |
| A14,A24,A25,A26,A27 | Optional private FR07 D owner **not materialized** under Product SHOULD/DEFER | NOT_IN_CORE_GATE; future DAG ADD mutation if selected, no CLAIM/PASS now |

This table does not authorize changing sibling Issue write sets. Any incomplete source-owned negative proof remains `NOT_RUN`, never inherited from this planning crosswalk.

## 9. R0 review P1/P2 repair disposition and R1 independent re-review

Independent Claude [DAG R0 review](https://github.com/kaicreator-mm/task-meta/pull/75#issuecomment-6402384336) at `46db01ead6d1a5423d852b410d3bff787b2ed0e0` / blob `fb5df38cb82f05de50adc953f547fd64e36a15a4` found `P0=0,P1=3,P2=7,DAG_REVIEW=BLOCK`. **All ten native Issue Task Packs #65–#74 were updated**, still `PLANNED`; the change to this GitHub PR is one DAG Markdown file. No Task has Builder admission and no native edge was written.

| Original finding | R1 author response |
| --- | --- |
| P1-1 | §3.2 + Issue #65 T0 owns single PostEffect/status vocabulary; B2 persistence only; A1/C1 T0 fixture consumer |
| P1-2 | §3.1 + all task body write sets allocate every source-affected legacy test to exact one writer |
| P1-3 | §3.2 + Issue #68 B1 additive publisher effect, durable pre-POST reservation, per-GET-page budget, unchanged runner typecheck; B2 callback consumer |
| P2-1 | #67 exact adapter module filenames/legacy test ownership |
| P2-2 | #74 independent RQ review `required` |
| P2-3 | §3.3 C2 baseline at root, C2→I as frozen evidence gate, R new candidate measurement; no premature L2 mutation |
| P2-4 | #69 full-ID hashed lock keys, recovery cost, config, backlog; #70 A12 span union; #66/#67 A07 Hook error; §8 acceptance crosswalk |
| P2-5 | #72 E strictly offline producer Golden, B1 owns publisher transport negatives |
| P2-6 | #70 C1 uses T0 DiagnosticFact fixtures only, not unmerged A2 code |
| P2-7 | Native `-F issue_id=<integer>`, full `blocked_by` AND reciprocal `blocking` readback |

**R1_AUTHOR_FIXES=TEXT_ONLY / INDEPENDENT_R1_DAG_REVIEW=NOT_RUN / DAG_FREEZE=NO / NATIVE_DAG=0/12 / BUILDER_CLAIM=NONE / HOST/CI/RQ_V04=NOT_RUN / MAIN_MERGE=NO.** Independent Claude must read this **new exact HEAD/blob** and live updated Issue #65–#74 bodies to determine whether all 3 P1/7 P2 genuinely close; no author-side fixes are treated as approval.

## 10. Independent DAG R1 Review / Freeze request

Independent Claude Reviewer, **read entire DAG document at exact PR HEAD and immutable Git blob**; verify the real 10 Issue bodies and IDs/permissions, L2 frozen contract+source and now-qualified ADS v4.18 main Product/L2 normative standards.

1. Validate Capability-first minimal coherent concerns and correct split A1/A2, B1/B2; each Task's allowed writer/forbidden scope does not overlap except intentionally ordered B1→B2 and independent shared I.
2. Verify all 10 actual native Issue IDs, intended 12 edges and no cycles; no hidden artificial serial dependencies (C2/E root, A/B/C fanout), no acceptance of Markdown instead of native graph. Cross-check Issue bodies vs table, frozen PRD/L2 MUST/SHOULD and role/validation policies.
3. Check negative oracles: B1 delayed original commit/0 duplicate, B2 corrupt IN_FLIGHT+0 POST, T0 private contract, C1 conditional denominators, C2 real n≥5, Doctor privacy, no new ADS v4.18 public Lane key, I shared CLI owner, R no premature main.
4. Confirm **no accepted Scaffold**, conditional SF↔DF/MI N/A, genuine native Option A blocked_by/Claim/JIT and no "merge-only" unauthorized implementation. If the connected tool cannot write native edges, classify `NATIVE_DAG_NOT_PROVEN`, not full materialization PASS.
5. Return `P0/P1/P2, DAG_REVIEW=PASS|BLOCK, DAG_FREEZE_READY=YES|NO` at **exact source SHA/blob**, with minimal repairs, to DAG PR and Issue #64. **Read-only independent Review, no merge/freezing or source build, no native dependency mutation or unauthorized Claim.**

**R1 candidate truth:** `10_ISSUES_CREATED_PLANNED; INTENDED_EDGES=12; NATIVE_EDGES_WRITTEN=0; NATIVE_DAG_ADMITTED=NO; ISSUE_TASKPACK_REVIEW=NOT_RUN; DAG_REVIEW=NOT_RUN; DAG_FREEZE=NO; BUILDER_CLAIMS=0; V04_RUNTIME/LOCAL/CI/RQ=NOT_RUN; MAIN_MERGE=NO`.
