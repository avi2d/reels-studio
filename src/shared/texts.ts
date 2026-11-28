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
  Schema.Struct({ state: Schema.Literal("ready"), planned: Schema.Array(PlannedText) })
])
export type PlannedTexts = typeof PlannedTexts.Type

export const TextAnswer = Schema.Union([
  Schema.Struct({ id: Schema.String, answer: Schema.Literals(["keep", "remove"]) }),
  Schema.Struct({ id: Schema.String, answer: Schema.Literal("retyped"), lines: Schema.Array(TextLine) })
])
export type TextAnswer = typeof TextAnswer.Type

export const MOST_LINES = 3

const LINE_LIMITS = { upright: 20, accent: 8 } as const

export const lineLimit = (line: TextLine): number => line.accent ? LINE_LIMITS.accent : LINE_LIMITS.upright

const letters = new Intl.Segmenter("ru", { granularity: "grapheme" })

export const lineLength = (line: TextLine): number => [...letters.segment(line.text.trim())].length

const isLineTooLong = (line: TextLine): boolean => lineLength(line) > lineLimit(line)

export type LinesProblem = "empty" | "too-many" | "too-long"

export const linesProblem = (lines: ReadonlyArray<TextLine>): LinesProblem | undefined => {
  const filled = lines.filter((line) => line.text.trim() !== "")
  if (filled.length === 0) return "empty"
  if (filled.length > MOST_LINES) return "too-many"
  return filled.some(isLineTooLong) ? "too-long" : undefined
}

export const answerOfText = (answers: ReadonlyArray<TextAnswer>, id: string): TextAnswer | undefined =>
  answers.find((one) => one.id === id)

export const answeredLines = (planned: PlannedText, answer: TextAnswer | undefined): ReadonlyArray<TextLine> =>
  answer?.answer === "retyped" ? answer.lines : planned.lines

export const textKey = (answer: TextAnswer): string =>
  answer.answer === "retyped" ? `retyped:${JSON.stringify(answer.lines.map((line) => [line.text, line.accent]))}` : answer.answer
