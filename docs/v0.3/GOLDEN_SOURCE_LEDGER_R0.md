# task-meta v0.3 T05 — shared ADS source-only Golden ledger R0

**Stage:** DRAFT CANDIDATE; `SOURCE_ONLY_EXECUTION=NOT_RUN` / `NODE24=NOT_RUN` / `REAL_AGENT_HOST=NOT_RUN` / `REAL_GITHUB_COMMENT=NOT_RUN` / `TALLY_CONSUMER=NOT_RUN` / `RELEASE_QUALIFICATION=NOT_RUN`. This ledger is a planned test matrix, not fabricated results.

## Immutable source authority
- Product Freeze: `2b39d4913c09c7543fb3234d81c2914b83e0a262` (independent Product PASS and separate owner Freeze #27).
- L2 Freeze: `366ef30ee96399f6baeb802208ab00e092b84686`, blob `e68005ee82105730b40ed8a8e21ef3b1f8c85517` (independent #38/PR #37 and owner Freeze).
- ADS v4.17 protocol source `1355bc0694b3b0225effa82b670725f83a2b873b` / GAIP blob `49ecd802c5bf14237e23d5e321c56c220eb8974e`.
- Ordinary ADS v4.16 main qualified pin `718fb02e33b31f568736447b2b905883cc6fcc3a`, actual strict v5 Schema blob `7478313cc006162432649d734e59c5cd77db5106`.
- Accepted version implementation base HEAD `347ff0f01816b0bdc0a60b657561168fe8e2ab9e` after T00 #47, T01 #48, T02 #51, T03 #49, T04 #50. Exact per-feature review heads in `test/v0.3/golden-r0.json`.
- Candidate tests: `test/v0.3/golden.test.ts` and language-neutral `test/v0.3/golden-r0.json`. **Real validator must report its exact candidate branch H and full `git status --porcelain` at runtime**, never misread the frozen source base as the test HEAD.

## Test matrix and expected outcomes (not claims of PASS)

| ID | Source concern | Expected source-only oracle |
|---|---|---|
| G00 | FR00 historical owner-authorized version candidate, no main adopted | fail-closed `UNQUALIFIED_CANDIDATE_DEFAULT` |
| G01 | FR00 qualified immutable v4.16 main + actual vendored v5 blob | ADOPTED in scoped resolver; permission and actual owner clearance still separately required |
| G02 | FR00 forged E2E purpose against ordinary repo | `CANDIDATE_NOT_PUBLISHABLE` |
| G03 | FR01 two real Attempts identical Git transitions | two Attempt refs and two source Transition edges |
| G04 | FR01 replay vs same Attempt conflicting facts | duplicate dedup vs conflict HELD |
| G05 | FR02 strict v4 8-key / v5 14-key correction target | schema pinned; actual owner/currentness readback required for effect |
| G06 | FR02 owner `DISPUTE` | `DISPUTED_NONREVOKING` even with source-qualified authority |
| G07 | FR02 GitHub incomplete native pages | NOT_PUBLISHED and zero duplicate POST |
| G08 | FR03 duplicate physical token observation | one 12-token delta, denominator 1 and private-only output |
| G09 | FR03 v4-v5 mixed cohort and missing metric | NOT_COMPARABLE, null/UNKNOWN not zero |
| G10 | FR05 source owner witnessed A→B→A′ | Pivot 2/2; Revisit 1/1 (first A→B excluded) |
| G11 | FR05 unqualified/inferred source | D=0 / NOT_COMPARABLE, no strategy promotion |

Existing contract tests from T00–T04 remain **mandatory** to cover narrower variants not repeated in this shared suite: source qualified public clearance/permissions, full correction 14-field native roundtrip and revocation, Billing BILLED versus ESTIMATED and superseding metric source revision, native GitHub feedback factual-only join, lost POST ACK reconciling after a server-created comment, confidence and privacy negative cases. Shared Golden adds cross-concern control, it does not replace them.

## Required execution evidence and status conversion
1. In a clean Node **24.x** task/T05 exact-H worktree: run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `node --test test/v0.3/golden.test.ts`; record every command, exit code, passing/failed case ID, pinned HEAD and dirty files. If any failure: FAIL, patch only T05 source fixture/test or raise upstream Task follow-up, then repeat on new H.
2. Independently compare generated public ADS document schema and field names against the actual vendored v4/v5 strict schema, and verify no private publication manifest/Trace/hidden reasoning ever enters report. Record distinct `SOURCE_ONLY_CONFORMANCE` and `SCHEMA_CONFORMANCE` results at exact H.
3. Distinct exact-H Code Reviewer report P0/P1/P2, PASS/BLOCK and `MERGE_ELIGIBLE`. Author or controller cannot self-substitute independent review.
4. **T06 separately:** real ZCode / Claude Code / Codex producer, Node 24 Host/Windows/Ubuntu as relevant, actual authenticated GitHub isolated test-repo Issue comment post/readback and complete negative permissions; capture actual native URL/ID/SSH Host commands and exit status. Golden simulation never implies this passed.
5. **T07 separately:** Release Owner/Reviewer checks full-version candidate SHA, packaging/version metadata and predecessor v0.2 unqualified source carry-forward with independent RQ before any main merge/tag.

**Security:** fixtures contain only synthetic public metadata. Do not publish any synthetic candidate Report to ordinary GitHub repositories. No live GitHub network operations belong to this source-only test suite.
