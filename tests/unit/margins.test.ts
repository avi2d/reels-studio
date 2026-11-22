import { expect, test } from "bun:test"
import { styleOf } from "../../src/web/margins.ts"
import { fitsArea, PLATFORMS, textAreaOf, ZONES } from "../../src/shared/zones.ts"

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

test("the bands reach the overlay with the top share as --top, not swapped with the bottom share", () => {
  expect(styleOf("Instagram")).toBe("--top: 6%; --bottom: 12%; --left: 6%; --right: 6%; --buttons-width: 13%; --buttons-from: 55%")
})

test("no player's bands cover the whole picture", () => {
  for (const platform of PLATFORMS) {
    const { top, bottom, left, right, buttons } = ZONES[platform].bands
    expect(top + bottom).toBeLessThan(100)
    expect(left + right).toBeLessThan(100)
    expect(left + buttons.width).toBeLessThan(100)
  }
})
