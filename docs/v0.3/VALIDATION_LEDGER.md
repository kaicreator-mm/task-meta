# task-meta v0.3 — T06 real validation ledger (preflight R0)

This record **does not claim E2E PASS**. All real Host/Agent/test outcomes below start as `NOT_RUN`. Evidence sources are immutable exact SHAs and actual native GitHub comment IDs; a test-only connector comment is not an ADS Report.

## Authority and source context

| Source | Exact fact / status |
|---|---|
| T06 governing Issue | [task-meta #45](https://github.com/kaicreator-mm/task-meta/issues/45) |
| Product Freeze | `2b39d4913c09c7543fb3234d81c2914b83e0a262` |
| L2 Freeze | `366ef30ee96399f6baeb802208ab00e092b84686` / blob `e68005ee82105730b40ed8a8e21ef3b1f8c85517` |
| v0.3 implementation branch accepted at T05 | `version/v0.3@8e5a15a1266e12f6a5954481597a02eefe2da914` |
| T05 independent reviewed Golden | PR #52 `0a8fa3820280e4efe770974844abe014e09cd25b`, Node24 539/539 full + 8/8 focused PASS |
| ADS qualified ordinary v5 main | `718fb02e33b31f568736447b2b905883cc6fcc3a` + Schema blob `7478313cc006162432649d734e59c5cd77db5106` |
| ADS candidate (isolated test-only) | `3041a1be3f130e5cc5e676c2e56a99882adfd97c`, NOT production-publishable |
| Exclusive isolated live E2E sink | [task-meta-e2e Issue #9](https://github.com/kaicreator-mm/task-meta-e2e/issues/9) (created under T06) |
| Connected GitHub transport smoke | [actual native comment #6381275863](https://github.com/kaicreator-mm/task-meta-e2e/issues/9#issuecomment-6381275863), marker exact readback `PASS` **for connector transport only** |
| Real task-meta producer POST/readback | **NOT_RUN** — above comment is NOT an ADS Report |
| Real Node24 Agent Host / ZCode / Claude / Codex | **NOT_RUN / NOT_RUN / NOT_RUN / NOT_RUN** |
| Real CI, packaging, full regression at T06 exact SHA | **NOT_RUN** |
| v0.3 independent Release Qualification | **NOT_RUN**; T07 #46 holds authority |

## 1. Host-source and GitHub preflight (read-only)

Use a **clean exact T06 PR HEAD** worktree (not arbitrary main or legacy v0.2): Node 24.x, `git rev-parse HEAD`, `git status --porcelain`, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `node --test test/v0.3/golden.test.ts`; inspect packaging metadata / actual plugin distribution and run source privacy checks. Record every command, exit code, actual timestamp, Node/npm/OS and exact SHA in the following receipt matrix; *do not mark PASS before actual execution*.

```sh
# In isolated clean exact PR HEAD, with explicit SHA set by controller:
export TASKMETA_V03_EXPECTED_SHA="<full-40hex-T06-HEAD>"
node scripts/v0.3-e2e-preflight.mjs
node scripts/v0.3-e2e-preflight.mjs --github-readonly
```

The script is intentionally READ-ONLY (only `gh api GET repos/... / issues/9` and local Source/Schema reads); the actual local Host `gh` credential/permissions may differ from those of the connected GitHub tool. Its stdout is path-free and contains no token. `--github-readonly` must be explicit. `PASS` on this preflight does **not** prove real publisher POST/readback or Agent provenance.

## 2. Real three-agent capture

Use **actual** sessions/execution on approved Node24/Windows or Ubuntu Host, each tied to **one** real bounded E2E Task on the isolated repository, never synthetically invented Agent activity. Existing task-meta-e2e #1–#8 belong to older tests and cannot be relabeled as v0.3 evidence. For each ZCode, Claude Code and Codex run, capture only minimal source pointers, an actual private Attempt/Run/Step trace, provider run/session ID, tool call count, physical retry/cost epistemic classification, verifier scope, privacy/capture coverage and exact repo version SHA. No credentials, transcripts, prompt content or private CAS bytes in public GitHub comments.

| Lane | Real source session ref | Host/OS and exact SHA | Actual CLI/exit | Actual Attempt/Run/Step receipt | Outcome |
|---|---|---|---|---|---|
| ZCode | UNKNOWN | UNKNOWN | NOT_RUN | NOT_RUN | NOT_RUN |
| Claude Code | UNKNOWN | UNKNOWN | NOT_RUN | NOT_RUN | NOT_RUN |
| Codex | UNKNOWN | UNKNOWN | NOT_RUN | NOT_RUN | NOT_RUN |

Execute actual collector commands with correct native inputs (never invented paths): `node src/cli.ts collect --repo kaicreator-mm/task-meta-e2e --issue 9 --headless <actual-file> --store <private-store-dir> --out <private-output.md> --profile v5 --ads-pin 3041a1be3f130e5cc5e676c2e56a99882adfd97c --e2e-test-only --clearance-ref isolated-e2e:task-meta-e2e/issues/9 --publisher-source-sha <exact-current-version-head>`. For Claude Code: `collect-claude --claude-transcript <actual-file>` and Codex: `collect-codex --codex-session <actual-file>`; preserve all common source qualification options. Do **not** pass `--publish` on the first run; first inspect generated strict v5 report and privacy guard, and capture exit codes. Run real `--publish` **only** after explicit isolated Issue #9 target and candidate test-only pin are both read back and the generated public document is approved safe. Verify the returned native comment ID/URL/body digest using real `gh api GET` and task-meta's own `parseReportComment`/digest logic.

Never use `--e2e-test-only` with `version/v0.3` normal production publishing; ordinary v5 main qualification requires the separate source-owned per-projection grant and actual verified authorization. No test bypass may leak into ordinary repositories.

## 3. Real live GitHub and adversarial checks

| Case | Expected result | Actual receipt |
|---|---|---|
| Native isolated Issue and authenticated Host `gh` permission GET | Issue #9 canonical, repo write permission demonstrably present for Host (not just connector user) | NOT_RUN |
| First publisher POST from real ZCode | Actual GitHub comment ID/URL and parsed report data digest; scope is E2E test only | NOT_RUN |
| Publisher repeat of same Report identity/digest | `ALREADY_PUBLISHED`, no second POST/comment | NOT_RUN |
| Same identity/different digest and edited/damaged original | `CONFLICT`/`NOT_PUBLISHED`, no unauthorized overwrite | NOT_RUN |
| Transient 403/429/timeout, incomplete page, lost-ACK/after-ACK readback | Fail closed/typed UNKNOWN without blind retry; real controlled fault proxy where safe, mock-only not relabeled real | NOT_RUN |
| Ordinary repo candidate pin with `--e2e-test-only` | Admission rejected; **zero GitHub POST** outside isolated repo | NOT_RUN |
| Ordinary v5 with empty source-owned policy grant | `NOT_PUBLISHED`/HELD, **zero POST**, no fabricated clearance | NOT_RUN |
| Source-qualified correction / nonrevoking DISPUTE | Immutable exact target and source witness, owner qualified; otherwise UNKNOWN | NOT_RUN |
| Claude Code real capture and isolated publication | Real Agent+native Host receipt, scoped comment/readback | NOT_RUN |
| Codex real capture and isolated publication | Real Agent+native Host receipt, scoped comment/readback | NOT_RUN |
| Private store / public ADS report boundary | Private manifest/trace/prompt/token never leaked to public comment | NOT_RUN |

A real GitHub `gh api` denial may be ethically and safely tested by a separately constrained/unauthorized credential or controlled fault injection, but **never** intentionally spam another repo or cause broad rate limits. `NOT_RUN` with explicit waiver/rationale is preferable to invented negative evidence.

## 4. Release and exact-HEAD closure

- Require real Node24 full-suite/Golden regression after any accepted Task fixes, plugin packaging/profiles, Windows/Ubuntu scope (only claim what physically ran), exact commit and public/private output attestations.
- Independent Reviewer must audit actual T06 PR HEAD and all Host receipts, report P0/P1/P2 and `VALIDATION_PASS | CONDITIONAL | BLOCK` with explicit gaps/waivers. Runtime #45 can be accepted only with material real Agent/GitHub/Host validation, not the repository/preflight existence alone.
- T07 #46 remains a distinct independent Version Closure/RQ after T06 and must decide version `0.3.0` metadata (package currently `0.1.0`), v0.2 unqualified source carry-forward, packaging, real E2E, security, all P2, CI waivers and main-merge readiness. PR PASS ≠ Release PASS.

## 5. Evidence ledger entries (append only real receipts)

```ini
T06_SOURCE_PREPARATION=WRITTEN
T06_GITHUB_TRANSPORT_ONLY=PASS_CONNECTED_TOOL_ISSUE9_COMMENT6381275863_READBACK
T06_HOST_NODE24=NOT_RUN
T06_GOLDEN_REGRESSION_CURRENT_EXACT_SHA=NOT_RUN
T06_ZCODE_REAL=NOT_RUN
T06_CLAUDE_CODE_REAL=NOT_RUN
T06_CODEX_REAL=NOT_RUN
T06_TASKMETA_NATIVE_PUBLICATION=NOT_RUN
T06_REAL_NEGATIVE_PERMISSIONS=NOT_RUN
T06_INDEPENDENT_E2E_REVIEW=NOT_RUN
T07_RQ=NOT_RUN
MAIN_MERGE=NO
```
