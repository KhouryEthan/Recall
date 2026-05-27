export interface TokenStats {
    searchHits: number;
    fileIndexHits: number;
    tokensUsed: number;
    tokensWithoutRecall: number;
    tokensSaved: number;
    reductionPercent: number;
}

export interface TokenStatsStore {
    getTokenStats(): { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number } | undefined;
    upsertTokenStats(stats: { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number }): void;
}

const AVG_TOKENS_PER_SOURCE_LINE = 9;
const BASELINE_FILE_READS_PER_SEARCH = 2;
const AVG_LINES_PER_FILE = 250;

export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function estimateFileReadTokens(lineCount: number): number {
    return lineCount * AVG_TOKENS_PER_SOURCE_LINE;
}

export class TokenTracker {
    private session: { searchHits: number; fileIndexHits: number; tokensUsed: number; tokensWithoutRecall: number };
    private store: TokenStatsStore | undefined;

    constructor(store?: TokenStatsStore) {
        this.store = store;
        this.session = { searchHits: 0, fileIndexHits: 0, tokensUsed: 0, tokensWithoutRecall: 0 };
    }

    recordSearchHit(responseText: string): void {
        const tokensUsed = estimateTokens(responseText);
        const tokensWithout = BASELINE_FILE_READS_PER_SEARCH * AVG_LINES_PER_FILE * AVG_TOKENS_PER_SOURCE_LINE;

        this.session.searchHits++;
        this.session.tokensUsed += tokensUsed;
        this.session.tokensWithoutRecall += tokensWithout;
    }

    recordFileIndexHit(responseText: string, fileLineCount: number): void {
        const tokensUsed = estimateTokens(responseText);
        const tokensWithout = estimateFileReadTokens(fileLineCount);

        this.session.fileIndexHits++;
        this.session.tokensUsed += tokensUsed;
        this.session.tokensWithoutRecall += tokensWithout;
    }

    getSessionStats(): TokenStats {
        const saved = this.session.tokensWithoutRecall - this.session.tokensUsed;
        const percent = this.session.tokensWithoutRecall > 0
            ? Math.round((saved / this.session.tokensWithoutRecall) * 100)
            : 0;
        return {
            searchHits: this.session.searchHits,
            fileIndexHits: this.session.fileIndexHits,
            tokensUsed: this.session.tokensUsed,
            tokensWithoutRecall: this.session.tokensWithoutRecall,
            tokensSaved: Math.max(0, saved),
            reductionPercent: Math.max(0, percent),
        };
    }

    getAllTimeStats(): TokenStats {
        if (!this.store) {
            return this.getSessionStats();
        }

        const persisted = this.store.getTokenStats();
        if (!persisted) {
            return this.getSessionStats();
        }

        const totalSearchHits = persisted.search_hits + this.session.searchHits;
        const totalFileIndexHits = persisted.file_index_hits + this.session.fileIndexHits;
        const totalUsed = persisted.tokens_used + this.session.tokensUsed;
        const totalWithout = persisted.tokens_without_recall + this.session.tokensWithoutRecall;
        const saved = totalWithout - totalUsed;
        const percent = totalWithout > 0 ? Math.round((saved / totalWithout) * 100) : 0;

        return {
            searchHits: totalSearchHits,
            fileIndexHits: totalFileIndexHits,
            tokensUsed: totalUsed,
            tokensWithoutRecall: totalWithout,
            tokensSaved: Math.max(0, saved),
            reductionPercent: Math.max(0, percent),
        };
    }

    persistSession(): void {
        if (!this.store) { return; }
        if (this.session.searchHits === 0 && this.session.fileIndexHits === 0) { return; }

        const existing = this.store.getTokenStats();
        if (existing) {
            this.store.upsertTokenStats({
                search_hits: existing.search_hits + this.session.searchHits,
                file_index_hits: existing.file_index_hits + this.session.fileIndexHits,
                tokens_used: existing.tokens_used + this.session.tokensUsed,
                tokens_without_recall: existing.tokens_without_recall + this.session.tokensWithoutRecall,
            });
        } else {
            this.store.upsertTokenStats({
                search_hits: this.session.searchHits,
                file_index_hits: this.session.fileIndexHits,
                tokens_used: this.session.tokensUsed,
                tokens_without_recall: this.session.tokensWithoutRecall,
            });
        }

        this.session = { searchHits: 0, fileIndexHits: 0, tokensUsed: 0, tokensWithoutRecall: 0 };
    }
}
