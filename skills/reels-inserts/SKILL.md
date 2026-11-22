---
name: reels-inserts
description: How to place the person's pictures and screenshots over the phrases of the reel, and the format of inserts.json. Use when the person attaches a picture or a screenshot, asks to show a picture over a phrase, or asks to move, replace or remove an insert, and before writing inserts.json.
---

# Inserts from the person's pictures

An insert shows a picture over the video while a phrase is said.
The voice goes on under it, and the studio fades the picture in and out.
A tall picture, such as a phone screenshot, fills the whole frame.
A wide or square picture stands as a card with a white border in the upper part of the frame, above the speaker's face.
A still picture moves slowly closer while it stands.
The studio decides the shape, the fade and the movement, so never ask the person about them.

## Order of work

1. List `attached/` and read `attached-views/<file name>/look.json` and the picture views of every picture and screenshot.
   Only pictures and screenshots can be inserts now. A video, a document or a sound cannot.
2. Read `blocks.json` and the transcript of every video the blocks name.
3. For each picture, find the phrase whose meaning the picture shows: the thing named, the document quoted, the message read out.
   Choose the phrase by meaning, not by a shared word.
   Choose it inside a take that the reel plays, the first take of its block unless `timeline.json` shows another chosen.
4. Write every insert to `inserts.json`.
5. Tell the person in the chat, for each picture, the words it stands over and why, and that the stage «Паузы и склейки» lists every insert to check.
   When a picture fits no phrase, say so and leave it out.

## inserts.json

```json
{
  "inserts": [
    {
      "id": "court-letter",
      "picture": "IMG_8123.PNG",
      "video": "IMG_0002.MOV",
      "from": 41,
      "to": 52,
      "reason": "Письмо из суда, о котором она говорит"
    }
  ]
}
```

- `id` is a short Latin name that stays the same for the same insert every time you write the file, because the page keeps the person's choices by it.
- `picture` is the file name from `attached/`, exactly as written there.
- `video` is the file name from `source/`, exactly as written there.
- `from` and `to` are the word numbers of the first and last word of the phrase in the transcript of that video.
- `reason` is one short Russian sentence that says what the picture shows for this phrase.
  Never put a number or a file name in it.
- Write the whole file again on every change, as valid JSON and nothing else.

## Rules

- Cover a phrase of at least two seconds. The studio stretches a shorter one to two seconds.
- Never let two inserts cover the same words. When they meet, the studio starts the later one where the earlier one ends.
- Leave the first phrase of the reel uncovered, so the viewer sees the speaker first.
- Use each picture once, unless the person asks for more.

## What the person does on the page

The page shows every insert as a mark on the row of blocks and as a place to check.
The person watches it, keeps it, replaces its picture with another attached picture, or removes it.
The person can also cover a join where the head jumps with a picture.
You never write those choices. `timeline.json` holds them.
When the person asks in the chat to replace or remove an insert, say that the buttons next to the insert on the page do it.
When the person asks to move an insert to other words, change `from` and `to` and keep the `id`.
