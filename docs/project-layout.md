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
| `src/shared/plan.ts` | The transcript and plan formats and the sum of span lengths, used by the server and the page |
| `src/shared/timeline.ts` | The formats of the gaze samples, the blocks, the takes and the person's choices, and the spans the montage plays |
| `src/shared/framing.ts` | The zoom that keeps the eyes on one line across a join, used by the page and the reel build |
| `src/shared/zoom-plan.ts` | The format of `zooms.json`, the zoom strengths and the push a part plays |
| `src/shared/zooms.ts` | Where each zoom on a key word stands in the cut, its strength and the push curve, used by the page and the reel build |
| `src/shared/joins.ts` | The places to check at joins and the cuts at answered places, used by the page |
| `src/shared/face.ts` | The face setting of the reel, off or light, and the two causes of a trial that finds no face, used by the server and the page |
| `src/shared/looks.ts` | The formats of `looks.json`, of the subtitle look and size, of the name plate and of `example.json`, and the look the page gets, used by the server and the page |
| `src/shared/retouch.ts` | The state of the skin and eye trial, the time a minute of video takes and the second from which the trial looks for a face, used by the server and the page |
| `src/shared/inserts.ts` | Where each insert stands in the cut, its shape, and what the page and the build show of it: a picture, a clip or a PDF page |
| `src/shared/zones.ts` | The pixels of the frame each player covers and the box where text stays visible |
| `src/shared/subtitles.ts` | When each spoken word of the cut shows as a one-word subtitle |
| `src/shared/doubts-file.ts` | The format of `doubts.json` and the read doubts the page gets, used by the server and the page |
| `src/shared/doubts.ts` | The words the recognizer was unsure of, the proposed fix of each and the answer the person gave, used by the server and the page |
| `src/shared/texts.ts` | The format of `texts.json` and the read key thoughts the page gets, the person's answer to a text, and the line length limits, used by the server and the page |
| `src/shared/captions.ts` | The key thoughts of `texts.json` in the cut with the person's answers, the reason each dropped one is not shown, the look of the subtitles, the name plate and the title place, and the subtitle file libass draws |
| `src/server/captions.ts` | Reads `texts.json` for the page and the approved texts for the build, shrinks long subtitle words and the name plate, and measures the ink against the box before the build |
| `src/server/looks.ts` | Reads and writes `looks.json` and reads `example.json` |
| `src/server/looks-api.ts` | The routes that read and save the looks of a reel |
| `src/server/approval.ts` | Reads the saved yes and checks it against the plan and the on-screen texts |
| `src/shared/rules.ts` | The format of `rules.json` and of the rule change, the studio's own values, and the rules the page lists with the pauses and zooms a change moved, used by the server and the page |
| `src/server/rules.ts` | Reads and writes the rules of a reel, the pinned rules and the last chat change, and undoes it |
| `src/shared/reel.ts` | The state of a reel build and of the built files, one per chosen app, used by the server and the page |
| `src/shared/posts.ts` | The format of `posts.json`, the caption and hashtags a person writes for each app, used by the server and the page |
| `src/shared/gather.ts` | When the studio asks the chat model to gather the blocks by itself |
| `src/shared/brief.ts` | The format of the brief, the apps and files chosen for the task, the plan and the saved yes, and the work the studio does after the yes |
| `src/shared/chat.ts` | The format of a chat message, of the events a streamed reply sends and of the header that names its turn, and the kinds of file a person can attach to it |
| `src/shared/library.ts` | The formats of an uploaded video, of a video offered to a reel from the shared list or another folder, and of a pick, used by the server and the page |
| `src/shared/file-name.ts` | The cleaned name the library stores for an uploaded file, used by the server and the page to tell whether a picked file is already listed |
| `src/shared/project.ts` | The formats of a reel's `project.json`, of the title a person sends to create or rename it, and of the reel the page gets with its one status: created, uploaded or built, used by the server and the page |
| `src/shared/web-pages.ts` | The formats of `web-pages.json` and of the source of a saved page, and the check of the article numbers a phrase names against the articles of a page, used by the server and the page |
| `src/server/web-pages.ts` | Saves a page from the internet as a PDF in `attached/` with its address and licence, through Chrome in `web-page-browser.ts`, which refuses every connection to the home network |
| `src/shared/page.ts` | The addresses of the reel list and of the five steps of a reel, used by the server and the page |
| `tools/transcribe/` | The speech recognizer, a Python script that uv runs |
| `tools/pdf/` | The PDF reader that renders the first pages and takes out the text, and renders one page with the place of each letter for an insert, Python scripts that uv runs |
| `tools/gaze/` | The measure of where the speaker looks and the skin and eye trial, Python scripts that uv runs |
| `tools/fonts/` | The scripts that make Reels Accent from Playfair Display Italic and Onest Bold from the page's Onest fonts, with fontTools |
| `deploy/reels-studio.service` | The systemd user unit that keeps the studio running |
| `src/pi/` | The pi extensions that keep the chat model inside one video folder and give it the tool that saves a web page by its address |
| `src/web/` | The modules the screens share: the API calls, the upload, the montage player and the edits of the cut |
| `src/web/studio/` | The screens at `/`: the reel list, the top bar and the five steps. The reel list shows reels and uploaded takes five to a page and uploads takes, and step 1, «Записи», adds any number of ticked uploaded takes to the reel at once, lists its recordings and plays a recording. Step 2, «План», takes the task, the apps and the task files and shows the plan, and the chat opens from every step with replies that stream and a stop button. Step 3, «Монтаж», edits the parts of the reel, walks through the open questions, doubtful words and the wording of each title and key thought among them, and undoes changes. Step 4, «Оформление», sets the subtitle look, its size and the name plate, sets the face to «Как есть» or «Мягче», which opens after a trial, and shows the colour line and the margins of an app under the preview. The margins choice stays in the browser's `localStorage` per reel and changes only the preview. Step 5, «Ролики», builds one file per chosen app with that app's texts in its zone, with progress and a stop button, keeps the earlier files until a build ends, and reads «Ролики устарели» once the reel changes after the build. A tab per app plays its file, shows its length, size and build time, downloads the file and holds its caption and hashtags with «Скопировать», and «Скачать все» downloads every file. `rules.ts` lists the rules on the step they belong to, with a pin and the undo of a chat change |
| `skills/` | The four skills the chat model reads: plan, style, player zones and inserts |
| `brands/` | One folder per style profile with its colours, fonts and templates, and the font files under `fonts/` |
| `prompts/studio.md` | The system prompt of the chat model |
| `projects/` | One folder per video with the originals, the files attached in the chat or to the task, the chat, the transcripts and the plan, and `.library` with the shared list of uploaded videos and the pinned rules in `rules.json`, kept out of git |
| `tests/unit/` | The unit tests |
| `tests/e2e/browser/` | The browser scenarios and their GitHub Actions runner |
