import { describe, expect, it } from 'vitest';
import { decodeEmbedding, EMBEDDING_DIMENSION, encodeEmbedding } from '../src/embeddingBlob';

describe('embedding blob encoding', () => {
    it('round-trips versioned embeddings', () => {
        const embedding = new Float32Array(EMBEDDING_DIMENSION);
        embedding[0] = 0.25;
        embedding[383] = -0.75;

        const decoded = decodeEmbedding(encodeEmbedding(embedding));

        expect(decoded).not.toBeNull();
        expect(decoded?.[0]).toBeCloseTo(0.25);
        expect(decoded?.[383]).toBeCloseTo(-0.75);
    });

    it('accepts legacy raw float32 embeddings', () => {
        const legacy = Buffer.alloc(EMBEDDING_DIMENSION * 4);
        legacy.writeFloatLE(0.5, 0);

        const decoded = decodeEmbedding(legacy);

        expect(decoded?.[0]).toBeCloseTo(0.5);
    });

    it('rejects mismatched embedding dimensions', () => {
        expect(() => encodeEmbedding(new Float32Array(12))).toThrow(/dimension 12/);
    });

    it('treats unknown blob versions as missing', () => {
        const bad = Buffer.alloc(1 + EMBEDDING_DIMENSION * 4);
        bad.writeUInt8(99, 0);

        expect(decodeEmbedding(bad)).toBeNull();
    });
});
