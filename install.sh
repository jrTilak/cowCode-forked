#!/usr/bin/env bash
set -e
BRANCH="${COWCODE_BRANCH:-master}"
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/${BRANCH}.tar.gz"
EXTRACTED="cowCode-${BRANCH}"
DIR="cowCode"

echo ""
echo "  Welcome to cowCode — WhatsApp bot with your own LLM"
echo "  ------------------------------------------------"
echo ""

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists. Remove it or use another directory."
  exit 1
fi

echo "  ► Downloading..."
curl -fsSL "$TARBALL" | tar xz
mv "$EXTRACTED" "$DIR"
cd "$DIR"
echo "  ✓ Done."
echo ""

echo "  ► Setting up (dependencies + config)..."
if [ -t 0 ]; then
  node setup.js
elif [ -e /dev/tty ]; then
  node setup.js < /dev/tty
else
  echo "  No terminal. Run: cd $DIR && node setup.js"
fi

INSTALL_DIR="$(pwd)"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/cowcode" << EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR" && exec node index.js "\$@"
EOF
chmod +x "$BIN_DIR/cowcode"
echo "  ► Launcher installed: $BIN_DIR/cowcode"

# Add ~/.local/bin to PATH in shell config so cowcode works in new terminals
# (We add to both .zshrc and .bashrc because install runs in bash — $SHELL can lie.)
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
add_path_to() {
  local f="$1"
  [ -f "$f" ] || return 0
  grep -q '.local/bin' "$f" 2>/dev/null && return 0
  echo "" >> "$f"
  echo "# cowCode" >> "$f"
  echo "$PATH_LINE" >> "$f"
  echo "  ► Added ~/.local/bin to PATH in $f"
}
if ! command -v cowcode >/dev/null 2>&1; then
  add_path_to "${ZDOTDIR:-$HOME}/.zshrc"
  add_path_to "$HOME/.bashrc"
  add_path_to "$HOME/.profile"
  echo "  ► Open a new terminal, or run:  source ~/.zshrc   (then run: cowcode)"
fi
echo ""
echo "  ------------------------------------------------"
echo "  To start the bot:  cowcode"
echo "  (or from this folder:  npm start)"
echo ""
