import * as vscode from 'vscode';
import { RecallDatabase, Observation } from './db';
import { embed, cosineSimilarity, isReady } from './embeddings';

export interface HybridSearchResult extends Observation {
    semanticOnly: boolean;
    similarityScore?: number;
}

/**
 * Shared hybrid search: FTS5 keyword match + semantic cosine similarity.
 * Used by both the Copilot LM tool and the @recall chat participant.
 *
 * When currentProject is provided, results from that project are floated
 * to the top of the list. Cross-project results still appear after, so
 * broadly applicable insights are never siloed.
 */
export async function hybridSearch(
    db: RecallDatabase,
    query: string,
    tags?: string,
    limit?: number,
    currentProject?: string
): Promise<HybridSearchResult[]> {
    const maxResults = limit || vscode.workspace.getConfiguration('recall').get<number>('maxSearchResults', 10);

    // Fetch more candidates than needed so we have enough after project-sorting
    const fetchLimit = Math.min(maxResults * 3, 50);

    const ftsResults = db.searchObservations(query, tags, fetchLimit);

    let semanticResults: Array<{ id: number; content: string; tags: string; source: string; status: string; created_at: string; project: string; score: number }> = [];
    if (isReady()) {
        try {
            const queryEmbedding = await embed(query);
            const allEmbedded = db.getAllWithEmbeddings();

            const scored = allEmbedded
                .map(obs => ({ ...obs, score: cosineSimilarity(queryEmbedding, obs.embedding) }))
                .filter(obs => obs.score > 0.3)
                .sort((a, b) => b.score - a.score)
                .slice(0, fetchLimit);

            if (tags && tags.trim() !== '') {
                const tagList = tags.split(',').map(t => t.trim().toLowerCase());
                semanticResults = scored.filter(obs =>
                    tagList.every(t => obs.tags.toLowerCase().includes(t))
                );
            } else {
                semanticResults = scored;
            }
        } catch (err) {
            console.error('[Recall] Semantic search failed, using FTS only:', err);
        }
    }

    const seenIds = new Set(ftsResults.map(r => r.id));

    const merged: HybridSearchResult[] = ftsResults.map(r => ({
        ...r,
        semanticOnly: false,
        similarityScore: semanticResults.find(s => s.id === r.id)?.score,
    }));

    for (const sem of semanticResults) {
        if (!seenIds.has(sem.id)) {
            seenIds.add(sem.id);
            merged.push({
                id: sem.id, content: sem.content, tags: sem.tags,
                project: sem.project || '', source: sem.source, status: sem.status, created_at: sem.created_at,
                semanticOnly: true,
                similarityScore: sem.score,
            });
        }
    }

    // Float current-project results to the top, keeping cross-project results after
    if (currentProject) {
        const projectHits = merged.filter(r => r.project === currentProject);
        const otherHits = merged.filter(r => r.project !== currentProject);
        return [...projectHits, ...otherHits].slice(0, maxResults);
    }

    return merged.slice(0, maxResults);
}
