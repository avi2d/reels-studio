import { expect, test } from "bun:test"
import { filterPath, inkOf } from "../../src/server/captions.ts"

test("a folder name with a comma, a quote, a colon or brackets cannot end the filter or start an option", () => {
  expect(filterPath("/a b/it's: [x];y,z")).toBe(String.raw`/a b/it\\\'s\\: \[x\]\;y\,z`)
})

test("the ink box counts its right and bottom edges as outside, so a box at the frame edge is not cut short by a pixel", () => {
  const line = "[Parsed_bbox_1 @ 0x70cb9c004800] n:1 pts:1 pts_time:0.2 x1:478 x2:602 y1:1621 y2:1666 w:125 h:46 crop=125:46:478:1621 drawbox=478:1621:125:46"
  expect(inkOf(`noise\n${line}\n`)).toEqual([{ at: 0.2, rect: { left: 478, top: 1621, right: 603, bottom: 1667 } }])
})
