import { expect, test } from "bun:test"
import { clipFrom, clipSoundArgs, insertArgs, type InsertLayer } from "../../src/server/insert-commands.ts"

const clip = (sound: boolean): InsertLayer =>
  ({ kind: "clip", file: "walk.mov", shape: "fill", width: 1080, height: 1920, start: 4, end: 7, from: 2, hdr: false, sound })

const graphOf = (args: ReadonlyArray<string>): string => args[args.indexOf("-filter_complex") + 1] ?? ""

test("a clip insert left silent adds none of its own sound, so the voice goes to the levelling without a mix pass", () => {
  expect(clipSoundArgs("voice.mp4", [clip(false)], "joined.mp4")).toBeUndefined()
})

test("a clip insert with its sound turned on mixes that sound in from the phrase's start, and does not drop the reel's voice", () => {
  const args = clipSoundArgs("voice.mp4", [clip(true)], "joined.mp4") ?? []
  const graph = graphOf(args)
  expect(graph).toContain("[1:a]")
  expect(graph).toContain("adelay=4000:all=1")
  expect(graph).toContain("[0:a][s0]amix=inputs=2")
  expect(args.slice(args.lastIndexOf("-map"), args.lastIndexOf("-map") + 2)).toEqual(["-map", "[aout]"])
  expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"])
})

for (const sound of [false, true]) {
  test(`the insert pass copies the levelled sound as it is for a clip ${sound ? "heard" : "left silent"}, not mixing it again after the levelling`, () => {
    const args = insertArgs("levelled.mp4", [clip(sound)], "libx264", "out.mp4")
    expect(graphOf(args)).not.toContain("[1:a]")
    expect(args.slice(args.lastIndexOf("-map"), args.lastIndexOf("-map") + 2)).toEqual(["-map", "0:a:0"])
    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual(["-c:a", "copy"])
  })
}

test("a clip planned to start past its own end starts on its last frame, not on a seek that gives no frame at all", () => {
  const from = clipFrom(20, 8)
  expect(from).toBeLessThan(8 - 1 / 24)
  expect(from).toBeGreaterThan(7)
})

test("a clip planned to start inside its length keeps the planned moment, not one moved toward the end", () => {
  expect(clipFrom(2, 8)).toBe(2)
})

test("a clip insert plays from the moment the plan names and lasts only its phrase, not from the clip's first second to its end", () => {
  const args = insertArgs("reel.mp4", [clip(false)], "libx264", "out.mp4")
  const at = args.indexOf("walk.mov")
  expect(args.slice(at - 5, at + 1)).toEqual(["-ss", "2.000", "-t", "3.000", "-i", "walk.mov"])
})

test("a still picture insert still drifts closer, while a clip insert does not zoom over its own motion", () => {
  const still: InsertLayer = { kind: "still", file: "a.png", shape: "fill", width: 1080, height: 1920, start: 4, end: 7 }
  expect(graphOf(insertArgs("reel.mp4", [still], "libx264", "out.mp4"))).toContain("zoompan")
  expect(graphOf(insertArgs("reel.mp4", [clip(false)], "libx264", "out.mp4"))).not.toContain("zoompan")
})
