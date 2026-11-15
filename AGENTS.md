# Project agent memory

This repository holds Reels studio, a home-network web page with a chat, a resumable video upload and three skills for preparing Instagram videos.
README.md holds what a person reads.

## Where things are

- [README.md](README.md) lists every path, the settings and the start and check steps.
- [VISION.md](VISION.md) holds the limits the owner set, which decide whether a change belongs.
- [skills/](skills/), [brands/](brands/) and [prompts/studio.md](prompts/studio.md) are read by the chat model and are written in English.
- [src/web/](src/web/) holds every text the person reads, in Russian.

## The chat engine

- [src/pi/project-guard.ts](src/pi/project-guard.ts) is loaded by pi, which runs on node, so it cannot use Bun APIs.
- [src/server/chat.ts](src/server/chat.ts) keeps pi's extension discovery on, since the `claude-bridge` provider is a pi extension of the owner, and limits the model with `--tools` and the guard.

## Scripts

The scripts are defined in [package.json](package.json) under their own names: `start`, `build`, `lint`, `typecheck` and `test`.
