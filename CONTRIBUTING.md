# Contributing to Recall

Thank you for your interest in contributing to Recall! This document explains how to get started.

## Development Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/KhouryEthan/Recall.git
   cd Recall
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

4. **Run quality checks:**

   ```bash
   npm run lint
   npm test
   ```

5. **Launch the Extension Development Host:**

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
npm run package       # Create .vsix for the current platform
```

### Cross-platform VSIX packaging

Native modules (`better-sqlite3`, `onnxruntime-node`) ship platform-specific binaries. When publishing for multiple OS/arch combinations, build one VSIX per target:

```bash
npm run package:win32-x64
npm run package:linux-x64
npm run package:darwin-arm64
# ... see package.json for all targets
```

Each command runs `vsce package --target <platform>`, which installs the correct native binaries for that target before packaging. GitHub Actions (`.github/workflows/package.yml`) builds all targets on release.

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
