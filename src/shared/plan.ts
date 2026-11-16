import { Schema } from "effect"

export const Span = Schema.Struct({ start: Schema.Finite, end: Schema.Finite })
export type Span = typeof Span.Type

const Word = Schema.Struct({ start: Schema.Finite, end: Schema.Finite, text: Schema.String })

export const Transcript = Schema.Struct({ duration: Schema.Finite, words: Schema.Array(Word) })
export type Transcript = typeof Transcript.Type

const Removal = Schema.Struct({ from: Schema.Int, to: Schema.Int, reason: Schema.optionalKey(Schema.String) })

export const VideoPlan = Schema.Struct({ video: Schema.String, remove: Schema.Array(Removal) })
export type VideoPlan = typeof VideoPlan.Type

export const Plan = Schema.Struct({ videos: Schema.Array(VideoPlan) })

export const VideoView = Schema.Union([
  Schema.Struct({ name: Schema.String, state: Schema.Literals(["waiting", "failed"]) }),
  Schema.Struct({ name: Schema.String, state: Schema.Literal("ready"), transcript: Transcript, plan: Schema.optionalKey(Schema.Union([VideoPlan, Schema.Literal("unreadable")])) })
])
export type VideoView = typeof VideoView.Type

export const removedWords = (count: number, plan: VideoPlan): ReadonlyArray<boolean> =>
  Array.from({ length: count }, (_, index) => plan.remove.some((piece) => index >= piece.from && index <= piece.to))

export const removedSpans = (transcript: Transcript, plan: VideoPlan): ReadonlyArray<Span> => {
  const removed = removedWords(transcript.words.length, plan)
  const spans: Array<Span> = []
  transcript.words.forEach((word, index) => {
    if (removed[index] !== true) return
    const open = spans.at(-1)
    if (open !== undefined && removed[index - 1] === true) spans[spans.length - 1] = { start: open.start, end: word.end }
    else spans.push({ start: word.start, end: word.end })
  })
  return spans.filter((span) => span.end > span.start)
}

export const lengthOf = (spans: ReadonlyArray<Span>): number =>
  spans.reduce((total, span) => total + span.end - span.start, 0)

export const skipTarget = (spans: ReadonlyArray<Span>, time: number): number | undefined =>
  spans.find((span) => time >= span.start && time < span.end)?.end
