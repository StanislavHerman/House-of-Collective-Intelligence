#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=================================================${NC}"
echo -e "${CYAN}   🏛  House of Collective Intelligence Setup    ${NC}"
echo -e "${CYAN}=================================================${NC}"
echo ""

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js (v18 or higher) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js found (${NODE_VERSION})${NC}"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not available.${NC}"
    echo "Please install Node.js (it includes npm) and retry."
    exit 1
fi

# 2. Install Dependencies
echo ""
echo -e "${CYAN}Installing dependencies...${NC}"
if [[ -f package-lock.json ]]; then
    npm ci
else
    npm install
fi

# 3. Build Project
echo ""
echo -e "${CYAN}Building project...${NC}"
npm run build

# 4. Make executable
chmod +x dist/index.js

# 5. Register `hause` command in user PATH (no sudo)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

HAUSE_BIN="${BIN_DIR}/hause"
cat >"$HAUSE_BIN" <<EOF
#!/usr/bin/env bash
exec node "${ROOT_DIR}/dist/index.js" "\$@"
EOF
chmod +x "$HAUSE_BIN"

ensure_path() {
    local rc_file="$1"
    local export_line='export PATH="$HOME/.local/bin:$PATH"'
    if [[ -f "$rc_file" ]] && grep -Fq "$export_line" "$rc_file" 2>/dev/null; then
        return 0
    fi
    {
        echo ""
        echo "# Added by House of Collective Intelligence installer"
        echo "$export_line"
    } >>"$rc_file"
}

if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
    if [[ -n "${ZSH_VERSION-}" ]]; then
        ensure_path "${HOME}/.zshrc"
    elif [[ -n "${BASH_VERSION-}" ]]; then
        ensure_path "${HOME}/.bashrc"
    else
        ensure_path "${HOME}/.profile"
    fi
    echo ""
    echo -e "${YELLOW}Added ${BIN_DIR} to your PATH for new terminals.${NC}"
fi

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo -e "To start the application, run:"
echo -e "${CYAN}hause${NC}"
echo ""
echo -e "If the command is not found, restart your terminal (or source your shell rc)."
