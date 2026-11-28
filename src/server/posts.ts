import { Effect, FileSystem, Option, Schema } from "effect"
import type { App } from "../shared/brief.ts"
import { emptyPost, type Post, Posts } from "../shared/posts.ts"
import { readText } from "./approval.ts"
import { readApps } from "./task-choices.ts"

const PostsFile = Schema.fromJsonString(Posts)
const decodePosts = Schema.decodeUnknownOption(PostsFile)
const encodePosts = Schema.encodeEffect(PostsFile)

const postsFile = (dir: string): string => `${dir}/posts.json`

const savedPosts = Effect.fnUntraced(function*(dir: string) {
  const saved = yield* readText(postsFile(dir))
  if (saved === undefined) return []
  const posts = Option.getOrUndefined(decodePosts(saved))
  if (posts !== undefined) return posts.posts
  yield* Effect.logError("the posts are unreadable", dir)
  return []
})

const inAppsOf = (apps: ReadonlyArray<App>, saved: ReadonlyArray<Post>): Posts =>
  ({ posts: apps.map((app) => saved.find((post) => post.app === app) ?? emptyPost(app)) })

export const readPosts = Effect.fnUntraced(function*(dir: string) {
  return inAppsOf(yield* readApps(dir), yield* savedPosts(dir))
})

// A post of an app chosen earlier stays in the file, so choosing that app again brings its text back.
export const writePost = Effect.fnUntraced(function*(dir: string, post: Post) {
  const fs = yield* FileSystem.FileSystem
  const saved = yield* savedPosts(dir)
  const posts = [...saved.filter((one) => one.app !== post.app), post]
  const file = postsFile(dir)
  yield* fs.writeFileString(`${file}.new`, yield* encodePosts({ posts }))
  yield* fs.rename(`${file}.new`, file)
  return inAppsOf(yield* readApps(dir), posts)
})
