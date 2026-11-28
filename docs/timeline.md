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
The take list scrolls without moving the player or the tabs.
The pause and place lists scroll with the stage.
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
Once the blocks are written, the page shows the take ranked first in every block the person has not chosen, and the studio shortens every pause of the shown takes to the seconds of the pause rule, except the pauses the person returned.
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
The subtitle row shows the words of those takes, and each word can be corrected by typing over it.
A correction stays with its original word and appears in another take of the same block only when that word occurs once in each take.
If more than one correction matches the same word, the other take keeps its transcript spelling.
The player shows the corrected words over the picture as the reel plays.
Each preview holds a key frame every half second.
The studio re-encodes a preview made with the old key frame distance by itself in the background.
The old preview stays playable until the new one is complete.
A removed pause leaves the seconds of the pause rule in its place, 0.2 s by default.
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
For a source wider than 9:16, the studio centres the crop on the median horizontal face position and keeps it inside the source edges.
Without a measured face or frame shape, it crops the middle.
The page uses the same face window, and join zooms move inside that window.
The build keeps one crop window per video for all its parts and colour-comparison pictures.
The saved reel records those windows.
If measurements change a window, the file no longer matches the cut.
A file with no recorded windows also needs a rebuild.
An iPhone HDR original is turned into ordinary BT.709 colours, so the reel does not look washed out in Instagram.
The studio cuts each clip to whole frames, encodes the clips one by one through `REELS_HEAVY` with `REELS_ENCODER`, then joins them without encoding again.
When the person turned the sound of a clip insert on, the studio mixes the clip's sound under the voice of the joined file.
The studio measures each part on its own and gives it one gain that brings it to -14 LUFS.
So the gaps and word endings inside a part are not lifted.
A part shorter than 1.2 s is measured played over until it fills 1.2 s, because ebur128 reads nothing under one 0.4 s block.
The gain moves from one part's value to the next only inside the two 0.06 s fades at their join.
The sound there is near silence.
One more constant gain over the whole reel hits -14 LUFS, and a limiter keeps the true peak under -1.5 dBTP.
The build makes one file for each app chosen in the brief.
When the cut shows inserts or approved on-screen text, one more pass per app lays them over the levelled file.
That pass copies the sound as it is.
The studio draws each spoken word as a single word subtitle and the titles and key thoughts of texts.json in that pass.
The subtitles carry the person's corrections, and they take the look the person picked, as «The subtitle look» below says.
Each pass places the texts in the box of its app, so a text never sits under that app's buttons.
The studio draws a long subtitle word or a name plate smaller to fit the box of the app.
A key thought that leaves the box stops the build.
With nothing to lay over, every app gets the same levelled file.
The joined file before levelling stays beside the reel as `before-<stamp>.mp4`.
The download always serves the levelled file.
A bar follows the parts, the levelling, the inserts and the text.
«Остановить сборку» stops a waiting or running build, ends its ffmpeg and removes the half-built parts, and the last finished reel stays.
The build waits while the computer hears another video, because the studio runs one heavy job at a time.
The originals stay untouched.

## Sound in the montage

After each change of the cut, the studio checks the sound of the cut on the home computer, without the picture.
It cuts the sound of each clip from the original video and levels it with the same gain curve and limiter as the build.
When the sound of a clip insert is on, the check mixes it under the voice as the build does.
The check waits while another heavy job runs, and a failed check waits for the next change of the cut.
Under the player, a line names the verdict of that check in the words of the «Готовый ролик» stage.
So the owner knows the sound before the build and the download.
The line opens to the same notes on jumps, average loudness and peaks.
While the check runs, the line says so with its share done.
The montage plays each clip with the gain the build gives that moment, through a limiter at −2.5 dBFS.
So a quiet part sounds as loud as it does in the built file.
A take outside the cut plays with the gain of the nearest clip from the same video.

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
The stage names the measured loudness of the built file with a plain verdict word.
It says when the peaks stay clean.
A chart shows the 3 s short-term loudness over time before and after the levelling, with the target as a line and the jumps marked.
The first ~1.5 s of the chart has no short-term reading, because the 3 s window has not filled yet.
The numbers sit under the «Цифры» toggle.
When at least two parts run 1 s or more, the quietest and the loudest passages each offer «До» and «После», so the owner can hear the change.
A reel built before the levelling keeps playing.
The stage asks for a rebuild to level its sound.
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
The stage shows a close-up of the face before and after.
It also shows a clip with the original on the left and the retouch on the right.
It also shows how long the retouch of the 20 s took and how long a minute of video would take.
The trial waits in the same queue as the other heavy jobs, and a new trial replaces the last one.
The close-up comes from the first frame with a face from 3 s on, the `CLOSE_UP_FROM_SECONDS` constant that the studio passes to `retouch.py` as `--close-up-from`.
Without such a frame the trial fails, and the last trial stays.
When the trial part of the cut is 3 s or shorter, the studio fails the trial before it renders anything and names the short cut as the cause.
When the cut is longer and `retouch.py` exits with 66 because no face shows after 3 s, the studio names that as the cause.
Both causes are logged as info, not as an error, and the «Оформление» step shows each as its own text.

## The face in the reel

The trial shows one face close-up as a single frame, with the left side before and the right side after.
The person drags the line between them.
Holding «Держите, чтобы увидеть до» shows the whole frame before, and «Крупнее» zooms to the face.
Under the trial, the switch «Выровнять кожу и белки глаз в готовом ролике» sets how the face goes into the reel.
Each reel starts with the switch off, and the studio keeps no choice from one reel for the next.
The switch turns on only after a trial, so the person sets it after comparing the close-ups.
A line under the switch says whether the built file already has the chosen face.
When it does not, the button «Собрать ролик с выровненным лицом» or «Собрать ролик заново» opens the «Готовый ролик» stage and starts the build there.
With the switch off, the build is the same as without the setting, and no step touches the frames.
With the switch on, the build runs `tools/gaze/retouch.py` on the whole levelled reel.
It runs before the inserts and the text go on, so they stay as they are.
That retouch changes pixels only inside the face, the same way the trial does.
The «Готовый ролик» stage names the chosen face above its build button and the face of the built file in the file facts.
After a new choice it says the file no longer matches.

## The subtitle look

The «Оформление» step sets how the subtitles look, in `looks.json`.
The person picks one of three look cards and one of two sizes, «Обычные» or «Крупные».

| Look | What the subtitles are |
| --- | --- |
| «Ваш стиль» | The serif words with a black outline of the style profile, the default |
| «Жёлтая плашка» | Dark sans words on a yellow plate |
| «Как в примере» | The font, colour, outline, plate and capitals the chat model took from an example reel in `example.json` |

«Как в примере» opens only while `example.json` exists, and the server refuses to save it before.
When the example is removed later, the build falls back to the style profile.
The card lists the lines the chat model took from the example, and the plan quotes the same lines.
The title place of the example, `top` or `middle`, moves the titles and key thoughts: `middle` centres them in the clear zone of the box of the app, not on the face.
The preview on the step draws the same look the build burns.

The name plate is a line such as a name and a job, up to 40 characters.
When it is switched on and has text, the build shows it for the first 4 s of the second part, or of the cut when it has one part.
It stands low in the clear zone, above the subtitles.
The studio measures the ink of every look and of the plate before the render, and draws a word or the plate smaller when it leaves the clear zone.
The sans look uses Onest Bold, which `tools/fonts/onest_bold.py` makes from the page fonts.

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
It enlarges by at most 15 %, or more when the original has the pixels: up to its shown width over the 1080 px of the reel.
A place that needs more offers no «Выровнять».
A place whose eyes already sit on one line offers no «Выровнять».
«Выровнять» is on from the start at every place that offers it, so such a place counts as answered until the person picks another answer.
The zoom holds until the next join, so the picture does not jump back in the middle of a block.
Once a join is aligned, «Как было» plays the same seconds without the zoom.
The page shows the zoom at once, and the built reel crops the same window from the original.
The zoom needs the frame shape of the measured video, which the gaze measure writes as `aspect`.
After the measure the studio adds the shown height of the original as `height`, read with ffprobe, and without it the limit stays at 15 %.
Until a gaze file holds it, the place says the studio is still measuring.
The answer is kept in `timeline.json` with the two ends of the join, so a change of the cut that moves the join opens it again.
The studio re-measures by itself, in the background, a video whose gaze file holds no head positions or no `aspect`.
This runs on the home computer and does not ask the chat model.
When the person has attached pictures in the chat, each place also offers «Закрыть картинкой».
It shows the chosen picture from 1 s before the join to 1.5 s after it, and takes the place off the count.

## Inserts

An insert shows a file the person attached in the chat or to the task over the video while a phrase is said: a picture or a screenshot, a video clip, or one page of a PDF.
The text of a law counts as a PDF: when the brief names a page on the internet, the chat model saves it by its address, the studio prints it as a PDF to `attached/` and lists it in `web-pages.json`, and the model places it as it places any PDF.
The chat model chooses the phrase by its meaning and writes it to `inserts.json`, as the reels-inserts skill says.
The studio leaves out an insert with a repeated id, a file that is not in `attached/`, that the person removed from the task and no chat message or saved web page names, or that is not of its kind, a quote that the text of its PDF page does not hold, or word numbers the transcript does not hold, and the page says how many it left out.
The quote is matched without regard to case, ё, line breaks and hyphens.
An insert covers the words of its phrase that the cut plays, and at least 2 s.
Two inserts never stand at once: the later one starts where the earlier one ends, and one left shorter than 1 s is dropped.

A picture at least 1.3 times as tall as it is wide fills the whole frame.
Any other picture stands as a card with a 12 px white border, as large as fits the text box of the reels-safe-area skill, in the middle of it.
The picture fades in and out over 0.3 s and grows by 6 % while it stands.
The voice and the video sound go on under it.

A clip plays from its `start` for as long as its phrase, and holds its last frame when it is shorter.
A clip is silent until the person turns its sound on, and it does not grow.
A PDF page is rendered 1800 px wide, its quoted lines are marked in yellow, and it is cropped around the marked lines as wide as the text of the page, at most square and no taller than the text, so it stands as a card.
The marked page and the clip preview the page plays are kept in `attached-views/<file>/`.
The studio opens a page from the internet only on the computer it runs on and refuses an address on the home network.
The insert card of a saved page names the site with a link, and the licence the page states or that it states none.
The card, the part title, the subtitle words, each key thought and each removed part warn when they name an article that the saved law pages do not hold.

The row of blocks shows each insert as a mark under the blocks it covers, and the mark plays it.
The «Паузы и склейки» stage lists every insert as a place to check, with what it shows, its words and the reason the model gave.
«Посмотреть» plays 1 s before the insert, the insert and 1 s after it, with the insert over the player as the reel shows it.
«Оставить» keeps it, «Со звуком» keeps a clip with its sound, «Заменить» puts another attached picture in its place, and «Убрать» takes it out of the reel.
Each answer takes the place off the count, and `timeline.json` keeps it by the insert id.

## Zooms on key words

The chat model marks the key words of the reel by their meaning and writes them to `zooms.json`, as the reels-plan skill says.
On each, the picture pushes in slowly around the eyes, so they stay on one line, then pulls back over 0.3 s.
The push grows over the key words and lasts at least 0.6 s.
A strong zoom enlarges by 15 % and a soft one by 7 %.
With a join zoom in the same part, the two together stay within the join zoom limit.
Two pushes of one video never add up: the earlier one pulls back fully before the later one starts.
When that leaves the earlier one less than 0.3 s to push in, the studio leaves it out, and the step does not list it.

The step «Монтаж» lists the zooms of each part under «Приближение», with their words and time.
«Нет», «Мягкое» and «Сильное» set one zoom, and `timeline.json` keeps the answer by the zoom id.
A zoom with no answer follows the zoom rule.
«Смотреть» plays 1.5 s before the words and 3 s after them, with the push.
The page and the built reel use the same push.

## Doubtful words

The subtitles show each word as the studio heard it, so a misheard law term, name or number goes on screen as heard.
The recognizer gives each word a share of how sure it is, which `transcripts/<video>.json` keeps as `sure`.
A low share alone marks many words the recognizer heard right, so the studio marks a word by itself only in three cases:

| Word | Marked below |
| --- | --- |
| Any word | 0.2 |
| A word with a digit | 0.6 |
| A word with a capital letter that does not open a sentence | 0.5 |

`transcripts/<video>.txt` names the marked word numbers in its third line, so the chat model reads them.
The chat model proposes the right word for a marked word by its meaning and writes it to `doubts.json`, as the reels-plan skill says.
The studio leaves out a doubt whose word is not marked, or whose fix is empty or the same as the heard word.
So a model that corrects what the speaker said clearly cannot change the subtitles.
A video heard before the recognizer gave the share has no marked words.

The «Монтаж» step asks about every doubtful word the cut plays, above the words of its part, and «Вопросы» walks to it.
The word is marked in the words of the part until it is answered.
«Послушать» plays 1 s before the word, the word and 1 s after it.
«Взять» puts the proposed word into the subtitles, and «Оставить» keeps the word as heard.
Both are kept as a subtitle correction in `timeline.json`, so a word the person corrects in the words of the part counts as answered too.

## Key thoughts

The chat model writes the key thoughts to `texts.json`, each tied to the words of one phrase.
The «Паузы и склейки» stage lists every key thought of `texts.json` under «Ключевые мысли», with its lines and, when the studio knows them, its words and its time in the cut.
The step «Монтаж» lists the first shown text of the first part as «Заголовок» and the rest as «Мысль 1», «Мысль 2» and so on, and the stage list uses the same names.
Each shown text on that step is a place to check.
It shows its lines, its words and its time, and «Посмотреть» plays 1 s before it, the text and 1 s after it.
«Оставить» keeps the wording, «Исправить» opens a field for each line to retype it, and «Убрать» takes the text out of the reel.
`timeline.json` keeps each answer by the text id, and a retyped text keeps its new lines and shows the proposed ones under them.
A line holds at most 20 characters, or 8 in an accent line, and a text holds at most 3 lines.
The page does not save a longer or empty wording, and the server refuses it with «Надпись не помещается на экране».
The built file carries the retyped lines or leaves out a removed text.

A key thought the reel cannot show stays in the list, marked «не встанет в ролик», with its reason:

| Reason | What the list says |
| --- | --- |
| Its video is not in the project | The video is not in the project, so the studio does not know where to show it |
| Its word numbers are not in the transcript, or the first comes after the last | The video text has no such words |
| The cut removed every word of its phrase | The phrase is not in the reel now |
| It has no line with text | There is nothing to show |
| The person removed it | The person removed it from the reel |
| An earlier thought in time already stands for the whole phrase | The list names that thought and says it holds the screen |

When `texts.json` does not read, the list says so.

## Rules

A rule is a setting the studio applies to the whole reel at once.
Two rules exist:

- The pause rule: the seconds of silence a shortened pause keeps, from 0 to 0.5 s, and 0.2 s when the reel has no value.
- The zoom rule: the strength of the zooms on key words, `off`, `soft` or `full`, and `full` when the reel has no value.

The step «Монтаж» lists the rules under «Правила» as short phrases, such as «пауза остаётся 0,2 с».
A step with no rule of its own shows no list.
The person changes a rule by writing in the chat, such as «оставляй паузы подлиннее» or «медленнее», and the chat model writes `rules.json`.
The step then shows the change, every pause it moved, every zoom it moved that the step lists, and one button that returns the old values.
A zoom the person set by hand keeps its answer.
When one reply changed both rules, the button returns both.
The pin next to a rule keeps its value for the next reels, and a new reel starts with the pinned values.
A pinned rule follows a chat change and its undo.
Unpinning keeps the value in the current reel and drops it from the next ones.
The pin and the undo button are off while a chat reply streams.
The studio adds a note with the current rule values to each message the person sends, since the person can return a rule on the page and the earlier replies do not show it.

## Files

Each video folder holds these next to `plan.json`:

| Path | What it holds |
| --- | --- |
| `gaze/<video>.json` | One sample per 0.2 s: `camera`, `away` or `hidden`, and where the eyes are and the face height, as shares of the frame height, and the frame shape as `aspect`, and the shown height of the original as `height` |
| `gaze/<video>.txt` | The share of looks into the camera for each stretch of speech, which the chat model reads |
| `blocks.json` | The blocks and their takes, written by the chat model |
| `inserts.json` | The pictures, clips and PDF pages to show over phrases, written by the chat model |
| `doubts.json` | The proposed right words for the doubtful words, written by the chat model |
| `texts.json` | The titles and key thoughts to show over phrases, written by the chat model |
| `web-pages.json` | The file, address, licence and time of each page saved from the internet. Only the studio writes it |
| `zooms.json` | The key words to zoom on, each with an id, its video and its word numbers, written by the chat model |
| `rules.json` | The rules of the reel, `pause` and `zoom`. A new reel starts with the pinned rules, and the chat model may write it |
| `rules-change.json` | The last rule change made from the chat, with the value before it, so one press can undo it. Only the studio writes it |
| `timeline.json` | The order of the blocks, the deleted blocks, the chosen takes, the removed pauses, the returned pauses, the subtitle corrections and the answers to the places to check, to the inserts, to the texts and to the zooms |
| `reel/reel-<stamp>-<app>.mp4` | The published reel video of one app, `instagram`, `youtube` or `tiktok`, named by its build time |
| `reel/reel-<stamp>-join-<n>-before.jpg`, `reel/reel-<stamp>-join-<n>-after.jpg` | The join of a pair of videos before and after the colour gain |
| `reel/before-<stamp>.mp4` | The joined reel before levelling, named by its build time |
| `reel/reel.json` | The build time, the video file it published for each app, the parts with their pushes, the crop window of each video, the inserts, a hash of the subtitles, key thoughts, subtitle look, title place and name plate as the person answered them, the face setting, the skin colour and gain of each video, and the measured loudness it holds, so the stage can tell whether the cut changed since |
| `reel/sound.json` | The parts of the last checked cut with the heard clip inserts, its measured loudness before and after levelling, and the gain of each part over its source time, which the montage plays |
| `reel/sound-work/` | The sound of each clip and the levelled sound while a check runs, removed when it ends |
| `posts.json` | The caption and hashtags the person wrote for each app on «Ролики», so choosing an app again brings its text back |
| `looks.json` | The face setting of the reel, `off` or `light`, the subtitle look, `brand`, `plate` or `example`, with its size, `normal` or `large`, and the name plate, shown or not, with its text, written when the person picks them |
| `example.json` | What the chat model took from an example reel the person attached: up to three lines for the person, the subtitle font, colour, outline, plate and capitals, and the title place, `top` or `middle` |
| `retouch/trial.json` | The time of the last skin and eye trial, the seconds it retouched and the seconds that took |
| `retouch/before.jpg`, `retouch/after.jpg` | The face close-up of the trial before and after |
| `retouch/compare.mp4` | The 20 s of the trial with the original on the left and the retouch on the right |
| `gathered.json` | The heard videos and the settled gaze the studio last asked the chat model to gather blocks from, with a failed mark, the hash of the `blocks.json` the failed attempt saw, and the hash of the `blocks.json` it last shortened pauses for |
