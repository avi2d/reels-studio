import { expect, test } from "bun:test"
import { Effect } from "effect"
import { oneAfterAnother } from "../../src/web/queue.ts"

test("videos chosen together and added later upload one after another, never two at once", async () => {
  const log: Array<string> = []
  const active = { now: 0, most: 0 }
  const lastEnded = Promise.withResolvers<void>()
  const add = oneAfterAnother((name: string) =>
    Effect.gen(function*() {
      active.now += 1
      active.most = Math.max(active.most, active.now)
      log.push(`start ${name}`)
      yield* Effect.sleep("10 millis")
      log.push(`end ${name}`)
      active.now -= 1
      if (name === "c.mp4") lastEnded.resolve()
    }))
  add(["a.mp4", "b.mp4"])
  await Bun.sleep(5)
  add(["c.mp4"])
  await lastEnded.promise
  expect(active.most).toBe(1)
  expect(log).toEqual(["start a.mp4", "end a.mp4", "start b.mp4", "end b.mp4", "start c.mp4", "end c.mp4"])
})

test("a throwing video does not leave the next video waiting", async () => {
  const done: Array<string> = []
  const add = oneAfterAnother((name: string) =>
    name === "bad.mp4" ? Effect.die(new Error("boom")) : Effect.sync(() => { done.push(name) }))
  add(["bad.mp4", "good.mp4"])
  await Bun.sleep(10)
  expect(done).toEqual(["good.mp4"])
})

test("a video added after the line emptied still uploads, not left waiting", async () => {
  const done: Array<string> = []
  const add = oneAfterAnother((name: string) => Effect.sync(() => { done.push(name) }))
  add(["a.mp4"])
  await Bun.sleep(5)
  add(["b.mp4"])
  await Bun.sleep(5)
  expect(done).toEqual(["a.mp4", "b.mp4"])
})
