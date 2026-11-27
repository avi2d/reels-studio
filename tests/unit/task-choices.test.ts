import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readChoices, writeChoices } from "../../src/server/task-choices.ts"
import { taskNote } from "../../src/server/task-note.ts"
import type { NewTask } from "../../src/shared/brief.ts"

const inReel = async <A, E>(use: (dir: string) => Effect.Effect<A, E, BunServices.BunServices>): Promise<A> => {
  const dir = await mkdtemp(join(tmpdir(), "task-choices-"))
  try {
    await mkdir(join(dir, "attached"))
    await writeFile(join(dir, "attached", "logo.png"), "png")
    return await Effect.runPromise(use(dir).pipe(Effect.provide(BunServices.layer)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const saved = (task: NewTask) => (dir: string) => Effect.gen(function*() {
  yield* writeChoices(dir, task)
  return yield* readChoices(dir)
})

const refusal = (task: NewTask) => (dir: string) => Effect.flip(writeChoices(dir, task))

test("a reel with no saved choices goes to every app instead of to none", async () => {
  expect(await inReel(readChoices)).toEqual({ apps: ["Instagram", "YouTube Shorts", "TikTok"], files: [] })
})

test("chosen apps are kept in the app list order instead of the order they were pressed", async () => {
  const choices = await inReel(saved({ text: "", apps: ["TikTok", "Instagram"], files: [{ name: "logo.png" }] }))
  expect(choices).toEqual({ apps: ["Instagram", "TikTok"], files: ["logo.png"] })
})

test("a text-only save keeps the chosen apps and files instead of resetting them", async () => {
  const choices = await inReel((dir) => Effect.gen(function*() {
    yield* writeChoices(dir, { text: "", apps: ["YouTube Shorts"], files: [{ name: "logo.png" }] })
    return yield* saved({ text: "again" })(dir)
  }))
  expect(choices).toEqual({ apps: ["YouTube Shorts"], files: ["logo.png"] })
})

test("an empty app list is refused instead of saving a reel that goes nowhere", async () => {
  expect(await inReel(refusal({ text: "", apps: [] }))).toMatchObject({ status: 400 })
})

test("a file the reel does not hold is refused instead of named to the model", async () => {
  expect(await inReel(refusal({ text: "", files: [{ name: "missing.png" }] }))).toMatchObject({ status: 404 })
})

test("the task note names the chosen apps and the task files instead of the brief alone", () => {
  const note = taskNote({ brief: "A reel about tea\n", apps: ["Instagram", "TikTok"], files: ["logo.png"] })
  expect(note).toContain("Instagram, TikTok")
  expect(note).not.toContain("YouTube Shorts")
  expect(note).toContain("attached/logo.png")
})
