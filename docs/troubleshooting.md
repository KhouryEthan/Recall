# Troubleshooting

## Semantic Search Is Disabled

Check that the bundled model exists:

```text
models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
```

Recall fails closed if the model is missing.

## File Index Results Are Sparse

Recall first asks VS Code for document symbols. If a language extension does not provide symbols, Recall falls back to regex extraction for common languages.

## Lint Or Tests Fail

Run:

```bash
npm ci
npm run compile
npm run lint
npm test
```

If `better-sqlite3` fails to install, confirm native build tools are available for your platform.
