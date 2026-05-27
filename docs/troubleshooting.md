# Troubleshooting

## Semantic Search Is Disabled

Check that the bundled model exists:

```text
models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
```

Recall fails closed if the model is missing. It will not download a replacement.

## File Index Results Are Sparse

Recall first asks VS Code for document symbols. If a language extension does not provide symbols, Recall falls back to regex extraction for common languages. Install the appropriate language extension (e.g., Pylance for Python, rust-analyzer for Rust) for best results.

## Lint Or Tests Fail

Run:

```bash
npm ci
npm run compile
npm run lint
npm test
```

## Building From Source

Since v1.3.0, Recall uses `fts5-sql-bundle` (WebAssembly SQLite). No native build tools are required. `npm install` should work on any system with Node 22+.

## Legacy Versions (v1.2.x and earlier)

If you are running a pre-1.3.0 build that still uses `better-sqlite3`:

- **"NODE_MODULE_VERSION mismatch"**: The native binary was compiled for a different Node ABI than VS Code expects. Upgrade to v1.3.0 which eliminates native binaries entirely.
- **"GLIBC_2.xx not found" on Linux**: The native binary was built on a newer glibc than your system. Upgrade to v1.3.0 or build from source on your machine.
