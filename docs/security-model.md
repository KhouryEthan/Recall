# Security Model

Recall assumes memory entries can influence future AI-assisted coding decisions, so trust state and locality are core security boundaries.

## Boundaries

- The SQLite database is local to the user's machine.
- Recall does not provide remote sync.
- Recall does not execute stored memories as code.
- Copilot-generated observations are saved as pending until reviewed.

## Risks

- Stale or incorrect memories can lead to bad code changes.
- Cross-project memories may not apply to the current repository.
- A compromised local machine can read the SQLite database.

## Mitigations

- Pending trust state for AI-captured observations.
- Rejected observations are excluded from search.
- Cross-project results are labeled in tool output.
- Import/export should be treated like source code: review before sharing or importing.
