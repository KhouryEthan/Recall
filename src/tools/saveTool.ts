import * as vscode from 'vscode';
import { RecallDatabase } from '../db';
import { embed, cosineSimilarity, isReady, embedObservation } from '../embeddings';

export class RecallSaveTool implements vscode.LanguageModelTool<{ content: string; tags?: string }> {

    private statusBarItem: vscode.StatusBarItem | undefined;

    constructor(private db: RecallDatabase) {}

    setStatusBarItem(item: vscode.StatusBarItem): void {
        this.statusBarItem = item;
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ content: string; tags?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {

        const { content, tags } = options.input;
        const tagStr = tags || '';

        // Copilot-sourced observations are always saved as pending
        const id = this.db.insertObservation(content, tagStr, 'copilot', 'pending');

        let relatedText = '';
        if (isReady()) {
            try {
                const vec = await embed(content);
                this.db.storeEmbedding(id, vec);

                const allEmbedded = this.db.getAllWithEmbeddings();
                const related = allEmbedded
                    .filter(o => o.id !== id)
                    .map(o => ({ id: o.id, score: cosineSimilarity(vec, o.embedding) }))
                    .filter(o => o.score > 0.75)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 3);

                if (related.length > 0) {
                    relatedText = ` Related existing observations: ${related.map(r => `#${r.id} (${r.score.toFixed(2)} similarity)`).join(', ')}.`;
                }
            } catch (err) {
                console.error(`[Recall] Failed to embed/compare observation #${id}:`, err);
            }
        }

        this.updateStatusBar();
        this.showVerificationNotification(id, content);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Observation #${id} saved as PENDING. The developer should verify it after testing. ` +
                `It will appear in search results marked with ⏳ until confirmed.${relatedText}`
            )
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ content: string; tags?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const preview = options.input.content.substring(0, 80);
        return {
            invocationMessage: `Saving observation: "${preview}${options.input.content.length > 80 ? '...' : ''}"`,
        };
    }

    private async showVerificationNotification(id: number, content: string): Promise<void> {
        const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
        const action = await vscode.window.showInformationMessage(
            `💾 Pending observation #${id} — verify after testing`,
            { detail: truncated, modal: false },
            'Verified — It Works',
            'Edit & Save',
            'Discard'
        );

        if (action === 'Verified — It Works') {
            this.db.updateStatus(id, 'verified');
            vscode.window.showInformationMessage(`✓ Observation #${id} verified.`);
        } else if (action === 'Edit & Save') {
            const edited = await vscode.window.showInputBox({
                value: content,
                prompt: `Edit observation #${id} before saving as verified`,
                ignoreFocusOut: true,
            });
            if (edited && edited.trim() !== '') {
                this.db.updateContent(id, edited);
                this.db.updateStatus(id, 'verified');
                vscode.window.showInformationMessage(`✓ Observation #${id} edited and verified.`);
            }
        } else if (action === 'Discard') {
            this.db.deleteObservation(id);
            vscode.window.showInformationMessage(`✗ Observation #${id} discarded.`);
        }
        // If dismissed → stays pending, reviewable via @recall pending

        this.updateStatusBar();
    }

    updateStatusBar(): void {
        if (!this.statusBarItem) { return; }
        const pending = this.db.getPendingObservations();
        if (pending.length > 0) {
            this.statusBarItem.text = `$(clock) ${pending.length} pending`;
            this.statusBarItem.tooltip = `Recall: ${pending.length} observation(s) awaiting verification`;
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }
}
