import * as vscode from 'vscode';
import { RecallDatabase } from '../db';
import { embed, isReady } from '../embeddings';

interface AskInput {
    question: string;
    options?: string[];
    allowCustom?: boolean;
    reusable?: boolean;
    tags?: string;
}

const CUSTOM_LABEL = '$(edit) Other (type a custom answer)…';

export class RecallAskTool implements vscode.LanguageModelTool<AskInput> {

    constructor(private db: RecallDatabase) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<AskInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {

        const {
            question,
            options: choices = [],
            allowCustom = true,
            reusable = false,
            tags = '',
        } = options.input;

        if (token.isCancellationRequested) {
            return this.declined(question);
        }

        let answer: string | undefined;

        if (choices.length > 0) {
            const items: vscode.QuickPickItem[] = choices.map(c => ({ label: c }));
            if (allowCustom) {
                items.push({ label: CUSTOM_LABEL });
            }

            const picked = await vscode.window.showQuickPick(items, {
                title: 'Recall — Copilot needs your input',
                placeHolder: question,
                ignoreFocusOut: true,
            });

            if (picked === undefined) {
                return this.declined(question);
            }

            if (picked.label === CUSTOM_LABEL) {
                answer = await vscode.window.showInputBox({
                    title: question,
                    prompt: 'Type your answer',
                    ignoreFocusOut: true,
                });
            } else {
                answer = picked.label;
            }
        } else {
            answer = await vscode.window.showInputBox({
                title: 'Recall — Copilot needs your input',
                prompt: question,
                ignoreFocusOut: true,
            });
        }

        if (answer === undefined || answer.trim() === '') {
            return this.declined(question);
        }

        answer = answer.trim();

        let savedNote = '';
        if (reusable) {
            const id = await this.saveAnswer(question, answer, tags);
            savedNote = ` This answer was saved as verified observation #${id} for future sessions.`;
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `The developer answered: "${answer}". This is ground truth — ` +
                `proceed using this answer and do not re-question it.${savedNote}`
            )
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<AskInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const q = options.input.question;
        const preview = q.length > 80 ? q.substring(0, 80) + '...' : q;
        return { invocationMessage: `Asking you: "${preview}"` };
    }

    private async saveAnswer(question: string, answer: string, tags: string): Promise<number> {
        const content = `Decision (developer-confirmed): ${question} → ${answer}`;
        const id = this.db.insertObservation(content, tags, 'user', 'verified');

        if (isReady()) {
            try {
                const vec = await embed(content);
                this.db.storeEmbedding(id, vec);
            } catch (err) {
                console.error(`[Recall] Failed to embed answer observation #${id}:`, err);
            }
        }

        return id;
    }

    private declined(question: string): vscode.LanguageModelToolResult {
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `The developer dismissed the question "${question}" without answering. ` +
                `Proceed using your best judgment, state the assumption you are making, ` +
                `and continue. Do not block waiting for an answer.`
            )
        ]);
    }
}
