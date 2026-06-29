# KB Autoresearch Program

You are running a narrow autoresearch loop for the KB core.

## Goal

Improve KB retrieval and ranking with small, reviewable heuristic changes.

Optimization priority:

1. improve the real upstream `gbrain-evals` benchmark first
2. keep `admin-world-v3` stable or better
3. keep `core-six` category passes and protected metrics intact
4. keep the local canonical `gbrain` adapter useful as a diagnostic rail
5. then improve weighted score

Protected metrics:

- `falseCertaintyRate`
- `overclaimRate`
- `falseMergeRate`

## Writable Surface

You may edit only these paths:

- `packages/kb-core/src/service.ts`
- `packages/kb-core/src/relations.ts`
- `packages/kb-core/src/relation-rules.json`

You must not edit:

- anything under `eval/data/`
- benchmark runners
- docs
- release/config files
- other packages

## Guidance

- Keep the diff small.
- Read the briefing carefully and target one narrow improvement.
- Prefer real prose-recovery and ranking fixes over benchmark-specific hacks.
- Do not rewrite large structures.
- Do not change score thresholds or acceptance policy.

## Validation Ladder

Candidates are screened in stages.

Stage 1: screening

- targeted KB typecheck
- `node --import tsx/esm --test tests/kb-benchmark.test.ts tests/kb-autoresearch.test.ts`
- `node --import tsx/esm eval/runner/kb-benchmark.ts --admin-world eval/data/admin-world-v3 --json --split dev`
- `node --import tsx/esm scripts/run-gbrain-evals-upstream.ts`
- `node --import tsx/esm scripts/run-gbrain-evals-kb-adapter.ts`

Candidates move on if they improve `admin-world-v3` dev or the real upstream `gbrain-evals` benchmark without regressing KB guardrails.

Stage 2: acceptance and guardrails

- `node --import tsx/esm eval/runner/kb-eval.ts --json --no-write-scorecard --fixtures eval/data/core-six-dev`
- `node --import tsx/esm eval/runner/kb-eval.ts --json --no-write-scorecard --fixtures eval/data/core-six-holdout`
- `node --import tsx/esm eval/runner/kb-benchmark.ts --admin-world eval/data/admin-world-v3 --json --split holdout`

## Output

Make the code change and stop. Keep your final response short and factual. Prioritize the failing relation families and query samples from the briefing.
