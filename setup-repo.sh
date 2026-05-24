#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Recall — Repository Setup Script
# Copies Recall's Copilot configuration files into a target project repository.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="$SCRIPT_DIR/repo-config"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Parse arguments ─────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    echo -e "${BLUE}Usage:${NC} $0 <project-root-directory>"
    echo ""
    echo "Copies Recall's Copilot configuration files into the target project."
    echo "This teaches Copilot when and how to use Recall's memory tools."
    echo ""
    echo "Files that will be created:"
    echo "  .github/agents/recall.agent.md          — Recall agent mode"
    echo "  .github/instructions/recall-aware.instructions.md — Auto-trigger for source files"
    echo "  .github/prompts/recall-seed.prompt.md    — One-time memory seeding prompt"
    echo "  .github/prompts/recall-audit.prompt.md   — Monthly memory audit prompt"
    echo ""
    echo "Additionally, a snippet will be shown for you to paste into your"
    echo "existing .github/copilot-instructions.md file."
    exit 0
fi

TARGET_DIR="$1"

if [ ! -d "$TARGET_DIR" ]; then
    echo -e "${RED}✗ Directory not found: $TARGET_DIR${NC}"
    exit 1
fi

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🧠 Recall — Repository Setup               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Target: ${GREEN}$TARGET_DIR${NC}"
echo ""

# ─── Create directories ─────────────────────────────────────────────────────
mkdir -p "$TARGET_DIR/.github/agents"
mkdir -p "$TARGET_DIR/.github/instructions"
mkdir -p "$TARGET_DIR/.github/prompts"

# ─── Copy files (with safety check) ─────────────────────────────────────────
copy_if_not_exists() {
    local src="$1"
    local dest="$2"
    local name="$3"

    if [ -f "$dest" ]; then
        echo -e "  ${YELLOW}⚠ SKIPPED${NC} $name (already exists)"
    else
        cp "$src" "$dest"
        echo -e "  ${GREEN}✓ CREATED${NC} $name"
    fi
}

echo -e "${YELLOW}Copying configuration files...${NC}"
copy_if_not_exists \
    "$CONFIG_SRC/.github/agents/recall.agent.md" \
    "$TARGET_DIR/.github/agents/recall.agent.md" \
    ".github/agents/recall.agent.md"

copy_if_not_exists \
    "$CONFIG_SRC/.github/instructions/recall-aware.instructions.md" \
    "$TARGET_DIR/.github/instructions/recall-aware.instructions.md" \
    ".github/instructions/recall-aware.instructions.md"

copy_if_not_exists \
    "$CONFIG_SRC/.github/prompts/recall-seed.prompt.md" \
    "$TARGET_DIR/.github/prompts/recall-seed.prompt.md" \
    ".github/prompts/recall-seed.prompt.md"

copy_if_not_exists \
    "$CONFIG_SRC/.github/prompts/recall-audit.prompt.md" \
    "$TARGET_DIR/.github/prompts/recall-audit.prompt.md" \
    ".github/prompts/recall-audit.prompt.md"

echo ""

# ─── Handle copilot-instructions.md ─────────────────────────────────────────
COPILOT_INSTRUCTIONS="$TARGET_DIR/.github/copilot-instructions.md"

if [ -f "$COPILOT_INSTRUCTIONS" ]; then
    # Check if Recall section already exists
    if grep -q "Recall Memory Tools" "$COPILOT_INSTRUCTIONS" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} copilot-instructions.md already contains Recall section"
    else
        echo -e "  ${YELLOW}⚠${NC} copilot-instructions.md exists but needs the Recall section."
        echo ""
        echo -e "  ${BLUE}Append the following to $COPILOT_INSTRUCTIONS:${NC}"
        echo -e "  ${BLUE}─────────────────────────────────────────────────${NC}"
        echo ""
        cat "$CONFIG_SRC/copilot-instructions-snippet.md"
        echo ""
        echo -e "  ${BLUE}─────────────────────────────────────────────────${NC}"
        echo ""

        read -p "  Append this to copilot-instructions.md now? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "" >> "$COPILOT_INSTRUCTIONS"
            cat "$CONFIG_SRC/copilot-instructions-snippet.md" >> "$COPILOT_INSTRUCTIONS"
            echo -e "  ${GREEN}✓ APPENDED${NC} Recall section to copilot-instructions.md"
        else
            echo -e "  ${YELLOW}⚠ SKIPPED${NC} — add the snippet manually when ready"
        fi
    fi
else
    # Create new copilot-instructions.md with just the Recall section
    cp "$CONFIG_SRC/copilot-instructions-snippet.md" "$COPILOT_INSTRUCTIONS"
    echo -e "  ${GREEN}✓ CREATED${NC} .github/copilot-instructions.md"
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Repository setup complete!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Files installed:${NC}"
echo -e "    .github/agents/recall.agent.md"
echo -e "    .github/instructions/recall-aware.instructions.md"
echo -e "    .github/prompts/recall-seed.prompt.md"
echo -e "    .github/prompts/recall-audit.prompt.md"
echo -e "    .github/copilot-instructions.md (Recall section)"
echo ""
echo -e "  ${BLUE}Next steps:${NC}"
echo -e "  1. Commit these files so the whole team gets them"
echo -e "  2. Run the recall-seed prompt to populate baseline memory"
echo -e "     (In Copilot Chat: open recall-seed.prompt.md and run it)"
echo -e "  3. Start coding — Recall builds memory automatically from here"
