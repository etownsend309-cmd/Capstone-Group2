# AI classifier evaluation

- **Dataset:** CUAD v1
- **Documents:** 30
- **Engine:** local-rule
- **Model:** n/a
- **Prompt/schema:** clausepilot-classifier-v1 / classifier-output-v1
- **Failures:** 0
- **Privacy:** No agreement text or source quotes are included in this report.

## Aggregate

- Macro precision: 80.9%
- Macro recall: 50.1%
- Macro F1: 60.4%
- Exact-evidence acceptance: 100.0%
- Input/output tokens: 0 / 0

## Per-category results

| Category | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Governing Law | 24 | 0 | 4 | 100.0% | 85.7% | 92.3% |
| Anti-Assignment | 11 | 0 | 10 | 100.0% | 52.4% | 68.8% |
| Cap On Liability | 7 | 1 | 8 | 87.5% | 46.7% | 60.9% |
| Audit Rights | 4 | 0 | 4 | 100.0% | 50.0% | 66.7% |
| Termination For Convenience | 3 | 1 | 5 | 75.0% | 37.5% | 50.0% |
| Exclusivity | 11 | 3 | 3 | 78.6% | 78.6% | 78.6% |
| Renewal Term | 7 | 0 | 2 | 100.0% | 77.8% | 87.5% |
| Insurance | 8 | 1 | 6 | 88.9% | 57.1% | 69.6% |
| Change Of Control | 4 | 3 | 5 | 57.1% | 44.4% | 50.0% |
| Uncapped Liability | 2 | 2 | 7 | 50.0% | 22.2% | 30.8% |
| Notice Period To Terminate Renewal | 2 | 0 | 5 | 100.0% | 28.6% | 44.4% |
| Warranty Duration | 1 | 2 | 4 | 33.3% | 20.0% | 25.0% |

## Limitations

- Category positives come from the prepared manifest derived from CUAD master_clauses.csv.
- CUAD is the development/evaluation set; do not treat these results as independent holdout evidence.
- The separate 10-agreement modified holdout must remain sealed until configuration is frozen.
