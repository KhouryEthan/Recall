// ═══════════════════════════════════════════════════════════════════════════════
// OLD VERSION (pre-1.3.0): Used better-sqlite3 (native C++ addon).
// Migrated to sql.js (WebAssembly) in v1.3.0 because better-sqlite3 required
// platform-specific native binaries that broke on:
//   - Windows: NODE_MODULE_VERSION mismatch (Electron ABI != Node ABI)
//   - Linux: glibc version mismatch between build host and user's distro
//   - Remote SSH / WSL: binary compiled for wrong target
// sql.js runs identically on every platform with zero native dependencies.
// See git history for the full better-sqlite3 implementation (commit before v1.3.0).
// ═══════════════════════════════════════════════════════════════════════════════

import initSqlJs, { Database } from 'fts5-sql-bundle';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { decodeEmbedding, encodeEmbedding } from './embeddingBlob';
import { sanitizeFtsQuery } from './ftsQuery';

export interface Observation {
    id: number;
    content: string;
    tags: string;
    project: string;
    source: string;
    status: string;
    created_at: string;
}

export interface FileIndexEntry {
    id: number;
    file_path: string;
    summary: string;
    symbols: string;
    line_count: number;
    last_indexed: string;
}

export interface SymbolInfo {
    name: string;
    type: string;
    line: number;
    endLine?: number;
    brief: string;
}

export class RecallDatabase {
    private db!: Database;
    private dbPath: string;

    private constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    static async create(customPath?: string): Promise<RecallDatabase> {
        const instance = new RecallDatabase(RecallDatabase.resolvePath(customPath));
        const dir = path.dirname(instance.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const wasmDir = path.dirname(require.resolve('fts5-sql-bundle/dist/sql-wasm.wasm'));
        const SQL = await initSqlJs({
            locateFile: (file: string) => path.join(wasmDir, file),
        });

        if (fs.existsSync(instance.dbPath)) {
            const fileBuffer = fs.readFileSync(instance.dbPath);
            instance.db = new SQL.Database(fileBuffer);
        } else {
            instance.db = new SQL.Database();
        }

        instance.initialize();
        return instance;
    }

    private static resolvePath(customPath?: string): string {
        if (customPath && customPath.trim() !== '') {
            return customPath;
        }
        return path.join(os.homedir(), '.recall', 'recall.db');
    }

    private initialize(): void {
        this.db.run('PRAGMA journal_mode = WAL');
        this.db.run('PRAGMA foreign_keys = ON');

        this.db.run(`
            CREATE TABLE IF NOT EXISTS observations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                content     TEXT NOT NULL,
                tags        TEXT DEFAULT '',
                project     TEXT DEFAULT '',
                source      TEXT DEFAULT '',
                status      TEXT DEFAULT 'verified',
                created_at  TEXT DEFAULT (datetime('now')),
                embedding   BLOB DEFAULT NULL
            )
        `);

        this.db.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
                content, tags, source,
                content='observations',
                content_rowid='id'
            )
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
                INSERT INTO observations_fts(rowid, content, tags, source)
                VALUES (new.id, new.content, new.tags, new.source);
            END
        `);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
                INSERT INTO observations_fts(observations_fts, rowid, content, tags, source)
                VALUES ('delete', old.id, old.content, old.tags, old.source);
            END
        `);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
                INSERT INTO observations_fts(observations_fts, rowid, content, tags, source)
                VALUES ('delete', old.id, old.content, old.tags, old.source);
                INSERT INTO observations_fts(rowid, content, tags, source)
                VALUES (new.id, new.content, new.tags, new.source);
            END
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS file_index (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path     TEXT UNIQUE NOT NULL,
                summary       TEXT DEFAULT '',
                symbols       TEXT DEFAULT '[]',
                line_count    INTEGER DEFAULT 0,
                last_indexed  TEXT DEFAULT (datetime('now'))
            )
        `);

        this.db.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS file_index_fts USING fts5(
                file_path, summary, symbols,
                content='file_index',
                content_rowid='id'
            )
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS file_index_ai AFTER INSERT ON file_index BEGIN
                INSERT INTO file_index_fts(rowid, file_path, summary, symbols)
                VALUES (new.id, new.file_path, new.summary, new.symbols);
            END
        `);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS file_index_ad AFTER DELETE ON file_index BEGIN
                INSERT INTO file_index_fts(file_index_fts, rowid, file_path, summary, symbols)
                VALUES ('delete', old.id, old.file_path, old.summary, old.symbols);
            END
        `);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS file_index_au AFTER UPDATE ON file_index BEGIN
                INSERT INTO file_index_fts(file_index_fts, rowid, file_path, summary, symbols)
                VALUES ('delete', old.id, old.file_path, old.summary, old.symbols);
                INSERT INTO file_index_fts(rowid, file_path, summary, symbols)
                VALUES (new.id, new.file_path, new.summary, new.symbols);
            END
        `);

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_tags ON observations(tags)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(file_path)`);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS token_stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                search_hits INTEGER DEFAULT 0,
                file_index_hits INTEGER DEFAULT 0,
                tokens_used INTEGER DEFAULT 0,
                tokens_without_recall INTEGER DEFAULT 0,
                last_updated TEXT DEFAULT (datetime('now'))
            )
        `);

        this.migrateEmbeddings();
    }

    private migrateEmbeddings(): void {
        const cols = this.queryAll<{ name: string }>('PRAGMA table_info(observations)');
        if (!cols.some(c => c.name === 'embedding')) {
            this.db.run('ALTER TABLE observations ADD COLUMN embedding BLOB DEFAULT NULL');
        }
    }

    private persist(): void {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }

    private queryAll<T>(sql: string, params?: any[]): T[] {
        const stmt = this.db.prepare(sql);
        if (params) { stmt.bind(params); }
        const results: T[] = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject() as T);
        }
        stmt.free();
        return results;
    }

    private queryOne<T>(sql: string, params?: any[]): T | undefined {
        const stmt = this.db.prepare(sql);
        if (params) { stmt.bind(params); }
        let result: T | undefined;
        if (stmt.step()) {
            result = stmt.getAsObject() as T;
        }
        stmt.free();
        return result;
    }

    private runAndPersist(sql: string, params?: any[]): void {
        this.db.run(sql, params);
        this.persist();
    }

    private getProjectName(): string {
        const configured = vscode.workspace.getConfiguration('recall').get<string>('projectName', '');
        if (configured) { return configured; }
        return vscode.workspace.workspaceFolders?.[0]?.name || '';
    }

    // ─── Observation Operations ──────────────────────────────────────────

    insertObservation(content: string, tags: string = '', source: string = 'manual', status: string = 'verified', project?: string): number {
        const proj = project || this.getProjectName();
        this.db.run(
            `INSERT INTO observations (content, tags, project, source, status) VALUES (?, ?, ?, ?, ?)`,
            [content, tags, proj, source, status]
        );
        const row = this.queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
        this.persist();
        return row!.id;
    }

    searchObservations(query: string, tags?: string, limit: number = 10): Observation[] {
        const sanitized = sanitizeFtsQuery(query);
        if (!sanitized) { return []; }

        let sql: string;
        let params: any[];

        if (tags && tags.trim() !== '') {
            const tagList = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            const tagClauses = tagList.map(() => `o.tags LIKE ?`).join(' AND ');
            sql = `
                SELECT o.id, o.content, o.tags, o.project, o.source, o.status, o.created_at
                FROM observations_fts fts
                JOIN observations o ON o.id = fts.rowid
                WHERE observations_fts MATCH ?
                AND o.status != 'rejected'
                AND (${tagClauses})
                ORDER BY rank
                LIMIT ?
            `;
            params = [sanitized, ...tagList.map(t => `%${t}%`), limit];
        } else {
            sql = `
                SELECT o.id, o.content, o.tags, o.project, o.source, o.status, o.created_at
                FROM observations_fts fts
                JOIN observations o ON o.id = fts.rowid
                WHERE observations_fts MATCH ?
                AND o.status != 'rejected'
                ORDER BY rank
                LIMIT ?
            `;
            params = [sanitized, limit];
        }

        try {
            return this.queryAll<Observation>(sql, params);
        } catch {
            return this.searchObservationsFallback(query, tags, limit);
        }
    }

    private searchObservationsFallback(query: string, tags?: string, limit: number = 10): Observation[] {
        const words = query.split(/\s+/).filter(w => w.length > 0);
        const likeClauses = words.map(() => `content LIKE ?`).join(' AND ');
        let sql = `SELECT * FROM observations WHERE ${likeClauses} AND status != 'rejected'`;
        const params: any[] = words.map(w => `%${w}%`);

        if (tags && tags.trim() !== '') {
            const tagList = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            for (const t of tagList) {
                sql += ` AND tags LIKE ?`;
                params.push(`%${t}%`);
            }
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        return this.queryAll<Observation>(sql, params);
    }

    getRecentObservations(limit: number = 20, days?: number): Observation[] {
        let sql = `SELECT * FROM observations WHERE status != 'rejected'`;
        const params: any[] = [];

        if (days) {
            sql += ` AND created_at >= datetime('now', ?)`;
            params.push(`-${days} days`);
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        return this.queryAll<Observation>(sql, params);
    }

    getPendingObservations(): Observation[] {
        return this.queryAll<Observation>(
            `SELECT * FROM observations WHERE status = 'pending' ORDER BY created_at DESC`
        );
    }

    updateStatus(id: number, status: string): void {
        this.runAndPersist(`UPDATE observations SET status = ? WHERE id = ?`, [status, id]);
    }

    updateContent(id: number, content: string): void {
        this.runAndPersist(`UPDATE observations SET content = ? WHERE id = ?`, [content, id]);
    }

    deleteObservation(id: number): void {
        this.runAndPersist(`DELETE FROM observations WHERE id = ?`, [id]);
    }

    expirePendingObservations(days: number = 7): number {
        const before = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM observations WHERE status = 'pending' AND created_at < datetime('now', ?)`, [`-${days} days`]);
        this.runAndPersist(`DELETE FROM observations WHERE status = 'pending' AND created_at < datetime('now', ?)`, [`-${days} days`]);
        return before?.c ?? 0;
    }

    getObservationById(id: number): Observation | undefined {
        return this.queryOne<Observation>(`SELECT * FROM observations WHERE id = ?`, [id]);
    }

    // ─── Embedding Operations ────────────────────────────────────────────

    storeEmbedding(id: number, embedding: Float32Array): void {
        const buffer = encodeEmbedding(embedding);
        this.db.run(`UPDATE observations SET embedding = ? WHERE id = ?`, [buffer, id]);
        this.persist();
    }

    getEmbedding(id: number): Float32Array | null {
        const row = this.queryOne<{ embedding: Uint8Array | null }>(`SELECT embedding FROM observations WHERE id = ?`, [id]);
        if (!row?.embedding) { return null; }
        return decodeEmbedding(Buffer.from(row.embedding));
    }

    getAllWithEmbeddings(): Array<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Float32Array }> {
        const rows = this.queryAll<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Uint8Array }>(
            `SELECT id, content, tags, project, source, status, created_at, embedding FROM observations WHERE embedding IS NOT NULL AND status != 'rejected'`
        );

        const out: Array<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Float32Array }> = [];
        for (const r of rows) {
            const decoded = decodeEmbedding(Buffer.from(r.embedding));
            if (!decoded) { continue; }
            out.push({ ...r, embedding: decoded });
        }
        return out;
    }

    getObservationsWithoutEmbeddings(): Observation[] {
        return this.queryAll<Observation>(
            `SELECT * FROM observations WHERE embedding IS NULL AND status != 'rejected' ORDER BY created_at DESC`
        );
    }

    // ─── File Index Operations ───────────────────────────────────────────

    upsertFileIndex(filePath: string, summary: string, symbols: SymbolInfo[], lineCount: number): void {
        const symbolsJson = JSON.stringify(symbols);
        const existing = this.queryOne<{ id: number }>(`SELECT id FROM file_index WHERE file_path = ?`, [filePath]);

        if (existing) {
            this.runAndPersist(
                `UPDATE file_index SET summary = ?, symbols = ?, line_count = ?, last_indexed = datetime('now') WHERE file_path = ?`,
                [summary, symbolsJson, lineCount, filePath]
            );
        } else {
            this.runAndPersist(
                `INSERT INTO file_index (file_path, summary, symbols, line_count) VALUES (?, ?, ?, ?)`,
                [filePath, summary, symbolsJson, lineCount]
            );
        }
    }

    lookupFileIndex(query: string): FileIndexEntry[] {
        const raw = (query || '').trim();
        if (!raw) { return []; }

        // Normalize: strip leading ./, drive letters, and quotes; collapse slashes.
        const normalized = raw
            .replace(/^["']|["']$/g, '')
            .replace(/^\.\/+/, '')
            .replace(/\\/g, '/');

        // Step 1 — exact path match (rare but cheapest).
        const exact = this.queryAll<FileIndexEntry>(
            `SELECT * FROM file_index WHERE file_path = ? OR REPLACE(file_path, '\\', '/') = ?`,
            [raw, normalized]
        );
        if (exact.length > 0) { return exact; }

        // Step 2 — try basename-style matches in a deterministic order.
        // We normalize stored paths to forward slashes for comparison so this works
        // regardless of whether the file was indexed on Windows or POSIX.
        const hasExt = /\.[A-Za-z0-9]+$/.test(normalized);
        const patterns: string[] = [];

        // Path ends with /<query> or /<query>.* (covers exact basename + basename-without-ext)
        patterns.push(`%/${normalized}`);
        if (!hasExt) {
            patterns.push(`%/${normalized}.%`);
        }
        // Substring fallback (catches nested matches, partial names, etc.)
        patterns.push(`%${normalized}%`);

        const seen = new Set<number>();
        const ordered: FileIndexEntry[] = [];
        for (const pattern of patterns) {
            const rows = this.queryAll<FileIndexEntry>(
                `SELECT * FROM file_index WHERE REPLACE(file_path, '\\', '/') LIKE ? LIMIT 25`,
                [pattern]
            );
            for (const row of rows) {
                if (!seen.has(row.id)) {
                    seen.add(row.id);
                    ordered.push(row);
                }
            }
            // Stop early if we already have a tight match.
            if (ordered.length > 0 && pattern !== `%${normalized}%`) { break; }
        }
        if (ordered.length > 0) { return ordered.slice(0, 25); }

        // Step 3 — full-text fallback against summary / symbols / path.
        const sanitized = sanitizeFtsQuery(raw);
        if (!sanitized) { return []; }

        try {
            return this.queryAll<FileIndexEntry>(`
                SELECT fi.*
                FROM file_index_fts fts
                JOIN file_index fi ON fi.id = fts.rowid
                WHERE file_index_fts MATCH ?
                LIMIT 10
            `, [sanitized]);
        } catch {
            return this.queryAll<FileIndexEntry>(
                `SELECT * FROM file_index WHERE file_path LIKE ? OR summary LIKE ? OR symbols LIKE ? LIMIT 10`,
                [`%${raw}%`, `%${raw}%`, `%${raw}%`]
            );
        }
    }

    searchSymbols(symbolName: string): Array<{ file_path: string; symbol: SymbolInfo }> {
        const results: Array<{ file_path: string; symbol: SymbolInfo }> = [];
        const rows = this.queryAll<FileIndexEntry>(
            `SELECT file_path, symbols FROM file_index WHERE symbols LIKE ?`,
            [`%${symbolName}%`]
        );

        for (const row of rows) {
            try {
                const symbols: SymbolInfo[] = JSON.parse(row.symbols);
                for (const sym of symbols) {
                    if (sym.name.toLowerCase().includes(symbolName.toLowerCase())) {
                        results.push({ file_path: row.file_path, symbol: sym });
                    }
                }
            } catch { /* skip malformed JSON */ }
        }

        return results;
    }

    getFileIndexEntry(filePath: string): FileIndexEntry | undefined {
        return this.queryOne<FileIndexEntry>(`SELECT * FROM file_index WHERE file_path = ?`, [filePath]);
    }

    deleteFileIndexEntry(id: number): void {
        this.runAndPersist(`DELETE FROM file_index WHERE id = ?`, [id]);
    }

    // ─── Statistics ──────────────────────────────────────────────────────

    getStats(): {
        totalObservations: number;
        verifiedObservations: number;
        pendingObservations: number;
        totalFilesIndexed: number;
        totalSymbols: number;
        oldestObservation: string | null;
        newestObservation: string | null;
        topTags: Array<{ tag: string; count: number }>;
        dbSizeBytes: number;
    } {
        const total = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM observations`)!.c;
        const verified = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM observations WHERE status = 'verified'`)!.c;
        const pending = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM observations WHERE status = 'pending'`)!.c;
        const filesIndexed = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM file_index`)!.c;

        let totalSymbols = 0;
        const allSymbols = this.queryAll<{ symbols: string }>(`SELECT symbols FROM file_index`);
        for (const row of allSymbols) {
            try {
                totalSymbols += (JSON.parse(row.symbols) as SymbolInfo[]).length;
            } catch { /* skip */ }
        }

        const oldest = this.queryOne<{ d: string | null }>(`SELECT MIN(created_at) as d FROM observations`);
        const newest = this.queryOne<{ d: string | null }>(`SELECT MAX(created_at) as d FROM observations`);

        const tagRows = this.queryAll<{ tags: string }>(`SELECT tags FROM observations WHERE tags != ''`);
        const tagCounts = new Map<string, number>();
        for (const row of tagRows) {
            for (const tag of row.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)) {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
        }
        const topTags = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));

        let dbSizeBytes = 0;
        try { dbSizeBytes = fs.statSync(this.dbPath).size; } catch { /* ignore */ }

        return {
            totalObservations: total,
            verifiedObservations: verified,
            pendingObservations: pending,
            totalFilesIndexed: filesIndexed,
            totalSymbols,
            oldestObservation: oldest?.d ?? null,
            newestObservation: newest?.d ?? null,
            topTags,
            dbSizeBytes,
        };
    }

    // ─── Filtering & Listing ────────────────────────────────────────────

    getAllObservations(filters?: { status?: string; tag?: string; source?: string; project?: string }): Observation[] {
        let sql = `SELECT * FROM observations WHERE 1=1`;
        const params: any[] = [];

        if (filters?.status) {
            sql += ` AND status = ?`;
            params.push(filters.status);
        }
        if (filters?.tag) {
            sql += ` AND tags LIKE ?`;
            params.push(`%${filters.tag}%`);
        }
        if (filters?.source) {
            sql += ` AND source = ?`;
            params.push(filters.source);
        }
        if (filters?.project) {
            sql += ` AND project = ?`;
            params.push(filters.project);
        }

        sql += ` ORDER BY created_at DESC`;
        return this.queryAll<Observation>(sql, params.length > 0 ? params : undefined);
    }

    getDistinctProjects(): string[] {
        return this.queryAll<{ project: string }>(
            `SELECT DISTINCT project FROM observations WHERE project != '' ORDER BY project`
        ).map(r => r.project);
    }

    cleanupBuildArtifacts(): number {
        const blocked = [
            'node_modules', '.next', '.nuxt', '.output', '.svelte-kit', '.astro',
            '.vite', '.parcel-cache', '.turbo', '.cache', 'coverage', '.nyc_output',
            'storybook-static', '__pycache__', '.pytest_cache', '.mypy_cache',
            'venv', '.venv', 'target', '.gradle', '.angular', 'dist', 'build',
        ];
        let total = 0;
        for (const dir of blocked) {
            const before = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM file_index WHERE file_path LIKE ? OR file_path LIKE ?`, [`%/${dir}/%`, `%\\${dir}\\%`]);
            this.db.run(`DELETE FROM file_index WHERE file_path LIKE ? OR file_path LIKE ?`, [`%/${dir}/%`, `%\\${dir}\\%`]);
            total += before?.c ?? 0;
        }
        if (total > 0) { this.persist(); }
        return total;
    }

    getAllFileIndexEntries(): FileIndexEntry[] {
        return this.queryAll<FileIndexEntry>(`SELECT * FROM file_index ORDER BY file_path`);
    }

    clearFileIndex(): number {
        const count = this.queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM file_index`)!.c;
        this.db.run(`DELETE FROM file_index`);
        this.db.run(`INSERT INTO file_index_fts(file_index_fts) VALUES('rebuild')`);
        this.persist();
        return count;
    }

    vacuum(): void {
        this.db.run(`VACUUM`);
        this.persist();
    }

    updateObservation(id: number, content: string, tags: string): void {
        this.runAndPersist(`UPDATE observations SET content = ?, tags = ? WHERE id = ?`, [content, tags, id]);
    }

    getDistinctSources(): string[] {
        return this.queryAll<{ source: string }>(
            `SELECT DISTINCT source FROM observations ORDER BY source`
        ).map(r => r.source);
    }

    getDistinctTags(): string[] {
        const tagRows = this.queryAll<{ tags: string }>(`SELECT tags FROM observations WHERE tags != ''`);
        const tagSet = new Set<string>();
        for (const row of tagRows) {
            for (const tag of row.tags.split(',').map(t => t.trim()).filter(t => t.length > 0)) {
                tagSet.add(tag);
            }
        }
        return Array.from(tagSet).sort();
    }

    // ─── Export ───────────────────────────────────────────────────────────

    exportAll(): { observations: Observation[]; fileIndex: FileIndexEntry[] } {
        const observations = this.queryAll<Observation>(`SELECT * FROM observations ORDER BY created_at DESC`);
        const fileIndex = this.queryAll<FileIndexEntry>(`SELECT * FROM file_index ORDER BY file_path`);
        return { observations, fileIndex };
    }

    // ─── Token Stats ─────────────────────────────────────────────────────

    getTokenStats(): { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number } | undefined {
        return this.queryOne<{ search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number }>(
            `SELECT search_hits, file_index_hits, tokens_used, tokens_without_recall FROM token_stats WHERE id = 1`
        );
    }

    upsertTokenStats(stats: { search_hits: number; file_index_hits: number; tokens_used: number; tokens_without_recall: number }): void {
        this.runAndPersist(
            `INSERT INTO token_stats (id, search_hits, file_index_hits, tokens_used, tokens_without_recall, last_updated)
             VALUES (1, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                search_hits = ?,
                file_index_hits = ?,
                tokens_used = ?,
                tokens_without_recall = ?,
                last_updated = datetime('now')`,
            [stats.search_hits, stats.file_index_hits, stats.tokens_used, stats.tokens_without_recall,
             stats.search_hits, stats.file_index_hits, stats.tokens_used, stats.tokens_without_recall]
        );
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────

    getDbPath(): string {
        return this.dbPath;
    }

    close(): void {
        this.persist();
        this.db.close();
    }
}
