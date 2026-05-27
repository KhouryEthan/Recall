import { describe, it, expect, beforeEach } from 'vitest';
import { TokenTracker, TokenStatsStore, estimateTokens, estimateFileReadTokens } from '../src/tokenTracker';

class MockStore implements TokenStatsStore {
    private data: { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number } | undefined;

    getTokenStats() {
        return this.data;
    }

    upsertTokenStats(stats: { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number }) {
        this.data = { ...stats };
    }
}

describe('estimateTokens', () => {
    it('approximates 1 token per 4 characters', () => {
        expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> ceil = 3
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('abcd')).toBe(1);
    });
});

describe('estimateFileReadTokens', () => {
    it('uses avg 35 chars per line / 4 chars per token', () => {
        expect(estimateFileReadTokens(100)).toBe(900); // 100 * 9
        expect(estimateFileReadTokens(0)).toBe(0);
    });
});

describe('TokenTracker', () => {
    let tracker: TokenTracker;
    let store: MockStore;

    beforeEach(() => {
        store = new MockStore();
        tracker = new TokenTracker(store);
    });

    it('starts with zero stats', () => {
        const stats = tracker.getSessionStats();
        expect(stats.searchHits).toBe(0);
        expect(stats.fileIndexHits).toBe(0);
        expect(stats.tokensUsed).toBe(0);
        expect(stats.tokensSaved).toBe(0);
        expect(stats.reductionPercent).toBe(0);
    });

    it('records search hits', () => {
        tracker.recordSearchHit('Found 3 observations for "auth":\n#1 some content here\n#2 more content');
        const stats = tracker.getSessionStats();
        expect(stats.searchHits).toBe(1);
        expect(stats.tokensUsed).toBeGreaterThan(0);
        expect(stats.tokensWithoutRecall).toBeGreaterThan(stats.tokensUsed);
        expect(stats.tokensSaved).toBeGreaterThan(0);
        expect(stats.reductionPercent).toBeGreaterThan(0);
    });

    it('records file index hits', () => {
        tracker.recordFileIndexHit('File: auth.ts (300 lines)\nSymbols (5):\n...', 300);
        const stats = tracker.getSessionStats();
        expect(stats.fileIndexHits).toBe(1);
        expect(stats.tokensUsed).toBeGreaterThan(0);
        expect(stats.tokensWithoutRecall).toBe(300 * 9); // estimateFileReadTokens
        expect(stats.tokensSaved).toBeGreaterThan(0);
    });

    it('accumulates multiple hits', () => {
        tracker.recordSearchHit('result 1');
        tracker.recordSearchHit('result 2');
        tracker.recordFileIndexHit('index result', 100);
        const stats = tracker.getSessionStats();
        expect(stats.searchHits).toBe(2);
        expect(stats.fileIndexHits).toBe(1);
    });

    it('persists session to store and resets', () => {
        tracker.recordSearchHit('some result text');
        tracker.persistSession();

        const persisted = store.getTokenStats();
        expect(persisted).toBeDefined();
        expect(persisted!.search_hits).toBe(1);

        const afterReset = tracker.getSessionStats();
        expect(afterReset.searchHits).toBe(0);
    });

    it('combines persisted and session data for all-time stats', () => {
        tracker.recordSearchHit('first result');
        tracker.persistSession();
        tracker.recordSearchHit('second result');

        const allTime = tracker.getAllTimeStats();
        expect(allTime.searchHits).toBe(2);
    });

    it('handles no store gracefully', () => {
        const noStoreTracker = new TokenTracker();
        noStoreTracker.recordSearchHit('result');
        noStoreTracker.persistSession(); // should not throw
        const stats = noStoreTracker.getSessionStats();
        expect(stats.searchHits).toBe(1);
    });

    it('calculates reduction percent correctly', () => {
        // With a 4500 token baseline (2 files * 250 lines * 9 tokens/line)
        // and a short response, the reduction should be very high
        tracker.recordSearchHit('short');
        const stats = tracker.getSessionStats();
        expect(stats.reductionPercent).toBeGreaterThan(90);
    });
});
