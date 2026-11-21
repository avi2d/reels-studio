import { Schema } from "effect"

const Heard = { name: Schema.String, size: Schema.Finite, duration: Schema.Finite }

export const LibraryVideo = Schema.Union([
  Schema.Struct({ from: Schema.Literal("library"), ...Heard }),
  Schema.Struct({ from: Schema.Literal("reel"), project: Schema.String, titles: Schema.Array(Schema.String), ...Heard })
])
export type LibraryVideo = typeof LibraryVideo.Type

export const Offer = Schema.Struct({ videos: Schema.Array(LibraryVideo), listening: Schema.Int })
export type Offer = typeof Offer.Type

export const Pick = Schema.Union([
  Schema.Struct({ from: Schema.Literal("library"), name: Schema.String }),
  Schema.Struct({ from: Schema.Literal("reel"), project: Schema.String, name: Schema.String })
])
export type Pick = typeof Pick.Type

export const pickOf = (video: LibraryVideo): Pick =>
  video.from === "library" ? { from: "library", name: video.name } : { from: "reel", project: video.project, name: video.name }

export const UploadedVideo = Schema.Union([
  Schema.Struct({ name: Schema.String, size: Schema.Finite, state: Schema.Literals(["waiting", "failed"]) }),
  Schema.Struct({ name: Schema.String, size: Schema.Finite, state: Schema.Literal("ready"), duration: Schema.Finite })
])
export type UploadedVideo = typeof UploadedVideo.Type
