#!/usr/bin/env bash
set -e
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/main.tar.gz"
DIR="cowCode"

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists. Remove it or use another directory."
  exit 1
fi

echo "Downloading cowCode..."
curl -fsSL "$TARBALL" | tar xz
mv cowCode-main "$DIR"
cd "$DIR"

echo "Running setup..."
node setup.js

echo ""
echo "To start the bot later: cd $DIR && npm start"
