<p align="center">
  <img src="media/icon.png" width="120" alt="Recall logo" />
</p>

<h1 align="center">Recall</h1>

<p align="center">
  <strong>Persistent developer memory for VS Code. Copilot searches before reading, saves what it learns, and gets smarter every session.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/version-1.3.0-green.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node >= 22">
  <img src="https://img.shields.io/badge/VS%20Code-%3E%3D1.95-blue.svg" alt="VS Code >= 1.95">
  <img src="https://img.shields.io/badge/100%25-offline%20%26%20private-purple.svg" alt="100% Offline & Private">
</p>

<p align="center">
  <a href="#token-savings">Token Savings</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#development">Development</a>
</p>

---

Recall gives GitHub Copilot a persistent, searchable memory that survives across sessions. It searches prior knowledge before reading files, saves discoveries after solving problems, and indexes every function in your codebase. Everything stays local, runs offline, and requires zero cloud dependencies.

## Token Savings

Measured on a resume-work debugging session in a medium-large codebase. Without Recall, Copilot reads files from scratch. With Recall, it searches memory first and reads only what it needs.

| Metric | Without Recall | With Recall | Reduction |
|---|---|---|---|
| **Tokens per session** | ~111,000 | ~9,700 | **91%** |
| **Source lines read** | 12,690 | 83 | **99.3%** |
| **Time to first response** | 60-90 sec | 10-15 sec | **~6x** |
| **Full file reads** | 4 files | 0 files | **100%** |
| **Grep searches** | 5 calls | 0 calls | **100%** |

> Actual savings vary by project size and memory maturity. The extension tracks your actual savings per session. Run @recall stats or Recall: Show Database Statistics to see your numbers.

## Quick Start

Install the extension, then run one command:

```bash
# From the VS Code Marketplace
code --install-extension recall-dev.recall

# Or from a .vsix file
code --install-extension recall-1.3.0.vsix --force
```

Set up your repository so Copilot knows how to use Recall:

```
Ctrl+Shift+P > "Recall: Setup Repository (Add Copilot Guidance Files)"
```

That's it. Reload VS Code and start working. Recall builds memory automatically from here.

---

## How It Works

```
Without Recall:                            With Recall:

Copilot --read_file--> 7,854 lines         Copilot --recall_search-->     3 observations  (~250 tok)
   ^                       |                   |    --recall_file_index--> symbol listing  (~150 tok)
   |    ~55,000 tokens     |                   |    --read_file L130-195-->               (~200 tok)
   <-----------------------+                   |    --recall_save-->       stored for next time
                                               v
                                            Total: ~600 tokens
```

Recall registers three Language Model Tools that Copilot calls autonomously, the same way it calls `read_file` or `grep_search`:

| Tool | What Copilot Does With It |
|---|---|
| `recall_search` | Searches memory for prior observations before deep-diving into code |
| `recall_file_index` | Looks up cached function listings to read only specific lines |
| `recall_save` | Saves bug root causes, fixes, and architectural insights for next time |

### Example Session

```
You type: "Fix the token refresh race condition in auth"

Copilot (behind the scenes):
  1. recall_search("token refresh race condition auth")
     > 3 prior observations from past sessions (keyword + semantic match)

  2. recall_file_index("authService.ts")
     > summary + 12 functions with line numbers (400 tokens vs 8,000 for the full file)

  3. read_file authService.ts lines 130-195
     > only the 2 functions it actually needs

  4. Makes the fix

  5. recall_save("Fixed token refresh race condition...")
     > saved as 'pending' for you to verify
```

---

## Semantic Search

Recall doesn't just match keywords. Every observation is embedded as a 384-dimensional vector using a bundled sentence-transformer model (all-MiniLM-L6-v2, ~23 MB ONNX). When Copilot calls `recall_search`, Recall runs a hybrid query:

1. **FTS5 keyword match** with prefix expansion (searching "auth" also finds "authentication", "authorize")
2. **Cosine similarity** over embedding vectors (searching "login broken" finds "OAuth token refresh fails silently")
3. Results are merged and ranked by combined score

This means Copilot finds relevant prior observations even when the exact wording doesn't match. A search for "race condition in token handling" will surface an observation saved as "fixed concurrent refresh bug in auth service" because the meaning is close, even though the words are different.

The model runs entirely in-process. No API calls, no network, no data leaves your machine.

---

## Key Features

- **Autonomous Memory** - Copilot searches and saves on its own. No manual @commands needed during normal workflows.
- **Hybrid Search** - FTS5 keyword search + 384-dim semantic embeddings. Finds relevant memories even when wording differs.
- **File Index** - Every source file gets a cached function/class listing with line numbers. Copilot reads 80 lines instead of 8,000.
- **Passive Capture** - Builds, debug sessions, git commits, and idle notes are logged automatically as verified observations.
- **Trust System** - AI-generated observations stay "pending" until you verify them. Objective events (builds, commits) are auto-verified.
- **Deduplication** - Clusters near-identical observations by semantic similarity. One-click merge keeps memory clean.
- **Token Savings Tracker** - Built-in per-session and all-time metrics. See exactly how many tokens Recall saves you.
- **Import / Export** - Share memory across machines or with teammates via JSON with duplicate detection.
- **100% Private** - Bundled ONNX model. WebAssembly SQLite. Zero network calls. Zero telemetry. Nothing leaves your machine.

---

## Commands

### @recall Chat Participant

```
@recall search <keywords>             Search observations (keyword + semantic)
@recall search <keywords> --tags x,y  Filter by tags
@recall save <text>                   Save a verified observation
@recall save <text> --tags x,y        Save with tags
@recall recent                        Show recent observations
@recall recent --days 7               Last 7 days
@recall pending                       Show unverified observations
@recall verify <id>                   Mark as verified
@recall edit <id>                     Edit and verify
@recall discard <id>                  Delete observation
@recall timeline <id>                 Observations from same day
@recall index <filename>              Look up cached file index
@recall stats                         Database statistics + token savings
@recall export                        Export all data to JSON
@recall help                          Show all commands
```

### Command Palette

| Command | Description |
|---|---|
| `Recall: Quick Save Observation` | Save an insight with tags (`Ctrl+Shift+M`) |
| `Recall: Show Pending Observations` | Review unverified Copilot observations |
| `Recall: Open Dashboard` | Sidebar with stats, pending reviews, token savings |
| `Recall: Re-index Current File` | Rebuild index for the active file |
| `Recall: Re-index All Open Workspace Files` | Index all source files in workspace |
| `Recall: Reindex Semantic Embeddings` | Backfill embeddings for existing observations |
| `Recall: Deduplicate Memory` | Find and merge near-identical observations |
| `Recall: Export Memory to JSON` | Export everything |
| `Recall: Import Memory from JSON` | Import from a teammate's export |
| `Recall: Setup Repository` | Add Copilot guidance files to your project |
| `Recall: Show Database Statistics` | Observation counts, index stats, token savings |
| `Recall: Run Diagnostics` | Debug tool registration |

---

## Trust & Verification

I always found it annoying when the agent makes observations or assumptions that are completely wrong, it wastes time and tokens. With Recall YOU have control over the observations and assumptions that the agent can make. Automated Copilot observations are saved as **pending** with a notification: `[Verify] [Edit & Save] [Discard]`. Unconfirmed observations will auto expire after 7 days by default. (This is configurable if you want them to last longer)

---

## Configuration

All settings are under `recall.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `recall.databasePath` | `~/.recall/recall.db` | Custom database path |
| `recall.autoIndexOnSave` | `true` | Index files on save |
| `recall.captureBuilds` | `true` | Auto-capture build results |
| `recall.captureGitCommits` | `false` | Auto-capture git commits |
| `recall.captureDebugSessions` | `true` | Auto-capture debug sessions |
| `recall.pendingExpirationDays` | `7` | Days before pending observations expire |
| `recall.idlePromptMinutes` | `10` | Minutes before "save notes?" prompt (0 = disable) |
| `recall.maxSearchResults` | `10` | Max results from recall_search |
| `recall.projectName` | `""` | Override auto-detected project name |
| `recall.indexFileExtensions` | `[]` | Additional file extensions to index |

---

## Privacy & Data

| | |
|---|---|
| **Storage** | Single WebAssembly SQLite file at `~/.recall/recall.db` |
| **Embedding model** | Bundled ~23 MB ONNX model, runs in-process |
| **Network calls** | Zero |
| **Telemetry** | Zero |
| **Cloud sync** | None |
| **Backup** | Copy `recall.db` |
| **Reset** | Delete `~/.recall/recall.db` |

---

## Repository Setup

After installing, teach Copilot how to use Recall in your project:

```
Ctrl+Shift+P > "Recall: Setup Repository (Add Copilot Guidance Files)"
```

This creates:

| File | Purpose |
|---|---|
| `.github/copilot-instructions.md` | Teaches Copilot the search, index, read, save workflow |
| `.github/agents/recall.agent.md` | Dedicated memory-first agent mode |
| `.github/instructions/recall-aware.instructions.md` | Auto-triggers on any source file |
| `.github/prompts/recall-seed.prompt.md` | One-time prompt to populate baseline memory |
| `.github/prompts/recall-audit.prompt.md` | Monthly maintenance prompt |


### Seeding Memory (Cold Start)

When the database is empty, you can bootstrap it with the seed prompt file:

1. Run `Recall: Setup Repository` from the Command Palette
2. In Copilot Chat, open `recall-seed.prompt.md`
3. Specify a module (e.g., "auth, all files in src/services/auth/")
4. Copilot walks the codebase building baseline observations
5. Repeat for each major module

---

## System Requirements

- **VS Code** 1.95+ (Copilot Agent mode support)
- **Node.js** 22+ (building from source only)
- **Copilot** Any plan with Agent mode (Business, Enterprise, or Individual)

---

## Development

```bash
git clone https://github.com/KhouryEthan/Recall.git
cd Recall
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

### Building

```bash
npm run bundle          # Bundle with esbuild
npm run package         # Create .vsix (universal, all platforms)
npm run lint            # ESLint
npm test                # vitest
```

Since v1.3.0, the extension uses WebAssembly SQLite. No native build tools required.

### Project Structure

```
src/
  extension.ts          Tool / participant / command registration
  db.ts                 WebAssembly SQLite + FTS5 + embeddings
  embeddings.ts         Sentence-transformer pipeline
  embeddingBlob.ts      Versioned embedding storage format
  ftsQuery.ts           FTS5 query sanitization
  tokenTracker.ts       Per-session token savings tracking
  search.ts             FTS + semantic hybrid search
  chatParticipant.ts    @recall chat participant
  passive.ts            Build / debug / git / idle capture
  fileIndex.ts          Document-symbol-based file indexing
  deduplication.ts      Semantic dedup
  sidebarProvider.ts    Dashboard webview
  ui.ts                 Status bar, quick save, import/export
  tools/
    searchTool.ts       recall_search
    saveTool.ts         recall_save
    fileIndexTool.ts    recall_file_index

test/                   vitest unit + integration tests
models/                 Bundled ONNX sentence-transformer
benchmarks/             Token estimation scenarios
docs/                   Architecture, privacy, troubleshooting
```

---

## Documentation

- [Architecture](docs/architecture.md)
- [Privacy model](docs/privacy.md)
- [Security model](docs/security-model.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Roadmap](ROADMAP.md)

- [Contributing](CONTRIBUTING.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
