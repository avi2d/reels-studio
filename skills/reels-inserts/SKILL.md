---
name: reels-inserts
description: How to place the person's pictures, screenshots, video clips and PDF pages over the phrases of the reel, and the format of inserts.json. Use when the person attaches a picture, a screenshot, a video clip or a PDF, asks to show one of them over a phrase, or asks to move, replace or remove an insert, and before writing inserts.json.
---

# Inserts from the person's files

An insert shows one of the person's files over the video while a phrase is said: a picture, a short video clip, or one page of a PDF.
The voice goes on under it, and the studio fades the insert in and out.
A tall insert, such as a phone screenshot or a vertical clip, fills the whole frame.
A wide or square insert stands as a card with a white border in the upper part of the frame, above the speaker's face.
A still picture moves slowly closer while it stands.
A clip plays without its own sound. The person can turn its sound on, on the page.
A PDF page stands as a card with the quoted line marked in yellow, cropped around that line so it can be read.
The studio decides the shape, the fade, the movement and the crop, so never ask the person about them.

## Order of work

1. List `attached/` and read `attached-views/<file name>/look.json` and the views of every picture, video and PDF.
   For a PDF, read `attached-views/<file name>/text.txt`, which holds the text of every page under `Page N:`.
   A sound file or a document that is not a PDF cannot be an insert.
2. Read `blocks.json` and the transcript of every video the blocks name.
3. For each file, find the phrase whose meaning it shows: the thing named, the document quoted, the message read out.
   For a PDF, also find the line on its page that the phrase is about.
   Choose the phrase by meaning, not by a shared word.
   Choose it inside a take that the reel plays, the first take of its block unless `timeline.json` shows another chosen.
4. Write every insert to `inserts.json`.
5. Tell the person in the chat, for each file, the words it stands over and why, and that the stage «Паузы и склейки» lists every insert to check.
   For a PDF, also say which line is marked. For a clip, say it plays without sound and that the page can turn the sound on.
   When a file fits no phrase, say so and leave it out.

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
    },
    {
      "id": "salon-visit",
      "clip": "IMG_8130.MOV",
      "start": 2.5,
      "video": "IMG_0002.MOV",
      "from": 60,
      "to": 71,
      "reason": "Салон, где она внесла аванс"
    },
    {
      "id": "contract-clause",
      "document": "contract.pdf",
      "page": 2,
      "quote": "Предоплата не возвращается при любом отказе Заказчика",
      "video": "IMG_0002.MOV",
      "from": 80,
      "to": 94,
      "reason": "Пункт договора, о котором она говорит"
    }
  ]
}
```

Each insert names exactly one of `picture`, `clip` or `document`.

- `id` is a short Latin name that stays the same for the same insert every time you write the file, because the page keeps the person's choices by it.
- `picture`, `clip` and `document` are the file name from `attached/`, exactly as written there.
- `start` is the second of the clip where the insert starts playing. Leave it out to play from the start. Choose the moment that shows what the phrase says.
  The clip plays for as long as the phrase, and holds its last frame when it is shorter.
- `page` is the page number of the PDF, counted from 1 as in `text.txt`.
- `quote` is the line to mark, copied word for word from that page in `text.txt`, one sentence or less.
  The studio leaves out an insert whose quote is not on its page, so never shorten, fix or translate it.
- `video` is the file name from `source/`, exactly as written there.
- `from` and `to` are the word numbers of the first and last word of the phrase in the transcript of that video.
- `reason` is one short Russian sentence that says what the picture shows for this phrase.
  Never put a number or a file name in it.
- Write the whole file again on every change, as valid JSON and nothing else.

## Rules

- Cover a phrase of at least two seconds. The studio stretches a shorter one to two seconds.
- Never let two inserts cover the same words. When they meet, the studio starts the later one where the earlier one ends.
- Leave the first phrase of the reel uncovered, so the viewer sees the speaker first.
- Use each file once, unless the person asks for more.
- Choose a clip of the person's own life, not a clip of the speaker talking, since the speaker's voice goes on under it.

## What the person does on the page

The page shows every insert as a mark on the row of blocks and as a place to check.
The person watches it, keeps it, turns the sound of a clip on, replaces it with another attached picture, or removes it.
The person can also cover a join where the head jumps with a picture.
You never write those choices. `timeline.json` holds them.
When the person asks in the chat to replace or remove an insert, say that the buttons next to the insert on the page do it.
When the person asks to move an insert to other words, change `from` and `to` and keep the `id`.
