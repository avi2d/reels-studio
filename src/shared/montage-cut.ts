import { textPlaces } from "./captions.ts"
import { doubtAnswer, doubtsOf, type DoubtAnswer, type WordDoubt } from "./doubts.ts"
import { insertPlaces, shownInserts, type InsertPlace, type Shown } from "./inserts.ts"
import { cutOf, facesByVideo, placesOf, type Join, type Place } from "./joins.ts"
import { lengthOf, type Transcript } from "./plan.ts"
import { bareWord, correctedWord } from "./subtitles.ts"
import { arrange, assemble, clipsOf, type Block, type Clip, type Edits, type Placed, type TimelineView } from "./timeline.ts"
import { isAsked, namedTexts, partAt, type NamedText } from "./text-names.ts"
import { zoomedOf, type ZoomPlace } from "./zooms.ts"

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
  readonly zooms: ReadonlyArray<Numbered<ZoomPlace>>
  readonly words: ReadonlyArray<Numbered<WordPlace>>
}

export interface WordPlace extends WordDoubt {
  readonly video: string
  readonly heard: string
  readonly answer: DoubtAnswer | undefined
}

export type Question =
  | { readonly kind: "word"; readonly part: string; readonly place: Numbered<WordPlace> }
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

type Ready = Extract<TimelineView["timeline"], { readonly state: "ready" }>

const numbered = <T>(places: ReadonlyArray<T>): ReadonlyArray<Numbered<T>> => places.map((place, index) => ({ place, number: index + 1 }))

export const joinKey = (join: Join): string => `${join.end.video}:${join.end.end}:${join.start.video}:${join.start.start}`

export const wordKey = (place: Pick<WordPlace, "video" | "index">): string => `${place.video}:${place.index}`

export const questionKey = (question: Question): string => {
  switch (question.kind) {
    case "word": return `word:${wordKey(question.place.place)}`
    case "join": return `join:${joinKey(question.place.place.join)}`
    case "insert": return `insert:${question.place.place.planned.id}`
    case "text": return `text:${question.place.place.planned.id}`
  }
}

export const isOpen = (question: Question): boolean => question.place.place.answer === undefined

const wordsOf = (one: Placed, transcripts: ReadonlyMap<string, Transcript>, edits: Edits, view: TimelineView): ReadonlyArray<WordPlace> => {
  const { video, from, to } = one.take
  const transcript = transcripts.get(video)
  if (transcript === undefined) return []
  const planned = view.doubts.state === "ready" ? view.doubts.planned : []
  return doubtsOf(transcript, video, planned).flatMap((doubt) => {
    const word = transcript.words[doubt.index]
    if (word === undefined || doubt.index < from || doubt.index > to || !one.spans.some((span) => word.end > span.start && word.start < span.end)) return []
    const heard = bareWord(word.text)
    const corrections = edits.subtitles ?? []
    const direct = corrections.find((fix) => fix.block === one.block.id && fix.video === video && fix.index === doubt.index)
    const shown = correctedWord([one.block], transcripts, corrections, one.block.id, video, doubt.index)
    const corrected = direct?.text ?? (bareWord(shown) === heard ? undefined : shown)
    return [{ ...doubt, video, heard, answer: doubtAnswer(heard, doubt.fix, corrected) }]
  })
}

export const zoomedReel = (view: TimelineView, timeline: Ready, transcripts: ReadonlyMap<string, Transcript>, edits: Edits): ReturnType<typeof zoomedOf> & { readonly placed: ReadonlyArray<Placed> } => {
  const placed = assemble(timeline.blocks, edits, transcripts, timeline.rest)
  const faces = facesByVideo(view.faces)
  return { ...zoomedOf(cutOf(clipsOf(placed), faces, transcripts, edits), view.zooms.state === "ready" ? view.zooms.planned : [], faces, transcripts, edits, timeline.zoom), placed }
}

export const cutOfPage = (view: TimelineView, timeline: Ready, transcripts: ReadonlyMap<string, Transcript>, edits: Edits): Cut => {
  const zoomed = zoomedReel(view, timeline, transcripts, edits)
  const { placed } = zoomed
  const faces = facesByVideo(view.faces)
  const reel = zoomed.clips
  const zooms = numbered(zoomed.places)
  const joins = numbered(placesOf(clipsOf(placed), faces, transcripts, edits))
  const inserts = numbered(insertPlaces(view.inserts.state === "ready" ? view.inserts.planned : [], reel, transcripts, edits, view.pictures))
  const texts = namedTexts(textPlaces(view.texts.state === "ready" ? view.texts.planned : [], reel, transcripts, edits.texts ?? []), placed, reel)
  const insertPart = ({ place }: Numbered<InsertPlace>): string | undefined =>
    place.span === undefined ? undefined : partAt(placed, reel, place.planned.video, place.planned.from, place.span.start)
  let start = 0
  let words = 0
  const parts = placed.map((one, index): Part => {
    const spans = reel.filter((clip) => clip.block === one.block.id)
    const played = { ...one, spans: spans.map((clip) => ({ start: clip.start, end: clip.end })) }
    const doubts = wordsOf(played, transcripts, edits, view).map((place, offset) => ({ place, number: words + offset + 1 }))
    words += doubts.length
    const part = {
      one: played,
      number: index + 1,
      start,
      length: lengthOf(spans),
      joins: joins.filter(({ place }) => place.join.start.block === one.block.id),
      inserts: inserts.filter((place) => insertPart(place) === one.block.id),
      texts: texts.filter((text) => text.part === one.block.id),
      zooms: zooms.filter(({ place }) => place.block === one.block.id),
      words: doubts
    }
    start += part.length
    return part
  })
  const questions = parts.flatMap((part): ReadonlyArray<Question> => [
    ...part.words.map((place) => ({ kind: "word" as const, part: part.one.block.id, place })),
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
