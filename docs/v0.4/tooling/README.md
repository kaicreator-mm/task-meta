# task-meta v0.4 — Native Issue Dependencies admission instance

This folder is **planning-only**. Source: frozen Product #60, L2 #62, Task DAG Controller #64, PR #75 R2 at exact HEAD `ce28f171284360cc104ae86ed67233018df18414` and blob `68dd26467f8743a8cfa84111c7b1f2e6b3a8c8a6`. The public ADS report v5/runtime adoption pin is unchanged.

- Canonical generic tool: [devkit Issue #1](https://github.com/kaicreator-mm/devkit/issues/1) / [draft PR #2](https://github.com/kaicreator-mm/devkit/pull/2), initial implementation `39eca37d2f4f877db52dd8e2308c0fba6b074d00`. Tool is separately reviewed/versioned; pin reviewed tool SHA before use.
- [Native DAG manifest](./native-dag.manifest.json): 10 real Issue database IDs, **12 expected blocked_by edges**. `review_comment_id`, `freeze_comment_id`, `integrated_sha` intentionally `null` — they MUST be replaced with actual source-qualified receipts only after independent exact-HEAD R2 PASS, Owner Freeze and **version/v0.4-only** PR #75 merge.
- Current status: DAG R2 reviewer PASS `NOT_RUN`; owner freeze `NO`; GitHub native dependencies `0/12` on latest checked readback; task source code/JIT `NOT_ADMITTED`. Do not count this file/PR as an accepted Native DAG proof. This tooling PR must not merge to version branch before approval if doing so changes the PR #75 base pin.
- Safe CLI: `node <devkit>/tools/ads-native-dag.mjs plan --manifest docs/v0.4/tooling/native-dag.manifest.json`; `readback` is read-only. `verify` and `apply --apply` MUST fail until the three receipt fields are real and version HEAD matches.
- After true approval and version-branch merge, update these fields on a separately reviewed task-meta tooling diff; run `verify`, and only with explicit Owner authorization `apply --apply`. Capture 20-direction GETs, exact 12/12 readback and true exit codes back to #64. No GUI and no implicit Builder Claim.

**No source/runtime mutation and no main integration** from this instance alone.
