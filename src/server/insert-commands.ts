import { INSERT_DRIFT, INSERT_FADE, type Shape } from "../shared/inserts.ts"
import { even, REEL_RATE, TO_SDR } from "./media-commands.ts"

interface InsertPlacement {
  readonly file: string
  readonly shape: Shape
  readonly width: number
  readonly height: number
  readonly start: number
  readonly end: number
}

export type InsertLayer =
  | InsertPlacement & { readonly kind: "still" }
  | InsertPlacement & { readonly kind: "clip"; readonly from: number; readonly hdr: boolean; readonly sound: boolean }

const FRAME = { width: 1080, height: 1920 }
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

// A clip shorter than its phrase holds its last frame, so it still fades out instead of vanishing.
const moving = (layer: InsertLayer & { readonly kind: "clip" }, width: number, height: number): string => {
  const seconds = (layer.end - layer.start).toFixed(4)
  return `${layer.hdr ? `${TO_SDR},` : ""}tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},fps=${REEL_RATE},` +
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
}

const fadeOf = (layer: InsertLayer): number => Math.min(INSERT_FADE, (layer.end - layer.start) / 2)

const insertFilter = (layer: InsertLayer, index: number): { readonly layer: string; readonly x: number; readonly y: number } => {
  const seconds = layer.end - layer.start
  const frames = Math.round(seconds * REEL_RATE)
  const fade = fadeOf(layer)
  const fades = `format=yuva420p,fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(seconds - fade).toFixed(4)}:d=${fade}:alpha=1`
  const timed = `setpts=PTS-STARTPTS+${layer.start.toFixed(4)}/TB`
  const body = (width: number, height: number): string => layer.kind === "clip" ? moving(layer, width, height) : drift(width, height, frames)
  if (layer.shape === "fill") {
    return { layer: `[${index + 1}:v]${body(FRAME.width, FRAME.height)},${fades},${timed}[p${index}]`, x: 0, y: 0 }
  }
  const card = cardSize(layer.width, layer.height)
  const outer = { width: card.width + 2 * CARD_BORDER, height: card.height + 2 * CARD_BORDER }
  const framed = `pad=${outer.width}:${outer.height}:${CARD_BORDER}:${CARD_BORDER}:color=white`
  return {
    layer: `[${index + 1}:v]${body(card.width, card.height)},${framed},${fades},${timed}[p${index}]`,
    x: CARD_BOX.left + Math.round((CARD_BOX.width - outer.width) / 2),
    y: CARD_BOX.top + Math.round((CARD_BOX.height - outer.height) / 2)
  }
}

const pictureGraph = (layers: ReadonlyArray<InsertLayer>): string =>
  layers.map((one, index) => {
    const { layer, x, y } = insertFilter(one, index)
    const under = index === 0 ? "[0:v]" : `[v${index}]`
    const over = `${under}[p${index}]overlay=${x}:${y}:eof_action=pass:enable='between(t,${one.start.toFixed(4)},${one.end.toFixed(4)})'`
    return `${layer};${over}${index === layers.length - 1 ? ",format=yuv420p[out]" : `[v${index + 1}]`}`
  }).join(";")

const CLIP_PEAK = 0.84

const soundGraph = (layers: ReadonlyArray<InsertLayer>): string | undefined => {
  const heard = layers.flatMap((layer, index) => layer.kind === "clip" && layer.sound ? [{ layer, input: index + 1 }] : [])
  if (heard.length === 0) return undefined
  const lanes = heard.map(({ layer, input }, lane) => {
    const fade = fadeOf(layer)
    const seconds = layer.end - layer.start
    return `[${input}:a]aresample=48000,afade=t=in:st=0:d=${fade},afade=t=out:st=${(seconds - fade).toFixed(4)}:d=${fade},adelay=${Math.round(layer.start * 1000)}:all=1[s${lane}]`
  })
  const mixed = `[0:a]${heard.map((_, lane) => `[s${lane}]`).join("")}amix=inputs=${heard.length + 1}:duration=first:normalize=0,alimiter=limit=${CLIP_PEAK}:level=0[aout]`
  return [...lanes, mixed].join(";")
}

const inputOf = (layer: InsertLayer): ReadonlyArray<string> =>
  layer.kind === "clip" ? ["-ss", layer.from.toFixed(3), "-t", (layer.end - layer.start).toFixed(3), "-i", layer.file] : ["-i", layer.file]

// A seek at or past the clip's last frame gives no frame, and tpad then has none to hold.
// The step back is wider than a frame of any usual rate, and wider than the seek's rounding to milliseconds.
const LAST_FRAME_BACK = 0.5

export const clipFrom = (start: number, duration: number | undefined): number =>
  duration === undefined ? start : Math.min(start, Math.max(0, duration - LAST_FRAME_BACK))

export const insertArgs = (reel: string, layers: ReadonlyArray<InsertLayer>, encoder: string, output: string): ReadonlyArray<string> => {
  const sound = soundGraph(layers)
  return [
    "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", reel,
    ...layers.flatMap(inputOf),
    "-filter_complex", sound === undefined ? pictureGraph(layers) : `${pictureGraph(layers)};${sound}`,
    "-map", "[out]", ...(sound === undefined ? ["-map", "0:a:0"] : ["-map", "[aout]"]),
    "-c:v", encoder, "-profile:v", "high", "-b:v", "10M", "-maxrate", "12M", "-bufsize", "24M", "-g", String(REEL_RATE * 2),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    ...(sound === undefined ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]), "-map_metadata", "-1", "-movflags", "+faststart", "-f", "mp4", output
  ]
}
