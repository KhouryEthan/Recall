# Audit Recall Memory

Use this prompt monthly (or after a large refactor) to clean up stale observations.
Paste into a Cursor chat (Agent mode).

---

1. Run `@recall pending` to list all unverified observations
2. For each pending observation, check whether the code still reflects it — verify or discard
3. Run `@recall recent --days 30` and identify observations that may be outdated
   (files significantly refactored since the observation was saved)
4. Report findings — do not delete anything without explicit confirmation
