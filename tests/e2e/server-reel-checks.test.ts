import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Layer, PlatformError } from "effect"
import { readChecks } from "../../src/server/reel-checks.ts"
import { Settings } from "../../src/server/settings.ts"
import type { Cut } from "../../src/server/timeline-files.ts"
import { NO_CAPTIONS } from "../../src/shared/captions.ts"

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

const measure = (dir: string, cut: Cut) => readChecks(dir, cut, undefined, 2)

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
