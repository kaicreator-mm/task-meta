# task-meta v0.3.0 — Independent Release Qualification Candidate R0

**Status:** `RQ_CANDIDATE / SOURCE_PREPARATION_ONLY / INDEPENDENT_RQ=NOT_RUN / MERGE_MAIN=NO / TAG=NO`.

**Controller rule:** v0.3 implementation and source-only Golden PASS, plus scoped real Agent E2E PASS, do **not** entail a whole-version release PASS. Treat unavailable CI as documented waiver/NOT_RUN, never counterfeit PASS; a material source or private-public boundary gap stays BLOCKED until qualified. This document is only the evidence checklist and intended target; release authority belongs to independently reviewed Issue [#46](https://github.com/kaicreator-mm/task-meta/issues/46).

## 1. Immutable acceptance baseline

| Subject | Exact identity / latest sourced result |
|---|---|
| Product/L1 Freeze | `2b39d4913c09c7543fb3234d81c2914b83e0a262`; Issue #27 owner Freeze |
| L2/Architecture Freeze | `366ef30ee96399f6baeb802208ab00e092b84686`, evidence blob `e68005ee82105730b40ed8a8e21ef3b1f8c85517`; independent review and owner Freeze |
| ADS source | v4.17 GAIP `1355bc0694b3b0225effa82b670725f83a2b873b`, blob `49ecd802c5bf14237e23d5e321c56c220eb8974e`; this is not a v4.17 whole-version release claim |
| Ordinary report | ADS v4.16 main pin `718fb02e33b31f568736447b2b905883cc6fcc3a`; vendored v5 strict schema blob `7478313cc006162432649d734e59c5cd77db5106` |
| T00 FR00 | PR #47 accepted `e358f6cfc16fe092cac5d2f47ddbf5bd5ba1d41a`, Node24 tests 503/503, independent P0/P1=0 |
| T01 | PR #48 accepted `3095eeba771fcf2776890d69aa0f0b5800f88304` |
| T02 | PR #51 accepted `7e9fe9d3dc135c2891e0390b066c1c23b21fc9a3`, Node24 tests 524/524 |
| T03 | PR #49 accepted `4688942d2da803774dc41d559563c5e3b9256723` |
| T04 | PR #50 accepted `addc6c75fa4b2e69da01482ea53541be466ebb19`, Node24 tests 513/513 |
| T05 | PR #52 accepted `0a8fa3820280e4efe770974844abe014e09cd25b`, Node24 full 539/539 + Golden 8/8, G00–G11 source-only |
| T06 real Agent/Host | PR #53 accepted `5b7072d78016052b1ea816b2b36322b946ef5c78`, Windows Node v24.21.0 538 PASS/1 SKIPPED, focused Golden 8/8, independent `VALIDATION_PASS`; version merge `121ee42a8441f589796e809aa11e87be5b59eca4` |
| Real native publication | Real ZCode [comment 6381704604](https://github.com/kaicreator-mm/task-meta-e2e/issues/9#issuecomment-6381704604), Claude Code [6381719186](https://github.com/kaicreator-mm/task-meta-e2e/issues/9#issuecomment-6381719186), Codex [6381725137](https://github.com/kaicreator-mm/task-meta-e2e/issues/9#issuecomment-6381725137); independent GitHub readback and digests in [PR #53 evidence](https://github.com/kaicreator-mm/task-meta/pull/53#issuecomment-6381897094) |
| Source status of real reports | All three truthful `UNPINNED/UNKNOWN` for **execution subject**, `publisher_source_sha=5b7072d7...`; E2E covers real capture/publication, not a fully canonical dispatch-bound source `PINNED` |
| Release candidate code | T07 PR/HEAD must be physically pinned after all metadata/packaging fixes. Parent at T07 start: `version/v0.3@121ee42a8441f589796e809aa11e87be5b59eca4` |
| Earlier v0.2 | `UNQUALIFIED_SOURCE_CARRY_FORWARD`: v0.2's presence on main is **not** a retrospective v0.2 Release PASS |
| Main merge / tag | `NOT_RUN` until independent T07 `RQ=READY` at exact version branch candidate and applicable gates |

## 2. v0.3.0 package/plugin consistency (source implementation in T07)

- Root `package.json` version `0.3.0`; `package-lock.json` root and packages[""].version `0.3.0`.
- All three marketplace and individual plugin metadata versions `0.3.0`: `plugins/zcode/marketplace.json` + `plugins/zcode/task-meta-capture/.zcode-plugin/plugin.json`; `plugins/claude/.claude-plugin/marketplace.json` + `plugins/claude/task-meta-capture/.claude-plugin/plugin.json`; `plugins/codex/.agents/plugins/marketplace.json` + `plugins/codex/task-meta-capture/.codex-plugin/plugin.json`.
- `test/v0.3/release-metadata.test.ts` checks all eight files. This is a deterministic **source-only** check; it does NOT demonstrate actual installation/update, hook activation, package distribution or a signed release artifact.
- Actual package manifests, plugin runtime installed paths, generated bundling contents, integrity digest, `npm ci`, lockfile `npm install --package-lock-only --ignore-scripts` changes (if any), `npm pack --dry-run` or equivalent safe packaging inspection and genuine install/sync hooks require real Node24 Host receipts. `package.json.private=true` must remain true; do not publish private payloads to public npm.

## 3. Independent acceptance gates (T07 must fill actual receipts)

| Gate | Candidate requirement | Current evidence state |
|---|---|---|
| Exact source | Clean exact HEAD/tree/blob and no drift across Reviewer, Host, packaging | NOT_RUN on T07 candidate |
| Root and three plugin versions | All 0.3.0 and no stale marketplace/manifest refs | CODE_WRITTEN; physical verification NOT_RUN |
| Node24 reproducible build | npm ci; lint; typecheck; full npm test + Golden + release metadata | NOT_RUN on T07 candidate |
| Packaging/installation | Root and each 3 plugin marketplace/manifest distributions/install on declared actual Host; no incorrect plugin hook path | NOT_RUN on T07 candidate |
| Real Agent/Host GitHub | T06 scoped Windows real ZCode/Claude Code/Codex v5 reports in isolated #9; exact native comment URLs/digests; no ordinary repo test posts | T06 PASS at its pinned exact SHA (do not copy this as new T07 candidate physical PASS) |
| Production publication safety | Ordinary v5 requires source-owned per-projection grant + native own Issue/permissions; shipped grant policy empty; no synthetic candidate to normal repo | T00/T06 source+negative PASS; production real owner-cleared live publish remains NOT_RUN |
| Real `auto-report` hook-spool | At least one actual Agent `Stop` / `SessionEnd` hook to task-meta auto-report/outbox readback and retry, with nonsecret receipt, correct source and authorization | **NOT_RUN; P1 release blocker unless independently waived with constrained qualified scope** |
| Remote CI | Exact T07 version candidate CI if available; this repository has no `.github/workflows` at T06 accepted tree; Woodpecker external may exist | **NOT_RUN**; may receive explicit auditable `CI_UNAVAILABLE_WAIVER` under user policy (waiver is not PASS) |
| Full security negative gates | Typed 403/429/timeout/lost ACK, edition/duplicate/dirty pagination, arbitrary repo candidate pin denied, private payload leak check | Source-only negative PASS plus T06 live replay/tamper/denial; injected 403/429/lost ACK live **NOT_RUN**, scope as truthful waiver or BLOCK |
| Platform scope | Windows Node24 physical T06 PASS; Ubuntu/Linux Release deployment lane | Windows scoped PASS at T06 SHA, Linux **NOT_RUN** |
| Version artifact/release | package ZIP/tag target, SHA-256, manifest inclusion/exclusion, README/install user journey | NOT_RUN |
| P2 ledger | Nonblocking findings from PR #47/#50/#51/#52 + T06 skip/record gaps triaged by independent RQ | OPEN, must explicitly account |
| Independent Version RQ | Fresh reviewer exact SHA and per-gate `READY | CONDITIONAL | BLOCKED | FAIL` | NOT_RUN |

**Decision boundary:** `READY` only if mandatory material real E2E/publication, package/installation, source privacy/security, version exact-H, and independent RQ are qualified. `CONDITIONAL` cannot silently turn `CI_UNAVAILABLE_WAIVER` into CI PASS or permit merge if the owning Release Standard demands READY for main; if anything material remains unqualified, RQ stays `BLOCKED`. No version branch→main merge, tag or published release until READY.

## 4. Root cause / known risks

1. Ordinary v5 authorization policy intentionally has **zero grants**; this is correct fail-closed production default, not proof of a successful real owner-cleared production publish. A valid release may ship fail-closed, provided product scope does not require live ordinary publish.
2. Real v5 ZCode/Claude/Codex reports were `source_status=UNPINNED` for execution source. This is truthful currentness, not a canonical dispatch source; avoid claiming pinned code/accepted outcome.
3. T06 independent reviewer explicitly reports missing **remote exact-SHA CI** and **real auto-report hook-spool path** as release follow-ups. Do not close by citing only direct `collect` sessions.
4. One Node24 test SKIPPED on T06 Windows: investigate exact name and reason before whole-version READY, or record scoped waiver.
5. v0.2 implementation source was historically integrated without its own Release Qualification; v0.3 must not retroactively convert that source baseline to v0.2 release PASS.
6. Privacy-safety: public ADS Reports contain only sanitized allowed fields; private traces/CAS paths/secrets/prompts are never used as independent public evidence. Evidence authority is native Issue/PR, not a copied mutable Markdown dashboard.

## 5. Required local proof and separate independent RQ dispatch

At **T07 exact candidate PR HEAD** in a clean Node 24 Host, run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `node --test test/v0.3/golden.test.ts`, `node --test test/v0.3/release-metadata.test.ts`, install/activate three actual plugin integrations and observe one real `auto-report` hook-spool → outbox path with no ordinary-project unauthorized POST. Inspect `npm pack --dry-run` / actual package artifact; compute checksums; record exact commands/exit codes on Windows and any Linux lane actually performed. Distinct code Reviewer must independently examine all release-scope diffs, version metadata, packaging and true E2E evidence and issue `P0/P1/P2` + `READY | CONDITIONAL | BLOCKED | FAIL`, with explicit waivers. Only `READY` opens the version branch→main integration + tag. Public release must preserve `package.json.private` restrictions.
