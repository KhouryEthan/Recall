---
description: "Seed Recall memory for a module or subsystem — build file index and baseline observations"
mode: "agent"
tools: ["read_file", "grep_search", "file_search", "recall_save", "recall_file_index", "run_in_terminal"]
---

# Task: Seed Recall Memory

For each source file in the target module or directory:
1. Read the file
2. Save a file index entry with: one-sentence summary, all function/class/type
   names with line numbers and brief descriptions
3. Save an observation summarizing: what this file does, how it connects to
   neighboring files, key data structures, public API surface, and known
   patterns or gotchas

## Rules
- Do NOT claim bugs are fixed or suggest fixes — this is pure documentation
- All observations should be factual descriptions of existing code, not analysis
- Tag observations with the module/directory name and "architecture"
- Focus on what would be expensive to rediscover: data flow, state machines,
  inter-component dependencies, configuration and environment requirements
- Include API endpoints, event handlers, or exported interfaces where applicable

## Target Module
{{input}}
