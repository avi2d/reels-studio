---
name: reels-safe-area
description: The parts of a 1080 by 1920 frame that the Instagram, YouTube Shorts and TikTok players cover, and the box where text stays visible. Use when placing any text or a face in the frame, when checking a plan, and when the person asks why a text cannot go higher or lower.
---

# Player zones

The frame is 1080 by 1920 pixels.
The player covers a strip at the top, the name and the caption at the bottom, and a column of buttons on the right.
[src/shared/zones.ts](../../src/shared/zones.ts) holds the numbers the studio checks, and this table repeats them.

## An ordinary reel

| Part | Share | Pixels | Source |
| --- | --- | --- | --- |
| Top | 6% | 115 | Instagram web player, 22 November 2026, and Azalia's reference reels |
| Bottom | 12% | 230 | the same |
| Left and right | 6% each | 65 each | the same |
| Button column | 13% wide, from 55% of the height down | x 940 to 1080, y 1056 to 1690 | the same |

The box for text starts at the point 65, 115 and ends at x 1015 and y 1690.
No text enters the button column, the corner from x 940 and y 1056.

Meta publishes no numbers for an ordinary reel, so these come from measuring the player.

## A reel for ads

| Part | Share | Pixels | Source |
| --- | --- | --- | --- |
| Top | 14% | 269 | Meta Business Help, text overlays and the Safe Zone |
| Bottom | 35% | 672 | the same |
| Left and right | 6% each | 65 each | the same |
| Button column | 21% wide, from 60% of the height down | x 853 to 1080, y 1152 to 1248 | the same |

Use this box only when the person says the reel goes to ads.
On the page it is the platform «Instagram, реклама».

## YouTube Shorts

| Part | Pixels | Source |
| --- | --- | --- |
| Top | 288 | [Google Ads Help, safe zones for vertical video ads on YouTube](https://support.google.com/google-ads/answer/9128498) |
| Bottom | 672 | the same |
| Left | 48 | the same |
| Right, the whole height | 192 | the same |

The box for text starts at the point 48, 288 and ends at x 888 and y 1248.

## TikTok

| Part | Pixels | Source |
| --- | --- | --- |
| Top | 240 | [TikTok Ads Manager, In-Feed ads, the In-Feed Standard safe zone file](https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads) |
| Bottom | 660 | the same |
| Left and right | 120 each | the same |
| Button column | x 780 to 960, y 840 to 1260 | the same |

The file draws a 720 by 1280 frame, and these are its numbers times 1.5.
The box for text starts at the point 120, 240 and ends at x 960 and y 1260.

Google and TikTok publish these boxes for ads and none for ordinary videos, so the studio takes them for every video on those players.

## The rule

A text that leaves the box stops the render.
Never offer to let a text stick out, even by a few pixels.
Move the text, break the line or shorten it instead, and tell the person what changed.

## Where each template goes

- Subtitles: one word at a time, centred, the ink ends 24 pixels above y 1690.
- Key thought and title: from the upper left of the box, the ink of the first line starts 8 pixels below y 115 and keeps 28 pixels from the left edge.

## Other crops

- The feed shows 4:5, rows 285 to 1635.
- The profile grid shows 3:4, rows 240 to 1680.

A key thought in the upper part of the box sits above row 285, so the feed and the grid cut it.
Put the words that must show in the grid lower than row 285.

## The face

Keep the eyes and the mouth inside the box and out of the button column.
When the person describes a frame where the face sits low or far right, say that the buttons may cover it.
