---
kind: reference
---
# Takes and blocks

The page of one video folder shows the speech of every heard video as a row of blocks, each with its takes.

## The working screen

Three stages work: «Видео и задание», «Дубли и блоки» and «Паузы и склейки».
A bar at the top holds the way back, the title, the undo and redo buttons and the chat.
The player stands next to the stage tabs, the row of blocks and the open stage.
The row of blocks sits between the tabs and the open stage, with the text, the clip and the pauses of each block.
The round button under the player starts playback from the open block.
Click the stop icon on that button to stop playback.
The chat opens as a drawer over the page.
On a phone the player sits above the tabs.
The take and pause lists scroll without moving the player or the tabs.
On a phone the tabs read «Видео», «Дубли» and «Паузы», so all three fit on one line.

## Terms

| Term | What it means |
| --- | --- |
| Block | One thought of the reel |
| Take | One attempt to say that thought, a run of words in one video |
| Pause | Silence of 0.5 s or more after a word of a take, up to the next word of the same video |

## Who decides what

As soon as the studio has heard every uploaded video, it asks the chat model by itself to write `blocks.json`, without waiting for the plan, the gaze or the yes.
The first gathering ranks the takes by speech alone.
When the gaze of every heard video is settled, the studio gathers once more, so the takes stand by speech and gaze.
The stages «Дубли и блоки» and «Паузы и склейки» say that the studio is gathering the blocks meanwhile.
Once the blocks are written, the page shows the take ranked first in every block the person has not chosen, and the studio shortens every pause of the shown takes to 0.2 s, except the pauses the person returned.
After any change to `blocks.json`, whoever wrote it, the studio shortens the pauses of the shown takes once more without a new model run.
After the yes the pinned takes stay while they still exist.
A new heard video gathers the blocks again, and a gaze that settles after the last gathering gathers them once more.
The studio keeps the heard videos and the settled gaze it last asked about in `gathered.json`.
When a gathering ends without a ready row of blocks, or the model run reports an error, the studio keeps the attempt with a failed mark and the hash of the `blocks.json` it saw in `gathered.json`.
`gathered.json` also keeps the hash of the `blocks.json` the studio last shortened pauses for, so only different blocks trigger one more shortening.
A clean run that leaves `blocks.json` unchanged is a success.
The stage «Дубли и блоки» shows that the studio could not gather the blocks and keeps the «Собрать блоки» button while the mark is set and `blocks.json` still matches that hash, also over ready blocks.
Different blocks clear the note without new state.
The next heard video or the next settled gaze tries again.
The request and the answer do not show in the chat.
The gathering runs in its own session next to the chat.
A message the person sends never stops, blocks or delays it, and it never blocks the person's message.
Both may write `blocks.json`.
The later valid file wins.
The chat model reads the transcript and the gaze text of every video when it writes `blocks.json`.
It puts the takes with one meaning into one block, from whichever videos they come.
It orders the blocks by where each thought is first said, and the takes of a block from the best to the worst.
A take ranks higher when the speaker does not stumble and when the speaker looks into the camera.
The model judges a stumble from the transcript.
A stumble is a repeated word, a word cut off, a sentence started again, a filler or a pause inside the take.
Each take carries a short reason in Russian.

The person chooses a take, drags and deletes blocks, and removes pauses on the page.
The studio keeps these choices in `timeline.json`, which the chat model cannot write.
Each page save carries the edits the page started from next to its new edits.
The server applies only the person's changes since that base on top of the current `timeline.json` under one per-project lock, and the page adopts the merged edits.
The gathering and the yes write `timeline.json` under the same lock on top of the file as it stands.
A pause the person returns stays in the `kept` list of `timeline.json`, and the studio never shortens it by itself, neither after a gathering nor after the yes.
Removing the pause by hand drops it from that list.
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
The studio writes no video file from the row.

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

## Places to check

A join is a place where the cut jumps from one moment of a video to another.
It comes at a removed pause or between two blocks.
Two blocks that follow each other in one video with no gap make no join.
For each sample, the gaze measure also writes where the eyes are.
It also writes how tall the face is, from brow to chin.
For each join, the studio takes two faces within 0.4 s of the join.
One is the last face at or before the join, and the other is the first face at or after it.
It sums the shift of the eyes and the change of the face height, and divides that by the mean face height.
A join whose sum is above 0.08 becomes a place to check in the «Паузы и склейки» stage.
A join with no face on one side is not a place.
The tab of that stage shows how many places are left unanswered.
«Посмотреть» plays 1.5 s before the join and 1.5 s after it, framed as the reel plays it.
Either answer takes the place off the count:

- «Оставить скачок» keeps the join as it is, so the head jumps on it.
- «Сменить план» changes the frame at the join, like a cut to a second camera.

After a change of shot, the player shows the frame 1.3 times closer, centred on the eyes, up to the next change of shot.
If the frame before the join is already close, the change of shot goes back to the wide frame.
The answer is kept in `timeline.json` with the two ends of the join, so a change of the cut that moves the join opens it again.
The studio re-measures by itself, in the background, a video whose gaze file holds no head positions.
This runs on the home computer and does not ask the chat model.

## Files

Each video folder holds these next to `plan.json`:

| Path | What it holds |
| --- | --- |
| `gaze/<video>.json` | One sample per 0.2 s: `camera`, `away` or `hidden`, and where the eyes are and the face height, as shares of the frame height |
| `gaze/<video>.txt` | The share of looks into the camera for each stretch of speech, which the chat model reads |
| `blocks.json` | The blocks and their takes, written by the chat model |
| `timeline.json` | The order of the blocks, the deleted blocks, the chosen takes, the removed pauses, the returned pauses and the answers to the places to check |
| `gathered.json` | The heard videos and the settled gaze the studio last asked the chat model to gather blocks from, with a failed mark, the hash of the `blocks.json` the failed attempt saw, and the hash of the `blocks.json` it last shortened pauses for |
