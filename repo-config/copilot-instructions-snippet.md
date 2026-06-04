## Recall Memory Tools

You have access to four Recall tools: `recall_search`, `recall_save`, `recall_file_index`,
and `recall_ask`.
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

### When to Ask (recall_ask)

- Call `recall_ask` the MOMENT you are unsure about intent, scope, a convention,
  a requirement, or which of several valid approaches to take — BEFORE guessing
  or reading files to infer the answer
- Provide 2-5 concrete, mutually-exclusive options; a custom-answer entry is added
  automatically so the developer can type their own answer
- The returned answer is ground truth — proceed immediately, do not re-question it
- Set `reusable: true` for durable decisions (architecture, conventions, design
  intent) so the answer is saved as verified memory; `false` for one-off answers
- If the developer dismisses the prompt, proceed with your best judgment and state
  the assumption you are making
- Do NOT ask trivial things you can answer yourself by searching memory or the file
  index first

Asking one question is far cheaper than spinning on an assumption, reading files to
confirm it, and double-backing when it turns out wrong.

### When to Save (recall_save)

**Save incrementally at each milestone — do NOT batch into one save at the end.**
A typical investigation should produce 2-5 observations. Save the moment you learn
something durable:

- After mapping how a subsystem works (architecture)
- After confirming or disproving a hypothesis
- After discovering a cross-file dependency or data flow
- After finding a non-obvious contract, side effect, or ordering constraint
- After identifying a bug root cause and the fix
- After a `recall_ask` answer is marked reusable (auto-handled)

**Format:** Use the `kind` field and structured content:

```
recall_save({
  "content": "[WHAT] one-line claim. [WHERE] file, function, line. [WHY] reason this matters.",
  "kind": "architecture",
  "tags": "auth,architecture"
})
```

**Kind categories:** `architecture`, `bugfix`, `gotcha`, `dataflow`, `contract`,
`hypothesis`, `decision`

**Examples:**
- `"kind": "architecture"` — how components connect, singleton patterns, shared state
- `"kind": "gotcha"` — non-obvious traps (idempotency, ordering, silent failures)
- `"kind": "dataflow"` — how data flows across files (A → B → C)
- `"kind": "bugfix"` — root cause + what fixed it
- `"kind": "decision"` — design choice and rationale

DO NOT SAVE:
- Obvious facts the file index already captures (function names, line numbers)
- Speculative guesses you have not confirmed
- Build/git results (passive capture handles those)
- Vague text like "fixed auth bug" — name file, function, line, and WHY

**Tags:** Always include tags. Use module name + kind category.
Categories: `bugfix`, `architecture`, `gotcha`, `dataflow`, `performance`,
`config`, `concurrency`, `contract`, `decision`

### Memory Trust

- Observations marked `✓ verified` are trusted facts — act on them without re-reading code
- Observations marked `⏳ pending` are unconfirmed — read the relevant code to verify before acting; do NOT treat them as facts
- If you act on a pending observation and confirm it was correct, note this so the engineer can verify it
