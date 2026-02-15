#!/usr/bin/env bash
# Install cowCode as a background daemon (launchd on macOS, systemd on Linux).
# Run from the cowCode install directory. Creates service and starts it.

set -e
INSTALL_DIR="${COWCODE_INSTALL_DIR:-$(pwd)}"
cd "$INSTALL_DIR"
[ -f "index.js" ] || { echo "Run this script from the cowCode directory."; exit 1; }
export COWCODE_INSTALL_DIR="$INSTALL_DIR"
exec bash "$(dirname "$0")/daemon.sh" start
