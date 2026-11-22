---
kind: reference
---
# Takes and blocks

The page of one video folder shows the speech of every heard video as a row of blocks, each with its takes.

## The working screen

Five stages work: «Видео и задание», «Дубли и блоки», «Паузы и склейки», «Готовый ролик» and «Внешность».
A bar at the top holds the way back, the title, the undo and redo buttons and the chat.
The player stands next to the stage tabs, the row of blocks and the open stage.
The row of blocks sits between the tabs and the open stage, with the text, the clip and the pauses of each block.
The round button under the player starts playback from the open block.
Click the stop icon on that button to stop playback.
The chat opens as a drawer over the page.
On a phone the player sits above the tabs.
The take, pause and place lists scroll without moving the player or the tabs.
On a phone the tabs read «Видео», «Дубли», «Паузы», «Ролик» and «Лицо».
The open tab scrolls into view.

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
The player shows the chosen takes in order and skips the removed pauses and the cuts at answered places.
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
The file holds the chosen takes in row order, without removed pauses, with the same 0.06 s sound fade at each cut.
It is 1080 by 1920 at 30 frames a second, H.264 High with AAC sound in an MP4.
An iPhone HDR original is turned into ordinary BT.709 colours, so the reel does not look washed out in Instagram.
The studio cuts each clip to whole frames, encodes the clips one by one through `REELS_HEAVY` with `REELS_ENCODER`, then joins them without encoding again.
When the cut shows inserts, one more pass lays the pictures over the joined file and copies its sound as it is.
A bar shows how much of the reel is encoded.
«Остановить сборку» stops a waiting or running build, ends its ffmpeg and removes the half-built parts, and the last finished reel stays.
The build waits while the computer hears another video, because the studio runs one heavy job at a time.
The originals stay untouched.

## Skin colour across videos

Before it encodes, the build measures the skin colour of each video in the cut, on the home computer and without the chat model.
It reads up to 15 frames with a face from the preview, spread over the video.
In each frame it takes a box of cheeks and nose under the eyes from the gaze samples.
The skin colour is the median red, green and blue of the pixels of all boxes.
The first video of the cut with a face, in cut order, keeps its colour.
Each other video gets a gain per channel that brings its skin colour to that one, between 0.8 and 1.25.
A video with no face in its gaze samples keeps its colour.
For each joined pair of videos, the build saves two pictures of their first join, before and after the gain.
The «Внешность» stage shows them side by side under the skin and eye trial.

The stage plays the built file and offers «Скачать».
On an iPhone, save the downloaded file to «Фото», and the Instagram reel screen finds it there.
After a change of the cut, the stage says the file no longer matches the cut, and «Собрать заново» builds it again.
A server restart forgets a build in progress, and the person presses the button again.

## The skin and eye trial

The «Внешность» stage holds the edits to how the speaker looks.
Its «Сделать пробу» tries a retouch on the first 20 s of the cut, on the home computer.
The trial runs only when the person presses that button, and a reel build never runs it.
The studio builds those 20 s the way it builds the reel, but without the skin colour gain, then `tools/gaze/retouch.py` reads them frame by frame.
In each frame, the Face Landmarker model finds the face, and the retouch changes pixels only inside it.
It evens the skin tone and lightens the eye whites, and it draws no new frame.
Skin evening removes small tone steps between fine detail and broad shading, so pores, the nose and the cheekbones stay.
Eye lightening lifts and whitens only the light pixels of each eye outside the iris.
The stage shows a close-up of the face before and after, and a clip with the original on the left and the retouch on the right.
It also shows how long the retouch of the 20 s took and how long a minute of video would take.
The trial waits in the same queue as the other heavy jobs, and a new trial replaces the last one.
The close-up comes from the first frame with a face from 3 s on.
Without such a frame the trial fails, and the last trial stays.

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
«Посмотреть» plays 1.5 s before the join and 1.5 s after it, as the reel plays it.
Any answer takes the place off the count:

- «Выровнять» enlarges the picture after the join so the eyes sit where they were before it.
- «Обрезать» cuts the frames at the join where the eyes are off the camera.
- «Оставить как есть» keeps the join as it is.

The cut takes picture only over silence and never cuts into a word.
Before the join it stops at the end of the last word, and after the join at the start of the next word.
Each place says how many seconds it can cut, or names the word that keeps the eyes down.
A place with nothing to cut offers no «Обрезать».

The zoom only enlarges and moves the picture inside its own edges, so no black band shows.
It enlarges by at most 15 %, and a place that needs more offers no «Выровнять».
A place whose eyes already sit on one line offers no «Выровнять».
The zoom holds until the next join, so the picture does not jump back in the middle of a block.
Once a join is aligned, «Как было» plays the same seconds without the zoom.
The page shows the zoom at once, and the built reel crops the same window from the original.
The zoom needs the frame shape of the measured video, which the gaze measure writes as `aspect`.
Until a gaze file holds it, the place says the studio is still measuring.
The answer is kept in `timeline.json` with the two ends of the join, so a change of the cut that moves the join opens it again.
The studio re-measures by itself, in the background, a video whose gaze file holds no head positions or no `aspect`.
This runs on the home computer and does not ask the chat model.
When the person has attached pictures in the chat, each place also offers «Закрыть картинкой».
It shows the chosen picture from 1 s before the join to 1.5 s after it, and takes the place off the count.

## Inserts

An insert shows a picture or a screenshot the person attached in the chat over the video while a phrase is said.
The chat model chooses the phrase by its meaning and writes it to `inserts.json`, as the reels-inserts skill says.
The studio leaves out an insert with a repeated id, a picture that is not in `attached/`, or word numbers the transcript does not hold, and the page says how many it left out.
An insert covers the words of its phrase that the cut plays, and at least 2 s.
Two inserts never stand at once: the later one starts where the earlier one ends, and one left shorter than 1 s is dropped.

A picture at least 1.3 times as tall as it is wide fills the whole frame.
Any other picture stands as a card with a 12 px white border, as large as fits the text box of the reels-safe-area skill, in the middle of it.
The picture fades in and out over 0.3 s and grows by 6 % while it stands.
The voice and the video sound go on under it.

The row of blocks shows each insert as a mark under the blocks it covers, and the mark plays it.
The «Паузы и склейки» stage lists every insert as a place to check, with its picture, its words and the reason the model gave.
«Посмотреть» plays 1 s before the insert, the insert and 1 s after it, with the picture over the player as the reel shows it.
«Оставить» keeps it, «Заменить» puts another attached picture in its place, and «Убрать» takes it out of the reel.
Each answer takes the place off the count, and `timeline.json` keeps it by the insert id.

## Files

Each video folder holds these next to `plan.json`:

| Path | What it holds |
| --- | --- |
| `gaze/<video>.json` | One sample per 0.2 s: `camera`, `away` or `hidden`, and where the eyes are and the face height, as shares of the frame height, and the frame shape as `aspect` |
| `gaze/<video>.txt` | The share of looks into the camera for each stretch of speech, which the chat model reads |
| `blocks.json` | The blocks and their takes, written by the chat model |
| `inserts.json` | The pictures to show over phrases, written by the chat model |
| `timeline.json` | The order of the blocks, the deleted blocks, the chosen takes, the removed pauses, the returned pauses and the answers to the places to check and to the inserts |
| `reel/reel-<stamp>.mp4` | The published reel video, named by its build time |
| `reel/reel-<stamp>-join-<n>-before.jpg`, `reel/reel-<stamp>-join-<n>-after.jpg` | The join of a pair of videos before and after the colour gain |
| `reel/reel.json` | The build time, the video file it published, the parts and the inserts it holds, so the stage can tell whether the cut changed since, and the skin colour and gain of each video |
| `retouch/trial.json` | The time of the last skin and eye trial, the seconds it retouched and the seconds that took |
| `retouch/before.jpg`, `retouch/after.jpg` | The face close-up of the trial before and after |
| `retouch/compare.mp4` | The 20 s of the trial with the original on the left and the retouch on the right |
| `gathered.json` | The heard videos and the settled gaze the studio last asked the chat model to gather blocks from, with a failed mark, the hash of the `blocks.json` the failed attempt saw, and the hash of the `blocks.json` it last shortened pauses for |
