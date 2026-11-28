import { textPlaces } from "../../shared/captions.ts"
import { insertPlaces, shownInserts, type InsertPlace, type Shown } from "../../shared/inserts.ts"
import { cutOf, facesByVideo, placesOf, type Join, type Place } from "../../shared/joins.ts"
import { lengthOf, type Transcript } from "../../shared/plan.ts"
import { arrange, assemble, clipsOf, type Block, type Clip, type Edits, type Placed, type TimelinePage } from "../../shared/timeline.ts"
import { isAsked, namedTexts, partAt, type NamedText } from "../text-names.ts"

export interface Numbered<T> {
  readonly place: T
  readonly number: number
}

export interface Part {
  readonly one: Placed
  readonly number: number
  readonly start: number
  readonly length: number
  readonly joins: ReadonlyArray<Numbered<Place>>
  readonly inserts: ReadonlyArray<Numbered<InsertPlace>>
  readonly texts: ReadonlyArray<NamedText>
}

export type Question =
  | { readonly kind: "join"; readonly part: string; readonly place: Numbered<Place> }
  | { readonly kind: "insert"; readonly part: string; readonly place: Numbered<InsertPlace> }
  | { readonly kind: "text"; readonly part: string; readonly place: NamedText }

export interface Cut {
  readonly parts: ReadonlyArray<Part>
  readonly gone: ReadonlyArray<Block>
  readonly reel: ReadonlyArray<Clip>
  readonly length: number
  readonly rest: number
  readonly shown: ReadonlyArray<Shown>
  readonly questions: ReadonlyArray<Question>
  readonly outside: {
    readonly inserts: ReadonlyArray<Numbered<InsertPlace>>
    readonly texts: ReadonlyArray<NamedText>
  }
}

type Ready = Extract<TimelinePage["timeline"], { readonly state: "ready" }>

const numbered = <T>(places: ReadonlyArray<T>): ReadonlyArray<Numbered<T>> => places.map((place, index) => ({ place, number: index + 1 }))

export const joinKey = (join: Join): string => `${join.end.video}:${join.end.end}:${join.start.video}:${join.start.start}`

export const questionKey = (question: Question): string => {
  switch (question.kind) {
    case "join": return `join:${joinKey(question.place.place.join)}`
    case "insert": return `insert:${question.place.place.planned.id}`
    case "text": return `text:${question.place.place.planned.id}`
  }
}

export const isOpen = (question: Question): boolean => question.place.place.answer === undefined

export const cutOfPage = (view: TimelinePage, timeline: Ready, transcripts: ReadonlyMap<string, Transcript>, edits: Edits): Cut => {
  const placed = assemble(timeline.blocks, edits, transcripts, timeline.rest)
  const faces = facesByVideo(view.faces)
  const reel = cutOf(clipsOf(placed), faces, transcripts, edits)
  const joins = numbered(placesOf(clipsOf(placed), faces, transcripts, edits))
  const inserts = numbered(insertPlaces(view.inserts.state === "ready" ? view.inserts.planned : [], reel, transcripts, edits, view.pictures))
  const texts = namedTexts(textPlaces(view.texts.state === "ready" ? view.texts.planned : [], reel, transcripts, edits.texts ?? []), placed, reel)
  const insertPart = ({ place }: Numbered<InsertPlace>): string | undefined =>
    place.span === undefined ? undefined : partAt(placed, reel, place.planned.video, place.planned.from, place.span.start)
  let start = 0
  const parts = placed.map((one, index): Part => {
    const spans = reel.filter((clip) => clip.block === one.block.id)
    const part = {
      one: { ...one, spans: spans.map((clip) => ({ start: clip.start, end: clip.end })) },
      number: index + 1,
      start,
      length: lengthOf(spans),
      joins: joins.filter(({ place }) => place.join.start.block === one.block.id),
      inserts: inserts.filter((place) => insertPart(place) === one.block.id),
      texts: texts.filter((text) => text.part === one.block.id)
    }
    start += part.length
    return part
  })
  const questions = parts.flatMap((part): ReadonlyArray<Question> => [
    ...part.joins.map((place) => ({ kind: "join" as const, part: part.one.block.id, place })),
    ...part.inserts.map((place) => ({ kind: "insert" as const, part: part.one.block.id, place })),
    ...part.texts.filter(({ place }) => isAsked(place)).map((place) => ({ kind: "text" as const, part: part.one.block.id, place }))
  ])
  return {
    parts,
    gone: arrange(timeline.blocks, edits).deleted,
    reel,
    length: lengthOf(reel),
    rest: timeline.rest,
    shown: shownInserts(inserts.map(({ place }) => place), reel, edits, view.pictures),
    questions,
    outside: {
      inserts: inserts.filter((place) => insertPart(place) === undefined),
      texts: texts.filter((text) => text.part === undefined)
    }
  }
}

export const nextAsking = (questions: ReadonlyArray<Question>, current: string | undefined): Question | undefined => {
  const here = questions.findIndex((question) => questionKey(question) === current)
  return questions.slice(here + 1).find(isOpen) ?? questions.find(isOpen)
}
