import { expect, test } from "bun:test"
import { lastFrameOf, partArgs } from "../../src/server/media-commands.ts"
import { colourJoins, coloursOf, gainTo, skinCrop, skinOf, skinSamples } from "../../src/server/skin.ts"
import { colourNote } from "../../src/web/reel.ts"

const filterOf = (args: ReadonlyArray<string>): string => args[args.indexOf("-vf") + 1] ?? ""

test("the skin colour is the median of each channel, not the mean a bright highlight drags up", () => {
  const pixels = new Uint8Array([10, 20, 30, 200, 100, 50, 100, 60, 40])
  expect(skinOf([pixels])).toEqual({ r: 100, g: 60, b: 40 })
})

test("the median counts the pixels of every sample, not of the first one only", () => {
  expect(skinOf([new Uint8Array([10, 10, 10]), new Uint8Array([90, 90, 90, 90, 90, 90])])).toEqual({ r: 90, g: 90, b: 90 })
})

test("no pixel or a black channel gives no skin colour instead of a gain divided by zero", () => {
  expect(skinOf([])).toBeUndefined()
  expect(skinOf([new Uint8Array([120, 0, 80])])).toBeUndefined()
})

test("the gain brings a channel to the first video and stops at 1.25 up and 0.8 down instead of any ratio", () => {
  expect(gainTo({ r: 200, g: 150, b: 100 }, { r: 100, g: 150, b: 125 })).toEqual({ r: 1.25, g: 1, b: 0.8 })
  expect(gainTo({ r: 220, g: 180, b: 160 }, { r: 200, g: 180, b: 160 })).toEqual({ r: 1.1, g: 1, b: 1 })
})

test("the first measured video is the one the later ones are brought to, and a video with no face keeps its colour", () => {
  const colours = coloursOf([
    { video: "a.mov", skin: undefined },
    { video: "b.mov", skin: { r: 200, g: 160, b: 140 } },
    { video: "c.mov", skin: { r: 160, g: 160, b: 140 } }
  ])
  expect(colours).toEqual([
    { video: "a.mov", state: "unmeasured" },
    { video: "b.mov", state: "reference", skin: { r: 200, g: 160, b: 140 } },
    { video: "c.mov", state: "matched", skin: { r: 160, g: 160, b: 140 }, gain: { r: 1.25, g: 1, b: 1 } }
  ])
})

test("the skin box spans the cheeks and nose under the eyes, in shares of the frame height", () => {
  expect(skinCrop({ x: 0.3, y: 0.4, size: 0.3 })).toBe("crop=w=0.1800*ih:h=0.0600*ih:x=0.2100*ih:y=0.4300*ih")
})

test("skin samples are spread over the frames with a face, not taken from frames where it is hidden", () => {
  const head = { x: 0.3, y: 0.4, size: 0.3 }
  const gaze = { step: 0.2, samples: [], heads: [null, head, head, null, head, head, null, head] }
  expect(skinSamples(gaze, 2).map((sample) => sample.time)).toEqual([0.4, 1])
  expect(skinSamples({ step: 0.2, samples: [] }, 5)).toEqual([])
})

const part = (video: string, start: number) => ({ video, start, frames: 30 })

test("each pair of videos shows its first join once, not every time the cut returns to it", () => {
  const parts = [part("a", 0), part("b", 1), part("a", 2), part("b", 3), part("c", 4)]
  expect(colourJoins(parts)).toEqual([{ end: part("a", 0), start: part("b", 1) }, { end: part("b", 3), start: part("c", 4) }])
  expect(colourJoins([part("a", 0), part("a", 5)])).toEqual([])
})

test("the picture before a join takes the last frame of the part, not the frame after it", () => {
  expect(lastFrameOf({ video: "a", start: 1, frames: 30 })).toBeCloseTo(1 + 29 / 30, 6)
})

test("a matched video is scaled per channel in RGB, and the first video is encoded as before", () => {
  const one = { video: "b.mov", start: 0, frames: 30 }
  const matched = filterOf(partArgs("b.mov", one, { hdr: false, gain: { r: 1.1, g: 1, b: 0.9 } }, "libx264", "p.mov"))
  expect(matched).toContain("colorchannelmixer=rr=1.1000:gg=1.0000:bb=0.9000")
  expect(matched.indexOf("colorchannelmixer")).toBeLessThan(matched.indexOf("crop=1080:1920"))
  expect(filterOf(partArgs("a.mov", one, { hdr: false, gain: undefined }, "libx264", "p.mov"))).not.toContain("colorchannelmixer")
})

test("the colour note speaks only when a video was matched or had no face, not for a reel of one video", () => {
  expect(colourNote({ joins: 0, matched: 0, unmeasured: 0 })).toBeUndefined()
  expect(colourNote({ joins: 1, matched: 1, unmeasured: 0 })).toContain("подогнала остальные видео к первому")
  expect(colourNote({ joins: 0, matched: 0, unmeasured: 1 })).toBe("Студия не нашла лицо хотя бы в одном видео, и цвет этого видео остался как есть.")
})
