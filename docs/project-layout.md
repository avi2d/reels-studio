---
kind: reference
---
# Project layout

The studio keeps its code, skills and per-video folders in these places.

## Paths

| Path | What it holds |
| --- | --- |
| `src/index.ts` | The entry that starts the server |
| `src/server/` | The routes, the video folders, the resumable upload, the chat and the transcription job |
| `src/shared/plan.ts` | The transcript and plan formats and the spans the player skips, used by the server and the page |
| `src/shared/timeline.ts` | The formats of the gaze samples, the blocks, the takes and the person's choices, and the spans the montage plays |
| `src/shared/reel.ts` | The state of a reel build and of the built file, used by the server and the page |
| `src/shared/library.ts` | The format of a video offered from another folder and of a pick, used by the server and the page |
| `tools/transcribe/` | The speech recognizer, a Python script that uv runs |
| `tools/gaze/` | The measure of where the speaker looks, a Python script that uv runs |
| `deploy/reels-studio.service` | The systemd user unit that keeps the studio running |
| `src/pi/` | The pi extension that keeps the chat model inside one video folder |
| `src/web/` | The page, its styles and its script |
| `skills/` | The three skills the chat model reads: plan, style and player zones |
| `brands/` | One folder per style profile with its colours, fonts and templates |
| `prompts/studio.md` | The system prompt of the chat model |
| `projects/` | One folder per video with the originals, the chat, the transcripts and the plan, kept out of git |
| `tests/unit/` | The unit tests |
