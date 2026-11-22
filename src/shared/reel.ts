import { Schema } from "effect"

export const ReelJob = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["idle", "waiting", "failed"]) }),
  Schema.Struct({ state: Schema.Literal("running"), done: Schema.Finite })
])
export type ReelJob = typeof ReelJob.Type

export const Rgb = Schema.Struct({ r: Schema.Finite, g: Schema.Finite, b: Schema.Finite })
export type Rgb = typeof Rgb.Type

export const VideoColour = Schema.Union([
  Schema.Struct({ video: Schema.String, state: Schema.Literal("reference"), skin: Rgb }),
  Schema.Struct({ video: Schema.String, state: Schema.Literal("matched"), skin: Rgb, gain: Rgb }),
  Schema.Struct({ video: Schema.String, state: Schema.Literal("unmeasured") })
])
export type VideoColour = typeof VideoColour.Type

export const PictureSide = Schema.Literals(["before", "after"])
export type PictureSide = typeof PictureSide.Type

export const ColourView = Schema.Struct({ joins: Schema.Int, matched: Schema.Int, unmeasured: Schema.Int })
export type ColourView = typeof ColourView.Type

export const ReelView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  file: Schema.optionalKey(Schema.Struct({
    made: Schema.String,
    seconds: Schema.Finite,
    size: Schema.Finite,
    fresh: Schema.Boolean,
    colour: Schema.optionalKey(ColourView)
  }))
})
export type ReelView = typeof ReelView.Type
