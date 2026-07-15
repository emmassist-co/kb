# KB Eval Scorecard

Generated: 2026-07-15T09:46:42.438Z
Corpus: `kb-core-six`
Provenance: `deterministic-synthetic-fixtures`
Suite: `kb:core-six`

Overall passed: yes
## Policy

- optimize on: `admin-world-v3 dev`
- confirm on: `admin-world-v3 holdout`
- regression guardrails: `core-six dev`, `core-six holdout`, `relation-paraphrase-v1`, `relation-transfer-v1`
- external reference: `gbrain-world:github-benchmark`
- note: Optimize on product-core admin-world retrieval quality.
- note: Use deterministic core-six categories as regression floors.
- note: Keep anti-cheat relation paraphrase and prose-only transfer rails green before making product-general relation-quality claims.
- note: Keep the exact GBrain GitHub benchmark contract as an external comparison rail rather than a direct ship target.
- note: The GBrain comparison uses the same upstream runner, 240-page corpus, 145 public queries, top-k, and returned-denominator scorer; KB runtime/scoring remains benchmark-metadata-blind.

Category pass rate: 100.0%

| Category | Cases | Passed | Metrics |
| --- | ---: | :---: | --- |
| retrieval | 72 | yes | precisionAtK=30.6%, returnedPrecisionAtK=33.8%, fixedPrecisionAtKCeiling=31.7%, recallAtK=96.5%, mrrAtK=89.7%, ndcgAtK=87.3%, explainabilityRate=100.0% |
| temporal | 5 | yes | exactAnswerAccuracy=100.0%, evidenceCorrectness=100.0%, temporalDisambiguationRate=100.0% |
| identity | 8 | yes | recallAtK=100.0%, mrrAtK=100.0%, ambiguitySafePrecision=100.0%, falseMergeRate=0.0% |
| provenance | 6 | yes | sourceHitRate=100.0%, exactEvidenceMatch=100.0%, unsupportedClaimRefusalRate=100.0%, overclaimRate=0.0% |
| contradictions | 3 | yes | contradictionDetectionRate=100.0%, correctWinnerSelectionRate=100.0%, uncertaintyPreservationRate=100.0%, falseCertaintyRate=0.0% |
| fuzzy | 6 | yes | recallAtK=100.0%, mrrAtK=91.7%, explanationAvailability=100.0%, confidenceCalibration=100.0% |
