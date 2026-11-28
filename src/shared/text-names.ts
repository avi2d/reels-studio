import type { TextPlace } from "./captions.ts"
import type { Clip, Placed } from "./timeline.ts"

export const TITLE = "Заголовок"

export interface NamedText {
  readonly place: TextPlace
  readonly name: string
  readonly part: string | undefined
}

export const blockAt = (reel: ReadonlyArray<Clip>, time: number): string | undefined => {
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

// An insert or a text starts a little before its phrase, so its start can fall in the part before the one that says it.
export const partAt = (placed: ReadonlyArray<Placed>, reel: ReadonlyArray<Clip>, video: string, word: number, start: number | undefined): string | undefined =>
  saidIn(placed, video, word) ?? (start === undefined ? undefined : blockAt(reel, start))

export const isAsked = (place: TextPlace): boolean => place.state === "shown" || place.reason === "removed"

export const namedTexts = (places: ReadonlyArray<TextPlace>, placed: ReadonlyArray<Placed>, reel: ReadonlyArray<Clip>): ReadonlyArray<NamedText> => {
  const parted = places.map((place) => ({
    place,
    part: partAt(placed, reel, place.planned.video, place.planned.from, place.state === "shown" ? place.shown.start : undefined)
  }))
  const firstPart = placed[0]?.block.id
  const title = parted.filter(({ place, part }) => firstPart !== undefined && part === firstPart && isAsked(place))
    .toSorted((left, right) => left.place.planned.from - right.place.planned.from)[0]
  let thought = 0
  return parted.map((one): NamedText => {
    if (one === title) return { ...one, name: TITLE }
    thought += 1
    return { ...one, name: `Мысль ${thought}` }
  })
}

export const nameIn = (texts: ReadonlyArray<NamedText>, id: string): string =>
  texts.find(({ place }) => place.planned.id === id)?.name ?? "Другая надпись"
