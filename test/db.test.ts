import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, defaultValue: any) => defaultValue,
        }),
        workspaceFolders: [{ name: 'test-project' }],
    },
}));

import { RecallDatabase } from '../src/db';

let db: RecallDatabase;
let tmpDir: string;
let dbPath: string;

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    db = await RecallDatabase.create(dbPath);
});

afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RecallDatabase', () => {
    describe('observations CRUD', () => {
        it('inserts and retrieves an observation by id', () => {
            const id = db.insertObservation('test content', 'tag1,tag2', 'manual', 'verified', 'myproject');
            const obs = db.getObservationById(id);

            expect(obs).toBeDefined();
            expect(obs!.content).toBe('test content');
            expect(obs!.tags).toBe('tag1,tag2');
            expect(obs!.project).toBe('myproject');
            expect(obs!.source).toBe('manual');
            expect(obs!.status).toBe('verified');
        });

        it('updates observation content', () => {
            const id = db.insertObservation('original', '', 'manual', 'verified', 'proj');
            db.updateContent(id, 'updated');
            expect(db.getObservationById(id)!.content).toBe('updated');
        });

        it('updates observation status', () => {
            const id = db.insertObservation('obs', '', 'copilot', 'pending', 'proj');
            db.updateStatus(id, 'verified');
            expect(db.getObservationById(id)!.status).toBe('verified');
        });

        it('deletes an observation', () => {
            const id = db.insertObservation('to delete', '', 'manual', 'verified', 'proj');
            db.deleteObservation(id);
            expect(db.getObservationById(id)).toBeUndefined();
        });

        it('updates content and tags together', () => {
            const id = db.insertObservation('old content', 'old', 'manual', 'verified', 'proj');
            db.updateObservation(id, 'new content', 'new,tags');
            const obs = db.getObservationById(id)!;
            expect(obs.content).toBe('new content');
            expect(obs.tags).toBe('new,tags');
        });
    });

    describe('FTS search', () => {
        it('finds observations by keyword', () => {
            db.insertObservation('the auth token refresh was broken', 'auth,bugfix', 'manual', 'verified', 'proj');
            db.insertObservation('database migration ran successfully', 'db', 'manual', 'verified', 'proj');

            const results = db.searchObservations('auth token');
            expect(results.length).toBe(1);
            expect(results[0].content).toContain('auth token');
        });

        it('filters by tags', () => {
            db.insertObservation('auth issue one', 'auth', 'manual', 'verified', 'proj');
            db.insertObservation('auth issue two', 'auth,critical', 'manual', 'verified', 'proj');

            const results = db.searchObservations('auth', 'critical');
            expect(results.length).toBe(1);
            expect(results[0].tags).toContain('critical');
        });

        it('excludes rejected observations', () => {
            db.insertObservation('rejected item', 'tag', 'manual', 'rejected', 'proj');
            const results = db.searchObservations('rejected');
            expect(results.length).toBe(0);
        });

        it('falls back to LIKE when FTS fails on bad syntax', () => {
            db.insertObservation('something with special chars', '', 'manual', 'verified', 'proj');
            const results = db.searchObservations('something special');
            expect(results.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('recent and pending observations', () => {
        it('returns recent observations ordered by date', () => {
            db.insertObservation('first', '', 'manual', 'verified', 'proj');
            db.insertObservation('second', '', 'manual', 'verified', 'proj');
            db.insertObservation('third', '', 'manual', 'verified', 'proj');

            const recent = db.getRecentObservations(2);
            expect(recent.length).toBe(2);
            expect(recent[0].content).toBe('third');
        });

        it('returns only pending observations', () => {
            db.insertObservation('verified one', '', 'manual', 'verified', 'proj');
            db.insertObservation('pending one', '', 'copilot', 'pending', 'proj');

            const pending = db.getPendingObservations();
            expect(pending.length).toBe(1);
            expect(pending[0].content).toBe('pending one');
        });
    });

    describe('embeddings', () => {
        it('stores and retrieves an embedding', () => {
            const id = db.insertObservation('embedding test', '', 'manual', 'verified', 'proj');
            const vec = new Float32Array(384);
            vec[0] = 0.5;
            vec[383] = -0.25;

            db.storeEmbedding(id, vec);
            const retrieved = db.getEmbedding(id);

            expect(retrieved).not.toBeNull();
            expect(retrieved![0]).toBeCloseTo(0.5);
            expect(retrieved![383]).toBeCloseTo(-0.25);
        });

        it('returns null for observations without embeddings', () => {
            const id = db.insertObservation('no embedding', '', 'manual', 'verified', 'proj');
            expect(db.getEmbedding(id)).toBeNull();
        });

        it('getAllWithEmbeddings excludes observations without embeddings', () => {
            const id1 = db.insertObservation('with vec', '', 'manual', 'verified', 'proj');
            db.insertObservation('without vec', '', 'manual', 'verified', 'proj');

            const vec = new Float32Array(384);
            vec[0] = 1.0;
            db.storeEmbedding(id1, vec);

            const results = db.getAllWithEmbeddings();
            expect(results.length).toBe(1);
            expect(results[0].embedding[0]).toBeCloseTo(1.0);
        });

        it('getObservationsWithoutEmbeddings only returns those missing embeddings', () => {
            const id1 = db.insertObservation('has embedding', '', 'manual', 'verified', 'proj');
            db.insertObservation('no embedding', '', 'manual', 'verified', 'proj');

            db.storeEmbedding(id1, new Float32Array(384));

            const missing = db.getObservationsWithoutEmbeddings();
            expect(missing.length).toBe(1);
            expect(missing[0].content).toBe('no embedding');
        });
    });

    describe('file index', () => {
        it('inserts and retrieves a file index entry', () => {
            db.upsertFileIndex('/src/test.ts', 'Test file with helpers', [
                { name: 'helperFn', type: 'function', line: 10, brief: 'does stuff' },
            ], 50);

            const entry = db.getFileIndexEntry('/src/test.ts');
            expect(entry).toBeDefined();
            expect(entry!.summary).toBe('Test file with helpers');
            expect(entry!.line_count).toBe(50);
            expect(JSON.parse(entry!.symbols)).toHaveLength(1);
        });

        it('upserts existing file index entries', () => {
            db.upsertFileIndex('/src/test.ts', 'v1', [], 10);
            db.upsertFileIndex('/src/test.ts', 'v2', [{ name: 'fn', type: 'function', line: 1, brief: '' }], 20);

            const entry = db.getFileIndexEntry('/src/test.ts');
            expect(entry!.summary).toBe('v2');
            expect(entry!.line_count).toBe(20);
        });

        it('looks up file index by path substring', () => {
            db.upsertFileIndex('/project/src/auth/service.ts', 'Auth service', [], 100);

            const results = db.lookupFileIndex('auth/service.ts');
            expect(results.length).toBe(1);
        });

        it('searches symbols across files', () => {
            db.upsertFileIndex('/a.ts', '', [
                { name: 'getToken', type: 'function', line: 5, brief: '' },
                { name: 'setToken', type: 'function', line: 15, brief: '' },
            ], 30);
            db.upsertFileIndex('/b.ts', '', [
                { name: 'getUser', type: 'function', line: 1, brief: '' },
            ], 10);

            const results = db.searchSymbols('getToken');
            expect(results.length).toBe(1);
            expect(results[0].file_path).toBe('/a.ts');
            expect(results[0].symbol.name).toBe('getToken');
        });

        it('deletes a file index entry', () => {
            db.upsertFileIndex('/delete-me.ts', '', [], 1);
            const entry = db.getFileIndexEntry('/delete-me.ts')!;
            db.deleteFileIndexEntry(entry.id);
            expect(db.getFileIndexEntry('/delete-me.ts')).toBeUndefined();
        });
    });

    describe('statistics', () => {
        it('returns correct counts', () => {
            db.insertObservation('verified', 'tag', 'manual', 'verified', 'proj');
            db.insertObservation('pending', '', 'copilot', 'pending', 'proj');
            db.upsertFileIndex('/f.ts', '', [{ name: 'fn', type: 'function', line: 1, brief: '' }], 5);

            const stats = db.getStats();
            expect(stats.totalObservations).toBe(2);
            expect(stats.verifiedObservations).toBe(1);
            expect(stats.pendingObservations).toBe(1);
            expect(stats.totalFilesIndexed).toBe(1);
            expect(stats.totalSymbols).toBe(1);
            expect(stats.topTags).toHaveLength(1);
            expect(stats.topTags[0].tag).toBe('tag');
        });
    });

    describe('export', () => {
        it('exports all observations and file index entries', () => {
            db.insertObservation('obs1', '', 'manual', 'verified', 'proj');
            db.insertObservation('obs2', '', 'copilot', 'pending', 'proj');
            db.upsertFileIndex('/f.ts', 'summary', [], 10);

            const exported = db.exportAll();
            expect(exported.observations).toHaveLength(2);
            expect(exported.fileIndex).toHaveLength(1);
        });
    });

    describe('persistence', () => {
        it('persists data across close and reopen', async () => {
            db.insertObservation('persistent data', 'persist', 'manual', 'verified', 'proj');
            db.close();

            const db2 = await RecallDatabase.create(dbPath);
            const obs = db2.getObservationById(1);
            expect(obs).toBeDefined();
            expect(obs!.content).toBe('persistent data');
            db2.close();

            // Reassign so afterEach cleanup works
            db = await RecallDatabase.create(dbPath);
        });
    });

    describe('filtering', () => {
        it('filters by status', () => {
            db.insertObservation('a', '', 'manual', 'verified', 'proj');
            db.insertObservation('b', '', 'copilot', 'pending', 'proj');

            const verified = db.getAllObservations({ status: 'verified' });
            expect(verified.length).toBe(1);
            expect(verified[0].content).toBe('a');
        });

        it('returns distinct projects', () => {
            db.insertObservation('a', '', 'manual', 'verified', 'alpha');
            db.insertObservation('b', '', 'manual', 'verified', 'beta');
            db.insertObservation('c', '', 'manual', 'verified', 'alpha');

            const projects = db.getDistinctProjects();
            expect(projects).toEqual(['alpha', 'beta']);
        });

        it('returns distinct tags', () => {
            db.insertObservation('a', 'auth,bugfix', 'manual', 'verified', 'proj');
            db.insertObservation('b', 'auth,perf', 'manual', 'verified', 'proj');

            const tags = db.getDistinctTags();
            expect(tags).toEqual(['auth', 'bugfix', 'perf']);
        });
    });
});
