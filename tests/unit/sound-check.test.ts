import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect } from "effect"
import { readSoundCheck, soundKeyOf } from "../../src/server/sound-check.ts"
import { sameParts } from "../../src/server/media-commands.ts"
import type { ReelJob } from "../../src/shared/reel.ts"
import type { Clip } from "../../src/shared/timeline.ts"

const unframed = { block: "a", video: "a.mov", start: 1, end: 2 } satisfies Clip
const clip = { ...unframed, frame: { scale: 1, left: 0, top: 0 } } satisfies Clip
const record = {
  parts: [{ video: "a.mov", start: 1, frames: 30, frame: clip.frame }],
  levelling: { before: -30, after: { lufs: -14, lra: 1.2, truePeak: -2.6 }, series: { before: [-30], after: [-14] }, passages: [] },
  gains: [{ video: "a.mov", from: 1, to: 2, gains: [{ time: 1, db: 16 }] }]
}

const withRecord = async (run: (dir: string) => Promise<void>): Promise<void> => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/sound-check-")
  try {
    await mkdir(`${dir}/reel`)
    await writeFile(`${dir}/reel/sound.json`, JSON.stringify(record))
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const read = (dir: string, clips: ReadonlyArray<Clip>, job: ReelJob = { state: "idle" }) =>
  Effect.runPromise(readSoundCheck(dir, { clips }, job).pipe(Effect.provide(BunFileSystem.layer)))

test("sound queue keys ignore every crop axis without making built video crops equivalent", () => {
  const original = record.parts
  const bare = [{ video: "a.mov", start: 1, frames: 30 }]
  for (const frame of [{ scale: 1.2, left: 0, top: 0 }, { scale: 1, left: 10, top: 0 }, { scale: 1, left: 0, top: 0.1 }]) {
    const reframed = [{ video: "a.mov", start: 1, frames: 30, frame }]
    expect(soundKeyOf(reframed)).toBe(soundKeyOf(original))
    expect(sameParts(reframed, original)).toBe(false)
  }
  expect(soundKeyOf(bare)).toBe(soundKeyOf(original))
  const second = { video: "b.mov", start: 3, frames: 60 }
  expect(soundKeyOf([...original, second])).not.toBe(soundKeyOf([second, ...original]))
})

test("crop scale, horizontal position, and vertical position do not stale an unchanged soundtrack", async () => {
  await withRecord(async (dir) => {
    for (const frame of [undefined, { scale: 1.2, left: 0, top: 0 }, { scale: 1, left: 10, top: 0 }, { scale: 1, left: 0, top: 0.1 }]) {
      const clips = [frame === undefined ? unframed : { ...unframed, frame }]
      expect((await read(dir, clips)).heard?.fresh).toBe(true)
    }
  })
})

test("source, start, duration, and part count changes stale sound instead of reusing another cut's verdict", async () => {
  await withRecord(async (dir) => {
    for (const clips of [
      [{ ...clip, video: "b.mov" }],
      [{ ...clip, start: 1.1, end: 2.1 }],
      [{ ...clip, end: 3 }],
      [clip, clip]
    ]) {
      expect((await read(dir, clips)).heard?.fresh).toBe(false)
    }
    expect((await read(dir, [clip])).heard?.fresh).toBe(true)
  })
})

test("an empty cut hides old verdicts and old jobs instead of claiming sound is being checked", async () => {
  await withRecord(async (dir) => {
    for (const job of [{ state: "idle" }, { state: "failed" }, { state: "waiting" }, { state: "running", done: 0.5 }] as const) {
      expect(await read(dir, [], job)).toEqual({ job: { state: "idle" } })
    }
  })
})
