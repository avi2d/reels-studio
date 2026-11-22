#!/usr/bin/env bash
set -euo pipefail
# One source for the media tools a CI shell runs. The generated test step and
# tests/e2e/browser/ci.sh both eval this script, so a runner that holds
# neither ffmpeg nor uv still runs the same pinned builds:
#   eval "$(bash tools/ci/provide-media.sh)"
# Stdout carries only export lines, and every other word goes to stderr.
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-21-12-37/ffmpeg-n8.1.3-39-g660b5aa7db-linux64-gpl-8.1.tar.xz"
FFMPEG_SHA="85d6d2c617fa4e2bee9ea105b5532c66ac866ada0a9a650a088e6fb096c7eeff"
# uv 0.13.9, pinned the way the runner pins its other tools.
UV_URL="https://github.com/astral-sh/uv/releases/download/0.13.9/uv-x86_64-unknown-linux-gnu.tar.gz"
UV_SHA="a7fbaff2b9a271d85c1bdb540941090fd1ce011797b4abeb48e4dcd39c2471d5"
CACHE="${MEDIA_CACHE:-$HOME/.cache/reels-studio-media}"

fetch() {
  if ! curl -fsSL -o "$3" "$1"; then
    echo "provide-media.sh: download failed: $1" >&2
    return 1
  fi
  if ! printf '%s  %s\n' "$2" "$3" | sha256sum -c - >&2; then
    echo "provide-media.sh: checksum mismatch: $1" >&2
    return 1
  fi
}

missing_ffmpeg=false
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  missing_ffmpeg=true
fi
missing_uv=false
if ! command -v uv >/dev/null; then
  missing_uv=true
fi

if [ "$missing_ffmpeg" = true ] && sudo -n true 2>/dev/null; then
  sudo apt-get update >&2
  sudo apt-get install -y ffmpeg >&2
  hash -r
  missing_ffmpeg=false
  if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
    missing_ffmpeg=true
  fi
fi

if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ]; then
  mkdir -p "$CACHE"
  if [ "$missing_ffmpeg" = true ]; then
    if ! [ -x "$CACHE/ffmpeg/ffmpeg" ] || ! [ -x "$CACHE/ffmpeg/ffprobe" ]; then
      rm -rf "$CACHE/ffmpeg-fetch" "$CACHE/ffmpeg.tar.xz"
      mkdir -p "$CACHE/ffmpeg-fetch"
      fetch "$FFMPEG_URL" "$FFMPEG_SHA" "$CACHE/ffmpeg.tar.xz"
      tar -xf "$CACHE/ffmpeg.tar.xz" -C "$CACHE/ffmpeg-fetch"
      rm -rf "$CACHE/ffmpeg"
      mv "$CACHE/ffmpeg-fetch"/ffmpeg-*/bin "$CACHE/ffmpeg"
      rm -rf "$CACHE/ffmpeg-fetch" "$CACHE/ffmpeg.tar.xz"
    fi
  fi
  if [ "$missing_uv" = true ]; then
    if ! [ -x "$CACHE/uv/uv" ]; then
      rm -rf "$CACHE/uv-fetch" "$CACHE/uv.tar.gz"
      mkdir -p "$CACHE/uv-fetch"
      fetch "$UV_URL" "$UV_SHA" "$CACHE/uv.tar.gz"
      tar -xzf "$CACHE/uv.tar.gz" -C "$CACHE/uv-fetch"
      rm -rf "$CACHE/uv"
      mv "$CACHE/uv-fetch"/uv-*/ "$CACHE/uv"
      rm -rf "$CACHE/uv-fetch" "$CACHE/uv.tar.gz"
    fi
  fi
elif [ "$missing_ffmpeg" = true ] || [ "$missing_uv" = true ]; then
  echo "provide-media.sh: ffmpeg, ffprobe and uv are missing and passwordless sudo is denied; provide them on the runner PATH and rerun" >&2
  exit 1
fi

printf 'export PATH="%s:$PATH"\n' "$CACHE/ffmpeg" "$CACHE/uv"
