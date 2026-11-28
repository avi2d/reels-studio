import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunServices } from "@effect/platform-bun"
import { Effect } from "effect"
import { readPosts, writePost } from "../../src/server/posts.ts"
import { writeChoices } from "../../src/server/task-choices.ts"
import type { Post } from "../../src/shared/posts.ts"

test("deselecting an app does not hide its saved caption and hashtags from an older build", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reel-posts-"))
  const tiktok = { app: "TikTok", text: "How to get your deposit back", tags: "#deposit" } satisfies Post
  const instagram = { app: "Instagram", text: "Save this for later", tags: "#contract" } satisfies Post
  const text = "Explain how to get a deposit back"
  try {
    const { loaded, saved } = await Effect.runPromise(Effect.gen(function*() {
      yield* writeChoices(dir, { text, apps: ["Instagram", "TikTok"] })
      yield* writePost(dir, tiktok)
      yield* writeChoices(dir, { text, apps: ["Instagram"] })
      const loadedPosts = yield* readPosts(dir)
      const savedPosts = yield* writePost(dir, instagram)
      return { loaded: loadedPosts, saved: savedPosts }
    }).pipe(Effect.provide(BunServices.layer)))

    expect(loaded.posts).toContainEqual(tiktok)
    expect(saved.posts).toContainEqual(tiktok)
    expect(saved.posts).toContainEqual(instagram)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
