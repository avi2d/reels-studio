import { Effect, FileSystem, Option } from "effect"
import type { Rgb, VideoColour } from "../shared/reel.ts"
import type { Gaze, Head } from "../shared/timeline.ts"
import { TO_RGB, type Part } from "./media-commands.ts"
import { places, readGaze, tool, type Job } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const BAND_TOP = 0.1
const BAND_BOTTOM = 0.3
const BAND_HALF_WIDTH = 0.3
const SKIN_SAMPLES = 15
const LOWEST_GAIN = 0.8
const HIGHEST_GAIN = 1.25

export interface SkinSample {
  readonly time: number
  readonly head: Head
}

const share = (value: number): string => value.toFixed(4)

// A head is in shares of the frame height on both axes, so ih scales every side of the box.
export const skinCrop = (head: Head): string => {
  const left = head.x - BAND_HALF_WIDTH * head.size
  const top = head.y + BAND_TOP * head.size
  const width = 2 * BAND_HALF_WIDTH * head.size
  const height = (BAND_BOTTOM - BAND_TOP) * head.size
  return `crop=w=${share(width)}*ih:h=${share(height)}*ih:x=${share(left)}*ih:y=${share(top)}*ih`
}

export const skinSamples = (gaze: Gaze, count: number): ReadonlyArray<SkinSample> => {
  const seen = (gaze.heads ?? []).flatMap((head, index) => head === null ? [] : [{ time: index * gaze.step, head }])
  const taken = Math.min(count, seen.length)
  return Array.from({ length: taken }, (_, slot) => seen[Math.floor((slot + 0.5) * seen.length / taken)]).filter((sample) => sample !== undefined)
}

const skinArgs = (preview: string, sample: SkinSample, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-ss", sample.time.toFixed(3), "-i", preview,
  "-frames:v", "1", "-vf", `${TO_RGB},format=rgb24,${skinCrop(sample.head)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", output
]

// Each chunk holds whole pixels of three bytes, red, green and blue.
const medianOf = (chunks: ReadonlyArray<Uint8Array>, channel: 0 | 1 | 2): number | undefined => {
  const histogram = new Array<number>(256).fill(0)
  let total = 0
  for (const chunk of chunks) {
    for (let at = channel; at < chunk.length - (chunk.length % 3); at += 3) {
      const level = chunk[at] ?? 0
      histogram[level] = (histogram[level] ?? 0) + 1
      total += 1
    }
  }
  let seen = 0
  for (const [level, count] of histogram.entries()) {
    seen += count
    if (seen * 2 >= total && total > 0) return level
  }
  return undefined
}

export const skinOf = (chunks: ReadonlyArray<Uint8Array>): Rgb | undefined => {
  const r = medianOf(chunks, 0)
  const g = medianOf(chunks, 1)
  const b = medianOf(chunks, 2)
  return r === undefined || g === undefined || b === undefined || r === 0 || g === 0 || b === 0 ? undefined : { r, g, b }
}

const clampGain = (value: number): number => Math.min(HIGHEST_GAIN, Math.max(LOWEST_GAIN, value))

export const gainTo = (reference: Rgb, skin: Rgb): Rgb => ({
  r: clampGain(reference.r / skin.r),
  g: clampGain(reference.g / skin.g),
  b: clampGain(reference.b / skin.b)
})

export interface MeasuredVideo {
  readonly video: string
  readonly skin: Rgb | undefined
}

export const coloursOf = (videos: ReadonlyArray<MeasuredVideo>): ReadonlyArray<VideoColour> => {
  const reference = videos.find((one) => one.skin !== undefined)
  return videos.map(({ video, skin }): VideoColour => {
    if (skin === undefined || reference?.skin === undefined) return { video, state: "unmeasured" }
    if (video === reference.video) return { video, state: "reference", skin }
    return { video, state: "matched", skin, gain: gainTo(reference.skin, skin) }
  })
}

export const gainOf = (colours: ReadonlyArray<VideoColour>, video: string): Rgb | undefined => {
  const colour = colours.find((one) => one.video === video)
  return colour?.state === "matched" ? colour.gain : undefined
}

export interface ColourJoin {
  readonly end: Part
  readonly start: Part
}

export const colourJoins = (parts: ReadonlyArray<Part>): ReadonlyArray<ColourJoin> => {
  const joins: Array<ColourJoin> = []
  parts.forEach((start, index) => {
    const end = parts[index - 1]
    if (end === undefined || end.video === start.video) return
    const shown = joins.some((join) => new Set([join.end.video, join.start.video, end.video, start.video]).size === 2)
    if (!shown) joins.push({ end, start })
  })
  return joins
}

export const measureSkin = Effect.fnUntraced(function*(job: Job, work: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const gaze = Option.getOrUndefined(yield* Effect.option(readGaze(job)))
  if (gaze === undefined) return undefined
  const chunks: Array<Uint8Array> = []
  for (const [index, sample] of skinSamples(gaze, SKIN_SAMPLES).entries()) {
    const output = `${work}/skin-${index}.rgb`
    yield* tool("ffmpeg", skinArgs(places(job).preview, sample, output), settings.heavy)
    chunks.push(yield* fs.readFile(output))
    yield* fs.remove(output)
  }
  return skinOf(chunks)
}, Effect.catchTag("ToolFailed", (error) => Effect.as(Effect.logError("the skin colour was not measured", error), undefined)))
