import { expect, test } from "bun:test"
import { styleOf } from "../../src/web/margins.ts"
import { fitsArea, FRAME, PLATFORMS, textAreaOf, ZONES } from "../../src/shared/zones.ts"

const GTA_HEADLINE = { left: 93, top: 120, right: 711, bottom: 311 }
const GTA_SUBTITLE = { left: 473, top: 1629, right: 603, bottom: 1669 }

test("the players are Instagram, Instagram ads, YouTube Shorts and TikTok, with ordinary Instagram first", () => {
  expect(PLATFORMS).toEqual(["Instagram", "Instagram, реклама", "YouTube Shorts", "TikTok"])
})

test("the Instagram ads box is Meta's 14% top, 35% bottom and 6% sides, not the ordinary Reels box", () => {
  expect(textAreaOf("Instagram, реклама").box).toEqual({ left: 65, top: 269, right: 1015, bottom: 1248 })
})

test("the ordinary Instagram box reaches from y 115 to y 1690, not only from 269 to 1248", () => {
  expect(textAreaOf("Instagram").box).toEqual({ left: 65, top: 115, right: 1015, bottom: 1690 })
})

test("the reference headline and subtitle fit the ordinary Instagram box but not the ads box", () => {
  for (const ink of [GTA_HEADLINE, GTA_SUBTITLE]) {
    expect(fitsArea(ink, textAreaOf("Instagram"))).toBe(true)
    expect(fitsArea(ink, textAreaOf("Instagram, реклама"))).toBe(false)
  }
})

test("a word inside the box that reaches under the button column does not fit", () => {
  const area = textAreaOf("Instagram")
  expect(fitsArea({ left: 700, top: 1400, right: 960, bottom: 1450 }, area)).toBe(false)
  expect(fitsArea({ left: 700, top: 900, right: 960, bottom: 950 }, area)).toBe(true)
})

test("the bands reach the overlay as shares of their own side, the top over the height and the left over the width, not swapped", () => {
  expect(styleOf("TikTok")).toBe("--top: 12.50%; --bottom: 34.38%; --left: 11.11%; --right: 11.11%; --buttons-left: 72.22%; --buttons-top: 43.75%")
})

test("the YouTube Shorts box is Google's 288 top, 672 bottom, 48 left and 192 right, not the old guessed 10% and 20%", () => {
  expect(textAreaOf("YouTube Shorts")).toEqual({ box: { left: 48, top: 288, right: 888, bottom: 1248 }, buttons: undefined })
})

test("the TikTok box is TikTok's 160 top, 440 bottom and 80 sides of 720 by 1280, scaled by 1.5, with the 120 wide button column from 720 above the bottom", () => {
  expect(textAreaOf("TikTok")).toEqual({ box: { left: 120, top: 240, right: 960, bottom: 1260 }, buttons: { left: 780, top: 840, right: 960, bottom: 1260 } })
})

test("no player's bands cover the whole picture", () => {
  for (const platform of PLATFORMS) {
    const { top, bottom, left, right, buttons } = ZONES[platform].bands
    expect(top + bottom).toBeLessThan(FRAME.height)
    expect(left + right).toBeLessThan(FRAME.width)
    expect(buttons === undefined || buttons.left > left).toBe(true)
  }
})
