import { describe, it, expect } from 'vitest';
import { formatObservation } from '../src/saveFormatting';

describe('formatObservation', () => {
    it('prefixes content with kind when provided', () => {
        const result = formatObservation('Auth uses singleton pattern.', 'architecture', 'auth');
        expect(result.content).toBe('[ARCHITECTURE] Auth uses singleton pattern.');
    });

    it('does not double-prefix if already present', () => {
        const result = formatObservation('[ARCHITECTURE] Auth uses singleton.', 'architecture', 'auth');
        expect(result.content).toBe('[ARCHITECTURE] Auth uses singleton.');
    });

    it('appends kind to tags when not already present', () => {
        const result = formatObservation('Fix race condition.', 'bugfix', 'auth,concurrency');
        expect(result.tags).toBe('auth,concurrency,bugfix');
    });

    it('does not duplicate kind in tags if already present', () => {
        const result = formatObservation('Fix race.', 'bugfix', 'auth,bugfix');
        expect(result.tags).toBe('auth,bugfix');
    });

    it('sets tags to kind when no tags provided', () => {
        const result = formatObservation('Gotcha found.', 'gotcha', '');
        expect(result.tags).toBe('gotcha');
    });

    it('handles undefined kind gracefully', () => {
        const result = formatObservation('Plain observation.', undefined, 'misc');
        expect(result.content).toBe('Plain observation.');
        expect(result.tags).toBe('misc');
    });

    it('handles undefined tags gracefully', () => {
        const result = formatObservation('Something.', 'dataflow', undefined);
        expect(result.content).toBe('[DATAFLOW] Something.');
        expect(result.tags).toBe('dataflow');
    });

    it('ignores invalid kind values', () => {
        const result = formatObservation('Text.', 'invalid_kind', 'tag1');
        expect(result.content).toBe('Text.');
        expect(result.tags).toBe('tag1');
    });

    it('handles all valid kinds', () => {
        const kinds = ['architecture', 'bugfix', 'gotcha', 'dataflow', 'contract', 'hypothesis', 'decision'];
        for (const kind of kinds) {
            const result = formatObservation('Test.', kind, '');
            expect(result.content).toBe(`[${kind.toUpperCase()}] Test.`);
            expect(result.tags).toBe(kind);
        }
    });
});
