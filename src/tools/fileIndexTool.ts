import * as vscode from 'vscode';
import { RecallDatabase, SymbolInfo } from '../db';
import { TokenTracker } from '../tokenTracker';

export class RecallFileIndexTool implements vscode.LanguageModelTool<{ query: string; symbolQuery?: string }> {

    constructor(private db: RecallDatabase, private tokenTracker?: TokenTracker) {}

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ query: string; symbolQuery?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {

        const { query, symbolQuery } = options.input;

        // If searching for a specific symbol across files
        if (symbolQuery && symbolQuery.trim() !== '') {
            return this.searchSymbol(symbolQuery);
        }

        // Look up file by path
        const entries = this.db.lookupFileIndex(query);

        if (entries.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `No file index entry found for "${query}". ` +
                    `This file has not been indexed yet. Read the file normally — it will be indexed on the next save.`
                )
            ]);
        }

        let output = '';
        let totalLines = 0;
        for (const entry of entries) {
            output += this.formatEntry(entry);
            totalLines += entry.line_count;
        }

        this.tokenTracker?.recordFileIndexHit(output, totalLines);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(output)
        ]);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ query: string; symbolQuery?: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { query, symbolQuery } = options.input;
        const msg = symbolQuery
            ? `Looking up symbol "${symbolQuery}" in file index`
            : `Looking up file index for "${query}"`;
        return { invocationMessage: msg };
    }

    private searchSymbol(symbolName: string): vscode.LanguageModelToolResult {
        const results = this.db.searchSymbols(symbolName);

        if (results.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `No symbol matching "${symbolName}" found in the file index. ` +
                    `Try grep_search to locate it in the workspace.`
                )
            ]);
        }

        let output = `Found ${results.length} symbol(s) matching "${symbolName}":\n\n`;
        for (const r of results) {
            output += `  ${r.file_path}  L${r.symbol.line}  ${r.symbol.type}  ${r.symbol.name}`;
            if (r.symbol.brief) {
                output += `  — ${r.symbol.brief}`;
            }
            output += '\n';
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(output)
        ]);
    }

    private formatEntry(entry: { file_path: string; summary: string; symbols: string; line_count: number; last_indexed: string }): string {
        let output = `File: ${entry.file_path} (${entry.line_count} lines)\n`;
        output += `Summary: ${entry.summary || '(no summary available)'}\n`;
        output += `Last indexed: ${entry.last_indexed}\n`;

        let symbols: SymbolInfo[];
        try {
            symbols = JSON.parse(entry.symbols);
        } catch {
            output += `Symbols: (error parsing symbol data)\n`;
            return output;
        }

        if (symbols.length === 0) {
            output += `Symbols: (none extracted)\n`;
            return output;
        }

        output += `Symbols (${symbols.length}):\n`;
        for (const sym of symbols) {
            const lineRange = sym.endLine ? `L${sym.line}-L${sym.endLine}` : `L${sym.line}`;
            output += `  ${lineRange.padEnd(14)} ${sym.type.padEnd(10)} ${sym.name}`;
            if (sym.brief) {
                output += `  — ${sym.brief}`;
            }
            output += '\n';
        }
        output += '\n';

        return output;
    }
}
