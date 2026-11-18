# AI classifier evaluation

- **Dataset:** CUAD v1
- **Documents:** 30
- **Engine:** openai
- **Model:** gpt-5.6-terra
- **Prompt/schema:** clausepilot-classifier-v1 / classifier-output-v1
- **Failures:** 0
- **Privacy:** No agreement text or source quotes are included in this report.

## Aggregate

- Macro precision: 83.1%
- Macro recall: 84.3%
- Macro F1: 83.3%
- Exact-evidence acceptance: 96.1%
- Input/output tokens: 312839 / 18577

## Per-category results

| Category | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Governing Law | 27 | 0 | 1 | 100.0% | 96.4% | 98.2% |
| Anti-Assignment | 20 | 0 | 1 | 100.0% | 95.2% | 97.6% |
| Cap On Liability | 10 | 1 | 5 | 90.9% | 66.7% | 76.9% |
| Audit Rights | 7 | 1 | 1 | 87.5% | 87.5% | 87.5% |
| Termination For Convenience | 7 | 3 | 1 | 70.0% | 87.5% | 77.8% |
| Exclusivity | 12 | 1 | 2 | 92.3% | 85.7% | 88.9% |
| Renewal Term | 9 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| Insurance | 12 | 1 | 2 | 92.3% | 85.7% | 88.9% |
| Change Of Control | 8 | 3 | 1 | 72.7% | 88.9% | 80.0% |
| Uncapped Liability | 7 | 4 | 2 | 63.6% | 77.8% | 70.0% |
| Notice Period To Terminate Renewal | 7 | 1 | 0 | 87.5% | 100.0% | 93.3% |
| Warranty Duration | 2 | 3 | 3 | 40.0% | 40.0% | 40.0% |

## Limitations

- Category positives come from the prepared manifest derived from CUAD master_clauses.csv.
- CUAD is the development/evaluation set; do not treat these results as independent holdout evidence.
- The separate 10-agreement modified holdout must remain sealed until configuration is frozen.
