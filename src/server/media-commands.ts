import type { Transcript } from "../shared/plan.ts"

const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"])

export const isHdr = (transfer: string | undefined): boolean => transfer !== undefined && HDR_TRANSFERS.has(transfer)

const TO_SDR = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"

export const probeArgs = (source: string): ReadonlyArray<string> =>
  ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "json", source]

export interface PrepareFiles {
  readonly source: string
  readonly wav: string
  readonly preview: string
}

export const prepareArgs = (files: PrepareFiles, hdr: boolean, encoder: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", files.source,
  "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", files.wav,
  "-map", "0:v:0", "-map", "0:a:0", "-vf", `fps=30,scale=540:-2,${hdr ? TO_SDR : "format=yuv420p"}`,
  "-c:v", encoder, "-b:v", "1500k", "-c:a", "aac", "-b:a", "96k", "-ac", "1", "-movflags", "+faststart", "-f", "mp4", files.preview
]

const LINE_PAUSE = 0.1
const NAMED_PAUSE = 1

export const transcriptText = (video: string, transcript: Transcript): string => {
  const lines: Array<string> = []
  let open: { start: number; end: number; words: Array<string> } | undefined
  const close = (): void => {
    if (open !== undefined) lines.push(`[${open.start.toFixed(2)}-${open.end.toFixed(2)}] ${open.words.join(" ")}`)
    open = undefined
  }
  transcript.words.forEach((word, index) => {
    const pause = word.start - (open?.end ?? 0)
    if (pause > LINE_PAUSE) close()
    if (open === undefined && pause >= NAMED_PAUSE) lines.push(`(pause ${pause.toFixed(1)} s)`)
    open = { start: open?.start ?? word.start, end: word.end, words: [...(open?.words ?? []), `${index}:${word.text}`] }
  })
  close()
  const tail = transcript.duration - (transcript.words.at(-1)?.end ?? 0)
  if (tail >= NAMED_PAUSE) lines.push(`(pause ${tail.toFixed(1)} s)`)
  return [
    `Video ${video}, ${transcript.duration.toFixed(1)} s. Each line is one stretch of speech with its start and end in seconds.`,
    "Each word is written as number:word. A plan names the words to remove by these numbers.",
    "",
    ...lines
  ].join("\n") + "\n"
}
