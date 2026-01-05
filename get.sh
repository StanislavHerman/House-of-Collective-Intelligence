#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/StanislavHerman/House-of-Collective-Intelligence.git"
INSTALL_DIR="${HOME}/House-of-Collective-Intelligence"

print_usage() {
  cat <<'EOF'
Usage: get.sh [--dir <path>] [--update]

Installs House of Collective Intelligence into ~/House-of-Collective-Intelligence by default,
installs dependencies, builds, and registers the `hause` command in your PATH.

Options:
  --dir <path>  Install directory (default: ~/House-of-Collective-Intelligence)
  --update      If directory exists, try to git pull instead of aborting
EOF
}

UPDATE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --update)
      UPDATE=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

echo "================================================="
echo " 🏛  House of Collective Intelligence — Installer"
echo "================================================="
echo ""

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed." >&2
  echo "Install git first and retry." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed." >&2
  echo "Install Node.js (v18+) from https://nodejs.org/ and retry." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not available." >&2
  echo "Install Node.js (it includes npm) and retry." >&2
  exit 1
fi

echo "✓ Node: $(node -v)"
echo "✓ Git:  $(git --version | awk '{print $3}')"
echo ""

if [[ -d "$INSTALL_DIR/.git" ]]; then
  if [[ "$UPDATE" -ne 1 ]]; then
    echo "Directory already exists: $INSTALL_DIR"
    echo "Re-run with --update to update it instead."
    exit 2
  fi

  echo "Updating existing install at: $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch origin --prune
  git -C "$INSTALL_DIR" checkout -B main origin/main
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  if [[ -e "$INSTALL_DIR" ]]; then
    echo "Path exists but is not a git repo: $INSTALL_DIR" >&2
    echo "Move it away or choose a different --dir." >&2
    exit 2
  fi

  echo "Cloning to: $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo ""
echo "Running setup..."
chmod +x "$INSTALL_DIR/install.sh"
"$INSTALL_DIR/install.sh"

echo ""
echo "Done."
echo "Start a new terminal (or run: source ~/.zshrc / ~/.bashrc), then run:"
echo "  hause"

