const EMBEDDING_BLOB_VERSION = 1;
const EMBEDDING_DIM = 384;
const EMBEDDING_BYTES = EMBEDDING_DIM * 4;

// Embedding BLOB layout (current = v1):
//   [0]      uint8  version
//   [1..]    float32 little-endian, EMBEDDING_DIM lanes
// Legacy BLOBs from versions <1.2.0 have no version byte.
export function encodeEmbedding(embedding: Float32Array): Buffer {
    if (embedding.length !== EMBEDDING_DIM) {
        throw new Error(
            `Recall: refusing to store embedding of dimension ${embedding.length}; expected ${EMBEDDING_DIM}.`
        );
    }

    const out = Buffer.alloc(1 + EMBEDDING_BYTES);
    out.writeUInt8(EMBEDDING_BLOB_VERSION, 0);
    Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength).copy(out, 1);
    return out;
}

export function decodeEmbedding(buf: Buffer | null | undefined): Float32Array | null {
    if (!buf || buf.length === 0) { return null; }

    let dataStart: number;
    if (buf.length === EMBEDDING_BYTES) {
        dataStart = 0;
    } else if (buf.length === 1 + EMBEDDING_BYTES && buf.readUInt8(0) === EMBEDDING_BLOB_VERSION) {
        dataStart = 1;
    } else {
        return null;
    }

    const out = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        out[i] = buf.readFloatLE(dataStart + i * 4);
    }
    return out;
}

export const EMBEDDING_DIMENSION = EMBEDDING_DIM;
