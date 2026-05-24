# Contributing to Recall

Thank you for your interest in contributing to Recall! This document explains how to get started.

## Development Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/recall-dev/recall.git
   cd recall
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

   This compiles native modules (`better-sqlite3`) from source. You need `make`, `g++`, and `python3` on Linux/macOS.

3. **Compile TypeScript:**

   ```bash
   npm run compile
   ```

4. **Launch the Extension Development Host:**

   Open the project in VS Code and press `F5`. This opens a new VS Code window with the extension loaded.

## Project Structure

- `src/` — TypeScript source code
- `src/tools/` — Language Model Tool implementations (search, save, file index)
- `src/extension.ts` — Entry point
- `repo-config/` — Template files copied into user repositories by `Recall: Setup Repository`
- `models/` — Bundled ONNX sentence-transformer model
- `media/` — Icons and assets

## Building

```bash
npm run bundle        # Bundle with esbuild
npm run package       # Create .vsix file
```

## Code Style

- TypeScript strict mode
- No unnecessary comments — code should be self-documenting
- Keep tool descriptions (`modelDescription` in `package.json`) concise and trigger-based

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Test in the Extension Development Host (F5)
5. Submit a pull request with a clear description of what changed and why

## Reporting Issues

Open an issue on GitHub with:
- VS Code version
- Recall version
- Steps to reproduce
- Expected vs. actual behavior

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
