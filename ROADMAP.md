# Roadmap

This roadmap is intentionally short and practical. Recall is early, and the next milestones focus on trust, reproducibility, and memory quality.

## v1.3 Trust And Reproducibility (done)

- Local-only behavior, fail-closed.
- Unit/integration tests for database, FTS, embeddings, file index, import/export.
- Benchmark harness with reproducible scenarios.
- Token savings tracker with real-time metrics.
- Migrated to WebAssembly SQLite (universal cross-platform).

## v1.4 Memory Quality

- Make ranking weights visible and configurable.
- Add stale-file detection for file index entries.
- Add memory conflict and superseded-by workflows.
- Improve cross-project result labeling and filtering.

## v1.5 Workflow Polish

- Add guided first-run setup.
- Improve dashboard review flows.
- Add richer diagnostics for missing model files and native dependencies.
