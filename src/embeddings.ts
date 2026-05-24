import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Lazy-loaded pipeline reference
let extractor: any = null;
let initPromise: Promise<void> | null = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Initialize the sentence-transformer embedding pipeline.
 * Loads the model from the bundled extension path if available,
 * otherwise falls back to ~/.recall/models/ cache.
 */
export async function initEmbeddings(extensionPath: string): Promise<void> {
    if (extractor) { return; }
    if (initPromise) { return initPromise; }

    initPromise = (async () => {
        // Dynamic import — @xenova/transformers is ESM-compatible via this pattern
        const { pipeline, env } = await Function('return import("@xenova/transformers")')() as any;

        // Check for bundled models first (air-gapped), then user cache
        const bundledDir = path.join(extensionPath, 'models');
        const onnxPath = path.join(bundledDir, 'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx');
        const cacheDir = path.join(os.homedir(), '.recall', 'models');

        if (fs.existsSync(onnxPath)) {
            // Full model bundled — use it, no network needed
            env.localModelPath = bundledDir;
            env.allowRemoteModels = false;
        } else {
            // Model weights missing from bundle — allow one-time download to user cache
            env.allowRemoteModels = true;
        }
        env.cacheDir = cacheDir;
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        extractor = await pipeline('feature-extraction', MODEL_NAME, {
            quantized: true,
        });
    })();

    return initPromise;
}

/**
 * Generate a 384-dimensional normalized embedding for the given text.
 */
export async function embed(text: string): Promise<Float32Array> {
    if (!extractor) {
        throw new Error('Embeddings not initialized — call initEmbeddings() first');
    }
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
}

/**
 * Cosine similarity between two normalized vectors (dot product).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

/**
 * Returns true if the embedding engine has been initialized.
 */
export function isReady(): boolean {
    return extractor !== null;
}

/**
 * Embedding vector dimension (384 for all-MiniLM-L6-v2).
 */
export const DIMENSION = EMBEDDING_DIM;

/**
 * Fire-and-forget: embed an observation and store the vector.
 * Safe to call even if the model isn't loaded — silently skips.
 */
export function embedObservation(db: { storeEmbedding(id: number, embedding: Float32Array): void }, id: number, content: string): void {
    if (!isReady()) { return; }
    embed(content).then(vec => {
        db.storeEmbedding(id, vec);
    }).catch(err => {
        console.error(`[Recall] Failed to embed observation #${id}:`, err);
    });
}
