export function sanitizeFtsQuery(query: string): string {
    const phrases: string[] = [];
    const remainder = query.replace(/"([^"]+)"/g, (_full, phrase: string) => {
        const safe = cleanFtsTokenText(phrase).trim();
        if (safe.length > 0) {
            phrases.push(`"${safe}"`);
        }
        return ' ';
    });

    const tokens = cleanFtsTokenText(remainder)
        .split(/\s+/)
        .filter(w => w.length > 0)
        .map(w => (w.length >= 3 ? `${w}*` : w));

    return [...phrases, ...tokens].join(' ');
}

function cleanFtsTokenText(value: string): string {
    return value.replace(/[(){}[\]*:^~!@#$%&\\|<>'`"]/g, ' ');
}
