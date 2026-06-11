# KB Eval Scorecard

Generated: 2026-06-11T12:23:33.850Z
Corpus: `kb-core-six`
Provenance: `deterministic-synthetic-fixtures`
Suite: `kb:core-six`

Overall passed: yes
## Policy

- optimize on: `admin-world-v3 dev`
- confirm on: `admin-world-v3 holdout`
- regression guardrails: `core-six dev`, `core-six holdout`
- external reference: `gbrain-world:github-benchmark`
- note: Optimize on product-core admin-world retrieval quality.
- note: Use deterministic core-six categories as regression floors.
- note: Keep the exact GBrain GitHub benchmark contract as an external comparison rail rather than a direct ship target.

Category pass rate: 100.0%

| Category | Cases | Passed | Metrics |
| --- | ---: | :---: | --- |
| retrieval | 72 | yes | precisionAtK=30.0%, recallAtK=94.4%, mrrAtK=93.1%, ndcgAtK=88.4%, explainabilityRate=100.0% |
| temporal | 5 | yes | exactAnswerAccuracy=100.0%, evidenceCorrectness=100.0%, temporalDisambiguationRate=100.0% |
| identity | 8 | yes | recallAtK=100.0%, mrrAtK=100.0%, ambiguitySafePrecision=100.0%, falseMergeRate=0.0% |
| provenance | 6 | yes | sourceHitRate=100.0%, exactEvidenceMatch=100.0%, unsupportedClaimRefusalRate=100.0%, overclaimRate=0.0% |
| contradictions | 3 | yes | contradictionDetectionRate=100.0%, correctWinnerSelectionRate=100.0%, uncertaintyPreservationRate=100.0%, falseCertaintyRate=0.0% |
| fuzzy | 6 | yes | recallAtK=100.0%, mrrAtK=91.7%, explanationAvailability=100.0%, confidenceCalibration=100.0% |

## Retrieval Failures

- `q-leadership-attendees`: Retrieval result was empty or lacked explainable matched fields.
