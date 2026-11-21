#!/usr/bin/env bash
set -euo pipefail
if ! command -v ffmpeg > /dev/null; then
  sudo apt-get update
  sudo apt-get install -y ffmpeg
fi
exec bun tests/e2e/browser/run.ts
