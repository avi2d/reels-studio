import { LOUDNESS_TARGET, SILENCE_LUFS } from "../shared/reel.ts"
import { FADE } from "../shared/timeline.ts"
import type { Moment } from "./media-commands.ts"

const CURVE_FLOOR_LUFS = -60
const CURVE_MIN_DB = -20
const CURVE_MAX_DB = 40
// The true peak runs above the sample peak, so the sample ceiling sits 1 dB under the -1.5 dBTP target.
const LIMIT_LINEAR = 0.75

const MOMENTARY_SECONDS = 0.4
// Readings near a join still mix both parts up to this far past it.
const JOIN_MARGIN = 0.2
const TIME_EPSILON = 1e-6

export interface PartLevel { readonly from: number; readonly to: number; readonly lufs: number }

export interface Gain {
  readonly time: number
  readonly db: number
}

const gainOf = (lufs: number, offset: number): number =>
  lufs <= CURVE_FLOOR_LUFS ? 0 : Math.min(CURVE_MAX_DB, Math.max(CURVE_MIN_DB, LOUDNESS_TARGET - lufs)) + offset

// A reading covers the 0.4 s that end at its time, so the gain for audio starting at t is the reading at t + 0.4.
// Readings near a join mix both parts, so each part's gain is held from its own clean readings and the change ends at the join, before the new part's fade-in.
// A part too short for a clean reading is held at its whole reading.
// ebur128 gives no integrated reading for a part under one 0.4 s block, so such a part takes the reading whose window is centred on it.
export const gainsOf = (moments: ReadonlyArray<Moment>, parts: ReadonlyArray<PartLevel>, offset: number): ReadonlyArray<Gain> => {
  const shifted = moments
    .map(({ time, lufs }) => ({ time: time - MOMENTARY_SECONDS, lufs }))
    .filter(({ time }) => time >= -TIME_EPSILON)
  const last = parts.length - 1
  const clean = parts.map((part, index) => shifted.filter(({ time }) =>
    (index === 0 || time >= part.from + JOIN_MARGIN - TIME_EPSILON) && (index === last || time <= part.to - MOMENTARY_SECONDS - JOIN_MARGIN + TIME_EPSILON)))
  const levels = parts.map((part) => {
    if (part.lufs > SILENCE_LUFS) return part.lufs
    const centre = (part.from + part.to - MOMENTARY_SECONDS) / 2
    const nearest = shifted.reduce<Moment | undefined>((best, moment) =>
      best === undefined || Math.abs(moment.time - centre) < Math.abs(best.time - centre) ? moment : best, undefined)
    return nearest?.lufs ?? SILENCE_LUFS
  })
  const gain = (lufs: number): number => gainOf(lufs, offset)
  const opening = (index: number): number => gain(clean[index]?.[0]?.lufs ?? levels[index] ?? SILENCE_LUFS)
  const closing = (index: number): number => gain(clean[index]?.at(-1)?.lufs ?? levels[index] ?? SILENCE_LUFS)
  return shifted.map(({ time, lufs }) => {
    const index = parts.findLastIndex((part) => part.from <= time + TIME_EPSILON)
    const part = parts[index]
    if (part === undefined) return { time, db: gain(lufs) }
    const rampFrom = part.to - 2 * FADE
    if (index < last && time > rampFrom) {
      const share = (time - rampFrom) / (2 * FADE)
      return { time, db: closing(index) + share * (opening(index + 1) - closing(index)) }
    }
    const [first, final] = [clean[index]?.[0], clean[index]?.at(-1)]
    if (first === undefined || final === undefined) return { time, db: gain(levels[index] ?? SILENCE_LUFS) }
    if (index > 0 && time < first.time - TIME_EPSILON) return { time, db: gain(first.lufs) }
    if (index < last && time > final.time + TIME_EPSILON) return { time, db: gain(final.lufs) }
    return { time, db: gain(lufs) }
  })
}

export const curveOf = (gains: ReadonlyArray<Gain>): string =>
  gains.map(({ time, db }) => `${time.toFixed(1)} volume volume ${(10 ** (db / 20)).toFixed(6)}`).join(";")

export const levelArgs = (source: string, curve: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", source,
  "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
  "-af", `asendcmd=f=${curve},volume=1,alimiter=limit=${LIMIT_LINEAR}:attack=5:release=50:level=disabled,aresample=48000`,
  "-c:a", "aac", "-b:a", "192k", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]
