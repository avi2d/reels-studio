import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunFileSystem } from "@effect/platform-bun"
import { Effect } from "effect"
import { readSoundCheck, soundKeyOf } from "../../src/server/sound-check.ts"
import { NO_CAPTIONS } from "../../src/shared/captions.ts"
import { sameParts } from "../../src/server/media-commands.ts"
import type { ReelJob } from "../../src/shared/reel.ts"
import type { Clip } from "../../src/shared/timeline.ts"
import type { Shown } from "../../src/shared/inserts.ts"
import { NOISE_DEFAULT } from "../../src/shared/noise.ts"

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
    await writeFile(`${dir}/reel/sound.json`, JSON.stringify({ ...record, key: soundKeyOf(record.parts, [], NOISE_DEFAULT) }))
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const read = (dir: string, clips: ReadonlyArray<Clip>, job: ReelJob = { state: "idle" }, inserts: ReadonlyArray<Shown> = []) =>
  Effect.runPromise(readSoundCheck(dir, { clips, inserts, captions: NO_CAPTIONS }, job).pipe(Effect.provide(BunFileSystem.layer)))

test("sound queue keys ignore every crop axis without making built video crops equivalent", () => {
  const original = record.parts
  const bare = [{ video: "a.mov", start: 1, frames: 30 }]
  for (const frame of [{ scale: 1.2, left: 0, top: 0 }, { scale: 1, left: 10, top: 0 }, { scale: 1, left: 0, top: 0.1 }]) {
    const reframed = [{ video: "a.mov", start: 1, frames: 30, frame }]
    expect(soundKeyOf(reframed, [], NOISE_DEFAULT)).toBe(soundKeyOf(original, [], NOISE_DEFAULT))
    expect(sameParts(reframed, original)).toBe(false)
  }
  expect(soundKeyOf(bare, [], NOISE_DEFAULT)).toBe(soundKeyOf(original, [], NOISE_DEFAULT))
  const second = { video: "b.mov", start: 3, frames: 60 }
  expect(soundKeyOf([...original, second], [], NOISE_DEFAULT)).not.toBe(soundKeyOf([second, ...original], [], NOISE_DEFAULT))
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

const insert = {
  id: "walk", start: 0, end: 1,
  visual: { kind: "clip", file: "walk.mov", start: 2, sound: true }
} satisfies Shown

test("turning clip sound on stales a voice-only verdict instead of reusing its levels", async () => {
  await withRecord(async (dir) => {
    expect((await read(dir, [clip], { state: "idle" }, [insert])).heard?.fresh).toBe(false)
    expect((await read(dir, [clip], { state: "idle" }, [{ ...insert, visual: { ...insert.visual, sound: false } }])).heard?.fresh).toBe(true)
  })
})

test("heard file, seek, placement, removal, and replacement changes stale the saved mix instead of keeping its verdict", async () => {
  await withRecord(async (dir) => {
    await writeFile(`${dir}/reel/sound.json`, JSON.stringify({ ...record, key: soundKeyOf(record.parts, [insert], NOISE_DEFAULT) }))
    expect((await read(dir, [clip], { state: "idle" }, [insert])).heard?.fresh).toBe(true)
    const changed: ReadonlyArray<ReadonlyArray<Shown>> = [
      [{ ...insert, visual: { ...insert.visual, file: "other.mov" } }],
      [{ ...insert, visual: { ...insert.visual, start: 3 } }],
      [{ ...insert, start: 0.2 }],
      [{ ...insert, end: 0.8 }],
      [{ ...insert, visual: { ...insert.visual, sound: false } }],
      [{ ...insert, visual: { kind: "picture", file: "walk.jpg" } }],
      [{ ...insert, visual: { kind: "page", file: "contract.pdf", page: 1, quote: "Rent" } }],
      []
    ]
    for (const inserts of changed) {
      expect((await read(dir, [clip], { state: "idle" }, inserts)).heard?.fresh).toBe(false)
    }
  })
})

test("an empty cut hides old verdicts and old jobs instead of claiming sound is being checked", async () => {
  await withRecord(async (dir) => {
    for (const job of [{ state: "idle" }, { state: "failed" }, { state: "waiting" }, { state: "running", done: 0.5 }] as const) {
      expect(await read(dir, [], job)).toEqual({ job: { state: "idle" } })
    }
  })
})
