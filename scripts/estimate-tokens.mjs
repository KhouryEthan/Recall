import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function estimateTokensFromChars(chars) {
    return Math.ceil(chars / 4);
}

export function estimateScenario(scenario) {
    const baselineTokens = scenario.baselineReads.reduce((sum, item) => sum + estimateTokensFromChars(item.characters), 0);
    const recallTokens = scenario.recallReads.reduce((sum, item) => sum + estimateTokensFromChars(item.characters), 0);
    const reduction = baselineTokens === 0 ? 0 : (baselineTokens - recallTokens) / baselineTokens;

    return {
        name: scenario.name,
        baselineTokens,
        recallTokens,
        reduction,
        reductionPercent: Number((reduction * 100).toFixed(1)),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: node scripts/estimate-tokens.mjs <scenario.json>');
        process.exit(1);
    }

    const scenarioPath = path.resolve(input);
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
    const result = estimateScenario(scenario);
    console.log(JSON.stringify(result, null, 2));
}
