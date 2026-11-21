#!/usr/bin/env bash
set -euo pipefail
URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-21-12-37/ffmpeg-n8.1.3-39-g660b5aa7db-linux64-gpl-8.1.tar.xz"
SHA="85d6d2c617fa4e2bee9ea105b5532c66ac866ada0a9a650a088e6fb096c7eeff"
CACHE="node_modules/.cache/ffmpeg-btbn"
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if sudo -n true 2>/dev/null; then
    sudo apt-get update
    sudo apt-get install -y ffmpeg
  elif [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ]; then
    mkdir -p "$CACHE"
    if ! [ -x "$CACHE/bin/ffmpeg" ] || ! [ -x "$CACHE/bin/ffprobe" ]; then
      rm -rf "$CACHE/fetch" "$CACHE/package.tar.xz"
      mkdir -p "$CACHE/fetch"
      if ! curl -fsSL -o "$CACHE/package.tar.xz" "$URL"; then
        echo "ci.sh: download failed: $URL" >&2
        exit 1
      fi
      if ! printf '%s  %s\n' "$SHA" "$CACHE/package.tar.xz" | sha256sum -c -; then
        echo "ci.sh: checksum mismatch: $URL" >&2
        exit 1
      fi
      tar -xf "$CACHE/package.tar.xz" -C "$CACHE/fetch"
      rm -rf "$CACHE/bin"
      mv "$CACHE/fetch/ffmpeg-n8.1.3-39-g660b5aa7db-linux64-gpl-8.1/bin" "$CACHE/bin"
      rm -rf "$CACHE/fetch" "$CACHE/package.tar.xz"
    fi
    export PATH="$PWD/$CACHE/bin:$PATH"
  else
    echo "ci.sh: ffmpeg and ffprobe are missing and passwordless sudo is denied; provide both on the runner PATH and rerun" >&2
    exit 1
  fi
fi
exec bun tests/e2e/browser/run.ts
