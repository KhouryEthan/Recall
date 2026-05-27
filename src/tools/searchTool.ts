import * as vscode from 'vscode';
import { RecallDatabase } from '../db';
import { hybridSearch } from '../search';
import { TokenTracker } from '../tokenTracker';

export class RecallSearchTool implements vscode.LanguageModelTool<{ query: string; tags?: string; limit?: number; project?: string }> {

    constructor(private db: RecallDatabase, private tokenTracker?: TokenTracker) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ query: string; tags?: string; limit?: number; project?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {

        const { query, tags, limit } = options.input;

        // Use explicitly provided project, or auto-detect from current workspace
        const currentProject = options.input.project
            ?? (vscode.workspace.getConfiguration('recall').get<string>('projectName', '')
                || vscode.workspace.workspaceFolders?.[0]?.name
                || '');

        const results = await hybridSearch(this.db, query, tags, limit, currentProject || undefined);

        if (results.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `No observations found for "${query}"${tags ? ` [tags: ${tags}]` : ''}. ` +
                    `No prior knowledge exists on this topic — proceed and save what you learn.`
                )
            ]);
        }

        const statusIcon = (s: string) => s === 'verified' ? '✓' : s === 'pending' ? '⏳' : '✗';

        let output = `Found ${results.length} observation(s) for "${query}"`;
        if (currentProject) { output += ` (current project: ${currentProject})`; }
        output += `:\n\n`;

        for (const obs of results) {
            const age = this.formatAge(obs.created_at);
            const projectLabel = obs.project && obs.project !== currentProject ? ` [from: ${obs.project}]` : '';
            output += `#${obs.id}  ${statusIcon(obs.status)}  ${age}  [${obs.source}]${projectLabel}`;
            if (obs.semanticOnly) { output += `  🔗semantic`; }
            if (obs.tags) { output += `  tags: ${obs.tags}`; }
            output += `\n${obs.content}\n\n`;
        }

        // Remind the model of trust semantics inline
        const hasPending = results.some(r => r.status === 'pending');
        const hasXProject = results.some(r => r.project && r.project !== currentProject);
        if (hasPending || hasXProject) {
            output += `---\n`;
            if (hasPending) { output += `⏳ = pending (AI-captured, unverified — read the code before acting on it)\n`; }
            if (hasXProject) { output += `[from: X] = cross-project result — check applicability before using\n`; }
        }

        this.tokenTracker?.recordSearchHit(output);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(output)
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string; tags?: string; limit?: number; project?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { query, tags } = options.input;
        return {
            invocationMessage: `Searching memory for "${query}"${tags ? ` [tags: ${tags}]` : ''}`,
        };
    }

    private formatAge(dateStr: string): string {
        const date = new Date(dateStr + 'Z');
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 60) { return `${diffMin}m ago`; }
        if (diffHr < 24) { return `${diffHr}h ago`; }
        if (diffDay < 30) { return `${diffDay}d ago`; }
        return `${Math.floor(diffDay / 30)}mo ago`;
    }
}
