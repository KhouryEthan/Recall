import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const TEMPLATE_FILES = [
    { src: '.github/agents/recall.agent.md', dest: '.github/agents/recall.agent.md' },
    { src: '.github/instructions/recall-aware.instructions.md', dest: '.github/instructions/recall-aware.instructions.md' },
    { src: '.github/prompts/recall-seed.prompt.md', dest: '.github/prompts/recall-seed.prompt.md' },
    { src: '.github/prompts/recall-audit.prompt.md', dest: '.github/prompts/recall-audit.prompt.md' },
];

const COPILOT_SNIPPET_FILE = 'copilot-instructions-snippet.md';
const COPILOT_INSTRUCTIONS_DEST = '.github/copilot-instructions.md';
const CURSOR_RULE_SRC = '.cursor/rules/recall.mdc';
const CURSOR_RULE_DEST = '.cursor/rules/recall.mdc';
const CURSOR_PROMPT_FILES = [
    { src: '.cursor/prompts/recall-seed.md', dest: '.cursor/prompts/recall-seed.md' },
    { src: '.cursor/prompts/recall-audit.md', dest: '.cursor/prompts/recall-audit.md' },
];
const RECALL_SECTION_MARKER = '## Recall Memory Tools';

function isRunningInCursor(): boolean {
    return vscode.env.appName.toLowerCase().includes('cursor');
}

export async function setupRepository(extensionPath: string): Promise<void> {
    const folder = await pickWorkspaceFolder();
    if (!folder) { return; }

    const repoConfigDir = path.join(extensionPath, 'repo-config');
    if (!fs.existsSync(repoConfigDir)) {
        vscode.window.showErrorMessage('Recall: repo-config templates not found in the extension bundle.');
        return;
    }

    const rootPath = folder.uri.fsPath;

    const runningInCursor = isRunningInCursor();
    const anyExist = TEMPLATE_FILES.some(e => fs.existsSync(path.join(rootPath, e.dest)));
    const copilotExists = fs.existsSync(path.join(rootPath, COPILOT_INSTRUCTIONS_DEST));
    const cursorFilesExist = runningInCursor && (
        fs.existsSync(path.join(rootPath, CURSOR_RULE_DEST)) ||
        CURSOR_PROMPT_FILES.some(e => fs.existsSync(path.join(rootPath, e.dest)))
    );

    let mode: 'fresh' | 'update' = 'fresh';
    if (anyExist || copilotExists || cursorFilesExist) {
        const choice = await vscode.window.showInformationMessage(
            'Recall instruction files already exist in this repo. What would you like to do?',
            { modal: true, detail: 'Updating replaces the Recall-managed files with the latest version from this extension. Your custom project instructions outside the Recall section are preserved.' },
            'Update to latest',
            'Skip (keep existing)'
        );
        if (choice === 'Update to latest') {
            mode = 'update';
        } else {
            vscode.window.showInformationMessage('Recall: Setup skipped. Existing files unchanged.');
            return;
        }
    }

    const results: string[] = [];

    for (const entry of TEMPLATE_FILES) {
        const srcPath = path.join(repoConfigDir, entry.src);
        const destPath = path.join(rootPath, entry.dest);

        if (!fs.existsSync(srcPath)) { continue; }

        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        if (fs.existsSync(destPath)) {
            if (mode === 'update') {
                fs.copyFileSync(srcPath, destPath);
                results.push(`UPDATED ${entry.dest}`);
            } else {
                results.push(`SKIPPED ${entry.dest} (already exists)`);
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
            results.push(`CREATED ${entry.dest}`);
        }
    }

    await handleCopilotInstructions(repoConfigDir, rootPath, results, mode);

    if (runningInCursor) {
        handleCursorRule(repoConfigDir, rootPath, results, mode);
        handleCursorPrompts(repoConfigDir, rootPath, results, mode);
    }

    const summary = results.map(r => `  ${r}`).join('\n');
    const openLabel = runningInCursor ? 'Open .cursor/rules folder' : 'Open .github folder';
    const action = await vscode.window.showInformationMessage(
        `Recall: Repository setup complete.\n${summary}`,
        { modal: true },
        openLabel
    );

    if (action === openLabel) {
        const targetDir = runningInCursor
            ? vscode.Uri.file(path.join(rootPath, '.cursor', 'rules'))
            : vscode.Uri.file(path.join(rootPath, '.github'));
        vscode.commands.executeCommand('revealFileInOS', targetDir);
    }
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('Recall: No workspace folder open. Open a folder first.');
        return undefined;
    }
    if (folders.length === 1) { return folders[0]; }
    return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select workspace folder for Recall setup' });
}

async function handleCopilotInstructions(repoConfigDir: string, rootPath: string, results: string[], mode: 'fresh' | 'update'): Promise<void> {
    const snippetPath = path.join(repoConfigDir, COPILOT_SNIPPET_FILE);
    if (!fs.existsSync(snippetPath)) { return; }

    const snippet = fs.readFileSync(snippetPath, 'utf-8');
    const destPath = path.join(rootPath, COPILOT_INSTRUCTIONS_DEST);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, snippet, 'utf-8');
        results.push(`CREATED ${COPILOT_INSTRUCTIONS_DEST}`);
        return;
    }

    const existing = fs.readFileSync(destPath, 'utf-8');

    if (mode === 'update' && existing.includes(RECALL_SECTION_MARKER)) {
        const updated = replaceRecallSection(existing, snippet);
        fs.writeFileSync(destPath, updated, 'utf-8');
        results.push(`UPDATED Recall section in ${COPILOT_INSTRUCTIONS_DEST}`);
        return;
    }

    if (existing.includes(RECALL_SECTION_MARKER)) {
        results.push(`SKIPPED ${COPILOT_INSTRUCTIONS_DEST} (Recall section already present)`);
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        `${COPILOT_INSTRUCTIONS_DEST} exists but doesn't have the Recall section. Append it?`,
        { modal: true, detail: 'This will add Recall tool guidance to your existing Copilot instructions file.' },
        'Append',
        'Skip'
    );

    if (choice === 'Append') {
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(destPath, existing + separator + snippet, 'utf-8');
        results.push(`APPENDED Recall section to ${COPILOT_INSTRUCTIONS_DEST}`);
    } else {
        results.push(`SKIPPED ${COPILOT_INSTRUCTIONS_DEST}`);
    }
}

function handleCursorRule(repoConfigDir: string, rootPath: string, results: string[], mode: 'fresh' | 'update'): void {
    const srcPath = path.join(repoConfigDir, CURSOR_RULE_SRC);
    if (!fs.existsSync(srcPath)) { return; }

    const destPath = path.join(rootPath, CURSOR_RULE_DEST);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(destPath)) {
        if (mode === 'update') {
            fs.copyFileSync(srcPath, destPath);
            results.push(`UPDATED ${CURSOR_RULE_DEST}`);
        } else {
            results.push(`SKIPPED ${CURSOR_RULE_DEST} (already exists)`);
        }
    } else {
        fs.copyFileSync(srcPath, destPath);
        results.push(`CREATED ${CURSOR_RULE_DEST}`);
    }
}

function handleCursorPrompts(repoConfigDir: string, rootPath: string, results: string[], mode: 'fresh' | 'update'): void {
    for (const entry of CURSOR_PROMPT_FILES) {
        const srcPath = path.join(repoConfigDir, entry.src);
        if (!fs.existsSync(srcPath)) { continue; }

        const destPath = path.join(rootPath, entry.dest);
        const destDir = path.dirname(destPath);

        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        if (fs.existsSync(destPath)) {
            if (mode === 'update') {
                fs.copyFileSync(srcPath, destPath);
                results.push(`UPDATED ${entry.dest}`);
            } else {
                results.push(`SKIPPED ${entry.dest} (already exists)`);
            }
        } else {
            fs.copyFileSync(srcPath, destPath);
            results.push(`CREATED ${entry.dest}`);
        }
    }
}

function replaceRecallSection(existing: string, newSnippet: string): string {
    const markerIdx = existing.indexOf(RECALL_SECTION_MARKER);
    if (markerIdx === -1) { return existing; }

    const before = existing.substring(0, markerIdx).trimEnd();
    const separator = before.length > 0 ? '\n\n' : '';
    return before + separator + newSnippet;
}
