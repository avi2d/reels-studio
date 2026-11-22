import { Schema } from "effect"
import { Face } from "./face.ts"
import { ReelJob } from "./reel.ts"

export const TRIAL_SECONDS = 20

export const RetouchPicture = Schema.Literals(["before.jpg", "after.jpg", "compare.mp4"])
export type RetouchPicture = typeof RetouchPicture.Type

export const RetouchView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  face: Face,
  built: Schema.optionalKey(Face),
  trial: Schema.optionalKey(Schema.Struct({ made: Schema.String, seconds: Schema.Finite, took: Schema.Finite }))
})
export type RetouchView = typeof RetouchView.Type

export const minuteTakes = (trial: { readonly seconds: number; readonly took: number }): number =>
  trial.took / trial.seconds * 60
