#!/usr/bin/env bash
set -e

echo "=== sober-sources setup ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ is required (found v$NODE_VERSION)"
  exit 1
fi

echo "✓ Node.js $(node --version)"

# Install dependencies
echo "Installing dependencies..."
npm install
echo "✓ Dependencies installed"

# Create data directory
DATA_DIR="${SOBER_SOURCES_DIR:-$HOME/.sober-sources}"
mkdir -p "$DATA_DIR/pdfs"
echo "✓ Data directory: $DATA_DIR"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Quick start:"
echo "  sober-sources import-bibtex examples/sample.bib"
echo "  sober-sources list"
echo "  sober-sources server    # start MCP server"
