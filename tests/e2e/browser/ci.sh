#!/usr/bin/env bash
set -euo pipefail
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if sudo -n true 2>/dev/null; then
    sudo apt-get update
    sudo apt-get install -y ffmpeg
  else
    echo "ci.sh: ffmpeg and ffprobe are missing and passwordless sudo is denied; provide both on the runner PATH and rerun" >&2
    exit 1
  fi
fi
exec bun tests/e2e/browser/run.ts
