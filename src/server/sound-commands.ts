import type { Noise } from "../shared/noise.ts"
import { partSoundFilter, REEL_RATE, type Part } from "./media-commands.ts"

export const soundPartArgs = (source: string, part: Part, noise: Noise, output: string): ReadonlyArray<string> => {
  const seconds = part.frames / REEL_RATE
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", part.start.toFixed(4), "-i", source,
    "-map", "0:a:0", "-t", seconds.toFixed(6), "-af", partSoundFilter(seconds, noise),
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-map_metadata", "-1", "-f", "wav", output
  ]
}

export type Streams = "picture-and-sound" | "sound"

export const streamMaps = (streams: Streams): ReadonlyArray<string> =>
  streams === "sound" ? ["-map", "0:a:0"] : ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"]

export const joinArgs = (list: string, output: string, streams: Streams): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-i", list,
  ...streamMaps(streams), "-c:a", "aac", "-b:a", "192k",
  "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]
