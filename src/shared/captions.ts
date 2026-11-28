import { phraseSpan } from "./inserts.ts"
import type { ExampleSubtitles, NamePlate, SubtitleLook, TitlePlace } from "./looks.ts"
import type { Span, Transcript } from "./plan.ts"
import type { ShownWord } from "./subtitles.ts"
import type { PlannedText, TextLine } from "./texts.ts"
import type { Clip } from "./timeline.ts"
import { fitsArea, textAreaOf, type Rect, type TextArea } from "./zones.ts"

export interface ShownText extends Span {
  readonly id: string
  readonly lines: ReadonlyArray<TextLine>
}

export interface CaptionWord extends ShownWord {
  readonly size?: number
}

type FontName = "serif" | "sans"

export interface WordLook {
  readonly font: FontName
  readonly size: number
  readonly colour: string
  readonly outline: string | undefined
  readonly box: string | undefined
  readonly capitals: boolean
}

export interface ShownPlate extends Span {
  readonly text: string
  readonly size?: number
}

export interface Captions {
  readonly words: ReadonlyArray<CaptionWord>
  readonly texts: ReadonlyArray<ShownText>
  readonly look: WordLook
  readonly title: TitlePlace
  readonly plate: ShownPlate | undefined
}

const SIZES = { serif: { normal: 78, large: 104 }, sans: { normal: 84, large: 112 } } as const satisfies Readonly<Record<FontName, Readonly<Record<SubtitleLook["size"], number>>>>

const BRAND_LOOK = { font: "serif", colour: "#fefcfd", outline: "#000000", box: undefined, capitals: false } as const
const PLATE_LOOK = { font: "sans", colour: "#14161c", outline: undefined, box: "#ffd23f", capitals: false } as const

// The example's look stands only while the example is there, so a removed example falls back to the brand look.
export const wordLookOf = (chosen: SubtitleLook, example: ExampleSubtitles | undefined): WordLook => {
  const base = chosen.style === "plate" ? PLATE_LOOK
    : chosen.style === "example" && example !== undefined ? { ...example, outline: example.outline ?? undefined, box: example.box ?? undefined }
      : BRAND_LOOK
  return { ...base, size: SIZES[base.font][chosen.size] }
}

export const NO_CAPTIONS: Captions = { words: [], texts: [], look: wordLookOf({ style: "brand", size: "normal" }, undefined), title: "top", plate: undefined }

const PLATE_SECONDS = 4

// The plate stands over the start of the second part, as the first part usually carries the title.
export const plateOf = (plate: NamePlate, clips: ReadonlyArray<Clip>): ShownPlate | undefined => {
  if (!plate.shown || plate.text.trim() === "" || clips.length === 0) return undefined
  const total = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0)
  const firstBlock = clips[0]?.block
  let at = 0
  let start = 0
  for (const clip of clips) {
    if (clip.block !== firstBlock) {
      start = at
      break
    }
    at += clip.end - clip.start
  }
  return { text: plate.text.trim(), start, end: Math.min(total, start + PLATE_SECONDS) }
}

const TEXT_SHORTEST = 2.5
const MOST_LINES = 3

type TextDrop = "unknown-video" | "out-of-range" | "cut" | "empty" | "covered"

export type TextPlace =
  | { readonly planned: PlannedText; readonly state: "shown"; readonly shown: ShownText }
  | { readonly planned: PlannedText; readonly state: "dropped"; readonly reason: Exclude<TextDrop, "covered"> }
  | { readonly planned: PlannedText; readonly state: "dropped"; readonly reason: "covered"; readonly by: PlannedText }

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
  const wanted = planned.map((one) => ({ planned: one, want: wantedOf(one, clips, transcripts, total) }))
  const byStart = wanted.flatMap(({ planned: from, want }, index) => typeof want === "string" ? [] : [{ one: want, from, index }]).toSorted((left, right) => left.one.start - right.one.start)
  const placed = new Map<number, ShownText | { readonly by: PlannedText }>()
  let last: { readonly end: number; readonly planned: PlannedText } | undefined
  for (const { one, from, index } of byStart) {
    const start = Math.max(one.start, last?.end ?? 0)
    if (last !== undefined && one.end <= start) {
      placed.set(index, { by: last.planned })
      continue
    }
    placed.set(index, { ...one, start })
    last = { end: one.end, planned: from }
  }
  return wanted.map(({ planned: one, want }, index): TextPlace => {
    const place = placed.get(index) ?? want
    if (typeof place === "string") return { planned: one, state: "dropped", reason: place }
    return "by" in place ? { planned: one, state: "dropped", reason: "covered", by: place.by } : { planned: one, state: "shown", shown: place }
  })
}

export const shownTexts = (planned: ReadonlyArray<PlannedText>, clips: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>): ReadonlyArray<ShownText> =>
  textPlaces(planned, clips, transcripts).flatMap((place) => place.state === "shown" ? [place.shown] : []).toSorted((left, right) => left.start - right.start)

interface Metrics {
  readonly name: string
  readonly ascent: number
  readonly rise: number
  readonly drop: number
}

// ascent is the share of the font size above the baseline in libass's line box; rise and drop are the ink above and below it.
const FONTS = {
  serif: { name: "Noto Serif Display", ascent: 0.785, rise: 0.52, drop: 0.17 },
  condensed: { name: "Noto Serif Display Condensed", ascent: 0.785, rise: 0.52, drop: 0.17 },
  accent: { name: "Reels Accent", ascent: 0.812, rise: 0.53, drop: 0.12 },
  sans: { name: "Onest Bold", ascent: 0.784, rise: 0.458, drop: 0.155 }
} as const satisfies Readonly<Record<string, Metrics>>

interface TextFace {
  readonly font: keyof typeof FONTS
  readonly size: number
  readonly colour: string
  readonly italic: boolean
}

const TEXT_FACES = {
  context: { font: "condensed", size: 100, colour: "#fdfcfe", italic: false },
  accent: { font: "accent", size: 230, colour: "#f1c3ce", italic: true }
} as const satisfies Readonly<Record<string, TextFace>>

const PLATE = { size: 50, colour: "#ffffff", box: "#1f2d4d", stripe: "#ffd23f", stripeWidth: 10, above: 200 } as const

const LINE_GAP = 12
const TEXT_INDENT = 28
const TEXT_DROP = 8
const WORD_LIFT = 24
const LINE_STAGGER = 0.3
const FADE_IN = 250
const FADE_OUT = 200
const BOX_TALL = 0.12
const BOX_WIDE = 0.4
const PLATE_TALL = 0.33
const PLATE_WIDE = 0.7
const OUTLINE = 3

const clock = (seconds: number): string => {
  const centis = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centis / 360_000)
  const minutes = Math.floor(centis / 6000) % 60
  const rest = (centis % 6000) / 100
  return `${hours}:${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`
}

const plain = (text: string): string => text.replace(/[{}\\]/gu, "").replace(/\s+/gu, " ").trim()

const assColour = (hex: string): string => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase()

interface Style {
  readonly font: keyof typeof FONTS
  readonly size: number
  readonly colour: string
  readonly italic: boolean
  readonly outline: { readonly colour: string; readonly width: number } | undefined
  readonly box: string | undefined
}

const styleLine = (role: string, style: Style): string => {
  const edge = style.box ?? style.outline?.colour ?? "#000000"
  const border = style.box === undefined ? 1 : 3
  const width = style.box === undefined ? style.outline?.width ?? 0 : 0
  return `Style: ${role},${FONTS[style.font].name},${style.size},${assColour(style.colour)},${assColour(style.colour)},${assColour(edge)},&H00000000,0,${style.italic ? -1 : 0},0,0,100,100,0,0,${border},${width},0,7,0,0,0,1`
}

type Role = "word" | "context" | "accent" | "plate" | "stripe"

const stylesOf = (look: WordLook): ReadonlyArray<string> => [
  styleLine("word", { font: look.font, size: look.size, colour: look.colour, italic: false, outline: look.outline === undefined ? undefined : { colour: look.outline, width: OUTLINE }, box: look.box }),
  ...(["context", "accent"] as const).map((role) => styleLine(role, { ...TEXT_FACES[role], outline: undefined, box: undefined })),
  styleLine("plate", { font: "sans", size: PLATE.size, colour: PLATE.colour, italic: false, outline: undefined, box: PLATE.box }),
  styleLine("stripe", { font: "sans", size: PLATE.size, colour: PLATE.stripe, italic: false, outline: undefined, box: undefined })
]

const header = (look: WordLook): ReadonlyArray<string> => [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  ...stylesOf(look), "",
  "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
]

const event = (span: Span, role: Role, tags: string, text: string, layer = 0): string =>
  `Dialogue: ${layer},${clock(span.start)},${clock(span.end)},${role},,0,0,0,,{${tags}}${text}`

const shrunk = (size: number, ratio: number): number => Math.max(1, Math.floor(size * Math.min(1, ratio)) - 1)

const rightLimit = (area: TextArea, ink: Rect): number =>
  area.buttons !== undefined && ink.bottom > area.buttons.top ? area.buttons.left : area.box.right

export const fitWord = (word: CaptionWord, ink: Rect, base: number): CaptionWord => {
  const area = textAreaOf("Instagram")
  if (fitsArea(ink, area)) return word
  const ratio = Math.min((540 - area.box.left) / (540 - ink.left), (rightLimit(area, ink) - 540) / (ink.right - 540))
  return { ...word, size: shrunk(word.size ?? base, ratio) }
}

export const fitPlate = (plate: ShownPlate, ink: Rect): ShownPlate => {
  const area = textAreaOf("Instagram")
  if (fitsArea(ink, area)) return plate
  const ratio = (rightLimit(area, ink) - area.box.left) / (ink.right - area.box.left)
  return { ...plate, size: shrunk(plate.size ?? PLATE.size, ratio) }
}

const boxTags = (size: number, tall: number, wide: number): string => `\\xbord${Math.round(size * wide)}\\ybord${Math.round(size * tall)}`

const wordEvents = (words: ReadonlyArray<CaptionWord>, look: WordLook, box: Rect): ReadonlyArray<string> =>
  words.map((word) => {
    const metrics = FONTS[look.font]
    const size = word.size ?? look.size
    const pad = look.box === undefined ? 0 : Math.round(size * BOX_TALL)
    const baseline = box.bottom - WORD_LIFT - pad - Math.round(metrics.drop * size)
    const top = baseline - Math.round(metrics.ascent * size)
    const tags = `\\an8\\pos(540,${top})${word.size === undefined ? "" : `\\fs${size}`}${look.box === undefined ? "" : boxTags(size, BOX_TALL, BOX_WIDE)}`
    const text = plain(word.text)
    return event(word, "word", tags, look.capitals ? text.toLocaleUpperCase("ru-RU") : text)
  })

const textEvents = (text: ShownText, box: Rect, place: TitlePlace): ReadonlyArray<string> => {
  let baseline = 0
  let below = 0
  const placed = text.lines.map((line, index) => {
    const face = line.accent ? TEXT_FACES.accent : TEXT_FACES.context
    const metrics = FONTS[face.font]
    baseline += below + (index === 0 ? 0 : LINE_GAP) + Math.round(metrics.rise * face.size)
    below = Math.round(metrics.drop * face.size)
    return { line, face, top: baseline - Math.round(metrics.ascent * face.size), index }
  })
  const height = baseline + below
  const offset = place === "middle" ? Math.round((box.top + box.bottom - height) / 2) : box.top + TEXT_DROP
  return placed.map(({ line, top, index }) => {
    const span = { start: Math.min(text.end, text.start + index * LINE_STAGGER), end: text.end }
    return event(span, line.accent ? "accent" : "context", `\\an7\\pos(${box.left + TEXT_INDENT},${offset + top})\\fad(${FADE_IN},${FADE_OUT})`, plain(line.text))
  })
}

const plateEvents = (plate: ShownPlate, box: Rect): ReadonlyArray<string> => {
  const size = plate.size ?? PLATE.size
  const tall = Math.round(size * PLATE_TALL)
  const wide = Math.round(size * PLATE_WIDE)
  const bottom = box.bottom - PLATE.above
  const top = bottom - tall - size
  const fade = `\\fad(${FADE_IN},${FADE_OUT})`
  const stripe = `m 0 0 l ${PLATE.stripeWidth} 0 ${PLATE.stripeWidth} ${size + 2 * tall} 0 ${size + 2 * tall}`
  return [
    event(plate, "plate", `\\an7\\pos(${box.left + wide},${top})${size === PLATE.size ? "" : `\\fs${size}`}${boxTags(size, PLATE_TALL, PLATE_WIDE)}${fade}`, plain(plate.text)),
    event(plate, "stripe", `\\an7\\pos(${box.left},${top - tall})\\bord0\\shad0\\p1${fade}`, stripe, 1)
  ]
}

export type CaptionPart = "words" | "texts" | "plate"

export const assOf = (captions: Captions, parts: ReadonlyArray<CaptionPart> = ["words", "texts", "plate"]): string => {
  const { box } = textAreaOf("Instagram")
  return [
    ...header(captions.look),
    ...(parts.includes("texts") ? captions.texts.flatMap((text) => textEvents(text, box, captions.title)) : []),
    ...(parts.includes("plate") && captions.plate !== undefined ? plateEvents(captions.plate, box) : []),
    ...(parts.includes("words") ? wordEvents(captions.words, captions.look, box) : [])
  ].join("\n") + "\n"
}

export const hasCaptions = (captions: Captions): boolean => captions.words.length > 0 || captions.texts.length > 0 || captions.plate !== undefined
