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
