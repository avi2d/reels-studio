import { Schema } from "effect"

export const ReelJob = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["idle", "waiting", "failed"]) }),
  Schema.Struct({ state: Schema.Literal("running"), done: Schema.Finite })
])
export type ReelJob = typeof ReelJob.Type

export const ReelView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  file: Schema.optionalKey(Schema.Struct({ made: Schema.String, seconds: Schema.Finite, size: Schema.Finite, fresh: Schema.Boolean }))
})
export type ReelView = typeof ReelView.Type
