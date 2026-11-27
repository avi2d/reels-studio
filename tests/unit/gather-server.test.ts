import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { Chat } from "../../src/server/chat.ts"
import { Gather } from "../../src/server/gather.ts"
import { GatherState } from "../../src/server/gather-state.ts"
import { Media } from "../../src/server/media.ts"
import { Projects } from "../../src/server/projects.ts"
import { blocksHash } from "../../src/shared/gather.ts"
import { NO_EDITS, PAUSE_REST, type TimelineView } from "../../src/shared/timeline.ts"
import { mediaWith, projectAt } from "./server-fixtures.ts"

const chat = Chat.of({
  history: () => Effect.die("unexpected service call"), send: () => Effect.die("unexpected service call"),
  stop: () => Effect.die("unexpected service call"), gather: () => Effect.die("unexpected service call"),
  withoutTurn: (_id, use) => use
})

test("polling stays active after chat writes changed blocks until pause shortening catches up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gather-server-"))
  try {
    const previous = '{"blocks":[]}'
    const changed = '{"blocks":[{"id":"one","title":"One","takes":[]}]}'
    await writeFile(join(dir, "gathered.json"), JSON.stringify({ videos: ["a"], gazed: ["a"], shortened: blocksHash(previous) }))
    await writeFile(join(dir, "blocks.json"), changed)
    const timeline: TimelineView = { looks: [{ video: "a", state: "measured" }], faces: [], pictures: [], inserts: { state: "none" }, texts: { state: "none" }, timeline: { state: "ready", blocks: [], dropped: 0, edits: NO_EDITS, rest: PAUSE_REST } }
    const media = mediaWith(() => [{ name: "a", state: "ready", transcript: { duration: 1, words: [] } }], timeline)
    const dependencies = Layer.mergeAll(BunServices.layer, GatherState.layer, Layer.succeed(Media, media.service), Layer.succeed(Projects, projectAt(dir)), Layer.succeed(Chat, chat))
    const running = await Effect.runPromise(Effect.gen(function*() {
      const gather = yield* Gather
      return yield* gather.running("p")
    }).pipe(Effect.provide(Gather.layer.pipe(Layer.provide(dependencies)))))
    expect(running).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("polling stays idle when changed blocks cannot shorten because the timeline is unreadable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gather-server-"))
  try {
    const previous = '{"blocks":[]}'
    const changed = '{unreadable'
    await writeFile(join(dir, "gathered.json"), JSON.stringify({ videos: ["a"], gazed: ["a"], failed: true, hash: blocksHash(changed), shortened: blocksHash(previous) }))
    await writeFile(join(dir, "blocks.json"), changed)
    const timeline: TimelineView = { looks: [{ video: "a", state: "measured" }], faces: [], pictures: [], inserts: { state: "none" }, texts: { state: "none" }, timeline: { state: "unreadable" } }
    const media = mediaWith(() => [{ name: "a", state: "ready", transcript: { duration: 1, words: [] } }], timeline)
    const dependencies = Layer.mergeAll(BunServices.layer, GatherState.layer, Layer.succeed(Media, media.service), Layer.succeed(Projects, projectAt(dir)), Layer.succeed(Chat, chat))
    const result = await Effect.runPromise(Effect.gen(function*() {
      const gather = yield* Gather
      return { running: yield* gather.running("p"), failed: yield* gather.failed("p") }
    }).pipe(Effect.provide(Gather.layer.pipe(Layer.provide(dependencies)))))
    expect(result.running).toBe(false)
    expect(result.failed).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
