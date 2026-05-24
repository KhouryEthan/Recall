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
const RECALL_SECTION_MARKER = 'Recall Memory Tools';

export async function setupRepository(extensionPath: string): Promise<void> {
    const folder = await pickWorkspaceFolder();
    if (!folder) { return; }

    const repoConfigDir = path.join(extensionPath, 'repo-config');
    if (!fs.existsSync(repoConfigDir)) {
        vscode.window.showErrorMessage('Recall: repo-config templates not found in the extension bundle.');
        return;
    }

    const rootPath = folder.uri.fsPath;
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
            results.push(`SKIPPED ${entry.dest} (already exists)`);
        } else {
            fs.copyFileSync(srcPath, destPath);
            results.push(`CREATED ${entry.dest}`);
        }
    }

    await handleCopilotInstructions(repoConfigDir, rootPath, results);

    const summary = results.map(r => `  ${r}`).join('\n');
    const action = await vscode.window.showInformationMessage(
        `Recall: Repository setup complete.\n${summary}`,
        { modal: true },
        'Open .github folder'
    );

    if (action === 'Open .github folder') {
        const githubDir = vscode.Uri.file(path.join(rootPath, '.github'));
        vscode.commands.executeCommand('revealFileInOS', githubDir);
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

async function handleCopilotInstructions(repoConfigDir: string, rootPath: string, results: string[]): Promise<void> {
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
