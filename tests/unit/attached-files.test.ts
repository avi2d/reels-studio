import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readReachable } from "../../src/server/attached-files.ts"
import { readTimeline } from "../../src/server/timeline-files.ts"

const inReel = async (files: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "attached-files-"))
  try {
    await mkdir(join(dir, "attached"))
    await mkdir(join(dir, "transcripts"))
    for (const name of ["chat.png", "logo.png", "old.png"]) await writeFile(join(dir, "attached", name), "png")
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
    return await Effect.runPromise(Effect.gen(function*() {
      const reachable = yield* readReachable(dir)
      const timeline = yield* readTimeline(dir, ["video.mp4"], new Map())
      return { reachable, timeline }
    }).pipe(Effect.provide(BunServices.layer)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("a removed task file is excluded from timeline pictures and planned inserts", async () => {
  const kept = { id: "kept", picture: "logo.png", video: "video.mp4", from: 0, to: 0, reason: "Logo" }
  const { reachable, timeline } = await inReel({
    "task.json": JSON.stringify({ apps: ["Instagram"], files: ["logo.png"] }),
    "transcripts/video.mp4.json": JSON.stringify({ duration: 3, words: [{ start: 0, end: 3, text: "Logo" }] }),
    "inserts.json": JSON.stringify({ inserts: [kept, { ...kept, id: "removed", picture: "old.png" }] })
  })
  expect(reachable).toEqual(["logo.png"])
  expect(timeline.pictures).toEqual(["logo.png"])
  expect(timeline.inserts).toEqual({ state: "ready", planned: [kept], dropped: 1 })
})

test("a file a chat message still carries stays reachable after it leaves the task", async () => {
  const { reachable, timeline } = await inReel({
    "task.json": JSON.stringify({ apps: ["Instagram"], files: [] }),
    "chat.jsonl": JSON.stringify({ role: "user", text: "see this", files: ["chat.png"] }) + "\n"
  })
  expect(reachable).toEqual(["chat.png"])
  expect(timeline.pictures).toEqual(["chat.png"])
})

test("a saved web page stays reachable and shows as a source, though no chat message names it", async () => {
  const page = { file: "web-example.com-0123456789.pdf", address: "https://example.com/law", licence: "CC BY 4.0", saved: "2026-11-28T08:00:00.000Z" }
  const { reachable, timeline } = await inReel({
    "attached/web-example.com-0123456789.pdf": "%PDF",
    "web-pages.json": JSON.stringify({ pages: [page, { ...page, file: "web-gone.example-0123456789.pdf" }] })
  })
  expect(reachable).toEqual(["web-example.com-0123456789.pdf"])
  expect(timeline.sources).toEqual([{ file: page.file, address: page.address, licence: "CC BY 4.0", articles: [] }])
})

test("a file in attached that neither the task nor a chat message names is not reachable", async () => {
  const { reachable, timeline } = await inReel({})
  expect(reachable).toEqual([])
  expect(timeline.pictures).toEqual([])
})
