import { Schema } from "effect"

export const Message = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.String)),
  failed: Schema.optionalKey(Schema.String),
  stopped: Schema.optionalKey(Schema.Literal(true))
})
export type Message = typeof Message.Type

export const CHAT_TURN_HEADER = "x-chat-turn"

export const ChatEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("delta"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("step"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({ type: Schema.Literal("retry") }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
  Schema.Struct({ type: Schema.Literal("done") })
])
export type ChatEvent = typeof ChatEvent.Type

export type FileKind = "picture" | "document" | "video" | "sound" | "other"

const EXTENSIONS: Readonly<Record<string, FileKind>> = {
  png: "picture", jpg: "picture", jpeg: "picture", gif: "picture", webp: "picture", heic: "picture", heif: "picture", avif: "picture", bmp: "picture", tif: "picture", tiff: "picture",
  pdf: "document",
  mp4: "video", mov: "video", m4v: "video", webm: "video", mkv: "video", avi: "video", "3gp": "video",
  mp3: "sound", m4a: "sound", aac: "sound", wav: "sound", ogg: "sound", oga: "sound", opus: "sound", flac: "sound", amr: "sound", caf: "sound"
}

export const kindOfName = (name: string): FileKind => {
  const dot = name.lastIndexOf(".")
  return dot < 0 ? "other" : EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? "other"
}

export const MAX_FILES = 10

export const ACCEPTED_FILES = "image/*,application/pdf,video/*,audio/*"
