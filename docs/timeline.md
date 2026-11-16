---
kind: reference
---
# Takes and blocks

The «Монтаж» card shows the speech of every heard video of one video folder as a row of blocks, each with its takes.

## Terms

| Term | What it means |
| --- | --- |
| Block | One thought of the reel |
| Take | One attempt to say that thought, a run of words in one video |
| Pause | Silence of 0.5 s or more after a word of a take, up to the next word of the same video |

## Who decides what

The chat model reads the transcript and the gaze text of every video and writes `blocks.json`.
It puts the takes with one meaning into one block, from whichever videos they come.
It orders the blocks by where each thought is first said, and the takes of a block from the best to the worst.
A take ranks higher when the speaker does not stumble and when the speaker looks into the camera.
The model judges a stumble from the transcript: a repeated word, a word cut off, a sentence started again, a filler or a pause inside the take.
Each take carries a short reason in Russian.

The person chooses a take, drags and deletes blocks, and removes pauses on the page.
The studio keeps these choices in `timeline.json`, which the chat model cannot write.
A deleted block and a removed pause stay listed on the page, and one tap returns each.
The play button plays the chosen takes in the order of the row, from the previews, and skips the removed pauses.
«С соседями» plays a take with the last 2 s of the block before it and the first 2 s of the block after it.
A strip of numbered blocks shows the whole cut, each as wide as its length, and a click opens that block.
The studio writes no video file from the row.

## Keys

| Key | What it does |
| --- | --- |
| Space | Starts and stops the cut |
| Left and Right arrows | Open the block before or after |
| 1 to 9 | Choose that take of the open block |
| Enter | Plays the cut from the open block |
| Delete | Deletes the open block |

The keys do nothing while the person types in a field.

## Where the speaker looks

After the studio hears a video, it measures where the speaker looks, on the home computer.
`tools/gaze/gaze.py` reads five frames a second and runs the MediaPipe Face Landmarker model on the processor.
The model file is downloaded once to `~/.cache/reels-studio/` and checked against its SHA-256.
No frame leaves the computer.

A frame counts as a look into the camera when the direction of the eyes is within 12 degrees of the line from the face to the lens.
The direction of the eyes is the turn of the head plus the turn of the eyes, which the model gives as blendshape scores.
A frame with no face counts as no look into the camera.

## Files

Each video folder holds these next to `plan.json`:

| Path | What it holds |
| --- | --- |
| `gaze/<video>.json` | One sample per 0.2 s: `camera`, `away` or `hidden` |
| `gaze/<video>.txt` | The share of looks into the camera for each stretch of speech, which the chat model reads |
| `blocks.json` | The blocks and their takes, written by the chat model |
| `timeline.json` | The order of the blocks, the deleted blocks, the chosen takes and the removed pauses |
