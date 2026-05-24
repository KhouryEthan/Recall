#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recall — Setup Script
# Installs the Recall VS Code extension and configures the repository.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECALL_DIR="$HOME/.recall"
DB_PATH="$RECALL_DIR/recall.db"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🧠 Recall — Persistent Developer Memory    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1: Check prerequisites ─────────────────────────────────────────────
echo -e "${YELLOW}[1/6]${NC} Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+ first.${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js $NODE_VERSION found, but 18+ is required.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} npm $(npm -v)"

if ! command -v code &> /dev/null; then
    echo -e "${YELLOW}⚠ 'code' command not found. You may need to install the VS Code CLI or install the .vsix manually.${NC}"
    HAS_CODE=false
else
    echo -e "  ${GREEN}✓${NC} VS Code CLI available"
    HAS_CODE=true
fi

echo ""

# ─── Step 2: Install dependencies ────────────────────────────────────────────
echo -e "${YELLOW}[2/6]${NC} Installing dependencies..."
cd "$SCRIPT_DIR"
npm install
echo -e "  ${GREEN}✓${NC} Dependencies installed"
echo ""

# ─── Step 3: Compile TypeScript ──────────────────────────────────────────────
echo -e "${YELLOW}[3/6]${NC} Compiling TypeScript..."
npm run compile
echo -e "  ${GREEN}✓${NC} Compiled to out/"
echo ""

# ─── Step 4: Package the extension ──────────────────────────────────────────
echo -e "${YELLOW}[4/6]${NC} Packaging VS Code extension..."
npx @vscode/vsce package --allow-missing-repository 2>/dev/null || {
    echo -e "${RED}  ✗ Failed to package. You can still install in development mode.${NC}"
    echo -e "    Run: code --extensionDevelopmentPath=$SCRIPT_DIR"
}

VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -n "$VSIX_FILE" ]; then
    echo -e "  ${GREEN}✓${NC} Packaged: $VSIX_FILE"
else
    echo -e "${YELLOW}  ⚠ No .vsix file found. Extension can be used in development mode.${NC}"
fi
echo ""

# ─── Step 5: Install the extension ──────────────────────────────────────────
echo -e "${YELLOW}[5/6]${NC} Installing extension..."
if [ "$HAS_CODE" = true ] && [ -n "$VSIX_FILE" ]; then
    code --install-extension "$VSIX_FILE" --force 2>/dev/null && {
        echo -e "  ${GREEN}✓${NC} Extension installed"
    } || {
        echo -e "${YELLOW}  ⚠ Could not auto-install. Install manually:${NC}"
        echo -e "    code --install-extension $SCRIPT_DIR/$VSIX_FILE"
    }
elif [ -n "$VSIX_FILE" ]; then
    echo -e "${YELLOW}  ⚠ Install manually with:${NC}"
    echo -e "    code --install-extension $SCRIPT_DIR/$VSIX_FILE"
else
    echo -e "  ${YELLOW}⚠ To run in development mode:${NC}"
    echo -e "    1. Open VS Code"
    echo -e "    2. Press F5 in this folder to launch Extension Development Host"
    echo -e "    Or: code --extensionDevelopmentPath=$SCRIPT_DIR"
fi
echo ""

# ─── Step 6: Create database directory ──────────────────────────────────────
echo -e "${YELLOW}[6/6]${NC} Setting up database directory..."
mkdir -p "$RECALL_DIR"
echo -e "  ${GREEN}✓${NC} Database directory: $RECALL_DIR"
echo -e "  ${GREEN}✓${NC} Database will be created at: $DB_PATH (on first activation)"
echo ""

# ─── Done ────────────────────────────────────────────────────────────────────
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Recall installation complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Next steps:${NC}"
echo -e "  1. Reload VS Code (Ctrl+Shift+P → 'Reload Window')"
echo -e "  2. Open a source file and save it — file indexing starts automatically"
echo -e "  3. Use @recall in Copilot Chat to search/save observations"
echo -e "  4. Press Ctrl+Shift+M to quick-save an observation"
echo -e "  5. Run 'Recall: Open Dashboard' from the Command Palette"
echo ""
echo -e "  ${BLUE}Repository setup (optional):${NC}"
echo -e "  Copy the files from ${SCRIPT_DIR}/repo-config/ into your project's .github/ folder"
echo -e "  to teach Copilot how to use Recall automatically."
echo -e ""
echo -e "  See ${SCRIPT_DIR}/README.md for full documentation."
