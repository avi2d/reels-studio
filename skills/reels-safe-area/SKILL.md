---
name: reels-safe-area
description: The parts of a 1080 by 1920 frame that the Instagram, YouTube Shorts and TikTok players cover, and the box where text stays visible. Use when placing any text or a face in the frame, when checking a plan, and when the person asks why a text cannot go higher or lower.
---

# Player zones

The frame is 1080 by 1920 pixels.
The player covers a strip at the top, the name and the caption at the bottom, a column of buttons on the right, and on a tall phone both sides.
[src/shared/zones.ts](../../src/shared/zones.ts) holds the numbers the studio checks, and these tables repeat them.
The studio checks the text in each app’s file against that app’s box.

## How the numbers were taken

Each player has an ordinary zone and a zone for ads.
The ordinary zones come from each app's own App Store screenshots of its player on an iPhone, 1284 by 2778 or 1242 by 2688.
The picture fills the iPhone screen, so the frame is scaled to the screen height and its sides are cut off.
Each number is the edge of the nearest control, mapped back to the 1080 by 1920 frame, to about 10 pixels.
The ads zones are the numbers Meta, Google and TikTok publish for ads.
The page shows one zone at a time, the one picked under «Площадка».

## Instagram

| Part | Pixels | Source |
| --- | --- | --- |
| Top | 200, the lower edge of the «Reels Friends» bar | [Instagram on the App Store](https://apps.apple.com/us/app/instagram/id389801252), the Reels screenshot |
| Bottom | 410, the upper edge of the name and caption | the same |
| Left and right | 100 each, cut off by the screen | the same |
| Button column | x 865 to 980, y 980 to 1510 | the same |

The box for text starts at the point 100, 200 and ends at x 980 and y 1510.
Meta publishes no numbers for an ordinary reel.

## Instagram, реклама

| Part | Share | Pixels | Source |
| --- | --- | --- | --- |
| Top | 14% | 269 | Meta Business Help, text overlays and the Safe Zone |
| Bottom | 35% | 672 | the same |
| Left and right | 6% each | 65 each | the same |
| Button column | 21% wide, from 60% of the height down | x 853 to 1015, y 1152 to 1248 | the same |

Use this box only when the person says the reel goes to ads.

## YouTube Shorts

| Part | Pixels | Source |
| --- | --- | --- |
| Top | 185, the lower edge of the search and camera icons | [YouTube on the App Store](https://apps.apple.com/us/app/youtube/id544007664), the Shorts screenshot |
| Bottom | 200, the upper edge of the title | the same |
| Left and right | 55 each, cut off by the screen | the same |
| Button column | x 910 to 1025, y 1095 to 1720 | the same |

The box for text starts at the point 55, 185 and ends at x 1025 and y 1720.

## YouTube Shorts, реклама

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
| Top | 200, the lower edge of «Following» and «For You» | [TikTok on the App Store](https://apps.apple.com/us/app/tiktok-videos-shop-live/id835599320), the For You screenshots |
| Bottom | 260, the upper edge of a three-line caption | the same |
| Left and right | 45 each, cut off by the screen | the same |
| Button column | x 880 to 1035, y 790 to 1660 | the same |

The box for text starts at the point 45, 200 and ends at x 1035 and y 1660.

## TikTok, реклама

| Part | Pixels | Source |
| --- | --- | --- |
| Top | 240 | [TikTok Ads Manager, In-Feed ads, the In-Feed Standard safe zone file](https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads) |
| Bottom | 660 | the same |
| Left and right | 120 each | the same |
| Button column | x 780 to 960, y 840 to 1260 | the same |

The file draws a 720 by 1280 frame, and these are its numbers times 1.5.

## The rule

A text that leaves the box stops the render.
Never offer to let a text stick out, even by a few pixels.
Move the text, break the line or shorten it instead, and tell the person what changed.

## Where each template goes

- Subtitles: one word at a time, centred, the ink ends 24 pixels above y 1510.
- Key thought and title: from the upper left of the box, the ink of the first line starts 8 pixels below y 200 and keeps 28 pixels from x 100.

## Other crops

- The feed shows 4:5, rows 285 to 1635.
- The profile grid shows 3:4, rows 240 to 1680.

A key thought at the top of the box starts above row 285, so the feed and the grid cut it.
Put the words that must show in the grid lower than row 285.

## The face

Keep the eyes and the mouth inside the box and out of the button column.
When the person describes a frame where the face sits low or far right, say that the buttons may cover it.
