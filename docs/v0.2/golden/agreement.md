# T19 golden set: labeler agreement

Labeler A = rule labeler v1 (`categorizeTool`); labeler B = independent blind labeling
(`labeler-b.json`, committed before this file was generated). Metadata only.

## Agreement

| scope | n | raw agreement | Cohen's kappa |
| --- | ---: | ---: | ---: |
| overall | 224 | 96.9% | 0.960 |
| claude | 72 | 93.1% | 0.899 |
| codex | 32 | 100.0% | 1.000 |
| zcode | 120 | 98.3% | 0.979 |

## UNKNOWN share

- labeler A: 67/224 (29.9%)
- labeler B: 60/224 (26.8%)

## Confusion matrix (rows = A, columns = B)

| A vs B | IMPLEMENTATION | TEST | DIAGNOSIS | VCS | ENVIRONMENT | PLANNING | OTHER | UNKNOWN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMPLEMENTATION | 58 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| TEST | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| DIAGNOSIS | 0 | 0 | 50 | 0 | 0 | 0 | 0 | 0 |
| VCS | 0 | 0 | 0 | 27 | 0 | 0 | 0 | 0 |
| ENVIRONMENT | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| PLANNING | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 |
| OTHER | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| UNKNOWN | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 60 |

Disagreements: 7 of 224 (listed in `disagreements.md`).

## After owner adjudication (rule labeler 1.1.0, 2026-10-23)

The owner adjudicated all 7 disagreements (`disagreements.md`, `owner:` column); the four tools
(`Agent`, `TaskStop` → OTHER, `mcp__ccd_turn__update_plan` → PLANNING, `mcp__ccd_turn__wrap_up` →
OTHER) were added to the rule table as labeler v1.1.0.

| scope | n | raw agreement | Cohen's kappa |
| --- | ---: | ---: | ---: |
| overall | 224 | 100.0% | 1.000 |
| claude | 72 | 100.0% | 1.000 |
| codex | 32 | 100.0% | 1.000 |
| zcode | 120 | 100.0% | 1.000 |

Labeler A UNKNOWN share: 60/224 (26.8%), mostly Bash/PowerShell calls whose command class does
not reveal intent. **Caveat:** v1.1.0 rules were derived from this sample's adjudication, so this
is in-sample agreement; out-of-sample validation needs a fresh sample from later sessions.
