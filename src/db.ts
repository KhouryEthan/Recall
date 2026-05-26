import Database from 'better-sqlite3';
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
    symbols: string; // JSON array
    line_count: number;
    last_indexed: string;
}

export interface SymbolInfo {
    name: string;
    type: string; // 'function' | 'class' | 'struct' | 'enum' | 'method' | 'variable'
    line: number;
    endLine?: number;
    brief: string;
}

export class RecallDatabase {
    private db: Database.Database;
    private dbPath: string;

    constructor(customPath?: string) {
        this.dbPath = this.resolvePath(customPath);
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(this.dbPath);
        this.initialize();
    }

    private resolvePath(customPath?: string): string {
        if (customPath && customPath.trim() !== '') {
            return customPath;
        }
        return path.join(os.homedir(), '.recall', 'recall.db');
    }

    private initialize(): void {
        // Enable WAL mode for concurrent read/write safety
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        // Create observations table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS observations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                content     TEXT NOT NULL,
                tags        TEXT DEFAULT '',
                project     TEXT DEFAULT '',
                source      TEXT DEFAULT '',
                status      TEXT DEFAULT 'verified',
                created_at  TEXT DEFAULT (datetime('now'))
            );
        `);

        // Create FTS5 virtual table for observations
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
                content, tags, source,
                content='observations',
                content_rowid='id'
            );
        `);

        // Triggers to keep FTS in sync with observations table
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
                INSERT INTO observations_fts(rowid, content, tags, source)
                VALUES (new.id, new.content, new.tags, new.source);
            END;
        `);
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
                INSERT INTO observations_fts(observations_fts, rowid, content, tags, source)
                VALUES ('delete', old.id, old.content, old.tags, old.source);
            END;
        `);
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
                INSERT INTO observations_fts(observations_fts, rowid, content, tags, source)
                VALUES ('delete', old.id, old.content, old.tags, old.source);
                INSERT INTO observations_fts(rowid, content, tags, source)
                VALUES (new.id, new.content, new.tags, new.source);
            END;
        `);

        // Create file_index table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS file_index (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path     TEXT UNIQUE NOT NULL,
                summary       TEXT DEFAULT '',
                symbols       TEXT DEFAULT '[]',
                line_count    INTEGER DEFAULT 0,
                last_indexed  TEXT DEFAULT (datetime('now'))
            );
        `);

        // FTS5 for file index
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS file_index_fts USING fts5(
                file_path, summary, symbols,
                content='file_index',
                content_rowid='id'
            );
        `);

        // Triggers for file_index FTS sync
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS file_index_ai AFTER INSERT ON file_index BEGIN
                INSERT INTO file_index_fts(rowid, file_path, summary, symbols)
                VALUES (new.id, new.file_path, new.summary, new.symbols);
            END;
        `);
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS file_index_ad AFTER DELETE ON file_index BEGIN
                INSERT INTO file_index_fts(file_index_fts, rowid, file_path, summary, symbols)
                VALUES ('delete', old.id, old.file_path, old.summary, old.symbols);
            END;
        `);
        this.db.exec(`
            CREATE TRIGGER IF NOT EXISTS file_index_au AFTER UPDATE ON file_index BEGIN
                INSERT INTO file_index_fts(file_index_fts, rowid, file_path, summary, symbols)
                VALUES ('delete', old.id, old.file_path, old.summary, old.symbols);
                INSERT INTO file_index_fts(rowid, file_path, summary, symbols)
                VALUES (new.id, new.file_path, new.summary, new.symbols);
            END;
        `);

        // Create indexes
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_observations_tags ON observations(tags);
            CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source);
            CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status);
            CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at);
            CREATE INDEX IF NOT EXISTS idx_file_index_path ON file_index(file_path);
        `);

        // ─── Migration: Add embedding column ─────────────────────────────
        this.migrateEmbeddings();
    }

    private migrateEmbeddings(): void {
        // Check if embedding column exists
        const cols = this.db.prepare(`PRAGMA table_info(observations)`).all() as Array<{ name: string }>;
        const hasEmbedding = cols.some(c => c.name === 'embedding');
        if (!hasEmbedding) {
            this.db.exec(`ALTER TABLE observations ADD COLUMN embedding BLOB DEFAULT NULL`);
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    private getProjectName(): string {
        const configured = vscode.workspace.getConfiguration('recall').get<string>('projectName', '');
        if (configured) { return configured; }
        return vscode.workspace.workspaceFolders?.[0]?.name || '';
    }

    // ─── Observation Operations ──────────────────────────────────────────

    insertObservation(content: string, tags: string = '', source: string = 'manual', status: string = 'verified', project?: string): number {
        const proj = project || this.getProjectName();
        const stmt = this.db.prepare(`
            INSERT INTO observations (content, tags, project, source, status)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(content, tags, proj, source, status);
        return result.lastInsertRowid as number;
    }

    searchObservations(query: string, tags?: string, limit: number = 10): Observation[] {
        // Sanitize query for FTS5 — escape special characters and wrap terms
        const sanitized = sanitizeFtsQuery(query);
        if (!sanitized) {
            return [];
        }

        let sql: string;
        let params: (string | number)[];

        if (tags && tags.trim() !== '') {
            // Filter by tags using LIKE on the tags column
            const tagList = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            const tagClauses = tagList.map(() => `o.tags LIKE ?`).join(' AND ');
            sql = `
                SELECT o.*, rank
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
                SELECT o.*, rank
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
            return this.db.prepare(sql).all(...params) as Observation[];
        } catch {
            // If FTS fails (e.g., syntax error), fall back to LIKE search
            return this.searchObservationsFallback(query, tags, limit);
        }
    }

    private searchObservationsFallback(query: string, tags?: string, limit: number = 10): Observation[] {
        const words = query.split(/\s+/).filter(w => w.length > 0);
        const likeClauses = words.map(() => `content LIKE ?`).join(' AND ');
        let sql = `SELECT * FROM observations WHERE ${likeClauses} AND status != 'rejected'`;
        const params: (string | number)[] = words.map(w => `%${w}%`);

        if (tags && tags.trim() !== '') {
            const tagList = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
            tagList.forEach(t => {
                sql += ` AND tags LIKE ?`;
                params.push(`%${t}%`);
            });
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        return this.db.prepare(sql).all(...params) as Observation[];
    }

    getRecentObservations(limit: number = 20, days?: number): Observation[] {
        let sql = `SELECT * FROM observations WHERE status != 'rejected'`;
        const params: (string | number)[] = [];

        if (days) {
            sql += ` AND created_at >= datetime('now', ?)`;
            params.push(`-${days} days`);
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        return this.db.prepare(sql).all(...params) as Observation[];
    }

    getPendingObservations(): Observation[] {
        return this.db.prepare(
            `SELECT * FROM observations WHERE status = 'pending' ORDER BY created_at DESC`
        ).all() as Observation[];
    }

    updateStatus(id: number, status: string): void {
        this.db.prepare(`UPDATE observations SET status = ? WHERE id = ?`).run(status, id);
    }

    updateContent(id: number, content: string): void {
        this.db.prepare(`UPDATE observations SET content = ? WHERE id = ?`).run(content, id);
    }

    deleteObservation(id: number): void {
        this.db.prepare(`DELETE FROM observations WHERE id = ?`).run(id);
    }

    expirePendingObservations(days: number = 7): number {
        const result = this.db.prepare(`
            DELETE FROM observations
            WHERE status = 'pending'
            AND created_at < datetime('now', ?)
        `).run(`-${days} days`);
        return result.changes;
    }

    getObservationById(id: number): Observation | undefined {
        return this.db.prepare(`SELECT * FROM observations WHERE id = ?`).get(id) as Observation | undefined;
    }

    // ─── Embedding Operations ────────────────────────────────────────────

    storeEmbedding(id: number, embedding: Float32Array): void {
        const buffer = encodeEmbedding(embedding);
        this.db.prepare(`UPDATE observations SET embedding = ? WHERE id = ?`).run(buffer, id);
    }

    getEmbedding(id: number): Float32Array | null {
        const row = this.db.prepare(`SELECT embedding FROM observations WHERE id = ?`).get(id) as { embedding: Buffer | null } | undefined;
        return decodeEmbedding(row?.embedding ?? null);
    }

    getAllWithEmbeddings(): Array<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Float32Array }> {
        const rows = this.db.prepare(
            `SELECT id, content, tags, project, source, status, created_at, embedding FROM observations WHERE embedding IS NOT NULL AND status != 'rejected'`
        ).all() as Array<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Buffer }>;

        const out: Array<{ id: number; content: string; tags: string; project: string; source: string; status: string; created_at: string; embedding: Float32Array }> = [];
        for (const r of rows) {
            const decoded = decodeEmbedding(r.embedding);
            if (!decoded) { continue; } // skip incompatible-version BLOBs
            out.push({ ...r, embedding: decoded });
        }
        return out;
    }

    getObservationsWithoutEmbeddings(): Observation[] {
        return this.db.prepare(
            `SELECT * FROM observations WHERE embedding IS NULL AND status != 'rejected' ORDER BY created_at DESC`
        ).all() as Observation[];
    }

    // ─── File Index Operations ───────────────────────────────────────────

    upsertFileIndex(filePath: string, summary: string, symbols: SymbolInfo[], lineCount: number): void {
        const symbolsJson = JSON.stringify(symbols);
        const existing = this.db.prepare(`SELECT id FROM file_index WHERE file_path = ?`).get(filePath);

        if (existing) {
            this.db.prepare(`
                UPDATE file_index
                SET summary = ?, symbols = ?, line_count = ?, last_indexed = datetime('now')
                WHERE file_path = ?
            `).run(summary, symbolsJson, lineCount, filePath);
        } else {
            this.db.prepare(`
                INSERT INTO file_index (file_path, summary, symbols, line_count)
                VALUES (?, ?, ?, ?)
            `).run(filePath, summary, symbolsJson, lineCount);
        }
    }

    lookupFileIndex(query: string): FileIndexEntry[] {
        // Try exact path match first
        const exact = this.db.prepare(
            `SELECT * FROM file_index WHERE file_path = ? OR file_path LIKE ?`
        ).all(query, `%${query}`) as FileIndexEntry[];

        if (exact.length > 0) {
            return exact;
        }

        // Try FTS on file path, summary, symbols
        const sanitized = sanitizeFtsQuery(query);
        if (!sanitized) {
            return [];
        }

        try {
            return this.db.prepare(`
                SELECT fi.*
                FROM file_index_fts fts
                JOIN file_index fi ON fi.id = fts.rowid
                WHERE file_index_fts MATCH ?
                LIMIT 10
            `).all(sanitized) as FileIndexEntry[];
        } catch {
            // Fallback to LIKE search
            return this.db.prepare(
                `SELECT * FROM file_index WHERE file_path LIKE ? OR summary LIKE ? OR symbols LIKE ? LIMIT 10`
            ).all(`%${query}%`, `%${query}%`, `%${query}%`) as FileIndexEntry[];
        }
    }

    searchSymbols(symbolName: string): Array<{ file_path: string; symbol: SymbolInfo }> {
        const results: Array<{ file_path: string; symbol: SymbolInfo }> = [];

        const rows = this.db.prepare(
            `SELECT file_path, symbols FROM file_index WHERE symbols LIKE ?`
        ).all(`%${symbolName}%`) as FileIndexEntry[];

        for (const row of rows) {
            try {
                const symbols: SymbolInfo[] = JSON.parse(row.symbols);
                for (const sym of symbols) {
                    if (sym.name.toLowerCase().includes(symbolName.toLowerCase())) {
                        results.push({ file_path: row.file_path, symbol: sym });
                    }
                }
            } catch {
                // Skip malformed JSON
            }
        }

        return results;
    }

    getFileIndexEntry(filePath: string): FileIndexEntry | undefined {
        return this.db.prepare(
            `SELECT * FROM file_index WHERE file_path = ?`
        ).get(filePath) as FileIndexEntry | undefined;
    }

    deleteFileIndexEntry(id: number): void {
        this.db.prepare(`DELETE FROM file_index WHERE id = ?`).run(id);
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
        const total = (this.db.prepare(`SELECT COUNT(*) as c FROM observations`).get() as { c: number }).c;
        const verified = (this.db.prepare(`SELECT COUNT(*) as c FROM observations WHERE status = 'verified'`).get() as { c: number }).c;
        const pending = (this.db.prepare(`SELECT COUNT(*) as c FROM observations WHERE status = 'pending'`).get() as { c: number }).c;
        const filesIndexed = (this.db.prepare(`SELECT COUNT(*) as c FROM file_index`).get() as { c: number }).c;

        // Count total symbols across all files
        let totalSymbols = 0;
        const allSymbols = this.db.prepare(`SELECT symbols FROM file_index`).all() as Array<{ symbols: string }>;
        for (const row of allSymbols) {
            try {
                const syms: SymbolInfo[] = JSON.parse(row.symbols);
                totalSymbols += syms.length;
            } catch {
                // skip
            }
        }

        const oldest = this.db.prepare(`SELECT MIN(created_at) as d FROM observations`).get() as { d: string | null };
        const newest = this.db.prepare(`SELECT MAX(created_at) as d FROM observations`).get() as { d: string | null };

        // Top tags (split comma-separated tags and count)
        const tagRows = this.db.prepare(`SELECT tags FROM observations WHERE tags != ''`).all() as Array<{ tags: string }>;
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
        try {
            dbSizeBytes = fs.statSync(this.dbPath).size;
        } catch {
            // ignore
        }

        return {
            totalObservations: total,
            verifiedObservations: verified,
            pendingObservations: pending,
            totalFilesIndexed: filesIndexed,
            totalSymbols,
            oldestObservation: oldest.d,
            newestObservation: newest.d,
            topTags,
            dbSizeBytes,
        };
    }

    // ─── Filtering & Listing ────────────────────────────────────────────

    getAllObservations(filters?: { status?: string; tag?: string; source?: string; project?: string }): Observation[] {
        let sql = `SELECT * FROM observations WHERE 1=1`;
        const params: string[] = [];

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
        return this.db.prepare(sql).all(...params) as Observation[];
    }

    getDistinctProjects(): string[] {
        return (this.db.prepare(
            `SELECT DISTINCT project FROM observations WHERE project != '' ORDER BY project`
        ).all() as Array<{ project: string }>).map(r => r.project);
    }

    cleanupBuildArtifacts(): number {
        // Directory names that should never appear in source file paths
        const blocked = [
            'node_modules', '.next', '.nuxt', '.output', '.svelte-kit', '.astro',
            '.vite', '.parcel-cache', '.turbo', '.cache', 'coverage', '.nyc_output',
            'storybook-static', '__pycache__', '.pytest_cache', '.mypy_cache',
            'venv', '.venv', 'target', '.gradle', '.angular', 'dist', 'build',
        ];
        let total = 0;
        for (const dir of blocked) {
            // Match both forward slash (macOS/Linux) and backslash (Windows)
            const r1 = this.db.prepare(`DELETE FROM file_index WHERE file_path LIKE ?`).run(`%/${dir}/%`);
            const r2 = this.db.prepare(`DELETE FROM file_index WHERE file_path LIKE ?`).run(`%\\${dir}\\%`);
            total += r1.changes + r2.changes;
        }
        return total;
    }

    getAllFileIndexEntries(): FileIndexEntry[] {
        return this.db.prepare(`SELECT * FROM file_index ORDER BY file_path`).all() as FileIndexEntry[];
    }

    updateObservation(id: number, content: string, tags: string): void {
        this.db.prepare(`UPDATE observations SET content = ?, tags = ? WHERE id = ?`).run(content, tags, id);
    }

    getDistinctSources(): string[] {
        return (this.db.prepare(`SELECT DISTINCT source FROM observations ORDER BY source`).all() as Array<{ source: string }>).map(r => r.source);
    }

    getDistinctTags(): string[] {
        const tagRows = this.db.prepare(`SELECT tags FROM observations WHERE tags != ''`).all() as Array<{ tags: string }>;
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
        const observations = this.db.prepare(`SELECT * FROM observations ORDER BY created_at DESC`).all() as Observation[];
        const fileIndex = this.db.prepare(`SELECT * FROM file_index ORDER BY file_path`).all() as FileIndexEntry[];
        return { observations, fileIndex };
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────

    getDbPath(): string {
        return this.dbPath;
    }

    close(): void {
        this.db.close();
    }
}
