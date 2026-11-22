import { SILENCE_LUFS } from "../shared/reel.ts"

// The reference meter is ebur128 (EBU Tech 3341). loudnorm reads about 0.9 LU low on the same audio, so it is not used to report.
type Segment = { readonly start: number; readonly seconds: number }

export const measureArgs = (source: string, segment?: Segment, repeats = 0): ReadonlyArray<string> => [
  "-hide_banner", "-nostats",
  ...(segment === undefined ? [] : ["-ss", segment.start.toFixed(4), "-t", segment.seconds.toFixed(6)]),
  ...(repeats > 0 ? ["-stream_loop", String(repeats)] : []),
  "-i", source, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"
]

// ebur128 gives no integrated reading for a part under one 0.4 s block, and a reading that reaches past the part mixes in its neighbours.
// So a short part is measured on its own, played over until it fills a few blocks.
const PART_MEASURE_SECONDS = 1.2

export const repeatsFor = (seconds: number): number =>
  seconds <= 0 ? 0 : Math.max(0, Math.ceil(PART_MEASURE_SECONDS / seconds - 1e-9) - 1)

export interface Reading {
  readonly lufs: number
  readonly lra: number
  readonly truePeak: number
}

const NUMBER = "(-?\\d+(?:\\.\\d+)?|-inf)"
const summaryPattern = new RegExp(`Integrated loudness:\\s+I:\\s+${NUMBER} LUFS[\\s\\S]*?LRA:\\s+${NUMBER} LU[\\s\\S]*?True peak:\\s+Peak:\\s+${NUMBER} dBFS`)

const finiteOr = (text: string, fallback: number): number => {
  const value = Number(text)
  return Number.isFinite(value) ? value : fallback
}

export const readingOf = (stderr: string): Reading | undefined => {
  const match = summaryPattern.exec(stderr.slice(stderr.lastIndexOf("Summary:")))
  if (match === null) return undefined
  return { lufs: finiteOr(match[1] ?? "", SILENCE_LUFS), lra: finiteOr(match[2] ?? "", 0), truePeak: finiteOr(match[3] ?? "", SILENCE_LUFS) }
}

export const envelopeArgs = (source: string, metadata: string): ReadonlyArray<string> => [
  "-hide_banner", "-nostats", "-i", source, "-map", "0:a:0",
  "-af", `ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S:file=${metadata}`, "-f", "null", "-"
]

// The chart draws the 3 s short-term level, which the gap a removed pause leaves does not drag down the way a 0.4 s momentary reading does.
const SHORT_TERM_SECONDS = 3

export interface Moment {
  readonly time: number
  readonly lufs: number
}

export const momentsOf = (text: string): ReadonlyArray<Moment> => {
  const moments: Array<Moment> = []
  let time: number | undefined
  for (const line of text.split("\n")) {
    const stamp = /pts_time:(\S+)/.exec(line)
    if (stamp !== null) {
      time = Number(stamp[1])
      continue
    }
    const value = /^lavfi\.r128\.S=(\S+)$/.exec(line.trim())
    // A reading covers the 3 s that end at its stamp, so it stands at the middle of that span.
    if (value !== null && time !== undefined) moments.push({ time: time - SHORT_TERM_SECONDS / 2, lufs: finiteOr(value[1] ?? "", SILENCE_LUFS) })
  }
  return moments
}

// Each sample takes the last moment at or before its time, so a sample never reads ahead of the audio.
export const sampledAt = (moments: ReadonlyArray<Moment>, step: number, seconds: number): ReadonlyArray<number> => {
  const count = Math.floor(seconds / step) + 1
  const values: Array<number> = []
  let index = 0
  for (let sample = 0; sample < count; sample++) {
    const at = sample * step
    while (index + 1 < moments.length && (moments[index + 1]?.time ?? Infinity) <= at) index++
    values.push(Math.max(SILENCE_LUFS, moments[index]?.lufs ?? SILENCE_LUFS))
  }
  return values
}
