#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/StanislavHerman/House-of-Collective-Intelligence.git"
INSTALL_DIR="${HOME}/House-of-Collective-Intelligence"

os_name() {
  uname -s 2>/dev/null || echo "unknown"
}

node_major() {
  local v
  v="$(node -v 2>/dev/null || true)"
  v="${v#v}"
  echo "${v%%.*}"
}

need_sudo() {
  [[ "$(id -u)" -ne 0 ]] && command -v sudo >/dev/null 2>&1
}

try_install_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi

  echo "Git not found. Trying to install it (recommended)..."
  local os
  os="$(os_name)"

  if [[ "$os" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install git
      command -v git >/dev/null 2>&1 && return 0
    fi

    echo "On macOS you may need Xcode Command Line Tools (includes git)." >&2
    echo "Triggering: xcode-select --install" >&2
    xcode-select --install >/dev/null 2>&1 || true
    return 1
  fi

  if command -v apt-get >/dev/null 2>&1; then
    if need_sudo; then
      sudo apt-get update -y
      sudo apt-get install -y git
    else
      apt-get update -y
      apt-get install -y git
    fi
    command -v git >/dev/null 2>&1 && return 0
    return 1
  fi

  if command -v dnf >/dev/null 2>&1; then
    if need_sudo; then
      sudo dnf install -y git
    else
      dnf install -y git
    fi
    command -v git >/dev/null 2>&1 && return 0
    return 1
  fi

  if command -v yum >/dev/null 2>&1; then
    if need_sudo; then
      sudo yum install -y git
    else
      yum install -y git
    fi
    command -v git >/dev/null 2>&1 && return 0
    return 1
  fi

  if command -v pacman >/dev/null 2>&1; then
    if need_sudo; then
      sudo pacman -Sy --noconfirm git
    else
      pacman -Sy --noconfirm git
    fi
    command -v git >/dev/null 2>&1 && return 0
    return 1
  fi

  return 1
}

ensure_node() {
  local major
  major="$(node_major)"
  if [[ -n "$major" ]] && [[ "$major" -ge 18 ]]; then
    return 0
  fi

  echo "Node.js v18+ not found. Trying to install Node (recommended: v20 LTS)..."
  local os
  os="$(os_name)"

  if [[ "$os" != "Darwin" ]] && [[ "$os" != "Linux" ]]; then
    echo "Unsupported OS for auto-install. Install Node.js (v18+) from https://nodejs.org/ and re-run." >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to install Node automatically. Please install curl and re-run." >&2
    exit 1
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi

  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"

  if command -v nvm >/dev/null 2>&1; then
    nvm install 20 || nvm install --lts
    nvm use 20 >/dev/null 2>&1 || true
  fi

  major="$(node_major)"
  if [[ -z "$major" ]] || [[ "$major" -lt 18 ]]; then
    if [[ "$os" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
      brew install node
    fi
  fi

  major="$(node_major)"
  if [[ -z "$major" ]] || [[ "$major" -lt 18 ]]; then
    echo "Failed to install Node.js automatically. Install Node.js (v18+) from https://nodejs.org/ and re-run." >&2
    exit 1
  fi
}

ensure_npm() {
  if command -v npm >/dev/null 2>&1; then
    return 0
  fi
  echo "npm is not available. Reinstall Node.js (it includes npm) and re-run." >&2
  exit 1
}

print_usage() {
  cat <<'EOF'
Usage: get.sh [--dir <path>] [--update]

Installs House of Collective Intelligence into ~/House-of-Collective-Intelligence by default,
installs dependencies, builds, and registers the `hause` command in your PATH.

This installer will attempt to install prerequisites (Git, Node.js v18+) automatically when possible.

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

ensure_node
ensure_npm

echo "✓ Node: $(node -v)"
if command -v git >/dev/null 2>&1; then
  echo "✓ Git:  $(git --version | awk '{print $3}')"
else
  if try_install_git; then
    echo "✓ Git:  $(git --version | awk '{print $3}')"
  else
    echo "⚠ Git is not available. Will install from GitHub archive (updates by re-running this installer)."
  fi
fi
echo ""

install_via_git() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    if [[ "$UPDATE" -ne 1 ]]; then
      UPDATE=1
    fi

    if [[ "$UPDATE" -eq 1 ]]; then
      if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain 2>/dev/null || true)" ]]; then
        echo "Repo has local changes: $INSTALL_DIR" >&2
        echo "Commit/stash them first, or reinstall into a different directory (--dir)." >&2
        exit 2
      fi

      echo "Updating existing install at: $INSTALL_DIR"
      git -C "$INSTALL_DIR" fetch origin --prune
      git -C "$INSTALL_DIR" checkout -B main origin/main
      git -C "$INSTALL_DIR" pull --ff-only origin main
    fi
  else
    if [[ -e "$INSTALL_DIR" ]]; then
      echo "Path exists but is not a git repo: $INSTALL_DIR" >&2
      echo "Move it away or choose a different --dir." >&2
      exit 2
    fi

    echo "Cloning to: $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
}

install_via_archive() {
  local archive_url tmp_dir extracted_dir
  archive_url="https://codeload.github.com/StanislavHerman/House-of-Collective-Intelligence/tar.gz/refs/heads/main"

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download the archive. Please install curl and re-run." >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  echo "Downloading archive..."
  curl -fsSL "$archive_url" | tar -xz -C "$tmp_dir"
  extracted_dir="$(find "$tmp_dir" -maxdepth 1 -type d -name 'House-of-Collective-Intelligence-*' | head -n 1 || true)"
  if [[ -z "$extracted_dir" ]]; then
    echo "Failed to extract archive." >&2
    exit 1
  fi

  if [[ -e "$INSTALL_DIR" ]]; then
    echo "Replacing existing directory: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
  fi

  mv "$extracted_dir" "$INSTALL_DIR"
}

if command -v git >/dev/null 2>&1; then
  install_via_git
else
  install_via_archive
fi

echo ""
echo "Running setup..."
chmod +x "$INSTALL_DIR/install.sh"
"$INSTALL_DIR/install.sh"

echo ""
echo "Done."
echo "Start a new terminal (or run: source ~/.zshrc / ~/.bashrc), then run:"
echo "  hause"

exit 0
