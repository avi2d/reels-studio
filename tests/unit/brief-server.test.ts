import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect, Fiber, Layer } from "effect"
import { Brief } from "../../src/server/brief.ts"
import { GatherState } from "../../src/server/gather-state.ts"
import { Media } from "../../src/server/media.ts"
import { Projects } from "../../src/server/projects.ts"
import type { VideoView } from "../../src/shared/plan.ts"
import { NO_EDITS, type TimelineView } from "../../src/shared/timeline.ts"
import { mediaWith, projectAt } from "./server-fixtures.ts"

test("a yes waits for a listening video instead of omitting it from the approved cut", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brief-server-"))
  try {
    await writeFile(join(dir, "gathered.json"), JSON.stringify({ videos: ["a"], gazed: ["a"] }))
    let videos: ReadonlyArray<VideoView> = [{ name: "a", state: "waiting" }]
    const timeline: TimelineView = {
      looks: [{ video: "a", state: "measured" }], faces: [],
      timeline: { state: "ready", dropped: 0, edits: NO_EDITS, blocks: [{ id: "one", title: "One", takes: [{ video: "a", from: 0, to: 0, reason: "Clear" }] }] }
    }
    const media = mediaWith(() => videos, timeline)
    const dependencies = Layer.mergeAll(BunServices.layer, GatherState.layer, Layer.succeed(Media, media.service), Layer.succeed(Projects, projectAt(dir)))
    const program = Effect.gen(function*() {
      const brief = yield* Brief
      const fiber = yield* Effect.forkChild(brief.workAlone("p", "plan", Effect.void))
      yield* Effect.sleep("1200 millis")
      expect(yield* brief.working("p")).toBe(true)
      videos = [{ name: "a", state: "ready", transcript: { duration: 1, words: [{ start: 0, end: 1, text: "Hello" }] } }]
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(Brief.layer.pipe(Layer.provide(dependencies))))
    await Effect.runPromise(program)
    expect(media.edits().chosen).toEqual([{ block: "one", video: "a", from: 0 }])
    const approval: unknown = JSON.parse(await readFile(join(dir, "approval.json"), "utf8"))
    expect(approval).toMatchObject({ done: [{ kind: "take", block: "One" }, { kind: "pauses" }] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
