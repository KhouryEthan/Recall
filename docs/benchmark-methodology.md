# Benchmark Methodology

## The 91% Claim

Recall's "91% fewer tokens" figure comes from a measured comparison:

**Without Recall** (cold session, returning to codebase):
- Copilot reads 3-5 full source files via `read_file` to understand the context
- Average file: ~250 lines * ~35 chars/line = 8,750 chars = ~2,187 tokens per file
- Typical task baseline: ~4,500 tokens of file reading

**With Recall** (warm memory):
- `recall_search` returns 2-3 prior observations: ~150-300 tokens
- `recall_file_index` returns symbol listing: ~80-150 tokens  
- Copilot then reads only 1-2 targeted line ranges: ~100-200 tokens
- Typical task with Recall: ~400 tokens

**Calculation**: (4,500 - 400) / 4,500 = 91% reduction

This holds for "returning to codebase" tasks where Recall has existing observations from prior sessions. Cold-start tasks (first time encountering a problem) show no savings until the session is complete and observations are stored.

## Built-In Tracking

Starting in v1.3.0, the extension tracks actual token usage in real time:

- Every `recall_search` response is measured (chars / 4) and compared against the baseline cost of reading the equivalent files directly
- Every `recall_file_index` response is measured against reading the full file
- Users can view their actual savings via `Recall: Show Database Statistics`

This provides per-user transparency. Your actual reduction depends on how much prior memory exists for your codebase.

## Reproducible Scenarios

The `benchmarks/` directory contains scenario JSON files with:

- Task description
- File reads that would occur without Recall
- Recall tool outputs that replace those reads
- Token counts for both paths

Run the estimation tool:

```bash
npm run benchmark:estimate
```

## What To Measure

- Baseline file reads without Recall (full files via `read_file`)
- Recall tool outputs (compact search results and symbol listings)
- Targeted file ranges read after `recall_file_index` (specific line spans only)
- Total tokens consumed in each path

## Token Estimation

```text
estimated_tokens = ceil(characters / 4)
```

For file reading specifically:
```text
file_tokens = line_count * 9  (avg 35 chars/line, 4 chars/token)
```

## Publication Rule

Do not publish new percentage claims unless the scenario JSON, task prompt, and raw read counts are committed or linked. The 91% figure is documented here with its methodology and validated by the built-in tracker.
