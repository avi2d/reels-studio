import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readReel, reelDownloadAt } from "../../src/server/reel.ts"
import { loudnessPartOf } from "../../src/server/reel-checks.ts"
import { NO_CAPTIONS } from "../../src/shared/captions.ts"
import type { Levelling } from "../../src/shared/reel.ts"
import type { BuildChecks } from "../../src/shared/reel-checks.ts"
import { PASSING } from "./reel-check-fixtures.ts"

const made = "2026-01-01T00:00:00.000Z"
const levelling = {
  before: -15, after: { lufs: -14, lra: 2, truePeak: -2 },
  series: { before: [], after: [] }, passages: []
} satisfies Levelling

const checkAt = (seconds: number): BuildChecks => ({
  texts: PASSING.texts, places: PASSING.places, length: { id: "length", seconds }
})

const read = async (file: { seconds: number; buildChecks?: BuildChecks; loudnessPart?: string; levelling: Levelling }, current: number) => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/reel-download-")
  try {
    await mkdir(`${dir}/reel`)
    const { seconds, ...checks } = file
    await writeFile(`${dir}/reel/reel.json`, JSON.stringify({
      ...checks, made, video: "file.mp4", parts: [{ video: "take.mov", start: 0, frames: seconds * 30 }]
    }))
    await writeFile(`${dir}/reel/file.mp4`, "published")
    const cut = { clips: [{ video: "take.mov", block: "current", start: 0, end: current }], captions: NO_CAPTIONS, inserts: [] }
    return await Effect.runPromise(Effect.all({
      view: readReel(dir, cut, { state: "idle" }, checkAt(current)),
      download: reelDownloadAt(dir, made)
    }).pipe(Effect.provide(BunServices.layer)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("a checked 2:50 file stays downloadable after the current cut grows to 3:10", async () => {
  const { view, download } = await read({ seconds: 170, buildChecks: checkAt(170), levelling }, 190)
  expect(view.file?.fresh).toBe(false)
  expect(view.file?.checks?.length.seconds).toBe(170)
  expect(view.checks.length.seconds).toBe(190)
  expect(download.state).toBe("ready")
})

test("a passing edit does not unlock the download of a legacy 3:30 build", async () => {
  const { view, download } = await read({ seconds: 210, levelling }, 170)
  expect(view.file?.seconds).toBe(210)
  expect(view.file?.checks).toBeUndefined()
  expect(download.state).toBe("closed")
})

test("a loudness jump uses the original block and cannot open a download after that block is moved", async () => {
  const loud = { ...levelling, after: { lufs: -8, lra: 2, truePeak: -2 }, series: { before: [], after: [-14, -14, -8, -8] } }
  const built = [
    { video: "take.mov", block: "opening", start: 0, end: 1 },
    { video: "take.mov", block: "original", start: 1, end: 2 }
  ]
  const part = loudnessPartOf(loud, 2, built)
  expect(part).toBe("original")
  const { view, download } = await read({ seconds: 2, buildChecks: checkAt(2), levelling: loud, loudnessPart: "original" }, 2)
  expect(view.file?.checks?.loudness).toEqual({ id: "loudness", state: "heard", level: "bad", part: "original" })
  expect(download.state).toBe("closed")
})
