## Recall Memory Tools

Three tools for persistent developer memory. Use them in this order on every source file task.

### 1. `recall_file_index` — before reading any source file

Look up the file's symbol map (functions, classes, line numbers) before calling `read_file`.
Use the returned line numbers to read only the specific function you need.

```
recall_file_index({ "query": "authService.ts" })
```

If the file is not indexed, read it normally — it will be indexed on next save.
Do not use this for searching bug fixes or prior knowledge — use `recall_search` for that.

### 2. `recall_search` — before editing or investigating

Search persistent memory for prior fixes, architectural decisions, and recorded gotchas.

```
recall_search({ "query": "getAccessToken refresh race condition", "tags": "auth" })
```

**When to search:** bug reports, before modifying a function, when asked how something works, before refactoring.

**Query format:** 2-6 keywords — function name + module + symptom. Not the full user message.

**Reading results:**
- `✓ verified` = engineer-confirmed fact. Act on it without re-reading code.
- `⏳ pending` = AI-captured, unverified. Read the code to confirm before acting.
- `[from: ProjectX]` = cross-project result. Check applicability before using.

Do not use this for looking up file structure or line numbers — use `recall_file_index` for that.

### 3. `recall_save` — after completing significant work

Record what you learned so it can be recalled in future sessions.

```
recall_save({
  "content": "Race condition in authService.ts getAccessToken() L142: concurrent calls all pass expiry check before any refresh completes. Fix: added mutex around refresh block.",
  "tags": "auth,bugfix,concurrency"
})
```

**When to save:** identified a root cause, discovered a non-obvious API contract, mapped cross-file data flow, confirmed/disproved a hypothesis, completed a refactor.

**Quality:** name the file, function, and line number. Explain the *why*, not just the *what*.

**Do not save:** obvious code facts (file index captures those), build results (passive capture handles those), git commits (passive capture handles those), unconfirmed guesses.
