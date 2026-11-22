import type { Transcript } from "../shared/plan.ts"
import { LOUDNESS_TARGET, SILENCE_LUFS } from "../shared/reel.ts"
import { cameraShare, FADE, type Clip, type Gaze } from "../shared/timeline.ts"

const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"])

export const isHdr = (transfer: string | undefined): boolean => transfer !== undefined && HDR_TRANSFERS.has(transfer)

export const TO_SDR = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"

export const probeArgs = (source: string): ReadonlyArray<string> =>
  ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "json", source]

export interface PrepareFiles {
  readonly source: string
  readonly wav: string
  readonly preview: string
}

// The player decodes from the last key frame on every seek, and ffmpeg's default of one per 250 frames holds each cut for seconds.
export const KEY_FRAME_EVERY = 15

const videoFilter = (hdr: boolean): string => `fps=30,scale=540:-2,${hdr ? TO_SDR : "format=yuv420p"}`

export const prepareArgs = (files: PrepareFiles, hdr: boolean, encoder: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", files.source,
  "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", files.wav,
  "-map", "0:v:0", "-map", "0:a:0", "-vf", videoFilter(hdr),
  "-c:v", encoder, "-b:v", "1500k", "-g", String(KEY_FRAME_EVERY), "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-movflags", "+faststart", "-f", "mp4", files.preview
]

export const refreshArgs = (source: string, preview: string, hdr: boolean, encoder: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", source,
  "-map", "0:v:0", "-map", "0:a:0", "-vf", videoFilter(hdr),
  "-c:v", encoder, "-b:v", "1500k", "-g", String(KEY_FRAME_EVERY), "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-movflags", "+faststart", "-f", "mp4", preview
]

const REEL_RATE = 30

export interface Part {
  readonly video: string
  readonly start: number
  readonly frames: number
}

// Each part lasts whole frames, so its sound and its picture end together and the joined reel does not drift.
export const partsOf = (clips: ReadonlyArray<Clip>): ReadonlyArray<Part> =>
  clips.flatMap((clip) => {
    const first = Math.round(clip.start * REEL_RATE)
    const frames = Math.round(clip.end * REEL_RATE) - first
    return frames > 0 ? [{ video: clip.video, start: first / REEL_RATE, frames }] : []
  })

export const secondsOf = (parts: ReadonlyArray<Part>): number =>
  parts.reduce((total, part) => total + part.frames, 0) / REEL_RATE

export const sameParts = (left: ReadonlyArray<Part>, right: ReadonlyArray<Part>): boolean =>
  left.length === right.length && left.every((part, index) => {
    const other = right[index]
    return other !== undefined && other.video === part.video && other.start === part.start && other.frames === part.frames
  })

const REEL_VIDEO = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"

const fadesOf = (seconds: number): string => {
  const fade = Math.min(FADE, seconds / 2)
  return `afade=t=in:d=${fade},afade=t=out:st=${(seconds - fade).toFixed(4)}:d=${fade}`
}

export const partArgs = (source: string, part: Part, hdr: boolean, encoder: string, output: string): ReadonlyArray<string> => {
  const seconds = part.frames / REEL_RATE
  return [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
    "-ss", part.start.toFixed(4), "-i", source,
    "-map", "0:v:0", "-map", "0:a:0", "-frames:v", String(part.frames), "-t", seconds.toFixed(6),
    "-vf", `fps=${REEL_RATE},${hdr ? TO_SDR : "format=yuv420p"},${REEL_VIDEO}`, "-af", fadesOf(seconds),
    "-c:v", encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", String(REEL_RATE * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-f", "mov", output
  ]
}

export const joinList = (names: ReadonlyArray<string>): string =>
  ["ffconcat version 1.0", ...names.map((name) => `file '${name}'`)].join("\n") + "\n"

export const joinArgs = (list: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-i", list,
  "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
  "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]

export const progressSeconds = (line: string): number | undefined => {
  const match = /^out_time_us=(\d+)$/.exec(line.trim())
  return match?.[1] === undefined ? undefined : Number(match[1]) / 1_000_000
}

export interface RecognizerFiles {
  readonly wav: string
  readonly words: string
}

// onnxruntime offers CoreML first on macOS, and the GigaAM encoder fails there with error code -1 while the CPU provider hears it.
const recognizerProviders = (platform: NodeJS.Platform): ReadonlyArray<string> =>
  platform === "darwin" ? ["--providers", "CPUExecutionProvider"] : []

export const recognizerArgs = (transcriber: string, files: RecognizerFiles, platform: NodeJS.Platform): ReadonlyArray<string> => [
  "run", "--project", transcriber, "python", `${transcriber}/transcribe.py`, ...recognizerProviders(platform), files.wav, files.words
]

const LINE_PAUSE = 0.1
const NAMED_PAUSE = 1

interface Stretch {
  readonly from: number
  readonly to: number
  readonly start: number
  readonly end: number
  readonly before: number
}

const stretchesOf = (transcript: Transcript): ReadonlyArray<Stretch> => {
  const stretches: Array<Stretch> = []
  transcript.words.forEach((word, index) => {
    const open = stretches.at(-1)
    const pause = word.start - (open?.end ?? 0)
    if (open === undefined || pause > LINE_PAUSE) stretches.push({ from: index, to: index, start: word.start, end: word.end, before: pause })
    else stretches[stretches.length - 1] = { ...open, to: index, end: word.end }
  })
  return stretches
}

const spanLabel = (stretch: Stretch): string => `[${stretch.start.toFixed(2)}-${stretch.end.toFixed(2)}]`

export const transcriptText = (video: string, transcript: Transcript): string => {
  const lines = stretchesOf(transcript).flatMap((stretch) => {
    const words = transcript.words.slice(stretch.from, stretch.to + 1).map((word, offset) => `${stretch.from + offset}:${word.text}`)
    const line = `${spanLabel(stretch)} ${words.join(" ")}`
    return stretch.before >= NAMED_PAUSE ? [`(pause ${stretch.before.toFixed(1)} s)`, line] : [line]
  })
  const tail = transcript.duration - (transcript.words.at(-1)?.end ?? 0)
  if (tail >= NAMED_PAUSE) lines.push(`(pause ${tail.toFixed(1)} s)`)
  return [
    `Video ${video}, ${transcript.duration.toFixed(1)} s. Each line is one stretch of speech with its start and end in seconds.`,
    "Each word is written as number:word. A plan names the words to remove by these numbers.",
    "",
    ...lines
  ].join("\n") + "\n"
}

export const gazeText = (video: string, transcript: Transcript, gaze: Gaze): string => {
  const lines = stretchesOf(transcript).map((stretch) => {
    const share = cameraShare(gaze, stretch)
    const look = share === undefined ? "not measured" : `${Math.round(share * 100)}%`
    return `${spanLabel(stretch)} words ${stretch.from}-${stretch.to}: ${look}`
  })
  return [
    `Video ${video}. Each line is one stretch of speech from its transcript, with its word numbers.`,
    "The percent is the share of that stretch in which the speaker looks into the camera.",
    "",
    ...lines
  ].join("\n") + "\n"
}

// The reference meter is ebur128 (EBU Tech 3341). loudnorm reads about 0.9 LU low on the same audio, so it is not used to report.
const CURVE_FLOOR_LUFS = -60
const CURVE_MIN_DB = -20
const CURVE_MAX_DB = 40
// The true peak runs above the sample peak, so the sample ceiling sits 1 dB under the -1.5 dBTP target.
const LIMIT_LINEAR = 0.75

type Segment = { readonly start: number; readonly seconds: number }

export const measureArgs = (source: string, segment?: Segment): ReadonlyArray<string> => [
  "-hide_banner", "-nostats",
  ...(segment === undefined ? [] : ["-ss", segment.start.toFixed(4), "-t", segment.seconds.toFixed(6)]),
  "-i", source, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"
]

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
  "-af", `ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=${metadata}`, "-f", "null", "-"
]

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
    const value = /^lavfi\.r128\.M=(\S+)$/.exec(line.trim())
    if (value !== null && time !== undefined) moments.push({ time, lufs: finiteOr(value[1] ?? "", SILENCE_LUFS) })
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

const gainOf = (lufs: number, offset: number): number => {
  const gain = lufs <= CURVE_FLOOR_LUFS ? 0 : Math.min(CURVE_MAX_DB, Math.max(CURVE_MIN_DB, LOUDNESS_TARGET - lufs))
  return gain + offset
}

export const curveOf = (moments: ReadonlyArray<Moment>, offset: number): string =>
  moments.map(({ time, lufs }) => `${time.toFixed(1)} volume volume ${(10 ** (gainOf(lufs, offset) / 20)).toFixed(6)}`).join(";")

export const levelArgs = (source: string, curve: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", source,
  "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
  "-af", `asendcmd=f=${curve},volume=1,alimiter=limit=${LIMIT_LINEAR}:attack=5:release=50:level=disabled,aresample=48000`,
  "-c:a", "aac", "-b:a", "192k", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]

export interface Span {
  readonly name: "quiet" | "loud"
  readonly from: number
  readonly to: number
}

const PASSAGE_FRAMES = REEL_RATE

export const passagesOf = (parts: ReadonlyArray<Part>, lufs: ReadonlyArray<number>): ReadonlyArray<Span> => {
  const eligible = parts.flatMap((part, index) => {
    const level = lufs[index]
    return part.frames >= PASSAGE_FRAMES && level !== undefined && level > SILENCE_LUFS ? [{ index, lufs: level }] : []
  })
  if (eligible.length < 2) return []
  const quiet = eligible.reduce((best, item) => item.lufs < best.lufs ? item : best)
  const loud = eligible.reduce((best, item) => item.lufs >= best.lufs ? item : best)
  const span = (name: Span["name"], index: number): Span => {
    const from = secondsOf(parts.slice(0, index))
    return { name, from, to: from + (parts[index]?.frames ?? 0) / REEL_RATE }
  }
  return [span("quiet", quiet.index), span("loud", loud.index)]
}
