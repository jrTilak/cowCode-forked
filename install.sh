#!/usr/bin/env bash
set -e
BRANCH="${COWCODE_BRANCH:-master}"
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/${BRANCH}.tar.gz"
EXTRACTED="cowCode-${BRANCH}"
DIR="cowCode"

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists. Remove it or use another directory."
  exit 1
fi

echo "Downloading cowCode..."
curl -fsSL "$TARBALL" | tar xz
mv "$EXTRACTED" "$DIR"
cd "$DIR"

echo "Running setup..."
if [ -t 0 ]; then
  node setup.js
elif [ -e /dev/tty ]; then
  node setup.js < /dev/tty
else
  echo "No terminal. Run: cd $DIR && node setup.js"
fi

echo ""
echo "To start the bot later: cd $DIR && npm start"
