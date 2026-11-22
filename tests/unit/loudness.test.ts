import { expect, test } from "bun:test"
import { levelOf, normalizeArgs, passagesOf, type Level } from "../../src/server/media-commands.ts"

const report = (input_i: string) => ({ input_i, input_tp: "-3.10", input_lra: "6.40", input_thresh: "-34.00", target_offset: "0.32" })

const level = (lufs: number): Level => ({ lufs, measured: { lufs, tp: -3, lra: 6, thresh: -34, offset: 0 } })
const silent: Level = { lufs: -70, measured: undefined }

const part = (frames: number) => ({ video: "a.mov", start: 0, frames })

test("a part with no measurable loudness reads as the -70 LUFS gate floor, so it gets no gain", () => {
  expect(levelOf(report("-inf"))).toEqual({ lufs: -70, measured: undefined })
})

test("a quiet part is normalised by its own measured loudness to the -14 LUFS target, not kept under a loud part", () => {
  const args = normalizeArgs("quiet.mov", levelOf(report("-51.85")), "even.mov")
  const filter = args[args.indexOf("-af") + 1] ?? ""
  expect(filter).toContain("I=-14")
  expect(filter).toContain("measured_I=-51.85")
  expect(filter).toContain("linear=true")
})

test("the quiet and the loud passage are the quietest and the loudest parts, each at its own seconds in the reel", () => {
  const spans = passagesOf([part(30), part(60), part(45)], [level(-30), level(-10), level(-50)])
  expect(spans).toEqual([{ name: "quiet", from: 3, to: 4.5 }, { name: "loud", from: 1, to: 3 }])
})

test("a silent part is never the quiet passage", () => {
  const spans = passagesOf([part(60), part(60), part(60)], [silent, level(-30), level(-10)])
  expect(spans).toEqual([{ name: "quiet", from: 2, to: 4 }, { name: "loud", from: 4, to: 6 }])
})

test("a part under one second is never a passage, even when it is the quietest", () => {
  const spans = passagesOf([part(20), part(30), part(60)], [level(-60), level(-30), level(-10)])
  expect(spans[0]?.name).toBe("quiet")
  expect(spans[0]?.from).toBeCloseTo(20 / 30)
  expect(spans[0]?.to).toBeCloseTo(50 / 30)
})
