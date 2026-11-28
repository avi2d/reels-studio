import { Schema } from "effect"
import { ReelJob } from "./reel.ts"

export const Noise = Schema.Literals(["off", "light", "strong"])
export type Noise = typeof Noise.Type

export const NOISE_DEFAULT: Noise = "strong"

export const Cleaned = Schema.Literals(["light", "strong"])
export type Cleaned = typeof Cleaned.Type

export const CLEANED = Cleaned.literals

export const LEVEL_STEP = 0.1
export const QUIETEST_DB = -100

const PAUSE_UNDER_MEDIAN_DB = 20

export interface Windows {
  readonly off: ReadonlyArray<number>
  readonly light: ReadonlyArray<number>
  readonly strong: ReadonlyArray<number>
}

const median = (values: ReadonlyArray<number>): number | undefined => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export const PauseNoise = Schema.Struct({ off: Schema.Finite, light: Schema.Finite, strong: Schema.Finite })
export type PauseNoise = typeof PauseNoise.Type

export const pauseNoise = (windows: Windows): PauseNoise | undefined => {
  const middle = median(windows.off)
  const aligned = windows.light.length === windows.off.length && windows.strong.length === windows.off.length
  if (middle === undefined || !aligned) return undefined
  const pauses = windows.off.flatMap((level, index) => level < middle - PAUSE_UNDER_MEDIAN_DB ? [index] : [])
  const at = (levels: ReadonlyArray<number>): number | undefined => median(pauses.map((index) => levels[index] ?? QUIETEST_DB))
  const off = at(windows.off)
  const light = at(windows.light)
  const strong = at(windows.strong)
  return off === undefined || light === undefined || strong === undefined ? undefined : { off, light, strong }
}

export const NoiseView = Schema.Struct({
  job: ReelJob,
  cut: Schema.Finite,
  noise: Noise,
  cleaned: Schema.optionalKey(Schema.Struct({
    made: Schema.String,
    pauses: Schema.optionalKey(PauseNoise)
  }))
})
export type NoiseView = typeof NoiseView.Type
