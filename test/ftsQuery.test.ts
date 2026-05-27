import { describe, expect, it } from 'vitest';
import { sanitizeFtsQuery } from '../src/ftsQuery';

describe('sanitizeFtsQuery', () => {
    it('adds prefix matching for searchable tokens', () => {
        expect(sanitizeFtsQuery('token refresh race')).toBe('token* refresh* race*');
    });

    it('preserves quoted phrases', () => {
        expect(sanitizeFtsQuery('"token refresh" race')).toBe('"token refresh" race*');
    });

    it('strips FTS metacharacters that can break MATCH syntax', () => {
        expect(sanitizeFtsQuery('auth:(refresh) OR token*')).toBe('auth* refresh* OR token*');
    });

    it('returns an empty string for punctuation-only queries', () => {
        expect(sanitizeFtsQuery('(){}:^')).toBe('');
    });
});
