# task-meta v0.4 — GitHub-only ADS v5 Producer Contract (E)

Scope: strict source-only producer conformance to the effective ADS v5 report schema. Not public permission, not a Tally SDK/DB, and not qualification of external Tally.

## Pins and boundary
- Frozen Product blob 0af2b9cafd63ca1faa8b2fa612f7fdc5e02db067; L2 blob 5fc32ca154e77cb6bd34f32f4a6a91717b4b4633.
- Ordinary v5 qualified ADS main 718fb02e33b31f568736447b2b905883cc6fcc3a; schema blob 7478313cc006162432649d734e59c5cd77db5106. ADS v4.18 planning does not replace runtime v5 adoption.
- The historical candidate 3041a1be3f130e5cc5e676c2e56a99882adfd97c is NOT authority for normal publication. Isolated E2E needs explicit purpose and per-repo qualification.

## Strict offline Golden oracles
- test/v0.4/producer-v5-golden.test.ts reuses synthetic ZCode fixtures to construct AttemptSummary and synthetic source-owned clearance.
- Verify strict adopted v5 schema, parse/render roundtrip and proper ADS revision; forbidden private keys, missing schema-required metrics and missing clearance must fail.
- No publisher invocation, native GitHub API call, HTTP denial/retry, or remote pagination in this E Task. Those tests belong B1/B2 exclusively.
- Real Agent CLI and Tally external reader remain separate integration/Release acceptance; do not substitute fixture PASS for real E2E.

## GitHub → Tally
Tally reads only source-qualified GitHub-published ADS v5 reports and independently validates source identity/currentness. No private Task-meta->Tally ingress or DB coupling is permitted here.

Evidence: source fixture authored; Node24 lint/typecheck/full regression = NOT_RUN pending true Host receipt; REAL_TALLY_APP=NOT_RUN.
