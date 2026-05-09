# KB Eval Scorecard

Generated: 2026-05-08T11:42:24.012Z
Corpus: `kb-core-six`
Provenance: `deterministic-synthetic-fixtures`
Suite: `kb:core-six`

Overall passed: yes
Category pass rate: 100.0%

| Category | Cases | Passed | Metrics |
| --- | ---: | :---: | --- |
| retrieval | 72 | yes | precisionAtK=30.0%, recallAtK=94.4%, mrrAtK=93.1%, ndcgAtK=88.4%, explainabilityRate=100.0% |
| temporal | 3 | yes | exactAnswerAccuracy=100.0%, evidenceCorrectness=100.0%, temporalDisambiguationRate=100.0% |
| identity | 5 | yes | recallAtK=100.0%, mrrAtK=100.0%, ambiguitySafePrecision=100.0%, falseMergeRate=0.0% |
| provenance | 4 | yes | sourceHitRate=100.0%, exactEvidenceMatch=100.0%, unsupportedClaimRefusalRate=100.0%, overclaimRate=0.0% |
| contradictions | 2 | yes | contradictionDetectionRate=100.0%, correctWinnerSelectionRate=100.0%, uncertaintyPreservationRate=100.0%, falseCertaintyRate=0.0% |
| fuzzy | 4 | yes | recallAtK=100.0%, mrrAtK=87.5%, explanationAvailability=100.0%, confidenceCalibration=100.0% |

## Retrieval Failures

- `q-leadership-attendees`: Retrieval result was empty or lacked explainable matched fields.
