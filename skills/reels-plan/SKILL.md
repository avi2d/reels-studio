---
name: reels-plan
description: The order of work on one Reels video, plan first and video second, and the format of plan.json. Use at the start of every conversation about a video, when the person asks to cut, shorten, caption or assemble a video, and before writing or changing plan.md or plan.json.
---

# Plan first, video second

The person in the chat is a lawyer who films vertical videos for Instagram, not a developer.
Answer in Russian, in plain words, without file formats, commands or model names.

## The rule

The studio changes no video until the person agrees with the plan.
The original in `source/` is never changed, renamed or deleted.

## Order of work

1. Look at what the project holds: list `source/` and `transcripts/`, and read `plan.md` and `plan.json` when they exist.
2. When `source/` is empty, ask the person to upload the video on this page and stop.
3. When a video has no transcript yet, say that the studio is still listening to it and ask the person to write again in a few minutes.
When a video is listed as the studio could not hear it, say that the person can press «Попробовать ещё раз» under the video to have the studio listen to it again.
4. Read the transcript of every video before you say anything about its content.
   Never ask the person to retype or retell what is said in a video.
5. Ask what must stay in the video, when the person has not said.
   Ask one question at a time.
6. Write the plan to `plan.md` in Russian, and the pieces to remove to `plan.json`.
7. Show the plan in the chat: quote the words you remove and say why, in the order they are spoken.
   Say that the page now shows the removed words struck through, and that the player under them skips these words.
8. Change both files when the person asks, and show the plan again.
9. End every answer about a video with its ideas and the next steps: what else could be removed or kept, and what the person can do now.
10. When the person agrees, say that the plan is saved and that the studio cannot cut the video yet.

## The transcript

`transcripts/<video name>.txt` holds one stretch of speech per line, with its start and end in seconds.
Each word is written as `number:word`.
A line `(pause 2.4 s)` marks silence of a second or more.
A repeated take shows as the same sentence said twice or more: keep the last complete take unless the person names another.

## plan.json

```json
{
  "videos": [
    {
      "video": "IMG_0001.MOV",
      "remove": [
        { "from": 12, "to": 24, "reason": "повтор" }
      ]
    }
  ]
}
```

- `video` is the file name from `source/`, exactly as written there.
- `from` and `to` are word numbers from the transcript, and both words are removed with everything between them.
- Remove whole phrases, so that every remaining sentence starts and ends where the person started and ended it.
- `reason` is two or three Russian words: «повтор», «оговорка», «не по теме».
- List every video of the project, with an empty `remove` for a video that stays whole.
- Write the whole file again on every change, as valid JSON and nothing else.

## What plan.md holds

- The topic of the video in one sentence.
- The target length in seconds, between 30 and 60 unless the person names another.
- The parts in order: title, each thought, ending.
  Each part names its text on screen and its template from the reels-style skill.
- What to remove and why.
- Open questions for the person.

Check every text on screen against the reels-safe-area skill before showing the plan.

## What this studio does and cannot do yet

It hears every uploaded video and shows its words on the page.
It shows the words of the plan struck through, and its player skips them, so the person hears the video as the plan leaves it.
It cannot yet cut a video, add subtitles, titles or templates, join several videos into one, crop a video or send a file anywhere.
Say so in one sentence when the person asks for any of these.
Never say that a video is cut or ready.
