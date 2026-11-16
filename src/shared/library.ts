import { Schema } from "effect"

export const LibraryVideo = Schema.Struct({
  project: Schema.String,
  name: Schema.String,
  size: Schema.Finite,
  duration: Schema.Finite,
  titles: Schema.Array(Schema.String)
})
export type LibraryVideo = typeof LibraryVideo.Type

export const Pick = Schema.Struct({ project: Schema.String, name: Schema.String })
export type Pick = typeof Pick.Type
