# Architecture

Recall is a VS Code extension that exposes local developer memory to Copilot through VS Code Language Model Tools.

## Main Components

- `src/extension.ts`: extension activation, command registration, passive capture, and tool registration.
- `src/db.ts`: SQLite storage via sql.js (WebAssembly), FTS5 indexes, observations, file indexes, import/export, and embedding storage.
- `src/embeddingBlob.ts`: versioned binary format for embedding vectors.
- `src/ftsQuery.ts`: FTS5 query sanitization with prefix matching.
- `src/tokenTracker.ts`: tracks tokens consumed vs tokens saved by Recall tool calls.
- `src/search.ts`: hybrid search that merges FTS5 keyword results with local embedding similarity.
- `src/fileIndex.ts`: source-file indexing through VS Code document symbols plus regex fallback.
- `src/tools/`: Copilot-facing `recall_search`, `recall_save`, and `recall_file_index` tools.
- `src/sidebarProvider.ts`: dashboard webview.

## Storage

Recall uses `fts5-sql-bundle`, which is SQLite compiled to WebAssembly with FTS5 enabled. This runs identically on every platform (Windows, macOS, Linux, ARM, x64, Remote SSH, WSL, Codespaces) without native binaries.

The database is loaded into memory on activation and persisted to disk after mutations.

## Trust States

- `verified`: user-created observations and objective passive events.
- `pending`: Copilot-created observations that need human review.
- `rejected`: observations removed from normal search results.

Pending memories are intentionally visible as pending so users and agents do not treat unverified model conclusions as facts.
