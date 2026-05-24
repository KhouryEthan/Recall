import * as vscode from 'vscode';
import { RecallDatabase, Observation } from './db';

export class ContextHints {
    private statusBarItem: vscode.StatusBarItem;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private disposables: vscode.Disposable[] = [];
    private lastResults: Observation[] = [];

    constructor(private db: RecallDatabase) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        this.statusBarItem.command = 'recall.showContextHints';
    }

    activate(context: vscode.ExtensionContext): void {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.scheduleUpdate()),
            vscode.commands.registerCommand('recall.showContextHints', () => this.showQuickPick()),
            this.statusBarItem,
        );

        context.subscriptions.push(...this.disposables);

        // Initial check for the currently active editor
        this.scheduleUpdate();
    }

    private scheduleUpdate(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.debounceTimer = setTimeout(() => this.update(), 300);
    }

    private update(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.statusBarItem.hide();
            this.lastResults = [];
            return;
        }

        const filename = editor.document.uri.fsPath.split(/[/\\]/).pop() || '';
        if (!filename) {
            this.statusBarItem.hide();
            this.lastResults = [];
            return;
        }

        const results = this.db.searchObservations(filename, undefined, 5);
        this.lastResults = results;

        if (results.length === 0) {
            this.statusBarItem.hide();
            return;
        }

        this.statusBarItem.text = `$(brain) ${results.length} observation${results.length === 1 ? '' : 's'}`;

        const tooltipLines = results.slice(0, 3).map(o => {
            const preview = o.content.length > 60 ? o.content.substring(0, 60) + '...' : o.content;
            return `#${o.id}: ${preview}`;
        });
        if (results.length > 3) {
            tooltipLines.push(`...and ${results.length - 3} more`);
        }
        this.statusBarItem.tooltip = `Recall: observations for ${filename}\n${tooltipLines.join('\n')}`;
        this.statusBarItem.show();
    }

    private async showQuickPick(): Promise<void> {
        if (this.lastResults.length === 0) {
            vscode.window.showInformationMessage('Recall: No observations for the current file.');
            return;
        }

        const items = this.lastResults.map(o => ({
            label: `#${o.id}  ${o.status === 'verified' ? '✓' : '⏳'}  ${o.source}`,
            description: o.tags ? `[${o.tags}]` : '',
            detail: o.content,
            id: o.id,
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an observation to view',
            matchOnDetail: true,
        });

        if (picked) {
            const obs = this.db.getObservationById(picked.id);
            if (obs) {
                const doc = await vscode.workspace.openTextDocument({
                    content: `Observation #${obs.id}\nStatus: ${obs.status}\nSource: ${obs.source}\nTags: ${obs.tags || '(none)'}\nCreated: ${obs.created_at}\n\n${obs.content}`,
                    language: 'markdown',
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        }
    }

    dispose(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        for (const d of this.disposables) { d.dispose(); }
    }
}
