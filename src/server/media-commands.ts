import type { Transcript } from "../shared/plan.ts"
import { cameraShare, type Gaze } from "../shared/timeline.ts"

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
