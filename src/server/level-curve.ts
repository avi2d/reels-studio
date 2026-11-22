import { LOUDNESS_TARGET, type Gain, type PartGains } from "../shared/reel.ts"
import { FADE } from "../shared/timeline.ts"
import type { Part } from "./media-commands.ts"
import { streamMaps, type Streams } from "./sound-commands.ts"

const CURVE_FLOOR_LUFS = -60
const CURVE_MIN_DB = -20
const CURVE_MAX_DB = 40
// The true peak runs above the sample peak, so the sample ceiling sits 1 dB under the -1.5 dBTP target.
const LIMIT_LINEAR = 0.75
// 160 samples at 48 kHz is 1/300 s, so every join, at a whole frame of 30 per second, starts an audio frame.
const FRAME_SAMPLES = 160
const SAMPLE_RATE = 48000
const STEP_SECONDS = FRAME_SAMPLES / SAMPLE_RATE
const TIME_EPSILON = 1e-6

export interface PartLevel { readonly from: number; readonly to: number; readonly lufs: number }

const partGainOf = (lufs: number, offset: number): number =>
  lufs <= CURVE_FLOOR_LUFS ? 0 : Math.min(CURVE_MAX_DB, Math.max(CURVE_MIN_DB, LOUDNESS_TARGET - lufs)) + offset

// A gain that follows the momentary level lifts every gap and word ending toward the target, which is heard as a swell of breath and noise at each join.
// So each part holds one gain from its own integrated level, and the change between two parts runs across the fades at their join, where the sound is near silence.
export const gainsOf = (parts: ReadonlyArray<PartLevel>, offset: number): ReadonlyArray<Gain> => {
  const held = parts.map((part) => partGainOf(part.lufs, offset))
  const gains: Array<Gain> = [{ time: 0, db: held[0] ?? 0 }]
  parts.slice(0, -1).forEach((part, index) => {
    const next = parts[index + 1]
    const [from, to] = [held[index] ?? 0, held[index + 1] ?? 0]
    if (next === undefined || from === to) return
    const reach = Math.min(FADE, (part.to - part.from) / 2, (next.to - next.from) / 2)
    const steps = Math.max(1, Math.round((2 * reach) / STEP_SECONDS))
    for (let step = 1; step <= steps; step++) {
      gains.push({ time: part.to - reach + (step * 2 * reach) / steps, db: from + (step / steps) * (to - from) })
    }
  })
  return gains
}

export const curveOf = (gains: ReadonlyArray<Gain>): string =>
  gains.map(({ time, db }) => `${time.toFixed(4)} volume volume ${(10 ** (db / 20)).toFixed(6)}`).join(";")

// Each part takes the gain in force when it starts, so its first moment is never left without a gain.
export const partGainsOf = (gains: ReadonlyArray<Gain>, parts: ReadonlyArray<Part & PartLevel>): ReadonlyArray<PartGains> =>
  parts.map((part) => {
    const opening = gains.findLast(({ time }) => time <= part.from + TIME_EPSILON) ?? gains[0]
    const inside = gains.filter(({ time }) => time > part.from + TIME_EPSILON && time < part.to - TIME_EPSILON)
    const toSource = (time: number): number => Number((part.start + time - part.from).toFixed(4))
    return {
      video: part.video,
      from: part.start,
      to: toSource(part.to),
      gains: [...(opening === undefined ? [] : [{ time: part.start, db: opening.db }]), ...inside.map(({ time, db }) => ({ time: toSource(time), db }))]
    }
  })

export const levelArgs = (source: string, curve: string, output: string, streams: Streams): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", source,
  ...streamMaps(streams),
  "-af", `aresample=${SAMPLE_RATE},asetnsamples=n=${FRAME_SAMPLES}:p=0,asendcmd=f=${curve},volume=1,alimiter=limit=${LIMIT_LINEAR}:attack=5:release=50:level=disabled`,
  "-c:a", "aac", "-b:a", "192k", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]
