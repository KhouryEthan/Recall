---
description: "Recall memory workflow for source files"
applyTo: "**"
---

## Recall Workflow

Follow this order for every source file task.

### 1. Before reading a file → call `recall_file_index`

```
recall_file_index({ "query": "authService.ts" })
```

Use the returned line numbers to read only the function you need.
Skip this only if the file is not a source file (e.g., JSON config, markdown).

### 2. Before editing or investigating → call `recall_search`

```
recall_search({ "query": "getAccessToken refresh race condition", "tags": "auth" })
```

Extract 2-6 keywords from the task: function name + module + symptom.
Do not pass the full user message as the query.

If results come back:
- `✓ verified` → act on it, skip redundant file reads
- `⏳ pending` → verify by reading the code before acting

### 3. After completing non-trivial work → call `recall_save`

```
recall_save({
  "content": "Race condition in authService.ts getAccessToken() L142: concurrent calls all pass the expiry check before any refresh completes. Fix: added mutex around refresh block.",
  "tags": "auth,bugfix,concurrency"
})
```

Save after: fixing a bug, discovering a non-obvious contract, mapping cross-file data flow, confirming or disproving a hypothesis.

Do not save: obvious facts the file index already has, build results, git commits, unconfirmed guesses.

### What not to do

- Reading a whole file when `recall_file_index` already has line numbers for the function you need
- Editing code without checking `recall_search` first — a prior fix may already exist
- Finishing an investigation without calling `recall_save` — the knowledge is lost next session
- Passing vague queries like "auth bug" instead of specific terms like "getAccessToken refresh race condition"
