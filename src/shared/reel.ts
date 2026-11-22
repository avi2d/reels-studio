import { Schema } from "effect"

export const ReelJob = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["idle", "waiting", "failed"]) }),
  Schema.Struct({ state: Schema.Literal("running"), done: Schema.Finite })
])
export type ReelJob = typeof ReelJob.Type

export const LOUDNESS_TARGET = -14

export const Loudness = Schema.Struct({ before: Schema.Finite, after: Schema.Finite })
export type Loudness = typeof Loudness.Type

export const Passage = Schema.Struct({
  name: Schema.Literals(["quiet", "loud"]),
  from: Schema.Finite,
  to: Schema.Finite,
  before: Schema.Finite,
  after: Schema.Finite
})
export type Passage = typeof Passage.Type

export const ReelView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  file: Schema.optionalKey(Schema.Struct({
    made: Schema.String,
    seconds: Schema.Finite,
    size: Schema.Finite,
    fresh: Schema.Boolean,
    loudness: Loudness,
    passages: Schema.Array(Passage)
  }))
})
export type ReelView = typeof ReelView.Type
