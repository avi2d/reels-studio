import { Schema } from "effect"
import { App } from "./brief.ts"

export const MAX_POST = 4000

const PostText = Schema.String.check(Schema.isMaxLength(MAX_POST))

export const Post = Schema.Struct({ app: App, text: PostText, tags: PostText })
export type Post = typeof Post.Type

export const Posts = Schema.Struct({ posts: Schema.Array(Post) })
export type Posts = typeof Posts.Type

export const emptyPost = (app: App): Post => ({ app, text: "", tags: "" })
