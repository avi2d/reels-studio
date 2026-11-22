import { phraseSpan } from "./inserts.ts"
import type { Span, Transcript } from "./plan.ts"
import type { ShownWord } from "./subtitles.ts"
import type { PlannedText, TextLine } from "./texts.ts"
import type { Clip } from "./timeline.ts"
import { fitsArea, textAreaOf, type Rect } from "./zones.ts"

export interface ShownText extends Span {
  readonly id: string
  readonly lines: ReadonlyArray<TextLine>
}

export interface CaptionWord extends ShownWord {
  readonly size?: number
}

export interface Captions {
  readonly words: ReadonlyArray<CaptionWord>
  readonly texts: ReadonlyArray<ShownText>
}

export const NO_CAPTIONS: Captions = { words: [], texts: [] }

const TEXT_SHORTEST = 2.5
const MOST_LINES = 3

export type TextDrop = "unknown-video" | "out-of-range" | "cut" | "empty" | "covered"

export type TextPlace =
  | { readonly planned: PlannedText; readonly state: "shown"; readonly shown: ShownText }
  | { readonly planned: PlannedText; readonly state: "dropped"; readonly reason: TextDrop }

const wantedOf = (one: PlannedText, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>, total: number): ShownText | Exclude<TextDrop, "covered"> => {
  const transcript = transcripts.get(one.video)
  if (transcript === undefined) return "unknown-video"
  if (transcript.words[one.from] === undefined || transcript.words[one.to] === undefined || one.from > one.to) return "out-of-range"
  const said = phraseSpan(clips, transcript, one)
  if (said === undefined) return "cut"
  const lines = one.lines.filter((line) => line.text.trim() !== "").slice(0, MOST_LINES)
  if (lines.length === 0) return "empty"
  return { id: one.id, lines, start: said.start, end: Math.min(total, Math.max(said.end, said.start + TEXT_SHORTEST)) }
}

// A later text starts where the earlier one ends, so two key thoughts never stand on the screen at once.
export const textPlaces = (planned: ReadonlyArray<PlannedText>, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>): ReadonlyArray<TextPlace> => {
  const total = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0)
  const wanted = planned.map((one) => wantedOf(one, clips, transcripts, total))
  const byStart = wanted.flatMap((one, index) => typeof one === "string" ? [] : [{ one, index }]).toSorted((left, right) => left.one.start - right.one.start)
  const placed = new Map<number, ShownText | "covered">()
  let shownEnd = 0
  for (const { one, index } of byStart) {
    const start = Math.max(one.start, shownEnd)
    if (one.end <= start) {
      placed.set(index, "covered")
      continue
    }
    placed.set(index, { ...one, start })
    shownEnd = one.end
  }
  return planned.map((one, index): TextPlace => {
    const place = placed.get(index) ?? wanted[index]
    return typeof place === "object" ? { planned: one, state: "shown", shown: place } : { planned: one, state: "dropped", reason: place ?? "covered" }
  })
}

export const shownTexts = (planned: ReadonlyArray<PlannedText>, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>): ReadonlyArray<ShownText> =>
  textPlaces(planned, clips, transcripts).flatMap((place) => place.state === "shown" ? [place.shown] : []).toSorted((left, right) => left.start - right.start)

interface Face {
  readonly name: string
  readonly size: number
  readonly colour: string
  readonly italic: boolean
  readonly ascent: number
  readonly rise: number
  readonly drop: number
}

// ascent is the share of the font size above the baseline in libass's line box; rise and drop are the ink above and below it.
const FACES = {
  word: { name: "Noto Serif Display", size: 78, colour: "&H00FDFCFE", italic: false, ascent: 0.785, rise: 0.52, drop: 0.17 },
  context: { name: "Noto Serif Display Condensed", size: 100, colour: "&H00FDFCFE", italic: false, ascent: 0.785, rise: 0.52, drop: 0.17 },
  accent: { name: "Reels Accent", size: 230, colour: "&H00CEC3F1", italic: true, ascent: 0.812, rise: 0.53, drop: 0.12 }
} as const satisfies Readonly<Record<string, Face>>

const LINE_GAP = 12
const TEXT_INDENT = 28
const TEXT_DROP = 8
const WORD_LIFT = 24
const LINE_STAGGER = 0.3
const FADE_IN = 250
const FADE_OUT = 200

const clock = (seconds: number): string => {
  const centis = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centis / 360_000)
  const minutes = Math.floor(centis / 6000) % 60
  const rest = (centis % 6000) / 100
  return `${hours}:${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`
}

const plain = (text: string): string => text.replace(/[{}\\]/gu, "").replace(/\s+/gu, " ").trim()

const styleLine = (role: keyof typeof FACES): string => {
  const face = FACES[role]
  return `Style: ${role},${face.name},${face.size},${face.colour},${face.colour},&H00000000,&H00000000,0,${face.italic ? -1 : 0},0,0,100,100,0,0,1,0,0,7,0,0,0,1`
}

const header = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  ...(["word", "context", "accent"] as const).map(styleLine), "",
  "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
]

const event = (span: Span, role: keyof typeof FACES, tags: string, text: string): string =>
  `Dialogue: 0,${clock(span.start)},${clock(span.end)},${role},,0,0,0,,{${tags}}${plain(text)}`

export const fitWord = (word: CaptionWord, ink: Rect): CaptionWord => {
  const area = textAreaOf("Instagram")
  if (fitsArea(ink, area)) return word
  const right = area.buttons !== undefined && ink.bottom > area.buttons.top ? area.buttons.left : area.box.right
  const ratio = Math.min(1, (540 - area.box.left) / (540 - ink.left), (right - 540) / (ink.right - 540))
  return { ...word, size: Math.max(1, Math.floor((word.size ?? FACES.word.size) * ratio) - 1) }
}

const wordEvents = (words: ReadonlyArray<CaptionWord>, box: Rect): ReadonlyArray<string> =>
  words.map((word) => {
    const face = FACES.word
    const size = word.size ?? face.size
    const baseline = box.bottom - WORD_LIFT - Math.round(face.drop * size)
    const top = baseline - Math.round(face.ascent * size)
    return event(word, "word", `\\an8\\pos(540,${top})${word.size === undefined ? "" : `\\fs${size}`}`, word.text)
  })

const textEvents = (text: ShownText, box: Rect): ReadonlyArray<string> => {
  let baseline = box.top + TEXT_DROP
  let below = 0
  return text.lines.map((line, index) => {
    const face = line.accent ? FACES.accent : FACES.context
    baseline += below + (index === 0 ? 0 : LINE_GAP) + Math.round(face.rise * face.size)
    below = Math.round(face.drop * face.size)
    const top = baseline - Math.round(face.ascent * face.size)
    const span = { start: Math.min(text.end, text.start + index * LINE_STAGGER), end: text.end }
    return event(span, line.accent ? "accent" : "context", `\\an7\\pos(${box.left + TEXT_INDENT},${top})\\fad(${FADE_IN},${FADE_OUT})`, line.text)
  })
}

export type CaptionPart = "words" | "texts"

export const assOf = (captions: Captions, parts: ReadonlyArray<CaptionPart> = ["words", "texts"]): string => {
  const { box } = textAreaOf("Instagram")
  return [
    ...header,
    ...(parts.includes("texts") ? captions.texts.flatMap((text) => textEvents(text, box)) : []),
    ...(parts.includes("words") ? wordEvents(captions.words, box) : [])
  ].join("\n") + "\n"
}

export const hasCaptions = (captions: Captions): boolean => captions.words.length > 0 || captions.texts.length > 0
