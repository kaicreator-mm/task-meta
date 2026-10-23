# T18 fault injection (publisher / auto-report)

Live target: `kaicreator-mm/task-meta-e2e` Issue #3 (https://github.com/kaicreator-mm/task-meta-e2e/issues/3),
the only repository the harness will write to. Harness: `scripts/e2e-fault-injection.ts`
(`node scripts/e2e-fault-injection.ts --repo kaicreator-mm/task-meta-e2e --issue <n> --evidence <dir>`).
Offline mirror: `test/publish-faults.test.ts` (fake client, never the live API).
Publisher source pin used in the reports: task-meta `main` `04e532f6e551ab21ef76670a5f2e92c53ab90b5a`.
Two complete live runs were made (identical verdicts); each scenario uses a fresh `report_id`.

| # | Scenario | Live result | Offline test |
|---|----------|-------------|--------------|
| 1 | Lost ACK: real POST, then the client throws a network error | `PUBLISHED` by readback reconciliation; 1 POST; 1 comment | lost ACK (network error and HTTP 502 variants) |
| 2 | Crash after POST (child process killed with exit 137), fresh process republishes | `ALREADY_PUBLISHED`, 0 POSTs; 1 comment | crash after POST |
| 3a | Two `publishReport` processes started on a shared barrier | **Both POSTed** (race between readback and POST) in both runs: 2 comments, same identity and digest. A follow-up `publishReport` is `ALREADY_PUBLISHED` (equal digests are not a conflict) | deterministic interleave: both list before either posts |
| 3b | Two `auto-report` processes, one synthetic session, shared outbox/store | One `PUBLISHED`, the other `ALREADY_RUNNING` (per-session lock); sequential rerun `ALREADY_PUBLISHED`; 1 comment | not mirrored (covered by `auto-report.test.ts`) |
| 4 | Comment edited in place (`PATCH`, one `limits` entry changed), original body republished | `CONFLICT` (existing vs new digest reported), 0 POSTs, edited text untouched | edited comment; differing copy next to an equal one |
| 5 | per_page=5, 12 plain fillers, report on page 4 (run 1) / page 8 (run 2) | Found by exhaustive pagination: `ALREADY_PUBLISHED`, 0 POSTs, pages 1..N requested | beyond page 2; client page cap below requested per_page |
| 6 | Rate limit / 5xx | Not forced live (cannot be provoked safely) | 503 retry, 429 `Retry-After`, 502 after commit, persistent 5xx, 403 secondary limit vs plain 403 |

## Findings

- No defect in `src/publish`: scenarios 1, 2, 4, 5 and the follow-up of 3a behave as the ADS rules require
  (same identity + digest is a duplicate; different digest is `CONFLICT`; no last-writer-wins).
- Scenario 3a confirms ADS: GitHub offers no compare-and-set, so two uncoordinated publishers can both post.
  The duplicate is detected (2 comments, one identity, one digest) and never escalates to `CONFLICT`.
  Callers must serialize per report key. `auto-report` does so with the per-session lock in its outbox
  directory (3b). The lock is local to one outbox directory: two hosts or two outbox directories do not
  share it and can still race exactly like 3a.
- Observation: an in-place edit that makes the comment schema-invalid is not parsed as a report, so it has
  no identity and a republish would post a fresh copy. Only schema-valid edits (the scenario 4 case) surface
  as `CONFLICT`. Not changed here (would need identity extraction from invalid bodies).
- `IssueComment` carries no `updated_at`, so a witnessed edit is detected only through the digest change.

## Evidence

`/c/xDev/kAiCreator/_tmp/tm-t18-sonnet/evidence/scenario-*.json` (final run) and `evidence-run1/` hold, per
scenario, the observed outcomes and the (identity, digest, comment id) counts parsed from
`gh api --paginate --slurp` of all Issue comments. Nothing was cleaned up on the Issue.
