# Changelog

## [1.3.1] - 2026-05-27

### Fixed

- **Sidebar clicks not registering**: Refresh button, project selector, and observation action buttons were silently dropped. VS Code webview CSP blocks inline `onclick=` handlers. Replaced all inline handlers with `data-action` delegation 
- **Dashboard cannot filter by project**: Added a project selector to the dashboard
- **Garbage file summaries**: License banners, copyright lines, and `#include` directives were used as summaries. Replaced with symbol-only summaries now derived from the DocumentSymbolProvider output.
- **Dashboard search input loses focus**: Every keystroke triggered a full page rebuild. Search now fires only on Enter or clicking the Search button.

### Changed

- File Summary generation is now purely symbol-derived. May circle back and rethink a more valuable thing to include here in the future.

### Added

- Project filter in the full dashboard.
- Search button in the observations filter bar.
- Option to clean up all File indexes.
- Option to vacuum the DB clearing unused entries in the db.

## [1.3.0] - 2026-05-26

### Fixed

- **Platform dependent vsix error**: `better-sqlite3` native binaries caused NODE_MODULE_VERSION mismatch on Windows (Electron ABI 140 vs Node ABI 115), glibc errors on older Linux/WSL, and failures in Remote SSH. Replaced `better-sqlite3` entirely with `fts5-sql-bundle` (SQLite compiled to WebAssembly). One universal VSIX now works on every platform, architecture, and VS Code version.
- **GitHub Actions Node.js 20 deprecation**: All actions bumped from `@v4` to `@v6`. Node version bumped to 22.

### Added

- **Token savings tracker**: Built-in metrics showing how many tokens Recall saves per session and all-time. Visible in the dashboard and via `Recall: Show Database Statistics`.
- **Unit tests**: vitest test suite with 36 tests covering database CRUD, FTS search, embeddings, file index, persistence, filtering, token estimation, and more.
- **ESLint flat config**: Migrated from legacy eslintrc to `eslint.config.mjs` with typescript-eslint.
- **Benchmark harness**: Reproducible token-estimation tool under `benchmarks/`.
- **Documentation**: Architecture overview, privacy model, security model, troubleshooting guide, and screenshot checklist under `docs/`.
- **Roadmap**: `ROADMAP.md` with short-term milestones for v1.3-v1.5.
- **Issue templates**: Bug report, feature request, and memory quality templates.

### Changed

- **SQLite engine**: Migrated from `better-sqlite3` (native C++ addon) to `fts5-sql-bundle` (WebAssembly). Eliminates all platform-specific packaging. Single universal VSIX replaces the six-target build matrix.
- **CI simplified**: One build job instead of six. Quality gate (compile, lint, test, bundle) runs on every push and PR.
- **Embeddings fail closed**: If the bundled model is missing, initialization throws instead of silently downloading a replacement.
- **Extracted modules**: `embeddingBlob.ts` and `ftsQuery.ts` pulled out of `db.ts` into standalone tested modules.
- **Node version**: Build requires Node 22+ (matches VS Code's internal runtime).

## [1.2.0] - 2026-05-25

### Fixed

- **VSIX shipped without the embedding model loader (CRITICAL)**: `embeddings.ts` loads `@xenova/transformers` via `Function('return import(...)')()`, which esbuild cannot follow. The `.vscodeignore` excluded `node_modules/`** with a small allowlist that did not include `@xenova/transformers` or its `@huggingface/jinja` dependency, so semantic search silently broke when installed from a packaged VSIX (worked in `F5` dev only). Added both packages to the allowlist.
- **FTS search disabled stemming/prefix matching**: `sanitizeFtsQuery` wrapped every word in double quotes, turning every query into a strict-literal lookup. Searching `function` would not match `functions`, `getToken` would not match `getTokenAsync`, etc. Quotes are now reserved for user-supplied phrases; single tokens are emitted unquoted with a trailing `*` for prefix matching.
- **Embedding BLOBs had no version/dimension marker**: If the embedding model ever changed dimension, every existing BLOB would silently decode as garbage. Embeddings now carry a 1-byte version header. Legacy (pre-1.2.0) BLOBs are still readable; mismatched-version BLOBs are skipped instead of producing junk vectors, and `Recall: Reindex Semantic Embeddings` will re-populate them.

### Changed

- **Cross-platform VSIX packaging**: Native modules (`better-sqlite3`, `onnxruntime-node`) ship platform-specific `.node` binaries; a VSIX built on one OS/arch is broken on another. Added per-target package scripts (`package:win32-x64`, `package:linux-arm64`, `package:darwin-arm64`, etc.) and a GitHub Actions workflow (`.github/workflows/package.yml`) that builds and uploads a VSIX for every supported `os/arch` on each `v`* tag.
- **CONTRIBUTING.md**: Documents the cross-platform packaging workflow.

## [1.1.0] - 2026-05-21

### Added

- **Full Dashboard CRUD**: Edit observation content and tags inline, delete observations with confirmation, filter by status/tag/search text
- **Sidebar CRUD**: Edit and delete observations directly from the sidebar panel
- **File Index Management**: View all indexed files with symbol details, delete file index entries from dashboard
- **Filter Bar**: Filter observations by status, tag, or free-text search on the All Observations tab

### Changed

- **Dashboard Restyled**: Clean modern design with CSS custom properties, metric cards, status pills, card-based layout, and consistent typography
- **Sidebar Restyled**: Matching minimal design with outline buttons, status dots, tag badges, and inline edit/delete
- **Reject button color**: Now uses explicit amber (#d19a00) instead of theme variable that could appear green on some themes
- **Event handling**: Moved from inline onclick handlers to CSP-safe event delegation — fixes click handling in VS Code webviews

### Fixed

- **Dashboard clicks not working**: VS Code webview CSP was blocking inline event handlers; replaced with data-attribute event delegation
- **Delete button not working**: `confirm()` dialogs silently return false in VS Code webviews; replaced with inline confirmation bar

## [1.0.0] - 2026-05-20

### Added

- **Sidebar Dashboard**: Brain icon in the activity bar opens a webview dashboard with stats, pending observations, and recent history
- **Diagnostics Command**: `Recall: Run Diagnostics` dumps all registered LM tools for debugging tool registration issues
- `**canBeReferencedInPrompt`**: Tools now appear in Copilot Chat's "Configure Tools" gear menu and are callable by any agent mode

### Changed

- **Git commit capture disabled by default**: Most commit messages are too short to be useful observations. Re-enable via `recall.captureGitCommits: true` in settings.
- **Sidebar icon**: Uses a proper SVG file instead of a codicon reference (codicons don't work in the activity bar)

### Fixed

- **Tool registration**: Added `toolReferenceName`, `userDescription`, `tags`, and `canBeReferencedInPrompt` fields to match VS Code's expected `languageModelTools` contribution format. Tools now register and are usable by Copilot agents.

## [0.1.0] - 2026-05-20

### Added

- **Autonomous LM Tools**: `recall_search`, `recall_save`, `recall_file_index` — Copilot calls these automatically in Agent mode
- **@recall Chat Participant**: Direct interaction with memory — search, save, recent, pending, verify, discard, edit, timeline, stats, index, export
- **File Index Builder**: Automatically indexes source files on save — extracts function/class/struct names with line numbers and generates one-sentence summaries
- **Passive Event Capture**: Auto-logs build results, git commits, debug sessions
- **Trust & Verification**: Copilot observations saved as `pending` with notification for engineer verification. Objective events auto-verified.
- **Quick-Save Keybinding**: `Ctrl+Shift+M` for instant observation capture
- **Dashboard**: Visual webview with stats, pending reviews, and recent observations
- **Status Bar Indicator**: Shows count of pending observations
- **Auto-Expiration**: Pending observations expire after 7 days (configurable)
- **Idle Session Prompt**: "Save notes?" after 10 minutes of inactivity
- **Export**: Export all memory to JSON
- **Repository Setup Script**: `setup-repo.sh` to configure any project with Recall's Copilot config files
- **Automated Setup Script**: `setup.sh` for one-command installation

