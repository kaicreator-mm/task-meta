# task-meta v0.3 — Native Implementation Task DAG R0

**Status:** `DAG_CANDIDATE_FOR_ADMISSION` pending exact issue materialization/readback. **Authoritative scope:** owner Product Freeze [#27](https://github.com/kaicreator-mm/task-meta/issues/27#issuecomment-6373958182) and Owner L2 Freeze [#27](https://github.com/kaicreator-mm/task-meta/issues/27#issuecomment-6374231047). Do not infer real Build/Node24/Release PASS from this DAG.

- **Product immutable HEAD:** `2b39d4913c09c7543fb3234d81c2914b83e0a262` (L1 `e9016537c907a813e1e7b22eddcd75e9dbc4e73a`, PRD `7a54488384af5386d5cc7b4e1b50461aa9fe9c71`).
- **L2 immutable HEAD:** `366ef30ee96399f6baeb802208ab00e092b84686`, L2 blob `e68005ee82105730b40ed8a8e21ef3b1f8c85517`, independent L2 PASS #38 / PR #37 review 5634157613, P0/P1/P2=0/0/2; P2 incorporated below.
- **ADS:** v4.17 protocol source HEAD `1355bc0694b3b0225effa82b670725f83a2b873b`, GAIP blob `49ecd802c5bf14237e23d5e321c56c220eb8974e`, effective v5 Schema blob `7478313cc006162432649d734e59c5cd77db5106`. v4.17 complete release NOT ASSUMED.
- **Implement version branch:** `version/v0.3` seeded from L2 exact H above, **never main until independent RQ**. v0.2 baseline `main@36ea9147239fe669d021c7eb273a864322f27356` is source carry-forward but not v0.2 qualified Release.
- **Identity rule:** no task Claim/Review PASS from user intent alone; use exact source/branch/write ownership and truthful real receipts. This DAG is version-local, not a second state database.

## 1. Logical DAG and issue responsibilities

| Task | Original Product requirement | Priority | Depends on | Exclusive initial write scope | Evidence / Definition of Done |
|---|---|---|---|---|---|
| T00 — qualified ADS publisher admission | #36 (FR00) | P0 | Product + L2 Freeze | `src/report/pin.ts`, `config/ads-adoption.json`, `src/autoreport/runner.ts`, `src/cli.ts` or actual collect entrypoint, `src/publish/publish.ts` publish preflight, `test/report-pin.test.ts`, targeted guard tests | old `owner_authorized` all-repo candidate + ordinary `publish=true` => **zero POST** through **all entrypoints**; positive exact qualified main+schema+clearance, isolated E2E test-only. No silent v4 downcast. Existing v0.2 tests may need expected-case updates. |
| T01 — truthful source/Attempt/feedback joins | #28 (FR01) | P0 | Product + L2 Freeze | `src/lineage/dag.ts`, new private factual GitHub join helper `src/evidence-join/*`, targeted private contract tests | distinct real Attempts with identical transitions preserved; source-event ID+revision+digest dedups only identical delivery; conflicting digest rejects; feedback stages factual, never claim Tally material use. |
| T02 — correction and source currentness | #29 (FR02) | P0 | T00 (shared publication preflight) | `src/publish/publish.ts` post-T00 handoff, `src/publish/client.ts`, new private `src/correction/*`, `test/publish.test.ts`, correction tests | immutable exact revision and v4/v5 correction target 8/14 fields; owner REVOKE/REDACT, same-owner DISPUTE nonrevoking; full bounded pagination, no blind POST after lost ACK, edit/conflict held; native type-specific handling. |
| T03 — metric/profile privacy + comparability | #30 (FR03) | P1 | Product + L2 Freeze | `src/aggregates/index.ts`, `src/metrics/*`, targeted tests | token/cache counted once; physical retries; BILLED vs ESTIMATED; model route withheld; UNKNOWN never zero; no v5 new wire; mixed-profile UNSUPPORTED. |
| T04 — owner-qualified C08 strategy trajectory | #33 (FR05) | P0 | T01 (shared lineage file) | `src/labels/index.ts`, `src/trajectory/*`, `src/lineage/dag.ts` after T01 merge, targeted tests | code REVISIT_CANDIDATE not strategic OBSERVED; owner witnessed A→B→A′ Pivot 2/2, Revisit 1/1; eligible nonreturn 0/1, first A→B excluded, D=0 NOT_COMPARABLE; inferred/observed labelers isolated. |
| T05 — shared ADS Golden source conformance | #31 (FR04) | P0 | T00, T01, T02, T03, T04 | `test/v0.3/*`, Golden fixture/test ledger only; never edit frozen ADS schema | positive + negative source-only golden, source/profile hash, readback fake, result classification; independent exact code review. `SOURCE_ONLY` cannot authorize real E2E. |
| T06 — real Node24/Agent/Host/GitHub E2E | #31 (FR04) | P0 | T05 | `docs/v0.3/VALIDATION_LEDGER.md`, run harness/test-fixture-only changes; no unrelated source | actual Node24 lint/typecheck/tests/packaging, producer GitHub comment/readback, real selected Agent and Host evidence; explicit per-platform ZCode/Claude/Codex gaps and waivers; no unavailable Tally-app PASS. |
| T07 — independent Version Closure and Release Qualification | #27 / #31, ADS Release owner | P0 | T06 | `docs/v0.3/RELEASE_QUALIFICATION.md`, version/package/plugin metadata as explicitly scoped closure task (no overlap with T00–T05), release readbacks | distinct independent RQ review after actual E2E; P0/P1 and version metadata, exact SHA, regression, Golden, Host, security, packaging, v0.2 unqualified carry-forward decision and waivers; only qualified candidate may merge main and tag. |

### Dependency edges (explicit)
```text
T00 -> T02
T00 -> T05
T01 -> T04
T01 -> T05
T02 -> T05
T03 -> T05
T04 -> T05
T05 -> T06
T06 -> T07
```
8 nodes, 9 edges, acyclic. Initial independently executable set: **T00, T01, T03**. On T00 acceptance T02 becomes ready; on T01 acceptance T04 becomes ready. Some test fixture authorship for T05 can occur speculatively in isolation but no task PASS until predecessors actually qualified. To prevent source conflict, T02 does not modify `src/publish/publish.ts` until T00's exact artifact is integrated to version branch; T04 does not modify `src/lineage/dag.ts` until T01 integration.

## 2. Task handling and PR controls

- Every executable Task Issue MUST include: Task ID, original requirement, version branch, frozen Product/L2 SHA, exactly authorized write set, dependencies, negatives, independent reviewer handoff, test truth (SOURCE_ONLY / REAL_NODE24 / REAL_GITHUB / REAL_AGENT / REAL_HOST), and Failure Handling.
- Builder branch `task/taskmeta-v03-tXX-<short>` from accepted version HEAD; one concern PR into `version/v0.3` **not main**. Need exact H reviewed and independently qualified before integrating into version branch. If HEAD changes review resets/delta review.
- Separate role declarations matter, not transport GitHub login; a Builder's own tests do not replace distinct reviewer.
- No unnecessary per-PR all-regression run; focus on bounded tests; full code+Host regression only at T06 closure. CI unavailable can be recorded as waiver, but genuinely required real tests remain NOT_RUN.
- Freeze docs L1/PRD/L2 are read-only source pins; any needed schema/contract change requires new governed Product/L2 review, not speculative source edits.

## 3. Source-only versus physical validation boundary

- **No physical Host task needed:** T00/T01/T02/T03/T04 core code can be drafted and reviewed Web-first with source files from GitHub; deterministic tests executed in a real Node24 environment only when available.
- **Physical/local task needed:** T06 requires Node24 actual package installation, ZCode/Claude Code/Codex runtime hooks as supported, actual GitHub publish/readback and external Host verifier. Independent RQ T07 depends on those recorded receipts, not guesswork.
- All stages have distinct `NOT_RUN` default; P0/P1/P2 independent review from exact SHA; release may be BLOCKED/CONDITIONAL when a required real witness is not present.

## 4. Materialization status

Initially this DAG is a fully specified *candidate* on the version branch. The controller must map T00–T07 to 8 native GitHub Issues and read back their exact acceptance/dependencies before publishing `DAG_ADMITTED=YES`. Reconcile this file to concrete Issue numbers and an immutable version-branch head, then record admission in parent #27; no implementation Claim before admission.
