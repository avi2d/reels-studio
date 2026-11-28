import { PASSING } from "./reel-check-fixtures.ts"
import { expect, test } from "bun:test"
import type { ReelView } from "../../src/shared/reel.ts"
import { headingOf, phaseOf, progressOf, soundLineOf } from "../../src/web/studio/done-model.ts"

const levelling = { before: -14.3, after: { lufs: -14, lra: 1.5, truePeak: -2.5 }, series: { before: [], after: [] }, passages: [] }
const file = (fresh: boolean) => ({ made: "2026-11-28T08:07:30.203Z", seconds: 7.7, size: 8_541_601, fresh, face: "off" as const, levelling })
const view = (job: ReelView["job"], fresh: boolean | undefined, cut = 7.7): ReelView =>
  fresh === undefined ? { job, cut, face: "off", checks: PASSING } : { job, cut, face: "off", checks: PASSING, file: file(fresh) }

test("a file built before the montage changed reads «Ролики устарели», not «Ролики готовы»", () => {
  expect(headingOf(phaseOf(view({ state: "idle" }, false)))).toBe("Ролики устарели")
  expect(headingOf(phaseOf(view({ state: "idle" }, true)))).toBe("Ролики готовы")
})

test("a rebuild keeps the previous file instead of dropping it until the build ends", () => {
  expect(phaseOf(view({ state: "running", done: 0.4 }, true))).toMatchObject({ kind: "building", kept: { made: "2026-11-28T08:07:30.203Z" } })
  expect(headingOf(phaseOf(view({ state: "waiting" }, undefined)))).toBe("Собираю ролики")
})

test("a reel with no part offers nothing to build, not a build button", () => {
  expect(phaseOf(view({ state: "idle" }, undefined, 0))).toEqual({ kind: "empty" })
})

test("a failed build with an earlier file keeps that file on screen with the failure, not an empty step", () => {
  expect(phaseOf(view({ state: "failed" }, true))).toMatchObject({ kind: "built", failed: { state: "failed" } })
})

test("progress rounds down to whole percent, so 37.5% reads 37%, never 38% before the work is done", () => {
  expect(progressOf({ state: "running", done: 0.375 }).text).toBe("37%")
  expect(progressOf({ state: "running", done: 1 }).text).toBe("Сохраняю файл")
})

test("the measured −14.3 to −14.0 LUFS change reads with one decimal, not as −14 to −14", () => {
  expect(soundLineOf(file(true))).toBe("Звук хороший: громкость −14,0\u00a0LUFS, до выравнивания −14,3\u00a0LUFS.")
})
