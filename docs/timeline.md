---
kind: reference
---
# Takes and blocks

The page of one video folder shows the speech of every heard video as a row of blocks, each with its takes.

## The working screen

Four stages work: «Видео и задание», «Дубли и блоки», «Паузы и склейки» and «Готовый ролик».
A bar at the top holds the way back, the title, the undo and redo buttons and the chat.
The player stands next to the stage tabs, the row of blocks and the open stage.
The row of blocks sits between the tabs and the open stage, with the text, the clip and the pauses of each block.
The round button under the player starts playback from the open block.
Click the stop icon on that button to stop playback.
The chat opens as a drawer over the page.
On a phone the player sits above the tabs.
The take and pause lists scroll without moving the player or the tabs.
On a phone the tabs read «Видео», «Дубли», «Паузы» and «Ролик», so all four fit on one line.

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
The model judges a stumble from the transcript.
A stumble is a repeated word, a word cut off, a sentence started again, a filler or a pause inside the take.
Each take carries a short reason in Russian.

The person chooses a take, drags and deletes blocks, and removes pauses on the page.
The studio keeps these choices in `timeline.json`, which the chat model cannot write.
A deleted block and a removed pause stay listed on the page, and one tap returns each.
The player shows the chosen takes in order and skips the removed pauses.
Each preview holds a key frame every half second.
The studio re-encodes a preview made with the old key frame distance by itself in the background.
The old preview stays playable until the new one is complete.
A removed pause leaves 0.2 s of silence in its place.
The sound fades over 0.06 s on each side of a cut.
«Послушать» next to a pause plays 1.5 s before it and 1.5 s after it.
The undo button in the bar takes back the last change of the cut, and the redo button brings it back.
A new change after an undo clears what redo could bring back.
The buttons carry icons, and a tooltip names each when the mouse rests on it or the keyboard focuses it.
The numbered buttons under the player have equal widths.
Scroll the strip to reach more blocks, or click a number to open the block.
During playback, a play mark shows the current block in the numbered strip and the row of clips.

## The built reel

«Собрать ролик» on the «Готовый ролик» stage builds one file from the original videos, not from the previews.
The file holds the chosen takes in the order of the row, without the removed pauses, with the same 0.06 s sound fade at each cut.
It is 1080 by 1920 at 30 frames a second, H.264 High with AAC sound in an MP4.
An iPhone HDR original is turned into ordinary BT.709 colours, so the reel does not look washed out in Instagram.
The studio cuts each clip to whole frames, encodes the clips one by one through `REELS_HEAVY` with `REELS_ENCODER`, then joins them without encoding again.
A bar shows how much of the reel is encoded.
The build waits while the computer hears or measures another video, because the studio runs one heavy job at a time.
The originals stay untouched.

The stage plays the built file and offers «Скачать».
On an iPhone, save the downloaded file to «Фото», and the Instagram reel screen finds it there.
After a change of the cut, the stage says the file no longer matches the cut, and «Собрать заново» builds it again.
A server restart forgets a build in progress, and the person presses the button again.

## Keys

| Key | What it does |
| --- | --- |
| Space | Plays the cut from the open block, or stops it |
| Arrow keys | Open the block before or after |
| 1 to 9 | Choose that take of the open block |
| Delete | Deletes the open block |
| Z | Takes back the last change |

The keys do nothing while the person types in a field.

## Where the speaker looks

After the studio hears a video, it measures where the speaker looks, on the home computer.
`tools/gaze/gaze.py` reads five frames a second and runs the MediaPipe Face Landmarker model on the processor.
The model file is downloaded once to `~/.cache/reels-studio/` and checked against its SHA-256.
No frame leaves the computer.

A frame counts as a look into the camera when the eyes point within 12 degrees of the line from the face to the lens.
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
| `reel/reel.mp4` | The built reel |
| `reel/reel.json` | When the reel was built and the parts it holds, so the stage can tell whether the cut changed since |
