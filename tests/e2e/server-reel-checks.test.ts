import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Array as Arr, Effect, FileSystem, Layer, PlatformError } from "effect"
import { readChecks } from "../../src/server/reel-checks.ts"
import { Settings } from "../../src/server/settings.ts"
import type { Cut } from "../../src/server/timeline-files.ts"
import type { App } from "../../src/shared/brief.ts"
import { NO_CAPTIONS } from "../../src/shared/captions.ts"
import { blocksBuild, checkSentence } from "../../src/shared/reel-checks.ts"

const inFolder = async (prefix: string, use: (dir: string) => Promise<void>): Promise<void> => {
  await mkdir("node_modules/.cache", { recursive: true })
  const dir = await mkdtemp(`node_modules/.cache/${prefix}-`)
  try {
    await use(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const cutOf = (title: "top" | "middle"): Cut => ({
  clips: [],
  inserts: [],
  captions: {
    ...NO_CAPTIONS,
    title,
    texts: [{
      id: "title", start: 0, end: 2,
      lines: Array.from({ length: 4 }, () => ({ text: "MMMMMMMMMMMMM", accent: false }))
    }]
  }
})

const measure = (dir: string, cut: Cut, apps: Arr.NonEmptyReadonlyArray<App> = ["Instagram"]) => readChecks(dir, cut, undefined, 2, apps)

const oneLine = (title: "top" | "middle", letters: number): Cut => ({
  clips: [],
  inserts: [],
  captions: { ...NO_CAPTIONS, title, texts: [{ id: "title", start: 0, end: 2, lines: [{ text: "M".repeat(letters), accent: false }] }] }
})

const run = <A, E>(work: Effect.Effect<A, E, Settings | BunServices.BunServices>) =>
  Effect.runPromise(work.pipe(Effect.provide(Settings.layer.pipe(Layer.provideMerge(BunServices.layer)))))

for (const method of ["makeTempDirectory", "writeFileString"] as const) {
  test(`a failed ${method} yields an unmeasured check and does not poison the next poll`, async () => {
    await mkdir("node_modules/.cache", { recursive: true })
    const dir = await mkdtemp("node_modules/.cache/reel-retry-")
    try {
      await run(Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const cut = cutOf("top")
        const failure = PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method })
        const failed = yield* measure(dir, cut).pipe(Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          [method]: () => Effect.fail(failure)
        }))
        expect(failed.texts.state).toBe("unmeasured")
        expect((yield* measure(dir, cut)).texts.state).toBe("inside")
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

for (const first of ["top", "middle"] as const) {
  test(`switching a ${first} title does not reuse the previous placement's ink result`, async () => {
    await mkdir("node_modules/.cache", { recursive: true })
    const dir = await mkdtemp("node_modules/.cache/reel-title-")
    const second = first === "top" ? "middle" : "top"
    try {
      const placement = { top: "inside", middle: "outside" } as const
      expect((await run(measure(dir, cutOf(first)))).texts.state).toBe(placement[first])
      expect((await run(measure(dir, cutOf(second)))).texts.state).toBe(placement[second])
      expect((await run(measure(dir, cutOf(first)))).texts.state).toBe(placement[first])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test("a top title past Instagram's right margin but inside TikTok's does not block a TikTok-only build measured in Instagram's margins", () =>
  inFolder("reel-wide", async (dir) => {
    const wide = oneLine("top", 15)
    expect((await run(measure(dir, wide, ["TikTok"]))).texts).toEqual({ id: "texts", state: "inside", apps: ["TikTok"] })
    const both = await run(measure(dir, wide, ["Instagram", "TikTok"]))
    expect(both.texts).toEqual({ id: "texts", state: "outside", apps: ["Instagram", "TikTok"], app: "Instagram", text: "Надпись" })
    expect(blocksBuild(both)).toBe(true)
  }))

test("a middle title that reaches TikTok's button column blocks a build with TikTok chosen instead of passing on Instagram's margins", () =>
  inFolder("reel-low", async (dir) => {
    const low = oneLine("middle", 14)
    expect((await run(measure(dir, low, ["Instagram"]))).texts.state).toBe("inside")
    const both = await run(measure(dir, low, ["Instagram", "TikTok"]))
    expect(both.texts).toMatchObject({ state: "outside", app: "TikTok" })
    expect(checkSentence(both.texts)).toBe("Надпись «Надпись» выходит за поля TikTok. Сократите её на шаге «Монтаж».")
  }))
