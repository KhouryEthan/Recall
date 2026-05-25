<p align="center">
  <img src="media/icon.png" width="120" alt="Recall logo" />
</p>

<h1 align="center">Recall</h1>

<p align="center">
  <strong>Persistent developer memory for VS Code. Copilot searches before reading, saves what it learns, and gets smarter every session.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/version-1.2.0-green.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node >= 18">
  <img src="https://img.shields.io/badge/VS%20Code-%3E%3D1.95-blue.svg" alt="VS Code >= 1.95">
  <img src="https://img.shields.io/badge/100%25-offline%20%26%20private-purple.svg" alt="100% Offline & Private">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#commands">Commands</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#development">Development</a> •
  <a href="#license">License</a>
</p>

---

Recall gives GitHub Copilot a persistent, searchable memory that survives across sessions. It searches prior knowledge before reading files, saves discoveries after solving problems, and indexes every function in your codebase — all locally, with zero cloud dependencies.

## Token Savings (Workflow Comparison)

| Metric | Without Recall | With Recall | Reduction |
|---|---|---|---|
| **Tokens per session** | ~111,000 | ~9,700 | **91%** |
| **Source lines read** | 12,690 | 83 | **99.3%** |
| **Time to first response** | 60–90 sec | 10–15 sec | **~6×** |
| **Full file reads** | 4 files | 0 files | **100%** |
| **Grep searches** | 5 calls | 0 calls | **100%** |

> Estimates based on a resume-work debugging session in a medium-large codebase. Actual savings vary by project size and memory maturity.

## Quick Start

**Install the extension**, then run one command:

```bash
# From the VS Code Marketplace
code --install-extension recall-dev.recall

# Or from a .vsix file
code --install-extension recall-1.2.0.vsix --force
```

**Set up your repository** so Copilot knows how to use Recall:

```
Ctrl+Shift+P → "Recall: Setup Repository (Add Copilot Guidance Files)"
```

**That's it.** Reload VS Code and start working. Recall builds memory automatically from here.

---

## Key Features

- 🧠 **Autonomous Memory** — Copilot searches and saves on its own. No manual @commands needed.
- 🔍 **Hybrid Search** — SQLite FTS5 keyword search + 384-dim sentence-transformer embeddings for semantic matching.
- 📑 **File Index** — Every source file gets a cached function listing. Copilot reads 80 lines instead of 8,000.
- 📡 **Passive Capture** — Builds, debug sessions, git commits, and idle notes are logged automatically.
- 🛡️ **Trust System** — AI claims stay "pending" until you verify them. Objective events are auto-verified.
- 🔗 **Deduplication** — Clusters near-identical observations by semantic similarity. One-click merge.
- 📦 **Import / Export** — Share memory across machines or with teammates via JSON.
- 🔒 **100% Private** — Bundled ONNX model (~23 MB). Local SQLite. Zero network calls. Zero telemetry.
- 📊 **Dashboard** — Sidebar panel with stats, pending reviews, file index, and tag breakdowns.

---

## How It Works

```
  Without Recall:                          With Recall:

  Copilot ──read_file──→ 7,854 lines      Copilot ──recall_search──→ 3 prior observations
    ↑                        ↓                ↓
    │      ~55,000 tokens    │             recall_file_index → function listing (800 tokens)
    ←────────────────────────┘                ↓
                                           read_file lines 130–195 only (500 tokens)
                                              ↓
                                           recall_save → saved for next session
```

Recall registers three Language Model Tools that Copilot calls autonomously — the same way it calls `read_file` or `grep_search`:

| Tool | What Copilot Does With It |
|---|---|
| `recall_search` | Searches memory for prior observations before deep-diving into code |
| `recall_save` | Saves bug root causes, fixes, and architectural insights |
| `recall_file_index` | Looks up cached function listings to read only specific lines |

### Example Session

```
You type: "Fix the token refresh race condition in auth"

Copilot (behind the scenes):
  1. recall_search("token refresh race condition auth")
     → 3 prior observations from past sessions

  2. recall_file_index("authService.ts")
     → summary + 12 functions with line numbers (400 tokens)

  3. read_file authService.ts lines 130-195
     → only the 2 functions it needs (500 tokens)

  4. Makes the fix

  5. recall_save("Fixed token refresh race condition...")
     → saved as 'pending' for you to verify
```

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
@recall stats                         Database statistics
@recall export                        Export all data to JSON
@recall help                          Show all commands
```

### Command Palette

| Command | Description |
|---|---|
| `Recall: Quick Save Observation` | Save an insight with tags (`Ctrl+Shift+M`) |
| `Recall: Show Pending Observations` | Review unverified Copilot observations |
| `Recall: Open Dashboard` | Visual dashboard with stats and pending reviews |
| `Recall: Re-index Current File` | Rebuild index for the active file |
| `Recall: Re-index All Open Workspace Files` | Index all source files in workspace |
| `Recall: Reindex Semantic Embeddings` | Backfill embeddings for existing observations |
| `Recall: Deduplicate Memory` | Find and merge near-identical observations |
| `Recall: Export Memory to JSON` | Export everything |
| `Recall: Import Memory from JSON` | Import from a teammate's export |
| `Recall: Setup Repository` | Add Copilot guidance files to your project |
| `Recall: Show Database Statistics` | View observation/index counts |
| `Recall: Run Diagnostics` | Debug tool registration |

---

## Trust & Verification

| Source | Status | Why |
|---|---|---|
| Build pass/fail | ✅ Verified | Objective — it happened |
| Git commit | ✅ Verified | Objective — it happened |
| Debug session | ✅ Verified | Objective — it happened |
| Manual save | ✅ Verified | You wrote it |
| File index | ✅ Verified | Extracted from AST |
| **Copilot analysis** | **⏳ Pending** | Could be wrong — needs testing |

Copilot observations are saved as **pending** with a notification: `[Verified] [Edit & Save] [Discard]`. Unconfirmed observations auto-expire after 7 days.

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

Recall is designed to be fully offline and private:

- **Storage**: Single SQLite file at `~/.recall/recall.db` on your machine
- **Semantic model**: Bundled ~23 MB ONNX model runs in-process. No API calls.
- **Network**: Zero. No telemetry, no cloud sync, no data leaves your machine.
- **Backup**: Copy `recall.db`. That's it.
- **Reset**: Delete `~/.recall/recall.db`. A fresh database is created on next activation.

---

## System Requirements

- **VS Code**: 1.95 or higher (with Copilot Agent mode support)
- **Node.js**: 18+ (for building from source)
- **Copilot**: Any plan that supports Agent mode (Business, Enterprise, or Individual)
- **Disk**: ~25 MB for the extension + model. Database typically stays under 10 MB.

---

## Repository Setup

After installing, teach Copilot how to use Recall in your project:

```
Ctrl+Shift+P → "Recall: Setup Repository (Add Copilot Guidance Files)"
```

This creates:

| File | Purpose |
|---|---|
| `.github/copilot-instructions.md` | Teaches Copilot the search → index → read → save workflow |
| `.github/agents/recall.agent.md` | Dedicated memory-first agent mode |
| `.github/instructions/recall-aware.instructions.md` | Auto-triggers on any source file |
| `.github/prompts/recall-seed.prompt.md` | One-time prompt to populate baseline memory |
| `.github/prompts/recall-audit.prompt.md` | Monthly maintenance prompt |

**Commit these files** so the whole team benefits.

### Seeding Memory (Cold Start)

When the database is empty, bootstrap it:

1. Run `Recall: Setup Repository` from the Command Palette
2. In Copilot Chat, open `recall-seed.prompt.md`
3. Specify a module (e.g., "auth — all files in src/services/auth/")
4. Copilot walks the codebase building baseline observations
5. Repeat for each major module (~10–30 min each)

---

## Development

```bash
git clone https://github.com/recall-dev/recall.git
cd recall
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

### Building

```bash
npm run bundle          # Bundle with esbuild
npm run package         # Create .vsix
```

> **Note:** `npm install` compiles `better-sqlite3` from source, which requires `make`, `g++`, and `python3` on Linux/macOS.

### Project Structure

```
recall/
├── src/
│   ├── extension.ts          Entry point: registers tools, hooks, participant
│   ├── db.ts                 SQLite with FTS5 + embeddings
│   ├── embeddings.ts         Sentence-transformer model
│   ├── search.ts             Hybrid search (FTS5 + semantic)
│   ├── chatParticipant.ts    @recall chat participant
│   ├── passive.ts            Auto-capture: builds, debug, git, idle
│   ├── fileIndex.ts          File index builder (symbols + summaries)
│   ├── contextHints.ts       Status bar hints
│   ├── deduplication.ts      Semantic dedup / merge
│   ├── setupRepository.ts    Repo setup command
│   ├── sidebarProvider.ts    Dashboard webview
│   ├── ui.ts                 Quick-save, status bar, import/export
│   └── tools/
│       ├── searchTool.ts     recall_search
│       ├── saveTool.ts       recall_save
│       └── fileIndexTool.ts  recall_file_index
├── models/                   Bundled ONNX sentence-transformer
├── repo-config/              Template files for repository setup
├── media/                    Icons
├── package.json
├── tsconfig.json
├── esbuild.mjs
├── LICENSE
├── NOTICE
└── CONTRIBUTING.md
```

---

## FAQ

**Does Recall send any data to the cloud?**
No. Everything runs locally. Zero network calls.

**Does it work with Copilot Business/Enterprise?**
Yes. LM tools and chat participant APIs work with any Copilot plan that supports Agent mode.

**Can I share my memory with the team?**
Export to JSON, then teammates import with duplicate detection.

**How big does the database get?**
Typically <10 MB even after months of heavy use.

**Does it slow down VS Code?**
No. All database operations are <1ms. File indexing runs asynchronously on save.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and workflow.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

We chose Apache-2.0 because persistent developer memory should be easy to embed in editor extensions, local agents, MCP servers, and enterprise developer tools.

See [NOTICE](NOTICE) for third-party attribution.
