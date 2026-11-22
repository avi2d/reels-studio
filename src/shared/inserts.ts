import type { Span, Transcript } from "./plan.ts"
import { coversOf, type Cover, type Join } from "./joins.ts"
import type { Clip, Edits, InsertAnswer, PlannedInsert } from "./timeline.ts"

const INSERT_SHORTEST = 2
export const INSERT_FADE = 0.3
export const INSERT_DRIFT = 0.06
const COVER_BEFORE = 1
const COVER_AFTER = 1.5
const AROUND_INSERT = 1
const SHORTEST_LEFT = 1
const FILL_FROM = 1.3

export type Shape = "fill" | "card"

export type Visual =
  | { readonly kind: "picture"; readonly file: string }
  | { readonly kind: "clip"; readonly file: string; readonly start: number; readonly sound: boolean }
  | { readonly kind: "page"; readonly file: string; readonly page: number; readonly quote: string }

export const plannedVisual = (planned: PlannedInsert): Visual => {
  if ("picture" in planned) return { kind: "picture", file: planned.picture }
  if ("clip" in planned) return { kind: "clip", file: planned.clip, start: planned.start ?? 0, sound: false }
  return { kind: "page", file: planned.document, page: planned.page, quote: planned.quote }
}

// A picture keys by its bare name, so a reel built before clips and pages still matches its cut.
export const visualKey = (visual: Visual): string => {
  if (visual.kind === "picture") return visual.file
  if (visual.kind === "clip") return `clip:${visual.file}:${visual.start}:${visual.sound ? "sound" : "silent"}`
  return `page:${visual.file}:${visual.page}:${visual.quote}`
}

export const shapeOf = (width: number, height: number): Shape => height / width >= FILL_FROM ? "fill" : "card"

const startsOf = (clips: ReadonlyArray<Span>): ReadonlyArray<number> => {
  let at = 0
  return clips.map((clip) => {
    const start = at
    at += clip.end - clip.start
    return start
  })
}

const totalOf = (clips: ReadonlyArray<Span>): number => clips.reduce((total, clip) => total + clip.end - clip.start, 0)

export const phraseSpan = (clips: ReadonlyArray<Clip>, transcript: Transcript, planned: Pick<PlannedInsert, "video" | "from" | "to">): Span | undefined => {
  const first = transcript.words[planned.from]
  const last = transcript.words[planned.to]
  if (first === undefined || last === undefined || planned.from > planned.to) return undefined
  const starts = startsOf(clips)
  let start: number | undefined
  let end: number | undefined
  clips.forEach((clip, index) => {
    const from = Math.max(first.start, clip.start)
    const to = Math.min(last.end, clip.end)
    if (clip.video !== planned.video || to <= from) return
    const at = starts[index] ?? 0
    start ??= at + from - clip.start
    end = at + to - clip.start
  })
  return start === undefined || end === undefined ? undefined : { start, end }
}

const fitted = (span: Span, total: number): Span => {
  const length = Math.min(total, Math.max(span.end - span.start, INSERT_SHORTEST))
  const end = Math.min(total, span.start + length)
  return { start: Math.max(0, end - length), end }
}

const coverId = (join: Join): string => `join:${join.end.video}:${join.end.end}:${join.start.video}:${join.start.start}`

const coverSpan = (clips: ReadonlyArray<Clip>, join: Join): Span => {
  const at = startsOf(clips)[join.after] ?? 0
  return { start: Math.max(0, at - COVER_BEFORE), end: Math.min(totalOf(clips), at + COVER_AFTER) }
}

export interface InsertPlace {
  readonly planned: PlannedInsert
  readonly visual: Visual
  readonly answer: InsertAnswer["answer"] | undefined
  readonly span: Span | undefined
}

export interface Shown extends Span {
  readonly id: string
  readonly visual: Visual
}

const answeredVisual = (planned: PlannedInsert, answered: InsertAnswer | undefined, pictures: ReadonlyArray<string>): Visual | undefined => {
  if (answered?.answer === "replace") return pictures.includes(answered.picture) ? { kind: "picture", file: answered.picture } : undefined
  const visual = plannedVisual(planned)
  if (answered?.answer !== "sound") return visual
  return visual.kind === "clip" ? { ...visual, sound: true } : undefined
}

const answerOf = (edits: Edits, id: string): InsertAnswer | undefined => edits.inserts.find((one) => one.id === id)

export const insertPlaces = (
  planned: ReadonlyArray<PlannedInsert>, reel: ReadonlyArray<Clip>, transcripts: ReadonlyMap<string, Transcript>, edits: Edits, pictures: ReadonlyArray<string>
): ReadonlyArray<InsertPlace> => {
  const total = totalOf(reel)
  return planned.map((one) => {
    const answered = answerOf(edits, one.id)
    const transcript = transcripts.get(one.video)
    const said = transcript === undefined ? undefined : phraseSpan(reel, transcript, one)
    const visual = answeredVisual(one, answered, pictures)
    return {
      planned: one,
      visual: visual ?? plannedVisual(one),
      answer: visual === undefined ? undefined : answered?.answer,
      span: said === undefined ? undefined : fitted(said, total)
    }
  }).toSorted((left, right) => (left.span?.start ?? Infinity) - (right.span?.start ?? Infinity))
}

// A later insert starts where the earlier one ends, so two inserts never stand on the screen at once.
export const shownInserts = (places: ReadonlyArray<InsertPlace>, reel: ReadonlyArray<Clip>, edits: Edits, pictures: ReadonlyArray<string>, resolved?: ReadonlyArray<Cover>): ReadonlyArray<Shown> => {
  const covers = (resolved ?? coversOf(reel, edits, pictures)).filter((cover) => pictures.includes(cover.picture))
  const wanted = [
    ...places.flatMap((place): ReadonlyArray<Shown> =>
      place.span === undefined || place.answer === "remove" ? [] : [{ id: place.planned.id, visual: place.visual, ...place.span }]),
    ...covers.map(({ join, picture }): Shown => ({ id: coverId(join), visual: { kind: "picture", file: picture }, ...coverSpan(reel, join) }))
  ].toSorted((left, right) => left.start - right.start)
  const shown: Array<Shown> = []
  for (const one of wanted) {
    const start = Math.max(one.start, shown.at(-1)?.end ?? 0)
    if (one.end - start >= SHORTEST_LEFT) shown.push({ ...one, start })
  }
  return shown
}

export const openInserts = (places: ReadonlyArray<InsertPlace>): number =>
  places.filter((place) => place.answer === undefined && place.span !== undefined).length

export const withInsert = (edits: Edits, answer: InsertAnswer): Edits => ({
  ...edits,
  inserts: [...edits.inserts.filter((one) => one.id !== answer.id), answer]
})

export const insertsWithin = (shown: ReadonlyArray<Shown>, window: Span): ReadonlyArray<Shown> =>
  shown.flatMap((one) => {
    const start = Math.max(one.start, window.start)
    const end = Math.min(one.end, window.end)
    return end > start ? [{ ...one, start: start - window.start, end: end - window.start }] : []
  })

export const reelWithin = (clips: ReadonlyArray<Clip>, window: Span): ReadonlyArray<Clip> => {
  const starts = startsOf(clips)
  return clips.flatMap((clip, index) => {
    const at = starts[index] ?? 0
    const from = Math.max(window.start, at)
    const to = Math.min(window.end, at + clip.end - clip.start)
    return to > from ? [{ ...clip, start: clip.start + from - at, end: clip.start + to - at }] : []
  })
}

export const aroundInsert = (span: Span): Span => ({ start: Math.max(0, span.start - AROUND_INSERT), end: span.end + AROUND_INSERT })

export const shiftedBy = (shown: ReadonlyArray<Shown>, offset: number): ReadonlyArray<Shown> =>
  shown.map((one) => ({ ...one, start: one.start - offset, end: one.end - offset }))

export interface InsertLook {
  readonly visual: Visual
  readonly opacity: number
  readonly scale: number
  readonly since: number
}

export const lookAt = (shown: ReadonlyArray<Shown>, time: number): InsertLook | undefined => {
  const one = shown.find((each) => time >= each.start && time < each.end)
  if (one === undefined) return undefined
  const fade = Math.min(INSERT_FADE, (one.end - one.start) / 2)
  return {
    visual: one.visual,
    opacity: Math.max(0, Math.min(1, (time - one.start) / fade, (one.end - time) / fade)),
    scale: one.visual.kind === "clip" ? 1 : 1 + INSERT_DRIFT * (time - one.start) / (one.end - one.start),
    since: time - one.start
  }
}
