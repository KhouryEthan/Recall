import * as vscode from 'vscode';
import { RecallDatabase } from './db';
import { cosineSimilarity } from './embeddings';

interface Cluster {
    representative: { id: number; content: string };
    duplicates: Array<{ id: number; content: string; score: number }>;
}

export async function deduplicateMemory(db: RecallDatabase): Promise<void> {
    const all = db.getAllWithEmbeddings();
    if (all.length < 2) {
        vscode.window.showInformationMessage('Recall: Not enough embedded observations to check for duplicates.');
        return;
    }

    const clusters: Cluster[] = [];
    const clustered = new Set<number>();

    for (let i = 0; i < all.length; i++) {
        if (clustered.has(all[i].id)) { continue; }
        const dupes: Cluster['duplicates'] = [];

        for (let j = i + 1; j < all.length; j++) {
            if (clustered.has(all[j].id)) { continue; }
            const score = cosineSimilarity(all[i].embedding, all[j].embedding);
            if (score > 0.92) {
                dupes.push({ id: all[j].id, content: all[j].content, score });
                clustered.add(all[j].id);
            }
        }

        if (dupes.length > 0) {
            clustered.add(all[i].id);
            clusters.push({
                representative: { id: all[i].id, content: all[i].content },
                duplicates: dupes,
            });
        }
    }

    if (clusters.length === 0) {
        vscode.window.showInformationMessage('Recall: No duplicate observations found.');
        return;
    }

    const totalDupes = clusters.reduce((sum, c) => sum + c.duplicates.length, 0);

    for (const cluster of clusters) {
        const allInCluster = [cluster.representative, ...cluster.duplicates];
        const keeper = allInCluster.reduce((best, cur) =>
            cur.content.length > best.content.length ? cur : best
        );

        const lines = allInCluster.map(o => {
            const tag = o.id === keeper.id ? '  ★ KEEP' : '  ✗ remove';
            const preview = o.content.length > 80 ? o.content.substring(0, 80) + '...' : o.content;
            return `#${o.id}${tag}: ${preview}`;
        });

        const action = await vscode.window.showQuickPick(
            ['Merge (keep longest, delete rest)', 'Skip this cluster'],
            {
                placeHolder: `${allInCluster.length} similar observations — preview below`,
                title: lines.join('\n'),
            }
        );

        if (action === 'Merge (keep longest, delete rest)') {
            for (const o of allInCluster) {
                if (o.id !== keeper.id) {
                    db.deleteObservation(o.id);
                }
            }
            vscode.window.showInformationMessage(
                `Merged cluster: kept #${keeper.id}, deleted ${allInCluster.length - 1} duplicate(s).`
            );
        }
    }

    vscode.window.showInformationMessage(
        `Recall: Deduplication complete. Found ${clusters.length} cluster(s) with ${totalDupes} potential duplicate(s).`
    );
}
