import { Schema } from "effect"

export const TextLine = Schema.Struct({ text: Schema.String, accent: Schema.Boolean })
export type TextLine = typeof TextLine.Type

export const PlannedText = Schema.Struct({
  id: Schema.String,
  video: Schema.String,
  from: Schema.Int,
  to: Schema.Int,
  lines: Schema.Array(TextLine)
})
export type PlannedText = typeof PlannedText.Type

export const TextsFile = Schema.Struct({ texts: Schema.Array(PlannedText) })

export const PlannedTexts = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
  Schema.Struct({ state: Schema.Literal("ready"), planned: Schema.Array(PlannedText), approved: Schema.Boolean })
])
export type PlannedTexts = typeof PlannedTexts.Type
