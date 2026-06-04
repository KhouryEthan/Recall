const VALID_KINDS = ['architecture', 'bugfix', 'gotcha', 'dataflow', 'contract', 'hypothesis', 'decision'];

export function formatObservation(content: string, kind?: string, tags?: string): { content: string; tags: string } {
    let finalContent = content;
    if (kind && VALID_KINDS.includes(kind) && !content.startsWith(`[${kind.toUpperCase()}`)) {
        finalContent = `[${kind.toUpperCase()}] ${content}`;
    }

    let tagStr = tags || '';
    if (kind && VALID_KINDS.includes(kind) && !tagStr.includes(kind)) {
        tagStr = tagStr ? `${tagStr},${kind}` : kind;
    }

    return { content: finalContent, tags: tagStr };
}
