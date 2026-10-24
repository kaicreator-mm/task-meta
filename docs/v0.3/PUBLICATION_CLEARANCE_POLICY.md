# task-meta v0.3 — source-qualified v5 publication clearance

**Scope:** private task-meta implementation policy for FR00 #36/T00 #39, not a new ADS public Report schema and not new Tally authority.

An ordinary v5 Report is **HELD** unless the following all succeed at the last GitHub POST boundary: (1) qualified immutable ADS v4.16 main pin + actual unchanged vendored v5 schema bytes; (2) validated PUBLISHABLE schema projection and publisher SHA; (3) a version-reviewed `config/publication-clearances.json` entry binding the **exact owning Issue, publisher namespace, ADS revision, publisher source SHA and canonical public projection digest**; (4) an actual native Issue comment at the entry's canonical URL whose bytes match its SHA-256; (5) an authenticated GitHub repository permission read showing `push` or `admin`, plus the actual same unlocked native Issue readback. Any missing/partial/drift/403/429/error => NOT_PUBLISHED without POST.

The policy ships with **zero grants**. This is deliberate: historical `owner-authorization:2026-10-23:kaicreator-mm/*` is neither an issue-specific native source nor a reviewed per-projection privacy grant; it is removed from the auto-report default. A fixed string, GitHub login, an ADS body field `PUBLISHABLE` or a locally returned report object is insufficient.

## Owner-authorized registration (before actual production publication)

1. Generate only the existing strict v5 `EXECUTION_SUMMARY`/feedback/correction projected content, with **no private manifest/prompt/reasoning/provider secrets**. Compute RFC8785/JCS canonical digest of the **validated public data excluding `publication`**.
2. Obtain an actual source-owner approval scoped to that exact projection and Issue; place a sanitized, nonsecret grant artifact as a GitHub-native comment on the owning Issue. Obtain actual comment ID/URL and exact bytes through readback. Do not prefill its GitHub-issued ID.
3. In `config/publication-clearances.json`, enter the exact comment URL as `clearance_ref`, canonical `repository`, `issue_number`, `publisher_namespace`, immutable ADS main revision, publisher source SHA, exact projection digest and SHA-256 of **actual owner grant comment body**. Independent reviewer must accept the source and scope under the version governance pin; do not trust the transport login alone. No wildcards.
4. Set the reporter's `clearance_ref` to the **same actual comment URL**, not to an old project-wide owner-authorization string; the report builder computes `projection_digest`. If projected content changes, a new source qualification and grant is required. Code will refuse duplicate or out-of-scope grant rows.
5. At runtime the publisher rechecks all source/permission conditions before posting and reconciles actual native comment after POST as before. GitHub access control can still change between preflight and POST; a failed actual POST/readback stays NOT_PUBLISHED, not silently claimed successful.

This strict per-projection procedure makes privacy authority explicit at the expense of throughput. A future scoped batch policy would require separate governed Product/L2 authority and negative tests; do **not** casually loosen it for convenience. E2E candidate publication remains strictly `E2E_TEST_SUBJECT`, explicit isolated repo + purpose, and must never act as an ordinary clearance. The T06 real Host/GitHub E2E remains distinct; source-only unit tests cannot prove live permissions.

## Evidence/validation truth

The initial implementation and local Node24 tests at PR #47 previous H `e2d1b5c` proved only the old source pin/entrypoint path and **NOT** this new authorization functionality. Every change to this policy/permission implementation requires fresh exact-HEAD typecheck/tests, and an independent security delta reviewer must re-validate P1-01 closure. An absent registered grant produces HELD; it is not a passing production E2E. Production clearance contents must be owned by the source-owning project and reviewed before use.
