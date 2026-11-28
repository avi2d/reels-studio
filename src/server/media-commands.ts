import { unsureIndexes } from "../shared/doubts.ts"
import type { Transcript } from "../shared/plan.ts"
import { SILENCE_LUFS } from "../shared/reel.ts"
import { CLOSE_UP_FROM_SECONDS } from "../shared/retouch.ts"
import type { Rgb } from "../shared/reel.ts"
import { cameraShare, FADE, type Clip, type Frame, type Gaze } from "../shared/timeline.ts"

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

export const clipPreviewArgs = (source: string, preview: string, hdr: boolean, encoder: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", source,
  "-map", "0:v:0", "-map", "0:a:0?", "-vf", videoFilter(hdr),
  "-c:v", encoder, "-b:v", "1500k", "-g", String(KEY_FRAME_EVERY), "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-f", "mp4", preview
]

export const REEL_RATE = 30

export interface Part {
  readonly video: string
  readonly start: number
  readonly frames: number
  readonly frame?: Frame
}

// Each part lasts whole frames, so its sound and its picture end together and the joined reel does not drift.
export const partsOf = (clips: ReadonlyArray<Clip>): ReadonlyArray<Part> =>
  clips.flatMap((clip) => {
    const first = Math.round(clip.start * REEL_RATE)
    const frames = Math.round(clip.end * REEL_RATE) - first
    if (frames <= 0) return []
    const part = { video: clip.video, start: first / REEL_RATE, frames }
    return [clip.frame === undefined ? part : { ...part, frame: clip.frame }]
  })

export const onFrames = (clips: ReadonlyArray<Clip>): ReadonlyArray<Clip> =>
  clips.flatMap((clip) => {
    const first = Math.round(clip.start * REEL_RATE)
    const last = Math.round(clip.end * REEL_RATE)
    return last > first ? [{ ...clip, start: first / REEL_RATE, end: last / REEL_RATE }] : []
  })

export const secondsOf = (parts: ReadonlyArray<Part>): number =>
  parts.reduce((total, part) => total + part.frames, 0) / REEL_RATE

export const sameParts = (left: ReadonlyArray<Part>, right: ReadonlyArray<Part>): boolean =>
  left.length === right.length && left.every((part, index) => {
    const other = right[index]
    return other !== undefined && other.video === part.video && other.start === part.start && other.frames === part.frames &&
      sameFrame(other.frame, part.frame)
  })

const sameFrame = (left: Frame | undefined, right: Frame | undefined): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.scale === right.scale && left.left === right.left && left.top === right.top

const REEL_WIDTH = 1080
const REEL_HEIGHT = 1920

export const even = (value: number): number => Math.max(2, Math.ceil(value / 2) * 2)

// One scale to the enlarged size and one crop, since cropping the 1080 by 1920 picture and scaling it again resamples twice.
// With a face the source is wider than the window, so scaling to the crop height makes the picture exactly `height` high.
const reelVideo = (frame: Frame | undefined, faceLeft: number | undefined): string => {
  if (frame === undefined && faceLeft === undefined) return `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=increase,crop=${REEL_WIDTH}:${REEL_HEIGHT},setsar=1`
  const scale = frame?.scale ?? 1
  const width = REEL_WIDTH * scale
  const height = REEL_HEIGHT * scale
  const left = frame?.left ?? 0
  const top = frame?.top ?? 0
  const across = faceLeft === undefined ? `(iw-${width.toFixed(2)})/2+${(left * height).toFixed(2)}` : ((faceLeft + left) * height).toFixed(2)
  return [
    `scale=${even(width)}:${even(height)}:force_original_aspect_ratio=increase`,
    `crop=${REEL_WIDTH}:${REEL_HEIGHT}:${across}:(ih-${height.toFixed(2)})/2+${(top * height).toFixed(2)}`,
    "setsar=1"
  ].join(",")
}

export const TO_RGB = "scale=in_color_matrix=bt709:in_range=tv:out_range=pc"

const gainFilter = (gain: Rgb): string =>
  `${TO_RGB},format=gbrpf32le,colorchannelmixer=rr=${gain.r.toFixed(4)}:gg=${gain.g.toFixed(4)}:bb=${gain.b.toFixed(4)},scale=in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p`

export interface Look {
  readonly hdr: boolean
  readonly gain: Rgb | undefined
  readonly faceLeft?: number | undefined
}

const lookFilter = (look: Look, frame: Frame | undefined): string =>
  [look.hdr ? TO_SDR : "format=yuv420p", ...(look.gain === undefined ? [] : [gainFilter(look.gain)]), reelVideo(frame, look.faceLeft)].join(",")

export const fadesOf = (seconds: number): string => {
  const fade = Math.min(FADE, seconds / 2)
  return `afade=t=in:d=${fade},afade=t=out:st=${(seconds - fade).toFixed(4)}:d=${fade}`
}

export const partArgs = (source: string, part: Part, look: Look, encoder: string, output: string): ReadonlyArray<string> => {
  const seconds = part.frames / REEL_RATE
  return [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y",
    "-ss", part.start.toFixed(4), "-i", source,
    "-map", "0:v:0", "-map", "0:a:0", "-frames:v", String(part.frames), "-t", seconds.toFixed(6),
    "-vf", `fps=${REEL_RATE},${lookFilter(look, part.frame)}`, "-af", fadesOf(seconds),
    "-c:v", encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", String(REEL_RATE * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-f", "mov", output
  ]
}

export const firstSeconds = (parts: ReadonlyArray<Part>, seconds: number): ReadonlyArray<Part> => {
  let left = Math.round(seconds * REEL_RATE)
  return parts.flatMap((part) => {
    const frames = Math.min(part.frames, left)
    left -= frames
    return frames > 0 ? [{ ...part, frames }] : []
  })
}

export const retouchArgs = (looker: string, video: { readonly before: string; readonly folder: string; readonly closeUp: boolean }, encoder: string): ReadonlyArray<string> => [
  "run", "--project", looker, "python", `${looker}/retouch.py`, "--encoder", encoder, ...(video.closeUp ? ["--close-up-from", String(CLOSE_UP_FROM_SECONDS)] : ["--no-close-up"]), video.before, video.folder
]

export const retouchedFrames = (line: string): number | undefined => {
  const match = /^frames=(\d+)$/.exec(line.trim())
  return match?.[1] === undefined ? undefined : Number(match[1])
}

export const compareArgs = (before: string, after: string, encoder: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", before, "-i", after,
  "-filter_complex", "[0:v][1:v]hstack=inputs=2,format=yuv420p[v]", "-map", "[v]", "-map", "0:a:0",
  "-c:v", encoder, "-b:v", "16M", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "copy", "-movflags", "+faststart", "-f", "mp4", output
]

export interface Shot {
  readonly source: string
  readonly time: number
  readonly look: Look
}

export const lastFrameOf = (part: Part): number => part.start + (part.frames - 1) / REEL_RATE

export const pictureArgs = (left: Shot, right: Shot, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y",
  "-ss", left.time.toFixed(4), "-i", left.source, "-ss", right.time.toFixed(4), "-i", right.source,
  "-filter_complex", `[0:v]${lookFilter(left.look, undefined)},scale=540:960[left];[1:v]${lookFilter(right.look, undefined)},scale=540:960[right];[left][right]hstack=inputs=2`,
  "-frames:v", "1", "-q:v", "3", output
]

export const joinList = (names: ReadonlyArray<string>): string =>
  ["ffconcat version 1.0", ...names.map((name) => `file '${name}'`)].join("\n") + "\n"

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
  const unsure = unsureIndexes(transcript)
  return [
    `Video ${video}, ${transcript.duration.toFixed(1)} s. Each line is one stretch of speech with its start and end in seconds.`,
    "Each word is written as number:word. A plan names the words to remove by these numbers.",
    ...unsure.length === 0 ? [] : [`The studio is unsure it heard these words right: ${unsure.join(", ")}.`],
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
