#!/usr/bin/env bash
set -euo pipefail
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  eval "$(bash "$PWD/tools/ci/provide-media.sh")"
fi
exec bun tests/e2e/browser/run.ts
