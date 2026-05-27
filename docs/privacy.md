# Privacy Model

Recall is local-only by default.

## What Stays Local

- Observations and file index data are stored in a local SQLite database (WebAssembly, no native code) on the user's machine.
- Semantic embeddings are generated with the ONNX model bundled under `models/`.
- File summaries are generated with deterministic local heuristics from file headers and symbols.
- Recall does not send telemetry.

## Network Behavior

Recall should not make network calls during normal operation. If the bundled embedding model is missing, initialization fails closed instead of downloading a replacement model.

Copilot itself is a cloud service. Recall's Language Model Tools provide local memory context to Copilot only when Copilot invokes the tools as part of a user-approved Copilot workflow.

## Data Location

By default, Recall stores its database at:

```text
~/.recall/recall.db
```

Users can override that location with `recall.databasePath`.
