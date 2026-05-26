import * as vscode from 'vscode';
import { RecallDatabase } from './db';
import { embedObservation } from './embeddings';

/**
 * Passive event capture — automatically logs builds, git commits, debug sessions,
 * and file edits at zero engineer effort.
 */
export class PassiveCapture {
    private disposables: vscode.Disposable[] = [];
    private lastActivityTime: number = Date.now();
    private idleTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private db: RecallDatabase) {}

    activate(context: vscode.ExtensionContext): void {
        const config = vscode.workspace.getConfiguration('recall');

        // Build task capture
        if (config.get<boolean>('captureBuilds', true)) {
            this.disposables.push(
                vscode.tasks.onDidEndTaskProcess((e) => this.onBuildComplete(e))
            );
        }

        // Debug session capture
        if (config.get<boolean>('captureDebugSessions', true)) {
            this.disposables.push(
                vscode.debug.onDidStartDebugSession((s) => this.onDebugStart(s)),
                vscode.debug.onDidTerminateDebugSession((s) => this.onDebugEnd(s))
            );
        }

        // Git commit capture (disabled by default — commit messages are often
        // too terse to be useful observations)
        if (config.get<boolean>('captureGitCommits', false)) {
            this.startGitPolling();
        }

        // Track activity for idle prompt
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.resetIdleTimer()),
            vscode.workspace.onDidChangeTextDocument(() => this.resetIdleTimer())
        );

        // Start idle timer
        this.resetIdleTimer();

        // Register all disposables
        context.subscriptions.push(...this.disposables);
    }

    // ─── Build Capture ────────────────────────────────────────────────────

    private onBuildComplete(e: vscode.TaskProcessEndEvent): void {
        const task = e.execution.task;
        const exitCode = e.exitCode;
        const name = task.name || task.definition.type || 'unknown';
        const passed = exitCode === 0;

        let content: string;
        if (passed) {
            content = `Build passed: "${name}" completed successfully (exit code 0)`;
        } else {
            content = `Build failed: "${name}" (exit ${exitCode})`;
            const diagnostics = vscode.languages.getDiagnostics();
            const errors: string[] = [];
            for (const [uri, diags] of diagnostics) {
                for (const d of diags) {
                    if (d.severity === vscode.DiagnosticSeverity.Error && errors.length < 5) {
                        const file = vscode.workspace.asRelativePath(uri);
                        errors.push(`${file}:${d.range.start.line + 1} — ${d.message}`);
                    }
                }
            }
            if (errors.length > 0) {
                content += `. Errors: ${errors.join('; ')}`;
            }
        }

        const id = this.db.insertObservation(content, 'build', 'build', 'verified');
        embedObservation(this.db, id, content);
    }

    // ─── Debug Session Capture ────────────────────────────────────────────

    private debugSessions = new Map<string, { name: string; type: string; program: string; startTime: number }>();

    private onDebugStart(session: vscode.DebugSession): void {
        this.debugSessions.set(session.id, {
            name: session.name || session.configuration?.program || 'unknown',
            type: session.type || 'unknown',
            program: session.configuration?.program || '',
            startTime: Date.now(),
        });
    }

    private onDebugEnd(session: vscode.DebugSession): void {
        const info = this.debugSessions.get(session.id);
        if (!info) { return; }
        this.debugSessions.delete(session.id);

        const durationMin = Math.round((Date.now() - info.startTime) / 60000);
        let content = `Debug session ended: "${info.type}" debugger`;
        if (info.program) {
            content += ` on "${info.program}"`;
        }
        content += ` — ran for ${durationMin} minute(s)`;

        const id = this.db.insertObservation(content, 'debug', 'debug', 'verified');
        embedObservation(this.db, id, content);
    }

    // ─── Git Commit Capture ───────────────────────────────────────────────

    private lastKnownHead: string | undefined;
    private gitPollInterval: ReturnType<typeof setInterval> | undefined;

    private startGitPolling(): void {
        // Poll git HEAD every 30 seconds to detect new commits
        this.gitPollInterval = setInterval(() => this.checkGitHead(), 30000);
        // Also check immediately
        this.checkGitHead();
    }

    private async checkGitHead(): Promise<void> {
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git');
            if (!gitExt) { return; }

            const git = gitExt.exports.getAPI(1);
            if (!git || git.repositories.length === 0) { return; }

            const repo = git.repositories[0];
            const head = repo.state?.HEAD;
            if (!head || !head.commit) { return; }

            const currentHead = head.commit;

            if (this.lastKnownHead && this.lastKnownHead !== currentHead) {
                // New commit detected
                const commitMsg = head.name || 'unknown branch';
                try {
                    const log = await repo.log({ maxEntries: 1 });
                    if (log && log.length > 0) {
                        const latest = log[0];
                        const content = `Git commit: "${latest.message?.trim()}" by ${latest.authorName || 'unknown'} (${latest.hash?.substring(0, 7)})`;
                        const gitId = this.db.insertObservation(content, 'git', 'git', 'verified');
                        embedObservation(this.db, gitId, content);
                    }
                } catch {
                    const content = `Git HEAD changed on branch ${commitMsg}: ${currentHead.substring(0, 7)}`;
                    const fallbackId = this.db.insertObservation(content, 'git', 'git', 'verified');
                    embedObservation(this.db, fallbackId, content);
                }
            }

            this.lastKnownHead = currentHead;
        } catch {
            // Git not available — silently skip
        }
    }

    // ─── Idle Session Prompt ──────────────────────────────────────────────

    private resetIdleTimer(): void {
        this.lastActivityTime = Date.now();

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        const idleMinutes = vscode.workspace.getConfiguration('recall').get<number>('idlePromptMinutes', 10);
        if (idleMinutes <= 0) { return; }

        this.idleTimer = setTimeout(() => this.showIdlePrompt(), idleMinutes * 60000);
    }

    private async showIdlePrompt(): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            '🧠 Recall: Save session notes before you go?',
            'Save Notes',
            'Dismiss'
        );

        if (action === 'Save Notes') {
            const note = await vscode.window.showInputBox({
                prompt: 'What did you work on? Any insights or findings?',
                placeHolder: 'e.g., Investigated token refresh race condition — useAuth can double-render when refreshing expired tokens...',
                ignoreFocusOut: true,
            });

            if (note && note.trim() !== '') {
                const tags = await vscode.window.showInputBox({
                    prompt: 'Tags (optional, comma-separated)',
                    placeHolder: 'e.g., auth,investigation',
                });

                const idleId = this.db.insertObservation(note, tags || '', 'manual', 'verified');
                embedObservation(this.db, idleId, note);
                vscode.window.showInformationMessage('✅ Session notes saved.');
            }
        }

        // Reset the timer
        this.resetIdleTimer();
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────

    dispose(): void {
        if (this.gitPollInterval) {
            clearInterval(this.gitPollInterval);
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
