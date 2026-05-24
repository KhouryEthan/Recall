import * as vscode from 'vscode';
import { RecallDatabase, Observation, FileIndexEntry } from './db';

interface DashboardFilter {
    status?: string;
    tag?: string;
    project?: string;
}

interface WorkspaceProject {
    name: string;
    root: string; // normalized forward-slash path
}

export class RecallSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'recall.dashboardView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly db: RecallDatabase,
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            const tab: string = message.tab || 'overview';
            const filter: DashboardFilter = message.filter || {};

            switch (message.command) {
                case 'refresh':
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'verify':
                    this.db.updateStatus(message.id, 'verified');
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'reject':
                    this.db.updateStatus(message.id, 'rejected');
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'delete':
                    this.db.deleteObservation(message.id);
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'edit':
                    this.db.updateObservation(message.id, message.content, message.tags);
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'deleteFileEntry':
                    this.db.deleteFileIndexEntry(message.id);
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                case 'cleanupArtifacts': {
                    const removed = this.db.cleanupBuildArtifacts();
                    vscode.window.showInformationMessage(
                        `Recall: Removed ${removed} build artifact entries from the file index.`
                    );
                    webviewView.webview.html = this.getHtml(tab, filter);
                    break;
                }
                case 'openDashboard':
                    vscode.commands.executeCommand('recall.openDashboard');
                    break;
            }
        });
    }

    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this.getHtml();
        }
    }

    // ─── Build workspace project list ─────────────────────────────────────────

    private getWorkspaceProjects(): WorkspaceProject[] {
        const folders = vscode.workspace.workspaceFolders || [];
        return folders.map(f => ({
            name: f.name,
            root: f.uri.fsPath.replace(/\\/g, '/'),
        }));
    }

    private fileProject(filePath: string, projects: WorkspaceProject[]): string {
        const normalized = filePath.replace(/\\/g, '/');
        for (const p of projects) {
            if (normalized.startsWith(p.root)) { return p.name; }
        }
        return '';
    }

    // ─── Main HTML generator ──────────────────────────────────────────────────

    private getHtml(activeTab: string = 'overview', filter: DashboardFilter = {}): string {
        const stats = this.db.getStats();
        const pending = this.db.getPendingObservations();
        const allTags = this.db.getDistinctTags();
        const dbProjects = this.db.getDistinctProjects();
        const wsProjects = this.getWorkspaceProjects();

        // Merge project names from DB observations + workspace folders
        const allProjectNames = Array.from(new Set([
            ...dbProjects,
            ...wsProjects.map(p => p.name),
        ])).sort();

        let observations: Observation[] = [];
        if (activeTab === 'observations' || activeTab === 'pending') {
            const statusFilter = activeTab === 'pending' ? 'pending' : filter.status;
            observations = this.db.getAllObservations({
                status: statusFilter,
                tag: filter.tag,
                project: filter.project,
            });
        }

        let fileEntries: FileIndexEntry[] = [];
        if (activeTab === 'files') {
            const all = this.db.getAllFileIndexEntries();
            if (filter.project) {
                // Match files belonging to the selected project by workspace root
                const ws = wsProjects.find(p => p.name === filter.project);
                if (ws) {
                    fileEntries = all.filter(fe =>
                        fe.file_path.replace(/\\/g, '/').startsWith(ws.root)
                    );
                } else {
                    // Project only in DB observations — filter by name match in path
                    const lc = filter.project.toLowerCase();
                    fileEntries = all.filter(fe => fe.file_path.toLowerCase().includes(`/${lc}/`) || fe.file_path.toLowerCase().includes(`\\${lc}\\`));
                }
            } else {
                fileEntries = all;
            }
        }

        const esc = (t: string) => this.escapeHtml(t);

        // ─── Project selector ─────────────────────────────────────────────────
        const projectOptions = [
            `<option value="" ${!filter.project ? 'selected' : ''}>All Projects</option>`,
            ...allProjectNames.map(p =>
                `<option value="${esc(p)}" ${filter.project === p ? 'selected' : ''}>${esc(p)}</option>`
            ),
        ].join('');
        const projectBar = allProjectNames.length > 0
            ? `<div class="project-bar"><select id="proj" class="project-sel" onchange="applyProject(this.value)">${projectOptions}</select></div>`
            : '';

        // ─── Tab content ──────────────────────────────────────────────────────
        let tabContent = '';

        if (activeTab === 'overview') {
            const tagBadges = stats.topTags.slice(0, 12).map(t =>
                `<span class="tag" onclick="switchTab('observations', {tag:'${esc(t.tag)}'${filter.project ? `,project:'${esc(filter.project)}'` : ''}})">${esc(t.tag)}<span class="tag-ct">${t.count}</span></span>`
            ).join('');

            // Per-project observation counts
            let projectGrid = '';
            if (allProjectNames.length > 1) {
                const rows = allProjectNames.map(p => {
                    const count = this.db.getAllObservations({ project: p }).length;
                    const files = this.db.getAllFileIndexEntries().filter(fe =>
                        this.fileProject(fe.file_path, wsProjects) === p ||
                        fe.file_path.toLowerCase().includes(`/${p.toLowerCase()}/`) ||
                        fe.file_path.toLowerCase().includes(`\\${p.toLowerCase()}\\`)
                    ).length;
                    return `
                        <div class="proj-card" onclick="applyProject('${esc(p)}')">
                            <div class="proj-name">${esc(p)}</div>
                            <div class="proj-stats">${count} obs · ${files} files</div>
                        </div>`;
                }).join('');
                projectGrid = `<div class="label">Projects</div><div class="proj-grid">${rows}</div>`;
            }

            const recent = this.db.getRecentObservations(8);
            const recentItems = recent.map(obs => `
                <div class="list-item">
                    <span class="dot dot-${obs.status}"></span>
                    <span class="list-text">${esc(obs.content.substring(0, 100))}${obs.content.length > 100 ? '...' : ''}</span>
                </div>
            `).join('');

            tabContent = `
                <div class="metrics">
                    <div class="metric" onclick="switchTab('observations')">
                        <span class="metric-num">${stats.totalObservations}</span>
                        <span class="metric-label">observations</span>
                    </div>
                    <div class="metric" onclick="switchTab('pending')">
                        <span class="metric-num ${stats.pendingObservations > 0 ? 'warn' : ''}">${stats.pendingObservations}</span>
                        <span class="metric-label">pending</span>
                    </div>
                    <div class="metric" onclick="switchTab('files')">
                        <span class="metric-num">${stats.totalFilesIndexed}</span>
                        <span class="metric-label">files</span>
                    </div>
                    <div class="metric">
                        <span class="metric-num">${stats.totalSymbols}</span>
                        <span class="metric-label">symbols</span>
                    </div>
                </div>
                ${projectGrid}
                ${stats.topTags.length > 0 ? `<div class="label">Tags</div><div class="tag-row">${tagBadges}</div>` : ''}
                <div class="label">Recent</div>
                ${recentItems || '<p class="muted">No observations yet.</p>'}
            `;
        } else if (activeTab === 'pending') {
            if (pending.length === 0) {
                tabContent = `<p class="muted centered">All clear — nothing to review.</p>`;
            } else {
                tabContent = `<p class="sub">${pending.length} awaiting review</p>` +
                    pending.map(obs => this.renderObservationCard(obs, activeTab, filter)).join('');
            }
        } else if (activeTab === 'observations') {
            const filterBar = this.renderFilterBar(allTags, filter);
            if (observations.length === 0) {
                tabContent = filterBar + `<p class="muted centered">No matching observations.</p>`;
            } else {
                tabContent = filterBar + `<p class="sub">${observations.length} total</p>` +
                    observations.map(obs => this.renderObservationCard(obs, activeTab, filter)).join('');
            }
        } else if (activeTab === 'files') {
            const cleanupBtn = `<button class="btn btn-warn" style="margin-bottom:8px;width:100%" onclick="send('cleanupArtifacts')">Clean up build artifacts</button>`;
            if (fileEntries.length === 0) {
                tabContent = cleanupBtn + `<p class="muted centered">No files indexed.</p>`;
            } else {
                tabContent = cleanupBtn + `<p class="sub">${fileEntries.length} indexed${filter.project ? ` in ${esc(filter.project)}` : ''}</p>` +
                    fileEntries.map(fe => {
                        const fileName = fe.file_path.split(/[/\\]/).pop() || fe.file_path;
                        const proj = this.fileProject(fe.file_path, wsProjects);
                        let symbolCount = 0;
                        try { symbolCount = JSON.parse(fe.symbols).length; } catch {}
                        return `
                            <div class="card">
                                <div class="card-head">
                                    <div>
                                        <div class="card-title">${esc(fileName)}</div>
                                        ${proj ? `<div class="card-proj">${esc(proj)}</div>` : ''}
                                    </div>
                                    <button class="icon-btn" onclick="deleteFileEntry(${fe.id})" title="Remove from index">✕</button>
                                </div>
                                <div class="card-path">${esc(fe.file_path)}</div>
                                <div class="card-detail">${fe.line_count} lines · ${symbolCount} symbols · ${fe.last_indexed.split('T')[0] || fe.last_indexed.split(' ')[0] || fe.last_indexed}</div>
                                ${fe.summary ? `<div class="card-summary">${esc(fe.summary.substring(0, 150))}</div>` : ''}
                            </div>
                        `;
                    }).join('');
            }
        }

        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
:root {
    --radius: 4px;
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 12px;
    --space-lg: 16px;
    --text-xs: 10px;
    --text-sm: 11px;
    --text-base: 12px;
    --text-lg: 13px;
    --border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
    --surface: color-mix(in srgb, var(--vscode-foreground) 4%, var(--vscode-sideBar-background));
    --surface-hover: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-sideBar-background));
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', var(--vscode-font-family), sans-serif;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-size: var(--text-base);
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
}

/* ── Top bar ── */
.topbar {
    display: flex; justify-content: flex-end; gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
}
.icon-btn {
    background: none; border: none; color: var(--vscode-foreground);
    opacity: 0.45; cursor: pointer; font-size: var(--text-sm); padding: 2px 6px; border-radius: var(--radius);
}
.icon-btn:hover { opacity: 0.8; background: var(--surface-hover); }

/* ── Project selector ── */
.project-bar {
    padding: 0 var(--space-md) var(--space-sm);
    border-bottom: var(--border);
}
.project-sel {
    width: 100%;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: var(--radius);
    padding: 4px 8px; font-size: var(--text-sm); cursor: pointer;
}

/* ── Tabs ── */
.tabs {
    display: flex; border-bottom: var(--border);
    padding: 0 var(--space-sm);
}
.tab {
    padding: 7px 8px; font-size: var(--text-xs); cursor: pointer;
    border-bottom: 2px solid transparent; opacity: 0.5;
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 500;
    transition: opacity 0.12s;
}
.tab:hover { opacity: 0.75; }
.tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
.tab .badge {
    display: inline-block; background: #d19a00;
    color: #fff; font-size: 9px; padding: 0 4px; border-radius: 6px; margin-left: 3px;
    line-height: 14px; font-weight: 600;
}

/* ── Content ── */
.content { padding: var(--space-md); }

/* ── Metrics ── */
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); margin-bottom: var(--space-md); }
.metric {
    background: var(--surface); border-radius: var(--radius);
    padding: var(--space-sm) var(--space-xs); text-align: center; cursor: pointer;
    transition: background 0.12s;
}
.metric:hover { background: var(--surface-hover); }
.metric-num { display: block; font-size: 18px; font-weight: 600; color: var(--vscode-foreground); letter-spacing: -0.5px; }
.metric-num.warn { color: #d19a00; }
.metric-label { font-size: var(--text-xs); opacity: 0.4; text-transform: lowercase; }

/* ── Project grid ── */
.proj-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); margin-bottom: var(--space-md); }
.proj-card {
    background: var(--surface); border-radius: var(--radius);
    padding: var(--space-sm); cursor: pointer; transition: background 0.12s;
    border-left: 2px solid var(--vscode-focusBorder);
}
.proj-card:hover { background: var(--surface-hover); }
.proj-name { font-size: var(--text-sm); font-weight: 600; }
.proj-stats { font-size: var(--text-xs); opacity: 0.35; margin-top: 2px; }

/* ── Labels ── */
.label {
    font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; opacity: 0.35; margin: var(--space-md) 0 var(--space-sm) 0;
}
.sub { font-size: var(--text-xs); opacity: 0.35; margin-bottom: var(--space-sm); }
.muted { font-size: var(--text-sm); opacity: 0.3; padding: var(--space-lg) 0; }
.centered { text-align: center; }

/* ── Tags ── */
.tag-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--space-sm); }
.tag {
    display: inline-flex; align-items: center; gap: 3px;
    background: var(--surface); padding: 2px 7px; border-radius: 3px;
    font-size: var(--text-xs); cursor: pointer; transition: background 0.12s;
}
.tag:hover { background: var(--surface-hover); }
.tag-ct { opacity: 0.35; }

/* ── List items ── */
.list-item {
    display: flex; align-items: flex-start; gap: 6px;
    padding: 4px 2px; font-size: var(--text-sm); line-height: 1.4;
}
.list-item + .list-item { border-top: var(--border); }
.dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.dot-verified { background: var(--vscode-testing-iconPassed); }
.dot-pending { background: #d19a00; }
.dot-rejected { background: var(--vscode-testing-iconFailed); }
.list-text { flex: 1; opacity: 0.75; }

/* ── Cards ── */
.card {
    background: var(--surface); border-radius: var(--radius);
    padding: var(--space-sm) var(--space-md); margin-bottom: var(--space-sm);
    border-left: 2px solid transparent;
}
.card.st-pending { border-left-color: #d19a00; }
.card.st-verified { border-left-color: var(--vscode-testing-iconPassed); }
.card.st-rejected { border-left-color: var(--vscode-testing-iconFailed); }

.card-head { display: flex; justify-content: space-between; align-items: flex-start; }
.card-id { font-size: var(--text-xs); opacity: 0.3; font-weight: 500; font-variant-numeric: tabular-nums; }
.card-source { font-size: var(--text-xs); opacity: 0.25; }
.card-body { font-size: var(--text-sm); line-height: 1.55; margin: var(--space-xs) 0; white-space: pre-wrap; word-break: break-word; opacity: 0.85; }
.card-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: var(--space-xs); }
.card-tags .tag { cursor: default; }
.card-time { font-size: 9px; opacity: 0.2; margin-top: var(--space-xs); }
.card-proj { font-size: 9px; opacity: 0.35; font-weight: 500; margin-top: 1px; }

.card-title { font-size: var(--text-sm); font-weight: 600; }
.card-path { font-size: 9px; opacity: 0.3; word-break: break-all; margin-top: 1px; }
.card-detail { font-size: var(--text-xs); opacity: 0.35; margin-top: 3px; }
.card-summary { font-size: var(--text-xs); opacity: 0.5; margin-top: 4px; line-height: 1.4; }

/* ── Actions ── */
.actions { display: flex; gap: var(--space-xs); margin-top: var(--space-sm); padding-top: var(--space-sm); border-top: var(--border); flex-wrap: wrap; }
.btn {
    font-size: var(--text-xs); padding: 3px 8px; border-radius: 3px;
    cursor: pointer; border: var(--border); background: none;
    color: var(--vscode-foreground); opacity: 0.6; transition: all 0.12s; font-weight: 500;
}
.btn:hover { opacity: 1; background: var(--surface-hover); }
.btn-primary { border-color: var(--vscode-testing-iconPassed); color: var(--vscode-testing-iconPassed); }
.btn-danger { border-color: var(--vscode-testing-iconFailed); color: var(--vscode-testing-iconFailed); }
.btn-warn { border-color: #d19a00; color: #d19a00; }
.btn-fill { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); opacity: 0.85; }
.btn-fill:hover { opacity: 1; }

/* ── Edit ── */
.edit-area {
    width: 100%; min-height: 56px; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
    border-radius: var(--radius); padding: 6px 8px; font-family: inherit;
    font-size: var(--text-sm); resize: vertical; margin: var(--space-xs) 0; line-height: 1.5;
}
.edit-input {
    width: 100%; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
    border-radius: var(--radius); padding: 4px 8px; font-size: var(--text-xs); margin: 3px 0;
}
.edit-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.3; margin-top: var(--space-xs); }

/* ── Confirm bar ── */
.confirm-bar {
    display: flex; align-items: center; gap: var(--space-xs); margin-top: var(--space-sm);
    padding: var(--space-sm); background: color-mix(in srgb, var(--vscode-testing-iconFailed) 10%, var(--surface));
    border-radius: var(--radius);
}
.confirm-text { font-size: var(--text-xs); opacity: 0.7; flex: 1; }

/* ── Filters ── */
.filters { display: flex; gap: var(--space-xs); margin-bottom: var(--space-sm); }
.filter-ctl {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); border-radius: var(--radius);
    padding: 3px 6px; font-size: var(--text-xs); flex: 1;
}
</style>
</head>
<body>
    <div class="topbar">
        <button class="icon-btn" onclick="send('refresh')" title="Refresh">Refresh</button>
        <button class="icon-btn" onclick="send('openDashboard')" title="Open full dashboard">Expand</button>
    </div>

    ${projectBar}

    <div class="tabs">
        <div class="tab ${activeTab === 'overview' ? 'active' : ''}" onclick="switchTab('overview')">Overview</div>
        <div class="tab ${activeTab === 'pending' ? 'active' : ''}" onclick="switchTab('pending')">Pending${stats.pendingObservations > 0 ? `<span class="badge">${stats.pendingObservations}</span>` : ''}</div>
        <div class="tab ${activeTab === 'observations' ? 'active' : ''}" onclick="switchTab('observations')">All</div>
        <div class="tab ${activeTab === 'files' ? 'active' : ''}" onclick="switchTab('files')">Files</div>
    </div>

    <div class="content">${tabContent}</div>

<script>
const vscode = acquireVsCodeApi();
let currentTab = '${activeTab}';
let currentFilter = ${JSON.stringify(filter)};

function send(cmd, id) { vscode.postMessage({ command: cmd, id, tab: currentTab, filter: currentFilter }); }

function switchTab(tab, fo) {
    currentTab = tab;
    if (fo) {
        currentFilter = { ...currentFilter, ...fo };
    } else if (tab !== 'observations' && tab !== 'files') {
        currentFilter = { project: currentFilter.project };
    }
    vscode.postMessage({ command: 'refresh', tab: currentTab, filter: currentFilter });
}

function applyProject(project) {
    currentFilter = { ...currentFilter, project: project || undefined };
    vscode.postMessage({ command: 'refresh', tab: currentTab, filter: currentFilter });
}

function applyFilter() {
    const s = document.getElementById('fs')?.value || '';
    const t = document.getElementById('ft')?.value || '';
    currentFilter = { project: currentFilter.project };
    if (s) currentFilter.status = s;
    if (t) currentFilter.tag = t;
    vscode.postMessage({ command: 'refresh', tab: currentTab, filter: currentFilter });
}

function startEdit(id) { document.getElementById('v'+id).style.display='none'; document.getElementById('e'+id).style.display='block'; }
function cancelEdit(id) { document.getElementById('v'+id).style.display='block'; document.getElementById('e'+id).style.display='none'; }
function saveEdit(id) {
    vscode.postMessage({ command:'edit', id, content: document.getElementById('ec'+id).value, tags: document.getElementById('et'+id).value, tab: currentTab, filter: currentFilter });
}
function confirmDelete(id) {
    const card = document.getElementById('v'+id);
    if (!card) { vscode.postMessage({ command:'delete', id, tab: currentTab, filter: currentFilter }); return; }
    const existing = card.querySelector('.confirm-bar');
    if (existing) { existing.remove(); return; }
    const bar = document.createElement('div');
    bar.className = 'confirm-bar';
    bar.innerHTML = '<span class="confirm-text">Delete this observation?</span><button class="btn btn-danger" onclick="vscode.postMessage({command:\'delete\',id:'+id+',tab:currentTab,filter:currentFilter})">Yes, delete</button><button class="btn" onclick="this.parentElement.remove()">No</button>';
    card.appendChild(bar);
}
function deleteFileEntry(id) {
    vscode.postMessage({ command: 'deleteFileEntry', id, tab: currentTab, filter: currentFilter });
}
</script>
</body></html>`;
    }

    private renderObservationCard(obs: Observation, tab: string, filter: DashboardFilter): string {
        const esc = (t: string) => this.escapeHtml(t);
        const tags = obs.tags ? obs.tags.split(',').map(t => t.trim()).filter(t => t).map(t =>
            `<span class="tag">${esc(t)}</span>`
        ).join('') : '';

        return `
            <div class="card st-${obs.status}">
                <div id="v${obs.id}">
                    <div class="card-head">
                        <div>
                            <span class="card-id">#${obs.id}</span>
                            ${obs.project ? `<div class="card-proj">${esc(obs.project)}</div>` : ''}
                        </div>
                        <span class="card-source">${esc(obs.source)}</span>
                    </div>
                    <div class="card-body">${esc(obs.content)}</div>
                    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
                    <div class="card-time">${obs.created_at}</div>
                    <div class="actions">
                        ${obs.status === 'pending' ? `<button class="btn btn-primary" onclick="send('verify',${obs.id})">Verify</button><button class="btn btn-warn" onclick="send('reject',${obs.id})">Reject</button>` : ''}
                        <button class="btn" onclick="startEdit(${obs.id})">Edit</button>
                        <button class="btn btn-danger" onclick="confirmDelete(${obs.id})">Delete</button>
                    </div>
                </div>
                <div id="e${obs.id}" style="display:none;">
                    <div class="edit-label">Content</div>
                    <textarea id="ec${obs.id}" class="edit-area">${esc(obs.content)}</textarea>
                    <div class="edit-label">Tags</div>
                    <input id="et${obs.id}" class="edit-input" value="${esc(obs.tags || '')}" placeholder="comma-separated">
                    <div class="actions">
                        <button class="btn btn-fill" onclick="saveEdit(${obs.id})">Save</button>
                        <button class="btn" onclick="cancelEdit(${obs.id})">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    }

    private renderFilterBar(allTags: string[], filter: DashboardFilter): string {
        const esc = (t: string) => this.escapeHtml(t);
        const so = ['', 'verified', 'pending', 'rejected'].map(s =>
            `<option value="${s}" ${filter.status === s ? 'selected' : ''}>${s || 'Status'}</option>`
        ).join('');
        const to = ['', ...allTags].map(t =>
            `<option value="${esc(t)}" ${filter.tag === t ? 'selected' : ''}>${t || 'Tag'}</option>`
        ).join('');
        return `<div class="filters"><select id="fs" class="filter-ctl" onchange="applyFilter()">${so}</select><select id="ft" class="filter-ctl" onchange="applyFilter()">${to}</select></div>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
