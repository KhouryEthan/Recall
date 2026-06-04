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

**ALWAYS save incrementally at each milestone — NEVER batch into one save at the end.**
A typical investigation MUST produce 2-5 observations. Save the MOMENT you learn
something durable — do not wait until you are done.

**CRITICAL RULES:**

1. **One claim per observation. ALWAYS.** If your `[WHAT]` is more than one sentence,
   you MUST split it into separate observations. Each observation must be findable by
   a single focused search query. A multi-paragraph observation dilutes the embedding
   and becomes unfindable.

2. **Split architecture from bugfix. ALWAYS.** If you discover how a system works AND
   find a bug in it, that is TWO observations (one architecture, one bugfix), not one.

3. **Save DURING the investigation, not after.** The moment you understand how a
   subsystem works — BEFORE you find the bug — save the architecture observation.
   Do not wait until the end.

**When to save (milestones):**
- IMMEDIATELY after mapping how a subsystem works (architecture)
- IMMEDIATELY after confirming or disproving a hypothesis
- IMMEDIATELY after discovering a cross-file dependency or data flow
- IMMEDIATELY after finding a non-obvious contract, side effect, or ordering constraint
- IMMEDIATELY after identifying a bug root cause and the fix
- After a `recall_ask` answer is marked reusable (auto-handled)

**Format:** Use the `kind` field. `[WHAT]` MUST be a single sentence.

```
recall_save({
  "content": "[WHAT] one-line claim. [WHERE] file, function, line. [WHY] reason this matters.",
  "kind": "architecture",
  "tags": "auth,architecture"
})
```

**Correct example (split into two):**
```
// First: the architectural fact (saved DURING investigation)
recall_save({
  "content": "[WHAT] output_data[] is indexed by MMC model ID, not VIS slot index — these index spaces are independent. [WHERE] mmc_dis.cpp L230-L310. [WHY] Any code reading output_data by loop counter instead of model ID will read the wrong entity.",
  "kind": "architecture",
  "tags": "vis,mmc,architecture"
})

// Second: the bugfix (saved AFTER confirming the fix)
recall_save({
  "content": "[WHAT] entity_type misclassification: LINK_TRAINER read as TCAS because output_data indexed by VIS slot (i) instead of MMC model ID (id). [WHERE] vis_inst.cpp mmc_model_callback() L399-L452. [WHY] Fix: replace output_data[i] with output_data[id] in model_is_new block.",
  "kind": "bugfix",
  "tags": "vis,mmc,bugfix"
})
```

**WRONG (do NOT do this):**
```
// BAD: multiple sentences in [WHAT], mixes architecture + bugfix + example
recall_save({
  "content": "[WHAT] vis_inst.cpp mmc_model_callback indexes output_data[i] using VIS slot instead of MMC model ID. These indices are independent — entity with MMC id=5 may land in VIS slot 0, so output_data[0].type is read instead of output_data[5].type. [WHERE] ... [WHY] ...",
  "kind": "bugfix",
  "tags": "vis,mmc,bugfix"
})
```

**Kind categories:** `architecture`, `bugfix`, `gotcha`, `dataflow`, `contract`,
`hypothesis`, `decision`

DO NOT SAVE:
- Obvious facts the file index already captures (function names, line numbers)
- Speculative guesses you have not confirmed
- Build/git results (passive capture handles those)
- Vague text like "fixed auth bug" — name file, function, line, and WHY

**Tags:** Always include tags. Use module name + kind category.

### Memory Trust

- Observations marked `✓ verified` are trusted facts — act on them without re-reading code
- Observations marked `⏳ pending` are unconfirmed — read the relevant code to verify before acting; do NOT treat them as facts
- If you act on a pending observation and confirm it was correct, note this so the engineer can verify it
