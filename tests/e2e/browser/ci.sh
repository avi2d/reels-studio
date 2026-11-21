#!/usr/bin/env bash
set -euo pipefail
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if sudo -n true 2>/dev/null; then
    sudo apt-get update
    sudo apt-get install -y ffmpeg
  else
    case "$(uname -m)" in
      aarch64|arm64) build=arm64 ;;
      *) build=amd64 ;;
    esac
    dir="node_modules/.cache/ffmpeg-static"
    mkdir -p "$dir"
    curl -fsSL -o "$dir/ffmpeg.tar.xz" "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-$build-static.tar.xz"
    tar -xf "$dir/ffmpeg.tar.xz" -C "$dir" --strip-components=1
    export PATH="$dir:$PATH"
  fi
fi
exec bun tests/e2e/browser/run.ts
