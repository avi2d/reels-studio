import { expect, test } from "bun:test"
import { styleOf } from "../../src/web/margins.ts"
import { fitsArea, FRAME, PLATFORMS, textAreaOf, ZONES } from "../../src/shared/zones.ts"

const GTA_HEADLINE = { left: 93, top: 120, right: 711, bottom: 311 }
const GTA_SUBTITLE = { left: 473, top: 1629, right: 603, bottom: 1669 }

test("each player has an ordinary zone and an ads zone, with ordinary Instagram first", () => {
  expect(PLATFORMS).toEqual(["Instagram", "Instagram, реклама", "YouTube Shorts", "YouTube Shorts, реклама", "TikTok", "TikTok, реклама"])
})

test("the ordinary Instagram box stops at the iPhone's top bar, caption and cut sides, not at the web player's 115 and 1690", () => {
  expect(textAreaOf("Instagram")).toEqual({ box: { left: 100, top: 200, right: 980, bottom: 1510 }, buttons: { left: 865, top: 980, right: 980, bottom: 1510 } })
})

test("the Instagram ads box is Meta's 14% top, 35% bottom and 6% sides, not the ordinary Reels box", () => {
  expect(textAreaOf("Instagram, реклама").box).toEqual({ left: 65, top: 269, right: 1015, bottom: 1248 })
})

test("the reference headline and subtitle sit under the iPhone's Reels top bar and caption, so they fit no Instagram box", () => {
  for (const ink of [GTA_HEADLINE, GTA_SUBTITLE]) {
    expect(fitsArea(ink, textAreaOf("Instagram"))).toBe(false)
    expect(fitsArea(ink, textAreaOf("Instagram, реклама"))).toBe(false)
  }
})

test("a word inside the box that reaches under the button column does not fit", () => {
  const area = textAreaOf("Instagram")
  expect(fitsArea({ left: 700, top: 1200, right: 900, bottom: 1250 }, area)).toBe(false)
  expect(fitsArea({ left: 700, top: 900, right: 900, bottom: 950 }, area)).toBe(true)
})

test("the ordinary YouTube Shorts and TikTok boxes leave the bottom to the caption only, not to the ads card", () => {
  expect(textAreaOf("YouTube Shorts")).toEqual({ box: { left: 55, top: 185, right: 1025, bottom: 1720 }, buttons: { left: 910, top: 1095, right: 1025, bottom: 1720 } })
  expect(textAreaOf("TikTok")).toEqual({ box: { left: 45, top: 200, right: 1035, bottom: 1660 }, buttons: { left: 880, top: 790, right: 1035, bottom: 1660 } })
})

test("the bands reach the overlay as shares of their own side, the top over the height and the left over the width, not swapped", () => {
  expect(styleOf("TikTok, реклама")).toBe("--top: 12.50%; --bottom: 34.38%; --left: 11.11%; --right: 11.11%; --buttons-left: 72.22%; --buttons-top: 43.75%")
})

test("the YouTube Shorts ads box is Google's 288 top, 672 bottom, 48 left and 192 right, not the old guessed 10% and 20%", () => {
  expect(textAreaOf("YouTube Shorts, реклама")).toEqual({ box: { left: 48, top: 288, right: 888, bottom: 1248 }, buttons: undefined })
})

test("the TikTok ads box is TikTok's 160 top, 440 bottom and 80 sides of 720 by 1280, scaled by 1.5, with the 120 wide button column from 720 above the bottom", () => {
  expect(textAreaOf("TikTok, реклама")).toEqual({ box: { left: 120, top: 240, right: 960, bottom: 1260 }, buttons: { left: 780, top: 840, right: 960, bottom: 1260 } })
})

test("no player's bands cover the whole picture", () => {
  for (const platform of PLATFORMS) {
    const { top, bottom, left, right, buttons } = ZONES[platform].bands
    expect(top + bottom).toBeLessThan(FRAME.height)
    expect(left + right).toBeLessThan(FRAME.width)
    expect(buttons === undefined || buttons.left > left).toBe(true)
  }
})
