---
name: reels-style
description: How to pick the look of text on a Reels video from a style profile, its colours, fonts and templates, and the format of texts.json. Use when choosing how a title, a subtitle or a key thought looks, when the person asks about colours or fonts, before naming a template in plan.md and before writing texts.json.
---

# Style of text on the video

A style is not part of the studio.
Each style is a profile, one folder under [../../brands/](../../brands/), and its `profile.md` holds the colours, the fonts and the templates.

## Pick the profile

1. Read [../../brands/azalia/profile.md](../../brands/azalia/profile.md), the only profile until a video names its own.
1. Take colours, fonts and templates from that file and add no others.

## Rules for every profile

- One template on screen at a time.
- Name a template in the plan by the name the profile gives it.
- Shorten a text that breaks the limit of its template, and show the person the short version.
- Write on-screen text in Russian with «ёлочки» quotes and without a full stop at the end of a title.
- Tell the person when a text is close to its limit.

## Subtitles

The studio draws the subtitles by itself from the words the reel keeps, one word at a time.
Never write them to a file.

## texts.json

Write every title and key thought of the plan to `texts.json`, with the same words the plan quotes.

```json
{
  "texts": [
    {
      "id": "fifty-songs",
      "video": "IMG_0002.MOV",
      "from": 12,
      "to": 19,
      "lines": [
        { "text": "В 2026 году", "accent": false },
        { "text": "50 песен", "accent": true }
      ]
    }
  ]
}
```

- `id` is a short Latin name that stays the same for the same text every time you write the file.
- `video` is the file name from `source/`, exactly as written there.
- `from` and `to` are the word numbers of the first and last word of the phrase the text stands over.
- `lines` are the lines from top to bottom, at most three, and `accent` marks the line in the accent face.
  Give a key thought one accent line, the short point of it.
- The text stays at least two and a half seconds, and a later text starts where an earlier one ends.
- Write the whole file again on every change, as valid JSON and nothing else.
