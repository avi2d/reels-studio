import { INSERT_DRIFT, INSERT_FADE, type Shape } from "../shared/inserts.ts"
import { FRAME } from "../shared/zones.ts"
import { even, REEL_RATE } from "./media-commands.ts"

export interface InsertPicture {
  readonly file: string
  readonly shape: Shape
  readonly width: number
  readonly height: number
  readonly start: number
  readonly end: number
}

const CARD_BOX = { left: 65, top: 269, width: 950, height: 979 }
const CARD_BORDER = 12

const cardSize = (width: number, height: number): { readonly width: number; readonly height: number } => {
  const room = { width: CARD_BOX.width - 2 * CARD_BORDER, height: CARD_BOX.height - 2 * CARD_BORDER }
  const scale = Math.min(room.width / width, room.height / height)
  return { width: even(width * scale), height: even(height * scale) }
}

// zoompan steps by whole pixels, so the picture goes in at twice the size it leaves at and the slow zoom does not shake.
const drift = (width: number, height: number, frames: number): string =>
  `trim=end_frame=1,scale=${2 * width}:${2 * height}:force_original_aspect_ratio=increase,crop=${2 * width}:${2 * height},setsar=1,` +
  `zoompan=z='1+${INSERT_DRIFT}*on/${Math.max(1, frames)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${Math.max(1, frames)}:s=${width}x${height}:fps=${REEL_RATE}`

const insertFilter = (picture: InsertPicture, index: number): { readonly layer: string; readonly x: number; readonly y: number } => {
  const seconds = picture.end - picture.start
  const frames = Math.round(seconds * REEL_RATE)
  const fade = Math.min(INSERT_FADE, seconds / 2)
  const fades = `format=yuva420p,fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(seconds - fade).toFixed(4)}:d=${fade}:alpha=1`
  const timed = `setpts=PTS-STARTPTS+${picture.start.toFixed(4)}/TB`
  if (picture.shape === "fill") {
    return { layer: `[${index + 1}:v]${drift(FRAME.width, FRAME.height, frames)},${fades},${timed}[p${index}]`, x: 0, y: 0 }
  }
  const card = cardSize(picture.width, picture.height)
  const outer = { width: card.width + 2 * CARD_BORDER, height: card.height + 2 * CARD_BORDER }
  const framed = `pad=${outer.width}:${outer.height}:${CARD_BORDER}:${CARD_BORDER}:color=white`
  return {
    layer: `[${index + 1}:v]${drift(card.width, card.height, frames)},${framed},${fades},${timed}[p${index}]`,
    x: CARD_BOX.left + Math.round((CARD_BOX.width - outer.width) / 2),
    y: CARD_BOX.top + Math.round((CARD_BOX.height - outer.height) / 2)
  }
}

// The captions go after the last overlay, so a picture never covers a word.
const finishGraph = (pictures: ReadonlyArray<InsertPicture>, captions: string | undefined): string => {
  const last = `${captions === undefined ? "" : `,${captions}`},format=yuv420p[out]`
  if (pictures.length === 0) return `[0:v]null${last}`
  return pictures.map((picture, index) => {
    const { layer, x, y } = insertFilter(picture, index)
    const under = index === 0 ? "[0:v]" : `[v${index}]`
    const over = `${under}[p${index}]overlay=${x}:${y}:eof_action=pass:enable='between(t,${picture.start.toFixed(4)},${picture.end.toFixed(4)})'`
    return `${layer};${over}${index === pictures.length - 1 ? last : `[v${index + 1}]`}`
  }).join(";")
}

export const finishArgs = (reel: string, pictures: ReadonlyArray<InsertPicture>, captions: string | undefined, encoder: string, output: string): ReadonlyArray<string> => [
  "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", reel,
  ...pictures.flatMap((picture) => ["-i", picture.file]),
  "-filter_complex", finishGraph(pictures, captions), "-map", "[out]", "-map", "0:a:0",
  "-c:v", encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", String(REEL_RATE * 2),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "copy", "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
]
