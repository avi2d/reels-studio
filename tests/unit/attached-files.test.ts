import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readReachable } from "../../src/server/attached-files.ts"

const inReel = async (files: Record<string, string>): Promise<ReadonlyArray<string>> => {
  const dir = await mkdtemp(join(tmpdir(), "attached-files-"))
  try {
    await mkdir(join(dir, "attached"))
    for (const name of ["chat.png", "logo.png", "old.png"]) await writeFile(join(dir, "attached", name), "png")
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
    return await Effect.runPromise(readReachable(dir).pipe(Effect.provide(BunServices.layer)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("a task file removed from the task does not reach the plan or the inserts", async () => {
  const reachable = await inReel({ "task.json": JSON.stringify({ apps: ["Instagram"], files: ["logo.png"] }) })
  expect(reachable).toEqual(["logo.png"])
})

test("a file a chat message still carries stays reachable after it leaves the task", async () => {
  const reachable = await inReel({
    "task.json": JSON.stringify({ apps: ["Instagram"], files: [] }),
    "chat.jsonl": JSON.stringify({ role: "user", text: "see this", files: ["chat.png"] }) + "\n"
  })
  expect(reachable).toEqual(["chat.png"])
})

test("a file in attached that neither the task nor a chat message names is not reachable", async () => {
  expect(await inReel({})).toEqual([])
})
