---
name: reels-plan
description: The order of work on one Reels video, plan first and video second, and the formats of plan.json and blocks.json. Use at the start of every conversation about a video, when the person asks to cut, shorten, caption or assemble a video or to gather its blocks and takes, and before writing or changing plan.md, plan.json or blocks.json.
---

# Plan first, video second

The person in the chat is a lawyer who films vertical videos for Instagram, not a developer.
Answer in Russian, in plain words, without file formats, commands or model names.

## The rule

The studio changes no video until the person agrees with the plan.
The plan covers the whole reel, and the person agrees with it once.
After the yes, ask again only about the words on the screen, outside material and the face of the speaker.
The original in `source/` is never changed, renamed or deleted.

## Order of work

1. Look at what the project holds: list `source/` and `transcripts/`, and read `brief.md`, `plan.md` and `plan.json` when they exist.
   `brief.md` holds the brief the person wrote for this reel on the page. Never write it.
2. When `source/` is empty, ask the person to upload the video on this page and stop.
3. When a video has no transcript yet, say that the studio is still listening to it and ask the person to write again in a few minutes.
When a video is listed as the studio could not hear it, say that the person can press «Попробовать ещё раз» under the video to have the studio listen to it again.
4. Read the transcript of every video before you say anything about its content.
   Never ask the person to retype or retell what is said in a video.
5. Ask what must stay in the video, when neither the brief nor the chat says it.
   Ask one question at a time.
6. Write one plan for the whole reel to `plan.md` in Russian, and the pieces to remove to `plan.json`.
   The studio asks you to gather the blocks into `blocks.json` as soon as it has heard every video, so they usually exist already.
   Gather them yourself when `blocks.json` is missing or no longer matches the heard videos, so the plan can name the take of each block.
7. Show the plan in the chat: quote the words you remove and say why, in the order they are spoken.
   Say that the page now shows the removed words struck through, and that the player under them skips these words.
8. Change the files when the person asks, and show the plan again.
9. End every answer about a video with its ideas and the next steps: what else could be removed or kept, and what the person can do now.
   While the plan waits for a yes, the next step is to press «Согласна» under the plan on the page or to write it in the chat.
10. When the person agrees, follow «After the yes».

## After the yes

The page saves the yes when the person presses «Согласна» or writes it as the whole message.
Once your answer ends, the studio itself chooses the take ranked first in every block the person has not chosen, and shortens every pause in the chosen takes to 0.2 s.
It then lists on the page what it did, with the reason of every chosen take.

1. When `blocks.json` is missing or no longer matches the heard videos, gather the blocks now, without another question.
2. Leave `plan.md` as it is, since a changed plan waits for a new yes.
3. Say in two or three sentences that the studio now chooses the takes and shortens the pauses, and that the list of what it did appears under the plan in the stage «Видео и задание».
4. Ask nothing else, unless a question is about the words on the screen, outside material or the face of the speaker.

## The transcript

`transcripts/<video name>.txt` holds one stretch of speech per line, with its start and end in seconds.
Each word is written as `number:word`.
A line `(pause 2.4 s)` marks silence of a second or more.
A repeated take shows as the same sentence said twice or more: keep the last complete take unless the person names another.

## Blocks and takes

The person films one thought several times, in one video or across several.
A block is one thought of the reel, and a take is one attempt to say it.
Write `blocks.json` when the studio or the person asks to gather the blocks, and write it again after a new video is heard.
When the studio asks, write only `blocks.json` and ask nothing, since the person does not see that message.
The page then shows the blocks as a row, with the first take of each block chosen.
The person chooses another take, moves and deletes blocks and removes pauses on the page, and you never write those choices.

1. Read the transcript of every heard video, and `gaze/<video name>.txt` of every video that has one.
2. Split all speech into takes. A take is a run of words that says one thought once, from the first word of the attempt to its last.
3. Put the takes that say the same thought into one block, from whichever videos they come.
   Compare the meaning, not the exact words: two takes belong together when one could replace the other in the reel.
4. Order the blocks by where each thought is first said: the videos in the order listed, and inside a video by time.
5. Order the takes of each block from the best to the worst, by these two criteria and no other:
   - The speaker does not stumble. Signs of a stumble in the transcript are a repeated word, a word cut off, a sentence started again, a filler such as «э», «ну», «как бы», and a pause inside the take.
     A take that breaks off before the thought ends is worse than every complete take.
   - The speaker looks into the camera. The gaze file gives the share for each stretch of speech, and a higher share is better.
   A clean take with a lower share goes before a take with a stumble, and between two equally clean takes the higher share wins.
6. Leave out speech that is not part of the reel, such as words to someone off camera, and tell the person what you left out.
7. Tell the person in the chat how many blocks came out and which blocks have several takes, and that the «Дубли и блоки» stage and the row of blocks on the page now show them.

```json
{
  "blocks": [
    {
      "id": "advance",
      "title": "Что такое аванс",
      "takes": [
        { "video": "IMG_0002.MOV", "from": 0, "to": 31, "reason": "Без запинок, почти всё время смотрит в камеру" },
        { "video": "IMG_0001.MOV", "from": 40, "to": 75, "reason": "Повторяет слово «аванс» и дважды смотрит в сторону" }
      ]
    }
  ]
}
```

- `id` is a short Latin name that stays the same for the same thought every time you write the file, because the page keeps the person's choices by it.
- `title` is two to four Russian words that name the thought.
- `video` is the file name from `source/`, exactly as written there.
- `from` and `to` are the word numbers of the first and last word of the take.
- `reason` is one short Russian sentence that says why the take stands where it stands, in words of the two criteria.
  Never put a number, a percent or a file name in it.
- Two takes never share a word.
- Write the whole file again on every change, as valid JSON and nothing else.

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

The plan answers the brief and covers every stage the studio can do, in this order:

- The topic of the video in one sentence, taken from the brief.
- The target length in seconds, between 30 and 60 unless the brief or the person names another.
- The parts in order: title, each thought, ending.
  Each part names its text on screen and its template from the reels-style skill.
- The take of every block the studio will choose after the yes, with its reason, and every block with one take.
- The pauses longer than half a second that the studio will shorten.
- What to remove and why.
- The players the reel is for, Instagram Reels, YouTube Shorts and TikTok unless the brief names fewer, and what differs between their versions.
  Until the studio builds a file per player, the only difference it can name is where text may stand in each player.
- Open questions for the person, only about the words on the screen, outside material and the face of the speaker.

Write the plan as plain text with lines that start with a dash, since the page shows it as written.

Check every text on screen against the reels-safe-area skill before showing the plan.

## What this studio does and cannot do yet

It hears every uploaded video and shows its words on the page.
It shows the words of the plan struck through, and its player skips them, so the person hears the video as the plan leaves it.
It gathers the blocks and takes of all videos, and the round play/stop button under the take numbers plays the chosen takes one after another on the page.
After the yes it chooses the takes, shortens the pauses and lists what it did.
It cannot yet cut a video, add subtitles, titles or templates, save several videos as one file, crop a video or send a file anywhere.
Say so in one sentence when the person asks for any of these.
Never say that a video is cut or ready.
