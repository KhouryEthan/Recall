# Benchmark Methodology

Recall benchmark claims should be reproducible from committed scenarios and raw measurement notes.

## What To Measure

- Baseline files read without Recall.
- Recall tool outputs read by Copilot.
- Targeted file ranges read after `recall_file_index`.
- Wall-clock time to first useful answer.
- Number of grep/search calls.

## Token Estimate

The initial harness uses:

```text
estimated_tokens = ceil(characters / 4)
```

This should be replaced or supplemented with model-specific tokenization when publishing final claims.

## Publication Rule

Do not publish a percentage reduction unless the scenario JSON, task prompt, repository revision, and raw read counts are committed or linked.
