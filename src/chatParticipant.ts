import * as vscode from 'vscode';
import { RecallDatabase, Observation } from './db';
import { hybridSearch } from './search';
import { embedObservation } from './embeddings';

export class RecallChatParticipant {

    private db: RecallDatabase;

    constructor(db: RecallDatabase) {
        this.db = db;
    }

    async handleRequest(
        request: vscode.ChatRequest,
        _context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        _token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {

        const prompt = request.prompt.trim();

        // Parse the command from the prompt
        const parts = prompt.split(/\s+/);
        const command = parts[0]?.toLowerCase() || 'help';
        const args = parts.slice(1).join(' ');

        switch (command) {
            case 'search':
            case 's':
                return this.handleSearch(args, stream);
            case 'save':
                return this.handleSave(args, stream);
            case 'recent':
                return this.handleRecent(args, stream);
            case 'pending':
                return this.handlePending(stream);
            case 'verify':
                return this.handleVerify(args, stream);
            case 'discard':
                return this.handleDiscard(args, stream);
            case 'edit':
                return this.handleEdit(args, stream);
            case 'timeline':
                return this.handleTimeline(args, stream);
            case 'stats':
                return this.handleStats(stream);
            case 'index':
                return this.handleIndexLookup(args, stream);
            case 'export':
                return this.handleExport(stream);
            case 'help':
            default:
                return this.handleHelp(stream);
        }
    }

    private async handleSearch(query: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        if (!query) {
            stream.markdown('**Usage:** `@recall search <keywords>` or `@recall search <keywords> --tags tagA,tagB`\n');
            return {};
        }

        // Parse optional --tags flag
        let tags: string | undefined;
        const tagsMatch = query.match(/--tags?\s+(\S+)/);
        if (tagsMatch) {
            tags = tagsMatch[1];
            query = query.replace(/--tags?\s+\S+/, '').trim();
        }

        const results = await hybridSearch(this.db, query, tags, 15);
        if (results.length === 0) {
            stream.markdown(`No observations found for **"${query}"**${tags ? ` with tags: ${tags}` : ''}.\n`);
            return {};
        }

        stream.markdown(`### 🔍 ${results.length} result(s) for "${query}"\n\n`);
        for (const obs of results) {
            const suffix = obs.semanticOnly ? ' `[semantic]`' : '';
            this.renderObservation(obs, stream, suffix);
        }
        return {};
    }

    private async handleSave(content: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        if (!content) {
            stream.markdown('**Usage:** `@recall save <observation text>` or `@recall save <text> --tags tagA,tagB`\n');
            return {};
        }

        // Parse optional --tags flag
        let tags = '';
        const tagsMatch = content.match(/--tags?\s+(\S+)/);
        if (tagsMatch) {
            tags = tagsMatch[1];
            content = content.replace(/--tags?\s+\S+/, '').trim();
        }

        const id = this.db.insertObservation(content, tags, 'manual', 'verified');
        embedObservation(this.db, id, content);
        stream.markdown(`✅ Observation **#${id}** saved as **verified**.${tags ? ` Tags: \`${tags}\`` : ''}\n\n> ${content}\n`);
        return {};
    }

    private async handleRecent(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        let days: number | undefined;
        let limit = 20;

        const daysMatch = args.match(/--days?\s+(\d+)/);
        if (daysMatch) {
            days = parseInt(daysMatch[1], 10);
        }
        const limitMatch = args.match(/--limit\s+(\d+)/);
        if (limitMatch) {
            limit = parseInt(limitMatch[1], 10);
        }

        const results = this.db.getRecentObservations(limit, days);
        if (results.length === 0) {
            stream.markdown(`No observations found${days ? ` in the last ${days} day(s)` : ''}.\n`);
            return {};
        }

        stream.markdown(`### 📋 Recent observations${days ? ` (last ${days} days)` : ''}\n\n`);
        for (const obs of results) {
            this.renderObservation(obs, stream);
        }
        return {};
    }

    private async handlePending(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const pending = this.db.getPendingObservations();
        if (pending.length === 0) {
            stream.markdown('✅ No pending observations. All caught up!\n');
            return {};
        }

        stream.markdown(`### ⏳ ${pending.length} pending observation(s)\n\nThese were saved by Copilot and need your verification after testing.\n\n`);
        for (const obs of pending) {
            this.renderObservation(obs, stream);
        }
        stream.markdown(`\n**Commands:** \`@recall verify <id>\` · \`@recall edit <id>\` · \`@recall discard <id>\`\n`);
        return {};
    }

    private async handleVerify(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const id = parseInt(args.trim(), 10);
        if (isNaN(id)) {
            stream.markdown('**Usage:** `@recall verify <id>`\n');
            return {};
        }
        const obs = this.db.getObservationById(id);
        if (!obs) {
            stream.markdown(`Observation #${id} not found.\n`);
            return {};
        }
        this.db.updateStatus(id, 'verified');
        stream.markdown(`✅ Observation **#${id}** verified.\n\n> ${obs.content}\n`);
        return {};
    }

    private async handleDiscard(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const id = parseInt(args.trim(), 10);
        if (isNaN(id)) {
            stream.markdown('**Usage:** `@recall discard <id>`\n');
            return {};
        }
        const obs = this.db.getObservationById(id);
        if (!obs) {
            stream.markdown(`Observation #${id} not found.\n`);
            return {};
        }
        this.db.deleteObservation(id);
        stream.markdown(`🗑️ Observation **#${id}** discarded.\n\n> ~~${obs.content}~~\n`);
        return {};
    }

    private async handleEdit(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const id = parseInt(args.trim(), 10);
        if (isNaN(id)) {
            stream.markdown('**Usage:** `@recall edit <id>`\n');
            return {};
        }
        const obs = this.db.getObservationById(id);
        if (!obs) {
            stream.markdown(`Observation #${id} not found.\n`);
            return {};
        }

        const edited = await vscode.window.showInputBox({
            value: obs.content,
            prompt: `Edit observation #${id}`,
            ignoreFocusOut: true,
        });

        if (edited && edited.trim() !== '') {
            this.db.updateContent(id, edited);
            this.db.updateStatus(id, 'verified');
            stream.markdown(`✏️ Observation **#${id}** updated and verified.\n\n> ${edited}\n`);
        } else {
            stream.markdown(`Edit cancelled. Observation **#${id}** unchanged.\n`);
        }
        return {};
    }

    private async handleTimeline(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const id = parseInt(args.trim(), 10);
        if (isNaN(id)) {
            stream.markdown('**Usage:** `@recall timeline <id>` — shows observations from the same day as observation #id\n');
            return {};
        }
        const obs = this.db.getObservationById(id);
        if (!obs) {
            stream.markdown(`Observation #${id} not found.\n`);
            return {};
        }

        // Get all observations within 24 hours of the target
        const results = this.db.getRecentObservations(50);
        const targetDate = new Date(obs.created_at + 'Z');
        const nearby = results.filter(o => {
            const d = new Date(o.created_at + 'Z');
            return Math.abs(d.getTime() - targetDate.getTime()) < 86400000;
        });

        stream.markdown(`### 📅 Timeline around observation #${id} (${obs.created_at})\n\n`);
        for (const o of nearby) {
            const marker = o.id === id ? '👉 ' : '   ';
            this.renderObservation(o, stream, marker);
        }
        return {};
    }

    private async handleStats(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const stats = this.db.getStats();
        const sizeKB = Math.round(stats.dbSizeBytes / 1024);
        const sizeMB = (stats.dbSizeBytes / (1024 * 1024)).toFixed(1);

        stream.markdown(`### 📊 Recall Database Statistics\n\n`);
        stream.markdown(`| Metric | Value |\n|---|---|\n`);
        stream.markdown(`| Total observations | ${stats.totalObservations} |\n`);
        stream.markdown(`| Verified | ${stats.verifiedObservations} |\n`);
        stream.markdown(`| Pending | ${stats.pendingObservations} |\n`);
        stream.markdown(`| Files indexed | ${stats.totalFilesIndexed} |\n`);
        stream.markdown(`| Total symbols tracked | ${stats.totalSymbols} |\n`);
        stream.markdown(`| Oldest observation | ${stats.oldestObservation || 'N/A'} |\n`);
        stream.markdown(`| Newest observation | ${stats.newestObservation || 'N/A'} |\n`);
        stream.markdown(`| Database size | ${sizeKB < 1024 ? sizeKB + ' KB' : sizeMB + ' MB'} |\n`);

        if (stats.topTags.length > 0) {
            stream.markdown(`\n**Top Tags:**\n`);
            for (const t of stats.topTags) {
                stream.markdown(`- \`${t.tag}\` (${t.count})\n`);
            }
        }
        return {};
    }

    private async handleIndexLookup(args: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        if (!args) {
            stream.markdown('**Usage:** `@recall index <filename>` — look up the cached file index\n');
            return {};
        }

        const entries = this.db.lookupFileIndex(args.trim());
        if (entries.length === 0) {
            stream.markdown(`No file index entry for **"${args.trim()}"**. The file hasn't been indexed yet.\n`);
            return {};
        }

        for (const entry of entries) {
            stream.markdown(`### 📄 ${entry.file_path} (${entry.line_count} lines)\n`);
            stream.markdown(`**Summary:** ${entry.summary || '(no summary)'}\n\n`);
            stream.markdown(`**Last indexed:** ${entry.last_indexed}\n\n`);

            try {
                const symbols = JSON.parse(entry.symbols);
                if (symbols.length > 0) {
                    stream.markdown(`**Symbols (${symbols.length}):**\n\n`);
                    stream.markdown(`| Line | Type | Name | Description |\n|---|---|---|---|\n`);
                    for (const sym of symbols) {
                        const line = sym.endLine ? `L${sym.line}-L${sym.endLine}` : `L${sym.line}`;
                        stream.markdown(`| ${line} | ${sym.type} | \`${sym.name}\` | ${sym.brief || ''} |\n`);
                    }
                }
            } catch {
                stream.markdown('(error parsing symbol data)\n');
            }
        }
        return {};
    }

    private async handleExport(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        const data = this.db.exportAll();
        const json = JSON.stringify(data, null, 2);

        // Write to a temp file and open it
        const uri = vscode.Uri.parse('untitled:recall-export.json');
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(editBuilder => {
            editBuilder.insert(new vscode.Position(0, 0), json);
        });

        stream.markdown(`📤 Exported ${data.observations.length} observations and ${data.fileIndex.length} file index entries. Opened in a new editor tab.\n`);
        return {};
    }

    private async handleHelp(stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
        stream.markdown(`### 🧠 Recall — Persistent Developer Memory\n\n`);
        stream.markdown(`| Command | Description |\n|---|---|\n`);
        stream.markdown(`| \`@recall search <keywords>\` | Search observations by keyword |\n`);
        stream.markdown(`| \`@recall search <keywords> --tags x,y\` | Search with tag filter |\n`);
        stream.markdown(`| \`@recall save <text>\` | Save a verified observation |\n`);
        stream.markdown(`| \`@recall save <text> --tags x,y\` | Save with tags |\n`);
        stream.markdown(`| \`@recall recent\` | Show recent observations |\n`);
        stream.markdown(`| \`@recall recent --days 7\` | Show last 7 days |\n`);
        stream.markdown(`| \`@recall pending\` | Show unverified Copilot observations |\n`);
        stream.markdown(`| \`@recall verify <id>\` | Mark observation as verified |\n`);
        stream.markdown(`| \`@recall edit <id>\` | Edit and verify observation |\n`);
        stream.markdown(`| \`@recall discard <id>\` | Delete observation |\n`);
        stream.markdown(`| \`@recall timeline <id>\` | Show observations from same day |\n`);
        stream.markdown(`| \`@recall index <filename>\` | Look up cached file index |\n`);
        stream.markdown(`| \`@recall stats\` | Show database statistics |\n`);
        stream.markdown(`| \`@recall export\` | Export all data to JSON |\n`);
        stream.markdown(`\n**Keyboard shortcut:** \`Ctrl+Shift+M\` — Quick save observation\n`);
        stream.markdown(`\n**Copilot uses Recall automatically** — no manual action needed for most memory operations.\n`);
        return {};
    }

    private renderObservation(obs: Observation, stream: vscode.ChatResponseStream, prefix: string = ''): void {
        const icon = obs.status === 'verified' ? '✓' : obs.status === 'pending' ? '⏳' : '✗';
        const age = this.formatAge(obs.created_at);
        stream.markdown(`${prefix}**#${obs.id}**  ${icon}  ${age}  \`${obs.source}\``);
        if (obs.tags) {
            stream.markdown(`  tags: \`${obs.tags}\``);
        }
        stream.markdown(`\n> ${obs.content}\n\n`);
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
