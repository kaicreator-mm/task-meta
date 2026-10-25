# task-meta v0.4.0 — L2 Architecture Evidence R1 — R0 P1×2/P2×2 differential repairs

**Status**: `L2_R1_CANDIDATE / R0_INDEPENDENT_L2_REVIEW=BLOCK(P0=0,P1=2,P2=2) / R1_INDEPENDENT_L2_REVIEW=NOT_RUN / L2_FREEZE=NO / TASK_DAG=NOT_ADMITTED / BUILDER_CLAIM=NO`. This document **does not** authorize source implementation, runtime tests or release; it is an exact-source architecture proposal for independent Claude review.

## 0. Fixed authority and baseline

| Authority | Exact reference / consequence |
| --- | --- |
| Product | [Issue #60 owner Product Freeze](https://github.com/kaicreator-mm/task-meta/issues/60#issuecomment-6399790312); independently reviewed [PR #61 R2 PASS](https://github.com/kaicreator-mm/task-meta/issues/60#issuecomment-6399596564); exact frozen `version/v0.4@3f72f4cc62d65e884c34ea058bbc671e59b218f1`; PRD `docs/v0.4/PRD_R2_CANDIDATE.md` blob `0af2b9cafd63ca1faa8b2fa612f7fdc5e02db067` |
| Implementation baseline | Frozen v0.3.0 `9731b03e263527e15ae24815a7e26b45e4dd809a`; current version fork source from main `adc0a823bc2be636292fef4dd96d24076646ee20`. Source and plugin changes = **zero at L2 R0** |
| ADS v4.18 planning target | Frozen Product [#1320](https://github.com/kaicreator-mm/ai-development-standard/issues/1320#issuecomment-6388802387) blob `98772b4594caa44b2611853ae482132f7aefa36b`; frozen L2 [#1321](https://github.com/kaicreator-mm/ai-development-standard/issues/1321#issuecomment-6395575157) blob `e3b5106c2fdaa8b2a0bbac5adb32b810fcbd51dd`. Source-currentness snapshot `version/v4.18@9f09fa291464b8ca7e445873bb80858764431107` (R-source candidate; refresh before DAG/RQ). **No assumption of effective main adoption** |
| Effective ADS for report writes | Existing `config/ads-adoption.json`: normal v5 profile adopted source `718fb02e33b31f568736447b2b905883cc6fcc3a`, strict schema blob `7478313cc006162432649d734e59c5cd77db5106`. Old candidate `3041a1be3f130e5cc5e676c2e56a99882adfd97c` remains *test-purpose/owner-authorized historical*, not a normal-publication grant. Consult `vendor/ads/PINS.md` and actual owning permission. ADS v4.18 brings **no new public Lane/Topology fields**; private FR07 only |
| Tally ownership | [Tally #62](https://github.com/kaicreator-mm/tally/issues/62) and [ADS #1210](https://github.com/kaicreator-mm/ai-development-standard/issues/1210) own real consuming E2E. task-meta may only publish ADS-allowed strict report, not expose its private store/HTTP/SDK to Tally |
| Nonblocking Product-review P2 | **Every GitHub POST attempt**, including `publishReport` in-call retries, must recheck fresh authorization/currentness; Outbox-level recheck alone is insufficient |

**Role interpretation**: v4.18 is selected to **plan** task-meta v0.4 Capability/Concern/Lane/DAG, *not* a runtime Claim/JIT bypass. Native GitHub blocked_by/Source/Claim and current effective ADS acceptance remain authoritative. No accepted source Scaffold exists for task-meta: `SF_Binding=NOT_APPLICABLE`; don't fabricate SF↔DF/MI links.

## 1. Topology and boundaries

~~~text
Installed ZCode / Claude Code / Codex native Host
  → actual installed Hook (metadata-only; source capability version)
  → existing private Spool (JCS payload + sha256, verified event identity)
  → existing adapters/source binding & EvidenceStore/CAS
  ├── A: readonly Doctor + lifecycle witness classification (consumes T0)
  ├── C1: conditional capture-quality metrics/denominators (consumes T0)
  └── B: existing auto-report → existing governed publisher
         → private append-only Outbox retry evidence & bounded recovery coordinator
         → per-POST effective ADS adoption + clearance + native GitHub permission
         → full native GitHub report identity/digest readback → safe receipt
                          ↓
                       GitHub native Issue/PR/CI/Review + strict ADS public comments
                          ↓
                       Tally independent GitHub-only reader (not implemented here)
 
C2: isolated Windows Node24 paired ON/OFF fixture measurement; not a new Agent plugin.
D: private source-pinned observation of owner-written DAG/Scaffold references only.
E: producer strict ADS Golden / interface readback contract only.
I: single shared CLI/manifest/Skill & whole-version integration owner.
R: independent version-wide closure and Release Qualification after eligible MUSTs.
~~~

**No new** public report dialect, new GitHub API surface, model router, Task scheduler, Tally private ingress, background daemon, global npm CLI package, token collector, or logging of private prompts/tool payloads.

## 2. T0 private contracts and single source of semantics

**L2-01 — Contract-first and minimal adaptation.** `src/model.ts` is the **T0 single-writer** for the additional *private* types below; preserve the existing `Epistemic`, `Coverage`, `SourceCapabilityProfile` and `MetricIdentity` wire. Keep v0.3 records readable; new fields optional or externally derived without silently reinterpreting old records. Do **not** modify strict ADS v4/v5 or vendored files.

~~~ts
type MissingReason =
  | "NOT_INSTRUMENTED"          // Client/installed profile never promised this event
  | "HOST_EVENT_NOT_OBSERVED"   // declared event absent in a proven closed observation window
  | "ADAPTER_FAILURE"          // local capture failure is independently witnessed
  | "UNBOUND"                  // event exists but qualified Task/Attempt key does not
  | "SOURCE_DROPPED"           // discontinuity demonstrated by source counters/digests
  | "CLOCK_UNTRUSTED"
  | "OUT_OF_SCOPE"
  | "UNKNOWN";                 // default when proof absent
type EvidenceLevel = "SOURCE_ONLY" | "HOOK_FIXTURE" | "REAL_AGENT_CLI" |
  "REAL_HOST_GITHUB" | "DESKTOP_ONLY" | "REAL_TALLY_APP";
type CoverageKind = "CONDITIONAL" | "ABSOLUTE";
type PrivateDiagnosticVersion = "task-meta/private-diagnostics/v1";
interface DiagnosticFact {
  schema: PrivateDiagnosticVersion;
  source_ref: string; source_revision: number; agent: "zcode"|"claude"|"codex";
  plugin_version: string|null; host_class: string|null;
  evidence_level: EvidenceLevel;
  epistemic: Epistemic;         // existing type; orthogonal to missing reason
  missing_reason: MissingReason|null;
  clock: { domain: string; precision: string; synchronized: boolean|null };
}
interface CaptureQuality {
  schema: PrivateDiagnosticVersion;
  metric_name: "binding"|"tool_pair"|"lifecycle"|"token_cost_basis"|
    "publication_reconciliation"|"verifier_source";
  numerator: number|null; denominator: number|null;
  denominator_source_refs: string[];
  coverage_kind: CoverageKind;
  eligible_scope_ref: string|null; capability_ref: string|null;
  reason: MissingReason|null;
  epistemic: Epistemic; source_refs: string[];
  comparability: "COMPARABLE" | "NOT_COMPARABLE" | "UNKNOWN";
  limits: string[];
}
~~~ 

**Invariants**:
- An emitted event with wrong source ID is not the same as an **unemitted** event. Absence of SessionEnd is only an observed absence for *tested* close paths; cause remains `UNKNOWN`. ZCode plugin v0.3 declares no SessionEnd → `NOT_INSTRUMENTED` and no implied expected denominator.
- Duplicate *delivery* of the same source-event identity/revision+JCS digest counts once; same identity with different digest is `CONFLICT`, never silently last-write-wins. Separate physical retries stay separate, even under the same logical call.
- Never force a new Diagnosis field into `ObservationRecord` without source proof; preserve comparability with existing v0.3 stores/MetricIdentity. Materialized quality facts may be separate private JSONL with schema/version.
- `UNKNOWN` is not zero, `SELF_REPORTED` is not verified, source-reported session termination is not native Reviewer PASS.

**L2-02 — Outbox-specific type ownership.** B is the **single writer** of `src/autoreport/outbox.ts` and its persisted status projection. T0 owns shared missing/epistemic semantics only; `UNKNOWN` as Outbox state is defined in B's local discriminated union referencing the T0 reason types (or a single T0-approved reusable outcome enum, chosen before DAG). Do **not** give both T0 and B write rights to the same file. Existing dated JSONL entries and JCS/CAS hashes remain byte-stable; replay old `FAILED` without retroactive classification—legacy uncertain `FAILED` is treated conservatively as requiring readback before retry.

## 3. FR01/02 — Doctor and lifecycle design (Lane A)

**L2-03 — Repo-only entrypoint:** add `src/doctor/{index,catalog,probe,render}.ts`; I later registers `node src/cli.ts doctor` only. `package.json` remains `private:true` with no `bin`; plugins are not repackaged for Doctor. Preserve existing `collect*,auto-report` argument/exit behavior. A must not edit shared `src/cli.ts` directly. No `doctor repair` in v0.4.

**Typed catalog as machine source of truth:** one versioned diagnostic RuleID for event-profile mismatch, Hook disabled/untrusted/absent, spool invalid/hash mismatch, plugin-version drift, binding absent, outbox queued/HELD/UNKNOWN, stale lock, unavailable Cli, E2E not qualified. Each entry has {rule_id, evidence_required, severity, safe_reason_code, supported_profiles, remediation_skill_anchor}; `.agents/skills/task-meta-agent-cli-validation/SKILL.md` may link those IDs and retain only procedures, not its own competing version/diagnostic rule mapping. I owns the Skill integration.

**Read-only allowlist:** exact trusted repo root `AGENTS.md`/plugin manifests/`hooks.json`, `--help`/`--version` without writes, limited `Spool`/`Outbox` status/count/JCS integrity and `_errors.log` error **class**, selected source-adoption public metadata; inspect Trust **presence** only where a verified API exposes it. Never read `~/.codex/auth.json`, OAuth stores, local prompt/transcript/raw tool args/responses, private absolute paths, tokens, secret content or hidden validation. No unsolicited external GitHub calls, no writes to Home/project, no automatic marketplace install. CLI output must expose only filtered enums/counts/non-sensitive relative repository refs, with privacy scrub before printing. Process launch must avoid untrusted executable names/arguments/PATH scripts; do not follow symlink out of allowlisted roots into secrets. Failure to inspect = `UNSUPPORTED|UNKNOWN|NOT_RUN`, not "installed healthy".

**Lifecycle:** treat supported event sets independently for each known agent version; `Stop` + quiet window and `SessionEnd` are not synonyms. A consumer produces private lifecycle observations, C1 calculates coverage, neither asserts normal Host exit when termination was not seen. Real Agent CLI proof requires the actual installed executable to auto-trigger Hook, not direct fixture.

**Failure cases:** corrupt manifest, inaccessible Spool, spoofed trust status, source-created symlink to user auth, missing CLI binary, Codex no SessionEnd, ZCode unsupported event, duplicate call ID, mismatch session IDs; all must fail closed without leaking private content.

## 4. FR03/05 — Quality, accounting and performance (C1/C2)

**L2-04 — Six private metrics use existing aggregates as foundation, not a new reducer.**

| Metric | Numerator / denominator (strict, source-qualified) | Truth |
| --- | --- | --- |
| binding | verified de-duplicated events bearing exact Task+Attempt / verified **observed events** in scope | `CONDITIONAL` only unless Host supplies total emitted events |
| tool_pair | observed unique PreToolUse IDs with matching PostToolUse/PostToolUseFailure / observed unique PreToolUse IDs | `CONDITIONAL`; unmatched pre remains in denominator |
| lifecycle | eligible observed SessionStart IDs with verified end-kind / eligible observed starts under *declared* lifecycle capability | `CONDITIONAL`, distinguish Stop from SessionEnd; unsupported end kind N/A |
| token_cost_basis | observed model call IDs with independently qualified usage/cost basis / observed source-qualified model call IDs | `CONDITIONAL`; invoice completeness requires billing universe; no call IDs = null |
| publication_reconciliation | **source-proven terminal classes** (confirmed PUBLISHED/ALREADY_PUBLISHED, DENIED/REFUSED, or CONFLICT, each disaggregated) / uniquely qualified Outbox publish attempts | `CONDITIONAL`; unresolved HELD/UNKNOWN remain in denominator but do not count terminal; report **published success count** separately from resolved terminal count |
| verifier_source | eligible Attempts with actually witnessed verifier source and terminal observation / *owner-authorized eligible Attempt set* | `ABSOLUTE` only when actual complete eligible set is known; else observed-only `CONDITIONAL` / `UNKNOWN` |

**P2-01 direct numeric Oracle:** four distinct qualified publish attempts: A = comment ID/digest PUBLISHED; B = native permission DENIED before transport; C = proven native same-identity/different-digest CONFLICT; D = possible sent/lost ACK with no finality UNKNOWN. Aggregated terminal resolution **3/4 CONDITIONAL** (one published + one denial + one conflict), successful publications **1/4**, uncertain attempts **1/4**. A terminal denial is an audited **decision**, not proof that some *earlier* uncertain POST was never sent; if there was a previous uncertain attempt on this same report identity, the attempt remains UNKNOWN for recovery. A HELD state that is merely a later observation of D must not create a new physical attempt denominator. A resolved count is not a publication-success rate; numerator alone never promotes capture coverage to absolute.

All computations first validate JCS and source revision and remove duplicate transport deliveries (not distinct physical attempts), then evaluate numerators/denominators. Denominator zero/unknown → **`null` and `NOT_COMPARABLE`**, not 0%/100%. No universal "capture 100%" from a conditional ratio. Specific Golden: binding 2/3; pair 1/2 with 2 unique Pre and 1 Post; retries/dedup remain source identities. Minimum comparable cohort: task kind, risk class, agent+plugin revision, provider capability, price revision, Host/OS, observation window, measurement basis; absent compatible keys ⇒ `NOT_COMPARABLE`; BILLED requires actually qualified bill evidence, never infer from pricing table. `src/aggregates/index.ts` and `src/metrics/comparison.ts` are C1 exclusive writer. C3 optional later must not race C1 on same files.

**L2-05 — C2 is a separate early real Host experiment**. Windows Node24, disabled/no-op vs active metadata-only Hook on the **same sanitized fixture** and same Host/Agent/plugin version; 5 paired samples minimum; record wall duration, spawned Node process CPU (where observable), peak RSS if supported, Spool byte deltas/event count, Stop→Outbox latency, exit codes, sample medians/ranges and measurement tool precision. Before/after ordering should alternate to reduce warm-cache bias. The "disabled" baseline may be a measured same-launch no-op Hook to isolate incremental capture cost—record that it measures subprocess overhead, **not** whole Agent performance. No invented speed-up claim or mandatory provider-model workload. C2 owns isolated benchmark scripts/fixtures + private receipts; no writes to T0/C1/shared CLI. Unavailable Windows Host ⇒ `C2_NOT_RUN` and RQ must explicitly HOLD/CONDITIONAL waiver, not PASS. Linux out of v0.4 supported Release.

## 5. FR04 — Safe cross-process Outbox recovery (Lane B)

**L2-06 — Exact reuse and actual delta**:
- `src/publish/publish.ts` already has per-call `maxRetries ?? 3`, bounded backoff/Retry-After, readback before retry and source-adoption admission *once* before the loop; **v0.4 must replace the unsafe re-POST eligibility for an ambiguous previously attempted request in this same in-call loop**, not just add per-POST permission checks; `src/publish/client.ts` has native permission read seam. `src/autoreport/index.ts` `auto-report --retry` is **manual**, looping `RETRYABLE={HELD,FAILED}` without persisted cross-process budget; `runner.ts` maps every `NOT_PUBLISHED` to `FAILED`. Existing T18 lost-ACK/pagination/edited/competing writer real evidence is reused.
- v0.4: introduce one durable **opt-in and bounded** recovery attempt coordinator in existing `src/autoreport/**` (no separate daemon or second publisher), with persisted combined network budgets and correct `UNKNOWN` vs definite `FAILED`, fresh source permission before every *physical POST*, and recovery-cost counters. Reuse existing publisher/readback structure, but change **both** same-call and cross-process retry eligibility: no second physical POST after any request that **may have reached GitHub**, unless an independent positive proof establishes nonapplication.
- Existing manual CLI `--retry` remains explicit; opt-in **bounded** automatic retry can be triggered from an already supported host invocation/CLI process by configured schedule/one-shot tick, no infinite background service. New CLI switch only via I if truly needed; no silent periodic task creation on the user's machine.
- Reuse session lock plus one stable canonical Report identity + source revision + digest for publication/recovery identity. Existing `safeName` truncation needs collision check; lock keys must hash the **entire** canonical ID rather than only sanitizing/truncating. Race across sessions must not cause duplicate native comments. If cross-process lock unavailable → `HELD/UNKNOWN` and explicit recovery evidence, not forced retry.

**L2-06a — Unified transport/finality classifier (R0 P1-01): same guarantee in direct `publishReport` and Outbox.** HTTP status, pagination and source grant are **different evidence dimensions**: a fresh grant does NOT prove a previous POST failed; a complete zero-match native list does NOT prove a timed-out POST cannot later commit. A source-qualified internal `PostEffect` tagged union must survive the existing public-compatible publisher API into B, without parsing free-text `NOT_PUBLISHED`.

| Internal result | Acceptable evidence | **In-call retry** | Cross-process retry |
| --- | --- | --- | --- |
| `PROVEN_NOT_SENT` / `FAILED_PROVEN_PRE_SEND` | deterministic local refusal before invoking transport, or a transport response independently certifying zero submission/effect; **never** infer from 429/503/TLS status alone | Eligible for bounded retry **only if retryable and new pre-POST authorization passes** | Eligible only with intact journal+source permission and unchanged intent |
| `REMOTE_SAME` | fully witnessed native Issue comment identity+data digest | `ALREADY_PUBLISHED`, stop | `ALREADY_PUBLISHED`, stop |
| `REMOTE_DIFFERENT_OR_DAMAGED` | same report identity with mismatched digest/damaged owner marker | `CONFLICT/HELD`, stop | `CONFLICT/HELD`, stop |
| `SENT_OR_MAY_HAVE_SENT` | network disconnect, timeout, lost ACK, uncertain 429/503/403, or incomplete native readback after transport invocation | **`UNKNOWN_AFTER_SEND`; stop current retry loop immediately; zero more POST even if complete readback is empty** | `UNKNOWN`, reconciliation GET only, no POST without *independent* positive no-effect evidence |

Thus existing `maxRetries ?? 3` is a **ceiling**, not unconditional permission for 4 calls. Once a POST might have been sent, no further POST occurs within that `publishReport` call, **including when it is used directly without Outbox**. Returning `NOT_PUBLISHED` as an undifferentiated string is prohibited; use a typed internal status, preserve strict public ADS report format, and project to Outbox `UNKNOWN` rather than `FAILED`. A trusted **pre-send** transport error may reattempt if and only if both effect absence and retryability have positive evidence. Native 429/503 response codes do not *by themselves* prove nonapplication. Tests must delay the original create until **after a fully paginated zero-result readback** and verify exactly **one physical POST total** in direct-call and Outbox paths.

**Proposed private outcome machine**, separate from ADS public report and from transport status:

~~~text
PENDING (verified authorized source, no POST)
 → PRE_POST_ADMISSION (re-read adoption/schema/source native grant/target/current permissions)
    ├─ DENIED / HELD (NO POST)
    ├─ UNKNOWN (cannot establish permission or complete remote readback; NO POST)
    └─ permitted + full native report-identity readback
         ├─ SAME identity+digest → ALREADY_PUBLISHED (no POST)
         ├─ DIFFERENT digest/edited/damaged → CONFLICT/HELD (no POST)
         └─ verified no prior report → durable IN_FLIGHT mark [budget spent] → POST once
              ├─ confirmed success + full ID/URL/digest readback → PUBLISHED
              ├─ independently PROVEN_NOT_SENT → FAILED_PROVEN_PRE_SEND; may retry within budget only after fresh source grant
              └─ SENT_OR_MAY_HAVE_SENT (timeout/lost ACK/5xx/empty native readback) → UNKNOWN_AFTER_SEND; STOP same-call POST loop
UNKNOWN → reconciliation-only native readback, NEVER direct POST
            ├─ same → ALREADY_PUBLISHED
            ├─ independently **proven no remote effect** (e.g. local refusal before transport) + fresh authority → eligible for bounded POST
            └─ only absence from native list / eventual-consistency ambiguity → remain UNKNOWN/HELD (NO POST)
~~~

**L2-07 — Per-POST permission revalidation (independent R2 P2):** put the last-to-write **fresh** check inside `publishReport` loop **before each call to `client.createIssueComment`**, including attempt 0 and each in-call retry. The guard must re-read and verify the actual current effective ADS adoption + schema blob (v5 only qualified exact adopted main; isolated candidate E2E only exact allowlisted purpose), independently governed source-owned projection grant+native authorization comment/body-digest readback, actual owner Issue/target/source/currentness and effective authenticated native GitHub write permission. Permission result tied to the **same immutable intended body/data_digest/identity**; a changed body/revision invalidates prior clearance. No TOCTOU-laundering of cached first-attempt grant into later retry. Do not weaken current `publishReport` defense-in-depth when called directly outside `runner.ts`. **Profile-specific authority:** for v5 use the qualified effective adoption/schema and independent native source-owned projection grant; for legacy v4 preserve its actual existing schema/profile permission semantics, but still require a fresh **native target/write-permission preflight** before every attempted public POST. Do not invent v5-only `publication` fields on v4, silently downcast v5 to v4 or grant a blanket “v4 bypass.”

- If checks fail or cannot fully paginate: **no POST**; return typed private `DENIED/UNKNOWN` not optimistic `NOT_PUBLISHED` with raw network error text. **Temporal boundary:** GitHub does not offer an atomic conditional “authorization check + create comment” transaction. The enforceable guarantee is **zero POST once the loss of authority has been observed by the immediately preceding pre-effect check**; do not promise a cryptographically impossible global zero-POST window for revocation racing between an already successful check and POST. Record authorization check timing/source and re-evaluate the outcome against native currentness; a write that GitHub accepts under a concurrent race remains separately auditable, not retrospective proof of authorization.
- A write may complete just before or race a concurrent revocation; post-write native readback reflects actual outcome and the last witnessed grant evidence, **not** a claim that GitHub atomically coupled permission+write. A subsequent correction/revocation follows ADS governance; do not retrospectively erase a completed report.
- B owns `src/publish/**` and `src/autoreport/**` including new result mapping. Explicit source tests must cover grant revoked **between POST attempt #1 and #2**, permission revoked between auto-report scheduled retries, same grant URL modified content, repo write downgraded, adoption pin switched, incomplete auth-source pagination, E2E allowlist mismatch. Assert **zero additional POST** after revocation and no leak.
- Budget: persist `budget_epoch`, attempt ordinal, original start/deadline, spent POST+GET counts, backoff policy, last remote proof and result on append-only private CAS/JCS record **before** each attempted effect; restart after IN_FLIGHT starts at UNKNOWN reconciliation-only. Bound per-call and cross-process retries by a **single total POST/GET/wall budget**. Count full-page native reads and fresh auth checks against the same budget; B passes remaining budget into the **existing** `publishReport` in-call loop so two retry loops cannot multiply. `Retry-After` beyond remaining budget → HELD (no busy-spin). T0 defines classification truth, B implements state.
- Current `publishReport` maps many transport exceptions to plain `NOT_PUBLISHED`; L2 needs a **typed private result shared by the direct caller and Outbox** (positive nonapplication vs indeterminate). Never use raw `Error.message` in Outbox. **SENT_OR_MAY_HAVE_SENT ends the publisher's in-call retry loop even after an empty readback** and maps to `UNKNOWN`, not `FAILED`. Legacy Outbox FAILED cannot be assumed definitely not applied; readback is mandatory but **alone insufficient** to prove prior transport nonapplication.

**L2-07a — Complete durable journal and fail-closed replay (R0 P1-02).**

The actual `src/store/spool.ts@fb5b7f39852c857098bfbd3e13367267a2eb4e51` `Spool.replay()` returns both `entries` and `skipped` for invalid, truncated or digest-mismatched JSONL, despite `append()` doing `fh.sync()`. Current `src/autoreport/outbox.ts@be15e83c58f96799fffa5e321460ef0012cc7a80` discards `skipped` in `readAll()`. A `latestPerSession()` reconstructed from that incomplete view is **not sufficient for safe POST recovery**.

1. The sole B-owned recovery reader must check `Spool.replay().skipped` and all file read failures **across every relevant segment**, validate version, canonical report identity, immutable digest, durable `budget_epoch`, strictly monotonic event/attempt sequence, predecessor digest/sequence and an authenticated or CAS-validated expected segment inventory. Full JSONL line digests do **not** by themselves prove completeness if a later file or line has disappeared. A validated manifest/index or equivalent append-only segment anchor must prove the expected file chain.
2. Any `skipped > 0`, unreadable expected file, absent segment, unknown critical record type, sequence/epoch gap, conflicting repeated ordinal/digest, stale generation or truncated final `IN_FLIGHT` is `JOURNAL_INCOMPLETE`. For the affected identity: **UNKNOWN/HELD + readback GET only + zero new POST**. If the corrupt record identity cannot be established, freeze new POST for the **whole possibly affected shard**; never skip a bad line and accept earlier visible `PENDING/FAILED`.
3. A newly empty Outbox directory cannot imply this identity has never been posted: creating a legitimate initial `PENDING` requires separate qualified no-prior-effect initialization. Stale locks, clock reset, directory replacement and manual `--retry` must not mint a new epoch or extra POST budget. Complete readback with zero matches after a MAY_HAVE_SENT call is also not finality.
4. Do not rewrite historical JSONL to hide corruption; Doctor may report only scrubbed `JOURNAL_INCOMPLETE`, invalid-line count and not raw line contents or absolute private paths. Only source-qualified independent finality proof or complete trusted journal restore may re-enable a new POST.
5. **A09 positive corruption test:** valid PENDING, actual `IN_FLIGHT` request, then deliberately truncate/digest-corrupt only its persisted line; the earlier valid PENDING remains and a GitHub readback first appears empty while the original request later commits. Expect `Spool.replay.skipped>0`, result `UNKNOWN/HELD`, **0 follow-on POST**, and no stale FAILED retry. Additional tests: missing segment/inventory, unreadable file, epoch gap, conflicting duplicate ordinal, stale lock, restart and eventual late remote commit.

**L2-08 — Recovery testing and privacy.** A fully paginated native GET returning “not found” **alone is insufficient finality evidence** after a POST timeout/lost ACK, because an in-flight GitHub create may become visible later. A retry transition from `UNKNOWN` **inside the same publisher call as well as across process boundaries** requires independent positive proof that the transport never sent/applied the prior effect or a future native idempotency/finality contract; otherwise remain `UNKNOWN/HELD` with human-controlled reconciliation and **no repeat POST**. Distinguish `FAILED_PROVEN_PRE_SEND` from `UNKNOWN_AFTER_SEND` with a typed local transport/outcome classification. Tests must simulate **delayed original commit after an apparently empty readback** in **direct `publishReport(maxRetries:3)` and Outbox restart** and assert exactly one initial POST, no duplicate POST. A completed native list is mandatory for identity reconciliation but not itself an atomic GitHub commit barrier.
 Extend existing `scripts/e2e-fault-injection.ts` source-only oracle and isolated test-repo owner grant. Local HTTP failure simulator/proxy injects 429, 503, TLS timeout and partial pagination; real GitHub test-only native readback only for the minimum changed path and actual permitted isolated sink. No abuse of production rate limits. Count real HTTP post attempts and always prove zero unauthorized retries. In fault cases preserve Error class only, no raw auth header/token/API output/private absolute paths.

## 6. FR07 / FR08 — bounded ADS/Tally integration

**L2-09 — FR07 strictly private**. Use actual GitHub native issue/PR IDs, complete `blocked_by` readback, frozen owner Task Pack exact blob if explicitly materialized, real Dispatch/Claim actor role and CI/Review/Host IDs. `Concern/Lane` only if source owner **explicitly** materialized a stable identifier; internal Step defaults N/A; don't parse Markdown intent or guess from tool labels. Record actual planning edges and observed execution intervals/clock basis separately, never issue a DAG quality verdict or independent Reviewer PASS. `SF_Binding=NOT_APPLICABLE` until own legitimate Scaffold adoption. Neither ADS v4.18 planning adoption nor RQ creates any new strict public schema key. D source-only private fixture is optional/non-gating for v0.4.

**L2-10 — E producer contract MUST, true Tally app separate**. Golden of *current effective adopted* strict v5 report, exact version/source/schema and safe public projection + GitHub native comment ID/digest/source clearance + negative unchanged/partial pagination/permission cases. Existing report builder/publisher is the **only** producer. Do not add a Tally SDK/DB/private Trace URL. `REAL_TALLY_APP=NOT_RUN` is valid externally if Tally #62 has not delivered; it does not equal full E2E PASS. E owns independent contract doc/fixtures and does not write `src/report/*` or `vendor/ads/**` unless a **separate scoped and reviewed standard adoption concern** is approved.

## 7. Capability-first Task decomposition, write sets and agent environments (ADS v4.18)

| Candidate node / concern | FR | Source writer (one owner/file) | Read-only preparation / Host | Native dependency intent |
| --- | --- | --- | --- | --- |
| **T0** Private contracts | FR02/03/04 | `src/model.ts` + isolated contract fixtures; B exclusively owns its own `outbox.ts` | WEB Source + independent contract Reviewer | Root; A/C1 blocked until valid T0; B can PREP |
| **C2** paired measurement | FR05a MUST | `scripts/bench-*.ts` and own evidence only | LOCAL Windows Node24 (real n≥5 fixture), WEB may design setup | Root ∥ T0; physical measurement may happen before code changes as baseline |
| **A** Doctor+Hook | FR01/02 | `src/doctor/**`, bounded assigned adapter modules; **never** `src/cli.ts` | WEB code/source, CI scoped tests, LOCAL one REAL_AGENT_CLI; Reviewer | T0→A |
| **B** Recovery + publisher | FR04 | `src/autoreport/**`, `src/publish/**`, `scripts/e2e-fault-injection.ts` (only B) | WEB+CI, LOCAL controlled fault simulation and scoped isolated GH receipt | T0 contract for UNKNOWN status; B PREP possible root |
| **C1** Capture Quality | FR03 | `src/aggregates/**` + `src/metrics/**` (only C1) | WEB/CI and private Golden | T0→C1 |
| **E** GitHub-only producer interface | FR08 producer MUST | own `docs/v0.4/integration/**`, `test/v0.4/producer-*.test.ts` only | WEB/CI, no live Tally requirement | Root, contracts/current pin stable |
| **C3 (SHOULD)** Cost improvements | FR06 | new separate helpers only, not C1's `comparison.ts`; if same file, sequence after C1 | WEB/CI, conditional Provider | Optional, C1 contract stable |
| **D (SHOULD)** Private v4.18 facts | FR07 | private source-only test/docs only | WEB/CI if implemented; no new public schema | Optional, never R blocking |
| **I** Central integration | Core wired CLI/Skill/regression | **sole writer** `src/cli.ts`, `package.json`, `AGENTS.md`, `.agents/skills/**` pointers, whole integration tests | WEB/CI, independent Reviewer | MUST T0,A,B,C1,C2,E integrated; D/C3 only if explicitly accepted |
| **R** Version closeout | RQ | version metadata, Release ledger, qualification evidence | WEB + applicable CI/Windows LOCAL receipts; distinct independent RQ | I PASS + scoped Host/CI gates |

**Advisory topology**: (T0 ∥ C2 ∥ E) → (A ∥ B ∥ C1); after eligibility I → R. **Not** a single A→B→C chain, and not “all write shared CLI in parallel.” Product-Lane-local Contract/Core/Tests may be internal steps rather than separate global GitHub Issues. At DAG creation list real Task Claim, exact single-write scopes, exclusive shared-writer I, and native dependency *reasons*. No artificial “merge-only” edge. Stage approval does not confer blocked Task Builder rights. Only GitHub native dependency mutation/readback, effective ADS Claim/JIT and individual Task Pack authorize code. No source Scaffold accepted = N/A.

**Assigned agents/roles (not permission identity)**: WEB Agent handles bounded source/test/docs/review dispatch, LOCAL Windows Node24 handles physical Hook/real model Agent/controlled proxy when genuinely necessary, CI provides source regressions when available, Independent Reviewer performs exact-SHA semantic/security audit, release reviewer separately judges version. Assign by capability, not brand or GitHub login. Do not convert all tasks to Local due to mere convenience; minimal handoff and evidence receipts are sufficient for C2/A/B real-host lanes.

## 8. Acceptance and failure matrix (L2 evidence-to-Product crosswalk)

| L2 contract group | Product Oracle | L2 acceptance method / failure |
| --- | --- | --- |
| Doctor/version/Skill | A01/A02/A03/A04/A07/A18/A23 | source tests of read allowlist, no side effects, version/agent capabilities, missing CLI, symlink traversal, leaking synthetic secret; no desktop result promoted to CLI |
| T0 + lifecycle | A03/A04/A05/A06 | ZCode absent declared SessionEnd N/A, Codex historical missing unknown cause, duplicate same digest vs conflict, distinct retry preserved |
| C1 six quality metrics | A05/A06/A12/A13/A20/A22 | positive 2/3 and 1/2 fixture, null denominator & conditional basis, cohort/source consistency, no double counted model/cache |
| B recovery + security | A08/A09/A10/A18/A21 | T18 source regression, crash-before/after write, persisted budgets, partial pagination UNKNOWN, grant/permission changed and **observed by pre-POST check** before attempt #2 => **0 further POST**; concurrent check/write race is recorded, not assumed atomic, no unauthorized normal repo publishing |
| C2 real measured overhead | A11/A19 | **n≥5** paired Windows Node24 real fixture measurements, reproducible stdout/exit evidence; simulated fixture is not REAL_AGENT_CLI |
| D private ADS v4.18 facts | A14/A15/A24–A28 | source-only native IDs, SF=N/A, no public key, no topology judgment, no independent Review fabrication; optional nonblocking |
| E Tally producer seam | A16/A17/A18 | source-qualified strict public report Golden, native readback/permission negatives, no private Tally ingress; REAL_TALLY_APP only if actual available |
| Version release | Product `7/9 | one real Windows Node24 Agent CLI→Hook→Spool→Outbox (Claude primary/ZCode actual help-supported fallback), one controlled rejection/recovery negative; three source-plugin contracts, full scoped regression+Golden, independent RQ; CI UNAVAILABLE waiver only owner-approved with exact scope |

**Failure handling**: Durable append-only statuses must not imply lost event is recovered; `HELD`/`UNKNOWN`/`CONFLICT`/`NOT_RUN` are never silently cast to PASS/0. On disk-full/Spool I/O error, Agent Hook remains nonblocking, privately classify/error-count within available resources; do not create alternate unsafe logs. On version/Host mismatch, only supported local lane can be requalified; don't re-run unrelated Golden/real GitHub tests if exact source and authority unchanged.

## 9. Architecture decisions and review risks

| ID | R0 decision / independent reviewer challenge |
| --- | --- |
| D01 | Keep repo-only Doctor; no plugin packaging/global CLI. Is \`node src/cli.ts doctor\` a valid current Node24 invocation with existing CLI dispatch? The command is a **future implementation target**, not currently runnable |
| D02 | One T0 `src/model.ts` writer and one B `outbox.ts` writer; no duplicate missing reason enums, private JCS version stays explicit |
| D03 | C1 only computes **conditional** coverage when denominator is observed-only; verifier absolute requires source-owned full eligible list |
| D04 | Existing v0.3 publisher already retries per-call; new coordinator only handles durable cross-process recovery + UNKNOWN; **per-POST** permission/source/currentness even inside legacy in-call retries |
| D05 | Recovery after crash at durable IN_FLIGHT is **UNKNOWN until native readback**, including restart after zero executed network sends; safety takes priority over liveness |
| D06 | Is native clearance revalidation in `checkPublicationGrant` plus `verifyIssuePublicationPermission` enough for every physical POST? Must re-read effective ADS adoption/schema, no user-grant caching across retry, explicit source-owned eligibility |
| D07 | Performance C2 start early, n≥5 paired Host measurements; Linux not claimed; public GitHub 429/403 abuse prohibited |
| D08 | FR07 local/private only even after ADS v4.18 RQ/main; any future public facts require separate ADS schema change/clearance. Reviewer independence evidence is observation, not PASS |
| D09 | GitHub native source is sole public bridge to Tally; no Tally SDK/DB/manifest reading or scheduler coupling |
| D10 | Writer scopes enforce actual A∥B∥C1 and central I; native Option A and current Claim gates must precede code implementation |

## 10. Independent Architecture Review dispatch

Independent Claude reviewer **reads this entire L2 at exact SHA+Git blob** and the exact frozen Product/ADS sources before returning **`P0/P1/P2; L2_REVIEW=PASS|BLOCK; L2_FREEZE_READY=YES|NO`**, with minimum fixes. Independently verify:
1. Product R2 `FR01–FR09` and A01–A28 coverage, MUST/SHOULD boundaries/Agent/Host matrix, hard v4.18 planning vs public schema restrictions.
2. Actual source seams for `publishReport` retry, `auto-report --retry`, fail-closed grant and native permission, outbox states and JCS/CAS; classify network ambiguity without unsafe replay.
3. Per-physical-POST grant recheck race/failure cases; combined network budgets and crash recovery must not introduce a second publisher, privileged background process or unauthorized POST.
4. T0/Doctor/metrics single writer, source URL/Issue Task DAG/Claim/Scaffold N/A and parallelism without overlapping files. Check architecture testability/overengineering and request smaller independent concerns only if necessary.
5. Privacy allowlist, source-only versus real Client/Local/CI/Tally evidence honesty, exact source/ADS frozen blobs and 1.0-pre internal compatibility.
6. Reviewer writes results to **this L2 PR and Issue #62**, read-only/no merge, no architecture Freeze, no Task DAG, no Builder/Host execution.

**L2 R0 state**: `SOURCE_DOCUMENT_ONLY`; `INDEPENDENT_REVIEW=NOT_RUN`; `L2_FREEZE=NO`; `NATIVE_TASK_DAG=NOT_ADMITTED`; `IMPLEMENTATION=NOT_STARTED`; `WINDOWS_NODE24_C2=NOT_RUN`; `REAL_AGENT_CLI_V04=NOT_RUN`; `REAL_TALLY_APP=NOT_RUN`; `RELEASE_QUALIFICATION=NOT_RUN`.
