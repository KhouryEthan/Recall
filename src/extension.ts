import * as vscode from 'vscode';
import { RecallDatabase } from './db';
import { RecallSearchTool } from './tools/searchTool';
import { RecallSaveTool } from './tools/saveTool';
import { RecallFileIndexTool } from './tools/fileIndexTool';
import { RecallChatParticipant } from './chatParticipant';
import { PassiveCapture } from './passive';
import { FileIndexBuilder } from './fileIndex';
import { RecallUI } from './ui';
import { RecallSidebarProvider } from './sidebarProvider';
import { initEmbeddings, embed, isReady } from './embeddings';
import { setupRepository } from './setupRepository';
import { deduplicateMemory } from './deduplication';
import { ContextHints } from './contextHints';

let db: RecallDatabase;
let passiveCapture: PassiveCapture;
let fileIndexBuilder: FileIndexBuilder;
let recallUI: RecallUI;
let contextHints: ContextHints;

export function activate(context: vscode.ExtensionContext): void {
    console.log('[Recall] Activating...');

    // ─── Initialize Database ─────────────────────────────────────────────
    const customPath = vscode.workspace.getConfiguration('recall').get<string>('databasePath', '');
    try {
        db = new RecallDatabase(customPath || undefined);
        console.log(`[Recall] Database opened at: ${db.getDbPath()}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Recall: Failed to open database — ${err}`);
        console.error('[Recall] Database initialization failed:', err);
        return;
    }

    // Expire old pending observations on startup
    const expirationDays = vscode.workspace.getConfiguration('recall').get<number>('pendingExpirationDays', 7);
    const expired = db.expirePendingObservations(expirationDays);
    if (expired > 0) {
        console.log(`[Recall] Expired ${expired} pending observation(s) older than ${expirationDays} days.`);
    }

    // ─── Register Language Model Tools ───────────────────────────────────
    const searchTool = new RecallSearchTool(db);
    const saveTool = new RecallSaveTool(db);
    const fileIndexTool = new RecallFileIndexTool(db);

    // Log available tools before registration for diagnostics
    console.log(`[Recall] Available LM tools before registration: ${vscode.lm.tools.map(t => t.name).join(', ') || '(none)'}`);

    const toolRegistrations: Array<[string, vscode.LanguageModelTool<any>]> = [
        ['recall_search', searchTool],
        ['recall_save', saveTool],
        ['recall_file_index', fileIndexTool],
    ];

    for (const [name, tool] of toolRegistrations) {
        try {
            context.subscriptions.push(vscode.lm.registerTool(name, tool));
            console.log(`[Recall] Registered tool: ${name}`);
        } catch (err) {
            console.error(`[Recall] Failed to register tool "${name}": ${err}`);
            console.error(`[Recall] This may be a VS Code version or Remote-SSH contribution sync issue.`);
        }
    }

    // Log available tools after registration attempts
    console.log(`[Recall] Available LM tools after registration: ${vscode.lm.tools.map(t => t.name).join(', ') || '(none)'}`);

    // ─── Register Chat Participant ───────────────────────────────────────
    const chatParticipant = new RecallChatParticipant(db);
    const participant = vscode.chat.createChatParticipant(
        'recall.participant',
        (request, context, stream, token) => chatParticipant.handleRequest(request, context, stream, token)
    );
    participant.iconPath = new vscode.ThemeIcon('brain');
    context.subscriptions.push(participant);
    console.log('[Recall] Chat participant @recall registered.');

    // ─── File Index Builder ──────────────────────────────────────────────
    fileIndexBuilder = new FileIndexBuilder(db);
    fileIndexBuilder.activate(context);
    console.log('[Recall] File index builder activated.');

    // ─── Passive Event Capture ───────────────────────────────────────────
    passiveCapture = new PassiveCapture(db);
    passiveCapture.activate(context);
    console.log('[Recall] Passive capture activated.');

    // ─── UI Components ───────────────────────────────────────────────────
    recallUI = new RecallUI(db, fileIndexBuilder, saveTool);
    recallUI.activate(context);
    console.log('[Recall] UI components activated.');

    // ─── Sidebar Dashboard View ──────────────────────────────────────────
    const sidebarProvider = new RecallSidebarProvider(context.extensionUri, db);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('recall.dashboardView', sidebarProvider)
    );
    // Keep a reference so other parts can refresh it
    recallUI.setSidebarProvider(sidebarProvider);
    console.log('[Recall] Sidebar dashboard registered.');

    // ─── Context-Aware Auto-Search Hints ─────────────────────────────────
    contextHints = new ContextHints(db);
    contextHints.activate(context);
    console.log('[Recall] Context hints activated.');

    // ─── Semantic Embeddings ─────────────────────────────────────────────
    initEmbeddings(context.extensionPath).then(() => {
        console.log('[Recall] Embedding model loaded — semantic search enabled.');
    }).catch(err => {
        console.warn('[Recall] Embedding model not available — semantic search disabled:', err);
    });

    // ─── Reindex Embeddings Command ──────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('recall.reindexEmbeddings', async () => {
            if (!isReady()) {
                vscode.window.showWarningMessage('Recall: Embedding model not loaded yet. Try again in a moment.');
                return;
            }
            const missing = db.getObservationsWithoutEmbeddings();
            if (missing.length === 0) {
                vscode.window.showInformationMessage('Recall: All observations already have embeddings.');
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Recall: Embedding ${missing.length} observation(s)...`,
                cancellable: true,
            }, async (progress, token) => {
                let done = 0;
                for (const obs of missing) {
                    if (token.isCancellationRequested) { break; }
                    try {
                        const vec = await embed(obs.content);
                        db.storeEmbedding(obs.id, vec);
                    } catch (err) {
                        console.error(`[Recall] Failed to embed #${obs.id}:`, err);
                    }
                    done++;
                    progress.report({ increment: (100 / missing.length), message: `${done}/${missing.length}` });
                }
                const msg = await vscode.window.showInformationMessage(
                    `Recall: Embedded ${done} observation(s). Check for duplicates?`,
                    'Deduplicate', 'Skip'
                );
                if (msg === 'Deduplicate') {
                    vscode.commands.executeCommand('recall.deduplicateMemory');
                }
            });
        })
    );

    // ─── Deduplicate Memory Command ──────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('recall.deduplicateMemory', () => deduplicateMemory(db))
    );

    // ─── Setup Repository Command ─────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('recall.setupRepository', () => setupRepository(context.extensionPath))
    );

    // ─── Diagnostics Command ─────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('recall.diagnostics', async () => {
            const tools = vscode.lm.tools;
            const lines: string[] = [
                `Recall Diagnostics — ${new Date().toISOString()}`,
                `VS Code version: ${vscode.version}`,
                `Extension ID: ${context.extension.id}`,
                `Extension path: ${context.extensionPath}`,
                `Database path: ${db.getDbPath()}`,
                ``,
                `=== Registered LM Tools (${tools.length}) ===`,
            ];
            for (const t of tools) {
                lines.push(`  name: ${t.name}`);
                lines.push(`  description: ${t.description}`);
                lines.push(`  tags: ${t.tags?.join(',') || '(none)'}`);
                lines.push(``);
            }
            const recallTools = tools.filter(t => t.name.includes('recall'));
            lines.push(`=== Recall Tools Found: ${recallTools.length} ===`);
            for (const t of recallTools) {
                lines.push(`  ${t.name}`);
            }

            const content = lines.join('\n');
            const doc = await vscode.workspace.openTextDocument({ content, language: 'text' });
            await vscode.window.showTextDocument(doc);
        })
    );

    // ─── Startup notification ────────────────────────────────────────────
    const stats = db.getStats();
    console.log(
        `[Recall] Ready — ${stats.totalObservations} observations, ` +
        `${stats.totalFilesIndexed} files indexed, ` +
        `${stats.pendingObservations} pending.`
    );

    // Show welcome on first activation (no observations and no index)
    if (stats.totalObservations === 0 && stats.totalFilesIndexed === 0) {
        showWelcomeMessage();
    }
}

function showWelcomeMessage(): void {
    vscode.window.showInformationMessage(
        '🧠 Recall is active! Memory starts building automatically as you work. ' +
        'Use @recall in chat or Ctrl+Shift+M to save observations manually.',
        'Open Dashboard',
        'Got it'
    ).then(action => {
        if (action === 'Open Dashboard') {
            vscode.commands.executeCommand('recall.openDashboard');
        }
    });
}

export function deactivate(): void {
    console.log('[Recall] Deactivating...');

    if (passiveCapture) {
        passiveCapture.dispose();
    }
    if (fileIndexBuilder) {
        fileIndexBuilder.dispose();
    }
    if (recallUI) {
        recallUI.dispose();
    }
    if (contextHints) {
        contextHints.dispose();
    }
    if (db) {
        db.close();
    }

    console.log('[Recall] Deactivated.');
}
