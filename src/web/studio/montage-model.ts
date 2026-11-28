import { textPlaces, type TextPlace } from "../../shared/captions.ts"
import { doubtAnswer, doubtsOf, type DoubtAnswer, type WordDoubt } from "../../shared/doubts.ts"
import { insertPlaces, shownInserts, type InsertPlace, type Shown } from "../../shared/inserts.ts"
import { cutOf, facesByVideo, placesOf, type Join, type Place } from "../../shared/joins.ts"
import { lengthOf, type Transcript } from "../../shared/plan.ts"
import { bareWord } from "../../shared/subtitles.ts"
import { arrange, assemble, clipsOf, type Block, type Clip, type Edits, type Placed, type TimelinePage } from "../../shared/timeline.ts"

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
  readonly texts: ReadonlyArray<Numbered<TextPlace>>
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
    readonly texts: ReadonlyArray<Numbered<TextPlace>>
  }
}

type Ready = Extract<TimelinePage["timeline"], { readonly state: "ready" }>

const numbered = <T>(places: ReadonlyArray<T>): ReadonlyArray<Numbered<T>> => places.map((place, index) => ({ place, number: index + 1 }))

const blockAt = (reel: ReadonlyArray<Clip>, time: number): string | undefined => {
  let start = 0
  for (const clip of reel) {
    const end = start + clip.end - clip.start
    if (time >= start && time < end) return clip.block
    start = end
  }
  return undefined
}

const saidIn = (placed: ReadonlyArray<Placed>, video: string, word: number): string | undefined =>
  placed.find((one) => one.take.video === video && word >= one.take.from && word <= one.take.to)?.block.id

export const joinKey = (join: Join): string => `${join.end.video}:${join.end.end}:${join.start.video}:${join.start.start}`

export const wordKey = (place: Pick<WordPlace, "video" | "index">): string => `${place.video}:${place.index}`

export const questionKey = (question: Question): string => {
  switch (question.kind) {
    case "word": return `word:${wordKey(question.place.place)}`
    case "join": return `join:${joinKey(question.place.place.join)}`
    case "insert": return `insert:${question.place.place.planned.id}`
  }
}

export const isOpen = (question: Question): boolean => question.place.place.answer === undefined

const wordsOf = (one: Placed, transcripts: ReadonlyMap<string, Transcript>, edits: Edits, view: TimelinePage): ReadonlyArray<WordPlace> => {
  const { video, from, to } = one.take
  const transcript = transcripts.get(video)
  if (transcript === undefined) return []
  const planned = view.doubts.state === "ready" ? view.doubts.planned : []
  return doubtsOf(transcript, video, planned).flatMap((doubt) => {
    const word = transcript.words[doubt.index]
    if (word === undefined || doubt.index < from || doubt.index > to || !one.spans.some((span) => word.end > span.start && word.start < span.end)) return []
    const heard = bareWord(word.text)
    const corrected = (edits.subtitles ?? []).find((fix) => fix.block === one.block.id && fix.video === video && fix.index === doubt.index)?.text
    return [{ ...doubt, video, heard, answer: doubtAnswer(heard, doubt.fix, corrected) }]
  })
}

export const cutOfPage = (view: TimelinePage, timeline: Ready, transcripts: ReadonlyMap<string, Transcript>, edits: Edits): Cut => {
  const placed = assemble(timeline.blocks, edits, transcripts, timeline.rest)
  const faces = facesByVideo(view.faces)
  const reel = cutOf(clipsOf(placed), faces, transcripts, edits)
  const joins = numbered(placesOf(clipsOf(placed), faces, transcripts, edits))
  const inserts = numbered(insertPlaces(view.inserts.state === "ready" ? view.inserts.planned : [], reel, transcripts, edits, view.pictures))
  const texts = numbered(textPlaces(view.texts.state === "ready" ? view.texts.planned : [], reel, transcripts))
  // An insert or a text starts a little before its phrase, so its start can fall in the part before the one that says it.
  const insertPart = ({ place }: Numbered<InsertPlace>): string | undefined =>
    place.span === undefined ? undefined : saidIn(placed, place.planned.video, place.planned.from) ?? blockAt(reel, place.span.start)
  const textPart = ({ place }: Numbered<TextPlace>): string | undefined =>
    saidIn(placed, place.planned.video, place.planned.from) ?? (place.state === "shown" ? blockAt(reel, place.shown.start) : undefined)
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
      texts: texts.filter((place) => textPart(place) === one.block.id),
      words: doubts
    }
    start += part.length
    return part
  })
  const questions = parts.flatMap((part): ReadonlyArray<Question> => [
    ...part.words.map((place) => ({ kind: "word" as const, part: part.one.block.id, place })),
    ...part.joins.map((place) => ({ kind: "join" as const, part: part.one.block.id, place })),
    ...part.inserts.map((place) => ({ kind: "insert" as const, part: part.one.block.id, place }))
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
      texts: texts.filter((place) => textPart(place) === undefined)
    }
  }
}

export const nextAsking = (questions: ReadonlyArray<Question>, current: string | undefined): Question | undefined => {
  const here = questions.findIndex((question) => questionKey(question) === current)
  return questions.slice(here + 1).find(isOpen) ?? questions.find(isOpen)
}
