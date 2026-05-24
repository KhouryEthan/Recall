---
description: "Audit Recall memory — review stale observations, clean up, verify pending"
mode: "agent"
tools: ["recall_search", "recall_save", "recall_file_index", "read_file", "grep_search"]
---

# Task: Audit Recall Memory

1. Run `@recall pending` to review all unverified observations
2. For each pending observation, check whether the code still reflects it
3. Run `@recall recent --days 30` and identify observations that may be outdated
   (e.g., files that have been significantly refactored since the observation)
4. Report findings — do not delete anything without engineer confirmation
