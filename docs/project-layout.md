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
| `src/shared/gather.ts` | When the studio asks the chat model to gather the blocks by itself |
| `src/shared/brief.ts` | The format of the brief, the plan and the saved yes, and the work the studio does after the yes |
| `src/shared/chat.ts` | The format of a chat message and the kinds of file a person can attach to it |
| `src/shared/library.ts` | The format of a video offered from another folder and of a pick, used by the server and the page |
| `tools/transcribe/` | The speech recognizer, a Python script that uv runs |
| `tools/pdf/` | The PDF reader that renders the first pages and takes out the text, a Python script that uv runs |
| `tools/gaze/` | The measure of where the speaker looks, a Python script that uv runs |
| `deploy/reels-studio.service` | The systemd user unit that keeps the studio running |
| `src/pi/` | The pi extension that keeps the chat model inside one video folder |
| `src/web/` | The page, its styles and its script |
| `skills/` | The three skills the chat model reads: plan, style and player zones |
| `brands/` | One folder per style profile with its colours, fonts and templates |
| `prompts/studio.md` | The system prompt of the chat model |
| `projects/` | One folder per video with the originals, the files attached in the chat, the chat, the transcripts and the plan, kept out of git |
| `tests/unit/` | The unit tests |
| `tests/e2e/browser/` | The browser scenarios and their GitHub Actions runner |
