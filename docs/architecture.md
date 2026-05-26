# Architecture

Recall is a VS Code extension that exposes local developer memory to Copilot through VS Code Language Model Tools.

## Main Components

- `src/extension.ts`: extension activation, command registration, passive capture, and tool registration.
- `src/db.ts`: SQLite storage, FTS5 indexes, observations, file indexes, import/export, and embedding storage.
- `src/search.ts`: hybrid search that merges FTS5 keyword results with local embedding similarity.
- `src/fileIndex.ts`: source-file indexing through VS Code document symbols plus regex fallback.
- `src/tools/`: Copilot-facing `recall_search`, `recall_save`, and `recall_file_index` tools.
- `src/sidebarProvider.ts`: dashboard webview.

## Trust States

- `verified`: user-created observations and objective passive events.
- `pending`: Copilot-created observations that need human review.
- `rejected`: observations removed from normal search results.

Pending memories are intentionally visible as pending so users and agents do not treat unverified model conclusions as facts.
