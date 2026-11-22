import { REEL_RATE } from "./media-commands.ts"
import { inputOf, overlayGraph, type InsertLayer } from "./insert-commands.ts"

// The captions go after the last overlay, so a picture never covers a word.
const finishGraph = (layers: ReadonlyArray<InsertLayer>, captions: string | undefined): string => {
  const last = `${captions === undefined ? "" : `,${captions}`},format=yuv420p[out]`
  if (layers.length === 0) return `[0:v]null${last}`
  return overlayGraph(layers, last)
}

export const finishArgs = (reel: string, layers: ReadonlyArray<InsertLayer>, captions: string | undefined, encoder: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", reel,
  ...layers.flatMap(inputOf),
  "-filter_complex", finishGraph(layers, captions), "-map", "[out]", "-map", "0:a:0",
  "-c:v", encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", String(REEL_RATE * 2),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "copy", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]
