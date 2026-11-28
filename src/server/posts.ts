import { Effect, FileSystem, Option, Schema, Semaphore } from "effect"
import { type Post, Posts } from "../shared/posts.ts"
import { readText } from "./approval.ts"

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

export const readPosts = Effect.fnUntraced(function*(dir: string) {
  return { posts: yield* savedPosts(dir) }
})

// Concurrent saves can drop a post unless the lock covers both the read and the write.
const writing = Semaphore.makeUnsafe(1)

export const writePost = Effect.fnUntraced(function*(dir: string, post: Post) {
  const fs = yield* FileSystem.FileSystem
  const saved = yield* savedPosts(dir)
  const posts = [...saved.filter((one) => one.app !== post.app), post]
  const file = postsFile(dir)
  yield* fs.writeFileString(`${file}.new`, yield* encodePosts({ posts }))
  yield* fs.rename(`${file}.new`, file)
  return { posts }
}, Semaphore.withPermit(writing))
