import { Schema } from "effect"

export const ReelJob = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["idle", "waiting", "failed"]) }),
  Schema.Struct({ state: Schema.Literal("running"), done: Schema.Finite })
])
export type ReelJob = typeof ReelJob.Type

export const LOUDNESS_TARGET = -14
const LOUDNESS_TOLERANCE = 1
const LOUDNESS_BAD = 3
export const SILENCE_LUFS = -70
const JUMP_LU = 3
export const SERIES_STEP = 0.5
const LRA_LIMIT = 11
const PEAK_LIMIT = -1.5

export const Loudness = Schema.Struct({ before: Schema.Finite, after: Schema.Finite })
export type Loudness = typeof Loudness.Type

export const Series = Schema.Struct({ before: Schema.Array(Schema.Finite), after: Schema.Array(Schema.Finite) })
export type Series = typeof Series.Type

export const Sound = Schema.Struct({ lufs: Schema.Finite, lra: Schema.Finite, truePeak: Schema.Finite })
export type Sound = typeof Sound.Type

type Issue = "off-target" | "uneven" | "over-peak" | "clipping"

export interface Verdict {
  readonly level: "good" | "check" | "bad"
  readonly issues: ReadonlyArray<Issue>
}

export const judgeSound = (sound: Sound): Verdict => {
  const issues: Array<Issue> = []
  if (sound.truePeak > 0) issues.push("clipping")
  else if (sound.truePeak > PEAK_LIMIT) issues.push("over-peak")
  if (sound.lra > LRA_LIMIT) issues.push("uneven")
  const off = Math.abs(sound.lufs - LOUDNESS_TARGET)
  if (off > LOUDNESS_TOLERANCE) issues.push("off-target")
  const level = sound.truePeak > 0 || off > LOUDNESS_BAD ? "bad" : issues.length > 0 ? "check" : "good"
  return { level, issues }
}

export const Passage = Schema.Struct({
  name: Schema.Literals(["quiet", "loud"]),
  from: Schema.Finite,
  to: Schema.Finite,
  before: Schema.Finite,
  after: Schema.Finite
})
export type Passage = typeof Passage.Type

export interface Jump {
  readonly from: number
  readonly to: number
}

// A run of samples more than JUMP_LU from the target is one jump. Silence ends a run, so a gap is not a jump.
export const jumpsOf = (after: ReadonlyArray<number>): ReadonlyArray<Jump> => {
  const jumps: Array<Jump> = []
  let start: number | undefined
  after.forEach((lufs, index) => {
    const off = lufs > SILENCE_LUFS && Math.abs(lufs - LOUDNESS_TARGET) > JUMP_LU
    if (off && start === undefined) start = index
    if (!off && start !== undefined) {
      jumps.push({ from: start * SERIES_STEP, to: index * SERIES_STEP })
      start = undefined
    }
  })
  if (start !== undefined) jumps.push({ from: start * SERIES_STEP, to: after.length * SERIES_STEP })
  return jumps
}

export const ReelView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  file: Schema.optionalKey(Schema.Struct({
    made: Schema.String,
    seconds: Schema.Finite,
    size: Schema.Finite,
    fresh: Schema.Boolean,
    loudness: Loudness,
    sound: Sound,
    series: Series,
    passages: Schema.Array(Passage)
  }))
})
export type ReelView = typeof ReelView.Type
