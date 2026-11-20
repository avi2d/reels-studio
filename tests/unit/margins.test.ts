import { expect, test } from "bun:test"
import { COVER_PERCENT, PLATFORMS, styleOf } from "../../src/web/margins.ts"

test("the three players are Instagram, YouTube Shorts and TikTok", () => {
  expect(PLATFORMS).toEqual(["Instagram", "YouTube Shorts", "TikTok"])
})

test("Instagram's top band is 14% and its bottom band 35%, not the other way round", () => {
  expect(COVER_PERCENT.Instagram).toEqual({ top: 14, bottom: 35, left: 6, right: 6 })
})

test("Instagram's bands reach the overlay with the top share as --top, not swapped with the bottom share", () => {
  expect(styleOf("Instagram")).toBe("--top: 14%; --bottom: 35%; --left: 6%; --right: 6%")
})

test("no player's top and bottom bands, or its side bands, cover the whole picture", () => {
  for (const platform of PLATFORMS) {
    const cover = COVER_PERCENT[platform]
    expect(cover.top + cover.bottom).toBeLessThan(100)
    expect(cover.left + cover.right).toBeLessThan(100)
  }
})
