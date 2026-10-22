# task-meta v0.1 — Product + L2 definition and Task DAG

Status: **FROZEN for v0.1 implementation by user instruction (2026-10-23)**.
Consolidates task-meta #10 (PRD R0), #13 (L2 candidate), #14 (ADS pin), #11
(verifier semantics), #2–#6 (intake). Where older issue text conflicts, this file wins
for v0.1.

## 1. Product

task-meta v0.1 is a **passive, local-first evidence collector and ADS GitHub report
writer** for one real Agent: **ZCode** (Z.AI coding agent CLI, as used by the
kAiCreator `zcode-dispatch` workflow).

Data path: `ZCode run → adapter (metadata-only observations) → correlator →
private immutable store (content-addressed, SHA-256 readback) → ADS ads/github/v4
EXECUTION_SUMMARY report (strict schema) → [gated] GitHub Issue comment + readback`.
Tally reads GitHub only; task-meta exposes no API to Tally.

task-meta does **not** schedule tasks, route agents, declare Task PASS, train models,
or create Skills/Packages.

## 2. Scope

| Stage | v0.1 | Notes |
| --- | --- | --- |
| A Collector (ZCode adapter + correlation) | **P0, implement** | Real source probed 2026-10-23, see §3 |
| B Private immutable evidence (store + manifest + spool) | **P0, implement** | Local filesystem, no DB |
| C Report writer `ads/github/v4` EXECUTION_SUMMARY | **P0, implement** | Default profile; v5 opt-in flag |
| D GitHub publisher (readback/idempotency/429/lost ACK) | **P0 code, live run gated** | Requires explicit `--publish`; tests use a fake GitHub client. Live publication NOT_RUN in v0.1 |
| E Tally GitHub-only reader E2E | **NOT_RUN** | Depends on Tally reader + ADS #1210 |
| Claude Code / Codex adapters | Deferred (v0.2) | Capability matrix only states UNSUPPORTED |
| Cost BILLED, experience feedback, correction writer, remote object store | Deferred | Cost reported as UNKNOWN unless evidenced |

## 3. ZCode source (probed on this host, zcode v0.16+)

1. **Headless result** (`zcode -p … --json` stdout, may start with a non-JSON warning
   line): `sessionId, traceId, turnId, response, usage{source, modelRequestCount,
   inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens,
   reasoningTokens, webFetchRequests, webSearchRequests}, eventCount, projection{…}`.
   `response` is model text → **dropped**.
2. **Model I/O rollout** `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl`, one line per
   model request: `type:"model_io", sessionId, traceId, turnId, requestId, attempt,
   querySource, startedAt, completedAt, durationMs, model{modelId, providerId},
   request{body…}, response{finishReason, headers, text, toolCalls[{id,name,input}],
   usage{inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens},
   providerMetadata…}`. Allowlist keeps ids, times, model ids, finishReason, usage,
   toolCalls[].id/name. **Dropped**: request body, response text/headers, tool input,
   providerMetadata.
3. **Dispatch run record** `run.txt` (`started=… head_before=<sha>`, `exit=… finished=…
   head_after=<sha>`) and `exit.txt` from `run-zcode.sh`: run boundary + source SHA.
4. **Verifier**: `task-check.sh` gate log with an explicit `EXIT=<code>` line; the
   collector records it as an independent verifier observation on `head_after`.

Observed gaps (honest UNKNOWN): reasoning tokens are absent from per-request rollout
usage and the headless total reports `0` that cannot be told apart from "not exposed" →
`reasoning_tokens` is UNKNOWN (null), never 0, no billed cost (coding plan) → cost UNKNOWN,
no per-tool timing (tool calls only known by id/name inside a model response),
`modelRequestCount` in the headless result may differ from rollout line count when a
session is resumed → coverage PARTIAL with a limit note, never silently reconciled.

## 4. Contracts (L2)

- Shared types: `src/model.ts` (ObservationRecord, AttemptSummary, …). Canonical JSON
  and digest: `src/canonical.ts` (RFC 8785 JCS + SHA-256).
- Identity: `observation_id = "zcode:" + source_event_id`; model request
  `source_event_id = requestId + "#" + attempt`; `logical_call_ref = requestId`,
  `physical_attempt_ref = requestId#attempt`. Same id + same canonical digest =
  duplicate delivery (dropped); same id + different digest = new `source_revision`
  (kept, flagged). Distinct `attempt` values are real retries (all kept, counted once each).
- Correlation: `task_ref = "<repo>#<issue>"`, `run_ref = sessionId`,
  `attempt_ref = sessionId` (one ZCode session = one leaf attempt; a resumed session is a
  new run segment of the same attempt), `step_ref = turnId`.
- Metrics (sum over unique physical model requests): `model_requests`, `input_tokens`,
  `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `tool_calls`,
  `model_wall_ms` (union of request intervals — overlaps never double counted),
  `run_wall_ms` (run.txt boundaries). Missing source → value null + UNKNOWN.
- Verifier: only from an independent gate log (`EXIT=` line) bound to an exact SHA;
  agent `response` text never sets verifier status. EXIT=0 → checked=[gate], status
  PASS for that gate only, `unchecked` lists task acceptance not covered by the gate.
- Store: `<root>/objects/sha256/<aa>/<digest>` immutable files (write tmp → fsync →
  rename; existing digest = verify bytes, never overwrite); `<root>/manifests/` manifest
  JSON listing object digests; `<root>/spool/` append-only JSONL outbox with per-line
  digest for crash replay. Readback re-hashes every object.
- Report: `<!-- ads:github -->` first line + one fenced `yaml` block with exactly
  `schema`, `kind`, `data`; strict ajv Draft 2020-12 validation against the vendored
  schema before output; `data_digest = sha256(JCS(data))` kept outside the data.
  `report_id = "task-meta:<attempt_ref>"`, `publisher_namespace = "task-meta:<repo>"`.
- Publisher identity `(issue, publisher_namespace, report_id, revision, report_kind)`;
  paginate all Issue comments before and after POST; same identity+digest = already
  published; different digest = CONFLICT (no write); lost ACK → readback reconciles.

## 5. Privacy

Metadata-only allowlist at adapter ingress. Forbidden anywhere in store or report:
prompt/system text, model response text, tool input/output, HTTP headers/cookies,
tokens/keys, absolute local paths. A guard test scans every produced store object and
report for forbidden keys and for sentinel secrets planted in fixtures.

## 6. Task DAG (v0.1)

| Task | Depends on | Delivers |
| --- | --- | --- |
| T0 bootstrap | — | scaffold, vendored ADS pins, `src/model.ts`, `src/canonical.ts`, this doc |
| T1 ZCode adapter + correlator | T0 | `src/adapters/zcode/*`, `src/correlate.ts`, capability profile, fixtures, tests |
| T2 private immutable store | T0 | `src/store/*`, tests (crash/replay/tamper) |
| T3 report writer v4 (+v5 opt-in) | T0 | `src/report/*`, schema tests incl. vendored fixtures/scenarios |
| T4 GitHub publisher (gated) | T3 | `src/publish/*`, fake-client tests: pagination, dup, conflict, 429, lost ACK |
| T5 CLI + real-run E2E | T1–T4 | `src/cli.ts`, E2E on a real ZCode session → store → report (dry run) |

## 7. Acceptance for v0.1

1. Real ZCode session from this host → observations → store readback OK → schema-valid
   v4 report (dry run) with honest UNKNOWNs. Evidence recorded in the release PR.
2. Negative tests: duplicate delivery, real retry, overlapping intervals, missing
   rollout, conflicting revision, tampered object, crash mid-write replay, forbidden
   key/secret leak, schema-invalid report refused, v4/v5 mismatch, GitHub dup/conflict/
   429/lost ACK/pagination.
3. `tools/task-check.sh` green (lint, typecheck, test) on every PR.
4. Not claimed: live GitHub publication, Tally E2E, ADS production adoption, billed cost.
