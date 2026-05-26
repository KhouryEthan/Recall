import * as vscode from 'vscode';
import { RecallDatabase, Observation } from './db';
import { FileIndexBuilder } from './fileIndex';
import { RecallSaveTool } from './tools/saveTool';

import { RecallSidebarProvider } from './sidebarProvider';
import { embedObservation } from './embeddings';

/**
 * UI components: quick-save keybinding, status bar, commands, dashboard webview.
 */
export class RecallUI {
    private statusBarItem: vscode.StatusBarItem;
    private sidebarProvider?: RecallSidebarProvider;

    constructor(
        private db: RecallDatabase,
        private fileIndexBuilder: FileIndexBuilder,
        private saveTool: RecallSaveTool,
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'recall.showPending';

        // Connect status bar to the save tool
        this.saveTool.setStatusBarItem(this.statusBarItem);
    }

    activate(context: vscode.ExtensionContext): void {
        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('recall.quickSave', () => this.quickSave()),
            vscode.commands.registerCommand('recall.showPending', () => this.showPending()),
            vscode.commands.registerCommand('recall.reindexFile', () => this.reindexCurrentFile()),
            vscode.commands.registerCommand('recall.reindexWorkspace', () => this.reindexWorkspace()),
            vscode.commands.registerCommand('recall.stats', () => this.showStats()),
            vscode.commands.registerCommand('recall.exportMemory', () => this.exportMemory()),
            vscode.commands.registerCommand('recall.importMemory', () => this.importMemory()),
            vscode.commands.registerCommand('recall.openDashboard', () => this.openDashboard(context)),
            this.statusBarItem,
        );

        // Update status bar on activation
        this.saveTool.updateStatusBar();
    }

    setSidebarProvider(provider: RecallSidebarProvider): void {
        this.sidebarProvider = provider;
    }

    // ─── Quick Save (Ctrl+Shift+M) ───────────────────────────────────────

    private async quickSave(): Promise<void> {
        const content = await vscode.window.showInputBox({
            prompt: '🧠 Recall: Save an observation',
            placeHolder: 'What did you discover? e.g., "useAuth hook causes double render on token refresh"',
            ignoreFocusOut: true,
        });

        if (!content || content.trim() === '') { return; }

        const tags = await vscode.window.showInputBox({
            prompt: 'Tags (optional, comma-separated)',
            placeHolder: 'e.g., auth,bugfix,api',
        });

        const id = this.db.insertObservation(content, tags || '', 'manual', 'verified');
        embedObservation(this.db, id, content);
        vscode.window.showInformationMessage(`✅ Observation #${id} saved.`);
    }

    // ─── Show Pending ─────────────────────────────────────────────────────

    private async showPending(): Promise<void> {
        const pending = this.db.getPendingObservations();

        if (pending.length === 0) {
            vscode.window.showInformationMessage('✅ No pending observations.');
            return;
        }

        // Show a quick pick with all pending observations
        const items = pending.map(obs => ({
            label: `#${obs.id}  ⏳  ${obs.content.substring(0, 80)}${obs.content.length > 80 ? '...' : ''}`,
            description: obs.tags ? `[${obs.tags}]` : '',
            detail: obs.content,
            id: obs.id,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${pending.length} pending observation(s) — select one to verify/edit/discard`,
            matchOnDetail: true,
        });

        if (!selected) { return; }

        const action = await vscode.window.showQuickPick(
            ['✓ Verify — It Works', '✏️ Edit & Save', '🗑️ Discard'],
            { placeHolder: `Action for observation #${selected.id}` }
        );

        if (action?.startsWith('✓')) {
            this.db.updateStatus(selected.id, 'verified');
            vscode.window.showInformationMessage(`✓ Observation #${selected.id} verified.`);
        } else if (action?.startsWith('✏️')) {
            const edited = await vscode.window.showInputBox({
                value: selected.detail,
                prompt: `Edit observation #${selected.id}`,
                ignoreFocusOut: true,
            });
            if (edited && edited.trim() !== '') {
                this.db.updateContent(selected.id, edited);
                this.db.updateStatus(selected.id, 'verified');
                vscode.window.showInformationMessage(`✏️ Observation #${selected.id} updated and verified.`);
            }
        } else if (action?.startsWith('🗑️')) {
            this.db.deleteObservation(selected.id);
            vscode.window.showInformationMessage(`🗑️ Observation #${selected.id} discarded.`);
        }

        this.saveTool.updateStatusBar();
    }

    // ─── Re-index Current File ────────────────────────────────────────────

    private async reindexCurrentFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        try {
            await this.fileIndexBuilder.indexDocument(editor.document);
            vscode.window.showInformationMessage(`✅ Re-indexed: ${editor.document.uri.fsPath.split('/').pop()}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to re-index: ${err}`);
        }
    }

    // ─── Re-index Workspace ───────────────────────────────────────────────

    private async reindexWorkspace(): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Recall: Re-indexing workspace...',
                cancellable: false,
            },
            async (progress) => {
                const count = await this.fileIndexBuilder.indexWorkspace(progress);
                vscode.window.showInformationMessage(`✅ Recall: Indexed ${count} file(s).`);
            }
        );
    }

    // ─── Show Stats ───────────────────────────────────────────────────────

    private async showStats(): Promise<void> {
        const stats = this.db.getStats();
        const sizeKB = Math.round(stats.dbSizeBytes / 1024);

        const lines = [
            `📊 Recall Database Statistics`,
            ``,
            `Observations: ${stats.totalObservations} (${stats.verifiedObservations} verified, ${stats.pendingObservations} pending)`,
            `Files indexed: ${stats.totalFilesIndexed}`,
            `Total symbols tracked: ${stats.totalSymbols}`,
            `Database size: ${sizeKB} KB`,
            `Database path: ${this.db.getDbPath()}`,
        ];

        if (stats.topTags.length > 0) {
            lines.push(``, `Top tags: ${stats.topTags.map(t => `${t.tag}(${t.count})`).join(', ')}`);
        }

        vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
    }

    // ─── Export Memory ────────────────────────────────────────────────────

    private async exportMemory(): Promise<void> {
        const data = this.db.exportAll();
        const json = JSON.stringify(data, null, 2);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('recall-export.json'),
            filters: { 'JSON': ['json'] },
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
            vscode.window.showInformationMessage(`📤 Exported to ${uri.fsPath}`);
        }
    }

    // ─── Import Memory ──────────────────────────────────────────────────

    async importMemory(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            title: 'Select Recall export file to import',
        });

        if (!uris || uris.length === 0) { return; }

        const raw = await vscode.workspace.fs.readFile(uris[0]);
        let data: any;
        try {
            data = JSON.parse(Buffer.from(raw).toString('utf-8'));
        } catch {
            vscode.window.showErrorMessage('Recall: Invalid JSON file.');
            return;
        }

        if (!data.observations || !Array.isArray(data.observations)) {
            vscode.window.showErrorMessage('Recall: Invalid Recall export format (missing observations array).');
            return;
        }

        const observations: Array<{ content: string; tags: string; source: string; status: string }> = data.observations;
        const fileIndex: Array<{ file_path: string; summary: string; symbols: string; line_count: number }> = data.fileIndex || [];

        const confirm = await vscode.window.showInformationMessage(
            `Import ${observations.length} observation(s) and ${fileIndex.length} file index entries? Duplicates will be skipped.`,
            'Import', 'Cancel'
        );

        if (confirm !== 'Import') { return; }

        const existingContents = new Set(
            this.db.exportAll().observations.map(o => o.content)
        );

        let imported = 0;
        let skipped = 0;
        for (const obs of observations) {
            if (existingContents.has(obs.content)) {
                skipped++;
                continue;
            }
            const id = this.db.insertObservation(obs.content, obs.tags || '', 'import', obs.status || 'verified');
            embedObservation(this.db, id, obs.content);
            imported++;
        }

        let indexImported = 0;
        for (const entry of fileIndex) {
            try {
                const symbols = typeof entry.symbols === 'string' ? JSON.parse(entry.symbols) : entry.symbols;
                this.db.upsertFileIndex(entry.file_path, entry.summary || '', symbols, entry.line_count || 0);
                indexImported++;
            } catch {
                // skip malformed entry
            }
        }

        vscode.window.showInformationMessage(
            `📥 Imported ${imported} observation(s), ${indexImported} file entries. ${skipped} duplicate(s) skipped.`
        );
    }

    // ─── Dashboard Webview ────────────────────────────────────────────────

    private openDashboard(context: vscode.ExtensionContext): void {
        const panel = vscode.window.createWebviewPanel(
            'recallDashboard',
            'Recall Dashboard',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        const updateHtml = (tab?: string, filter?: { status?: string; tag?: string; search?: string }) => {
            panel.webview.html = this.getDashboardHtml(tab, filter);
        };

        updateHtml();

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'refresh':
                    updateHtml(message.tab, message.filter);
                    break;
                case 'verify':
                    this.db.updateStatus(message.id, 'verified');
                    updateHtml(message.tab, message.filter);
                    this.saveTool.updateStatusBar();
                    this.sidebarProvider?.refresh();
                    break;
                case 'reject':
                    this.db.updateStatus(message.id, 'rejected');
                    updateHtml(message.tab, message.filter);
                    this.saveTool.updateStatusBar();
                    this.sidebarProvider?.refresh();
                    break;
                case 'delete':
                    this.db.deleteObservation(message.id);
                    updateHtml(message.tab, message.filter);
                    this.saveTool.updateStatusBar();
                    this.sidebarProvider?.refresh();
                    break;
                case 'edit':
                    this.db.updateObservation(message.id, message.content, message.tags);
                    updateHtml(message.tab, message.filter);
                    this.sidebarProvider?.refresh();
                    break;
                case 'deleteFile':
                    // Remove file index entry
                    this.db.deleteFileIndexEntry(message.fileId);
                    updateHtml(message.tab, message.filter);
                    this.sidebarProvider?.refresh();
                    break;
            }
        }, undefined, context.subscriptions);
    }

    private getDashboardHtml(activeTab: string = 'overview', filter?: { status?: string; tag?: string; search?: string }): string {
        const stats = this.db.getStats();
        const allTags = this.db.getDistinctTags();
        const esc = (t: string) => this.escapeHtml(t);

        let tabContent = '';

        if (activeTab === 'overview') {
            const recent = this.db.getRecentObservations(15);
            const pending = this.db.getPendingObservations();

            const tagBadges = stats.topTags.map(t =>
                `<span class="tag clickable" data-action="filter-tag" data-tag="${esc(t.tag)}">${esc(t.tag)} <span class="tag-count">${t.count}</span></span>`
            ).join('');

            const pendingCards = pending.slice(0, 5).map(obs => this.renderDashboardCard(obs)).join('');

            const recentRows = recent.map(obs => `
                <tr class="row">
                    <td class="col-id">${obs.id}</td>
                    <td><span class="pill pill-${obs.status}">${obs.status}</span></td>
                    <td>${esc(obs.content.substring(0, 120))}${obs.content.length > 120 ? '...' : ''}</td>
                    <td class="col-tags">${obs.tags ? obs.tags.split(',').map(t => `<span class="tag-sm">${esc(t.trim())}</span>`).join('') : ''}</td>
                    <td class="col-source">${esc(obs.source)}</td>
                    <td class="col-date">${obs.created_at.split(' ')[0]}</td>
                </tr>
            `).join('');

            tabContent = `
                <div class="metrics">
                    <div class="metric-card clickable" data-action="tab" data-tab="observations">
                        <div class="metric-val">${stats.totalObservations}</div>
                        <div class="metric-lbl">observations</div>
                    </div>
                    <div class="metric-card clickable" data-action="tab" data-tab="observations" data-filter-status="verified">
                        <div class="metric-val green">${stats.verifiedObservations}</div>
                        <div class="metric-lbl">verified</div>
                    </div>
                    <div class="metric-card clickable" data-action="tab" data-tab="pending">
                        <div class="metric-val ${stats.pendingObservations > 0 ? 'amber' : ''}">${stats.pendingObservations}</div>
                        <div class="metric-lbl">pending</div>
                    </div>
                    <div class="metric-card clickable" data-action="tab" data-tab="files">
                        <div class="metric-val">${stats.totalFilesIndexed}</div>
                        <div class="metric-lbl">files indexed</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-val">${stats.totalSymbols}</div>
                        <div class="metric-lbl">symbols</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-val">${Math.round(stats.dbSizeBytes / 1024)} KB</div>
                        <div class="metric-lbl">database</div>
                    </div>
                </div>

                ${stats.topTags.length > 0 ? `<div class="section"><div class="section-title">Tags</div><div class="tag-row">${tagBadges}</div></div>` : ''}

                ${pending.length > 0 ? `
                    <div class="section">
                        <div class="section-title">Pending Verification <span class="count-badge">${pending.length}</span></div>
                        <div class="section-sub">Saved by Copilot — verify after testing.</div>
                        <div class="card-grid">${pendingCards}</div>
                    </div>
                ` : ''}

                <div class="section">
                    <div class="section-title">Recent</div>
                    <table>
                        <thead><tr><th>#</th><th>Status</th><th>Content</th><th>Tags</th><th>Source</th><th>Date</th></tr></thead>
                        <tbody>${recentRows || '<tr><td colspan="6" class="empty-row">No observations yet.</td></tr>'}</tbody>
                    </table>
                </div>
            `;
        } else if (activeTab === 'observations' || activeTab === 'pending') {
            const statusFilter = activeTab === 'pending' ? 'pending' : filter?.status;
            const observations = this.db.getAllObservations({ status: statusFilter, tag: filter?.tag });

            // Filter by search text client-side
            let filtered = observations;
            if (filter?.search) {
                const q = filter.search.toLowerCase();
                filtered = observations.filter(o =>
                    o.content.toLowerCase().includes(q) || o.tags.toLowerCase().includes(q)
                );
            }

            const statusOptions = ['', 'verified', 'pending', 'rejected'].map(s =>
                `<option value="${s}" ${(filter?.status || '') === s ? 'selected' : ''}>${s || 'All statuses'}</option>`
            ).join('');
            const tagOptions = ['', ...allTags].map(t =>
                `<option value="${esc(t)}" ${(filter?.tag || '') === t ? 'selected' : ''}>${t || 'All tags'}</option>`
            ).join('');

            const filterBar = activeTab === 'pending' ? '' : `
                <div class="filter-bar">
                    <select id="filter-status" class="filter-select" data-action="filter">${statusOptions}</select>
                    <select id="filter-tag" class="filter-select" data-action="filter">${tagOptions}</select>
                    <input id="filter-search" class="filter-input" placeholder="Search content…" value="${esc(filter?.search || '')}" data-action="filter">
                    <span class="filter-count">${filtered.length} result${filtered.length !== 1 ? 's' : ''}</span>
                </div>
            `;

            const cards = filtered.map(obs => this.renderDashboardCard(obs)).join('');

            tabContent = `
                ${filterBar}
                <div class="card-list">${cards || '<div class="empty">No matching observations.</div>'}</div>
            `;
        } else if (activeTab === 'files') {
            const files = this.db.getAllFileIndexEntries();

            const fileCards = files.map(fe => {
                const fileName = fe.file_path.split('/').pop() || fe.file_path;
                const symbols: Array<{ name: string; type: string; line: number }> = (() => {
                    try { return JSON.parse(fe.symbols); } catch { return []; }
                })();
                return `
                    <div class="file-card">
                        <div class="file-header">
                            <span class="file-name">${esc(fileName)}</span>
                            <button class="btn btn-sm btn-danger" data-action="delete-file" data-file-id="${fe.id}">Remove</button>
                        </div>
                        <div class="file-path">${esc(fe.file_path)}</div>
                        <div class="file-meta">
                            <span>${fe.line_count} lines</span>
                            <span>${symbols.length} symbols</span>
                            <span>${fe.last_indexed}</span>
                        </div>
                        ${fe.summary ? `<div class="file-summary">${esc(fe.summary)}</div>` : ''}
                        ${symbols.length > 0 ? `
                            <details class="sym-detail">
                                <summary>${symbols.length} symbols</summary>
                                <div class="sym-list">
                                    ${symbols.slice(0, 30).map(s => `
                                        <span class="sym-item"><span class="sym-type">${esc(s.type)}</span> ${esc(s.name)} <span class="sym-line">:${s.line}</span></span>
                                    `).join('')}
                                    ${symbols.length > 30 ? `<span class="sym-more">+ ${symbols.length - 30} more</span>` : ''}
                                </div>
                            </details>
                        ` : ''}
                    </div>
                `;
            }).join('');

            tabContent = `
                <div class="filter-count" style="margin-bottom: 12px;">${files.length} file${files.length !== 1 ? 's' : ''} indexed</div>
                <div class="card-list">${fileCards || '<div class="empty">No files indexed yet.</div>'}</div>
            `;
        }

        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recall</title>
<style>
:root {
    --radius: 6px;
    --border: 1px solid color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    --surface: color-mix(in srgb, var(--vscode-foreground) 3%, var(--vscode-editor-background));
    --surface-raised: color-mix(in srgb, var(--vscode-foreground) 5%, var(--vscode-editor-background));
    --surface-hover: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-editor-background));
    --text-primary: var(--vscode-foreground);
    --text-secondary: color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
    --text-tertiary: color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
    --green: var(--vscode-testing-iconPassed);
    --amber: #d19a00;
    --red: var(--vscode-testing-iconFailed);
    --accent: var(--vscode-focusBorder);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', var(--vscode-font-family), system-ui, sans-serif;
    color: var(--text-primary); background: var(--vscode-editor-background);
    font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}

/* ── Layout ── */
.header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 32px; border-bottom: var(--border);
    position: sticky; top: 0; z-index: 10; background: var(--vscode-editor-background);
}
.header h1 { font-size: 16px; font-weight: 600; letter-spacing: -0.3px; }
.nav {
    display: flex; gap: 0; padding: 0 32px; border-bottom: var(--border);
    position: sticky; top: 57px; z-index: 10; background: var(--vscode-editor-background);
}
.nav-item {
    padding: 10px 14px; font-size: 13px; cursor: pointer;
    border-bottom: 2px solid transparent; color: var(--text-secondary);
    transition: color 0.12s; font-weight: 450;
}
.nav-item:hover { color: var(--text-primary); }
.nav-item.active { color: var(--text-primary); border-bottom-color: var(--accent); font-weight: 550; }
.nav-badge {
    display: inline-block; background: var(--amber); color: #fff;
    font-size: 10px; padding: 0 5px; border-radius: 6px; margin-left: 5px;
    line-height: 15px; font-weight: 600;
}
.main { padding: 24px 32px; max-width: 960px; }

/* ── Metrics ── */
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 28px; }
.metric-card {
    background: var(--surface); border: var(--border); border-radius: var(--radius);
    padding: 16px; text-align: center; transition: border-color 0.12s;
}
.metric-card.clickable { cursor: pointer; }
.metric-card.clickable:hover { border-color: var(--accent); }
.metric-val { font-size: 24px; font-weight: 600; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
.metric-val.green { color: var(--green); }
.metric-val.amber { color: var(--amber); }
.metric-lbl { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; text-transform: lowercase; }

/* ── Sections ── */
.section { margin-bottom: 28px; }
.section-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--text-secondary); }
.section-sub { font-size: 12px; color: var(--text-tertiary); margin-bottom: 10px; }

/* ── Tags ── */
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tag {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--surface-raised); border: var(--border); padding: 3px 10px;
    border-radius: 4px; font-size: 12px; transition: border-color 0.12s;
}
.tag.clickable { cursor: pointer; }
.tag.clickable:hover { border-color: var(--accent); }
.tag-count { color: var(--text-tertiary); }
.tag-sm {
    display: inline-block; background: var(--surface-raised); padding: 1px 6px;
    border-radius: 3px; font-size: 10px; color: var(--text-secondary);
}

/* ── Table ── */
table { width: 100%; border-collapse: collapse; }
th {
    text-align: left; padding: 6px 10px; font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-tertiary);
    border-bottom: var(--border);
}
td { padding: 8px 10px; border-bottom: var(--border); vertical-align: top; font-size: 12px; }
tr.row { transition: background 0.08s; }
tr.row:hover { background: var(--surface); }
.col-id { width: 36px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.col-source { width: 70px; color: var(--text-tertiary); font-size: 11px; }
.col-date { width: 80px; color: var(--text-tertiary); font-size: 11px; }
.col-tags { width: 100px; }
.empty-row { text-align: center; padding: 24px; color: var(--text-tertiary); }

/* ── Status ── */
.pill {
    display: inline-block; padding: 1px 7px; border-radius: 3px;
    font-size: 10px; font-weight: 550; text-transform: uppercase; letter-spacing: 0.2px;
}
.pill-verified { background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--green); }
.pill-pending { background: color-mix(in srgb, var(--amber) 12%, transparent); color: var(--amber); }
.pill-rejected { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-verified { background: var(--green); }
.dot-pending { background: var(--amber); }
.dot-rejected { background: var(--red); }

/* ── Cards ── */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 10px; }
.card-list { display: flex; flex-direction: column; gap: 8px; }
.card {
    background: var(--surface); border: var(--border); border-radius: var(--radius);
    padding: 14px 16px; border-left: 3px solid transparent; transition: border-color 0.12s;
}
.card:hover { border-color: color-mix(in srgb, var(--vscode-foreground) 15%, transparent); }
.card.st-pending { border-left-color: var(--amber); }
.card.st-verified { border-left-color: var(--green); }
.card.st-rejected { border-left-color: var(--red); }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.card-id { font-size: 11px; color: var(--text-tertiary); font-weight: 500; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 6px; }
.card-src { font-size: 10px; color: var(--text-tertiary); }
.card-body { font-size: 12px; line-height: 1.65; margin: 6px 0; white-space: pre-wrap; word-break: break-word; }
.card-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.card-time { font-size: 10px; color: var(--text-tertiary); margin-top: 4px; }
.card-actions {
    display: flex; gap: 6px; margin-top: 10px; padding-top: 10px;
    border-top: var(--border); flex-wrap: wrap;
}

/* ── Buttons ── */
.btn {
    font-size: 11px; padding: 4px 10px; border-radius: 4px; cursor: pointer;
    border: var(--border); background: none; color: var(--text-secondary);
    font-weight: 500; transition: all 0.12s;
}
.btn:hover { color: var(--text-primary); background: var(--surface-hover); }
.btn-sm { font-size: 10px; padding: 2px 8px; }
.btn-primary { border-color: var(--green); color: var(--green); }
.btn-primary:hover { background: color-mix(in srgb, var(--green) 10%, transparent); }
.btn-danger, .btn-delete { border-color: var(--red); color: var(--red); }
.btn-danger:hover, .btn-delete:hover { background: color-mix(in srgb, var(--red) 10%, transparent); }
.btn-warn { border-color: var(--amber); color: var(--amber); }
.btn-warn:hover { background: color-mix(in srgb, var(--amber) 10%, transparent); }
.btn-fill {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
}
.btn-fill:hover { opacity: 0.9; }
.btn-cancel { border-color: transparent; }
.btn-refresh { background: var(--surface-raised); }

/* ── Edit ── */
.edit-area {
    width: 100%; min-height: 72px; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
    border-radius: 4px; padding: 8px 10px; font-family: inherit; font-size: 12px;
    resize: vertical; margin: 4px 0; line-height: 1.55;
}
.edit-input {
    width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 5px 10px;
    font-size: 12px; margin: 4px 0;
}
.edit-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-tertiary); margin-top: 6px; }

/* Confirm bar */
.confirm-bar {
    display: flex; align-items: center; gap: 8px; margin-top: 10px;
    padding: 8px 12px; background: color-mix(in srgb, var(--red) 8%, var(--surface)); border-radius: 4px;
}
.confirm-text { font-size: 12px; color: var(--text-secondary); flex: 1; }

/* ── Filters ── */
.filter-bar {
    display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px; background: var(--surface); border: var(--border); border-radius: var(--radius);
}
.filter-select, .filter-input {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 5px 8px; font-size: 12px;
}
.filter-input { flex: 1; min-width: 140px; }
.filter-count { font-size: 11px; color: var(--text-tertiary); margin-left: auto; }

/* ── File cards ── */
.file-card {
    background: var(--surface); border: var(--border); border-radius: var(--radius);
    padding: 12px 16px; border-left: 3px solid var(--accent);
}
.file-header { display: flex; justify-content: space-between; align-items: center; }
.file-name { font-weight: 600; font-size: 13px; }
.file-path { font-size: 11px; color: var(--text-tertiary); margin: 2px 0; word-break: break-all; }
.file-meta { display: flex; gap: 14px; font-size: 11px; color: var(--text-tertiary); margin-top: 6px; }
.file-summary { font-size: 12px; color: var(--text-secondary); margin-top: 6px; line-height: 1.55; }
details.sym-detail { margin-top: 8px; }
details.sym-detail summary { font-size: 11px; cursor: pointer; color: var(--text-tertiary); }
.sym-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.sym-item {
    display: inline-flex; gap: 3px; align-items: center;
    background: var(--surface-raised); padding: 2px 8px; border-radius: 3px; font-size: 11px;
}
.sym-type { font-size: 9px; color: var(--text-tertiary); text-transform: uppercase; }
.sym-line { color: var(--text-tertiary); font-size: 10px; }
.sym-more { font-size: 11px; color: var(--text-tertiary); padding: 2px 8px; }

.empty { text-align: center; padding: 40px 20px; color: var(--text-tertiary); font-size: 13px; }
.count-badge {
    display: inline-block; background: var(--amber); color: #fff;
    font-size: 11px; padding: 0 6px; border-radius: 8px; font-weight: 600; line-height: 18px; margin-left: 4px;
}
</style></head><body>
    <div class="header">
        <h1>Recall</h1>
        <button class="btn btn-refresh" data-action="refresh">Refresh</button>
    </div>

    <div class="nav">
        <div class="nav-item ${activeTab === 'overview' ? 'active' : ''}" data-action="tab" data-tab="overview">Overview</div>
        <div class="nav-item ${activeTab === 'pending' ? 'active' : ''}" data-action="tab" data-tab="pending">Pending${stats.pendingObservations > 0 ? `<span class="nav-badge">${stats.pendingObservations}</span>` : ''}</div>
        <div class="nav-item ${activeTab === 'observations' ? 'active' : ''}" data-action="tab" data-tab="observations">All Observations</div>
        <div class="nav-item ${activeTab === 'files' ? 'active' : ''}" data-action="tab" data-tab="files">File Index</div>
    </div>

    <div class="main">${tabContent}</div>

<script>
    const vscode = acquireVsCodeApi();
    let currentTab = '${activeTab}';
    let currentFilter = ${JSON.stringify(filter || {})};

    function send(cmd, id) { vscode.postMessage({ command: cmd, id, tab: currentTab, filter: currentFilter }); }

    function switchTab(tab, filterOverride) {
        currentTab = tab;
        if (filterOverride) { currentFilter = filterOverride; }
        else if (tab !== 'observations') { currentFilter = {}; }
        vscode.postMessage({ command: 'refresh', tab: currentTab, filter: currentFilter });
    }

    function applyFilter() {
        const status = document.getElementById('filter-status')?.value || '';
        const tag = document.getElementById('filter-tag')?.value || '';
        const search = document.getElementById('filter-search')?.value || '';
        currentFilter = {};
        if (status) currentFilter.status = status;
        if (tag) currentFilter.tag = tag;
        if (search) currentFilter.search = search;
        vscode.postMessage({ command: 'refresh', tab: currentTab, filter: currentFilter });
    }

    document.addEventListener('click', function(e) {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const action = el.dataset.action;
        const id = parseInt(el.dataset.id);

        switch (action) {
            case 'refresh':
                send('refresh');
                break;
            case 'tab': {
                const filterOverride = el.dataset.filterStatus ? { status: el.dataset.filterStatus } : undefined;
                switchTab(el.dataset.tab, filterOverride);
                break;
            }
            case 'filter-tag':
                switchTab('observations', { tag: el.dataset.tag });
                break;
            case 'verify':
                send('verify', id);
                break;
            case 'reject':
                send('reject', id);
                break;
            case 'edit': {
                document.getElementById('view-' + id).style.display = 'none';
                document.getElementById('edit-' + id).style.display = 'block';
                break;
            }
            case 'cancel-edit': {
                document.getElementById('view-' + id).style.display = 'block';
                document.getElementById('edit-' + id).style.display = 'none';
                break;
            }
            case 'save-edit': {
                const content = document.getElementById('edit-content-' + id).value;
                const tags = document.getElementById('edit-tags-' + id).value;
                vscode.postMessage({ command: 'edit', id, content, tags, tab: currentTab, filter: currentFilter });
                break;
            }
            case 'confirm-delete': {
                const card = document.getElementById('view-' + id);
                if (!card) { send('delete', id); return; }
                const existing = card.querySelector('.confirm-bar');
                if (existing) { existing.remove(); return; }
                const bar = document.createElement('div');
                bar.className = 'confirm-bar';
                bar.innerHTML = '<span class="confirm-text">Delete this observation?</span>';
                const yes = document.createElement('button');
                yes.className = 'btn btn-danger';
                yes.textContent = 'Yes, delete';
                yes.dataset.action = 'delete';
                yes.dataset.id = String(id);
                const no = document.createElement('button');
                no.className = 'btn btn-cancel';
                no.textContent = 'Cancel';
                no.dataset.action = 'cancel-confirm';
                bar.appendChild(yes);
                bar.appendChild(no);
                card.appendChild(bar);
                break;
            }
            case 'delete':
                send('delete', id);
                break;
            case 'cancel-confirm':
                el.closest('.confirm-bar')?.remove();
                break;
            case 'delete-file': {
                const fileId = parseInt(el.dataset.fileId);
                vscode.postMessage({ command: 'deleteFile', fileId, tab: currentTab, filter: currentFilter });
                break;
            }
        }
    });

    document.addEventListener('change', function(e) {
        if (e.target.closest('[data-action="filter"]')) applyFilter();
    });
    document.addEventListener('input', function(e) {
        if (e.target.closest('[data-action="filter"]')) applyFilter();
    });
</script>
</body>
</html>`;
    }

    private renderDashboardCard(obs: Observation): string {
        const esc = (t: string) => this.escapeHtml(t);
        const tags = obs.tags ? obs.tags.split(',').map(t => t.trim()).filter(t => t).map(t =>
            `<span class="tag-sm">${esc(t)}</span>`
        ).join('') : '';

        return `
            <div class="card st-${obs.status}">
                <div id="view-${obs.id}">
                    <div class="card-head">
                        <span class="card-id"><span class="dot dot-${obs.status}"></span> ${obs.id}</span>
                        <span class="card-src">${esc(obs.source)}</span>
                    </div>
                    <div class="card-body">${esc(obs.content)}</div>
                    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
                    <div class="card-time">${obs.created_at}</div>
                    <div class="card-actions">
                        ${obs.status === 'pending' ? `<button class="btn btn-primary" data-action="verify" data-id="${obs.id}">Verify</button>` : ''}
                        ${obs.status === 'pending' ? `<button class="btn btn-warn" data-action="reject" data-id="${obs.id}">Reject</button>` : ''}
                        ${obs.status !== 'pending' ? `<button class="btn btn-primary" data-action="verify" data-id="${obs.id}">Re-verify</button>` : ''}
                        <button class="btn" data-action="edit" data-id="${obs.id}">Edit</button>
                        <button class="btn btn-danger" data-action="confirm-delete" data-id="${obs.id}">Delete</button>
                    </div>
                </div>
                <div id="edit-${obs.id}" style="display:none;">
                    <div class="edit-label">Content</div>
                    <textarea id="edit-content-${obs.id}" class="edit-area">${esc(obs.content)}</textarea>
                    <div class="edit-label">Tags</div>
                    <input id="edit-tags-${obs.id}" class="edit-input" value="${esc(obs.tags || '')}" placeholder="comma-separated">
                    <div class="card-actions">
                        <button class="btn btn-fill" data-action="save-edit" data-id="${obs.id}">Save</button>
                        <button class="btn btn-cancel" data-action="cancel-edit" data-id="${obs.id}">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
