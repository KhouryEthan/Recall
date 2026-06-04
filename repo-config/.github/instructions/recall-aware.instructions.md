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

### 3. Save at each milestone → call `recall_save` incrementally

Do NOT batch all observations into one save at the end. Save the moment you
learn something durable — a typical investigation should produce 2-5 observations.

**When to save (milestones):**
- After mapping how a subsystem works (architecture)
- After confirming or disproving a hypothesis
- After discovering a cross-file dependency or data flow
- After identifying a non-obvious contract or side effect
- After finding a bug root cause and determining the fix
- After a user answers a `recall_ask` question (auto-handled if reusable=true)

**Format:** Use the `kind` field and structured content:

```
recall_save({
  "content": "[WHAT] AuthService refreshes through a shared singleton; all callers await the same promise. [WHERE] src/auth/authService.ts refreshToken() L89. [WHY] Bypassing this creates duplicate refresh races.",
  "kind": "architecture",
  "tags": "auth,architecture"
})
```

**Kind categories:** `architecture`, `bugfix`, `gotcha`, `dataflow`, `contract`,
`hypothesis`, `decision`

**More examples:**
```
recall_save({
  "content": "[WHAT] Webhook handler must be idempotent — Stripe sends duplicates. [WHERE] src/payments/webhook.ts handleEvent() L34. [WHY] Without dedup, charges double on retry.",
  "kind": "gotcha",
  "tags": "payments,gotcha"
})
```

```
recall_save({
  "content": "[WHAT] User permissions flow: JWT claims → middleware → req.user → route guard. [WHERE] src/middleware/auth.ts → src/guards/role.ts. [WHY] Adding a new role requires changes in both files.",
  "kind": "dataflow",
  "tags": "auth,dataflow"
})
```

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
