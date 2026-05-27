import * as vscode from 'vscode';
import { RecallDatabase, SymbolInfo } from './db';

/**
 * Automatically indexes source files on save — extracts function/class/struct symbols
 * and generates one-sentence summaries. This is what makes recall_file_index work.
 */
export class FileIndexBuilder {
    private disposables: vscode.Disposable[] = [];
    private indexingInProgress = new Set<string>();

    constructor(private db: RecallDatabase) {}

    activate(context: vscode.ExtensionContext): void {
        const config = vscode.workspace.getConfiguration('recall');

        if (config.get<boolean>('autoIndexOnSave', true)) {
            this.disposables.push(
                vscode.workspace.onDidSaveTextDocument((doc) => this.onFileSaved(doc))
            );
        }

        context.subscriptions.push(...this.disposables);
    }

    /**
     * Index a file on save — extract symbols and generate summary.
     */
    private async onFileSaved(doc: vscode.TextDocument): Promise<void> {
        // Only index source files we care about
        if (!this.shouldIndex(doc)) { return; }

        const filePath = doc.uri.fsPath;

        // Prevent concurrent indexing of the same file
        if (this.indexingInProgress.has(filePath)) { return; }
        this.indexingInProgress.add(filePath);

        try {
            await this.indexDocument(doc);
        } catch (err) {
            console.error(`[Recall] Failed to index ${filePath}:`, err);
        } finally {
            this.indexingInProgress.delete(filePath);
        }
    }

    /**
     * Public method to manually index a specific document.
     */
    async indexDocument(doc: vscode.TextDocument): Promise<void> {
        const filePath = doc.uri.fsPath;
        const lineCount = doc.lineCount;

        // Step 1: Extract symbols using VS Code's built-in DocumentSymbolProvider
        const symbols = await this.extractSymbols(doc);

        // Step 2: Generate a summary
        const summary = await this.generateSummary(doc, symbols);

        // Step 3: Upsert into database
        this.db.upsertFileIndex(filePath, summary, symbols, lineCount);
    }

    /**
     * Index all open workspace files (for re-indexing).
     */
    async indexWorkspace(progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<number> {
        const allExts = [...FileIndexBuilder.DEFAULT_EXTENSIONS];
        const extras: string[] = vscode.workspace.getConfiguration('recall').get('indexFileExtensions', []);
        for (const e of extras) {
            const clean = e.replace(/^\./, '').toLowerCase();
            if (clean && !allExts.includes(clean)) { allExts.push(clean); }
        }
        const pattern = `**/*.{${allExts.join(',')}}`;
        const excludes = [
            // Universal
            '**/node_modules/**', '**/.git/**', '**/vendor/**',
            // JS/TS build output
            '**/dist/**', '**/build/**', '**/out/**',
            // Next.js / Nuxt / SvelteKit / Astro / Remix
            '**/.next/**', '**/.nuxt/**', '**/.output/**', '**/.svelte-kit/**', '**/.astro/**',
            // Vite / Parcel / Turbopack / Turborepo
            '**/.vite/**', '**/.parcel-cache/**', '**/.turbo/**',
            // Caches & coverage
            '**/.cache/**', '**/coverage/**', '**/.nyc_output/**',
            // Storybook
            '**/storybook-static/**',
            // Python
            '**/__pycache__/**', '**/.pytest_cache/**', '**/.mypy_cache/**',
            '**/venv/**', '**/.venv/**', '**/*.egg-info/**',
            // Java / Kotlin / Scala
            '**/target/**',
            // .NET
            '**/bin/**', '**/obj/**',
            // Gradle
            '**/.gradle/**',
            // Angular
            '**/.angular/**',
        ].join(',');
        const excludeGlob = `{${excludes}}`;

        const files = await vscode.workspace.findFiles(pattern, excludeGlob, 2000);
        let indexed = 0;

        for (let i = 0; i < files.length; i++) {
            const uri = files[i];
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await this.indexDocument(doc);
                indexed++;

                if (progress) {
                    progress.report({
                        message: `Indexing ${uri.fsPath.split(/[\\/]/).pop()} (${indexed}/${files.length})`,
                        increment: (1 / files.length) * 100,
                    });
                }
            } catch {
                // Skip files that can't be opened
            }
        }

        return indexed;
    }

    /**
     * Extract symbols from a document using VS Code's DocumentSymbolProvider.
     */
    private async extractSymbols(doc: vscode.TextDocument): Promise<SymbolInfo[]> {
        const symbols: SymbolInfo[] = [];

        try {
            const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider', doc.uri
            );

            if (docSymbols) {
                this.flattenSymbols(docSymbols, symbols);
            }
        } catch {
            // DocumentSymbolProvider not available for this language — fall back to regex
            this.extractSymbolsRegex(doc, symbols);
        }

        // If DocumentSymbolProvider returned nothing, try regex
        if (symbols.length === 0) {
            this.extractSymbolsRegex(doc, symbols);
        }

        return symbols;
    }

    /**
     * Recursively flatten document symbols into our SymbolInfo format.
     */
    private flattenSymbols(docSymbols: vscode.DocumentSymbol[], out: SymbolInfo[], depth: number = 0): void {
        for (const sym of docSymbols) {
            const type = this.mapSymbolKind(sym.kind);
            // Skip anonymous/generated symbols from bundled files
            if (!type) { continue; }
            if (!sym.name || sym.name === '<unknown>' || sym.name === '<function>' || sym.name.startsWith('<')) { continue; }
            // Skip auto-generated Turbopack/Webpack import variable names
            if (sym.name.startsWith('__TURBOPACK__') || sym.name.startsWith('__webpack_') || sym.name.startsWith('__esModule')) { continue; }

            out.push({
                name: sym.name,
                type,
                line: sym.range.start.line + 1,
                endLine: sym.range.end.line + 1,
                brief: sym.detail || '',
            });

            // Recurse into children (methods inside classes, etc.)
            if (sym.children && sym.children.length > 0 && depth < 2) {
                this.flattenSymbols(sym.children, out, depth + 1);
            }
        }
    }

    private mapSymbolKind(kind: vscode.SymbolKind): string | null {
        switch (kind) {
            case vscode.SymbolKind.Function: return 'function';
            case vscode.SymbolKind.Method: return 'method';
            case vscode.SymbolKind.Class: return 'class';
            case vscode.SymbolKind.Struct: return 'struct';
            case vscode.SymbolKind.Enum: return 'enum';
            case vscode.SymbolKind.Interface: return 'interface';
            case vscode.SymbolKind.Constructor: return 'constructor';
            case vscode.SymbolKind.Namespace: return 'namespace';
            case vscode.SymbolKind.Variable: return 'variable';
            case vscode.SymbolKind.Constant: return 'constant';
            case vscode.SymbolKind.TypeParameter: return 'typedef';
            default: return null;
        }
    }

    /**
     * Fallback regex extraction when no DocumentSymbolProvider is available.
     * Dispatches to language-specific regex patterns based on file extension.
     */
    private extractSymbolsRegex(doc: vscode.TextDocument, out: SymbolInfo[]): void {
        const ext = doc.uri.fsPath.split('.').pop()?.toLowerCase() || '';
        const lines = doc.getText().split('\n');

        const matchers = this.getRegexMatchersForExt(ext);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
                continue;
            }

            for (const matcher of matchers) {
                const m = line.match(matcher.regex);
                if (m && m[1]) {
                    if (matcher.skip?.includes(m[1])) { continue; }
                    out.push({ name: m[1], type: matcher.type, line: i + 1, brief: '' });
                    break;
                }
            }
        }
    }

    private getRegexMatchersForExt(ext: string): Array<{ regex: RegExp; type: string; skip?: string[] }> {
        const cSkip = ['if', 'else', 'while', 'for', 'switch', 'return', 'case', 'sizeof'];

        switch (ext) {
            case 'c': case 'cpp': case 'cc': case 'cxx': case 'h': case 'hpp': case 'hxx':
                return [
                    { regex: /^[\w\s*&:~]+\s+(\w[\w:]*)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*(?:\{|$)/, type: 'function', skip: cSkip },
                    { regex: /^\s*(?:typedef\s+)?(?:struct|class|enum)\s+(\w+)/, type: 'class' },
                ];
            case 'ts': case 'tsx': case 'js': case 'jsx': case 'mjs': case 'cjs':
                return [
                    { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
                    { regex: /^\s*(?:export\s+)?class\s+(\w+)/, type: 'class' },
                    { regex: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: 'function' },
                    { regex: /^\s*(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
                    { regex: /^\s*(?:export\s+)?type\s+(\w+)/, type: 'typedef' },
                    { regex: /^\s*(?:export\s+)?enum\s+(\w+)/, type: 'enum' },
                ];
            case 'py': case 'pyw':
                return [
                    { regex: /^\s*def\s+(\w+)\s*\(/, type: 'function' },
                    { regex: /^\s*class\s+(\w+)/, type: 'class' },
                    { regex: /^\s*async\s+def\s+(\w+)\s*\(/, type: 'function' },
                ];
            case 'java': case 'kt': case 'kts': case 'scala': case 'cs':
                return [
                    { regex: /^\s*(?:public|private|protected|internal|static|abstract|override|suspend|open|final|\s)*\s*(?:fun|def|void|int|long|boolean|String|double|float|char|byte|short|var|val|object)\s+(\w+)\s*[(<]/, type: 'function' },
                    { regex: /^\s*(?:public|private|protected|internal|abstract|sealed|data|open|final|\s)*\s*(?:class|struct|interface|enum|record|object)\s+(\w+)/, type: 'class' },
                ];
            case 'go':
                return [
                    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/, type: 'function' },
                    { regex: /^type\s+(\w+)\s+(?:struct|interface)/, type: 'struct' },
                ];
            case 'rs':
                return [
                    { regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, type: 'function' },
                    { regex: /^\s*(?:pub\s+)?struct\s+(\w+)/, type: 'struct' },
                    { regex: /^\s*(?:pub\s+)?enum\s+(\w+)/, type: 'enum' },
                    { regex: /^\s*(?:pub\s+)?trait\s+(\w+)/, type: 'interface' },
                    { regex: /^\s*impl(?:<[^>]*>)?\s+(\w+)/, type: 'class' },
                ];
            case 'rb':
                return [
                    { regex: /^\s*def\s+(\w+[!?]?)/, type: 'function' },
                    { regex: /^\s*class\s+(\w+)/, type: 'class' },
                    { regex: /^\s*module\s+(\w+)/, type: 'namespace' },
                ];
            case 'php':
                return [
                    { regex: /^\s*(?:public|private|protected|static|\s)*function\s+(\w+)/, type: 'function' },
                    { regex: /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/, type: 'class' },
                    { regex: /^\s*interface\s+(\w+)/, type: 'interface' },
                    { regex: /^\s*trait\s+(\w+)/, type: 'class' },
                ];
            case 'swift':
                return [
                    { regex: /^\s*(?:public|private|internal|open|fileprivate|\s)*func\s+(\w+)/, type: 'function' },
                    { regex: /^\s*(?:public|private|internal|open|\s)*(?:class|struct|enum|protocol)\s+(\w+)/, type: 'class' },
                ];
            case 'lua':
                return [
                    { regex: /^\s*(?:local\s+)?function\s+(\w[\w.]*)/, type: 'function' },
                ];
            default:
                return [
                    { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
                    { regex: /^\s*(?:export\s+)?class\s+(\w+)/, type: 'class' },
                    { regex: /^\s*def\s+(\w+)\s*\(/, type: 'function' },
                ];
        }
    }

    /**
     * Generate a deterministic one-sentence summary of the file.
     * This avoids VS Code's Language Model API so indexing stays local-only.
     */
    private async generateSummary(doc: vscode.TextDocument, symbols: SymbolInfo[]): Promise<string> {
        return this.generateHeuristicSummary(doc, symbols);
    }

    private generateHeuristicSummary(doc: vscode.TextDocument, symbols: SymbolInfo[]): string {
        const fileName = doc.uri.fsPath.split('/').pop() || '';

        // Try to extract from file header comment
        const text = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 30), 0));
        const headerMatch = text.match(/(?:\/\*\*?|\/\/)\s*(?:@(?:brief|file|description)\s+)?(.+?)(?:\n|\*\/)/);
        if (headerMatch && headerMatch[1]) {
            return headerMatch[1].trim().replace(/\*\s*$/, '').trim();
        }

        // Build from symbol names
        const functions = symbols.filter(s => s.type === 'function' || s.type === 'method');
        const classes = symbols.filter(s => s.type === 'class' || s.type === 'struct');

        if (classes.length > 0 && functions.length > 0) {
            return `${fileName} — defines ${classes.map(c => c.name).join(', ')} with ${functions.length} function(s)`;
        }
        if (functions.length > 0) {
            const topFuncs = functions.slice(0, 3).map(f => f.name).join(', ');
            return `${fileName} — ${functions.length} function(s) including ${topFuncs}`;
        }

        return `${fileName} — ${doc.lineCount} lines`;
    }

    private static readonly DEFAULT_EXTENSIONS = new Set([
        'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx',
        'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
        'py', 'pyw',
        'java', 'kt', 'kts', 'scala',
        'go',
        'rs',
        'cs',
        'rb',
        'php',
        'swift',
        'lua',
        'sh', 'bash', 'zsh',
        'sql',
        'r',
        'dart',
        'ex', 'exs',
        'zig',
        'vue', 'svelte',
    ]);

    private shouldIndex(doc: vscode.TextDocument): boolean {
        const fsPath = doc.uri.fsPath.replace(/\\/g, '/');

        // Never index build artifacts, caches, or generated output
        const blockedPaths = [
            // Universal
            '/node_modules/', '/.git/', '/vendor/',
            // JS/TS build output
            '/dist/', '/build/', '/out/',
            // Next.js / Nuxt / SvelteKit / Astro / Remix
            '/.next/', '/.nuxt/', '/.output/', '/.svelte-kit/', '/.astro/',
            // Vite / Parcel / Turbopack / Turborepo
            '/.vite/', '/.parcel-cache/', '/.turbo/',
            // Caches & coverage
            '/.cache/', '/coverage/', '/.nyc_output/',
            // Storybook
            '/storybook-static/',
            // Python
            '/__pycache__/', '/.pytest_cache/', '/.mypy_cache/', '/venv/', '/.venv/',
            // Java / Kotlin / Scala / Maven
            '/target/',
            // .NET
            '/bin/', '/obj/',
            // Gradle / Angular
            '/.gradle/', '/.angular/',
        ];
        if (blockedPaths.some(p => fsPath.includes(p))) { return false; }

        const ext = fsPath.split('.').pop()?.toLowerCase() || '';
        if (FileIndexBuilder.DEFAULT_EXTENSIONS.has(ext)) { return true; }
        const extras: string[] = vscode.workspace.getConfiguration('recall').get('indexFileExtensions', []);
        return extras.some(e => e.replace(/^\./, '').toLowerCase() === ext);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
