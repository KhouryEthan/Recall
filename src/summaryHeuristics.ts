/**
 * Deterministic, symbol-only summary generation for indexed files.
 *
 * No prose extraction. The symbol list (name, type, line range) from the
 * DocumentSymbolProvider is the real value of the file index. This summary
 * is just a compressed human-readable glance line derived from that data.
 */

export interface SymbolForSummary {
    name: string;
    type: string;
    line: number;
}

export function generateFileSummary(
    fileName: string,
    _fileText: string,
    symbols: SymbolForSummary[],
    lineCount: number,
): string {
    return buildSymbolSummary(fileName, symbols, lineCount);
}

function buildSymbolSummary(fileName: string, symbols: SymbolForSummary[], lineCount: number): string {
    const functions = symbols.filter(s => s.type === 'function' || s.type === 'method' || s.type === 'constructor');
    const classes = symbols.filter(s => s.type === 'class' || s.type === 'struct' || s.type === 'interface' || s.type === 'enum');

    if (classes.length > 0 && functions.length > 0) {
        const classNames = classes.slice(0, 3).map(c => c.name).join(', ');
        const more = classes.length > 3 ? ` and ${classes.length - 3} more` : '';
        return `${fileName} — defines ${classNames}${more} with ${functions.length} function(s)`;
    }
    if (classes.length > 0) {
        const classNames = classes.slice(0, 3).map(c => c.name).join(', ');
        const more = classes.length > 3 ? ` and ${classes.length - 3} more` : '';
        return `${fileName} — defines ${classNames}${more}`;
    }
    if (functions.length > 0) {
        const topFuncs = functions.slice(0, 3).map(f => f.name).join(', ');
        const more = functions.length > 3 ? ` and ${functions.length - 3} more` : '';
        return `${fileName} — ${functions.length} function(s) including ${topFuncs}${more}`;
    }

    return `${fileName} — ${lineCount} lines`;
}
