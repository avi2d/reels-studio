import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readReel } from "../../src/server/reel.ts"
import { NO_CAPTIONS } from "../../src/shared/captions.ts"
import type { Cut } from "../../src/server/timeline-files.ts"

const cut = {
  clips: [{ video: "a.mov", start: 0, end: 1, block: "a" }, { video: "b.mov", start: 0, end: 1, block: "b" }],
  inserts: [],
  captions: NO_CAPTIONS
} satisfies Cut

test("new heads stale a centred reel even when its parts and zooms have not changed", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/reel-freshness-")
  try {
    await mkdir(`${dir}/reel`)
    await mkdir(`${dir}/gaze`)
    const base = {
      made: "2026-11-24T00:00:00.000Z",
      noise: "strong",
      files: [{ app: "Instagram", video: "file-instagram.mp4" }, { app: "YouTube Shorts", video: "file-youtube.mp4" }, { app: "TikTok", video: "file-tiktok.mp4" }],
      parts: [{ video: "a.mov", start: 0, frames: 30 }, { video: "b.mov", start: 0, frames: 30 }]
    }
    await Promise.all(base.files.map((file) => writeFile(`${dir}/reel/${file.video}`, "published")))
    const writeRecord = async (crops: ReadonlyArray<{ readonly video: string; readonly left: number | null }>) => {
      await writeFile(`${dir}/reel/reel.json`, JSON.stringify({ ...base, crops }))
    }
    const fresh = async () => (await Effect.runPromise(readReel(dir, cut, { state: "idle" }).pipe(Effect.provide(BunServices.layer)))).file?.fresh
    await writeRecord([{ video: "a.mov", left: null }, { video: "b.mov", left: null }])
    expect(await fresh()).toBe(true)
    await writeFile(`${dir}/gaze/b.mov.json`, JSON.stringify({ step: 0.2, samples: ["camera"], aspect: 16 / 9, heads: [{ x: 1.4, y: 0.4, size: 0.2 }] }))
    expect(await fresh()).toBe(false)
    await writeRecord([{ video: "a.mov", left: null }, { video: "b.mov", left: 1.11875 }])
    expect(await fresh()).toBe(true)
    await writeFile(`${dir}/gaze/b.mov.json`, JSON.stringify({ step: 0.2, samples: ["camera"], aspect: 16 / 9 }))
    expect(await fresh()).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a one-file record from before the three apps stays playable as Instagram's file but is stale while three apps are chosen", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/reel-one-file-")
  try {
    await mkdir(`${dir}/reel`)
    await mkdir(`${dir}/gaze`)
    await writeFile(`${dir}/reel/file.mp4`, "published")
    await writeFile(`${dir}/reel/reel.json`, JSON.stringify({
      made: "2026-11-24T00:00:00.000Z", video: "file.mp4",
      parts: [{ video: "a.mov", start: 0, frames: 30 }, { video: "b.mov", start: 0, frames: 30 }],
      crops: [{ video: "a.mov", left: null }, { video: "b.mov", left: null }]
    }))
    const view = await Effect.runPromise(readReel(dir, cut, { state: "idle" }).pipe(Effect.provide(BunServices.layer)))
    expect(view.file?.apps).toEqual([{ app: "Instagram", size: "published".length }])
    expect(view.file?.fresh).toBe(false)
    await writeFile(`${dir}/task.json`, JSON.stringify({ apps: ["Instagram"], files: [] }))
    await writeFile(`${dir}/looks.json`, JSON.stringify({ noise: "off" }))
    const chosen = await Effect.runPromise(readReel(dir, cut, { state: "idle" }).pipe(Effect.provide(BunServices.layer)))
    expect(chosen.file?.fresh).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a legacy record without crop windows stays playable but never counts as fresh", async () => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp("node_modules/.cache/reel-legacy-")
  try {
    await mkdir(`${dir}/reel`)
    await writeFile(`${dir}/reel/file.mp4`, "published")
    await writeFile(`${dir}/reel/reel.json`, JSON.stringify({
      made: "2026-11-24T00:00:00.000Z", video: "file.mp4",
      parts: [{ video: "a.mov", start: 0, frames: 30 }, { video: "b.mov", start: 0, frames: 30 }]
    }))
    const view = await Effect.runPromise(readReel(dir, cut, { state: "idle" }).pipe(Effect.provide(BunServices.layer)))
    expect(view.file).toBeDefined()
    expect(view.file?.fresh).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
