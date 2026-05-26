import { describe, expect, it } from 'vitest';
import { estimateScenario, estimateTokensFromChars } from '../scripts/estimate-tokens.mjs';

describe('benchmark token estimator', () => {
    it('uses a documented chars-per-token approximation', () => {
        expect(estimateTokensFromChars(401)).toBe(101);
    });

    it('computes reduction percentages from scenario reads', () => {
        const result = estimateScenario({
            name: 'sample',
            baselineReads: [{ path: 'a.ts', characters: 400 }],
            recallReads: [{ path: 'a.ts#function', characters: 100 }],
        });

        expect(result.baselineTokens).toBe(100);
        expect(result.recallTokens).toBe(25);
        expect(result.reductionPercent).toBe(75);
    });
});
