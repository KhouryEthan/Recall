---
description: "Recall memory workflow for source files"
applyTo: "**"
---

## Recall Workflow

Follow this order for every source file task.

### 0. Before investigating any subsystem → broad context search FIRST

Before forming a hypothesis or running any symptom-focused search, run a broad
architectural search using only the subsystem name. Retrieve what is already
known before searching for what is suspected.

```
recall_search({ "query": "auth architecture" })
recall_search({ "query": "payments dataflow" })
```

Only after reading the architectural results should you run a symptom-focused
query. Memory stores **what was learned**, not **what you're guessing**, so a
search written entirely in terms of the symptom you're investigating will
usually miss prior context.

### 1. Before reading a file → call `recall_file_index`

```
recall_file_index({ "query": "authService.ts" })
```

Use the returned line numbers to read only the function you need.
Skip this only if the file is not a source file (e.g. JSON config, markdown).

### 2. Before editing or investigating → call `recall_search`

Use a two-tier query strategy.

**Tier 1 — Context queries (run FIRST when entering a new subsystem):**
- Format: `"<module> architecture"` or `"<module> dataflow"`
- Purpose: surface what is already known about how the system works
- Examples: `"auth architecture"`, `"renderer dataflow"`, `"scheduler gotchas"`

**Tier 2 — Symptom queries (run AFTER context is established):**
- Format: `<function> <module> <symptom keyword>`
- Purpose: find previously-seen bugs matching the current symptom
- Examples: `"getAccessToken refresh race condition"`, `"render_frame flicker vsync"`

Always run a Tier 1 query before a Tier 2 query the first time you touch a
subsystem in a session.

### 2b. When unsure → call `recall_ask` instead of assuming

If you are uncertain about intent, scope, a convention, or which of several valid
approaches to take, do NOT guess and do NOT read extra files to infer the answer.
Ask the developer directly:

```
recall_ask({
  "question": "Should retries use exponential backoff or a fixed delay?",
  "options": ["Exponential backoff", "Fixed delay"],
  "reusable": true,
  "tags": "retry,architecture"
})
```

- Provide 2-5 concrete options. A custom-answer entry is added automatically.
- The returned answer is ground truth — proceed immediately, do not re-question it.
- Set `reusable: true` for durable decisions (architecture, conventions, intent)
  so they are saved as verified memory; `false` for one-off, task-local answers.
- If the developer dismisses the prompt, proceed with your best judgment and
  state the assumption you are making.

Asking one question is far cheaper than spinning on an assumption, reading files
to confirm it, and double-backing when the assumption turns out wrong.

### 3. ALWAYS save at each milestone → call `recall_save` incrementally

NEVER batch all observations into one save at the end. ALWAYS save the moment you
learn something durable. A typical investigation MUST produce 2-5 observations.

**CRITICAL RULES:**

1. **One claim per observation. ALWAYS.** If your `[WHAT]` is more than one sentence,
   you MUST split it into separate observations. Multi-sentence observations dilute
   the embedding vector and become unfindable by semantic search.

2. **ALWAYS split architecture from bugfix.** If you discover how a system works AND
   find a bug in it, that is TWO observations (one architecture, one bugfix), not one.

3. **ALWAYS save DURING the investigation, not after.** The moment you understand how
   a subsystem works — BEFORE finding the bug — save the architecture observation
   immediately. Do not wait.

**When to save (milestones):**
- IMMEDIATELY after mapping how a subsystem works (architecture)
- IMMEDIATELY after confirming or disproving a hypothesis
- IMMEDIATELY after discovering a cross-file dependency or data flow
- IMMEDIATELY after identifying a non-obvious contract or side effect
- IMMEDIATELY after finding a bug root cause and determining the fix
- After a user answers a `recall_ask` question (auto-handled if reusable=true)

**Format:** Use the `kind` field. `[WHAT]` MUST be a single sentence.

```
// Save #1: architecture fact (saved DURING investigation, before finding bug)
recall_save({
  "content": "[WHAT] output_data[] is indexed by MMC model ID, not by loop counter — VIS slot and MMC ID are independent index spaces. [WHERE] mmc_dis.cpp L230-L310. [WHY] Any code reading output_data by loop index reads the wrong entity.",
  "kind": "architecture",
  "tags": "vis,mmc,architecture"
})

// Save #2: the bugfix (saved AFTER confirming root cause)
recall_save({
  "content": "[WHAT] entity_type misclassification: LINK_TRAINER classified as TCAS because output_data indexed by VIS slot instead of MMC model ID. [WHERE] vis_inst.cpp mmc_model_callback() L399-L452. [WHY] Fix: replace output_data[i] with output_data[id] in model_is_new block.",
  "kind": "bugfix",
  "tags": "vis,mmc,bugfix"
})
```

**WRONG (NEVER do this):**
```
// BAD: multiple sentences in [WHAT], mixes architecture + bugfix + example in one
recall_save({
  "content": "[WHAT] vis_inst.cpp mmc_model_callback indexes output_data[i] using VIS slot instead of MMC model ID. These indices are independent — entity with id=5 may land in slot 0. [WHERE] ... [WHY] ...",
  "kind": "bugfix",
  "tags": "vis,mmc,bugfix"
})
```

**Kind categories:** `architecture`, `bugfix`, `gotcha`, `dataflow`, `contract`,
`hypothesis`, `decision`

**Do NOT save:** obvious facts the file index already has, build results, git
commits, unconfirmed guesses, or vague text like "fixed auth bug."

## Retry rules — never conclude "no prior knowledge" from a single miss

If `recall_search` returns 0 results, do NOT proceed as if no memory exists.
Run at least 2-3 different queries before giving up:

1. **Broaden the query.** Drop specific symptom words, keep the subsystem name.
2. **Try tags only or with a short query.** Use broad category tags that were
   likely used at save time (e.g. `tags: "auth,architecture"`), not narrow
   symptom tags (e.g. `tags: "auth,redirect,loading"`).
3. **Climb the parent module.** If `"auth refreshToken"` finds nothing, try
   `"auth architecture"`.

Only after 3 distinct failed attempts should you proceed without recall
context, and note the misses explicitly in your reasoning.

## Anti-patterns (do not do these)

**Symptom-only queries:**
```
BAD:  "page not loading after login redirect"
BAD:  "token undefined when refreshing session"
```
These fail because memory stores what was learned, not what you're guessing.

**Single-attempt searches:**
```
BAD:  search once → 0 results → proceed without memory context
```

**Over-narrow tag filters:**
```
BAD:  tags: "auth,redirect,loading"      (observation may not have "redirect" tag)
GOOD: tags: "auth,architecture"          (broad category tags used at save time)
```

## What not to do

- Reading a whole file when `recall_file_index` already has line numbers for
  the function you need
- Editing code without checking `recall_search` first — a prior fix may already exist
- Finishing an investigation without calling `recall_save` — the knowledge is
  lost next session
- Passing vague queries like `"auth bug"` instead of specific terms like
  `"getAccessToken refresh race condition"`
- Concluding "nothing in memory" after a single failed search (see Retry rules)
