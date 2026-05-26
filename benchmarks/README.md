# Recall Benchmarks

This folder is for reproducible measurements, not marketing estimates.

The current harness estimates token usage from recorded character counts using `ceil(characters / 4)`. That is intentionally simple and conservative enough for first-pass comparisons, but published benchmark claims should include the raw files or logs used to produce the counts.

## Run

```bash
npm run benchmark:estimate
```

## Method

1. Pick one task and one repository state.
2. Record the files and character counts read by a baseline Copilot workflow without Recall.
3. Record the Recall tool outputs and targeted file ranges read by the Recall-assisted workflow.
4. Add both sets to a scenario JSON file in `benchmarks/scenarios/`.
5. Run the estimator and commit the raw scenario alongside the result.

Do not publish percentage claims from the sample scenario. Replace it with measured data from an actual task first.
