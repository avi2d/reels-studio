---
kind: reference
---
# How the studio hears a video

The studio starts on each uploaded video by itself, one video at a time.
It writes a small preview for the page and a text of the speech, which takes a few minutes for a long video.
The preview holds a key frame every half second so the player can start at the selected block.
A preview made before that keeps the old key frame distance until the studio re-encodes it by itself in the background, one video at a time and with the same encoder settings.
The old preview stays playable until the new one is complete, and only the preview is re-encoded.
GigaAM v3 recognizes the speech, and Silero VAD finds the stretches of speech first.

Each video folder holds these, named after the video:

| Path | What it holds |
| --- | --- |
| `source/` | The uploaded original, which the studio never changes |
| `transcripts/<video>.json` | Each word with its start and end in seconds |
| `transcripts/<video>.txt` | The same words numbered, which the chat model reads |
| `preview/<video>.mp4` | The small copy the page plays, with a key frame every half second |
| `preview/<video>.mp4.gop` | The key frame distance the preview was made with. A preview with no such record counts as old |
| `plan.json` | The words the chat model plans to remove, by their numbers |

The shared list of uploaded videos in `projects/.library` holds the same `source/`, `transcripts/` and `preview/` folders.

The player on the page skips each run of removed words, from the start of its first word to the end of its last.
