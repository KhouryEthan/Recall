## Recall Memory Tools

You have access to three Recall tools: `recall_search`, `recall_save`, and `recall_file_index`.
These apply to ALL source files regardless of language (C/C++, Python, JS/TS, Rust, Go, etc.).

### When to Use File Index (recall_file_index)

- ALWAYS check the file index before calling `read_file` on any source file
- If the index has the file, read ONLY the specific function(s) you need using
  the line numbers from the index
- If the index does NOT have the file, read the file normally (it will be indexed
  on the next save)
- Never read a full file when the index already gives you a function listing
- Attachment content is NOT a substitute — check the index even if the file is
  already visible in the conversation
- Do NOT use this for searching bug fixes or prior knowledge — use `recall_search` for that

### When to Search (recall_search)

- ALWAYS search FIRST when the user asks about a bug, problem, subsystem, or past decision — before reading any files
- ALWAYS search before reading a source file larger than 500 lines
- ALWAYS search before editing or refactoring any function

**Two-tier query strategy.** Memory stores what was *learned*, not what you are *guessing*.
Symptom-only queries usually miss the architectural notes that would unblock you.

- **Tier 1 — context first** (run when entering a new subsystem or starting a new investigation):
  Use only the subsystem/module name + a broad category word.
  Examples: `"auth architecture"`, `"renderer dataflow"`, `"payments gotchas"`

- **Tier 2 — symptom next** (run after Tier 1 context is established):
  Use function name + module name + symptom keywords.
  Examples: `"getAccessToken refresh race condition"`, `"render_frame flicker vsync"`

Do NOT write queries entirely in terms of the symptom you are investigating:
  BAD: `"page not loading after login redirect"`
  GOOD: `"auth architecture"` then `"auth refreshToken redirect loop"`

**Retry on misses.** If search returns 0 results:
1. Retry with a BROADER query — drop symptom words, keep subsystem name
2. Retry with different tags or no tags at all
3. Retry with the parent subsystem name

Do NOT conclude "no prior knowledge exists" after a single failed search.
Run at least 2-3 different queries before proceeding without recall context.

**Reading results:**
- `✓ verified` = engineer-confirmed fact. Trust it and skip redundant file reads.
- `⏳ pending` = AI-captured, unverified. Treat as hypothesis — read the code to confirm before acting.
- `[from: ProjectX]` = cross-project result. Check applicability before using.
- If search returns nothing after retries, proceed normally and save after you learn something.

Do NOT use this for looking up file structure or line numbers — use `recall_file_index` for that.

### When to Save (recall_save)

SAVE when you discover:
- A bug root cause (what caused it and why)
- A successful fix (what was changed and what it solved)
- An architectural insight (how components connect, data flow, timing dependencies)
- A non-obvious gotcha (e.g. "builds pass but this is a behavioral bug, not a build error")
- Cross-file data flow or dependencies that took multiple reads to understand
- A confirmed or disproved hypothesis

DO NOT SAVE:
- Obvious code facts that the file index already captures (function names, line numbers)
- Speculative guesses you have not confirmed
- Build pass/fail results (passive capture handles this automatically)
- Git commit info (passive capture handles this automatically)
- Observations that duplicate what is already in memory — search first
- Vague text like "fixed auth bug" — name the file, function, line, and WHY

**Quality:** Every observation should name the file, function, and line number.
Explain the *why*, not just the *what*. Future sessions will only find this if
it contains the right keywords and meaning.

**Tags:** Always include tags when saving. Use subsystem name + category.
Categories: `bugfix`, `architecture`, `gotcha`, `dataflow`, `performance`, `config`, `concurrency`

### Memory Trust

- Observations marked `✓ verified` are trusted facts — act on them without re-reading code
- Observations marked `⏳ pending` are unconfirmed — read the relevant code to verify before acting; do NOT treat them as facts
- If you act on a pending observation and confirm it was correct, note this so the engineer can verify it
