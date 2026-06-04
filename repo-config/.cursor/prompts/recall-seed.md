# Seed Recall Memory

Use this prompt to build baseline memory for a module or subsystem you work in frequently.
Paste this into a Cursor chat (Agent mode) and replace `<target>` with the module path or name.

---

For each source file in `<target>`:

1. Call `recall_file_index` to check if it's already indexed. If not, read the file and index it.
2. Call `recall_save` with an architectural observation covering:
   - What this file does in one sentence
   - How it connects to neighboring files (data flow, dependencies)
   - Key data structures, public API surface, exported interfaces
   - Non-obvious patterns, gotchas, or ordering constraints worth remembering

Use `kind: "architecture"` and tag with the module name + `architecture`.

## Rules

- Do NOT suggest fixes or claim bugs are fixed — this is pure documentation
- All observations must be factual descriptions of existing code
- Focus on what would be expensive to rediscover: state machines, inter-component
  dependencies, configuration requirements, event flow
- A typical module seeding session should produce one observation per file

## Example

```
recall_save({
  "content": "[WHAT] authService.ts manages token lifecycle for all API calls. [WHERE] src/auth/authService.ts. [WHY] All callers share one singleton — bypassing it creates duplicate refresh races.",
  "kind": "architecture",
  "tags": "auth,architecture"
})
```
